import fs from 'node:fs';

import {
  DEFAULT_PAGE10_DURATION,
  DEFAULT_PAGE10_DURATION_UNIT,
  DEFAULT_PAGE7_SWITCH_SECONDS,
  PAGE7_SWITCH_MAX_SECONDS,
  PAGE7_SWITCH_MIN_SECONDS,
  DEFAULT_PAGE11_RANK_VISIBLE,
  DEFAULT_STAGE_PAGE,
  DEFAULT_STAGE_TRANSITION,
  DEFAULT_PAGE3_RANK_VISIBLE,
  DEFAULT_PAGE3_RED_LIGHT_INSTANT,
  DEFAULT_PAGE3_RED_LIGHT_MODE,
  DEFAULT_PAGE3_SPRITE_SOURCE,
  DEFAULT_PAGE3_TEAM_VISIBLE,
  SUPPORTED_PAGE3_RED_LIGHT_MODES,
  SUPPORTED_PAGE3_SPRITE_SOURCES,
  SUPPORTED_STAGE_PAGES,
  SUPPORTED_STAGE_TRANSITIONS,
  TOURNAMENT_ID_REGEX,
} from '../../shared/constants.js';
import type { NextGameDurationUnit, Page3RedLightMode, Page3SpriteSource, StageConfig, StagePageKey, StageTransitionType } from '../../shared/types.js';
import { ensureRuntimeDirs } from './image-service.js';
import type { AppPaths } from './path-service.js';

function normalizeStagePage(value: unknown): StagePageKey {
  if (typeof value === 'string' && SUPPORTED_STAGE_PAGES.has(value)) {
    return value as StagePageKey;
  }
  return DEFAULT_STAGE_PAGE as StagePageKey;
}

function normalizeStageTransition(value: unknown): StageTransitionType {
  if (typeof value === 'string' && SUPPORTED_STAGE_TRANSITIONS.has(value)) {
    return value as StageTransitionType;
  }
  return DEFAULT_STAGE_TRANSITION as StageTransitionType;
}

/** 页面1-3：阵容镜像反转（仅展示层开关，默认关闭；非布尔值一律归一为 false） */
function normalizeMirrorSides(value: unknown): boolean {
  return value === true;
}

/** 阶段过滤（页面5/15 共用）：空 = 全部阶段；非空仅接受 stages 下标的十进制字符串（'01' 归一为 '1'），其余丢弃 */
function normalizePageStage(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    return '';
  }
  return String(Number(raw));
}

/** 系列赛过滤 id（页面5/15 共用，空 = 全部；仅接受 T 前缀白名单形态，非法值直接丢弃） */
function normalizePageTournamentId(value: unknown): string {
  const id = String(value ?? '').trim();
  return id && TOURNAMENT_ID_REGEX.test(id) ? id : '';
}

/** 推流页面15：排序字段白名单（非法值一律回「使用次数」） */
function normalizePage15SortBy(value: unknown): 'picks' | 'games' | 'winRate' {
  return value === 'games' || value === 'winRate' ? value : 'picks';
}

/** 推流页面15：排序方向白名单（非法值回「降序」，与既有行为一致） */
function normalizePage15SortOrder(value: unknown): 'asc' | 'desc' {
  return value === 'asc' ? 'asc' : 'desc';
}

function normalizePage3SpriteSource(value: unknown): Page3SpriteSource {
  return typeof value === 'string' && SUPPORTED_PAGE3_SPRITE_SOURCES.has(value)
    ? value as Page3SpriteSource
    : DEFAULT_PAGE3_SPRITE_SOURCE;
}

function normalizePage3RankVisible(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_PAGE3_RANK_VISIBLE;
}

function normalizePage3TeamVisible(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_PAGE3_TEAM_VISIBLE;
}

function normalizePage3RedLightMode(value: unknown): Page3RedLightMode {
  return typeof value === 'string' && SUPPORTED_PAGE3_RED_LIGHT_MODES.has(value)
    ? value as Page3RedLightMode
    : DEFAULT_PAGE3_RED_LIGHT_MODE;
}

function normalizePage3RedLightInstant(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_PAGE3_RED_LIGHT_INSTANT;
}

function normalizePage11RankVisible(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_PAGE11_RANK_VISIBLE;
}

function normalizePage10DurationUnit(value: unknown): NextGameDurationUnit {
  return value === 'minutes' ? 'minutes' : DEFAULT_PAGE10_DURATION_UNIT as NextGameDurationUnit;
}

/**
 * 战绩详情（page7）整屏切换间隔（秒）：非法值回默认 10；夹在 [2, 600] ——
 * 下限要大于整屏过渡动画时长（700ms），上限 10 分钟（再长就不像"自动轮播"了）。
 */
function normalizePage7SwitchSeconds(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PAGE7_SWITCH_SECONDS;
  }
  return Math.min(PAGE7_SWITCH_MAX_SECONDS, Math.max(PAGE7_SWITCH_MIN_SECONDS, Math.round(numeric)));
}

/** 胜者结算画面（page10）停留时长：秒 1-3600，分钟 1-60 */
function normalizePage10Duration(value: unknown, unit: NextGameDurationUnit): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PAGE10_DURATION;
  }
  const max = unit === 'minutes' ? 60 : 3600;
  return Math.min(max, Math.max(1, Math.round(numeric)));
}

