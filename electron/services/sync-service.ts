import fs from 'node:fs';

import { SYNC_APP_ID, SYNC_BUNDLE_SCHEMA, TOURNAMENT_ID_REGEX } from '../../shared/constants.js';
import type {
  PlayerProfile,
  ProfileStoreState,
  SyncAvatarCounts,
  SyncBundle,
  SyncBundlePlayerProfile,
  SyncBundleTeamProfile,
  SyncConflictMode,
  SyncImportAvatarCompare,
  SyncImportCounts,
  SyncImportDiffField,
  SyncImportItem,
  SyncImportPreview,
  SyncImportResult,
  SyncImportTournamentGroup,
  TeamProfile,
} from '../../shared/types.js';
import { loadRuntimeConfig } from './config-service.js';
import { saveProfilePlayerAvatar, saveProfileTeamLogo } from './image-service.js';
import {
  detachMatchesFromTournament,
  diffMatchRecords,
  getMatchStore,
  mergeMatchRecords,
  normalizeImportedMatches,
  purgeMatchesByIds,
} from './match-service.js';
import type { AppPaths } from './path-service.js';
import type { ProfileImportDecision } from './profile-service.js';
import { diffProfileRecords, getProfileStore, mergeProfileRecords } from './profile-service.js';
import {
  getLocallyRemovedTournaments,
  getTournamentRecordsIncludingTombstones,
  getTournamentStore,
  getTournamentTombstones,
  mergeTournamentRecords,
  runTournamentWriteBack,
} from './tournament-service.js';

/** 导出选项：头像只在包含档案时才有效（头像按档案 id 归属） */
export interface SyncExportOptions {
  includeProfiles: boolean;
  includeAvatars: boolean;
}

/** 解析后的同步包（包内条目保持 unknown，由各服务逐条规范化） */
export interface SyncBundlePayload {
  machine: string;
  exportedAt: string;
  matches: unknown[];
  /** 系列赛编排（旧包可能不含该字段，按空数组处理） */
  tournaments: unknown[];
  profiles: { players: unknown[]; teams: unknown[] } | null;
  avatars: { players: Record<string, string>; teams: Record<string, string> } | null;
}

