import fs from 'node:fs';

import {
  buildDefaultStages,
  MATCH_ID_REGEX,
  SUPPORTED_TOURNAMENT_SIZES,
  TOURNAMENT_CROSS_BUCKET_TAG,
  TOURNAMENT_ID_REGEX,
  TOURNAMENT_TARGET_LOSSES,
  TOURNAMENT_TARGET_WINS,
} from '../../shared/constants.js';
import type {
  MatchRecord,
  PairingImportResult,
  PairingRule,
  PairingValidation,
  StageFormat,
  StageRule,
  SyncConflictMode,
  TournamentEntry,
  TournamentNode,
  TournamentRecord,
  TournamentWave,
} from '../../shared/types.js';
import {
  createMatch,
  deleteMatches,
  detachMatchesFromTournament,
  getMatchStore,
  resetMatchesToPending,
} from './match-service.js';
import { getProfileStore } from './profile-service.js';
import { loadRuntimeConfig } from './config-service.js';
import { ensureRuntimeDirs } from './image-service.js';
import type { AppPaths } from './path-service.js';

/** 配对草稿中的一场（bucketKey 仅双败有） */
interface DraftPair {
  bucketKey?: string;
  pair: [string | null, string | null];
}

/* ==================== 随机：注入式 RNG，同 seed 结果可复现 ==================== */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** 某阶段某波专属 RNG：由系列赛 seed 与位置混合，保证各波独立且可复现 */
function waveRng(record: TournamentRecord, stageIndex: number, waveIndex: number): () => number {
  const mixed = (record.seed ^ Math.imul(stageIndex * 31 + waveIndex + 1, 0x9e3779b1)) >>> 0;
  return mulberry32(mixed);
}

/* ==================== 日期 / id ==================== */

function getDatePrefix(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/** 分配系列赛 id：T + 日期 + 机器码 + 2 位序号（同日期同机器码递增） */
function allocateTournamentId(paths: AppPaths, records: TournamentRecord[], now: Date): string {
  const machine = loadRuntimeConfig(paths).machineCode;
  const datePrefix = getDatePrefix(now);
  const prefix = `T${datePrefix}_${machine}`;
  let sequence = 1;
  records.forEach((record) => {
    const parsed = TOURNAMENT_ID_REGEX.exec(record.id);
    if (parsed && parsed[1] === datePrefix && parsed[2].toUpperCase() === machine) {
      sequence = Math.max(sequence, Number.parseInt(parsed[3], 10) + 1);
    }
  });
  return `${prefix}${String(sequence).padStart(2, '0')}`;
}

/* ==================== 阶段规则规范化 ==================== */

/** 阶段局数白名单（BO1/BO3/BO5/BO7）：缺省与非法值一律回退 BO1 */
function normalizeStageBestOf(value: unknown): StageRule['bestOf'] {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return parsed === 3 || parsed === 5 || parsed === 7 ? parsed : 1;
}

function normalizeStageRule(value: unknown, index: number): StageRule | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const format: StageFormat = raw.format === 'single-elim' ? 'single-elim' : 'double-life';
  const bestOf = normalizeStageBestOf(raw.bestOf);

  // 配对方式必须与赛制兼容，不兼容强制改回默认
  let pairing: PairingRule;
  if (format === 'double-life') {
    pairing = raw.pairing === 'manual-bucket' ? 'manual-bucket' : 'random-bucket';
  } else {
    pairing = raw.pairing === 'random-round' ? 'random-round' : 'bracket-seed';
  }

  return {
    id: `s${index}`,
    name: String(raw.name ?? '').trim() || `阶段${index + 1}`,
    format,
    bestOf,
    pairing,
    avoidRematch: raw.avoidRematch !== false,
    requireConfirm: raw.requireConfirm === true,
  };
}

/* ==================== 文件存储 ==================== */

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function initialEntries(playerIds: string[]): TournamentEntry[] {
  return playerIds.map((playerId) => ({
    playerId,
    stageWins: 0,
    stageLosses: 0,
    state: 'alive',
  }));
}

function normalizeNode(value: unknown): TournamentNode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) {
    return null;
  }
  const player = (input: unknown): string | null => {
    const text = String(input ?? '').trim();
    return text || null;
  };
  const rawMatchId = raw.matchId ? String(raw.matchId).trim() : '';
  const matchId = rawMatchId && MATCH_ID_REGEX.test(rawMatchId) ? rawMatchId : null;

  return {
    id,
    matchId,
    playerAId: player(raw.playerAId),
    playerBId: player(raw.playerBId),
    winnerId: player(raw.winnerId),
    isBye: raw.isBye === true,
  };
}

function normalizeWave(value: unknown): TournamentWave | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const stageIndex = Number(raw.stageIndex);
  const waveIndex = Number(raw.waveIndex);
  if (!Number.isInteger(stageIndex) || stageIndex < 0) {
    return null;
  }
  if (!Number.isInteger(waveIndex) || waveIndex < 1) {
    return null;
  }
  const status = raw.status === 'completed'
    ? 'completed'
    : raw.status === 'running'
      ? 'running'
      : 'pending';
  const pairingStatus = raw.pairingStatus === 'locked' ? 'locked' : 'draft';
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.map(normalizeNode).filter((node): node is TournamentNode => Boolean(node))
    : [];

  let pairingDraft: DraftPair[] | undefined;
  if (Array.isArray(raw.pairingDraft)) {
    pairingDraft = raw.pairingDraft.map((item): DraftPair => {
      const data = (item ?? {}) as Record<string, unknown>;
      const rawPair = Array.isArray(data.pair) ? data.pair : [];
      const slot = (input: unknown): string | null => {
        const text = String(input ?? '').trim();
        return text || null;
      };
      const bucketKey = data.bucketKey === undefined ? undefined : String(data.bucketKey).trim();
      return {
        bucketKey: bucketKey || undefined,
        pair: [slot(rawPair[0]), slot(rawPair[1])],
      };
    });
  }

  return { stageIndex, waveIndex, status, pairingStatus, nodes, pairingDraft };
}

function normalizeRecord(value: unknown): TournamentRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? '').trim();
  if (!TOURNAMENT_ID_REGEX.test(id)) {
    return null;
  }
  const name = String(raw.name ?? '').trim();
  if (!name) {
    return null;
  }

  const rawIds = Array.isArray(raw.playerIds)
    ? raw.playerIds.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const playerIds = Array.from(new Set(rawIds));
  if (playerIds.length !== rawIds.length || !SUPPORTED_TOURNAMENT_SIZES.has(playerIds.length)) {
    return null;
  }

  const rawStages = Array.isArray(raw.stages) ? raw.stages : [];
  const stages = rawStages
    .map((item, index) => normalizeStageRule(item, index))
    .filter((item): item is StageRule => Boolean(item));
  if (!stages.length) {
    return null;
  }

  const status = raw.status === 'completed'
    ? 'completed'
    : raw.status === 'running'
      ? 'running'
      : 'setup';
  const seed = Number.isFinite(Number(raw.seed)) ? Math.trunc(Number(raw.seed)) >>> 0 : 0;
  const drawVersion = Number.isFinite(Number(raw.drawVersion)) && Number(raw.drawVersion) >= 0
    ? Math.trunc(Number(raw.drawVersion))
    : 0;
  const currentStageIndex = Number.isInteger(Number(raw.currentStageIndex))
    ? Math.min(Math.max(Number(raw.currentStageIndex), 0), stages.length - 1)
    : 0;

  // entries：仅接受 playerIds 范围内、当前阶段人数的条目
  const entries: TournamentEntry[] = [];
  if (Array.isArray(raw.entries)) {
    raw.entries.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const data = item as Record<string, unknown>;
      const playerId = String(data.playerId ?? '').trim();
      if (!playerId || !playerIds.includes(playerId)) {
        return;
      }
      const state = data.state === 'promoted'
        ? 'promoted'
        : data.state === 'eliminated'
          ? 'eliminated'
          : 'alive';
      entries.push({
        playerId,
        stageWins: Number.isFinite(Number(data.stageWins)) ? Math.max(0, Math.trunc(Number(data.stageWins))) : 0,
        stageLosses: Number.isFinite(Number(data.stageLosses)) ? Math.max(0, Math.trunc(Number(data.stageLosses))) : 0,
        state,
      });
    });
  }

  const waves = Array.isArray(raw.waves)
    ? raw.waves.map(normalizeWave).filter((wave): wave is TournamentWave => Boolean(wave))
    : [];

  const record: TournamentRecord = {
    id,
    name,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    status,
    seed,
    drawVersion,
    playerIds,
    stages,
    currentStageIndex,
    entries,
    waves,
  };

  if (raw.result && typeof raw.result === 'object') {
    const resultData = raw.result as Record<string, unknown>;
    const championId = String(resultData.championId ?? '').trim();
    const runnerUpId = String(resultData.runnerUpId ?? '').trim();
    if (
      championId && runnerUpId
      && championId !== runnerUpId
      && playerIds.includes(championId)
      && playerIds.includes(runnerUpId)
    ) {
      record.result = { championId, runnerUpId };
    }
  }

  return record;
}

