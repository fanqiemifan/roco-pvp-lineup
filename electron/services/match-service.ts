import fs from 'node:fs';
import { DEFAULT_BEST_OF, MATCH_ID_REGEX, SUPPORTED_BEST_OF, TOURNAMENT_FORFEIT_TAG, TOURNAMENT_ID_REGEX } from '../../shared/constants.js';
import type {
  GameRecord,
  MatchRecord,
  MatchSlotSnapshot,
  MatchStoreState,
  SpriteRecord,
  SyncConflictMode,
  SyncImportDiffField,
} from '../../shared/types.js';
import type { AppPaths } from './path-service.js';
import { loadRuntimeConfig } from './config-service.js';
import { ensureRuntimeDirs } from './image-service.js';
import { spriteLookup } from './sprite-service.js';
import {
  clearPanelState,
  getPanelState,
  getScoreboardState,
  normalizeRankValue,
  saveScoreboardState,
} from './state-service.js';

const PLAYER_NAME_MAX_LENGTH = 32;
const TEAM_NAME_MAX_LENGTH = 40;
const MAX_GAME_SLOTS = 6;
const FLOW_HISTORY_LIMIT = 50;
const DELETE_HISTORY_LIMIT = 3;
// 撤销/重做快照保留期：7 天，过期在读取与写入时自动清理，避免 matches.json 无限膨胀
const FLOW_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 已落盘数据结构版本：命中当前版本时跳过「全量序列化比对」迁移检测
const MATCH_STORE_VERSION = 1;
// 长跑不重启时，缓存命中路径上的过期清理节流间隔
const STORE_CACHE_PRUNE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface MatchFlowSnapshot {
  matchId: string;
  bestOf: number;
  games: GameRecord[];
  status: MatchRecord['status'];
  leftScore: number;
  rightScore: number;
  winner: MatchRecord['winner'];
  completedAt: string | null;
  // 快照入栈时间（ISO），用于 7 天过期清理；旧数据缺少该字段时在迁移时补当前时间
  savedAt: string;
}

interface MatchFlowHistory {
  undoStack: MatchFlowSnapshot[];
  redoStack: MatchFlowSnapshot[];
}

interface DeletedMatchEntry {
  match: MatchRecord;
  index: number;
  flowHistory: MatchFlowHistory;
}

interface DeletedMatchBatch {
  entries: DeletedMatchEntry[];
  previousActiveMatchId: string | null;
}

interface MatchStoreFile {
  // 仅用于落盘迁移检测，不参与对外状态（toPublicStore 不透出）
  __version?: number;
  activeMatchId: string | null;
  matches: MatchRecord[];
  flowHistory: Record<string, MatchFlowHistory>;
  deletedHistory: DeletedMatchBatch[];
}

/**
 * matches.json 进程内缓存（按 AppPaths 实例隔离）：
 * 所有写操作都经本模块、单进程独占数据文件，因此文件 mtime 未变即可直接复用内存态，
 * 把每次读取代价从「读盘 + 全量规范化 + 全量序列化比对」降为一次 stat。
 */
interface MatchStoreCacheEntry {
  fileMtime: number | null;
  store: MatchStoreFile;
  mtime: number | null;
  lastPruneAt: number;
}

const matchStoreCache = new WeakMap<AppPaths, MatchStoreCacheEntry>();
let storeTmpCounter = 0;

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePlayerName(value: unknown): string {
  return String(value ?? '').trim().slice(0, PLAYER_NAME_MAX_LENGTH);
}

/** 战队名称：去除首尾空白，最长 40 字（空字符串 = 未填） */
function normalizeTeamName(value: unknown): string {
  return String(value ?? '').trim().slice(0, TEAM_NAME_MAX_LENGTH);
}

