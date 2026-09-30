import fs from 'node:fs';

import type { Page7State } from '../../shared/types.js';
import { ensureRuntimeDirs } from './image-service.js';
import { getMatchStore } from './match-service.js';
import type { AppPaths } from './path-service.js';

/** 对局推送页（page7）默认主标题 */
export const PAGE7_DEFAULT_TITLE = '对局推送';

/** 对局推送页（page7）默认温馨提示 */
export const PAGE7_DEFAULT_NOTICE = '温馨提示：排名选自选手历史最高非实时';

/** 对局推送页（page7）最多选择的比赛数量（画面按小局逐行滚动，结构不变） */
export const PAGE7_MAX_MATCHES = 9;

function defaultPage7State(): Page7State {
  return {
    matchIds: [],
    title: '',
    notice: '',
    mtime: null,
  };
}

function normalizeMatchIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = String(item ?? '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length >= PAGE7_MAX_MATCHES) {
      break;
    }
  }
  return ids;
}

function normalizeTitle(value: unknown): string {
  return String(value ?? '').trim().slice(0, 40);
}

function normalizeNotice(value: unknown): string {
  return String(value ?? '').trim().slice(0, 60);
}

export function getPage7State(paths: AppPaths): Page7State {
  if (!fs.existsSync(paths.page7File)) {
    return defaultPage7State();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.page7File, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.page7File);
    // 兼容旧版单选结构 matchId: string | null
    const legacyMatchIds = normalizeMatchIds([metadata.matchId]);
    return {
      matchIds: metadata.matchIds === undefined ? legacyMatchIds : normalizeMatchIds(metadata.matchIds),
      title: normalizeTitle(metadata.title),
      notice: normalizeNotice(metadata.notice),
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultPage7State();
  }
}

/**
 * 保存 page7 配置。matchIds 只保留比赛列表中真实存在的比赛（避免悬空引用），
 * 顺序即页面展示顺序。
 */
export function savePage7State(paths: AppPaths, payload: unknown): Page7State {
  if (!payload || typeof payload !== 'object') {
    throw new Error('page7 payload must be an object');
  }

  ensureRuntimeDirs(paths);

  const raw = payload as Record<string, unknown>;
  const previous = getPage7State(paths);
  const matchIds = raw.matchIds === undefined ? previous.matchIds : normalizeMatchIds(raw.matchIds);
  const title = raw.title === undefined ? previous.title : normalizeTitle(raw.title);
  const notice = raw.notice === undefined ? previous.notice : normalizeNotice(raw.notice);

  const knownIds = new Set(getMatchStore(paths).matches.map((match) => match.id));
  const effectiveMatchIds = matchIds.filter((id) => knownIds.has(id));

  const metadata = { matchIds: effectiveMatchIds, title, notice };
  fs.writeFileSync(paths.page7File, JSON.stringify(metadata, null, 2), 'utf-8');
  return getPage7State(paths);
}

/**
 * 清理选场清单中已不存在的比赛引用（对局推送不限状态，只处理删除）。
 * 比赛删除后由广播出口调用：有变化时落盘并返回新状态，无变化返回 null。
 */
export function prunePage7State(paths: AppPaths): Page7State | null {
  const current = getPage7State(paths);
  const knownIds = new Set(getMatchStore(paths).matches.map((match) => match.id));
  const matchIds = current.matchIds.filter((id) => knownIds.has(id));
  if (matchIds.length === current.matchIds.length) {
    return null;
  }
  return savePage7State(paths, { matchIds });
}