export interface SyncApplyOptions {
  mode: SyncConflictMode;
  /** 前端勾选保留的 item.key 列表（服务端会重新分类后取交集，不信任客户端判定） */
  acceptedKeys: string[];
  includeAvatars: boolean;
  /**
   * 覆盖已有头像 / logo：默认只补缺（本地已有文件一律跳过），
   * 勾选后用包内图片覆盖本机同档案的头像（预览里会提示「已有头像将被覆盖」的张数）。
   */
  overwriteAvatars?: boolean;
  /**
   * 跳过系列赛编排合并（云同步的主控确认台走这条路）：
   * 确认赛果只合并比赛记录，编排结构由本机（编排机）自己持有，绝不能用分控端回传的副本覆盖。
   */
  skipTournaments?: boolean;
  /**
   * 用户在预览里取消勾选的系列赛 id：**其编排不合并，且它包含的比赛一律不写入**
   * （不是过滤已勾选的比赛，而是「这整条系列赛本次不导入」）。
   */
  excludeTournamentIds?: string[];
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
 * 导出同步包：比赛（全部场次，含空白/进行中，基线分发需要）+ 系列赛编排 + 可选档案与头像。
 * 头像只在 includeProfiles 时附带（按档案 id 归属）。
 */
export function exportSyncBundle(paths: AppPaths, options: SyncExportOptions): SyncBundle {
  // 墓碑必须随包导出（含从别机传播留存的），否则"删除"传播不出去；
  // 「连同对局删除」名单里的对局不再进包，旧副本不会随新包继续流转
  // （主控事后从撤销栈撤回恢复的对局同理不再回流分控，见墓碑方案的已知语义）。
  // 「本机移除」（localOnly）只属于本机：整条剔除，绝不外传（否则接收端会误判成删除指令）。
  const tombstoneMatchIds = new Set(
    getTournamentTombstones(paths)
      .filter((record) => record.deletedMatches)
      .flatMap((record) => record.deletedMatchIds ?? []),
  );
  const bundle: SyncBundle = {
    app: SYNC_APP_ID,
    schema: SYNC_BUNDLE_SCHEMA,
    machine: loadRuntimeConfig(paths).machineCode,
    exportedAt: new Date().toISOString(),
    matches: getMatchStore(paths).matches.filter((match) => !tombstoneMatchIds.has(match.id)),
    tournaments: getTournamentRecordsIncludingTombstones(paths)
      .filter((record) => !record.localOnly),
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
export function parseSyncBundle(raw: unknown): SyncBundlePayload {
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
    tournaments: Array.isArray(payload.tournaments) ? payload.tournaments as unknown[] : [],
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

/**
 * 档案目标解析：**id 别名（对方 id → 本机 id）→ 源 id 精确命中 → 同名匹配**。
 * 头像 / logo 按「档案 id」归属，包内 key 往往是对方机器的 id（对方机器上导出时用的是它自己的 id），
 * 所以必须先过别名表，否则只能靠同名兜底 —— 对方改了名字或本机改了名字就落不到本机档案上。
 */
function resolveLocalProfileEntry(
  localEntries: Array<PlayerProfile | TeamProfile>,
  sourceId: string,
  nameById: Map<string, string>,
  aliases?: Record<string, string>,
): PlayerProfile | TeamProfile | undefined {
  const byAlias = localEntries.find((entry) => entry.id === (aliases?.[sourceId] ?? sourceId));
  if (byAlias) {
    return byAlias;
  }
  const name = nameById.get(sourceId);
  return name ? localEntries.find((entry) => entry.name === name) : undefined;
}

function avatarExistsOf(kind: 'player' | 'team', entry: PlayerProfile | TeamProfile): boolean {
  return kind === 'player' ? (entry as PlayerProfile).avatarExists : (entry as TeamProfile).logoExists;
}

/**
 * 头像补缺统计：源 id 命中本机档案（或本次将新增该档案）→ 本地缺文件算补缺、已有算保持；命中不到算 unmatched。
 */
function countAvatarFill(
  profiles: ProfileStoreState,
  payload: SyncBundlePayload,
  kind: 'player' | 'team',
  addedIds: Set<string>,
): SyncAvatarCounts {
  const counts: SyncAvatarCounts = { fill: 0, existing: 0, unmatched: 0 };
  const avatarMap = kind === 'player' ? payload.avatars?.players : payload.avatars?.teams;
  if (!avatarMap) {
    return counts;
  }

  const localEntries = kind === 'player' ? profiles.players : profiles.teams;
  const nameById = buildBundleNameMap(payload, kind);
  const aliases = kind === 'player' ? profiles.playerAliases : profiles.teamAliases;

  Object.keys(avatarMap).forEach((sourceId) => {
    const local = resolveLocalProfileEntry(localEntries, sourceId, nameById, aliases);
    // 包内新增的档案导入后会按源 id 落盘，头像同样能补缺
    if (!local && !addedIds.has(sourceId)) {
      counts.unmatched += 1;
      return;
    }
    if (local && avatarExistsOf(kind, local)) {
      counts.existing += 1;
    } else {
      counts.fill += 1;
    }
  });

  return counts;
}

interface AvatarDiffInfo {
  diffField: SyncImportDiffField | null;
  compare: SyncImportAvatarCompare | null;
}

/**
 * 头像 / logo 的左右对照与差异行（只在「头像可用性发生变化」时给出，避免两边都有头像时的噪音）：
 * - 本机缺、包内有 → 「无 → 有（导入后补缺）」并附包内头像预览（本机无对应档案则提示不会写入）
 * - 本机有、包内无 → 「有（保持本机）→ 无」
 * - 两边都有 / 两边都无 → 无差异，不显示
 * 说明：两边都有头像时不做逐字节比对（导入会经 sharp 重新压缩，字节比较易误报）。
 */
function buildAvatarDiffInfo(
  profiles: ProfileStoreState,
  payload: SyncBundlePayload,
  kind: 'player' | 'team',
  sourceId: string,
  willBeAdded: boolean,
): AvatarDiffInfo {
  const avatarMap = kind === 'player' ? payload.avatars?.players : payload.avatars?.teams;
  if (!avatarMap) {
    return { diffField: null, compare: null };
  }

  const base64 = avatarMap[sourceId] ?? null;
  const label = kind === 'player' ? '头像' : 'logo';
  const localEntries = kind === 'player' ? profiles.players : profiles.teams;
  const aliases = kind === 'player' ? profiles.playerAliases : profiles.teamAliases;
  const local = resolveLocalProfileEntry(localEntries, sourceId, buildBundleNameMap(payload, kind), aliases);
  const localExists = local ? avatarExistsOf(kind, local) : false;

  if (!base64 && !localExists) {
    return { diffField: null, compare: null };
  }

  if (base64 && !localExists) {
    const canFill = Boolean(local) || willBeAdded;
    return {
      diffField: { label, local: '无', incoming: canFill ? '有（导入后补缺）' : '有（本机无对应档案，不会写入）' },
      compare: {
        localUrl: null,
        incomingDataUrl: `data:image/png;base64,${base64}`,
        note: canFill ? '导入后将补缺到本机' : '包内有头像，但本机没有对应档案，不会写入',
      },
    };
  }

  if (base64 && localExists) {
    return { diffField: null, compare: null };
  }

  return {
    diffField: { label, local: '有（保持本机）', incoming: '无' },
    compare: null,
  };
}

/**
 * 按系列赛给预览里的比赛分组（供预览弹窗展示「这条系列赛包含哪些比赛」）：
 * 包内编排 + 本机已有编排两边都看，保证「包内没带编排、只有比赛挂了引用」的情况也能分组显示。
 */
function buildTournamentGroups(
  paths: AppPaths,
  payload: SyncBundlePayload,
  matchItems: SyncImportItem[],
): { groups: SyncImportTournamentGroup[]; hasTournaments: boolean } {
  const localById = new Map(getTournamentStore(paths).map((record) => [record.id, record]));
  // 本机移除（localOnly）的记录不进 getTournamentStore：单独取一份用于「保持隐藏」标记与名称兜底
  const localRemovedById = new Map(getLocallyRemovedTournaments(paths).map((record) => [record.id, record]));
  // 本机真实墓碑（已删除）：组上标「本机已删除」，提示名单内对局会被拦截
  const localTombstoneById = new Map(getTournamentTombstones(paths).map((record) => [record.id, record]));
  const incomingById = new Map<string, Record<string, unknown>>();
  payload.tournaments.forEach((raw) => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const id = String(record.id ?? '').trim();
    if (id) {
      incomingById.set(id, record);
    }
  });

  // 比赛 key -> 系列赛 id（来自包内的 tournamentRef；没有引用的归「普通对局」）
  const matchItemById = new Map(matchItems.map((item) => [item.id, item]));
  const tournamentIdOfMatch = new Map<string, string>();
  payload.matches.forEach((raw) => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const id = String(record.id ?? '').trim();
    const ref = record.tournamentRef as { tournamentId?: unknown } | undefined;
    const tournamentId = ref && typeof ref.tournamentId === 'string' ? ref.tournamentId.trim() : '';
    if (id && tournamentId) {
      tournamentIdOfMatch.set(id, tournamentId);
    }
  });

  const groups = new Map<string, SyncImportTournamentGroup>();
  const ensureGroup = (id: string): SyncImportTournamentGroup => {
    const key = id ? `tournament:${id}` : 'plain';
    const existing = groups.get(key);
    if (existing) {
      return existing;
    }
    const incoming = id ? incomingById.get(id) : undefined;
    const local = id ? localById.get(id) : undefined;
    const locallyRemoved = id ? localRemovedById.get(id) : undefined;
    const localTombstone = id ? localTombstoneById.get(id) : undefined;
    const created: SyncImportTournamentGroup = {
      key,
      id,
      name: String(incoming?.name ?? local?.name ?? locallyRemoved?.name ?? '').trim(),
      incoming: Boolean(incoming),
      existsLocally: Boolean(local),
      playerCount: Array.isArray(incoming?.playerIds)
        ? (incoming!.playerIds as unknown[]).length
        : (local?.playerIds.length ?? null),
      stageSummary: local
        ? `${local.stages[local.currentStageIndex]?.name ?? '阶段'} · 第 ${local.waves.filter((wave) => wave.stageIndex === local.currentStageIndex).length} 波`
        : '',
      matchKeys: [],
      selectableCount: 0,
      tombstone: Boolean(incoming?.deletedAt),
      localRemoved: Boolean(locallyRemoved),
      localTombstone: Boolean(localTombstone),
    };
    groups.set(key, created);
    return created;
  };

  matchItems.forEach((item) => {
    if (item.kind !== 'match') {
      return;
    }
    const tournamentId = tournamentIdOfMatch.get(item.id) ?? '';
    const group = ensureGroup(tournamentId);
    group.matchKeys.push(item.key);
    if (item.action !== 'skip' && matchItemById.has(item.id)) {
      group.selectableCount += 1;
    }
  });

  // 包内带了编排、但一场相关比赛都没进预览的系列赛也要显示（用户可以自己决定导不导）
  incomingById.forEach((record, id) => {
    const group = ensureGroup(id);
    if (!group.name) {
      group.name = String(record.name ?? '').trim();
    }
  });

  const list = Array.from(groups.values()).filter((group) => group.id || group.matchKeys.length);
  // 系列赛组在前（按名称），普通对局最后
  list.sort((a, b) => {
    if (!a.id !== !b.id) {
      return a.id ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return { groups: list, hasTournaments: payload.tournaments.length > 0 };
}

/**
 * 「已删对局名单」拦截集合（与 applySyncImport 合并侧同口径，供预览提前标注）：
 * 本机现有真墓碑 + 包内将被接受的真墓碑（鉴权同 mergeTournamentRecords：包作者需与 id 内嵌码一致）
 * 里 deletedMatches=true 的名单并集。名单里的比赛合并时一律被过滤——预览若不提前标出，
 * 它们会永远显示为「新增」却从不写入（如：本机已删除该系列赛、上游旧包仍在带这些对局）。
 */
function collectBlockedMatchIds(paths: AppPaths, payload: SyncBundlePayload): Set<string> {
  const ids = new Set<string>();
  const addList = (deletedMatches: unknown, deletedMatchIds: unknown) => {
    if (deletedMatches !== true || !Array.isArray(deletedMatchIds)) {
      return;
    }
    deletedMatchIds.forEach((item) => {
      const id = String(item ?? '').trim();
      if (id) {
        ids.add(id);
      }
    });
  };
  getTournamentTombstones(paths).forEach((record) => addList(record.deletedMatches, record.deletedMatchIds));
  const author = String(payload.machine ?? '').trim().toUpperCase();
  payload.tournaments.forEach((raw) => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const id = String(record.id ?? '').trim();
    if (!id || !String(record.deletedAt ?? '').trim()) {
      return;
    }
    const owner = (TOURNAMENT_ID_REGEX.exec(id)?.[2] ?? '').toUpperCase();
    if (owner && author && author !== owner) {
      return; // 该墓碑会被合并侧忽略（来源不是编排机），不能提前拦截
    }
    addList(record.deletedMatches, record.deletedMatchIds);
  });
  return ids;
}

/** 组合预览：比赛 diff + 档案 diff + 头像统计（预览与应用共用，保证判定一致） */
function buildPreview(paths: AppPaths, payload: SyncBundlePayload, mode: SyncConflictMode): SyncImportPreview {
  const normalized = normalizeImportedMatches(paths, payload.matches);
  const decisions = diffMatchRecords(paths, normalized.records, mode);
  const recordById = new Map(normalized.records.map((record) => [record.id, record]));
  // 预览与应用同口径：命中「已删对局名单」的比赛合并时不会写入，预览先标为跳过，不再算「新增」
  const blockedMatchIds = collectBlockedMatchIds(paths, payload);

  const matchItems: SyncImportItem[] = decisions.map((decision) => {
    const record = recordById.get(decision.id);
    const blocked = blockedMatchIds.has(decision.id);
    const item: SyncImportItem = {
      key: `match:${decision.id}`,
      kind: 'match',
      id: decision.id,
      label: record ? `${record.leftPlayer} vs ${record.rightPlayer}` : '',
      action: blocked ? 'skip' : decision.action,
      reason: blocked ? '已被本机「已删除系列赛」的对局名单拦截，不会写入' : decision.reason,
      localUpdatedAt: decision.localUpdatedAt,
      incomingUpdatedAt: decision.incomingUpdatedAt,
      conflict: decision.conflict,
      diff: decision.diff,
    };
    if (blocked) {
      item.blocked = true;
    }
    return item;
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
      conflict: false,
      diff: [],
    });
  });

  const profileDiff = payload.profiles ? diffProfileRecords(paths, payload.profiles) : null;
  const profilesNow = getProfileStore(paths);
  const addedIdsOf = (decisions: ProfileImportDecision[] | undefined) => new Set(
    (decisions ?? []).filter((decision) => decision.action === 'add').map((decision) => decision.id),
  );
  const addedPlayerIds = addedIdsOf(profileDiff?.players);
  const addedTeamIds = addedIdsOf(profileDiff?.teams);

  // 档案项：把头像 / logo 的差异行与左右对照合并进同一条目
  const toProfileItem = (kind: 'player' | 'team', decision: ProfileImportDecision): SyncImportItem => {
    const avatarInfo = payload.avatars
      ? buildAvatarDiffInfo(profilesNow, payload, kind, decision.id, decision.action === 'add')
      : { diffField: null, compare: null };

    const item: SyncImportItem = {
      key: `${kind}:${decision.id}`,
      kind,
      id: decision.id,
      label: decision.name,
      action: decision.action,
      reason: decision.reason,
      localUpdatedAt: null,
      incomingUpdatedAt: null,
      conflict: false,
      diff: avatarInfo.diffField ? [...decision.diff, avatarInfo.diffField] : decision.diff,
    };
    if (avatarInfo.compare) {
      item.avatarCompare = avatarInfo.compare;
    }
    return item;
  };

  const playerItems: SyncImportItem[] = (profileDiff?.players ?? []).map((decision) => toProfileItem('player', decision));
  const teamItems: SyncImportItem[] = (profileDiff?.teams ?? []).map((decision) => toProfileItem('team', decision));
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
      conflict: false,
      diff: [],
    };
    if (rejected.kind === 'player') {
      playerItems.push(item);
    } else {
      teamItems.push(item);
    }
  });

  const localMachine = loadRuntimeConfig(paths).machineCode;
  const tournamentGrouping = buildTournamentGroups(paths, payload, matchItems);

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
    tournamentGroups: tournamentGrouping.groups,
    hasTournaments: tournamentGrouping.hasTournaments,
    summary: {
      match: countActions(matchItems),
      player: countActions(playerItems),
      team: countActions(teamItems),
    },
    avatars: {
      players: countAvatarFill(profilesNow, payload, 'player', addedPlayerIds),
      teams: countAvatarFill(profilesNow, payload, 'team', addedTeamIds),
    },
  };
}

