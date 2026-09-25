import fs from 'node:fs';

import {
  DEFAULT_MVP_RETURN_PAGE,
  MVP_MAX_ITEMS,
  MVP_TAG_MAX_LENGTH,
  SUPPORTED_STAGE_PAGES,
} from '../../shared/constants.js';
import type { MvpSlotEntry, MvpState, MvpWinnerInfo, StagePageKey } from '../../shared/types.js';
import { ensureRuntimeDirs, getAvatarStates } from './image-service.js';
import { getMatchStore } from './match-service.js';
import type { AppPaths } from './path-service.js';

function defaultMvpState(): MvpState {
  return {
    slots: [],
    returnPage: DEFAULT_MVP_RETURN_PAGE as StagePageKey,
    mtime: null,
  };
}

/** 精灵主键：仅保留 pets.json pet_id 允许的字符，空字符串 = 空槽 */
function normalizePetId(value: unknown): string {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

/** 标签内容：去除首尾空白，最多四个字（空字符串 = 未标记） */
function normalizeTag(value: unknown): string {
  return String(value ?? '').trim().slice(0, MVP_TAG_MAX_LENGTH);
}

/**
 * 关闭 MVP 结算后切回的推流画面：
 * 只接受合法画面且不能是 MVP 结算自身（避免切回后仍在结算画面）。
 */
function normalizeReturnPage(value: unknown): StagePageKey {
  if (typeof value === 'string' && value !== 'page4' && SUPPORTED_STAGE_PAGES.has(value)) {
    return value as StagePageKey;
  }
  return DEFAULT_MVP_RETURN_PAGE as StagePageKey;
}

/**
 * 精灵项：最多 MVP_MAX_ITEMS 个，多余的忽略。
 * 未赋值精灵（petId 为空）的项不落盘；MVP 标记全局最多一个（取第一个）。
 */
function normalizeSlots(value: unknown): MvpSlotEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const slots: MvpSlotEntry[] = [];
  let mvpTaken = false;
  for (const item of value) {
    if (slots.length >= MVP_MAX_ITEMS) {
      break;
    }
    const raw = (item ?? {}) as Record<string, unknown>;
    const petId = normalizePetId(raw.petId);
    if (!petId) {
      continue;
    }
    const isMvp = raw.isMvp === true && !mvpTaken;
    if (isMvp) {
      mvpTaken = true;
    }
    slots.push({ petId, tag: normalizeTag(raw.tag), isMvp });
  }
  return slots;
}

export function getMvpState(paths: AppPaths): MvpState {
  if (!fs.existsSync(paths.mvpFile)) {
    return defaultMvpState();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.mvpFile, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.mvpFile);
    return {
      slots: normalizeSlots(metadata.slots),
      returnPage: normalizeReturnPage(metadata.returnPage),
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultMvpState();
  }
}

/** 保存 MVP 结算配置：精灵项（最多 6 个）与关闭后切回的推流画面 */
export function saveMvpState(paths: AppPaths, payload: unknown): MvpState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('mvp payload must be an object');
  }

  ensureRuntimeDirs(paths);

  const current = getMvpState(paths);
  const raw = payload as Record<string, unknown>;

  const metadata = {
    slots: raw.slots === undefined ? current.slots : normalizeSlots(raw.slots),
    returnPage: raw.returnPage === undefined ? current.returnPage : normalizeReturnPage(raw.returnPage),
  };
  fs.writeFileSync(paths.mvpFile, JSON.stringify(metadata, null, 2), 'utf-8');
  return getMvpState(paths);
}

/** 记录开启结算前所在画面（用于关闭结算时切回），不改变精灵项标记 */
export function saveMvpReturnPage(paths: AppPaths, page: StagePageKey): MvpState {
  return saveMvpState(paths, { returnPage: page });
}

/**
 * 胜方选手信息（页面4 顶部选手信息条）：
 * 取当前对局「最近一个已分胜负的小局」的胜者选手与其头像（与推流页面10 的胜者判定同口径）。
 */
export function getMvpWinnerInfo(paths: AppPaths): MvpWinnerInfo {
  const store = getMatchStore(paths);
  const match = store.activeMatchId
    ? store.matches.find((item) => item.id === store.activeMatchId) ?? null
    : null;

  const decided = match && Array.isArray(match.games)
    ? match.games.filter((game) => game && game.status === 'completed' && (game.winner === 'left' || game.winner === 'right'))
    : [];
  const game = decided.length ? decided[decided.length - 1] : null;
  const side = game ? game.winner : null;

  if (!match || !side) {
    return { side: null, playerName: '', avatarExists: false, avatarPath: '', avatarMtime: null };
  }

  const avatar = getAvatarStates(paths, match.id)[side];
  return {
    side,
    playerName: (side === 'left' ? match.leftPlayer : match.rightPlayer) || '',
    avatarExists: Boolean(avatar?.exists && avatar.path),
    avatarPath: avatar?.exists && avatar.path ? avatar.path : '',
    avatarMtime: typeof avatar?.mtime === 'number' ? avatar.mtime : null,
  };
}