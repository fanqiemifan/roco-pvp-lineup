import fs from 'node:fs';

import { TOURNAMENT_ID_REGEX } from '../../shared/constants.js';
import type { Page14State, StageStandings } from '../../shared/types.js';
import { ensureRuntimeDirs } from './image-service.js';
import type { AppPaths } from './path-service.js';
import { getTournamentStore, resolveStageStandings } from './tournament-service.js';

const TITLE_MAX_LENGTH = 40;
const SUBTITLE_MAX_LENGTH = 60;

function defaultPage14State(): Page14State {
  return {
    tournamentId: '',
    stageIndexes: [],
    activeStageIndex: -1,
    page: 0,
    title: '',
    subtitle: '',
    mtime: null,
  };
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

/** 系列赛 id：只接受 T 前缀形态（防注入），其余一律视为「未选择」 */
function normalizeTournamentId(value: unknown): string {
  const raw = String(value ?? '').trim();
  return TOURNAMENT_ID_REGEX.test(raw) ? raw : '';
}

/** 可播阶段索引：去重 + 升序（顺序即后台切换顺序） */
function normalizeStageIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const indexes: number[] = [];
  value.forEach((item) => {
    const index = Number(item);
    if (Number.isInteger(index) && index >= 0 && !indexes.includes(index)) {
      indexes.push(index);
    }
  });
  return indexes.sort((left, right) => left - right);
}

function normalizeActiveStageIndex(value: unknown): number {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

function normalizePage(value: unknown): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 0;
}

export function getPage14State(paths: AppPaths): Page14State {
  if (!fs.existsSync(paths.page14File)) {
    return defaultPage14State();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.page14File, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.page14File);
    return {
      tournamentId: normalizeTournamentId(metadata.tournamentId),
      stageIndexes: normalizeStageIndexes(metadata.stageIndexes),
      activeStageIndex: normalizeActiveStageIndex(metadata.activeStageIndex),
      page: normalizePage(metadata.page),
      title: normalizeText(metadata.title, TITLE_MAX_LENGTH),
      subtitle: normalizeText(metadata.subtitle, SUBTITLE_MAX_LENGTH),
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultPage14State();
  }
}

/**
 * 用系列赛现状夹紧阶段选择与页码（不落盘）：
 * - 系列赛不存在（被删 / 还没随同步包过来）→ 不展示阶段，页码回 0，standings 为 null
 * - 阶段索引必须在现存阶段内，且是已勾选的可播阶段；失效时回退到第一个已选阶段
 * - 页码必须落在当前阶段的总页数内（例如 64进32 有 2 页，切到 16进8 后要回到第 1 页）
 */
function computeView(
  paths: AppPaths,
  state: Page14State,
): { state: Page14State; standings: StageStandings | null } {
  const record = getTournamentStore(paths).find((item) => item.id === state.tournamentId);
  if (!record) {
    return { state: { ...state, activeStageIndex: -1, page: 0 }, standings: null };
  }

  const stageIndexes = state.stageIndexes.filter((index) => Boolean(record.stages[index]));
  const activeStageIndex = stageIndexes.includes(state.activeStageIndex)
    ? state.activeStageIndex
    : (stageIndexes[0] ?? -1);
  const standings = activeStageIndex >= 0
    ? resolveStageStandings(paths, record.id, activeStageIndex)
    : null;
  const page = Math.min(state.page, (standings?.pageCount ?? 1) - 1);

  return { state: { ...state, stageIndexes, activeStageIndex, page }, standings };
}

/**
 * 保存 page14 配置：关联系列赛 + 可播阶段 + 当前阶段 + 页码 + 标题副标题。
 * 落盘前按系列赛现状夹紧（见 computeView），避免系列赛被删/阶段数变化后停在越界状态。
 */
export function savePage14State(paths: AppPaths, payload: unknown): Page14State {
  if (!payload || typeof payload !== 'object') {
    throw new Error('page14 payload must be an object');
  }

  ensureRuntimeDirs(paths);

  const current = getPage14State(paths);
  const raw = payload as Record<string, unknown>;
  const draft: Page14State = {
    tournamentId: raw.tournamentId === undefined
      ? current.tournamentId
      : normalizeTournamentId(raw.tournamentId),
    stageIndexes: raw.stageIndexes === undefined
      ? current.stageIndexes
      : normalizeStageIndexes(raw.stageIndexes),
    activeStageIndex: raw.activeStageIndex === undefined
      ? current.activeStageIndex
      : normalizeActiveStageIndex(raw.activeStageIndex),
    page: raw.page === undefined ? current.page : normalizePage(raw.page),
    title: raw.title === undefined ? current.title : normalizeText(raw.title, TITLE_MAX_LENGTH),
    subtitle: raw.subtitle === undefined
      ? current.subtitle
      : normalizeText(raw.subtitle, SUBTITLE_MAX_LENGTH),
    mtime: current.mtime,
  };

  const clamped = computeView(paths, draft).state;
  const metadata = {
    tournamentId: clamped.tournamentId,
    stageIndexes: clamped.stageIndexes,
    activeStageIndex: clamped.activeStageIndex,
    page: clamped.page,
    title: clamped.title,
    subtitle: clamped.subtitle,
  };
  fs.writeFileSync(paths.page14File, JSON.stringify(metadata, null, 2), 'utf-8');
  return getPage14State(paths);
}

/**
 * 读取 page14 展示视图（只读，不落盘）：state（已夹紧）+ 当前阶段榜单。
 * 榜单由 resolveStageStandings 按该阶段现存节点重算——只统计系列赛内的比赛。
 */
export function resolvePage14View(
  paths: AppPaths,
): { state: Page14State; standings: StageStandings | null } {
  return computeView(paths, getPage14State(paths));
}
