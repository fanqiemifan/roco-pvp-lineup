import fs from 'node:fs';

import type {
  PlayerProfile,
  ProfileStoreState,
  SyncImportDiffField,
  TeamProfile,
} from '../../shared/types.js';
import { ensureRuntimeDirs, saveProfilePlayerAvatar } from './image-service.js';
import type { AppPaths } from './path-service.js';

import { listSprites, matchSpriteToken } from './sprite-service.js';

const NAME_MAX_LENGTH = 32;
const TEXT_MAX_LENGTH = 120;
const RANK_MAX_LENGTH = 10;
const MAX_PLAYERS = 200;
const MAX_TEAMS = 100;

/** 常用精灵导入未命中 pets.json 时的回执：携带最多 5 个兜底模糊候选（可空） */
export interface PetSuggestionReview {
  /** 对应的选手名字 */
  name: string;
  /** 未命中传入的常用精灵输入 */
  input: string;
  /** 兜底候选（最多 5 个），可为空 */
  candidates: Array<{ name: string; number: number | null }>;
}

interface PlayerProfileFileEntry {
  id: string;
  name: string;
  pets: string;
  declaration: string;
  rank: string;
}

interface TeamProfileFileEntry {
  id: string;
  name: string;
  captain: string;
  declaration: string;
}

interface ProfileStoreFile {
  players: PlayerProfileFileEntry[];
  teams: TeamProfileFileEntry[];
  /**
   * id 别名：外部（另一台机器）的档案 id -> 本机档案 id。
   *
   * 为什么需要：导入时若本机已有「同名但不同 id」的档案，按原规则会跳过不覆盖 —— 本机保留自己的 id，
   * 而系列赛编排里的 playerIds 是对方的 id，于是晋级图/波次卡片解析不出名字只能显示 id
   * （见「分控端不显示选手名字」的排查）。导入时登记一条别名即可让对方的 id 也能指到这个人，
   * 既不破坏本机 id 稳定性（比赛/头像目录都引用 id），也不影响显示。
   */
  playerAliases: Record<string, string>;
  teamAliases: Record<string, string>;
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().slice(0, NAME_MAX_LENGTH);
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().slice(0, TEXT_MAX_LENGTH);
}

/** 排名：仅保留数字（空字符串 = 未输入） */
function normalizeRank(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, RANK_MAX_LENGTH);
}

function normalizeId(value: unknown): string {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function createProfileId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function defaultStoreFile(): ProfileStoreFile {
  return { players: [], teams: [], playerAliases: {}, teamAliases: {} };
}

/** id 别名表规范化：只保留「合法 id -> 合法 id」且两者不同的条目 */
function normalizeAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([from, to]) => {
    const aliasId = normalizeId(from);
    const localId = normalizeId(to);
    if (aliasId && localId && aliasId !== localId) {
      result[aliasId] = localId;
    }
  });
  return result;
}

function readStoreFile(paths: AppPaths): { store: ProfileStoreFile; mtime: number | null } {
  if (!fs.existsSync(paths.profilesFile)) {
    return { store: defaultStoreFile(), mtime: null };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(paths.profilesFile, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.profilesFile);
    const store: ProfileStoreFile = {
      players: Array.isArray(raw.players)
        ? raw.players
            .map((item): PlayerProfileFileEntry | null => {
              const entry = (item ?? {}) as Record<string, unknown>;
              const id = normalizeId(entry.id);
              const name = normalizeName(entry.name);
              if (!id || !name) {
                return null;
              }
              return {
                id,
                name,
                pets: normalizeText(entry.pets),
                declaration: normalizeText(entry.declaration),
                rank: normalizeRank(entry.rank),
              };
            })
            .filter((item): item is PlayerProfileFileEntry => Boolean(item))
            .slice(0, MAX_PLAYERS)
        : [],
      teams: Array.isArray(raw.teams)
        ? raw.teams
            .map((item): TeamProfileFileEntry | null => {
              const entry = (item ?? {}) as Record<string, unknown>;
              const id = normalizeId(entry.id);
              const name = normalizeName(entry.name);
              if (!id || !name) {
                return null;
              }
              return {
                id,
                name,
                captain: normalizeName(entry.captain),
                declaration: normalizeText(entry.declaration),
              };
            })
            .filter((item): item is TeamProfileFileEntry => Boolean(item))
            .slice(0, MAX_TEAMS)
        : [],
      playerAliases: normalizeAliases(raw.playerAliases),
      teamAliases: normalizeAliases(raw.teamAliases),
    };
    return { store, mtime: stat.mtimeMs };
  } catch {
    return { store: defaultStoreFile(), mtime: null };
  }
}

