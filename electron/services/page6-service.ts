import fs from 'node:fs';

import type { MatchRecord, Page6State } from '../../shared/types.js';
import { normalizeHHmm } from '../../shared/match-schedule.js';
import { ensureRuntimeDirs } from './image-service.js';
import { getMatchStore } from './match-service.js';
import type { AppPaths } from './path-service.js';

/** 比赛结果页（page6）最多展示的比赛数量（3×3 卡片网格） */
export const PAGE6_MAX_MATCHES = 9;

/** 比赛结果页（page6）允许收录的比赛状态：仅已结束 */
export const PAGE6_MATCH_STATUSES: ReadonlySet<MatchRecord['status']> = new Set(['completed']);

function defaultPage6State(): Page6State {
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
    if (ids.length >= PAGE6_MAX_MATCHES) {
      break;
    }
  }
  return ids;
}

function normalizeTitle(value: unknown): string {
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

export function getPage6State(paths: AppPaths): Page6State {
  if (!fs.existsSync(paths.page6File)) {
    return defaultPage6State();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.page6File, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.page6File);
    const matchIds = normalizeMatchIds(metadata.matchIds);
    return {
      matchIds,
      title: normalizeTitle(metadata.title),
      startTime: normalizeHHmm(metadata.startTime),
      matchTimes: normalizeMatchTimes(metadata.matchTimes, matchIds),
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultPage6State();
  }
}

/**
 * 保存 page6 配置。仅允许收录已结束（completed）的比赛；
 * 最多 PAGE6_MAX_MATCHES 场，顺序即展示顺序与卡片场序。
 */
export function savePage6State(paths: AppPaths, payload: unknown): Page6State {
  if (!payload || typeof payload !== 'object') {
    throw new Error('page6 payload must be an object');
  }

  ensureRuntimeDirs(paths);

  const raw = payload as Record<string, unknown>;
  const previous = getPage6State(paths);
  const rawMatchIds = raw.matchIds === undefined ? previous.matchIds : normalizeMatchIds(raw.matchIds);
  const title = raw.title === undefined ? previous.title : normalizeTitle(raw.title);
  const startTime = raw.startTime === undefined ? previous.startTime : normalizeHHmm(raw.startTime);

  const completedIds = new Set(
    getMatchStore(paths).matches
      .filter((match) => PAGE6_MATCH_STATUSES.has(match.status))
      .map((match) => match.id),
  );
  const matchIds = rawMatchIds.filter((id) => completedIds.has(id)).slice(0, PAGE6_MAX_MATCHES);
  const matchTimes = normalizeMatchTimes(raw.matchTimes === undefined ? previous.matchTimes : raw.matchTimes, matchIds);

  const metadata = { matchIds, title, startTime, matchTimes };
  fs.writeFileSync(paths.page6File, JSON.stringify(metadata, null, 2), 'utf-8');
  return getPage6State(paths);
}

/**
 * 清理选场清单中已删或不再可展示（非已结束）的比赛引用。
 * 比赛删除 / 状态变更后由广播出口调用：有变化时落盘并返回新状态，无变化返回 null。
 */
export function prunePage6State(paths: AppPaths): Page6State | null {
  const current = getPage6State(paths);
  const allowedIds = new Set(
    getMatchStore(paths).matches
      .filter((match) => PAGE6_MATCH_STATUSES.has(match.status))
      .map((match) => match.id),
  );
  const matchIds = current.matchIds.filter((id) => allowedIds.has(id));
  if (matchIds.length === current.matchIds.length) {
    return null;
  }
  return savePage6State(paths, { matchIds });
}
