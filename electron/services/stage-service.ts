import fs from 'node:fs';

import {
  DEFAULT_PAGE10_DURATION,
  DEFAULT_PAGE10_DURATION_UNIT,
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

function normalizePage5Player(value: unknown): string {
  return String(value ?? '').trim().slice(0, 40);
}

function normalizePage5Tag(value: unknown): string {
  return String(value ?? '').trim().slice(0, 40);
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

/** 胜者结算画面（page10）停留时长单位：秒 / 分钟 */
function normalizePage10DurationUnit(value: unknown): NextGameDurationUnit {
  return value === 'minutes' ? 'minutes' : DEFAULT_PAGE10_DURATION_UNIT as NextGameDurationUnit;
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
    page3SpriteSource: DEFAULT_PAGE3_SPRITE_SOURCE,
    page3RankVisible: DEFAULT_PAGE3_RANK_VISIBLE,
    page3TeamVisible: DEFAULT_PAGE3_TEAM_VISIBLE,
    page3RedLightMode: DEFAULT_PAGE3_RED_LIGHT_MODE,
    page3RedLightInstant: DEFAULT_PAGE3_RED_LIGHT_INSTANT,
    page11RankVisible: DEFAULT_PAGE11_RANK_VISIBLE,
    page5Player: '',
    page5Tag: '',
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
      page3SpriteSource: normalizePage3SpriteSource(metadata.page3SpriteSource),
      page3RankVisible: normalizePage3RankVisible(metadata.page3RankVisible),
      page3TeamVisible: normalizePage3TeamVisible(metadata.page3TeamVisible),
      page3RedLightMode: normalizePage3RedLightMode(metadata.page3RedLightMode),
      page3RedLightInstant: normalizePage3RedLightInstant(metadata.page3RedLightInstant),
      page11RankVisible: normalizePage11RankVisible(metadata.page11RankVisible),
      page5Player: normalizePage5Player(metadata.page5Player),
      page5Tag: normalizePage5Tag(metadata.page5Tag),
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
    page3SpriteSource: normalizePage3SpriteSource(raw.page3SpriteSource ?? current.page3SpriteSource),
    page3RankVisible: normalizePage3RankVisible(raw.page3RankVisible ?? current.page3RankVisible),
    page3TeamVisible: normalizePage3TeamVisible(raw.page3TeamVisible ?? current.page3TeamVisible),
    page3RedLightMode: normalizePage3RedLightMode(raw.page3RedLightMode ?? current.page3RedLightMode),
    page3RedLightInstant: normalizePage3RedLightInstant(raw.page3RedLightInstant ?? current.page3RedLightInstant),
    page11RankVisible: normalizePage11RankVisible(raw.page11RankVisible ?? current.page11RankVisible),
    page5Player: normalizePage5Player(raw.page5Player),
    page5Tag: normalizePage5Tag(raw.page5Tag),
    page10Duration: normalizePage10Duration(
      raw.page10Duration === undefined ? current.page10Duration : raw.page10Duration,
      page10DurationUnit,
    ),
    page10DurationUnit,
  };

  fs.writeFileSync(paths.stageFile, JSON.stringify(metadata, null, 2), 'utf-8');
  return getStageState(paths);
}