function writeStoreFile(paths: AppPaths, store: ProfileStoreFile): void {
  ensureRuntimeDirs(paths);
  fs.writeFileSync(paths.profilesFile, JSON.stringify(store, null, 2), 'utf-8');
}

function toPlayerProfile(paths: AppPaths, entry: PlayerProfileFileEntry): PlayerProfile {
  const filePath = paths.profilePlayerAvatarFile(entry.id);
  let avatarExists = false;
  let avatarMtime: number | null = null;
  if (fs.existsSync(filePath)) {
    avatarExists = true;
    avatarMtime = fs.statSync(filePath).mtimeMs;
  }
  return { ...entry, avatarExists, avatarMtime };
}

function toTeamProfile(paths: AppPaths, entry: TeamProfileFileEntry): TeamProfile {
  const filePath = paths.profileTeamLogoFile(entry.id);
  let logoExists = false;
  let logoMtime: number | null = null;
  if (fs.existsSync(filePath)) {
    logoExists = true;
    logoMtime = fs.statSync(filePath).mtimeMs;
  }
  return { ...entry, logoExists, logoMtime };
}

export function getProfileStore(paths: AppPaths): ProfileStoreState {
  const { store, mtime } = readStoreFile(paths);
  return {
    players: store.players.map((entry) => toPlayerProfile(paths, entry)),
    teams: store.teams.map((entry) => toTeamProfile(paths, entry)),
    playerAliases: store.playerAliases,
    teamAliases: store.teamAliases,
    mtime,
  };
}

/**
 * 外部档案 id -> 本机档案 id 的解析（别名优先，其次原名）。
 * 系列赛编排里的 playerIds 可能来自另一台机器，靠它才能显示出选手名字。
 */
export function resolveProfileAlias(paths: AppPaths, id: string): string {
  const { store } = readStoreFile(paths);
  return store.playerAliases[id] ?? id;
}

/**
 * 新增/更新选手录入：id 存在则更新对应记录；未传 id 但名字与已有选手相同视为更新（名字即复用键）。
 * 返回保存后的完整状态。
 */
export function savePlayerProfile(paths: AppPaths, payload: unknown): ProfileStoreState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('player profile payload must be an object');
  }

  const raw = payload as Record<string, unknown>;
  const name = normalizeName(raw.name);
  if (!name) {
    throw new Error('请输入选手名字');
  }

  const { store } = readStoreFile(paths);
  const id = normalizeId(raw.id);
  const nextEntry: PlayerProfileFileEntry = {
    id: id || createProfileId('p'),
    name,
    pets: normalizeText(raw.pets),
    declaration: normalizeText(raw.declaration),
    rank: normalizeRank(raw.rank),
  };

  const byId = id ? store.players.findIndex((item) => item.id === id) : -1;
  if (byId >= 0) {
    store.players[byId] = nextEntry;
  } else {
    const byName = store.players.findIndex((item) => item.name === name);
    if (byName >= 0) {
      // 同名更新时沿用旧 id，保证头像文件不丢失
      nextEntry.id = store.players[byName].id;
      store.players[byName] = nextEntry;
    } else if (store.players.length < MAX_PLAYERS) {
      store.players.push(nextEntry);
    } else {
      throw new Error(`选手录入数量已达上限（${MAX_PLAYERS}）`);
    }
  }

  writeStoreFile(paths, store);
  return getProfileStore(paths);
}