/** 导入预览：只读，逐条列出 新增 / 更新 / 跳过（含原因与时间戳） */
export function previewSyncImport(paths: AppPaths, raw: unknown, mode: SyncConflictMode): SyncImportPreview {
  return buildPreview(paths, parseSyncBundle(raw), mode);
}

/**
 * 头像 / logo 写入：目标档案解析走「别名 → 源 id → 同名」，落盘一律用**本机档案 id**。
 * 默认只补缺（本机已有文件跳过）；overwrite = true 时用包内图片覆盖本机同档案的头像。
 * 单张失败（图片格式不合法等）只记警告，不影响整体导入。
 */
async function writeSyncAvatars(
  paths: AppPaths,
  payload: SyncBundlePayload,
  warnings: string[],
  overwrite: boolean,
): Promise<{ players: number; teams: number }> {
  const written = { players: 0, teams: 0 };
  if (!payload.avatars) {
    return written;
  }

  const profiles = getProfileStore(paths);
  const playerNameById = buildBundleNameMap(payload, 'player');
  const teamNameById = buildBundleNameMap(payload, 'team');

  for (const [sourceId, base64] of Object.entries(payload.avatars.players)) {
    const target = resolveLocalProfileEntry(profiles.players, sourceId, playerNameById, profiles.playerAliases);
    if (!target || (avatarExistsOf('player', target) && !overwrite)) {
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
    const target = resolveLocalProfileEntry(profiles.teams, sourceId, teamNameById, profiles.teamAliases);
    if (!target || (avatarExistsOf('team', target) && !overwrite)) {
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
 * 再按 includeAvatars 补缺头像；系列赛编排自动合并（不参与勾选）并补跑写回；
 * 不改动 activeMatchId / 撤销栈 / 推流状态。
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

  // 用户在预览里取消勾选的系列赛：整条本次不导入（编排不合并 + 它包含的比赛不写入）
  const excludedTournamentIds = new Set(
    (options.excludeTournamentIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean),
  );
  const excludedMatchIds = new Set<string>();
  if (excludedTournamentIds.size) {
    (preview.tournamentGroups ?? []).forEach((group) => {
      if (group.id && excludedTournamentIds.has(group.id)) {
        group.matchKeys.forEach((key) => accepted.delete(key));
        payload.matches.forEach((raw) => {
          const record = (raw ?? {}) as Record<string, unknown>;
          const ref = record.tournamentRef as { tournamentId?: unknown } | undefined;
          if (ref && typeof ref.tournamentId === 'string' && ref.tournamentId === group.id) {
            excludedMatchIds.add(String(record.id ?? ''));
          }
        });
      }
    });
    if (excludedMatchIds.size) {
      warnings.push(`已按你的选择跳过 ${excludedTournamentIds.size} 个系列赛（含其 ${excludedMatchIds.size} 场比赛）`);
    }
  }

  // 系列赛：编排数据随包流转（自动合并，不进勾选列表）。
  // 只有编排机会修改系列赛，只读副本的本地版本不会反向覆盖编排机（见 tournament-service 所有权校验）。
  // 墓碑不参与「取消勾选」：删除指令不是可选项，否则被取消勾选的旧副本永远清不掉。
  const tombstonesBefore = new Set(getTournamentTombstones(paths).map((record) => record.id));
  const incomingTournaments = options.skipTournaments
    ? []
    : payload.tournaments.filter((raw) => {
      const record = (raw ?? {}) as Record<string, unknown>;
      const id = String(record.id ?? '').trim();
      return !id || !excludedTournamentIds.has(id) || Boolean(record.deletedAt);
    });
  const tournamentReport = mergeTournamentRecords(paths, incomingTournaments, options.mode, {
    authoredBy: payload.machine,
  });
  if (tournamentReport.rejected) {
    warnings.push(`包内有 ${tournamentReport.rejected} 条系列赛记录不合法被忽略`);
  }
  if (!options.skipTournaments && incomingTournaments.length && !loadRuntimeConfig(paths).machineCode) {
    warnings.push('本机未设置机器标识（machineCode），系列赛所有权无法区分，双机编排可能冲突');
  }

  // 墓碑对局名单：全部本机墓碑（含本次合入）里「连同对局删除」的名单——
  // 这些对局不再从外部包合入、不再导出 / 回传，旧包与在途回传都带不回来（防"已删对局回魂"）。
  const tombstones = getTournamentTombstones(paths);
  const tombstoneMatchIds = new Set(
    tombstones
      .filter((record) => record.deletedMatches)
      .flatMap((record) => record.deletedMatchIds ?? []),
  );

  // 比赛：只合并「被勾选且非跳过」的条目；排除被取消勾选系列赛名下的比赛与墓碑名单里的已删对局
  const normalized = normalizeImportedMatches(paths, payload.matches);
  const acceptedMatchIds = new Set(
    preview.matchItems
      .filter((item) => accepted.has(item.key) && item.action !== 'skip')
      .map((item) => item.id),
  );
  mergeMatchRecords(
    paths,
    normalized.records.filter((record) => (
      acceptedMatchIds.has(record.id)
      && !excludedMatchIds.has(record.id)
      && !tombstoneMatchIds.has(record.id)
    )),
    options.mode,
  );
  if (normalized.rejected.length) {
    warnings.push(`包内有 ${normalized.rejected.length} 条比赛因 id 不合法被忽略`);
  }

  // 解绑 / 拦截不变量：每次合并后统一收口（不只"收到墓碑那一刻"）——
  // 引用墓碑系列赛的比赛一律解绑（旧包能把 tournamentRef 带回来，靠这里再解一次）；
  // 本次新收到的墓碑若"连同对局删除"，按名单在本机一并移除
  // （复制的既成事实，不进撤销栈；只在新墓碑到达时执行一次，之后由名单过滤拦截）。
  let tombstoneDetached = 0;
  tombstones.forEach((record) => {
    tombstoneDetached += detachMatchesFromTournament(paths, record.id).matchIds.length;
  });
  const freshlyDeletedMatchIds = tombstones
    .filter((record) => !tombstonesBefore.has(record.id) && record.deletedMatches)
    .flatMap((record) => record.deletedMatchIds ?? []);
  const tombstonePurged = purgeMatchesByIds(paths, freshlyDeletedMatchIds);
  if (tombstoneDetached || tombstonePurged) {
    warnings.push(
      `已按上游墓碑清理本机数据：解绑 ${tombstoneDetached} 场对局${tombstonePurged ? `、移除 ${tombstonePurged} 场已删对局` : ''}`,
    );
  }

  // 写回补跑：把包内带来的「已完成」赛果在编排机上补写回系列赛（幂等；只读副本自动跳过）。
  // 双机「各登记一半」流程在这里汇合：最后一场补齐时自动推进、生成下一波比赛。
  const writeBack = runTournamentWriteBack(paths);
  warnings.push(...writeBack.warnings);

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
    ? await writeSyncAvatars(paths, payload, warnings, options.overwriteAvatars === true)
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
    store: getMatchStore(paths),
    profiles: profilesState,
    applied,
    avatarsWritten,
    tournaments: {
      added: tournamentReport.added.length,
      updated: tournamentReport.updated.length,
      skipped: tournamentReport.skipped.length,
      rejected: tournamentReport.rejected,
      advanced: writeBack.advanced,
    },
    warnings,
  };
}