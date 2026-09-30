import fs from 'node:fs';

import {
  DEFAULT_NEXTGAME_DURATION,
  DEFAULT_NEXTGAME_DURATION_UNIT,
  SUPPORTED_NEXTGAME_DURATION_UNITS,
} from '../../shared/constants.js';
import type {
  AvatarCollectionState,
  MatchRecord,
  NextGameDurationUnit,
  NextGamePayload,
  NextGameState,
} from '../../shared/types.js';
import { ensureRuntimeDirs } from './image-service.js';
import { resolveMatchAvatars } from './avatar-resolver.js';
import { getMatchStore } from './match-service.js';
import type { AppPaths } from './path-service.js';

const DURATION_MAX_SECONDS = 3600;
const DURATION_MAX_MINUTES = 60;

function defaultNextGameState(): NextGameState {
  return {
    matchId: null,
    visible: false,
    duration: DEFAULT_NEXTGAME_DURATION,
    durationUnit: DEFAULT_NEXTGAME_DURATION_UNIT,
    shownAt: null,
    mtime: null,
  };
}

function normalizeDurationUnit(value: unknown): NextGameDurationUnit {
  return typeof value === 'string' && SUPPORTED_NEXTGAME_DURATION_UNITS.has(value)
    ? (value as NextGameDurationUnit)
    : DEFAULT_NEXTGAME_DURATION_UNIT;
}

function normalizeDuration(value: unknown, unit: NextGameDurationUnit): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return unit === 'seconds' ? 60 : DEFAULT_NEXTGAME_DURATION;
  }
  const max = unit === 'seconds' ? DURATION_MAX_SECONDS : DURATION_MAX_MINUTES;
  const rounded = Math.max(1, Math.round(numeric));
  return Math.min(max, rounded);
}

export function getNextGameState(paths: AppPaths): NextGameState {
  if (!fs.existsSync(paths.nextgameFile)) {
    return defaultNextGameState();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.nextgameFile, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.nextgameFile);
    const durationUnit = normalizeDurationUnit(metadata.durationUnit);
    const duration = normalizeDuration(metadata.duration, durationUnit);
    const matchId = typeof metadata.matchId === 'string' && metadata.matchId.trim()
      ? metadata.matchId.trim()
      : null;
    const store = getMatchStore(paths);
    const matchExists = matchId ? store.matches.some((match) => match.id === matchId) : false;

    return {
      matchId: matchExists ? matchId : null,
      visible: Boolean(metadata.visible) && matchExists,
      duration,
      durationUnit,
      shownAt: Number.isFinite(Number(metadata.shownAt)) ? Number(metadata.shownAt) : null,
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultNextGameState();
  }
}

function writeNextGameState(paths: AppPaths, state: Omit<NextGameState, 'mtime'>): NextGameState {
  ensureRuntimeDirs(paths);
  const metadata = {
    matchId: state.matchId,
    visible: state.visible,
    duration: state.duration,
    durationUnit: state.durationUnit,
    shownAt: state.shownAt,
  };
  fs.writeFileSync(paths.nextgameFile, JSON.stringify(metadata, null, 2), 'utf-8');
  return getNextGameState(paths);
}

/** 构造带比赛记录与头像的完整载荷（供页面 / 后台 / 悬浮窗消费） */
export function getNextGamePayload(paths: AppPaths): NextGamePayload {
  const state = getNextGameState(paths);
  let match: MatchRecord | null = null;
  let avatars: AvatarCollectionState = { left: { side: 'left', exists: false }, right: { side: 'right', exists: false } };

  if (state.matchId) {
    const store = getMatchStore(paths);
    match = store.matches.find((item) => item.id === state.matchId) ?? null;
    avatars = resolveMatchAvatars(paths, match);
  }

  return { state, match, avatars };
}

export function saveNextGameState(paths: AppPaths, payload: unknown): NextGamePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('nextgame payload must be an object');
  }

  const raw = payload as Record<string, unknown>;
  const current = getNextGameState(paths);
  const durationUnit = normalizeDurationUnit(
    raw.durationUnit === undefined ? current.durationUnit : raw.durationUnit,
  );
  const duration = normalizeDuration(
    raw.duration === undefined ? current.duration : raw.duration,
    durationUnit,
  );

  const nextMatchId = raw.matchId === undefined
    ? current.matchId
    : (typeof raw.matchId === 'string' && raw.matchId.trim() ? raw.matchId.trim() : null);
  const matchExists = nextMatchId
    ? getMatchStore(paths).matches.some((match) => match.id === nextMatchId)
    : false;
  const effectiveMatchId = matchExists ? nextMatchId : null;

  const visible = raw.visible === undefined ? current.visible : Boolean(raw.visible);

  writeNextGameState(paths, {
    matchId: effectiveMatchId,
    visible,
    duration,
    durationUnit,
    shownAt: visible ? Date.now() : null,
  });

  return getNextGamePayload(paths);
}

/** 显示下一局比赛：可携带新的 matchId / 停留时长，重置展示时间戳 */
export function showNextGame(paths: AppPaths, payload: unknown): NextGamePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('nextgame payload must be an object');
  }
  const raw = payload as Record<string, unknown>;
  const current = getNextGameState(paths);
  const durationUnit = normalizeDurationUnit(
    raw.durationUnit === undefined ? current.durationUnit : raw.durationUnit,
  );
  const duration = normalizeDuration(
    raw.duration === undefined ? current.duration : raw.duration,
    durationUnit,
  );
  const nextMatchId = raw.matchId === undefined
    ? current.matchId
    : (typeof raw.matchId === 'string' && raw.matchId.trim() ? raw.matchId.trim() : null);
  const matchExists = nextMatchId
    ? getMatchStore(paths).matches.some((match) => match.id === nextMatchId)
    : false;
  const effectiveMatchId = matchExists ? nextMatchId : null;

  writeNextGameState(paths, {
    matchId: effectiveMatchId,
    visible: true,
    duration,
    durationUnit,
    shownAt: Date.now(),
  });

  return getNextGamePayload(paths);
}

/** 关闭下一局比赛展示 */
export function hideNextGame(paths: AppPaths): NextGamePayload {
  const current = getNextGameState(paths);
  writeNextGameState(paths, {
    ...current,
    visible: false,
    shownAt: null,
  });
  return getNextGamePayload(paths);
}
