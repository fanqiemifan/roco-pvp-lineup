import fs from 'node:fs';

import type { MatchRecord, Page8State } from '../../shared/types.js';
import { normalizeHHmm } from '../../shared/match-schedule.js';
import { ensureRuntimeDirs } from './image-service.js';
import { getMatchStore } from './match-service.js';
import type { AppPaths } from './path-service.js';

/** 比赛预告页（page8）最多展示的比赛数量（3×3 卡片网格） */
export const PAGE8_MAX_MATCHES = 9;

/** 允许收录进比赛预告的比赛状态：待开始优先，进行中可选 */
export const PAGE8_MATCH_STATUSES: ReadonlySet<MatchRecord['status']> = new Set(['pending', 'in_progress']);

function defaultPage8State(): Page8State {
  return {
    matchIds: [],
    title: '',
    startTime: '',
    matchTimes: {},
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
    if (typeof item !== 'string' || !item.trim()) {
      continue;
    }
    const id = item.trim();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length >= PAGE8_MAX_MATCHES) {
      break;
    }
  }
  return ids;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().slice(0, 40);
}

/** 手动场序时间覆盖：只保留在 matchIds 内、且 HH:mm 合法的条目 */
function normalizeMatchTimes(value: unknown, matchIds: string[]): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const allowed = new Set(matchIds);
  const result: Record<string, string> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(id)) {
      continue;
    }
    const time = normalizeHHmm(raw);
    if (time) {
      result[id] = time;
    }
  }
  return result;
}

export function getPage8State(paths: AppPaths): Page8State {
  if (!fs.existsSync(paths.page8File)) {
    return defaultPage8State();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.page8File, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.page8File);
    const matchIds = normalizeMatchIds(metadata.matchIds);
    return {
      matchIds,
      title: normalizeText(metadata.title),
      startTime: normalizeHHmm(metadata.startTime),
      matchTimes: normalizeMatchTimes(metadata.matchTimes, matchIds),
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultPage8State();
  }
}

/**
 * 保存 page8 配置。仅允许收录待开始（pending）或进行中（in_progress）的比赛；
 * 最多 PAGE8_MAX_MATCHES 场，顺序即展示顺序与卡片场序。
 */
export function savePage8State(paths: AppPaths, payload: unknown): Page8State {
  if (!payload || typeof payload !== 'object') {
    throw new Error('page8 payload must be an object');
  }

  ensureRuntimeDirs(paths);

  const raw = payload as Record<string, unknown>;
  const previous = getPage8State(paths);
  const rawMatchIds = raw.matchIds === undefined ? previous.matchIds : normalizeMatchIds(raw.matchIds);
  const title = raw.title === undefined ? previous.title : normalizeText(raw.title);
  const startTime = raw.startTime === undefined ? previous.startTime : normalizeHHmm(raw.startTime);

  const allowedIds = new Set(
    getMatchStore(paths).matches
      .filter((match) => PAGE8_MATCH_STATUSES.has(match.status))
      .map((match) => match.id),
  );
  const matchIds = rawMatchIds.filter((id) => allowedIds.has(id)).slice(0, PAGE8_MAX_MATCHES);
  const matchTimes = normalizeMatchTimes(raw.matchTimes === undefined ? previous.matchTimes : raw.matchTimes, matchIds);

  const metadata = { matchIds, title, startTime, matchTimes };
  fs.writeFileSync(paths.page8File, JSON.stringify(metadata, null, 2), 'utf-8');
  return getPage8State(paths);
}

/**
 * 清理选场清单中已删或不再可展示（已结束）的比赛引用。
 * 比赛删除 / 状态变更后由广播出口调用：有变化时落盘并返回新状态，无变化返回 null。
 */
export function prunePage8State(paths: AppPaths): Page8State | null {
  const current = getPage8State(paths);
  const allowedIds = new Set(
    getMatchStore(paths).matches
      .filter((match) => PAGE8_MATCH_STATUSES.has(match.status))
      .map((match) => match.id),
  );
  const matchIds = current.matchIds.filter((id) => allowedIds.has(id));
  if (matchIds.length === current.matchIds.length) {
    return null;
  }
  return savePage8State(paths, { matchIds });
}
