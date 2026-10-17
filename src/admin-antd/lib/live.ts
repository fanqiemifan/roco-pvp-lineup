import type { SlotState } from '../../../shared/types';
import type { LiveConfigPayload, PanelEditorState, PanelSide } from '../types';
import { cleanSpriteName } from './format';
import { getSlotName } from './sprite';

/** 监听轮询间隔（毫秒）：外部计分工具写文件的节奏远慢于 1 秒，够快又不费资源 */
export const LIVE_WATCH_POLL_MS = 1000;
/** 心跳超过这个时长没更新 → 视为轮询停滞（界面标橙，避免「看着在监听其实卡死」） */
export const LIVE_WATCH_STALL_MS = 5000;
/** 本地记忆键：上次成功监听的文件路径（跨会话保留，未监听时提供「恢复监听」） */
export const LIVE_WATCH_STORAGE_KEY = 'roco.live-watch-path';

/**
 * 监听状态快照：App 持有真实状态，LiveWatchCard 只读展示（时间戳均为 Date.now() 毫秒）。
 *
 * 为什么要有它：以前界面只显示「监听中 / 未监听」两个词，选完文件后到底读没读、
 * 有没有真的在轮询、最近一次同步是什么时候都看不出来（而且轮询曾因闭包过期从未生效）。
 */
export interface LiveWatchSnapshot {
  /** 本次监听开始时间 */
  startedAt: number | null;
  /** 最近一次成功把文件内容应用到面板的时间（读到内容但无槽位变化也算） */
  lastAppliedAt: number | null;
  /** 最近一次应用改动的槽位数（0 = 读到文件但内容无变化） */
  lastAppliedCount: number | null;
  /** 最近一次把面板回写进文件的时间 */
  lastWriteAt: number | null;
  /** 最近一次读取失败原因（读取成功后清空） */
  error: string | null;
  errorAt: number | null;
}

export function createLiveWatchSnapshot(): LiveWatchSnapshot {
  return {
    startedAt: null,
    lastAppliedAt: null,
    lastAppliedCount: null,
    lastWriteAt: null,
    error: null,
    errorAt: null,
  };
}

/** 状态标签：监听中 / 正在连接 / 监听停滞（心跳超时）/ 监听异常（读取失败仍在重试）/ 未监听 */
export interface LiveWatchBadge {
  color: 'green' | 'orange' | 'red' | 'default' | 'processing';
  text: string;
  /** 轮询心跳超时（标签为「监听停滞」时为 true，界面据此把相对时间标红） */
  stalled: boolean;
}

export function getLiveWatchBadge(
  enabled: boolean,
  hasError: boolean,
  heartbeatAt: number,
  now: number,
): LiveWatchBadge {
  if (!enabled) {
    return { color: 'default', text: '未监听', stalled: false };
  }
  if (hasError) {
    return { color: 'red', text: '监听异常', stalled: false };
  }
  if (!heartbeatAt) {
    return { color: 'processing', text: '正在连接', stalled: false };
  }
  if (now - heartbeatAt > LIVE_WATCH_STALL_MS) {
    return { color: 'orange', text: '监听停滞', stalled: true };
  }
  return { color: 'green', text: '监听中', stalled: false };
}