function readRecords(paths: AppPaths): TournamentRecord[] {
  if (!fs.existsSync(paths.tournamentsFile)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(paths.tournamentsFile, 'utf-8')) as Record<string, unknown>;
    const list = Array.isArray(raw.tournaments) ? raw.tournaments : [];
    return list
      .map(normalizeRecord)
      .filter((record): record is TournamentRecord => Boolean(record));
  } catch {
    return [];
  }
}

function writeRecords(paths: AppPaths, records: TournamentRecord[]): void {
  ensureRuntimeDirs(paths);
  fs.writeFileSync(paths.tournamentsFile, JSON.stringify({ tournaments: records }, null, 2), 'utf-8');
}

/** 系列赛 id 中的编排机机器码（T{日期}_{机器码}{序号}）；解析失败返回 null */
function getOwnerCode(tournamentId: string): string | null {
  const parsed = TOURNAMENT_ID_REGEX.exec(tournamentId);
  return parsed ? parsed[2].toUpperCase() : null;
}

/**
 * 本机是否为该系列赛的编排机（id 机器码 == 本机 machineCode）。
 * 双机同步后每台机器都持有系列赛记录，但只有编排机能变更它：否则两台机器各自推进
 * 会为同一场对决重复建场（比赛 id 带各自机器码），对阵状态也会分叉。
 * 机器码未设置（两侧都为空）时按本机编排处理，保持单机既有行为。
 */
function isOwnedByLocal(paths: AppPaths, tournamentId: string): boolean {
  const machine = loadRuntimeConfig(paths).machineCode;
  const owner = getOwnerCode(tournamentId);
  return owner !== null && owner === machine;
}

/** 编排机校验：只读副本上的一切变更都要拒绝；写回钩子另行静默跳过（返回 null，不阻断比分登记） */
function assertEditable(paths: AppPaths, tournamentId: string): void {
  if (isOwnedByLocal(paths, tournamentId)) {
    return;
  }
  const owner = getOwnerCode(tournamentId);
  throw new Error(
    owner
      ? `该系列赛由机器 ${owner} 编排，请到机器 ${owner} 上操作`
      : '该系列赛创建时未设置机器标识，只能在创建它的机器上操作',
  );
}

/** 在指定系列赛上执行变更：统一更新 updatedAt、落盘，返回深拷贝避免外部篡改 */
function mutateRecord(
  paths: AppPaths,
  tournamentId: string,
  mutator: (record: TournamentRecord) => void,
): TournamentRecord {
  const records = readRecords(paths);
  const index = records.findIndex((record) => record.id === tournamentId);
  if (index === -1) {
    throw new Error('系列赛不存在');
  }
  assertEditable(paths, tournamentId);
  mutator(records[index]);
  records[index].updatedAt = new Date().toISOString();
  writeRecords(paths, records);
  return cloneRecord(records[index]);
}

export function getTournamentStore(paths: AppPaths): TournamentRecord[] {
  return readRecords(paths).map(cloneRecord);
}

/* ==================== 创建 / 抽签 / 开赛 ==================== */

export function createTournament(paths: AppPaths, payload: unknown): TournamentRecord {
  if (!payload || typeof payload !== 'object') {
    throw new Error('tournament payload must be an object');
  }
  const raw = payload as Record<string, unknown>;

  const name = String(raw.name ?? '').trim();
  if (!name) {
    throw new Error('请输入系列赛名称');
  }
  if (!Array.isArray(raw.playerIds)) {
    throw new Error('请选择参赛选手');
  }
  const playerIds = raw.playerIds.map((item) => String(item ?? '').trim());
  if (playerIds.some((id, index) => playerIds.indexOf(id) !== index)) {
    throw new Error('参赛选手不能重复');
  }
  if (!SUPPORTED_TOURNAMENT_SIZES.has(playerIds.length)) {
    throw new Error(`参赛人数必须为 ${Array.from(SUPPORTED_TOURNAMENT_SIZES).join('/')} 人`);
  }
  const profileIds = new Set(getProfileStore(paths).players.map((player) => player.id));
  if (playerIds.some((id) => !profileIds.has(id))) {
    throw new Error('参赛选手必须来自信息录入档案');
  }

  let stages: StageRule[];
  if (raw.stages === undefined || raw.stages === null) {
    stages = buildDefaultStages(playerIds.length);
  } else if (!Array.isArray(raw.stages) || !raw.stages.length) {
    throw new Error('阶段规则不合法');
  } else {
    stages = raw.stages
      .map((item, index) => normalizeStageRule(item, index))
      .filter((item): item is StageRule => Boolean(item));
    if (stages.length !== raw.stages.length) {
      throw new Error('阶段规则不合法');
    }
  }

  // 「总决赛」= 只剩 2 人的那个阶段（每阶段晋级半额，人数逐阶段减半）必须单败。
  // 2 人双败跑不出来：打完 W1 后两人分别停在 1-0 / 0-1，谁都到不了 2 胜或 2 负，
  // 接着生成的 W2 在两个「单人桶」里配不出任何一场，锁定校验会直接报「选手漏配」把系列赛卡死。
  // 判据用阶段人数而不是「最后一个阶段」：自定义阶段列表的末阶段不一定是 2 人
  // （例如只配一个 8 人双败阶段时末阶段是 8 人，那是能正常跑完的配置）。
  stages.forEach((stage, index) => {
    if (playerIds.length / 2 ** index === 2 && stage.format !== 'single-elim') {
      throw new Error('总决赛阶段必须为单败');
    }
  });

  const now = new Date();
  const records = readRecords(paths);
  const id = allocateTournamentId(paths, records, now);
  const iso = now.toISOString();
  const seed = Number.isFinite(Number(raw.seed)) ? Math.trunc(Number(raw.seed)) >>> 0 : randomSeed();

  const record: TournamentRecord = {
    id,
    name,
    createdAt: iso,
    updatedAt: iso,
    status: 'setup',
    seed,
    drawVersion: 0,
    playerIds,
    stages,
    currentStageIndex: 0,
    entries: initialEntries(playerIds),
    waves: [],
  };
  records.push(record);
  writeRecords(paths, records);
  return cloneRecord(record);
}

/** （重）抽签：仅 setup 可用，按新 seed 重洗种子顺序，drawVersion +1 */
export function redrawTournament(
  paths: AppPaths,
  tournamentId: string,
  payload?: unknown,
): TournamentRecord {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  return mutateRecord(paths, tournamentId, (record) => {
    if (record.status !== 'setup') {
      throw new Error('仅 setup 状态可重新抽签');
    }
    const newSeed = Number.isFinite(Number(body.seed)) ? Math.trunc(Number(body.seed)) >>> 0 : randomSeed();
    record.seed = newSeed;
    record.drawVersion += 1;
    // 重抽结果只取决于 seed 与选手集合：从规范（字典序）顺序做位置洗牌，
    // 与当前顺序无关，因此同一 seed 永远得到同一结果
    const canonical = [...record.playerIds].sort();
    const positions = shuffleInPlace(canonical.map((_id, index) => index), mulberry32(newSeed));
    record.playerIds = positions.map((position) => canonical[position]);
    record.entries = initialEntries(record.playerIds);
  });
}

/**
 * 只读预览首波对阵（不落盘、不建场）：按当前 seed 走与 materializeWave 完全相同的
 * generateDraftPairs，供开赛前在抽签面板看到「重抽到底换成了什么」。仅 setup 可预览。
 */