/** 战队 id：仅保留字母数字与 -_（空字符串 = 手动输入或未复用录入信息） */
function normalizeTeamId(value: unknown): string {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function normalizeBestOf(value: unknown): number {
  const bestOf = Number.parseInt(String(value ?? ''), 10);
  return SUPPORTED_BEST_OF.has(bestOf) ? bestOf : DEFAULT_BEST_OF;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * 系列赛关联透传字段：tournamentId 必须为 T 前缀白名单形态，nodeId 只允许安全字符，
 * stageIndex/waveIndex 必须为非负整数（waveIndex ≥1）；不合法即丢弃（普通比赛）。
 */
function normalizeTournamentRef(value: unknown): MatchRecord['tournamentRef'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const tournamentId = String(raw.tournamentId ?? '').trim();
  const nodeId = String(raw.nodeId ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const stageIndex = Number(raw.stageIndex);
  const waveIndex = Number(raw.waveIndex);

  if (!TOURNAMENT_ID_REGEX.test(tournamentId) || !nodeId) {
    return undefined;
  }
  if (!Number.isInteger(stageIndex) || stageIndex < 0) {
    return undefined;
  }
  if (!Number.isInteger(waveIndex) || waveIndex < 1) {
    return undefined;
  }

  return { tournamentId, nodeId, stageIndex, waveIndex };
}

function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

function createEmptySlotSnapshot(index: number): MatchSlotSnapshot {
  return {
    slot: index,
    pet_id: null,
    name: '',
    form: '',
    opacityEnabled: false,
    opacity: 0.5,
    saturation: 1,
    healthEnabled: true,
    healthPercent: 100,
    energyValue: 10,
  };
}

// 持久化的精灵主键统一存 pet_id（精灵 id）
function normalizeStoredPetId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value.trim();
}

function snapshotPetIdFromRecord(sprite: SpriteRecord | null | undefined): string | null {
  if (!sprite) {
    return null;
  }
  return String(sprite.id ?? '').trim() || null;
}

function sanitizeLineup(lineup: unknown): string[] {
  if (!Array.isArray(lineup)) {
    return [];
  }

  return lineup
    .map((item) => normalizeStoredPetId(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_GAME_SLOTS);
}

function sanitizeSlotSnapshots(slots: unknown, lookup?: Map<string, SpriteRecord>): MatchSlotSnapshot[] {
  const normalized = Array.from({ length: MAX_GAME_SLOTS }, (_, index) => createEmptySlotSnapshot(index));
  if (!Array.isArray(slots)) {
    return normalized;
  }

  slots.slice(0, MAX_GAME_SLOTS).forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const raw = item as Record<string, unknown>;
    const petId = normalizeStoredPetId(raw.pet_id);
    // name/form 为冗余快照字段：优先保留持久化值，精灵仍在索引中时以索引为准刷新
    const sprite = petId && lookup ? (lookup.get(petId) ?? null) : null;
    normalized[index] = {
      slot: index,
      pet_id: petId,
      name: sprite?.displayName?.trim() || (typeof raw.name === 'string' ? raw.name.trim() : ''),
      form: sprite?.petForm?.trim() || (typeof raw.form === 'string' ? raw.form.trim() : ''),
      opacityEnabled: Boolean(raw.opacityEnabled),
      opacity: Number.isFinite(Number(raw.opacity)) ? Number(raw.opacity) : 0.5,
      saturation: Number.isFinite(Number(raw.saturation)) ? Number(raw.saturation) : 1,
      healthEnabled: raw.healthEnabled !== false,
      healthPercent: Number.isFinite(Number(raw.healthPercent)) ? Number(raw.healthPercent) : 100,
      energyValue: Number.isFinite(Number(raw.energyValue)) ? Number(raw.energyValue) : 10,
    };
  });

  return normalized;
}

function lineupFromSlots(slots: MatchSlotSnapshot[]): string[] {
  return slots.map((slot) => slot.pet_id).filter((petId): petId is string => Boolean(petId));
}

function capturePanelSnapshot(paths: AppPaths, position: 'left' | 'right'): MatchSlotSnapshot[] {
  return getPanelState(paths, position).selected.slice(0, MAX_GAME_SLOTS).map((slot, index) => ({
    slot: index,
    pet_id: snapshotPetIdFromRecord(slot.sprite),
    name: slot.sprite?.displayName?.trim() ?? '',
    form: slot.sprite?.petForm?.trim() ?? '',
    opacityEnabled: Boolean(slot.opacityEnabled),
    opacity: Number(slot.opacity ?? 0.5),
    saturation: Number(slot.saturation ?? 1),
    healthEnabled: slot.healthEnabled !== false,
    healthPercent: Number(slot.healthPercent ?? 100),
    energyValue: Number(slot.energyValue ?? 10),
  }));
}

function createGameRecord(gameNumber: number, leftSlots: MatchSlotSnapshot[], rightSlots: MatchSlotSnapshot[]): GameRecord {
  return {
    gameNumber,
    leftLineup: lineupFromSlots(leftSlots),
    rightLineup: lineupFromSlots(rightSlots),
    leftSlots,
    rightSlots,
    winner: null,
    status: 'pending',
  };
}

function createEmptyGameRecord(gameNumber: number): GameRecord {
  return createGameRecord(gameNumber, sanitizeSlotSnapshots([]), sanitizeSlotSnapshots([]));
}

function summarizeSeries(games: GameRecord[], bestOf: number): {
  leftScore: number;
  rightScore: number;
  winner: MatchRecord['winner'];
} {
  const needed = winsNeeded(bestOf);
  let leftScore = 0;
  let rightScore = 0;

  for (const game of games) {
    if (game.status !== 'completed' || (game.winner !== 'left' && game.winner !== 'right')) {
      continue;
    }

    if (game.winner === 'left') {
      leftScore += 1;
    } else {
      rightScore += 1;
    }

    if (leftScore >= needed || rightScore >= needed) {
      return {
        leftScore,
        rightScore,
        winner: game.winner,
      };
    }
  }

  return {
    leftScore,
    rightScore,
    winner: null,
  };
}

function alignGamesToBestOf(games: GameRecord[], bestOf: number): GameRecord[] {
  const needed = winsNeeded(bestOf);
  const nextGames: GameRecord[] = [];
  let leftScore = 0;
  let rightScore = 0;
  let keptUnresolvedGame = false;

  for (const sourceGame of games) {
    if (leftScore >= needed || rightScore >= needed) {
      break;
    }

    const game = cloneValue(sourceGame);
    const isCompleted = game.status === 'completed' && (game.winner === 'left' || game.winner === 'right');
    if (isCompleted) {
      nextGames.push(game);
      if (game.winner === 'left') {
        leftScore += 1;
      } else {
        rightScore += 1;
      }
      continue;
    }

    if (!keptUnresolvedGame) {
      nextGames.push({
        ...game,
        winner: null,
        status: game.status === 'in_progress' ? 'in_progress' : 'pending',
      });
      keptUnresolvedGame = true;
    }
  }

  if (leftScore >= needed || rightScore >= needed) {
    return nextGames.filter((game) => game.status === 'completed' && (game.winner === 'left' || game.winner === 'right'));
  }

  if (!nextGames.length) {
    return [createEmptyGameRecord(1)];
  }

  if (!nextGames.some((game) => game.status !== 'completed')) {
    return [...nextGames, createEmptyGameRecord(nextGames.length + 1)];
  }

  return nextGames;
}

function getDatePrefix(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

interface ParsedMatchId {
  date: string;
  /** 机器码（解析端容忍小写，统一转大写；旧格式为空字符串） */
  machine: string;
  index: number;
}

function parseMatchId(matchId: string): ParsedMatchId | null {
  const idMatch = String(matchId ?? '').match(MATCH_ID_REGEX);
  if (!idMatch) {
    return null;
  }

  const index = Number.parseInt(idMatch[3], 10);
  if (!Number.isFinite(index)) {
    return null;
  }

  return { date: idMatch[1], machine: idMatch[2].toUpperCase(), index };
}

/** 簇键：同一日期 + 同一机器码的比赛共享一个序号序列（旧格式机器码为空，即 `20260928_`） */
function matchClusterKey(date: string, machine: string): string {
  return `${date}_${machine}`;
}

/** id 所属簇键；id 无法解析时回退 createdAt（或当天）日期 + 空机器码 */
function resolveMatchClusterKey(matchId: string, createdAt?: string): string {
  const parsed = parseMatchId(matchId);
  if (parsed) {
    return matchClusterKey(parsed.date, parsed.machine);
  }

  if (createdAt) {
    const createdDate = new Date(createdAt);
    if (!Number.isNaN(createdDate.getTime())) {
      return matchClusterKey(getDatePrefix(createdDate), '');
    }
  }

  return matchClusterKey(getDatePrefix(), '');
}

function resolveMatchNumericIndex(matchId: string): number | null {
  return parseMatchId(matchId)?.index ?? null;
}

function collectNextMatchIndexes(store: MatchStoreFile): Map<string, number> {
  const nextIndexByCluster = new Map<string, number>();

  const register = (match: MatchRecord) => {
    const clusterKey = resolveMatchClusterKey(match.id, match.createdAt);
    const numericIndex = resolveMatchNumericIndex(match.id);
    const nextValue = numericIndex ? numericIndex + 1 : 1;
    const currentValue = nextIndexByCluster.get(clusterKey) ?? 1;
    nextIndexByCluster.set(clusterKey, Math.max(currentValue, nextValue));
  };

  store.matches.forEach(register);
  store.deletedHistory.forEach((batch) => {
    batch.entries.forEach((entry) => register(entry.match));
  });

  return nextIndexByCluster;
}

function allocateUniqueMatchId(
  usedIds: Set<string>,
  nextIndexByCluster: Map<string, number>,
  clusterKey: string,
): string {
  let nextIndex = nextIndexByCluster.get(clusterKey) ?? 1;
  let candidate = `${clusterKey}${String(nextIndex).padStart(3, '0')}`;

  while (usedIds.has(candidate)) {
    nextIndex += 1;
    candidate = `${clusterKey}${String(nextIndex).padStart(3, '0')}`;
  }

  nextIndexByCluster.set(clusterKey, nextIndex + 1);
  usedIds.add(candidate);
  return candidate;
}

function computeMatchProgress(match: MatchRecord): MatchRecord {
  const games = alignGamesToBestOf(match.games, match.bestOf);
  const { leftScore, rightScore, winner } = summarizeSeries(games, match.bestOf);
  const nextStatus = winner
    ? 'completed'
    : games.some((game) => game.status === 'in_progress' || game.status === 'completed')
      ? 'in_progress'
      : 'pending';

  return {
    ...match,
    games,
    leftScore,
    rightScore,
    status: nextStatus,
    winner,
    completedAt: winner ? match.completedAt ?? new Date().toISOString() : null,
  };
}

function normalizeGameRecord(game: unknown, index: number, lookup?: Map<string, SpriteRecord>): GameRecord {
  if (!game || typeof game !== 'object') {
    return createEmptyGameRecord(index + 1);
  }

  const raw = game as Record<string, unknown>;
  const leftSlots = sanitizeSlotSnapshots(raw.leftSlots, lookup);
  const rightSlots = sanitizeSlotSnapshots(raw.rightSlots, lookup);
  const leftLineup = sanitizeLineup(raw.leftLineup);
  const rightLineup = sanitizeLineup(raw.rightLineup);
  const status =
    raw.status === 'in_progress' || raw.status === 'completed'
      ? raw.status
      : 'pending';

  return {
    gameNumber: Number.isFinite(Number(raw.gameNumber)) ? Number(raw.gameNumber) : index + 1,
    leftLineup: leftLineup.length ? leftLineup : lineupFromSlots(leftSlots),
    rightLineup: rightLineup.length ? rightLineup : lineupFromSlots(rightSlots),
    leftSlots,
    rightSlots,
    winner: raw.winner === 'left' || raw.winner === 'right' ? raw.winner : null,
    status,
  };
}

function normalizeMatchRecord(match: unknown, lookup?: Map<string, SpriteRecord>): MatchRecord | null {
  if (!match || typeof match !== 'object') {
    return null;
  }

  const raw = match as Record<string, unknown>;
  const id = String(raw.id || '').trim();
  // id 白名单：只接受 YYYYMMDD_[机器码]NNN 形态（match id 会被拼进头像目录，外部导入数据必须先过这里）
  if (!MATCH_ID_REGEX.test(id)) {
    return null;
  }

  const bestOf = normalizeBestOf(raw.bestOf);
  const games = Array.isArray(raw.games) ? raw.games.map((game, index) => normalizeGameRecord(game, index, lookup)) : [];
  const normalizedGames = games.length ? games : [createEmptyGameRecord(1)];

  return computeMatchProgress({
    id,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    status: raw.status === 'completed' || raw.status === 'in_progress' ? raw.status : 'pending',
    leftPlayer: normalizePlayerName(raw.leftPlayer),
    rightPlayer: normalizePlayerName(raw.rightPlayer),
    leftRank: normalizeRankValue(raw.leftRank),
    rightRank: normalizeRankValue(raw.rightRank),
    leftTeamId: normalizeTeamId(raw.leftTeamId),
    leftTeamName: normalizeTeamName(raw.leftTeamName),
    rightTeamId: normalizeTeamId(raw.rightTeamId),
    rightTeamName: normalizeTeamName(raw.rightTeamName),
    bestOf,
    games: normalizedGames,
    leftScore: Number(raw.leftScore) || 0,
    rightScore: Number(raw.rightScore) || 0,
    winner: raw.winner === 'left' || raw.winner === 'right' ? raw.winner : null,
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    tags: normalizeTags(raw.tags),
    tournamentRef: normalizeTournamentRef(raw.tournamentRef),
  });
}

function defaultStoreFile(): MatchStoreFile {
  return {
    __version: MATCH_STORE_VERSION,
    activeMatchId: null,
    matches: [],
    flowHistory: {},
    deletedHistory: [],
  };
}

function flowSnapshotFromMatch(match: MatchRecord): MatchFlowSnapshot {
  return {
    matchId: match.id,
    bestOf: match.bestOf,
    games: cloneValue(match.games),
    status: match.status,
    leftScore: match.leftScore,
    rightScore: match.rightScore,
    winner: match.winner,
    completedAt: match.completedAt,
    savedAt: new Date().toISOString(),
  };
}

function normalizeFlowSnapshot(
  snapshot: unknown,
  fallbackMatchId: string,
  lookup?: Map<string, SpriteRecord>,
  legacySavedAt?: string,
): MatchFlowSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const raw = snapshot as Record<string, unknown>;
  const matchId = typeof raw.matchId === 'string' && raw.matchId.trim()
    ? raw.matchId.trim()
    : fallbackMatchId;
  if (!matchId) {
    return null;
  }

  const bestOf = normalizeBestOf(raw.bestOf);
  const games = Array.isArray(raw.games)
    ? raw.games.map((game, index) => normalizeGameRecord(game, index, lookup))
    : [];
  const normalizedGames = games.length ? games : [createEmptyGameRecord(1)];
  const normalized = computeMatchProgress({
    id: matchId,
    createdAt: '',
    updatedAt: '',
    status: raw.status === 'completed' || raw.status === 'in_progress' ? raw.status : 'pending',
    leftPlayer: '',
    rightPlayer: '',
    leftRank: '',
    rightRank: '',
    leftTeamId: '',
    leftTeamName: '',
    rightTeamId: '',
    rightTeamName: '',
    bestOf,
    games: normalizedGames,
    leftScore: Number(raw.leftScore) || 0,
    rightScore: Number(raw.rightScore) || 0,
    winner: raw.winner === 'left' || raw.winner === 'right' ? raw.winner : null,
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    tags: normalizeTags(raw.tags),
  });

  return {
    matchId,
    bestOf: normalized.bestOf,
    games: cloneValue(normalized.games),
    status: normalized.status,
    leftScore: normalized.leftScore,
    rightScore: normalized.rightScore,
    winner: normalized.winner,
    completedAt: normalized.completedAt,
    // 旧版数据无 savedAt：迁移时补入参给定的时间戳，给予一次完整 7 天保留期
    savedAt: typeof raw.savedAt === 'string' && raw.savedAt.trim() ? raw.savedAt.trim() : (legacySavedAt ?? new Date().toISOString()),
  };
}

function normalizeFlowHistoryEntry(
  value: unknown,
  matchId: string,
  lookup?: Map<string, SpriteRecord>,
  legacySavedAt?: string,
): MatchFlowHistory {
  if (!value || typeof value !== 'object') {
    return { undoStack: [], redoStack: [] };
  }

  const raw = value as Record<string, unknown>;
  const normalizeStack = (stack: unknown): MatchFlowSnapshot[] => {
    if (!Array.isArray(stack)) {
      return [];
    }

    return stack
      .map((item) => normalizeFlowSnapshot(item, matchId, lookup, legacySavedAt))
      .filter((item): item is MatchFlowSnapshot => Boolean(item));
  };

  return {
    undoStack: normalizeStack(raw.undoStack),
    redoStack: normalizeStack(raw.redoStack),
  };
}

function normalizeFlowHistoryMap(
  value: unknown,
  lookup?: Map<string, SpriteRecord>,
  legacySavedAt?: string,
): Record<string, MatchFlowHistory> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const normalizedEntries = Object.entries(raw)
    .map(([matchId, history]) => [matchId, normalizeFlowHistoryEntry(history, matchId, lookup, legacySavedAt)] as const)
    .filter(([matchId]) => Boolean(matchId.trim()));

  return Object.fromEntries(normalizedEntries);
}