/** 时刻（HH:mm:ss）；空值 → `--` */
export function formatWatchClock(at: number | null): string {
  if (!at) {
    return '--';
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 相对时间（刚刚 / N 秒前 / N 分 M 秒前 / N 小时 M 分前）；未来时间与空值按「刚刚」/`--` 处理 */
export function formatWatchRelative(at: number | null, now: number): string {
  if (!at) {
    return '--';
  }
  const diff = Math.max(0, now - at);
  if (diff < 1000) {
    return '刚刚';
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return `${seconds} 秒前`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} 分 ${seconds % 60} 秒前`;
  }
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分前`;
}

/** 已监听时长（mm:ss / h:mm:ss） */
export function formatWatchDuration(startedAt: number | null, now: number): string {
  if (!startedAt) {
    return '--';
  }
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 最近一次同步结果文案（null = 还没读到过文件改动） */
export function describeWatchApply(count: number | null): string {
  if (count === null) {
    return '尚未从文件读到改动';
  }
  return count > 0 ? `已更新 ${count} 个槽位` : '读到文件，内容无变化';
}

/**
 * 把 Electron IPC 包裹过的文件错误压成一行可读文案：
 * `Error invoking remote method 'roco:read-text-file': Error: ENOENT ...` → `ENOENT ...`
 */
export function formatWatchError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
  return cleaned || '监听文件读取失败';
}

/**
 * 本地存储的最小结构。故意不用 DOM 的 `Storage` 类型：
 * lib 会被 tests/admin-antd 的 node 环境测试导入，而测试工程的 tsconfig 不带 DOM lib。
 */
interface LiveWatchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getLiveWatchStorage(): LiveWatchStorage | null {
  try {
    return (globalThis as { localStorage?: LiveWatchStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** 读取上次成功监听的文件路径；没有记录或存储不可用 → 空串 */
export function readStoredLiveWatchPath(): string {
  const storage = getLiveWatchStorage();
  if (!storage) {
    return '';
  }
  try {
    return storage.getItem(LIVE_WATCH_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 记录 / 清除上次监听的文件路径（传空串即清除）；存储不可用时静默降级 */
export function writeStoredLiveWatchPath(filePath: string | null): void {
  const storage = getLiveWatchStorage();
  if (!storage) {
    return;
  }
  try {
    if (filePath) {
      storage.setItem(LIVE_WATCH_STORAGE_KEY, filePath);
    } else {
      storage.removeItem(LIVE_WATCH_STORAGE_KEY);
    }
  } catch {
    // 配额 / 隐私模式：不记忆即可，不影响监听本身
  }
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getHealthLevel(slot: SlotState | null | undefined): number {
  if (!slot || !slot.healthEnabled || typeof slot.healthPercent !== 'number') {
    return 100;
  }
  return clampNumber(slot.healthPercent, 0, 100);
}

export function getEnergyLevel(slot: SlotState | null | undefined): number {
  if (!slot || typeof slot.energyValue !== 'number') {
    return 10;
  }
  return clampNumber(Math.round(slot.energyValue), 0, 10);
}

export function buildLiveConfigPayload(panels: Record<PanelSide, PanelEditorState>): LiveConfigPayload {
  const mapSlot = (slot: SlotState) => ({
    name: getSlotName(slot),
    HP: clampNumber(Math.round(Number(slot.healthPercent) || 0), 0, 100),
    value: clampNumber(Math.round(Number(slot.energyValue) || 0), 0, 10),
  });

  return {
    left: panels.left.selected.filter((slot) => slot.sprite).map(mapSlot),
    right: panels.right.selected.filter((slot) => slot.sprite).map(mapSlot),
  };
}

export function stringifyLiveConfig(panels: Record<PanelSide, PanelEditorState>): string {
  return JSON.stringify(buildLiveConfigPayload(panels), null, 2);
}

export function extractLiveConfigPanel(payload: Record<string, unknown>, panel: PanelSide) {
  const direct = payload[panel];
  if (Array.isArray(direct)) {
    return direct;
  }
  if (direct && typeof direct === 'object' && Array.isArray((direct as { selected?: unknown[] }).selected)) {
    return (direct as { selected: unknown[] }).selected;
  }
  const panels = payload.panels;
  if (panels && typeof panels === 'object') {
    const nested = (panels as Record<string, unknown>)[panel];
    if (Array.isArray(nested)) {
      return nested;
    }
  }
  return null;
}

export function readNumberField(item: Record<string, unknown>, names: string[], min: number, max: number) {
  for (const name of names) {
    const value = item[name];
    if (value !== undefined && value !== null && value !== '') {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        return clampNumber(Math.round(numeric), min, max);
      }
    }
  }
  return null;
}

export function findConfigTargetIndex(
  panel: PanelSide,
  item: Record<string, unknown>,
  fallbackIndex: number,
  usedIndexes: Set<number>,
  panels: Record<PanelSide, PanelEditorState>,
) {
  const expectedName = cleanSpriteName(typeof item.name === 'string' ? item.name : '');
  if (expectedName) {
    const matchIndex = panels[panel].selected.findIndex((slot, index) => {
      return !usedIndexes.has(index) && getSlotName(slot) === expectedName;
    });
    if (matchIndex >= 0) {
      return matchIndex;
    }
  }
  return fallbackIndex;
}