export function previewOpeningWave(
  paths: AppPaths,
  tournamentId: string,
): { pairs: NonNullable<TournamentWave['pairingDraft']> } {
  const record = readRecords(paths).find((item) => item.id === tournamentId);
  if (!record) {
    throw new Error('系列赛不存在');
  }
  if (record.status !== 'setup') {
    throw new Error('仅 setup 状态可预览首波对阵');
  }
  return { pairs: generateDraftPairs(record, record.stages[0], 0, 1) };
}

/**
 * 生成某波：先生成配对草稿；手动配对/需确认 → 停在 draft（不建场），
 * 否则自动锁定并批量建场。
 */
function materializeWave(
  paths: AppPaths,
  record: TournamentRecord,
  stageIndex: number,
  waveIndex: number,
): void {
  const stage = record.stages[stageIndex];
  const draftPairs = generateDraftPairs(record, stage, stageIndex, waveIndex);
  const wave: TournamentWave = {
    stageIndex,
    waveIndex,
    status: 'pending',
    pairingStatus: 'draft',
    pairingDraft: draftPairs,
    nodes: [],
  };
  record.waves.push(wave);

  if (needsDraft(stage)) {
    return;
  }
  lockDraftPairs(paths, record, wave, draftPairs, false);
}

/** 开赛：setup → running，生成阶段 0 第 1 波（自动锁定或 draft） */
export function startTournament(paths: AppPaths, tournamentId: string): TournamentRecord {
  return mutateRecord(paths, tournamentId, (record) => {
    if (record.status !== 'setup') {
      throw new Error('仅 setup 状态可开赛');
    }
    record.status = 'running';
    materializeWave(paths, record, 0, 1);
  });
}

/* ==================== 分桶与配对生成 ==================== */

/** 双败某波的战绩桶（仅取 alive 选手，顺序随 entries/种子顺序） */
function doubleBucketSpecs(
  entries: TournamentEntry[],
  waveIndex: number,
): Array<{ key: string; players: string[] }> {
  const alive = entries.filter((entry) => entry.state === 'alive');
  if (waveIndex === 1) {
    return [{ key: '0-0', players: alive.map((entry) => entry.playerId) }];
  }
  if (waveIndex === 2) {
    return [
      { key: '1-0', players: alive.filter((e) => e.stageWins === 1 && e.stageLosses === 0).map((e) => e.playerId) },
      { key: '0-1', players: alive.filter((e) => e.stageWins === 0 && e.stageLosses === 1).map((e) => e.playerId) },
    ];
  }
  return [{
    key: '1-1',
    players: alive.filter((e) => e.stageWins === 1 && e.stageLosses === 1).map((e) => e.playerId),
  }];
}

/** 双败决胜波（W3）的 1-1 池 key */
const DOUBLE_LIFE_DECIDER_BUCKET = '1-1';

/**
 * 该选手在本阶段第 1 波是否取胜。
 * 决胜波 1-1 池里的两类人靠它区分：W1 取胜者是「胜者组掉落者」，W1 落败者是「败者组上扬者」。
 */
function wonOpeningRound(record: TournamentRecord, stageIndex: number, playerId: string): boolean {
  const wave1 = record.waves.find((wave) => wave.stageIndex === stageIndex && wave.waveIndex === 1);
  const node = wave1?.nodes.find((item) => item.playerAId === playerId || item.playerBId === playerId);
  return node?.winnerId === playerId;
}

/** 本阶段已交手记录（含 winnerId 的节点） */
function buildPlayedMap(record: TournamentRecord, stageIndex: number): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string): void => {
    if (!map.has(a)) {
      map.set(a, new Set());
    }
    map.get(a)!.add(b);
  };
  record.waves
    .filter((wave) => wave.stageIndex === stageIndex)
    .forEach((wave) => wave.nodes.forEach((node) => {
      if (node.winnerId && node.playerAId && node.playerBId) {
        add(node.playerAId, node.playerBId);
        add(node.playerBId, node.playerAId);
      }
    }));
  return map;
}

/**
 * 桶内随机配对（greedy）：依次取首位选手，从对手池中随机选；
 * avoid=true 时先过滤本阶段已交手对手，无法完全避开再放行。RNG 决定全部随机选择。
 */
function pairWithAvoidance(
  players: string[],
  rng: () => number,
  played: Map<string, Set<string>>,
  avoid: boolean,
): Array<[string, string]> {
  const pool = [...players];
  const pairs: Array<[string, string]> = [];

  while (pool.length >= 2) {
    const first = pool.shift()!;
    let options = pool.map((_player, index) => index);
    const safeOptions = options.filter((index) => !(avoid && played.get(first)?.has(pool[index])));
    if (safeOptions.length) {
      options = safeOptions;
    }
    const pick = options[Math.floor(rng() * options.length)];
    const second = pool.splice(pick, 1)[0];
    pairs.push([first, second]);
  }

  return pairs;
}

/**
 * 交叉配对：左侧每人依次从右侧剩余池中随机取一人（双败决胜波两类人互配用）。
 * avoid=true 时优先跳过本阶段已交手对手；两侧人数相等时恰好一一配对。
 */
function crossPair(
  left: string[],
  right: string[],
  rng: () => number,
  played: Map<string, Set<string>>,
  avoid: boolean,
): Array<[string, string]> {
  const pool = [...right];
  const pairs: Array<[string, string]> = [];

  left.forEach((first) => {
    const indexes = pool.map((_player, index) => index);
    const safeIndexes = indexes.filter((index) => !(avoid && played.get(first)?.has(pool[index])));
    const options = safeIndexes.length ? safeIndexes : indexes;
    const second = pool.splice(options[Math.floor(rng() * options.length)], 1)[0];
    pairs.push([first, second]);
  });

  return pairs;
}

/** 标准单败种子位：返回位置序列（相邻两项即一对），如 8 人 = 0,7,3,4,1,6,2,5 */
function bracketPositions(size: number): number[] {
  let positions = [0];
  while (positions.length < size) {
    const length = positions.length;
    positions = positions.flatMap((position) => [position, 2 * length - 1 - position]);
  }
  return positions;
}

function pairsFromOrdered(ordered: string[], bucketKey?: string): DraftPair[] {
  const result: DraftPair[] = [];
  for (let i = 0; i < ordered.length; i += 2) {
    result.push({ bucketKey, pair: [ordered[i], ordered[i + 1] ?? null] });
  }
  return result;
}

/** 生成某波配对草稿（随机自动与手动模式都从它起，手动模式仅作为草稿起点） */
function generateDraftPairs(
  record: TournamentRecord,
  stage: StageRule,
  stageIndex: number,
  waveIndex: number,
): DraftPair[] {
  const rng = waveRng(record, stageIndex, waveIndex);

  if (stage.format === 'single-elim') {
    const players = record.entries.filter((entry) => entry.state === 'alive').map((entry) => entry.playerId);
    let ordered: string[];
    if (stage.pairing === 'random-round') {
      ordered = shuffleInPlace([...players], rng);
    } else if (stageIndex === 0) {
      // 首轮：按标准种子位配对（仅整个系列赛的第一阶段这一次）
      ordered = bracketPositions(players.length).map((position) => players[position]);
    } else {
      // 后续阶段：entries 已按上一阶段对阵树顺序排列（progressFromWave），
      // 直接相邻配对即可延续固定对阵树，避免每轮重新种子导致相邻两场胜者不相遇
      ordered = players;
    }
    return pairsFromOrdered(ordered, undefined);
  }

  const specs = doubleBucketSpecs(record.entries, waveIndex);
  const played = buildPlayedMap(record, stageIndex);
  // 避免重复对手只在随机模式生效；手动模式也给随机草稿起点
  const avoid = stage.pairing === 'random-bucket' && stage.avoidRematch;
  const result: DraftPair[] = [];
  specs.forEach((spec) => {
    // 决胜波（W3）的 1-1 池由两类人构成：W1 取胜后掉落的（胜者组掉落者）与 W1 落败后上扬的（败者组胜者）。
    // 按经典双败交叉配对，两类人互不相遇，而不是同池随机。
    if (spec.key === DOUBLE_LIFE_DECIDER_BUCKET) {
      const drops: string[] = [];
      const rises: string[] = [];
      spec.players.forEach((playerId) => {
        (wonOpeningRound(record, stageIndex, playerId) ? drops : rises).push(playerId);
      });
      shuffleInPlace(drops, rng);
      shuffleInPlace(rises, rng);
      crossPair(drops, rises, rng, played, avoid).forEach((pair) => result.push({ bucketKey: spec.key, pair }));
      return;
    }
    const pairs = pairWithAvoidance(spec.players, rng, played, avoid);
    pairs.forEach((pair) => result.push({ bucketKey: spec.key, pair }));
  });
  return result;
}