function normalizeDeletedHistory(
  value: unknown,
  lookup?: Map<string, SpriteRecord>,
  legacySavedAt?: string,
): DeletedMatchBatch[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const raw = item as Record<string, unknown>;
      const entries = Array.isArray(raw.entries)
        ? raw.entries.map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }

          const source = entry as Record<string, unknown>;
          const match = normalizeMatchRecord(source.match, lookup);
          if (!match) {
            return null;
          }

          return {
            match,
            index: Number.isFinite(Number(source.index)) ? Math.max(0, Number(source.index)) : 0,
            flowHistory: normalizeFlowHistoryEntry(source.flowHistory, match.id, lookup, legacySavedAt),
          } satisfies DeletedMatchEntry;
        }).filter((entry): entry is DeletedMatchEntry => Boolean(entry))
        : [];

      if (!entries.length) {
        return null;
      }

      return {
        entries,
        previousActiveMatchId: typeof raw.previousActiveMatchId === 'string' ? raw.previousActiveMatchId : null,
      } satisfies DeletedMatchBatch;
    })
    .filter((item): item is DeletedMatchBatch => Boolean(item))
    .slice(-DELETE_HISTORY_LIMIT);
}

function normalizeStoreIdentifiers(store: MatchStoreFile): MatchStoreFile {
  const usedIds = new Set<string>();
  const nextIndexByCluster = new Map<string, number>();
  const renamedIds = new Map<string, string>();

  const normalizeMatch = (match: MatchRecord): MatchRecord => {
    const clusterKey = resolveMatchClusterKey(match.id, match.createdAt);
    const desiredId = typeof match.id === 'string' ? match.id.trim() : '';
    const canReuseDesiredId = desiredId && !usedIds.has(desiredId);
    const nextId = canReuseDesiredId
      ? (() => {
        usedIds.add(desiredId);
        const numericIndex = resolveMatchNumericIndex(desiredId);
        const nextValue = numericIndex ? numericIndex + 1 : 1;
        const currentValue = nextIndexByCluster.get(clusterKey) ?? 1;
        nextIndexByCluster.set(clusterKey, Math.max(currentValue, nextValue));
        return desiredId;
      })()
      : allocateUniqueMatchId(usedIds, nextIndexByCluster, clusterKey);

    if (desiredId && desiredId !== nextId) {
      renamedIds.set(desiredId, nextId);
    }

    return nextId === match.id
      ? match
      : { ...match, id: nextId };
  };

  const matches = store.matches.map(normalizeMatch);
  const flowHistory: Record<string, MatchFlowHistory> = {};

  Object.entries(store.flowHistory).forEach(([matchId, history]) => {
    const nextMatchId = renamedIds.get(matchId) ?? matchId;
    flowHistory[nextMatchId] = history;
  });

  matches.forEach((match) => {
    if (!flowHistory[match.id]) {
      flowHistory[match.id] = { undoStack: [], redoStack: [] };
    }
  });

  const deletedHistory = store.deletedHistory.map((batch) => ({
    ...batch,
    previousActiveMatchId: batch.previousActiveMatchId,
    entries: batch.entries.map((entry) => {
      const normalizedMatch = normalizeMatch(entry.match);
      const nextMatchId = normalizedMatch.id;
      const entryFlowHistory = entry.flowHistory;
      flowHistory[nextMatchId] = flowHistory[nextMatchId] ?? entryFlowHistory;

      return {
        ...entry,
        match: normalizedMatch,
        flowHistory: flowHistory[nextMatchId] ?? entryFlowHistory,
      };
    }),
  })).map((batch) => ({
    ...batch,
    previousActiveMatchId: batch.previousActiveMatchId && batch.entries.some((entry) => entry.match.id === batch.previousActiveMatchId)
      ? batch.previousActiveMatchId
      : batch.previousActiveMatchId
        ? (renamedIds.get(batch.previousActiveMatchId) ?? batch.previousActiveMatchId)
        : null,
  }));

  const requestedActiveMatchId = store.activeMatchId && matches.some((match) => match.id === store.activeMatchId)
    ? store.activeMatchId
    : store.activeMatchId
      ? (renamedIds.get(store.activeMatchId) ?? store.activeMatchId)
      : null;
  const activeMatchId = requestedActiveMatchId && matches.some((match) => match.id === requestedActiveMatchId)
    ? requestedActiveMatchId
    : matches[0]?.id ?? null;

  return {
    activeMatchId,
    matches,
    flowHistory,
    deletedHistory,
  };
}

function ensureFlowHistory(store: MatchStoreFile, matchId: string): MatchFlowHistory {
  if (!store.flowHistory[matchId]) {
    store.flowHistory[matchId] = {
      undoStack: [],
      redoStack: [],
    };
  }

  return store.flowHistory[matchId];
}

function pushMatchFlowUndo(store: MatchStoreFile, match: MatchRecord): void {
  const history = ensureFlowHistory(store, match.id);
  history.undoStack.push(flowSnapshotFromMatch(match));
  if (history.undoStack.length > FLOW_HISTORY_LIMIT) {
    history.undoStack = history.undoStack.slice(history.undoStack.length - FLOW_HISTORY_LIMIT);
  }
  history.redoStack = [];
}

