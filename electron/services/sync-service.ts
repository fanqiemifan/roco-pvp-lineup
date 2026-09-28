import fs from 'node:fs';

import { SYNC_APP_ID, SYNC_BUNDLE_SCHEMA } from '../../shared/constants.js';
import type {
  PlayerProfile,
  ProfileStoreState,
  SyncAvatarCounts,
  SyncBundle,
  SyncBundlePlayerProfile,
  SyncBundleTeamProfile,
  SyncConflictMode,
  SyncImportCounts,
  SyncImportItem,
  SyncImportPreview,
  SyncImportResult,
  TeamProfile,
} from '../../shared/types.js';
import { loadRuntimeConfig } from './config-service.js';
import { saveProfilePlayerAvatar, saveProfileTeamLogo } from './image-service.js';
import {
  diffMatchRecords,
  getMatchStore,
  mergeMatchRecords,
  normalizeImportedMatches,
} from './match-service.js';
import type { AppPaths } from './path-service.js';
import { diffProfileRecords, getProfileStore, mergeProfileRecords } from './profile-service.js';

/** 导出选项：头像只在包含档案时才有效（头像按档案 id 归属） */
export interface SyncExportOptions {
  includeProfiles: boolean;
  includeAvatars: boolean;
}

/** 解析后的同步包（包内条目保持 unknown，由各服务逐条规范化） */
interface SyncBundlePayload {
  machine: string;
  exportedAt: string;
  matches: unknown[];
  profiles: { players: unknown[]; teams: unknown[] } | null;
  avatars: { players: Record<string, string>; teams: Record<string, string> } | null;
}

export interface SyncApplyOptions {
  mode: SyncConflictMode;
  /** 前端勾选保留的 item.key 列表（服务端会重新分类后取交集，不信任客户端判定） */
  acceptedKeys: string[];
  includeAvatars: boolean;
}

function toBundlePlayer(player: PlayerProfile): SyncBundlePlayerProfile {
  return {
    id: player.id,
    name: player.name,
    pets: player.pets,
    declaration: player.declaration,
    rank: player.rank,
  };
}

function toBundleTeam(team: TeamProfile): SyncBundleTeamProfile {
  return {
    id: team.id,
    name: team.name,
    captain: team.captain,
    declaration: team.declaration,
  };
}

function readAvatarBase64(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return fs.readFileSync(filePath).toString('base64');
  } catch {
    return null;
  }
}

/**
 * 导出同步包：比赛（全部场次，含空白/进行中，基线分发需要）+ 可选档案与头像。
 * 头像只在 includeProfiles 时附带（按档案 id 归属）。
 */
export function exportSyncBundle(paths: AppPaths, options: SyncExportOptions): SyncBundle {
  const bundle: SyncBundle = {
    app: SYNC_APP_ID,
    schema: SYNC_BUNDLE_SCHEMA,
    machine: loadRuntimeConfig(paths).machineCode,
    exportedAt: new Date().toISOString(),
    matches: getMatchStore(paths).matches,
  };

  if (!options.includeProfiles) {
    return bundle;
  }

  const profiles = getProfileStore(paths);
  bundle.profiles = {
    players: profiles.players.map((player) => toBundlePlayer(player)),
    teams: profiles.teams.map((team) => toBundleTeam(team)),
  };

  if (options.includeAvatars) {
    const players: Record<string, string> = {};
    profiles.players.forEach((player) => {
      const base64 = readAvatarBase64(paths.profilePlayerAvatarFile(player.id));
      if (base64) {
        players[player.id] = base64;
      }
    });

    const teams: Record<string, string> = {};
    profiles.teams.forEach((team) => {
      const base64 = readAvatarBase64(paths.profileTeamLogoFile(team.id));
      if (base64) {
        teams[team.id] = base64;
      }
    });

    bundle.avatars = { players, teams };
  }

  return bundle;
}

function sanitizeAvatarMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return result;
  }
  Object.entries(value as Record<string, unknown>).forEach(([id, base64]) => {
    if (typeof base64 === 'string' && base64) {
      result[id] = base64;
    }
  });
  return result;
}

