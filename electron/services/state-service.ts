import fs from 'node:fs';
import {
  DEFAULT_BEST_OF,
  DEFAULT_ENERGY_VALUE,
  DEFAULT_EVENT_TITLE,
  DEFAULT_HEALTH_PERCENT,
  DEFAULT_OPACITY,
  DEFAULT_SATURATION,
  MAX_SELECTION_COUNT,
  RANK_TEXT_MAX_LENGTH,
  SUPPORTED_BEST_OF,
} from '../../shared/constants.js';
import type { PanelState, ScoreboardState, SlotState, SpriteRecord } from '../../shared/types.js';
import { spriteLookup } from './sprite-service.js';
import type { AppPaths } from './path-service.js';
import { ensureRuntimeDirs } from './image-service.js';

function normalizeOpacity(value: unknown): number {
  const opacity = Number(value);
  if (Number.isNaN(opacity)) return DEFAULT_OPACITY;
  return Math.min(1, Math.max(0, opacity));
}

function normalizeSaturation(value: unknown): number {
  const saturation = Number(value);
  if (Number.isNaN(saturation)) return DEFAULT_SATURATION;
  return Math.min(3, Math.max(0, saturation));
}

function normalizeHealthPercent(value: unknown): number {
  const health = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(health)) return DEFAULT_HEALTH_PERCENT;
  return Math.min(100, Math.max(0, health));
}

function normalizeEnergyValue(value: unknown): number {
  const energy = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(energy)) return DEFAULT_ENERGY_VALUE;
  return Math.min(10, Math.max(0, energy));
}

function normalizeScoreboardText(value: unknown, maxLength = 32): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeScoreboardScore(value: unknown, maxLength = 4): string {
  const text = String(value ?? '').trim();
  return (text || '0').slice(0, maxLength);
}

/** 排位排名：只保留数字，空字符串 = 未输入 */
export function normalizeRankValue(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, RANK_TEXT_MAX_LENGTH);
}

function normalizeBestOf(value: unknown): number {
  const bestOf = Number.parseInt(String(value ?? ''), 10);
  return SUPPORTED_BEST_OF.has(bestOf) ? bestOf : DEFAULT_BEST_OF;
}

function normalizeFontSize(value: unknown, defaultValue = 64, minimum = 12, maximum = 160): number {
  const size = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(size)) return defaultValue;
  return Math.min(maximum, Math.max(minimum, size));
}

function normalizePage2LineupDisplayMode(value: unknown): 'default' | 'avatar-only' {
  return value === 'default' ? 'default' : 'avatar-only';
}

function normalizeBool(value: unknown, defaultValue = true): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
  }
  return defaultValue;
}

function defaultSlot(index: number): SlotState {
  return {
    slot: index,
    sprite: null,
    opacityEnabled: false,
    opacity: DEFAULT_OPACITY,
    effectiveOpacity: 1,
    saturation: DEFAULT_SATURATION,
    healthEnabled: true,
    healthPercent: DEFAULT_HEALTH_PERCENT,
    energyValue: DEFAULT_ENERGY_VALUE,
  };
}

function defaultPanelState(position: 'left' | 'right'): PanelState {
  return {
    position,
    count: 0,
    selected: Array.from({ length: MAX_SELECTION_COUNT }, (_, index) => defaultSlot(index)),
    mtime: null,
  };
}

function serializeSlotState(slot: SlotState) {
  return {
    slot: slot.slot,
    sprite: slot.sprite,
    opacityEnabled: slot.opacityEnabled,
    opacity: slot.opacity,
    saturation: slot.saturation,
    healthEnabled: slot.healthEnabled,
    healthPercent: slot.healthPercent,
    energyValue: slot.energyValue,
  };
}

function parseSlotStateInput(
  paths: AppPaths,
  index: number,
  item: unknown,
  lookup?: Map<string, SpriteRecord>,
): SlotState {
  const slot = defaultSlot(index);
  if (item === null || item === undefined) {
    return slot;
  }
  if (!item || typeof item !== 'object') {
    throw new Error('slot must be an object or null');
  }

  const spriteLookupMap = lookup ?? spriteLookup(paths);
  const raw = item as Record<string, unknown>;
  const rawSprite = raw.sprite;
  const petId =
    rawSprite && typeof rawSprite === 'object' && typeof (rawSprite as Record<string, unknown>).id === 'string'
      ? (rawSprite as Record<string, unknown>).id
      : rawSprite;

  slot.opacityEnabled = Boolean(raw.opacityEnabled);
  slot.opacity = normalizeOpacity(raw.opacity);
  slot.saturation = normalizeSaturation(raw.saturation);
  slot.healthEnabled =
    typeof raw.healthEnabled === 'boolean' ? raw.healthEnabled : Boolean(raw.protectionEnabled);
  slot.healthPercent = normalizeHealthPercent(raw.healthPercent ?? raw.protectionPercent);
  slot.energyValue = normalizeEnergyValue(raw.energyValue);

  if (petId !== null && petId !== undefined) {
    if (typeof petId !== 'string') {
      throw new Error('sprite id must be a string or null');
    }
    const normalizedId = petId.trim();
    const sprite = spriteLookupMap.get(normalizedId);
    if (!sprite) {
      throw new Error(`Sprite not found: ${normalizedId}`);
    }
    slot.sprite = sprite;
  }

  slot.effectiveOpacity = slot.opacityEnabled ? slot.opacity : 1;
  return slot;
}