function applyFlowSnapshot(match: MatchRecord, snapshot: MatchFlowSnapshot): MatchRecord {
  return {
    ...match,
    bestOf: snapshot.bestOf,
    games: cloneValue(snapshot.games),
    status: snapshot.status,
    leftScore: snapshot.leftScore,
    rightScore: snapshot.rightScore,
    winner: snapshot.winner,
    completedAt: snapshot.completedAt,
    updatedAt: new Date().toISOString(),
  };
}

function toPublicStore(store: MatchStoreFile, mtime: number | null): MatchStoreState {
  const activeHistory = store.activeMatchId ? store.flowHistory[store.activeMatchId] : null;
  return {
    activeMatchId: store.activeMatchId,
    matches: store.matches,
    undo: {
      canUndo: Boolean(activeHistory && activeHistory.undoStack.length > 0),
      canRedo: Boolean(activeHistory && activeHistory.redoStack.length > 0),
      canUndoDelete: store.deletedHistory.length > 0,
      deleteUndoCount: store.deletedHistory.length,
    },
    mtime,
  };
}

// 删除超过 7 天的撤销/重做快照（按 savedAt 判定），返回是否发生了清理
function pruneExpiredFlowHistory(store: MatchStoreFile, nowMs: number): boolean {
  const cutoffMs = nowMs - FLOW_HISTORY_TTL_MS;
  let changed = false;

  const isFresh = (snapshot: MatchFlowSnapshot): boolean => {
    const savedAtMs = Date.parse(snapshot.savedAt);
    return Number.isFinite(savedAtMs) && savedAtMs >= cutoffMs;
  };

  for (const history of Object.values(store.flowHistory)) {
    if (history.undoStack.some((snapshot) => !isFresh(snapshot))) {
      history.undoStack = history.undoStack.filter(isFresh);
      changed = true;
    }
    if (history.redoStack.some((snapshot) => !isFresh(snapshot))) {
      history.redoStack = history.redoStack.filter(isFresh);
      changed = true;
    }
  }

  return changed;
}

// 原子写：同目录临时文件 + rename，避免写一半崩溃导致 matches.json 截断损坏
function persistStoreFile(paths: AppPaths, store: MatchStoreFile): number {
  ensureRuntimeDirs(paths);
  const targetFile = paths.matchesFile;
  storeTmpCounter += 1;
  const tmpFile = `${targetFile}.tmp-${process.pid}-${storeTmpCounter}`;
  const payload: MatchStoreFile = { __version: MATCH_STORE_VERSION, ...store };
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpFile, targetFile);
  return fs.statSync(targetFile).mtimeMs;
}

// 更新内存缓存（写盘成功后调用），后续读取零 IO
function rememberStore(paths: AppPaths, entry: MatchStoreCacheEntry): void {
  matchStoreCache.set(paths, entry);
}

function readStoreFile(paths: AppPaths): { store: MatchStoreFile; mtime: number | null } {
  let fileMtime: number | null = null;
  try {
    fileMtime = fs.statSync(paths.matchesFile).mtimeMs;
  } catch {
    fileMtime = null;
  }

  const cached = matchStoreCache.get(paths);
  if (cached && cached.fileMtime === fileMtime) {
    // 长跑不重启兜底：节流检查 7 天过期快照，有清理才落盘
    const nowMs = Date.now();
    if (nowMs - cached.lastPruneAt >= STORE_CACHE_PRUNE_CHECK_INTERVAL_MS) {
      cached.lastPruneAt = nowMs;
      if (pruneExpiredFlowHistory(cached.store, nowMs)) {
        const nextMtime = persistStoreFile(paths, cached.store);
        cached.fileMtime = nextMtime;
        cached.mtime = nextMtime;
      }
    }
    return { store: cached.store, mtime: cached.mtime };
  }

  if (fileMtime === null) {
    const entry: MatchStoreCacheEntry = {
      fileMtime: null,
      store: defaultStoreFile(),
      mtime: null,
      lastPruneAt: Date.now(),
    };
    rememberStore(paths, entry);
    return { store: entry.store, mtime: null };
  }

  try {
    const rawText = fs.readFileSync(paths.matchesFile, 'utf-8');
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    const lookup = spriteLookup(paths);
    const version = typeof raw.__version === 'number' ? raw.__version : 0;
    // 旧版数据（无 savedAt）迁移时统一补当前时间，给予完整 7 天保留期
    const legacySavedAt = new Date().toISOString();
    const matches = Array.isArray(raw.matches)
      ? raw.matches
        .map((match) => normalizeMatchRecord(match, lookup))
        .filter((match): match is MatchRecord => Boolean(match && match.id))
      : [];
    const activeMatchId = typeof raw.activeMatchId === 'string' && raw.activeMatchId.trim()
      ? raw.activeMatchId.trim()
      : null;

    const store = normalizeStoreIdentifiers({
      __version: version >= MATCH_STORE_VERSION ? MATCH_STORE_VERSION : version,
      activeMatchId: activeMatchId && matches.some((match) => match.id === activeMatchId) ? activeMatchId : null,
      matches,
      flowHistory: normalizeFlowHistoryMap(raw.flowHistory, lookup, legacySavedAt),
      deletedHistory: normalizeDeletedHistory(raw.deletedHistory, lookup, legacySavedAt),
    });

    let needsWriteBack = version < MATCH_STORE_VERSION;
    if (pruneExpiredFlowHistory(store, Date.now())) {
      needsWriteBack = true;
    }

    let mtime = fileMtime;
    if (needsWriteBack) {
      mtime = persistStoreFile(paths, store);
    }

    rememberStore(paths, { fileMtime: mtime, store, mtime, lastPruneAt: Date.now() });
    return { store, mtime };
  } catch {
    const entry: MatchStoreCacheEntry = {
      fileMtime,
      store: defaultStoreFile(),
      mtime: null,
      lastPruneAt: Date.now(),
    };
    rememberStore(paths, entry);
    return { store: entry.store, mtime: null };
  }
}

function writeStoreFile(paths: AppPaths, store: MatchStoreFile): MatchStoreState {
  const normalizedStore = normalizeStoreIdentifiers(store);
  pruneExpiredFlowHistory(normalizedStore, Date.now());
  const mtime = persistStoreFile(paths, normalizedStore);
  // 直接以内存态构建返回值，不再写后重读
  rememberStore(paths, { fileMtime: mtime, store: normalizedStore, mtime, lastPruneAt: Date.now() });
  return toPublicStore(normalizedStore, mtime);
}

function restorePanelFromSlots(paths: AppPaths, position: 'left' | 'right', slots: MatchSlotSnapshot[]): void {
  ensureRuntimeDirs(paths);
  const selected = sanitizeSlotSnapshots(slots).map((slot) => ({
    slot: slot.slot,
    sprite: slot.pet_id,
    opacityEnabled: slot.opacityEnabled,
    opacity: slot.opacity,
    saturation: slot.saturation,
    healthEnabled: slot.healthEnabled,
    healthPercent: slot.healthPercent,
    energyValue: slot.energyValue,
  }));

  fs.writeFileSync(
    paths.panelStatePath(position),
    JSON.stringify({ position, selected }, null, 2),
    'utf-8',
  );
}

function syncScoreboardFromMatch(paths: AppPaths, match: MatchRecord): void {
  const scoreboard = getScoreboardState(paths);
  saveScoreboardState(paths, {
    ...scoreboard,
    leftName: match.leftPlayer,
    rightName: match.rightPlayer,
    leftRank: match.leftRank,
    rightRank: match.rightRank,
    leftScore: String(match.leftScore),
    rightScore: String(match.rightScore),
    bestOf: match.bestOf,
  });
}

function clearActiveDisplayState(paths: AppPaths): void {
  clearPanelState(paths, 'left');
  clearPanelState(paths, 'right');

  const scoreboard = getScoreboardState(paths);
  saveScoreboardState(paths, {
    ...scoreboard,
    leftName: '',
    rightName: '',
    leftRank: '',
    rightRank: '',
    leftScore: '0',
    rightScore: '0',
    bestOf: DEFAULT_BEST_OF,
  });
}

function getCurrentGame(match: MatchRecord): GameRecord {
  return (
    match.games.find((game) => game.status === 'in_progress')
    ?? match.games.find((game) => game.status === 'pending')
    ?? match.games[match.games.length - 1]
  );
}

function assertMatchLineupEditable(match: MatchRecord, currentGame: GameRecord): void {
  if (match.status === 'completed') {
    throw new Error('当前赛事已完赛，不能编辑阵容');
  }

  if (currentGame.status === 'completed') {
    throw new Error('当前小局已结束，不能继续修改阵容');
  }
}