/** 解析并校验同步包头部（app / schema / 结构），不合法抛中文错误供路由转 400 */
function parseSyncBundle(raw: unknown): SyncBundlePayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('同步包内容不是有效的 JSON 对象');
  }

  const payload = raw as Record<string, unknown>;
  if (payload.app !== SYNC_APP_ID) {
    throw new Error('不是本软件的同步包（缺少正确的 app 标识）');
  }

  const schema = Number(payload.schema);
  if (schema !== SYNC_BUNDLE_SCHEMA) {
    throw new Error(`同步包版本不兼容（schema ${String(payload.schema ?? '未知')}，当前支持 ${SYNC_BUNDLE_SCHEMA}）`);
  }

  if (!Array.isArray(payload.matches)) {
    throw new Error('同步包缺少比赛数据（matches）');
  }

  const profilesRaw = payload.profiles && typeof payload.profiles === 'object' && !Array.isArray(payload.profiles)
    ? payload.profiles as Record<string, unknown>
    : null;
  const profiles = profilesRaw
    ? {
      players: Array.isArray(profilesRaw.players) ? profilesRaw.players as unknown[] : [],
      teams: Array.isArray(profilesRaw.teams) ? profilesRaw.teams as unknown[] : [],
    }
    : null;

  const avatarsRaw = payload.avatars && typeof payload.avatars === 'object' && !Array.isArray(payload.avatars)
    ? payload.avatars as Record<string, unknown>
    : null;
  const avatars = avatarsRaw
    ? {
      players: sanitizeAvatarMap(avatarsRaw.players),
      teams: sanitizeAvatarMap(avatarsRaw.teams),
    }
    : null;

  return {
    machine: typeof payload.machine === 'string' ? payload.machine.trim().slice(0, 4) : '',
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : '',
    matches: payload.matches as unknown[],
    profiles,
    avatars,
  };
}

function countActions(items: SyncImportItem[]): SyncImportCounts {
  const counts: SyncImportCounts = { add: 0, update: 0, skip: 0 };
  items.forEach((item) => {
    counts[item.action] += 1;
  });
  return counts;
}

/** 包内档案 id -> 名字（用于头像「同名匹配」目标解析；id 已由各服务规范化，这里只做原样读取） */
function buildBundleNameMap(payload: SyncBundlePayload, kind: 'player' | 'team'): Map<string, string> {
  const result = new Map<string, string>();
  const entries = kind === 'player' ? payload.profiles?.players ?? [] : payload.profiles?.teams ?? [];
  entries.forEach((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const id = normalizeBundleId(raw.id);
    const name = String(raw.name ?? '').trim();
    if (id && name) {
      result.set(id, name);
    }
  });
  return result;
}