function defaultScoreboardState(): ScoreboardState {
  return {
    leftName: '',
    leftScore: '0',
    leftRank: '',
    rightName: '',
    rightScore: '0',
    rightRank: '',
    bestOf: DEFAULT_BEST_OF,
    scoreboardEnabled: true,
    eventTitle: DEFAULT_EVENT_TITLE,
    eventTitleEnabled: true,
    page2LineupDisplayMode: 'avatar-only',
    page5Title: '',
    page6Title: '',
    nameFontSize: 64,
    scoreFontSize: 64,
    mtime: null,
  };
}

function hydrateSelected(paths: AppPaths, rawSelected: unknown[]): SlotState[] {
  const lookup = spriteLookup(paths);
  const hydrated: SlotState[] = [];

  rawSelected.slice(0, MAX_SELECTION_COUNT).forEach((item, index) => {
    const slot = defaultSlot(index);

    if (!item || typeof item !== 'object') {
      hydrated.push(slot);
      return;
    }

    const raw = item as Record<string, unknown>;
    const rawSprite = raw.sprite;
    const petId =
      rawSprite && typeof rawSprite === 'object' && typeof (rawSprite as Record<string, unknown>).id === 'string'
        ? (rawSprite as Record<string, unknown>).id
        : rawSprite;

    slot.opacityEnabled = Boolean(raw.opacityEnabled);
    slot.opacity = normalizeOpacity(raw.opacity);
    slot.saturation = normalizeSaturation(raw.saturation);
    slot.healthEnabled =
      typeof raw.healthEnabled === 'boolean'
        ? raw.healthEnabled
        : typeof raw.protectionEnabled === 'boolean'
          ? raw.protectionEnabled
          : !slot.opacityEnabled;
    slot.healthPercent = normalizeHealthPercent(raw.healthPercent ?? raw.protectionPercent);
    slot.energyValue = normalizeEnergyValue(raw.energyValue);

    if (typeof petId === 'string') {
      slot.sprite = lookup.get(petId.trim()) ?? null;
    }

    slot.effectiveOpacity = slot.opacityEnabled ? slot.opacity : 1;
    hydrated.push(slot);
  });

  while (hydrated.length < MAX_SELECTION_COUNT) {
    hydrated.push(defaultSlot(hydrated.length));
  }

  return hydrated;
}

export function getPanelState(paths: AppPaths, position: 'left' | 'right'): PanelState {
  const state = defaultPanelState(position);
  const panelPath = paths.panelStatePath(position);

  if (!fs.existsSync(panelPath)) {
    return state;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(panelPath, 'utf-8')) as { selected?: unknown[] };
    const selected = hydrateSelected(paths, Array.isArray(metadata.selected) ? metadata.selected : []);
    const stat = fs.statSync(panelPath);

    return {
      position,
      count: selected.filter((item) => item.sprite).length,
      selected,
      mtime: stat.mtimeMs,
    };
  } catch {
    return state;
  }
}

export function getScoreboardState(paths: AppPaths): ScoreboardState {
  const state = defaultScoreboardState();
  if (!fs.existsSync(paths.scoreboardFile)) {
    return state;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.scoreboardFile, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.scoreboardFile);

    return {
      leftName: normalizeScoreboardText(metadata.leftName),
      leftScore: normalizeScoreboardScore(metadata.leftScore),
      leftRank: normalizeRankValue(metadata.leftRank),
      rightName: normalizeScoreboardText(metadata.rightName),
      rightScore: normalizeScoreboardScore(metadata.rightScore),
      rightRank: normalizeRankValue(metadata.rightRank),
      bestOf: normalizeBestOf(metadata.bestOf),
      scoreboardEnabled: normalizeBool(metadata.scoreboardEnabled, true),
      eventTitle: normalizeScoreboardText(metadata.eventTitle ?? DEFAULT_EVENT_TITLE, 40),
      eventTitleEnabled: normalizeBool(metadata.eventTitleEnabled, true),
      page2LineupDisplayMode: normalizePage2LineupDisplayMode(metadata.page2LineupDisplayMode),
      page5Title: normalizeScoreboardText(metadata.page5Title, 40),
      page6Title: normalizeScoreboardText(metadata.page6Title, 40),
      nameFontSize: normalizeFontSize(metadata.nameFontSize, 64),
      scoreFontSize: normalizeFontSize(metadata.scoreFontSize, 64),
      mtime: stat.mtimeMs,
    };
  } catch {
    return state;
  }
}