function syncMatchToPanelsAndScoreboard(paths: AppPaths, match: MatchRecord): void {
  const currentGame = getCurrentGame(match);

  if (match.status === 'completed' || currentGame.status !== 'in_progress') {
    restorePanelFromSlots(paths, 'left', sanitizeSlotSnapshots([]));
    restorePanelFromSlots(paths, 'right', sanitizeSlotSnapshots([]));
    syncScoreboardFromMatch(paths, match);
    return;
  }

  restorePanelFromSlots(paths, 'left', currentGame.leftSlots);
  restorePanelFromSlots(paths, 'right', currentGame.rightSlots);
  syncScoreboardFromMatch(paths, match);
}

function syncAfterStoreChange(paths: AppPaths, publicStore: MatchStoreState): void {
  const activeMatch = publicStore.matches.find((match) => match.id === publicStore.activeMatchId);
  if (activeMatch) {
    syncMatchToPanelsAndScoreboard(paths, activeMatch);
    return;
  }

  clearActiveDisplayState(paths);
}

function parseSelectedSlots(paths: AppPaths, selectedSlots: unknown): MatchSlotSnapshot[] {
  if (!Array.isArray(selectedSlots)) {
    throw new Error('selected must be a list');
  }

  const lookup = spriteLookup(paths);
  const nextSlots = Array.from({ length: MAX_GAME_SLOTS }, (_, index) => createEmptySlotSnapshot(index));

  selectedSlots.slice(0, MAX_GAME_SLOTS).forEach((item, index) => {
    if (item === null || item === undefined) {
      return;
    }
    if (!item || typeof item !== 'object') {
      throw new Error('slot must be an object or null');
    }

    const raw = item as Record<string, unknown>;
    const rawSprite = raw.sprite;
    const petId =
      rawSprite && typeof rawSprite === 'object' && typeof (rawSprite as Record<string, unknown>).id === 'string'
        ? (rawSprite as Record<string, unknown>).id
        : rawSprite;

    const normalizedPetId = normalizeStoredPetId(petId);
    const sprite = normalizedPetId ? (lookup.get(normalizedPetId) ?? null) : null;
    nextSlots[index] = {
      slot: index,
      pet_id: normalizedPetId,
      name: sprite?.displayName?.trim() ?? '',
      form: sprite?.petForm?.trim() ?? '',
      opacityEnabled: Boolean(raw.opacityEnabled),
      opacity: Number.isFinite(Number(raw.opacity)) ? Number(raw.opacity) : 0.5,
      saturation: Number.isFinite(Number(raw.saturation)) ? Number(raw.saturation) : 1,
      healthEnabled:
        typeof raw.healthEnabled === 'boolean'
          ? raw.healthEnabled
          : !Boolean(raw.opacityEnabled),
      healthPercent: Number.isFinite(Number(raw.healthPercent)) ? Number(raw.healthPercent) : 100,
      energyValue: Number.isFinite(Number(raw.energyValue)) ? Number(raw.energyValue) : 10,
    };
  });

  return nextSlots;
}

function parseSelectedSlot(paths: AppPaths, slotIndex: number, slotData: unknown): MatchSlotSnapshot {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= MAX_GAME_SLOTS) {
    throw new Error('invalid slot index');
  }

  const nextSlots = parseSelectedSlots(
    paths,
    Array.from({ length: MAX_GAME_SLOTS }, (_, index) => (index === slotIndex ? slotData : null)),
  );
  return nextSlots[slotIndex];
}


export function getMatchStore(paths: AppPaths): MatchStoreState {
  const { store, mtime } = readStoreFile(paths);
  return toPublicStore(store, mtime);
}

export function createMatch(paths: AppPaths, payload: unknown): MatchStoreState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('match payload must be an object');
  }

  const raw = payload as Record<string, unknown>;
  const leftPlayer = normalizePlayerName(raw.leftPlayer);
  const rightPlayer = normalizePlayerName(raw.rightPlayer);
  const leftRank = normalizeRankValue(raw.leftRank);
  const rightRank = normalizeRankValue(raw.rightRank);
  const leftTeamId = normalizeTeamId(raw.leftTeamId);
  const leftTeamName = normalizeTeamName(raw.leftTeamName);
  const rightTeamId = normalizeTeamId(raw.rightTeamId);
  const rightTeamName = normalizeTeamName(raw.rightTeamName);
  const bestOf = normalizeBestOf(raw.bestOf);
  const tags = normalizeTags(raw.tags);
  const tournamentRef = normalizeTournamentRef(raw.tournamentRef);

  if (!leftPlayer || !rightPlayer) {
    throw new Error('请输入左右两侧选手名称');
  }

  const { store } = readStoreFile(paths);
  const now = new Date().toISOString();
  const machineCode = loadRuntimeConfig(paths).machineCode;
  const clusterKey = matchClusterKey(getDatePrefix(new Date(now)), machineCode);
  // usedIds 传入全部现存 id：即使簇键序号不规则也保证不产生重复 id
  const nextMatchId = allocateUniqueMatchId(
    new Set<string>(store.matches.map((match) => match.id)),
    collectNextMatchIndexes(store),
    clusterKey,
  );
  const match: MatchRecord = {
    id: nextMatchId,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    leftPlayer,
    rightPlayer,
    leftRank,
    rightRank,
    leftTeamId,
    leftTeamName,
    rightTeamId,
    rightTeamName,
    bestOf,
    games: [createEmptyGameRecord(1)],
    leftScore: 0,
    rightScore: 0,
    winner: null,
    completedAt: null,
    tags,
    tournamentRef,
  };

  store.activeMatchId = match.id;
  store.matches = [match, ...store.matches];
  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function updateMatch(paths: AppPaths, matchId: string, payload: unknown): MatchStoreState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('match payload must be an object');
  }

  const { store } = readStoreFile(paths);
  const index = store.matches.findIndex((match) => match.id === matchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  const currentGame = getCurrentGame(current);
  const raw = payload as Record<string, unknown>;
  const leftPlayer = raw.leftPlayer === undefined ? current.leftPlayer : normalizePlayerName(raw.leftPlayer);
  const rightPlayer = raw.rightPlayer === undefined ? current.rightPlayer : normalizePlayerName(raw.rightPlayer);
  const leftRank = raw.leftRank === undefined ? current.leftRank : normalizeRankValue(raw.leftRank);
  const rightRank = raw.rightRank === undefined ? current.rightRank : normalizeRankValue(raw.rightRank);
  const nextBestOf = raw.bestOf === undefined ? current.bestOf : normalizeBestOf(raw.bestOf);

  if (!leftPlayer || !rightPlayer) {
    throw new Error('请输入左右两侧选手名称');
  }

  if (current.status === 'completed' && raw.bestOf !== undefined && nextBestOf !== current.bestOf) {
    throw new Error('已完成的比赛不能修改赛制');
  }

  if (raw.bestOf !== undefined && nextBestOf !== current.bestOf) {
    pushMatchFlowUndo(store, current);
  }
  const tags = raw.tags === undefined ? current.tags : normalizeTags(raw.tags);
  // 所属战队：允许创建后修改（左右选手所属战队）
  const leftTeamName = raw.leftTeamName === undefined ? current.leftTeamName : normalizeTeamName(raw.leftTeamName);
  const leftTeamId = raw.leftTeamId === undefined ? current.leftTeamId : normalizeTeamId(raw.leftTeamId);
  const rightTeamName = raw.rightTeamName === undefined ? current.rightTeamName : normalizeTeamName(raw.rightTeamName);
  const rightTeamId = raw.rightTeamId === undefined ? current.rightTeamId : normalizeTeamId(raw.rightTeamId);
  store.matches[index] = computeMatchProgress({
    ...current,
    leftPlayer,
    rightPlayer,
    leftRank,
    rightRank,
    bestOf: nextBestOf,
    leftTeamName,
    leftTeamId,
    rightTeamName,
    rightTeamId,
    tags,
    updatedAt: new Date().toISOString(),
  });

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function updateMatchTags(paths: AppPaths, matchId: string, payload: unknown): MatchStoreState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('tags payload must be an object');
  }

  const { store } = readStoreFile(paths);
  const index = store.matches.findIndex((match) => match.id === matchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  const raw = payload as Record<string, unknown>;
  const tags = normalizeTags(raw.tags);

  store.matches[index] = {
    ...current,
    tags,
    updatedAt: new Date().toISOString(),
  };

  const publicStore = writeStoreFile(paths, store);
  return getMatchStore(paths);
}

export function updateMatchesTags(paths: AppPaths, matchIds: unknown, payload: unknown): MatchStoreState {
  if (!Array.isArray(matchIds)) {
    throw new Error('matchIds must be a list');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('tags payload must be an object');
  }

  const uniqueMatchIds = Array.from(new Set(
    matchIds
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean),
  ));
  if (!uniqueMatchIds.length) {
    throw new Error('请选择至少一条赛事记录');
  }

  const { store } = readStoreFile(paths);
  const indexById = new Map(store.matches.map((match, index) => [match.id, index]));
  const missing = uniqueMatchIds.filter((id) => !indexById.has(id));
  if (missing.length) {
    throw new Error('部分比赛不存在');
  }

  const raw = payload as Record<string, unknown>;
  const addTags = normalizeTags(raw.tags);
  const now = new Date().toISOString();

  for (const id of uniqueMatchIds) {
    const index = indexById.get(id) as number;
    const existing = store.matches[index].tags ?? [];
    const merged = Array.from(new Set([...existing, ...addTags]));
    store.matches[index] = {
      ...store.matches[index],
      tags: merged,
      updatedAt: now,
    };
  }

  writeStoreFile(paths, store);
  return getMatchStore(paths);
}