/** 删除选手录入（连同头像文件） */
export function deletePlayerProfile(paths: AppPaths, playerId: string): ProfileStoreState {
  const id = normalizeId(playerId);
  const { store } = readStoreFile(paths);
  store.players = store.players.filter((item) => item.id !== id);

  const filePath = paths.profilePlayerAvatarFile(id);
  if (id && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  writeStoreFile(paths, store);
  return getProfileStore(paths);
}

/** 新增/更新战队录入：id 存在则更新；未传 id 但名字与已有战队相同视为更新（名字即复用键） */
export function saveTeamProfile(paths: AppPaths, payload: unknown): ProfileStoreState {
  if (!payload || typeof payload !== 'object') {
    throw new Error('team profile payload must be an object');
  }

  const raw = payload as Record<string, unknown>;
  const name = normalizeName(raw.name);
  if (!name) {
    throw new Error('请输入战队名称');
  }

  const { store } = readStoreFile(paths);
  const id = normalizeId(raw.id);
  const nextEntry: TeamProfileFileEntry = {
    id: id || createProfileId('t'),
    name,
    captain: normalizeName(raw.captain),
    declaration: normalizeText(raw.declaration),
  };

  const byId = id ? store.teams.findIndex((item) => item.id === id) : -1;
  if (byId >= 0) {
    store.teams[byId] = nextEntry;
  } else {
    const byName = store.teams.findIndex((item) => item.name === name);
    if (byName >= 0) {
      nextEntry.id = store.teams[byName].id;
      store.teams[byName] = nextEntry;
    } else if (store.teams.length < MAX_TEAMS) {
      store.teams.push(nextEntry);
    } else {
      throw new Error(`战队录入数量已达上限（${MAX_TEAMS}）`);
    }
  }

  writeStoreFile(paths, store);
  return getProfileStore(paths);
}

/**
 * 批量导入选手录入（JSON）。
 * 安全约定：每条记录仅识别 name / rank / declaration / pets 四个白名单英文字段，其余键名（含 id、头像、
 * 脚本或路径等注入字段）一律忽略，防止恶意 JSON 注入。排名仅保留数字。
 * pets 为常用精灵（英文字段名 pets，字符串或数组）：仅当精灵名在 pets.json 中精确命中时才会录入；
 * 未命中的精灵不录入、其余信息正常导入，并在返回的 review 中携带最多 5 个兜底模糊候选供前端选择。
 * 同名选手视为更新：沿用旧 id 与头像，仅更新名字 / 排名 / 宣言 / 常用精灵；达到上限后仍可更新但不再新增。
 */
export function importPlayerProfiles(
  paths: AppPaths,
  payload: unknown,
): { profiles: ProfileStoreState; review: PetSuggestionReview[] } {
  if (!Array.isArray(payload)) {
    throw new Error('导入数据必须是选手数组');
  }
  const { store } = readStoreFile(paths);
  const sprites = listSprites(paths);
  const review: PetSuggestionReview[] = [];

  for (const item of payload) {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = normalizeName(raw.name);
    if (!name) {
      continue;
    }
    const declaration = normalizeText(raw.declaration);
    const rank = normalizeRank(raw.rank);

    // 解析常用精灵（支持 `、/，,` 分隔的字符串或数组）
    const petTokens = Array.isArray(raw.pets)
      ? raw.pets.map((value) => String(value ?? '').trim()).filter(Boolean)
      : String(raw.pets ?? '')
        .split(/[/、,，\s]+/u)
        .map((token) => token.trim())
        .filter(Boolean);

    let pets = '';
    if (petTokens.length > 0) {
      const matchedDisplays: string[] = [];
      for (const token of petTokens) {
        const { matched, candidates } = matchSpriteToken(token, sprites, 5);
        if (matched) {
          matchedDisplays.push(matched);
        } else {
          review.push({
            name,
            input: token,
            candidates: candidates.map((sprite) => ({ name: sprite.displayName, number: sprite.number ?? null })),
          });
        }
      }
      pets = matchedDisplays.join('、');
    }

    const byName = store.players.findIndex((entry) => entry.name === name);
    if (byName >= 0) {
      // 同名更新：沿用旧 id/头像；导入未提供常用精灵或全部未命中时保留已有常用精灵
      const existingPets = store.players[byName].pets ?? '';
      store.players[byName] = {
        ...store.players[byName],
        name,
        declaration,
        rank,
        pets: petTokens.length > 0 && pets ? pets : existingPets,
      };
    } else if (store.players.length < MAX_PLAYERS) {
      store.players.push({ id: createProfileId('p'), name, pets, declaration, rank });
    }
  }
  writeStoreFile(paths, store);
  return { profiles: getProfileStore(paths), review };
}

/** 批量头像导入回执：matched 成功写入的头像数；unmatched 未命中选手名字的文件名；failed 校验/处理失败明细 */
export interface PlayerAvatarBatchReport {
  profiles: ProfileStoreState;
  matched: number;
  unmatched: string[];
  failed: Array<{ name: string; reason: string }>;
}

/** 用于匹配选手名字 */
function avatarMatchName(fileName: string): string {
  const base = String(fileName ?? '').split(/[\\/]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '').trim();
}

/**
 * 批量导入选手头像：按图片文件基础名精确匹配已录入选手名字（同名选手取先录入者），
 * 命中则复用单个头像上传同一条管线（魔数校验 + sharp 压缩为 480×480 PNG 落盘）；
 * 未命中名字或图片校验失败的文件不落盘，在回执中列出由前端提醒。
 */
export async function importPlayerAvatarFiles(
  paths: AppPaths,
  files: Array<{ name: string; buffer: Buffer }>,
): Promise<PlayerAvatarBatchReport> {
  const { store } = readStoreFile(paths);
  const idByName = new Map<string, string>();
  for (const entry of store.players) {
    if (!idByName.has(entry.name)) {
      idByName.set(entry.name, entry.id);
    }
  }

  let matched = 0;
  const unmatched: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const file of files) {
    const matchName = avatarMatchName(file.name);
    if (!matchName) {
      failed.push({ name: file.name, reason: '文件名缺少可匹配的选手名字' });
      continue;
    }
    const playerId = idByName.get(matchName);
    if (!playerId) {
      unmatched.push(matchName);
      continue;
    }
    try {
      await saveProfilePlayerAvatar(paths, playerId, file.buffer);
      matched += 1;
    } catch (error) {
      failed.push({ name: matchName, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { profiles: getProfileStore(paths), matched, unmatched, failed };
}

/** 删除战队录入（连同 logo 文件） */
export function deleteTeamProfile(paths: AppPaths, teamId: string): ProfileStoreState {
  const id = normalizeId(teamId);
  const { store } = readStoreFile(paths);
  store.teams = store.teams.filter((item) => item.id !== id);

  const filePath = paths.profileTeamLogoFile(id);
  if (id && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  writeStoreFile(paths, store);
  return getProfileStore(paths);
}

/* ==================== 双机数据同步：档案导入合并 ==================== */

/** 包内档案输入（字段缺失按空处理；id / 名字不合法的条目会被忽略并给出原因） */
export interface ProfileImportInput {
  players?: unknown[];
  teams?: unknown[];
}

export interface ProfileImportDecision {
  kind: 'player' | 'team';
  id: string;
  name: string;
  action: 'add' | 'update' | 'skip';
  reason: string;
  /** 字段级差异（只列出不同的字段；本机无该档案时为空数组） */
  diff: SyncImportDiffField[];
}

export interface ProfileImportRejected {
  kind: 'player' | 'team';
  index: number;
  reason: string;
}

export interface ProfileImportDiff {
  players: ProfileImportDecision[];
  teams: ProfileImportDecision[];
  rejected: ProfileImportRejected[];
}

export interface MergeProfileRecordsReport {
  profiles: ProfileStoreState;
  players: { added: string[]; updated: string[]; skipped: Array<{ id: string; name: string; reason: string }> };
  teams: { added: string[]; updated: string[]; skipped: Array<{ id: string; name: string; reason: string }> };
  /** 本次新登记的 id 别名（外部 id -> 本机 id），供导入摘要提示 */
  aliases: { players: Record<string, string>; teams: Record<string, string> };
  rejected: ProfileImportRejected[];
}

function normalizeIncomingPlayers(items: unknown[]): { entries: PlayerProfileFileEntry[]; rejected: ProfileImportRejected[] } {
  const entries: PlayerProfileFileEntry[] = [];
  const rejected: ProfileImportRejected[] = [];

  items.forEach((item, index) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const id = normalizeId(raw.id);
    const name = normalizeName(raw.name);
    if (!id || !name) {
      rejected.push({ kind: 'player', index, reason: 'id 或名字不合法，已忽略' });
      return;
    }
    entries.push({
      id,
      name,
      pets: normalizeText(raw.pets),
      declaration: normalizeText(raw.declaration),
      rank: normalizeRank(raw.rank),
    });
  });

  return { entries, rejected };
}

function normalizeIncomingTeams(items: unknown[]): { entries: TeamProfileFileEntry[]; rejected: ProfileImportRejected[] } {
  const entries: TeamProfileFileEntry[] = [];
  const rejected: ProfileImportRejected[] = [];

  items.forEach((item, index) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const id = normalizeId(raw.id);
    const name = normalizeName(raw.name);
    if (!id || !name) {
      rejected.push({ kind: 'team', index, reason: 'id 或名字不合法，已忽略' });
      return;
    }
    entries.push({
      id,
      name,
      captain: normalizeName(raw.captain),
      declaration: normalizeText(raw.declaration),
    });
  });

  return { entries, rejected };
}

function pushProfileDiffField(fields: SyncImportDiffField[], label: string, local: string, incoming: string): void {
  if (local !== incoming) {
    fields.push({ label, local, incoming });
  }
}

function buildPlayerDiff(local: PlayerProfileFileEntry, incoming: PlayerProfileFileEntry): SyncImportDiffField[] {
  const fields: SyncImportDiffField[] = [];
  pushProfileDiffField(fields, '名字', local.name, incoming.name);
  pushProfileDiffField(fields, '常用精灵', local.pets || '（空）', incoming.pets || '（空）');
  pushProfileDiffField(fields, '宣言', local.declaration || '（空）', incoming.declaration || '（空）');
  pushProfileDiffField(fields, '排名', local.rank || '（空）', incoming.rank || '（空）');
  return fields;
}

function buildTeamDiff(local: TeamProfileFileEntry, incoming: TeamProfileFileEntry): SyncImportDiffField[] {
  const fields: SyncImportDiffField[] = [];
  pushProfileDiffField(fields, '名字', local.name, incoming.name);
  pushProfileDiffField(fields, '队长', local.captain || '（空）', incoming.captain || '（空）');
  pushProfileDiffField(fields, '宣言', local.declaration || '（空）', incoming.declaration || '（空）');
  return fields;
}

/** 选手档案判定：先按 id（相同跳过 / 差异覆盖），再按名字（同名不同 id 跳过不覆盖），最后受上限约束 */
function classifyPlayerImport(players: PlayerProfileFileEntry[], entry: PlayerProfileFileEntry): ProfileImportDecision {
  const base = { kind: 'player' as const, id: entry.id, name: entry.name };

  const byIdIndex = players.findIndex((item) => item.id === entry.id);
  if (byIdIndex >= 0) {
    const diff = buildPlayerDiff(players[byIdIndex], entry);
    return diff.length === 0
      ? { ...base, action: 'skip', reason: '与本机档案内容相同', diff }
      : { ...base, action: 'update', reason: '覆盖本机档案', diff };
  }

  const sameName = players.find((item) => item.name === entry.name);
  if (sameName) {
    const diff = buildPlayerDiff(sameName, entry);
    return {
      ...base,
      action: diff.length === 0 ? 'skip' : 'update',
      reason: diff.length === 0
        ? `与本机档案「${sameName.name}」内容相同（保留本机 id ${sameName.id}）`
        : `按名字匹配到已有档案「${sameName.name}」，导入后保留本机 id（${sameName.id}）并登记 id 别名 ${entry.id} → ${sameName.id}`,
      diff,
    };
  }

  if (players.length >= MAX_PLAYERS) {
    return { ...base, action: 'skip', reason: `选手档案已达上限（${MAX_PLAYERS}）`, diff: [] };
  }

  return { ...base, action: 'add', reason: '', diff: [] };
}

/** 战队档案判定：规则同选手档案 */
function classifyTeamImport(teams: TeamProfileFileEntry[], entry: TeamProfileFileEntry): ProfileImportDecision {
  const base = { kind: 'team' as const, id: entry.id, name: entry.name };

  const byIdIndex = teams.findIndex((item) => item.id === entry.id);
  if (byIdIndex >= 0) {
    const diff = buildTeamDiff(teams[byIdIndex], entry);
    return diff.length === 0
      ? { ...base, action: 'skip', reason: '与本机档案内容相同', diff }
      : { ...base, action: 'update', reason: '覆盖本机档案', diff };
  }

  const sameName = teams.find((item) => item.name === entry.name);
  if (sameName) {
    const diff = buildTeamDiff(sameName, entry);
    return {
      ...base,
      action: diff.length === 0 ? 'skip' : 'update',
      reason: diff.length === 0
        ? `与本机档案「${sameName.name}」内容相同（保留本机 id ${sameName.id}）`
        : `按名字匹配到已有档案「${sameName.name}」，导入后保留本机 id（${sameName.id}）并登记 id 别名 ${entry.id} → ${sameName.id}`,
      diff,
    };
  }

  if (teams.length >= MAX_TEAMS) {
    return { ...base, action: 'skip', reason: `战队档案已达上限（${MAX_TEAMS}）`, diff: [] };
  }

  return { ...base, action: 'add', reason: '', diff: [] };
}

/** 只读：对比包内档案与本机档案（供导入预览） */
export function diffProfileRecords(paths: AppPaths, incoming: ProfileImportInput): ProfileImportDiff {
  const { store } = readStoreFile(paths);
  const players = normalizeIncomingPlayers(Array.isArray(incoming.players) ? incoming.players : []);
  const teams = normalizeIncomingTeams(Array.isArray(incoming.teams) ? incoming.teams : []);

  return {
    players: players.entries.map((entry) => classifyPlayerImport(store.players, entry)),
    teams: teams.entries.map((entry) => classifyTeamImport(store.teams, entry)),
    rejected: [...players.rejected, ...teams.rejected],
  };
}

/**
 * 合并包内档案：按 id 覆盖 / 同名则保留本机 id（更新字段 + 登记 id 别名）/ 新增（受上限约束）；
 * 头像由同步服务另行补缺。acceptedIds 传入时只合并其中的条目（导入预览里未勾选的条目不落盘）。
 */
export function mergeProfileRecords(
  paths: AppPaths,
  incoming: ProfileImportInput,
  acceptedIds?: { players?: Set<string>; teams?: Set<string> },
): MergeProfileRecordsReport {
  const { store } = readStoreFile(paths);
  const normalizedPlayers = normalizeIncomingPlayers(Array.isArray(incoming.players) ? incoming.players : []);
  const normalizedTeams = normalizeIncomingTeams(Array.isArray(incoming.teams) ? incoming.teams : []);

  const aliases: { players: Record<string, string>; teams: Record<string, string> } = { players: {}, teams: {} };
  /**
   * 名字匹配上就登记 id 别名（不管内容是否相同、哪怕用户没勾选这条）。
   *
   * 为什么不等用户勾选：别名只是「对方 id 也能指到这个人」的映射，不改变任何本机数据，
   * 但没有它，系列赛编排里来自对方的 playerIds 就会显示成一串 id。
   * 之前只在「可勾选的更新」分支里登记，导致内容本来就一致的同名档案同步多少次都补不上别名。
   */
  const linkPlayerAlias = (incomingId: string, localId: string): void => {
    if (!incomingId || !localId || incomingId === localId) {
      return;
    }
    const existing = store.playerAliases[incomingId];
    if (existing === localId) {
      return;
    }
    store.playerAliases[incomingId] = localId;
    aliases.players[incomingId] = localId;
  };
  const linkTeamAlias = (incomingId: string, localId: string): void => {
    if (!incomingId || !localId || incomingId === localId) {
      return;
    }
    const existing = store.teamAliases[incomingId];
    if (existing === localId) {
      return;
    }
    store.teamAliases[incomingId] = localId;
    aliases.teams[incomingId] = localId;
  };
  const players: MergeProfileRecordsReport['players'] = { added: [], updated: [], skipped: [] };
  normalizedPlayers.entries.forEach((entry) => {
    // 同名档案始终登记别名（先做，避免被 acceptedIds / 各 skip 分支漏掉）
    const sameName = store.players.find((item) => item.name === entry.name);
    if (sameName) {
      linkPlayerAlias(entry.id, sameName.id);
    }
    if (acceptedIds?.players && !acceptedIds.players.has(entry.id)) {
      return;
    }
    const decision = classifyPlayerImport(store.players, entry);
    if (decision.action === 'add') {
      store.players.push(entry);
      players.added.push(entry.id);
      return;
    }
    if (decision.action === 'update') {
      const byIdIndex = store.players.findIndex((item) => item.id === entry.id);
      if (byIdIndex >= 0) {
        store.players[byIdIndex] = entry;
        players.updated.push(entry.id);
        return;
      }
      // 同名匹配：保留本机 id（比赛 / 头像目录都引用它），只更新内容
      const byNameIndex = store.players.findIndex((item) => item.name === entry.name);
      if (byNameIndex >= 0) {
        const localId = store.players[byNameIndex].id;
        store.players[byNameIndex] = { ...entry, id: localId };
        players.updated.push(localId);
        return;
      }
      store.players.push(entry);
      players.added.push(entry.id);
      return;
    }
    players.skipped.push({ id: entry.id, name: entry.name, reason: decision.reason });
  });

  const teams: MergeProfileRecordsReport['teams'] = { added: [], updated: [], skipped: [] };
  normalizedTeams.entries.forEach((entry) => {
    const sameName = store.teams.find((item) => item.name === entry.name);
    if (sameName) {
      linkTeamAlias(entry.id, sameName.id);
    }
    if (acceptedIds?.teams && !acceptedIds.teams.has(entry.id)) {
      return;
    }
    const decision = classifyTeamImport(store.teams, entry);
    if (decision.action === 'add') {
      store.teams.push(entry);
      teams.added.push(entry.id);
      return;
    }
    if (decision.action === 'update') {
      const byIdIndex = store.teams.findIndex((item) => item.id === entry.id);
      if (byIdIndex >= 0) {
        store.teams[byIdIndex] = entry;
        teams.updated.push(entry.id);
        return;
      }
      const byNameIndex = store.teams.findIndex((item) => item.name === entry.name);
      if (byNameIndex >= 0) {
        const localId = store.teams[byNameIndex].id;
        store.teams[byNameIndex] = { ...entry, id: localId };
        teams.updated.push(localId);
        return;
      }
      store.teams.push(entry);
      teams.added.push(entry.id);
      return;
    }
    teams.skipped.push({ id: entry.id, name: entry.name, reason: decision.reason });
  });

  writeStoreFile(paths, store);
  return {
    profiles: getProfileStore(paths),
    players,
    teams,
    aliases,
    rejected: [...normalizedPlayers.rejected, ...normalizedTeams.rejected],
  };
}