/** 该波是否必须停在 draft（手动配对 或 需目检确认） */
function needsDraft(stage: StageRule): boolean {
  return stage.pairing === 'manual-bucket' || stage.requireConfirm;
}

/* ==================== 配对校验与锁定建场 ==================== */

/** 选手当前战绩桶 key（双败），单败/无 entries 返回 undefined */
function playerBucketKey(record: TournamentRecord, playerId: string): string | undefined {
  const entry = record.entries.find((item) => item.playerId === playerId);
  if (!entry) {
    return undefined;
  }
  return `${entry.stageWins}-${entry.stageLosses}`;
}

function hasPlayed(record: TournamentRecord, stageIndex: number, a: string, b: string): boolean {
  return record.waves
    .filter((wave) => wave.stageIndex === stageIndex)
    .some((wave) => wave.nodes.some((node) => node.winnerId
      && ((node.playerAId === a && node.playerBId === b) || (node.playerAId === b && node.playerBId === a))));
}

/** 配对校验：每人恰好一次、同桶严格（跨桶需显式允许）、已交手仅提醒 */
function validatePairs(
  record: TournamentRecord,
  wave: TournamentWave,
  pairs: DraftPair[],
  allowCrossBucket: boolean,
): PairingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 期望选手 id → 桶 key（单败 undefined）
  const expected = new Map<string, string | undefined>();
  if (record.stages[wave.stageIndex].format === 'double-life') {
    doubleBucketSpecs(record.entries, wave.waveIndex).forEach((spec) => {
      spec.players.forEach((id) => expected.set(id, spec.key));
    });
  } else {
    record.entries.filter((entry) => entry.state === 'alive').forEach((entry) => expected.set(entry.playerId, undefined));
  }

  const seen = new Map<string, number>();
  pairs.forEach((draftPair, rowIndex) => {
    const [a, b] = draftPair.pair;
    if (!a || !b) {
      errors.push(`第 ${rowIndex + 1} 场存在漏配（未配对）`);
    }
    if (a) {
      seen.set(a, (seen.get(a) ?? 0) + 1);
      if (!expected.has(a)) {
        errors.push(`第 ${rowIndex + 1} 场选手不在本波名单`);
      }
    }
    if (b) {
      seen.set(b, (seen.get(b) ?? 0) + 1)
      if (!expected.has(b)) {
        errors.push(`第 ${rowIndex + 1} 场选手不在本波名单`);
      }
    }
    if (a && b && a === b) {
      errors.push(`第 ${rowIndex + 1} 场不能自己对自己`);
    }
    if (a && b) {
      const bucketA = expected.get(a);
      const bucketB = expected.get(b);
      if (bucketA !== undefined && bucketB !== undefined && bucketA !== bucketB && !allowCrossBucket) {
        errors.push(`第 ${rowIndex + 1} 场为跨桶配对（战绩不对等），需显式允许`);
      }
      if (hasPlayed(record, wave.stageIndex, a, b)) {
        warnings.push(`第 ${rowIndex + 1} 场双方本阶段已交手过`);
      }
    }
  });

  seen.forEach((count, id) => {
    if (count > 1) {
      errors.push(`选手重复出现在 ${count} 场对决中：${id}`);
    }
  });
  expected.forEach((_bucket, id) => {
    if (!seen.has(id)) {
      errors.push(`选手漏配：${id}`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

function isCrossPair(record: TournamentRecord, draftPair: DraftPair): boolean {
  const [a, b] = draftPair.pair;
  if (!a || !b) {
    return false;
  }
  const bucketA = playerBucketKey(record, a);
  const bucketB = playerBucketKey(record, b);
  if (bucketA === undefined || bucketB === undefined) {
    return false;
  }
  return bucketA !== bucketB;
}

/** 自动标签：赛事名 + 阶段名 + W波次（跨桶追加标注） */
function buildWaveTags(
  record: TournamentRecord,
  stage: StageRule,
  wave: TournamentWave,
  cross: boolean,
): string[] {
  const tags = [record.name, stage.name, `W${wave.waveIndex}`];
  if (cross) {
    tags.push(TOURNAMENT_CROSS_BUCKET_TAG);
  }
  return Array.from(new Set(tags));
}

/**
 * 锁定配对：先整体校验（错误先于任何建场副作用），再逐对 createMatch 并登记 nodes。
 * createMatch 的 tournamentRef 与 nodeId 一一对应；返回后波状态为 locked/running。
 */
function lockDraftPairs(
  paths: AppPaths,
  record: TournamentRecord,
  wave: TournamentWave,
  pairs: DraftPair[],
  allowCrossBucket: boolean,
): void {
  const validation = validatePairs(record, wave, pairs, allowCrossBucket);
  if (!validation.valid) {
    throw new Error(validation.errors.join('；'));
  }

  const stage = record.stages[wave.stageIndex];
  const profileById = new Map(getProfileStore(paths).players.map((player) => [player.id, player]));
  const nodes: TournamentNode[] = [];

  pairs.forEach((draftPair, index) => {
    const [a, b] = draftPair.pair;
    const nodeId = `s${wave.stageIndex}-w${wave.waveIndex}-n${String(index).padStart(2, '0')}`;
    const cross = isCrossPair(record, draftPair);
    const leftProfile = profileById.get(a ?? '');
    const rightProfile = profileById.get(b ?? '');
    const created = createMatch(paths, {
      leftPlayer: leftProfile?.name,
      rightPlayer: rightProfile?.name,
      // 排位排名随建场从档案快照（与前端「快速创建比赛」一致，保证推流页 rank 区有数据）
      leftRank: leftProfile?.rank ?? '',
      rightRank: rightProfile?.rank ?? '',
      bestOf: stage.bestOf,
      tags: buildWaveTags(record, stage, wave, cross),
      tournamentRef: {
        tournamentId: record.id,
        nodeId,
        stageIndex: wave.stageIndex,
        waveIndex: wave.waveIndex,
      },
    });
    nodes.push({
      id: nodeId,
      matchId: created.activeMatchId,
      playerAId: a,
      playerBId: b,
      winnerId: null,
      isBye: false,
    });
  });

  wave.nodes = nodes;
  wave.pairingStatus = 'locked';
  wave.status = 'running';
  delete wave.pairingDraft;
}

function parseWaveGlobalIndex(record: TournamentRecord, value: unknown): number {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= record.waves.length) {
    throw new Error('波次不存在');
  }
  return index;
}

/** 暂存配对草稿（编辑中间态允许漏配/重复；仅做字段白名单与选手范围校验） */
export function savePairingDraft(
  paths: AppPaths,
  tournamentId: string,
  rawWaveIndex: unknown,
  payload: unknown,
): TournamentRecord {
  if (!payload || typeof payload !== 'object') {
    throw new Error('pairings payload must be an object');
  }
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.pairings)) {
    throw new Error('pairings must be a list');
  }

  return mutateRecord(paths, tournamentId, (record) => {
    const waveIndex = parseWaveGlobalIndex(record, rawWaveIndex);
    const wave = record.waves[waveIndex];
    if (wave.pairingStatus !== 'draft') {
      throw new Error('仅 draft 波可暂存配对');
    }

    const stage = record.stages[wave.stageIndex];
    const allowedKeys = new Set<string>();
    if (stage.format === 'double-life') {
      doubleBucketSpecs(record.entries, wave.waveIndex).forEach((spec) => allowedKeys.add(spec.key));
    }
    const stagePlayers = new Set(record.entries.map((entry) => entry.playerId));

    const rawPairings = body.pairings as unknown[];
    wave.pairingDraft = rawPairings.map((item): DraftPair => {
      const data = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const rawPair = Array.isArray(data.pair) ? data.pair : [];
      const slot = (input: unknown): string | null => {
        const text = String(input ?? '').trim();
        return text && stagePlayers.has(text) ? text : null;
      };
      const pair: [string | null, string | null] = [slot(rawPair[0]), slot(rawPair[1])];

      let bucketKey: string | undefined;
      const rawKey = String(data.bucketKey ?? '').trim();
      if (rawKey && allowedKeys.has(rawKey)) {
        bucketKey = rawKey;
      } else if (pair[0] && stage.format === 'double-life') {
        const derived = playerBucketKey(record, pair[0]);
        if (derived && allowedKeys.has(derived)) {
          bucketKey = derived;
        }
      }
      return { bucketKey, pair };
    });
  });
}

/** 锁定配对并批量建场（跨桶需 allowCrossBucket） */
export function lockPairings(
  paths: AppPaths,
  tournamentId: string,
  rawWaveIndex: unknown,
  payload: unknown,
): TournamentRecord {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  return mutateRecord(paths, tournamentId, (record) => {
    const waveIndex = parseWaveGlobalIndex(record, rawWaveIndex);
    const wave = record.waves[waveIndex];
    if (wave.pairingStatus !== 'draft') {
      throw new Error('仅 draft 波可锁定配对');
    }
    const draft = Array.isArray(wave.pairingDraft) ? wave.pairingDraft : [];
    lockDraftPairs(paths, record, wave, draft, body.allowCrossBucket === true);
  });
}

/**
 * requireConfirm 手动确认：对最后一波 draft 重新随机并直接锁定建场。
 * 手动配对波不走这里（请在确认台编辑后锁定）。
 */
export function advanceTournament(paths: AppPaths, tournamentId: string): TournamentRecord {
  return mutateRecord(paths, tournamentId, (record) => {
    if (!record.waves.length) {
      throw new Error('没有可确认的波次');
    }
    const wave = record.waves[record.waves.length - 1];
    if (wave.pairingStatus !== 'draft') {
      throw new Error('仅 draft 波可确认推进');
    }
    const stage = record.stages[wave.stageIndex];
    if (stage.pairing === 'manual-bucket') {
      throw new Error('手动配对请在配对确认台编辑后锁定');
    }
    const freshPairs = generateDraftPairs(record, stage, wave.stageIndex, wave.waveIndex);
    lockDraftPairs(paths, record, wave, freshPairs, false);
  });
}

/* ==================== 比赛完成 / 撤回 钩子 ==================== */

function deriveState(
  format: StageFormat,
  wins: number,
  losses: number,
  isWinner: boolean,
): TournamentEntry['state'] {
  if (format === 'single-elim') {
    return isWinner ? 'promoted' : 'eliminated';
  }
  if (wins >= TOURNAMENT_TARGET_WINS) {
    return 'promoted';
  }
  if (losses >= TOURNAMENT_TARGET_LOSSES) {
    return 'eliminated';
  }
  return 'alive';
}

/** 把一个节点的胜负写入 entries（更新胜/负与状态） */
function applyGameResult(
  record: TournamentRecord,
  wave: TournamentWave,
  winnerId: string,
  loserId: string,
): void {
  const format = record.stages[wave.stageIndex].format;
  const winnerEntry = record.entries.find((entry) => entry.playerId === winnerId);
  if (winnerEntry) {
    winnerEntry.stageWins += 1;
    winnerEntry.state = deriveState(format, winnerEntry.stageWins, winnerEntry.stageLosses, true);
  }
  const loserEntry = record.entries.find((entry) => entry.playerId === loserId);
  if (loserEntry) {
    loserEntry.stageLosses += 1;
    loserEntry.state = deriveState(format, loserEntry.stageWins, loserEntry.stageLosses, false);
  }
}

/** 节点序号（`s0-w2-n03` → 3），解析失败排到末尾 */
function parseNodeIndex(nodeId: string): number {
  const matched = /-n(\d+)$/.exec(nodeId);
  return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * 晋级选手在上一阶段的「对阵树位置」：取该选手获胜节点的 (waveIndex, nodeIndex)。
 * 单败阶段每人只打一场，等价于按节点序号；双败阶段则胜者组出线者在前、败者组出线者随后。
 * 用于换批进入下一阶段时保持对阵树顺序（而非全局种子序），使相邻两场胜者相遇。
 */
function bracketOrderOfStage(record: TournamentRecord, stageIndex: number): Map<string, number> {
  const order = new Map<string, number>();
  record.waves
    .filter((wave) => wave.stageIndex === stageIndex)
    .forEach((wave) => {
      wave.nodes.forEach((node) => {
        if (!node.winnerId) {
          return;
        }
        // 同一选手可能多次获胜（双败），取最靠后的波次作为其晋级节点
        const key = wave.waveIndex * 1000 + parseNodeIndex(node.id);
        const current = order.get(node.winnerId);
        if (current === undefined || key > current) {
          order.set(node.winnerId, key);
        }
      });
    });
  return order;
}

/** 波次完成后的阶段/波次推进 */
function progressFromWave(
  paths: AppPaths,
  record: TournamentRecord,
  wave: TournamentWave,
): void {
  const promotedCount = record.entries.filter((entry) => entry.state === 'promoted').length;
  const half = record.entries.length / 2;

  if (promotedCount === half) {
    if (wave.stageIndex === record.stages.length - 1) {
      // 总决赛阶段结束：冠军/亚军
      const finalNode = wave.nodes.find((node) => node.winnerId);
      if (finalNode && finalNode.winnerId) {
        record.result = {
          championId: finalNode.winnerId,
          runnerUpId: finalNode.winnerId === finalNode.playerAId
            ? finalNode.playerBId ?? ''
            : finalNode.playerAId ?? '',
        };
        record.status = 'completed';
      }
      return;
    }

    // 进入下一阶段：promoted 选手换批清零，按上一阶段对阵树顺序排列（保持固定对阵树）
    const nextStageIndex = wave.stageIndex + 1;
    record.currentStageIndex = nextStageIndex;
    const bracketOrder = bracketOrderOfStage(record, wave.stageIndex);
    const promotedIds = record.entries
      .filter((entry) => entry.state === 'promoted')
      .map((entry, index) => ({ playerId: entry.playerId, index }))
      .sort((left, right) => {
        const leftKey = bracketOrder.get(left.playerId) ?? Number.MAX_SAFE_INTEGER;
        const rightKey = bracketOrder.get(right.playerId) ?? Number.MAX_SAFE_INTEGER;
        return leftKey - rightKey || left.index - right.index;
      })
      .map((item) => item.playerId);
    record.entries = initialEntries(promotedIds);
    materializeWave(paths, record, nextStageIndex, 1);
    return;
  }

  // 双败后续波（W1→W2→W3）
  if (record.stages[wave.stageIndex].format === 'double-life' && wave.waveIndex < 3) {
    materializeWave(paths, record, wave.stageIndex, wave.waveIndex + 1);
  }
}

/**
 * 比赛完成钩子：无 tournamentRef / 比赛未真正结束 → 无副作用返回 null。
 * 节点已有胜者 = 幂等。波次凑齐后自动生成下一波/下一阶段或冠军。
 */
export function onMatchCompleted(paths: AppPaths, matchId: string): TournamentRecord | null {
  const match = getMatchStore(paths).matches.find((item) => item.id === matchId);
  if (!match || !match.tournamentRef || match.status !== 'completed') {
    return null;
  }
  const ref = match.tournamentRef;
  let output: TournamentRecord | null = null;

  // 系列赛已被删除（正常删除时会先解绑，这里兜底撤销恢复等渠道留下的孤儿引用）、
  // 或本机只是只读副本（系列赛由另一台机器编排）：
  // 按普通对局处理，不阻断比分登记
  if (!readRecords(paths).some((record) => record.id === ref.tournamentId)
    || !isOwnedByLocal(paths, ref.tournamentId)) {
    return null;
  }

  mutateRecord(paths, ref.tournamentId, (record) => {
    const wave = record.waves.find((item) => item.stageIndex === ref.stageIndex && item.waveIndex === ref.waveIndex);
    if (!wave) {
      throw new Error('系列赛波次不存在');
    }
    const node = wave.nodes.find((item) => item.id === ref.nodeId);
    if (!node) {
      throw new Error('系列赛节点不存在');
    }
    if (node.winnerId) {
      output = record;
      return;
    }

    // 校验比赛选手与节点一致（防止错改名字后错误写回）
    const profileNames = new Map(getProfileStore(paths).players.map((player) => [player.id, player.name]));
    const nameA = profileNames.get(node.playerAId ?? '');
    const nameB = profileNames.get(node.playerBId ?? '');
    if (match.leftPlayer !== nameA || match.rightPlayer !== nameB) {
      throw new Error(`比赛选手与系列赛节点不一致（节点应为：${nameA} vs ${nameB}）`);
    }

    const winnerId = match.winner === 'left' ? node.playerAId : node.playerBId;
    const loserId = match.winner === 'left' ? node.playerBId : node.playerAId;
    node.winnerId = winnerId;
    applyGameResult(record, wave, winnerId ?? '', loserId ?? '');

    if (wave.nodes.every((item) => item.winnerId)) {
      wave.status = 'completed';
      progressFromWave(paths, record, wave);
    }
    output = record;
  });

  return output ? cloneRecord(output) : null;
}

/**
 * 该波之后自动生成的波能否随本次撤回一并丢弃：必须全部是「自动锁定（非人工草稿）且一场未打」。
 * - pairingStatus !== draft：人工配对/需确认的波停在草稿，是人工成果，不能静默删除；
 * - 每场都没开打（pending 且无任何小局结果）：已有赛果的波删掉会丢数据，要求走「回退上一波」。
 */
function isDiscardableTrailingWaves(paths: AppPaths, waves: TournamentWave[]): boolean {
  const matches = getMatchStore(paths).matches;
  return waves.every((wave) => {
    if (wave.pairingStatus !== 'locked') {
      return false;
    }
    return wave.nodes.every((node) => {
      if (node.winnerId) {
        return false;
      }
      const match = matches.find((item) => item.id === node.matchId);
      return Boolean(match)
        && match!.status === 'pending'
        && match!.games.every((game) => game.status === 'pending' && game.winner === null);
    });
  });
}

/**
 * 撤回小局反向钩子：清节点胜者并重算该阶段战绩。
 * 该波已推进（自动生成了下一波 / 进入下一阶段）时，只要后续波都是「自动锁定且一场未打」，
 * 就一并丢弃它们回到「结果待定」；否则拒绝并提示走「回退上一波」。
 * 节点无胜者（撤回的是非决胜小局）→ 无变化。
 */
export function onMatchUndo(paths: AppPaths, matchId: string): TournamentRecord | null {
  const match = getMatchStore(paths).matches.find((item) => item.id === matchId);
  if (!match || !match.tournamentRef) {
    return null;
  }
  const ref = match.tournamentRef;
  let output: TournamentRecord | null = null;

  // 同 onMatchCompleted：系列赛已删除或本机只是只读副本则无需写回，不阻断撤回
  if (!readRecords(paths).some((record) => record.id === ref.tournamentId)
    || !isOwnedByLocal(paths, ref.tournamentId)) {
    return null;
  }

  mutateRecord(paths, ref.tournamentId, (record) => {
    const globalIndex = record.waves.findIndex(
      (wave) => wave.stageIndex === ref.stageIndex && wave.waveIndex === ref.waveIndex,
    );
    if (globalIndex === -1) {
      throw new Error('系列赛波次不存在');
    }

    const wave = record.waves[globalIndex];
    const node = wave.nodes.find((item) => item.id === ref.nodeId);
    if (!node || !node.winnerId) {
      // 撤回的是非决胜小局：系列赛无变化（返回 null，不广播）
      return;
    }

    // 该波可能因为这场的结果打完而自动推进（生成了下一波 / 已进入下一阶段）。
    // 只要后续波全部是「自动锁定且一场未打」，就随这次撤回一并丢弃，回到「该波结果待定」；
    // 手工草稿（draft）或已有赛果的后续波不能静默删掉，仍要求走「回退上一波」。
    const trailingWaves = record.waves.slice(globalIndex + 1);
    if (trailingWaves.length) {
      if (!isDiscardableTrailingWaves(paths, trailingWaves)) {
        throw new Error('该波已推进，且后续波已开打或为人工对阵，请使用「回退上一波」');
      }
      const trailingMatchIds = trailingWaves
        .flatMap((item) => item.nodes.map((trailingNode) => trailingNode.matchId))
        .filter((id): id is string => Boolean(id));
      if (trailingMatchIds.length) {
        // 与 rollbackWave 同口径：软删（可在比赛管理「撤回最近删除」恢复）
        deleteMatches(paths, trailingMatchIds);
      }
      record.waves = record.waves.slice(0, globalIndex + 1);
      record.currentStageIndex = wave.stageIndex;
    }

    node.winnerId = null;
    if (wave.status === 'completed') {
      wave.status = 'running';
    }
    // 按该阶段现存节点重算战绩：同阶段撤回与跨阶段回退（entries 已换批清零）都能得到正确口径
    recomputeStageEntries(record, wave.stageIndex);
    // 系列赛因此退出完赛态：撤销冠军结果（与整体回退口径一致）
    if (record.status === 'completed') {
      record.status = 'running';
      delete record.result;
    }
    output = record;
  });

  return output ? cloneRecord(output) : null;
}

/* ==================== 双机同步：系列赛导入合并与写回补跑 ==================== */

export interface MergeTournamentRecordsReport {
  added: string[];
  updated: string[];
  skipped: Array<{ id: string; reason: string }>;
  /** 结构不合法被忽略的条目数 */
  rejected: number;
}

/**
 * 合并包内系列赛（编排数据随同步包流转，自动合并、不参与逐条勾选）：
 * - 本机不存在 → 新增（只读副本首次拿到对阵图）；
 * - 内容相同 → 跳过（幂等，重复导入无副作用）；
 * - 内容有差异 → 默认按 updatedAt「较新覆盖」，bundle 模式以包为准直接覆盖。
 * 只有编排机会修改系列赛，只读副本的本地版本不会新于包内，因此不会反向覆盖编排机。
 */
export function mergeTournamentRecords(
  paths: AppPaths,
  incoming: unknown[],
  mode: SyncConflictMode,
): MergeTournamentRecordsReport {
  const records = readRecords(paths);
  const indexById = new Map(records.map((record, index) => [record.id, index]));
  const added: string[] = [];
  const updated: string[] = [];
  const skipped: MergeTournamentRecordsReport['skipped'] = [];
  let rejected = 0;

  incoming.forEach((raw) => {
    const record = normalizeRecord(raw);
    if (!record) {
      rejected += 1;
      return;
    }
    const localIndex = indexById.get(record.id);
    if (localIndex === undefined) {
      indexById.set(record.id, records.length);
      records.push(record);
      added.push(record.id);
      return;
    }
    const local = records[localIndex];
    if (JSON.stringify(local) === JSON.stringify(record)) {
      skipped.push({ id: record.id, reason: '与包内内容相同' });
      return;
    }
    if (mode === 'bundle' || isIncomingNewer(record.updatedAt, local.updatedAt)) {
      records[localIndex] = record;
      updated.push(record.id);
      return;
    }
    skipped.push({ id: record.id, reason: '本机版本不早于包内（保持本机）' });
  });

  if (added.length || updated.length) {
    writeRecords(paths, records);
  }
  return { added, updated, skipped, rejected };
}

/** 包内版本是否更新（与比赛导入同口径：先解析时间，解析不出退化为字符串比较） */
function isIncomingNewer(incoming: string, local: string): boolean {
  const incomingMs = Date.parse(incoming);
  const localMs = Date.parse(local);
  return Number.isFinite(incomingMs) && Number.isFinite(localMs)
    ? incomingMs > localMs
    : String(incoming) > String(local);
}

export interface TournamentWriteBackReport {
  /** 写回是否真正改动了系列赛内容（已排除 updatedAt 空转） */
  advanced: boolean;
  warnings: string[];
}

/**
 * 同步导入后的写回补跑：对本机全部「已完成 + 带 tournamentRef」的比赛逐场执行完成钩子。
 * - 钩子幂等：节点已有胜者直接跳过，重复导入不会重复推进；
 * - 只读副本（本机不是该系列赛编排机）自动跳过，不阻断比赛登记；
 * - 最后一场补齐时自动推进（生成下一波 / 总冠军）——双机「各登记一半、汇合推进」的关键一步；
 * - 赛果与已写回节点胜者不一致（如协作机撤回重登后回传）时记 warning，提示人工走「回退上一波」。
 */
export function runTournamentWriteBack(paths: AppPaths): TournamentWriteBackReport {
  const warnings: string[] = [];
  let advanced = false;

  getMatchStore(paths).matches.forEach((match) => {
    if (match.status !== 'completed' || !match.tournamentRef) {
      return;
    }
    const tournamentId = match.tournamentRef.tournamentId;
    const before = tournamentDigest(paths, tournamentId);
    try {
      const updated = onMatchCompleted(paths, match.id);
      if (updated && tournamentDigest(paths, tournamentId) !== before) {
        advanced = true;
      }
    } catch (error) {
      warnings.push(
        `「${match.leftPlayer} vs ${match.rightPlayer}」未能写回系列赛：${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const mismatch = tournamentResultMismatch(paths, match);
    if (mismatch) {
      warnings.push(mismatch);
    }
  });

  return { advanced, warnings };
}

/**
 * 赛果与系列赛节点胜者不一致检测（钩子幂等不会覆盖已写回的旧胜者）：
 * 返回人工处理提示，正常（一致 / 无节点胜者）返回 null。
 */
function tournamentResultMismatch(paths: AppPaths, match: MatchRecord): string | null {
  const ref = match.tournamentRef;
  if (!ref) {
    return null;
  }
  const record = readRecords(paths).find((item) => item.id === ref.tournamentId);
  const node = record?.waves
    .find((item) => item.stageIndex === ref.stageIndex && item.waveIndex === ref.waveIndex)
    ?.nodes.find((item) => item.id === ref.nodeId);
  if (!node?.winnerId) {
    return null;
  }
  const expected = match.winner === 'left' ? node.playerAId : node.playerBId;
  if (expected && node.winnerId === expected) {
    return null;
  }
  return `「${match.leftPlayer} vs ${match.rightPlayer}」的赛果与系列赛记录不一致（系列赛已按旧赛果推进），请在系列赛视图走「回退上一波」后重新登记`;
}

/** 系列赛内容摘要（排除每次变更都会刷新的 updatedAt），用于判断写回是否真正改了内容 */
function tournamentDigest(paths: AppPaths, tournamentId: string): string {
  const record = readRecords(paths).find((item) => item.id === tournamentId);
  if (!record) {
    return '';
  }
  const { updatedAt: _unused, ...rest } = record;
  return JSON.stringify(rest);
}

/* ==================== 波次回退 ==================== */

/** 按该阶段现存节点的真实结果重算 entries（换阶段清零口径） */
function recomputeStageEntries(record: TournamentRecord, stageIndex: number): void {
  let initialIds: string[];
  if (stageIndex === 0) {
    initialIds = [...record.playerIds];
  } else {
    const wave1 = record.waves.find((wave) => wave.stageIndex === stageIndex && wave.waveIndex === 1);
    const idSet = new Set<string>();
    wave1?.nodes.forEach((node) => {
      if (node.playerAId) {
        idSet.add(node.playerAId);
      }
      if (node.playerBId) {
        idSet.add(node.playerBId);
      }
    });
    // 保持 wave1 节点里的出现顺序 = 上一阶段对阵树顺序（与 progressFromWave 写入 entries 的口径一致）；
    // 若改回按全局种子排序，单败阶段重新配对时会退回「重新种子」，相邻两场胜者就不相遇了。
    initialIds = Array.from(idSet);
  }

  const entries = initialEntries(initialIds);
  const format = record.stages[stageIndex].format;
  record.waves
    .filter((wave) => wave.stageIndex === stageIndex)
    .sort((a, b) => a.waveIndex - b.waveIndex)
    .forEach((wave) => wave.nodes.forEach((node) => {
      if (!node.winnerId) {
        return;
      }
      const winnerId = node.winnerId;
      const loserId = winnerId === node.playerAId ? node.playerBId : node.playerAId;
      const winnerEntry = entries.find((entry) => entry.playerId === winnerId);
      if (winnerEntry) {
        winnerEntry.stageWins += 1;
        winnerEntry.state = deriveState(format, winnerEntry.stageWins, winnerEntry.stageLosses, true);
      }
      const loserEntry = entries.find((entry) => entry.playerId === loserId);
      if (loserEntry) {
        loserEntry.stageLosses += 1;
        loserEntry.state = deriveState(format, loserEntry.stageWins, loserEntry.stageLosses, false);
      }
    }));

  record.entries = entries;
}

/**
 * 管理级波次回退（最后波）：
 * - 整波刚打完（总决赛完赛）：波保留，比赛复位 pending、清节点胜者、撤销冠军、重算战绩；
 * - 波未打（pending/draft）：删除未打比赛与波（deleteMatches 可恢复），重开上一波；
 * - 部分进行：拒绝，提示逐场撤销。跨阶段时 currentStageIndex 回落。
 */
export function rollbackWave(paths: AppPaths, tournamentId: string): TournamentRecord {
  return mutateRecord(paths, tournamentId, (record) => {
    if (!record.waves.length) {
      throw new Error('没有可回退的波次');
    }

    const globalIndex = record.waves.length - 1;
    const wave = record.waves[globalIndex];
    const matches = getMatchStore(paths).matches;

    let matchIds: string[] = [];
    // 「干净未打」= pending 且无任何小局结果；「整波完成」= 波已完成且比赛全 completed
    let wavePristine = true;
    let waveFullyCompleted = wave.status === 'completed';

    if (wave.pairingStatus === 'locked') {
      matchIds = wave.nodes.map((node) => node.matchId).filter((id): id is string => Boolean(id));
      matchIds.forEach((matchId) => {
        const match = matches.find((item) => item.id === matchId);
        const pristine = Boolean(match)
          && match!.status === 'pending'
          && match!.games.every((game) => game.status === 'pending' && game.winner === null);
        if (!pristine) {
          wavePristine = false;
        }
        if (!match || match.status !== 'completed') {
          waveFullyCompleted = false;
        }
      });
    }

    /**
     * 分支 A：整波刚打完（总决赛完赛、系列赛 completed）。
     * 波本身保留：清节点胜者、比赛复位 pending、撤销冠军结果，重算该阶段 entries。
     */
    if (wave.pairingStatus === 'locked' && waveFullyCompleted) {
      wave.nodes.forEach((node) => {
        node.winnerId = null;
      });
      resetMatchesToPending(paths, matchIds);
      wave.status = 'running';
      record.status = 'running';
      delete record.result;
      recomputeStageEntries(record, wave.stageIndex);
      return;
    }

    /** 分支 B：部分进行（有完成有未打）——不允许整体回退，提示逐场撤销 */
    if (wave.pairingStatus === 'locked' && !wavePristine) {
      throw new Error(
        '该波比赛正在进行中（已有部分小局结果），不能整体回退；请先在赛事面板对已登记的场次逐场撤销',
      );
    }

    /** 分支 C：最后波未打（locked pending 或 draft）——删除未打比赛与波，重开前一波 */
    if (matchIds.length) {
      deleteMatches(paths, matchIds);
    }

    record.waves = record.waves.slice(0, globalIndex);
    delete record.result;
    if (record.status === 'completed') {
      record.status = 'running';
    }

    /** 重开指定阶段最后波：清节点胜者、复位比赛（pending），状态改 running */
    const reopenStageLastWave = (stageIndex: number): TournamentWave | undefined => {
      const stageWaves = record.waves.filter((item) => item.stageIndex === stageIndex);
      const lastWave = stageWaves[stageWaves.length - 1];
      if (lastWave && lastWave.pairingStatus === 'locked') {
        // 节点胜者先清空（比赛随后复位），recompute 才能得到复位战绩
        lastWave.nodes.forEach((node) => {
          node.winnerId = null;
        });
        const resetIds = lastWave.nodes.map((node) => node.matchId).filter((id): id is string => Boolean(id));
        if (resetIds.length) {
          resetMatchesToPending(paths, resetIds);
        }
      }
      if (lastWave) {
        lastWave.status = 'running';
      }
      return lastWave;
    };

    const stageIndex = wave.stageIndex;
    if (record.waves.some((item) => item.stageIndex === stageIndex)) {
      reopenStageLastWave(stageIndex);
      recomputeStageEntries(record, stageIndex);
    } else if (stageIndex === 0) {
      // 开赛第一波被整体回退：回到 setup
      record.currentStageIndex = 0;
      record.entries = initialEntries(record.playerIds);
      record.status = 'setup';
    } else {
      // 跨阶段回退
      const previousStage = stageIndex - 1;
      record.currentStageIndex = previousStage;
      reopenStageLastWave(previousStage);
      recomputeStageEntries(record, previousStage);
    }
  });
}

/* ==================== 外部对阵表导入 ==================== */

/** 解析外部对阵（text 每行 A vs B，或 pairs 名字数组），名字按档案匹配后回填草稿 */
export function importPairings(
  paths: AppPaths,
  tournamentId: string,
  rawWaveIndex: unknown,
  payload: unknown,
): PairingImportResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('pairing import payload must be an object');
  }
  const body = payload as Record<string, unknown>;
  let output: TournamentRecord | null = null;
  const unmatched: Array<{ line: number; text: string }> = [];

  mutateRecord(paths, tournamentId, (record) => {
    const waveIndex = parseWaveGlobalIndex(record, rawWaveIndex);
    const wave = record.waves[waveIndex];
    if (wave.pairingStatus !== 'draft') {
      throw new Error('仅 draft 波可导入对阵');
    }
    const stage = record.stages[wave.stageIndex];

    // 匹配池 = 本波期望选手
    const poolIds: string[] = [];
    if (stage.format === 'double-life') {
      doubleBucketSpecs(record.entries, wave.waveIndex).forEach((spec) => poolIds.push(...spec.players));
    } else {
      record.entries.filter((entry) => entry.state === 'alive').forEach((entry) => poolIds.push(entry.playerId));
    }
    const profiles = new Map(getProfileStore(paths).players.map((player) => [player.id, player]));

    const resolveName = (token: string): string | null => {
      const compact = token.replace(/\s+/g, '');
      const normalized = compact.toLowerCase();
      const exact = poolIds.filter((id) => (profiles.get(id)?.name ?? '').replace(/\s+/g, '').toLowerCase() === normalized);
      if (exact.length === 1) {
        return exact[0];
      }
      const fuzzy = poolIds.filter((id) => {
        const name = (profiles.get(id)?.name ?? '').replace(/\s+/g, '');
        return name.includes(compact) || compact.includes(name);
      });
      return fuzzy.length === 1 ? fuzzy[0] : null;
    };

    interface ParsedLine {
      line: number;
      left: string;
      right: string;
      text: string;
    }
    const parsed: ParsedLine[] = [];

    if (typeof body.text === 'string') {
      body.text.split(/\r?\n/).forEach((rawLine, index) => {
        const text = rawLine.trim();
        if (!text) {
          return;
        }
        const parts = text.split(/\s+vs\s+/i);
        if (parts.length !== 2) {
          unmatched.push({ line: index + 1, text });
          return;
        }
        parsed.push({ line: index + 1, left: parts[0].trim(), right: parts[1].trim(), text });
      });
    }

    if (Array.isArray(body.pairs)) {
      body.pairs.forEach((item, index) => {
        if (Array.isArray(item) && item.length >= 2) {
          parsed.push({
            line: index + 1,
            left: String(item[0] ?? '').trim(),
            right: String(item[1] ?? '').trim(),
            text: `${String(item[0])} vs ${String(item[1])}`,
          });
        }
      });
    }

    const draft: DraftPair[] = [];
    parsed.forEach((entry) => {
      const a = resolveName(entry.left);
      const b = resolveName(entry.right);
      if (!a || !b) {
        unmatched.push({ line: entry.line, text: entry.text });
        return;
      }
      const bucketKey = stage.format === 'double-life'
        ? playerBucketKey(record, a)
        : undefined;
      draft.push({ bucketKey, pair: [a, b] });
    });

    wave.pairingDraft = draft;
    output = record;
  });

  if (!output) {
    throw new Error('对阵导入失败');
  }
  return { tournament: cloneRecord(output), unmatched };
}

/* ==================== 删除系列赛 ==================== */

export interface DeleteTournamentResult {
  tournamentId: string;
  /** 受影响的比赛 id（已解绑；matchesDeleted=true 时已一并删除，可在比赛管理撤回） */
  matchIds: string[];
  /** true = 比赛连同系列赛一并删除（进撤销栈）；false = 比赛保留为普通对局 */
  matchesDeleted: boolean;
}

/**
 * 删除系列赛编排记录。
 * 关联比赛一律先解除 tournamentRef：
 * - 默认仅解绑，比赛保留为普通对局（标签保留，战绩/统计不受影响）；
 * - deleteMatches=true 时再走 deleteMatches 删除比赛（进撤销栈可恢复），
 *   因解绑在前，撤回恢复的快照也是无关联普通对局，不会产生孤儿引用。
 */
export function deleteTournament(
  paths: AppPaths,
  tournamentId: string,
  options: { deleteMatches?: boolean } = {},
): DeleteTournamentResult {
  const records = readRecords(paths);
  if (!records.some((record) => record.id === tournamentId)) {
    throw new Error('系列赛不存在');
  }
  assertEditable(paths, tournamentId);

  // 按 tournamentId 全量扫描解绑，比节点登记的 matchId 更能覆盖异常数据
  const { matchIds } = detachMatchesFromTournament(paths, tournamentId);
  const shouldDelete = options.deleteMatches === true && matchIds.length > 0;
  if (shouldDelete) {
    deleteMatches(paths, matchIds);
  }

  writeRecords(paths, records.filter((record) => record.id !== tournamentId));

  return {
    tournamentId,
    matchIds,
    matchesDeleted: shouldDelete,
  };
}

/* ==================== 阶段标注（page6「比赛结果」卡片语义标签） ==================== */

/**
 * 解析一批比赛的系列赛阶段标注（page6「比赛结果」卡片用）。
 * 单败阶段只给阶段名（如「总决赛」）；双败阶段按波次给观众侧语义名：
 * W1 首轮 / W2 胜者组·败者组（按该场两位选手的首轮胜负判定）/ W3 决胜轮。
 * 仅系列赛对局（tournamentRef 指向现存系列赛）返回；普通对局与孤儿引用不出现在结果中。
 */
export function resolveTournamentLabels(
  paths: AppPaths,
  matches: Array<Pick<MatchRecord, 'id' | 'tournamentRef'>>,
): Record<string, string> {
  const store = getTournamentStore(paths);
  const labels: Record<string, string> = {};
  matches.forEach((match) => {
    const label = resolveTournamentLabel(store, match);
    if (label) {
      labels[match.id] = label;
    }
  });
  return labels;
}

function resolveTournamentLabel(
  store: TournamentRecord[],
  match: Pick<MatchRecord, 'id' | 'tournamentRef'>,
): string | null {
  const ref = match.tournamentRef;
  if (!ref) {
    return null;
  }
  const record = store.find((item) => item.id === ref.tournamentId);
  const stage = record?.stages[ref.stageIndex];
  if (!record || !stage) {
    return null;
  }
  if (stage.format !== 'double-life') {
    return stage.name;
  }
  if (ref.waveIndex === 1) {
    return `${stage.name}·首轮`;
  }
  if (ref.waveIndex === 3) {
    return `${stage.name}·决胜轮`;
  }
  if (ref.waveIndex !== 2) {
    return stage.name;
  }
  // W2 分胜者组（1-0 池）/ 败者组（0-1 池）：看该场两位选手首轮是否取胜。
  // 跨桶手动配对等非常规组合拿不到一致池归属时退回阶段名。
  const wave = record.waves.find(
    (item) => item.stageIndex === ref.stageIndex && item.waveIndex === 2,
  );
  const node = wave?.nodes.find((item) => item.id === ref.nodeId);
  if (!node || !node.playerAId || !node.playerBId) {
    return stage.name;
  }
  const aWonOpeningRound = wonOpeningRound(record, ref.stageIndex, node.playerAId);
  const bWonOpeningRound = wonOpeningRound(record, ref.stageIndex, node.playerBId);
  if (aWonOpeningRound !== bWonOpeningRound) {
    return stage.name;
  }
  return `${stage.name}·${aWonOpeningRound ? '胜者组' : '败者组'}`;
}