/** 档案 id 白名单净化（与 profile-service 的 normalizeId 同规则，用于头像目标解析） */
function normalizeBundleId(value: unknown): string {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

/** 头像补缺统计：源 id 命中本机档案 → 本地缺文件算补缺，已有算保持；命中不到算 unmatched */
function countAvatarFill(paths: AppPaths, payload: SyncBundlePayload, kind: 'player' | 'team'): SyncAvatarCounts {
  const counts: SyncAvatarCounts = { fill: 0, existing: 0, unmatched: 0 };
  const avatarMap = kind === 'player' ? payload.avatars?.players : payload.avatars?.teams;
  if (!avatarMap) {
    return counts;
  }

  const profiles = getProfileStore(paths);
  const localEntries: Array<PlayerProfile | TeamProfile> = kind === 'player' ? profiles.players : profiles.teams;
  const byId = new Map(localEntries.map((entry) => [entry.id, entry]));
  const byName = new Map(localEntries.map((entry) => [entry.name, entry]));
  const nameById = buildBundleNameMap(payload, kind);

  Object.keys(avatarMap).forEach((sourceId) => {
    let local = byId.get(sourceId);
    if (!local) {
      const name = nameById.get(sourceId);
      local = name ? byName.get(name) : undefined;
    }
    if (!local) {
      counts.unmatched += 1;
      return;
    }
    const exists = kind === 'player' ? (local as PlayerProfile).avatarExists : (local as TeamProfile).logoExists;
    if (exists) {
      counts.existing += 1;
    } else {
      counts.fill += 1;
    }
  });

  return counts;
}

/** 组合预览：比赛 diff + 档案 diff + 头像统计（预览与应用共用，保证判定一致） */
function buildPreview(paths: AppPaths, payload: SyncBundlePayload, mode: SyncConflictMode): SyncImportPreview {
  const normalized = normalizeImportedMatches(paths, payload.matches);
  const decisions = diffMatchRecords(paths, normalized.records, mode);
  const recordById = new Map(normalized.records.map((record) => [record.id, record]));

  const matchItems: SyncImportItem[] = decisions.map((decision) => {
    const record = recordById.get(decision.id);
    return {
      key: `match:${decision.id}`,
      kind: 'match',
      id: decision.id,
      label: record ? `${record.leftPlayer} vs ${record.rightPlayer}` : '',
      action: decision.action,
      reason: decision.reason,
      localUpdatedAt: decision.localUpdatedAt,
      incomingUpdatedAt: decision.incomingUpdatedAt,
    };
  });
  normalized.rejected.forEach((rejected) => {
    matchItems.push({
      key: `match:invalid-${rejected.index}`,
      kind: 'match',
      id: rejected.id || `第 ${rejected.index + 1} 条`,
      label: '（无效条目）',
      action: 'skip',
      reason: rejected.reason,
      localUpdatedAt: null,
      incomingUpdatedAt: null,
    });
  });

  const profileDiff = payload.profiles ? diffProfileRecords(paths, payload.profiles) : null;
  const playerItems: SyncImportItem[] = (profileDiff?.players ?? []).map((decision) => ({
    key: `player:${decision.id}`,
    kind: 'player',
    id: decision.id,
    label: decision.name,
    action: decision.action,
    reason: decision.reason,
    localUpdatedAt: null,
    incomingUpdatedAt: null,
  }));
  const teamItems: SyncImportItem[] = (profileDiff?.teams ?? []).map((decision) => ({
    key: `team:${decision.id}`,
    kind: 'team',
    id: decision.id,
    label: decision.name,
    action: decision.action,
    reason: decision.reason,
    localUpdatedAt: null,
    incomingUpdatedAt: null,
  }));
  (profileDiff?.rejected ?? []).forEach((rejected) => {
    const item: SyncImportItem = {
      key: `${rejected.kind}:invalid-${rejected.index}`,
      kind: rejected.kind,
      id: `第 ${rejected.index + 1} 条`,
      label: '（无效条目）',
      action: 'skip',
      reason: rejected.reason,
      localUpdatedAt: null,
      incomingUpdatedAt: null,
    };
    if (rejected.kind === 'player') {
      playerItems.push(item);
    } else {
      teamItems.push(item);
    }
  });

  const localMachine = loadRuntimeConfig(paths).machineCode;

  return {
    meta: {
      app: SYNC_APP_ID,
      schema: SYNC_BUNDLE_SCHEMA,
      machine: payload.machine,
      exportedAt: payload.exportedAt,
    },
    sameMachine: payload.machine === localMachine,
    mode,
    matchItems,
    playerItems,
    teamItems,
    summary: {
      match: countActions(matchItems),
      player: countActions(playerItems),
      team: countActions(teamItems),
    },
    avatars: {
      players: countAvatarFill(paths, payload, 'player'),
      teams: countAvatarFill(paths, payload, 'team'),
    },
  };
}

/** 导入预览：只读，逐条列出 新增 / 更新 / 跳过（含原因与时间戳） */
export function previewSyncImport(paths: AppPaths, raw: unknown, mode: SyncConflictMode): SyncImportPreview {
  return buildPreview(paths, parseSyncBundle(raw), mode);
}

/** 头像补缺：只写本地缺失的文件（源 id → 同名匹配），单张失败不影响整体 */
async function writeMissingAvatars(
  paths: AppPaths,
  payload: SyncBundlePayload,
  warnings: string[],
): Promise<{ players: number; teams: number }> {
  const written = { players: 0, teams: 0 };
  if (!payload.avatars) {
    return written;
  }

  const profiles = getProfileStore(paths);
  const playerById = new Map(profiles.players.map((entry) => [entry.id, entry]));
  const playerByName = new Map(profiles.players.map((entry) => [entry.name, entry]));
  const teamById = new Map(profiles.teams.map((entry) => [entry.id, entry]));
  const teamByName = new Map(profiles.teams.map((entry) => [entry.name, entry]));
  const playerNameById = buildBundleNameMap(payload, 'player');
  const teamNameById = buildBundleNameMap(payload, 'team');

  for (const [sourceId, base64] of Object.entries(payload.avatars.players)) {
    let target = playerById.get(sourceId);
    if (!target) {
      const name = playerNameById.get(sourceId);
      target = name ? playerByName.get(name) : undefined;
    }
    if (!target || target.avatarExists) {
      continue;
    }
    try {
      await saveProfilePlayerAvatar(paths, target.id, Buffer.from(base64, 'base64'));
      written.players += 1;
    } catch {
      warnings.push(`选手头像「${target.name}」写入失败（图片格式不合法？）`);
    }
  }

  for (const [sourceId, base64] of Object.entries(payload.avatars.teams)) {
    let target = teamById.get(sourceId);
    if (!target) {
      const name = teamNameById.get(sourceId);
      target = name ? teamByName.get(name) : undefined;
    }
    if (!target || target.logoExists) {
      continue;
    }
    try {
      await saveProfileTeamLogo(paths, target.id, Buffer.from(base64, 'base64'));
      written.teams += 1;
    } catch {
      warnings.push(`战队 logo「${target.name}」写入失败（图片格式不合法？）`);
    }
  }

  return written;
}

/**
 * 应用导入：服务端重新分类（不信任客户端），按 acceptedKeys 取交集后合并比赛与档案，
 * 再按 includeAvatars 补缺头像；不改动 activeMatchId / 撤销栈 / 推流状态。
 */
export async function applySyncImport(
  paths: AppPaths,
  raw: unknown,
  options: SyncApplyOptions,
): Promise<SyncImportResult> {
  const payload = parseSyncBundle(raw);
  const preview = buildPreview(paths, payload, options.mode);
  const accepted = new Set(options.acceptedKeys);
  const warnings: string[] = [];

  // 比赛：只合并「被勾选且非跳过」的条目
  const normalized = normalizeImportedMatches(paths, payload.matches);
  const acceptedMatchIds = new Set(
    preview.matchItems
      .filter((item) => accepted.has(item.key) && item.action !== 'skip')
      .map((item) => item.id),
  );
  const matchReport = mergeMatchRecords(
    paths,
    normalized.records.filter((record) => acceptedMatchIds.has(record.id)),
    options.mode,
  );
  if (normalized.rejected.length) {
    warnings.push(`包内有 ${normalized.rejected.length} 条比赛因 id 不合法被忽略`);
  }

  // 档案：只合并「被勾选且非跳过」的条目
  let profilesState: ProfileStoreState | null = null;
  if (payload.profiles) {
    const acceptedPlayerIds = new Set(
      preview.playerItems
        .filter((item) => accepted.has(item.key) && item.action !== 'skip')
        .map((item) => item.id),
    );
    const acceptedTeamIds = new Set(
      preview.teamItems
        .filter((item) => accepted.has(item.key) && item.action !== 'skip')
        .map((item) => item.id),
    );
    const profileReport = mergeProfileRecords(paths, payload.profiles, {
      players: acceptedPlayerIds,
      teams: acceptedTeamIds,
    });
    profilesState = profileReport.profiles;
    if (profileReport.rejected.length) {
      warnings.push(`包内有 ${profileReport.rejected.length} 条档案因 id 或名字不合法被忽略`);
    }
  }

  const avatarsWritten = options.includeAvatars
    ? await writeMissingAvatars(paths, payload, warnings)
    : { players: 0, teams: 0 };

  const applied: SyncImportPreview['summary'] = {
    match: { add: 0, update: 0, skip: 0 },
    player: { add: 0, update: 0, skip: 0 },
    team: { add: 0, update: 0, skip: 0 },
  };
  preview.matchItems.forEach((item) => {
    if (accepted.has(item.key)) {
      applied.match[item.action] += 1;
    }
  });
  preview.playerItems.forEach((item) => {
    if (accepted.has(item.key)) {
      applied.player[item.action] += 1;
    }
  });
  preview.teamItems.forEach((item) => {
    if (accepted.has(item.key)) {
      applied.team[item.action] += 1;
    }
  });

  return {
    store: matchReport.store,
    profiles: profilesState,
    applied,
    avatarsWritten,
    warnings,
  };
}