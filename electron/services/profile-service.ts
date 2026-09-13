import fs from 'node:fs';

import type {
  PlayerProfile,
  ProfileStoreState,
  TeamProfile,
} from '../../shared/types.js';
import { ensureRuntimeDirs } from './image-service.js';
import type { AppPaths } from './path-service.js';

const NAME_MAX_LENGTH = 32;
const TEXT_MAX_LENGTH = 120;
const RANK_MAX_LENGTH = 10;
/** 单类（选手/战队）录入数量上限 */
const MAX_PLAYERS = 200;
const MAX_TEAMS = 100;

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
  return { players: [], teams: [] };
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
    mtime,
  };
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
 * 安全约定：每条记录仅识别 name / rank / declaration 三个白名单字段，其余键名（含 id、pets、头像、
 * 脚本或路径等注入字段）一律忽略，防止恶意 JSON 注入。排名仅保留数字。
 * 同名选手视为更新：沿用旧 id 与头像、保留已有常用精灵，仅更新名字 / 排名 / 宣言；达到上限后仍可更新但不再新增。
 * 返回保存后的完整状态。
 */
export function importPlayerProfiles(paths: AppPaths, payload: unknown): ProfileStoreState {
  if (!Array.isArray(payload)) {
    throw new Error('导入数据必须是选手数组');
  }
  const { store } = readStoreFile(paths);
  for (const item of payload) {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = normalizeName(raw.name);
    if (!name) {
      continue;
    }
    const declaration = normalizeText(raw.declaration);
    const rank = normalizeRank(raw.rank);
    const byName = store.players.findIndex((entry) => entry.name === name);
    if (byName >= 0) {
      // 同名更新：沿用旧 id/头像，保留已有常用精灵，仅更新名字 / 排名 / 宣言
      store.players[byName] = { ...store.players[byName], name, declaration, rank };
    } else if (store.players.length < MAX_PLAYERS) {
      store.players.push({ id: createProfileId('p'), name, pets: '', declaration, rank });
    }
  }
  writeStoreFile(paths, store);
  return getProfileStore(paths);
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