export function setActiveMatch(paths: AppPaths, matchId: string): MatchStoreState {
  const { store } = readStoreFile(paths);
  const match = store.matches.find((item) => item.id === matchId);
  if (!match) {
    throw new Error('比赛不存在');
  }

  store.activeMatchId = matchId;
  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function deleteMatch(paths: AppPaths, matchId: string): MatchStoreState {
  return deleteMatches(paths, [matchId]);
}

export function deleteMatches(paths: AppPaths, matchIds: unknown): MatchStoreState {
  if (!Array.isArray(matchIds)) {
    throw new Error('matchIds must be a list');
  }

  const { store } = readStoreFile(paths);
  const uniqueMatchIds = Array.from(new Set(
    matchIds
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean),
  ));
  if (!uniqueMatchIds.length) {
    throw new Error('请选择至少一条赛事记录');
  }

  const matchIdSet = new Set(uniqueMatchIds);
  const entries = store.matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => matchIdSet.has(match.id))
    .map(({ match, index }) => ({
      match: cloneValue(match),
      index,
      flowHistory: cloneValue(store.flowHistory[match.id] ?? { undoStack: [], redoStack: [] }),
    }));

  if (!entries.length) {
    throw new Error('比赛不存在');
  }

  store.deletedHistory.push({
    entries,
    previousActiveMatchId: store.activeMatchId,
  });
  if (store.deletedHistory.length > DELETE_HISTORY_LIMIT) {
    store.deletedHistory = store.deletedHistory.slice(store.deletedHistory.length - DELETE_HISTORY_LIMIT);
  }

  store.matches = store.matches.filter((match) => !matchIdSet.has(match.id));
  uniqueMatchIds.forEach((id) => {
    delete store.flowHistory[id];
  });

  if (store.activeMatchId && matchIdSet.has(store.activeMatchId)) {
    store.activeMatchId = store.matches[0]?.id ?? null;
  } else if (store.activeMatchId && !store.matches.some((match) => match.id === store.activeMatchId)) {
    store.activeMatchId = store.matches[0]?.id ?? null;
  }

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function undoDeletedMatches(paths: AppPaths): MatchStoreState {
  const { store } = readStoreFile(paths);
  const batch = store.deletedHistory[store.deletedHistory.length - 1];
  if (!batch) {
    throw new Error('没有可撤回的删除记录');
  }

  store.deletedHistory = store.deletedHistory.slice(0, -1);
  const restoredEntries = [...batch.entries].sort((left, right) => left.index - right.index);
  const nextMatches = [...store.matches];

  restoredEntries.forEach((entry) => {
    nextMatches.splice(Math.min(entry.index, nextMatches.length), 0, cloneValue(entry.match));
    store.flowHistory[entry.match.id] = cloneValue(entry.flowHistory);
  });

  store.matches = nextMatches;
  if (
    batch.previousActiveMatchId
    && store.matches.some((match) => match.id === batch.previousActiveMatchId)
  ) {
    store.activeMatchId = batch.previousActiveMatchId;
  } else if (!store.activeMatchId) {
    store.activeMatchId = store.matches[0]?.id ?? null;
  }

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function saveDraftPanelStateForActiveMatch(
  paths: AppPaths,
  position: 'left' | 'right',
  selectedSlots: unknown,
): MatchStoreState {
  const { store } = readStoreFile(paths);
  if (!store.activeMatchId) {
    throw new Error('当前没有活动比赛');
  }

  const index = store.matches.findIndex((match) => match.id === store.activeMatchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  const currentGame = getCurrentGame(current);
  assertMatchLineupEditable(current, currentGame);

  const nextSlots = parseSelectedSlots(paths, selectedSlots);
  const nextGames = [...current.games];
  const gameIndex = nextGames.findIndex((game) => game.gameNumber === currentGame.gameNumber);
  nextGames[gameIndex] = {
    ...currentGame,
    leftSlots: position === 'left' ? nextSlots : currentGame.leftSlots,
    rightSlots: position === 'right' ? nextSlots : currentGame.rightSlots,
    leftLineup: position === 'left' ? lineupFromSlots(nextSlots) : currentGame.leftLineup,
    rightLineup: position === 'right' ? lineupFromSlots(nextSlots) : currentGame.rightLineup,
  };

  store.matches[index] = {
    ...current,
    games: nextGames,
    updatedAt: new Date().toISOString(),
  };

  return writeStoreFile(paths, store);
}

export function saveDraftPanelSlotStateForActiveMatch(
  paths: AppPaths,
  position: 'left' | 'right',
  slotIndex: number,
  slotData: unknown,
): MatchStoreState {
  const { store } = readStoreFile(paths);
  if (!store.activeMatchId) {
    throw new Error('当前没有活动比赛');
  }

  const index = store.matches.findIndex((match) => match.id === store.activeMatchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  const currentGame = getCurrentGame(current);
  assertMatchLineupEditable(current, currentGame);

  const nextSlot = parseSelectedSlot(paths, slotIndex, slotData);
  const nextGames = [...current.games];
  const gameIndex = nextGames.findIndex((game) => game.gameNumber === currentGame.gameNumber);
  const leftSlots = currentGame.leftSlots.slice(0, MAX_GAME_SLOTS);
  const rightSlots = currentGame.rightSlots.slice(0, MAX_GAME_SLOTS);

  while (leftSlots.length < MAX_GAME_SLOTS) {
    leftSlots.push(createEmptySlotSnapshot(leftSlots.length));
  }
  while (rightSlots.length < MAX_GAME_SLOTS) {
    rightSlots.push(createEmptySlotSnapshot(rightSlots.length));
  }

  if (position === 'left') {
    leftSlots[slotIndex] = nextSlot;
  } else {
    rightSlots[slotIndex] = nextSlot;
  }

  nextGames[gameIndex] = {
    ...currentGame,
    leftSlots,
    rightSlots,
    leftLineup: lineupFromSlots(leftSlots),
    rightLineup: lineupFromSlots(rightSlots),
  };

  store.matches[index] = {
    ...current,
    games: nextGames,
    updatedAt: new Date().toISOString(),
  };

  return writeStoreFile(paths, store);
}

/**
 * 比赛历史「录入阵容」：为指定赛事的当前小局（且必须尚未开始）写入双方阵容。
 * 只写赛事记录并广播一次 matchesUpdate，不触碰面板/比分栏/activeMatchId——
 * 待开始小局的阵容本就不上推流画面，因此天然不影响当前对局的推流；
 * 双侧合并为一次写入，避免推流页（page7 等）因两次广播重渲染两遍产生闪烁。
 */
export function saveGameLineupForMatch(
  paths: AppPaths,
  matchId: string,
  gameNumber: number,
  selections: { left?: unknown; right?: unknown },
): MatchStoreState {
  const { store } = readStoreFile(paths);
  const index = store.matches.findIndex((match) => match.id === matchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  if (current.status === 'completed') {
    throw new Error('当前赛事已完赛，不能录入阵容');
  }
  if (!Number.isInteger(gameNumber) || gameNumber < 1) {
    throw new Error('无效的小局编号');
  }

  const currentGame = getCurrentGame(current);
  if (!currentGame || currentGame.gameNumber !== gameNumber) {
    throw new Error(
      currentGame
        ? `还没轮到第 ${gameNumber} 局，只能录入当前小局（第 ${currentGame.gameNumber} 局）的阵容`
        : '该比赛没有可录入的小局',
    );
  }
  if (currentGame.status === 'in_progress') {
    throw new Error('该局已开始，请在赛事面板中修改阵容');
  }
  if (currentGame.status === 'completed') {
    throw new Error('该局已结束，不能录入阵容');
  }

  const hasLeft = selections.left !== undefined;
  const hasRight = selections.right !== undefined;
  if (!hasLeft && !hasRight) {
    throw new Error('请至少提供一侧的阵容');
  }

  const gameIndex = current.games.findIndex((game) => game.gameNumber === gameNumber);
  if (gameIndex === -1) {
    throw new Error('小局不存在');
  }

  const leftSlots = hasLeft ? parseSelectedSlots(paths, selections.left) : currentGame.leftSlots;
  const rightSlots = hasRight ? parseSelectedSlots(paths, selections.right) : currentGame.rightSlots;

  const nextGames = [...current.games];
  nextGames[gameIndex] = {
    ...currentGame,
    leftSlots,
    rightSlots,
    leftLineup: lineupFromSlots(leftSlots),
    rightLineup: lineupFromSlots(rightSlots),
  };

  store.matches[index] = {
    ...current,
    games: nextGames,
    updatedAt: new Date().toISOString(),
  };

  return writeStoreFile(paths, store);
}

export function startCurrentGame(paths: AppPaths, matchId: string): MatchStoreState {
  const { store } = readStoreFile(paths);
  const index = store.matches.findIndex((match) => match.id === matchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  const pendingGameIndex = current.games.findIndex((game) => game.status === 'pending');
  if (pendingGameIndex === -1) {
    throw new Error('当前没有待开始的小局');
  }

  const pendingGame = current.games[pendingGameIndex];
  if (!pendingGame.leftLineup.length || !pendingGame.rightLineup.length) {
    throw new Error('请先为双方选择阵容，再开始本局');
  }

  pushMatchFlowUndo(store, current);
  const nextGames = [...current.games];
  nextGames[pendingGameIndex] = {
    ...pendingGame,
    status: 'in_progress',
  };

  store.matches[index] = computeMatchProgress({
    ...current,
    games: nextGames,
    updatedAt: new Date().toISOString(),
  });

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function recordMatchWinner(
  paths: AppPaths,
  matchId: string,
  winner: 'left' | 'right',
): MatchStoreState {
  const { store } = readStoreFile(paths);
  const index = store.matches.findIndex((match) => match.id === matchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  if (current.status === 'completed') {
    throw new Error('该比赛已结束');
  }

  const inProgressGameIndex = current.games.findIndex((game) => game.status === 'in_progress');
  if (inProgressGameIndex === -1) {
    throw new Error('请先开始当前小局，再记录胜负');
  }

  pushMatchFlowUndo(store, current);
  const completedGame = {
    ...current.games[inProgressGameIndex],
    winner,
    status: 'completed' as const,
  };
  const nextGames = [...current.games];
  nextGames[inProgressGameIndex] = completedGame;

  let nextMatch = computeMatchProgress({
    ...current,
    games: nextGames,
    updatedAt: new Date().toISOString(),
  });

  if (nextMatch.status !== 'completed') {
    nextMatch = {
      ...nextMatch,
      games: [...nextGames, createEmptyGameRecord(nextGames.length + 1)],
      updatedAt: new Date().toISOString(),
    };
  }

  store.matches[index] = nextMatch;
  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

/**
 * 弃权判负：仅未开始（pending、无任何小局结果）的比赛可用。
 * 按决胜局数补已完成空阵容小局（BO1=1:0、BO3=2:0、BO5=3:0），负方为 loserSide，
 * 加「弃权」标签后比赛即为 completed；入 undo 栈，当前波内仍可撤回。
 */
export function forfeitMatch(
  paths: AppPaths,
  matchId: string,
  loserSide: 'left' | 'right',
): MatchStoreState {
  if (loserSide !== 'left' && loserSide !== 'right') {
    throw new Error('loserSide must be left or right');
  }

  const { store } = readStoreFile(paths);
  const index = store.matches.findIndex((match) => match.id === matchId);
  if (index === -1) {
    throw new Error('比赛不存在');
  }

  const current = store.matches[index];
  if (current.status !== 'pending') {
    throw new Error('仅未开始的比赛可弃权判负');
  }
  if (current.games.some((game) => game.status !== 'pending' || game.winner !== null)) {
    throw new Error('该比赛已有小局结果，不能弃权判负');
  }

  pushMatchFlowUndo(store, current);
  const winnerSide = loserSide === 'left' ? 'right' : 'left';
  const neededWins = winsNeeded(current.bestOf);
  const games: GameRecord[] = Array.from({ length: neededWins }, (_unused, gameIndex) => ({
    ...createEmptyGameRecord(gameIndex + 1),
    winner: winnerSide,
    status: 'completed',
  }));
  const tags = Array.from(new Set([...current.tags, TOURNAMENT_FORFEIT_TAG]));

  store.matches[index] = computeMatchProgress({
    ...current,
    games,
    tags,
    updatedAt: new Date().toISOString(),
  });

  const nextPublicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, nextPublicStore);
  return getMatchStore(paths);
}

/**
 * 系列赛波次回退专用：把一批比赛直接复位为未开始
 * （pending、单个空小局、0:0、无胜者、completedAt 清空），并清空其 undo/redo 历史。
 * 不进 deletedHistory/undo 栈——管理级动作，语义由调用方（tournament-service）保证。
 */
export function resetMatchesToPending(paths: AppPaths, matchIds: string[]): MatchStoreState {
  if (!Array.isArray(matchIds) || !matchIds.length) {
    return getMatchStore(paths);
  }

  const { store } = readStoreFile(paths);
  const idSet = new Set(matchIds);
  let changed = false;
  const now = new Date().toISOString();

  store.matches = store.matches.map((match) => {
    if (!idSet.has(match.id)) {
      return match;
    }
    changed = true;
    return {
      ...match,
      status: 'pending' as const,
      games: [createEmptyGameRecord(1)],
      leftScore: 0,
      rightScore: 0,
      winner: null,
      completedAt: null,
      updatedAt: now,
    };
  });
  matchIds.forEach((matchId) => {
    delete store.flowHistory[matchId];
  });

  if (!changed) {
    return getMatchStore(paths);
  }

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

/**
 * 解除一批比赛与某系列赛的关联（删除 tournamentRef），比赛本身保留为普通对局。
 * 删除系列赛前调用：即使随后 deleteMatches 把比赛放进撤销栈，撤回恢复的快照
 * 也已经是无关联版本，不会留下指向不存在系列赛的孤儿引用。
 * 管理级动作，不进 deletedHistory/undo 栈。返回实际解绑的比赛 id。
 */
export function detachMatchesFromTournament(
  paths: AppPaths,
  tournamentId: string,
): { store: MatchStoreState; matchIds: string[] } {
  const { store } = readStoreFile(paths);
  const detachedIds: string[] = [];
  const now = new Date().toISOString();

  store.matches = store.matches.map((match) => {
    if (match.tournamentRef?.tournamentId !== tournamentId) {
      return match;
    }
    detachedIds.push(match.id);
    const { tournamentRef: _unused, ...rest } = match;
    return { ...rest, updatedAt: now };
  });

  if (!detachedIds.length) {
    return { store: getMatchStore(paths), matchIds: [] };
  }

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return { store: getMatchStore(paths), matchIds: detachedIds };
}

export function undoMatchAction(paths: AppPaths, matchId: string): MatchStoreState {
  const { store } = readStoreFile(paths);
  const history = ensureFlowHistory(store, matchId);
  const previousSnapshot = history.undoStack[history.undoStack.length - 1];
  if (!previousSnapshot) {
    throw new Error('没有可撤回的操作');
  }

  const matchIndex = store.matches.findIndex((match) => match.id === matchId);
  if (matchIndex === -1) {
    throw new Error('比赛不存在');
  }

  const currentMatch = store.matches[matchIndex];
  history.undoStack = history.undoStack.slice(0, -1);
  history.redoStack.push(flowSnapshotFromMatch(currentMatch));
  store.matches[matchIndex] = applyFlowSnapshot(currentMatch, previousSnapshot);

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function redoMatchAction(paths: AppPaths, matchId: string): MatchStoreState {
  const { store } = readStoreFile(paths);
  const history = ensureFlowHistory(store, matchId);
  const nextSnapshot = history.redoStack[history.redoStack.length - 1];
  if (!nextSnapshot) {
    throw new Error('没有可取消撤回的操作');
  }

  const matchIndex = store.matches.findIndex((match) => match.id === matchId);
  if (matchIndex === -1) {
    throw new Error('比赛不存在');
  }

  const currentMatch = store.matches[matchIndex];
  history.redoStack = history.redoStack.slice(0, -1);
  history.undoStack.push(flowSnapshotFromMatch(currentMatch));
  store.matches[matchIndex] = applyFlowSnapshot(currentMatch, nextSnapshot);

  const publicStore = writeStoreFile(paths, store);
  syncAfterStoreChange(paths, publicStore);
  return getMatchStore(paths);
}

export function syncActiveMatchLineupsFromPanels(paths: AppPaths): MatchStoreState {
  const { store } = readStoreFile(paths);
  if (!store.activeMatchId) {
    return getMatchStore(paths);
  }

  const index = store.matches.findIndex((match) => match.id === store.activeMatchId);
  if (index === -1) {
    return getMatchStore(paths);
  }

  const current = store.matches[index];
  const currentGame = getCurrentGame(current);
  assertMatchLineupEditable(current, currentGame);
  if (currentGame.status !== 'pending') {
    return getMatchStore(paths);
  }

  const leftSlots = capturePanelSnapshot(paths, 'left');
  const rightSlots = capturePanelSnapshot(paths, 'right');
  const nextGames = [...current.games];
  const gameIndex = nextGames.findIndex((game) => game.gameNumber === currentGame.gameNumber);
  nextGames[gameIndex] = {
    ...currentGame,
    leftSlots,
    rightSlots,
    leftLineup: lineupFromSlots(leftSlots),
    rightLineup: lineupFromSlots(rightSlots),
  };

  store.matches[index] = {
    ...current,
    games: nextGames,
    updatedAt: new Date().toISOString(),
  };

  return writeStoreFile(paths, store);
}

/* ==================== 双机数据同步：比赛导入合并 ==================== */

/** 规范化包内比赛的结果：逐条过 normalizeMatchRecord，非法 id / 结构不符被拒并给出原因 */
export interface NormalizedMatchImport {
  records: MatchRecord[];
  rejected: Array<{ index: number; id: string; reason: string }>;
}

export function normalizeImportedMatches(paths: AppPaths, incoming: unknown[]): NormalizedMatchImport {
  const lookup = spriteLookup(paths);
  const records: MatchRecord[] = [];
  const rejected: NormalizedMatchImport['rejected'] = [];

  incoming.forEach((item, index) => {
    const normalized = normalizeMatchRecord(item, lookup);
    if (normalized) {
      records.push(normalized);
      return;
    }
    const rawId = item && typeof item === 'object'
      ? String((item as Record<string, unknown>).id ?? '').slice(0, 40)
      : '';
    rejected.push({ index, id: rawId, reason: 'id 不合法或结构不符，已忽略' });
  });

  return { records, rejected };
}

/** 单条比赛的导入判定结果（预览与合并共用同一判定逻辑） */
export interface MatchImportDecision {
  id: string;
  action: 'add' | 'update' | 'skip';
  reason: string;
  localUpdatedAt: string | null;
  incomingUpdatedAt: string | null;
  /** 双方都已登记且内容不同（疑似两台机器都录过这场，需要人工确认是否覆盖） */
  conflict: boolean;
  /** 字段级差异（只列出不同的字段；本机无该记录时为空数组） */
  diff: SyncImportDiffField[];
}

function matchStatusLabel(match: MatchRecord): string {
  if (match.status === 'completed') {
    return '已结束';
  }
  if (match.status === 'in_progress') {
    return '进行中';
  }
  return '未开始';
}

function gameWinnerLabel(winner: 'left' | 'right' | null): string {
  if (winner === 'left') {
    return '左侧胜';
  }
  if (winner === 'right') {
    return '右侧胜';
  }
  return '未分胜负';
}

function gameSummary(game: GameRecord): string {
  const statusLabel = game.status === 'completed' ? '已结束' : game.status === 'in_progress' ? '进行中' : '未开始';
  return `${statusLabel} · ${gameWinnerLabel(game.winner)}`;
}

/** 阵容快照的可读文本：优先名称快照，缺失时回退 pet_id；空阵容显示「（空）」 */
function lineupText(slots: MatchSlotSnapshot[]): string {
  const names = slots.filter((slot) => slot.pet_id).map((slot) => slot.name || slot.pet_id || '');
  return names.length ? names.join('、') : '（空）';
}

function pushDiffField(fields: SyncImportDiffField[], label: string, local: string, incoming: string): void {
  if (local !== incoming) {
    fields.push({ label, local, incoming });
  }
}

/** 比赛「已登记」判定：任一小局已开始/已分胜负/已录入阵容（用于识别两台机器都录过的冲突） */
function matchHasRecordedContent(match: MatchRecord): boolean {
  return match.games.some((game) => game.status !== 'pending'
    || game.winner === 'left' || game.winner === 'right'
    || game.leftLineup.length > 0 || game.rightLineup.length > 0);
}

/**
 * 字段级差异（本机 vs 包内）：基础信息 + 逐小局状态/双方阵容，只列出不同的行，最多 20 条。
 * 导出供前端预览弹窗做左右 diff 展示。
 */
export function buildMatchDiffFields(local: MatchRecord, incoming: MatchRecord): SyncImportDiffField[] {
  const fields: SyncImportDiffField[] = [];
  pushDiffField(fields, '状态', matchStatusLabel(local), matchStatusLabel(incoming));
  pushDiffField(
    fields,
    '比分',
    `${local.leftScore} : ${local.rightScore}`,
    `${incoming.leftScore} : ${incoming.rightScore}`,
  );
  pushDiffField(
    fields,
    '选手',
    `${local.leftPlayer} vs ${local.rightPlayer}`,
    `${incoming.leftPlayer} vs ${incoming.rightPlayer}`,
  );
  pushDiffField(fields, '赛制', `BO${local.bestOf}`, `BO${incoming.bestOf}`);
  pushDiffField(fields, '标签', local.tags.join('、') || '（无）', incoming.tags.join('、') || '（无）');

  const gameCount = Math.max(local.games.length, incoming.games.length);
  for (let index = 0; index < gameCount; index += 1) {
    const localGame = local.games[index];
    const incomingGame = incoming.games[index];
    const label = `第 ${index + 1} 局`;
    pushDiffField(
      fields,
      label,
      localGame ? gameSummary(localGame) : '（无）',
      incomingGame ? gameSummary(incomingGame) : '（无）',
    );
    pushDiffField(
      fields,
      `${label}左侧阵容`,
      localGame ? lineupText(localGame.leftSlots) : '（无）',
      incomingGame ? lineupText(incomingGame.leftSlots) : '（无）',
    );
    pushDiffField(
      fields,
      `${label}右侧阵容`,
      localGame ? lineupText(localGame.rightSlots) : '（无）',
      incomingGame ? lineupText(incomingGame.rightSlots) : '（无）',
    );
  }

  return fields.slice(0, 20);
}

function classifyMatchImport(
  local: MatchRecord | null,
  incoming: MatchRecord,
  mode: SyncConflictMode,
): MatchImportDecision {
  const base = {
    id: incoming.id,
    localUpdatedAt: local ? local.updatedAt : null,
    incomingUpdatedAt: incoming.updatedAt,
  };

  if (!local) {
    return { ...base, action: 'add', reason: '', conflict: false, diff: [] };
  }

  const diff = buildMatchDiffFields(local, incoming);
  // 冲突 = 本机与包内都「已登记」且有内容差异（只登记过一边属于正常同步，不提示）
  const conflict = diff.length > 0 && matchHasRecordedContent(local) && matchHasRecordedContent(incoming);

  if (mode === 'bundle') {
    return diff.length === 0
      ? { ...base, action: 'skip', reason: '与包内内容相同', conflict, diff }
      : { ...base, action: 'update', reason: '以包为准覆盖本机版本', conflict, diff };
  }

  const localMs = Date.parse(local.updatedAt);
  const incomingMs = Date.parse(incoming.updatedAt);
  const newer = Number.isFinite(localMs) && Number.isFinite(incomingMs)
    ? incomingMs > localMs
    : String(incoming.updatedAt) > String(local.updatedAt);
  return newer
    ? { ...base, action: 'update', reason: '包内版本更新', conflict, diff }
    : { ...base, action: 'skip', reason: '本机版本不早于包内（保持本机）', conflict, diff };
}

/** 只读：按 id 对比包内比赛与本机 store（供导入预览） */
export function diffMatchRecords(
  paths: AppPaths,
  incoming: MatchRecord[],
  mode: SyncConflictMode,
): MatchImportDecision[] {
  const { store } = readStoreFile(paths);
  const localById = new Map(store.matches.map((match) => [match.id, match]));
  return incoming.map((record) => classifyMatchImport(localById.get(record.id) ?? null, record, mode));
}

export interface MergeMatchRecordsReport {
  store: MatchStoreState;
  added: string[];
  updated: string[];
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * 合并包内比赛：不存在 → 追加；已存在 → 按冲突模式覆盖或跳过。
 * 走 readStoreFile/writeStoreFile 既有管线（内存缓存 + 原子写 + 标识规范化）；
 * 不修改 activeMatchId、不写撤销栈（导入不是本机操作，不参与撤销/重做）。
 */
export function mergeMatchRecords(
  paths: AppPaths,
  incoming: MatchRecord[],
  mode: SyncConflictMode,
): MergeMatchRecordsReport {
  const { store } = readStoreFile(paths);
  const matches = [...store.matches];
  const indexById = new Map(matches.map((match, index) => [match.id, index]));

  const added: string[] = [];
  const updated: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  incoming.forEach((record) => {
    const localIndex = indexById.get(record.id);
    const decision = classifyMatchImport(
      localIndex === undefined ? null : matches[localIndex],
      record,
      mode,
    );

    if (decision.action === 'add') {
      indexById.set(record.id, matches.length);
      matches.push(record);
      added.push(record.id);
      return;
    }
    if (decision.action === 'update') {
      matches[localIndex as number] = record;
      updated.push(record.id);
      return;
    }
    skipped.push({ id: record.id, reason: decision.reason });
  });

  const nextState = writeStoreFile(paths, { ...store, matches });
  return { store: nextState, added, updated, skipped };
}