function defaultStageState(): StageConfig {
  return {
    page: DEFAULT_STAGE_PAGE as StagePageKey,
    transition: DEFAULT_STAGE_TRANSITION as StageTransitionType,
    mirrorSides: false,
    page3SpriteSource: DEFAULT_PAGE3_SPRITE_SOURCE,
    page3RankVisible: DEFAULT_PAGE3_RANK_VISIBLE,
    page3TeamVisible: DEFAULT_PAGE3_TEAM_VISIBLE,
    page3RedLightMode: DEFAULT_PAGE3_RED_LIGHT_MODE,
    page3RedLightInstant: DEFAULT_PAGE3_RED_LIGHT_INSTANT,
    page11RankVisible: DEFAULT_PAGE11_RANK_VISIBLE,
    page5Stage: '',
    page5TournamentId: '',
    page15Stage: '',
    page15TournamentId: '',
    page15SortBy: 'picks',
    page15SortOrder: 'desc',
    page7SwitchSeconds: DEFAULT_PAGE7_SWITCH_SECONDS,
    page10Duration: DEFAULT_PAGE10_DURATION,
    page10DurationUnit: DEFAULT_PAGE10_DURATION_UNIT as NextGameDurationUnit,
    mtime: null,
  };
}

export function getStageState(paths: AppPaths): StageConfig {
  if (!fs.existsSync(paths.stageFile)) {
    return defaultStageState();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.stageFile, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.stageFile);
    const page10DurationUnit = normalizePage10DurationUnit(metadata.page10DurationUnit);
    return {
      page: normalizeStagePage(metadata.page),
      transition: normalizeStageTransition(metadata.transition),
      mirrorSides: normalizeMirrorSides(metadata.mirrorSides),
      page3SpriteSource: normalizePage3SpriteSource(metadata.page3SpriteSource),
      page3RankVisible: normalizePage3RankVisible(metadata.page3RankVisible),
      page3TeamVisible: normalizePage3TeamVisible(metadata.page3TeamVisible),
      page3RedLightMode: normalizePage3RedLightMode(metadata.page3RedLightMode),
      page3RedLightInstant: normalizePage3RedLightInstant(metadata.page3RedLightInstant),
      page11RankVisible: normalizePage11RankVisible(metadata.page11RankVisible),
      page5Stage: normalizePageStage(metadata.page5Stage),
      page5TournamentId: normalizePageTournamentId(metadata.page5TournamentId),
      page15Stage: normalizePageStage(metadata.page15Stage),
      page15TournamentId: normalizePageTournamentId(metadata.page15TournamentId),
      page15SortBy: normalizePage15SortBy(metadata.page15SortBy),
      page15SortOrder: normalizePage15SortOrder(metadata.page15SortOrder),
      page7SwitchSeconds: normalizePage7SwitchSeconds(metadata.page7SwitchSeconds),
      page10Duration: normalizePage10Duration(metadata.page10Duration, page10DurationUnit),
      page10DurationUnit,
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultStageState();
  }
}

export function saveStageState(paths: AppPaths, payload: unknown): StageConfig {
  if (!payload || typeof payload !== 'object') {
    throw new Error('stage payload must be an object');
  }

  const raw = payload as Record<string, unknown>;
  ensureRuntimeDirs(paths);
  const current = getStageState(paths);

  const page10DurationUnit = normalizePage10DurationUnit(
    raw.page10DurationUnit === undefined ? current.page10DurationUnit : raw.page10DurationUnit,
  );

  const metadata = {
    page: normalizeStagePage(raw.page),
    transition: normalizeStageTransition(raw.transition ?? current.transition),
    mirrorSides: normalizeMirrorSides(raw.mirrorSides ?? current.mirrorSides),
    page3SpriteSource: normalizePage3SpriteSource(raw.page3SpriteSource ?? current.page3SpriteSource),
    page3RankVisible: normalizePage3RankVisible(raw.page3RankVisible ?? current.page3RankVisible),
    page3TeamVisible: normalizePage3TeamVisible(raw.page3TeamVisible ?? current.page3TeamVisible),
    page3RedLightMode: normalizePage3RedLightMode(raw.page3RedLightMode ?? current.page3RedLightMode),
    page3RedLightInstant: normalizePage3RedLightInstant(raw.page3RedLightInstant ?? current.page3RedLightInstant),
    page11RankVisible: normalizePage11RankVisible(raw.page11RankVisible ?? current.page11RankVisible),
    page5Stage: normalizePageStage(raw.page5Stage === undefined ? current.page5Stage : raw.page5Stage),
    page5TournamentId: normalizePageTournamentId(
      raw.page5TournamentId === undefined ? current.page5TournamentId : raw.page5TournamentId,
    ),
    // page15 三个字段带 current 兜底：切换画面等局部保存只传 page/transition，不得清空过滤与排序
    page15Stage: normalizePageStage(raw.page15Stage === undefined ? current.page15Stage : raw.page15Stage),
    page15TournamentId: normalizePageTournamentId(
      raw.page15TournamentId === undefined ? current.page15TournamentId : raw.page15TournamentId,
    ),
    page15SortBy: normalizePage15SortBy(raw.page15SortBy === undefined ? current.page15SortBy : raw.page15SortBy),
    page15SortOrder: normalizePage15SortOrder(
      raw.page15SortOrder === undefined ? current.page15SortOrder : raw.page15SortOrder,
    ),
    page7SwitchSeconds: normalizePage7SwitchSeconds(
      raw.page7SwitchSeconds === undefined ? current.page7SwitchSeconds : raw.page7SwitchSeconds,
    ),
    page10Duration: normalizePage10Duration(
      raw.page10Duration === undefined ? current.page10Duration : raw.page10Duration,
      page10DurationUnit,
    ),
    page10DurationUnit,
  };

  fs.writeFileSync(paths.stageFile, JSON.stringify(metadata, null, 2), 'utf-8');
  return getStageState(paths);
}