export function saveScoreboardState(paths: AppPaths, payload: unknown): ScoreboardState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('scoreboard payload must be an object');
  }

  const raw = payload as Record<string, unknown>;
  ensureRuntimeDirs(paths);
  // 排名来自赛事数据同步，载荷未携带时保留现值，避免其他设置保存时被清空
  const current = getScoreboardState(paths);

  const metadata = {
    leftName: normalizeScoreboardText(raw.leftName),
    leftScore: normalizeScoreboardScore(raw.leftScore),
    leftRank: normalizeRankValue(raw.leftRank === undefined ? current.leftRank : raw.leftRank),
    rightName: normalizeScoreboardText(raw.rightName),
    rightScore: normalizeScoreboardScore(raw.rightScore),
    rightRank: normalizeRankValue(raw.rightRank === undefined ? current.rightRank : raw.rightRank),
    bestOf: normalizeBestOf(raw.bestOf),
    scoreboardEnabled: normalizeBool(raw.scoreboardEnabled, true),
    eventTitle: normalizeScoreboardText(raw.eventTitle ?? DEFAULT_EVENT_TITLE, 40),
    eventTitleEnabled: normalizeBool(raw.eventTitleEnabled, true),
    page2LineupDisplayMode: normalizePage2LineupDisplayMode(raw.page2LineupDisplayMode),
    page5Title: normalizeScoreboardText(raw.page5Title, 40),
    page6Title: normalizeScoreboardText(raw.page6Title, 40),
    nameFontSize: normalizeFontSize(raw.nameFontSize, 64),
    scoreFontSize: normalizeFontSize(raw.scoreFontSize, 64),
  };

  fs.writeFileSync(paths.scoreboardFile, JSON.stringify(metadata, null, 2), 'utf-8');
  return getScoreboardState(paths);
}

export function saveScoreboardBestOf(paths: AppPaths, payload: unknown): ScoreboardState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('best-of payload must be an object');
  }

  const current = getScoreboardState(paths);
  const raw = payload as Record<string, unknown>;
  return saveScoreboardState(paths, { ...current, bestOf: normalizeBestOf(raw.bestOf) });
}

export function savePanelState(paths: AppPaths, position: 'left' | 'right', selectedSlots: unknown): PanelState {
  if (!Array.isArray(selectedSlots)) {
    throw new Error('selected must be a list');
  }
  if (selectedSlots.length > MAX_SELECTION_COUNT) {
    throw new Error('Too many slots provided');
  }

  ensureRuntimeDirs(paths);
  const selected: SlotState[] = [];
  // 一次请求只构建一次精灵查找表（进程内另有 mtime 缓存兜底）
  const lookup = spriteLookup(paths);

  selectedSlots.slice(0, MAX_SELECTION_COUNT).forEach((item, index) => {
    selected.push(parseSlotStateInput(paths, index, item, lookup));
  });

  while (selected.length < MAX_SELECTION_COUNT) {
    selected.push(defaultSlot(selected.length));
  }

  const metadata = {
    position,
    selected: selected.map(serializeSlotState),
  };

  fs.writeFileSync(paths.panelStatePath(position), JSON.stringify(metadata, null, 2), 'utf-8');
  return getPanelState(paths, position);
}

export function savePanelSlotState(
  paths: AppPaths,
  position: 'left' | 'right',
  slotIndex: number,
  slotData: unknown,
): PanelState {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= MAX_SELECTION_COUNT) {
    throw new Error('invalid slot index');
  }

  ensureRuntimeDirs(paths);
  const current = getPanelState(paths, position);
  const selected = current.selected.slice(0, MAX_SELECTION_COUNT);
  while (selected.length < MAX_SELECTION_COUNT) {
    selected.push(defaultSlot(selected.length));
  }

  selected[slotIndex] = parseSlotStateInput(paths, slotIndex, slotData);

  const metadata = {
    position,
    selected: selected.map(serializeSlotState),
  };

  fs.writeFileSync(paths.panelStatePath(position), JSON.stringify(metadata, null, 2), 'utf-8');
  return getPanelState(paths, position);
}

export function clearPanelState(paths: AppPaths, position: 'left' | 'right'): void {
  const panelPath = paths.panelStatePath(position);
  if (fs.existsSync(panelPath)) {
    fs.unlinkSync(panelPath);
  }
}
