import fs from 'node:fs';

import {
  CLOUD_SYNC_REQUEST_TIMEOUT_MS,
  CLOUD_SYNC_ROSTER_MAX,
  CLOUD_SYNC_UPLINK_MAX_MATCHES,
  SYNC_APP_ID,
  SYNC_BUNDLE_SCHEMA,
} from '../../shared/constants.js';
import type {
  CloudSyncAckItem,
  CloudSyncAckPayload,
  CloudSyncAckSource,
  CloudSyncActionResult,
  CloudSyncCheckResult,
  CloudSyncConfirmResult,
  CloudSyncInboxEntry,
  CloudSyncOffer,
  CloudSyncPendingMatch,
  CloudSyncPendingQueue,
  CloudSyncPollResult,
  CloudSyncPullResult,
  CloudSyncPushResult,
  CloudSyncRejectResult,
  CloudSyncRole,
  CloudSyncRosterEntry,
  CloudSyncStatus,
  CloudSyncTestResult,
  CloudSyncUploadResult,
  CloudSyncUplinkPayload,
  CloudSyncVersion,
  MatchRecord,
  MachineCodeGuardResult,
  SyncBundle,
  SyncConflictMode,
  SyncImportPreview,
} from '../../shared/types.js';
import type { RuntimeConfig } from './config-service.js';
import { loadRuntimeConfig, normalizeMachineCode, saveRuntimeConfig } from './config-service.js';
import { getMatchStore, resetMatchRegistrations } from './match-service.js';
import type { AppPaths } from './path-service.js';
import { applySyncImport, exportSyncBundle, parseSyncBundle, previewSyncImport, type SyncBundlePayload } from './sync-service.js';
import { getTournamentStore, resolveTournamentLabels } from './tournament-service.js';

/* ==================== 云端信箱（Worker + KV）读写 ==================== */

type CloudBox = 'downlink' | 'version' | `uplink/${string}` | `ack/${string}`;

interface MailboxRead<T> {
  exists: boolean;
  modifiedAt: string | null;
  value: T | null;
}

function buildBoxUrl(config: RuntimeConfig, box: CloudBox): string {
  // 房间密钥与访问令牌都走请求头：URL 里不再出现任何密钥（避免进 Cloudflare 日志/分析）
  return `${config.workerUrl}/room/${box}`;
}

/** 统一鉴权头：X-Sync-Key 决定键空间隔离，X-Sync-Token 是 Worker 侧的大门 */
function authHeaders(config: RuntimeConfig): Record<string, string> {
  return {
    'X-Sync-Key': config.syncKey,
    'X-Sync-Token': config.syncToken,
  };
}

/**
 * 信箱请求：读写都带 X-Sync-Key（键空间隔离）与 X-Sync-Token（Worker 侧强制校验，读也校验，
 * 避免拿到链接就能拉走数据）。超时/网络错误统一转中文错误，界面直接可读；HTTP 错误取出 Worker 的 error 字段。
 */
async function mailboxRequest<T>(
  config: RuntimeConfig,
  box: CloudBox,
  init: { method: 'GET' | 'PUT' | 'DELETE'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  if (!config.workerUrl) {
    throw new Error('未配置 Worker 地址，请先在「云同步设置区」填写并保存');
  }
  if (!config.syncKey) {
    throw new Error('未配置房间密钥（syncKey），请先在「云同步设置区」填写并保存');
  }
  if (!config.syncToken) {
    throw new Error('未配置访问令牌（Worker 侧 SYNC_TOKEN），请先在「云同步设置区」填写并保存');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_SYNC_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(buildBoxUrl(config, box), {
      method: init.method,
      headers: {
        ...authHeaders(config),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      controller.signal.aborted
        ? `访问云端超时（${CLOUD_SYNC_REQUEST_TIMEOUT_MS / 1000} 秒）：请检查网络与 Worker 地址是否可达`
        : `访问云端失败：${error instanceof Error ? error.message : String(error)}（大陆网络对 *.workers.dev 可达性不稳，必要时绑定自定义域）`,
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? String((payload as { error: string }).error)
      : `云端返回 HTTP ${response.status}`;
    // 401/503 是鉴权问题：补一句「去哪修」，别让人对着「不可达」猜
    if (response.status === 401) {
      throw new Error(`${message}（本机访问令牌与 Worker 的 SYNC_TOKEN 必须一致）`);
    }
    if (response.status === 503) {
      throw new Error(`${message}（运营者需在 cloudflare 目录执行 npx wrangler secret put SYNC_TOKEN）`);
    }
    throw new Error(message);
  }

  return payload as T;
}

async function readBox<T>(config: RuntimeConfig, box: CloudBox): Promise<MailboxRead<T>> {
  const result = await mailboxRequest<{
    success?: boolean;
    exists?: boolean;
    modifiedAt?: string | null;
    value?: T | null;
  }>(config, box, { method: 'GET' });
  return {
    exists: result?.exists === true,
    modifiedAt: typeof result?.modifiedAt === 'string' ? result.modifiedAt : null,
    value: (result?.value ?? null) as T | null,
  };
}

async function writeBox(config: RuntimeConfig, box: CloudBox, value: unknown): Promise<string> {
  const result = await mailboxRequest<{ success?: boolean; modifiedAt?: string }>(config, box, {
    method: 'PUT',
    body: value,
  });
  return typeof result?.modifiedAt === 'string' ? result.modifiedAt : new Date().toISOString();
}

/* ==================== 本机云同步状态（cache/cloud-sync.json） ==================== */

interface CloudSyncLocalState {
  /** 云端版本号 + 时间（红点轮询读到的最新值） */
  version: CloudSyncVersion | null;
  /** 本机已合并落地的云端版本号（分控端「已同步」判据） */
  appliedVersion: number;
  /** 最近一次分发 / 拉取 / 回传 / 写回执的时间（本机记录，不用心跳） */
  lastPushedAt: string | null;
  lastPulledAt: string | null;
  lastUploadedAt: string | null;
  lastAckedAt: string | null;
  lastError: string;
  /** 已回传序号（每次回传 +1）与回传时间 */
  seq: number;
  submittedAt: string | null;
  /** 主控回执：已确认比赛 id 与回执时间（分控端据此清理待回传标记并锁定撤回） */
  ackedMatchIds: string[];
  ackedAt: string | null;
  /** 房间名册（主控端本地维护，分控端来自最近一次拉取） */
  roster: CloudSyncRosterEntry[];
  /** 指派规则：比赛 id -> 登记机器码（空字符串 = 主控端自己登记），分控端来自最近一次拉取 */
  assignment: Record<string, string>;
  assignmentUpdatedAt: string | null;
  /** 收件箱快照：分控端机器码 -> 最近一次读到的回传内容（主控端） */
  inbox: Record<string, CloudSyncUplinkPayload>;
}

const DEFAULT_LOCAL_STATE: CloudSyncLocalState = {
  version: null,
  appliedVersion: 0,
  lastPushedAt: null,
  lastPulledAt: null,
  lastUploadedAt: null,
  lastAckedAt: null,
  lastError: '',
  seq: 0,
  submittedAt: null,
  ackedMatchIds: [],
  ackedAt: null,
  roster: [],
  assignment: {},
  assignmentUpdatedAt: null,
  inbox: {},
};

function emptyLocalState(): CloudSyncLocalState {
  return { ...DEFAULT_LOCAL_STATE, roster: [], assignment: {}, ackedMatchIds: [], inbox: {} };
}

function normalizeVersion(value: unknown): CloudSyncVersion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const version = Number(raw.v);
  if (!Number.isFinite(version)) {
    return null;
  }
  return {
    v: Math.max(0, Math.floor(version)),
    at: typeof raw.at === 'string' ? raw.at : '',
    from: normalizeMachineCode(raw.from),
  };
}

function loadLocalState(paths: AppPaths): CloudSyncLocalState {
  if (!fs.existsSync(paths.cloudSyncFile)) {
    return emptyLocalState();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(paths.cloudSyncFile, 'utf-8')) as Partial<CloudSyncLocalState>;
    return {
      version: normalizeVersion(raw.version),
      appliedVersion: Number.isFinite(Number(raw.appliedVersion))
        ? Math.max(0, Math.floor(Number(raw.appliedVersion)))
        : 0,
      lastPushedAt: typeof raw.lastPushedAt === 'string' ? raw.lastPushedAt : null,
      lastPulledAt: typeof raw.lastPulledAt === 'string' ? raw.lastPulledAt : null,
      lastUploadedAt: typeof raw.lastUploadedAt === 'string' ? raw.lastUploadedAt : null,
      lastAckedAt: typeof raw.lastAckedAt === 'string' ? raw.lastAckedAt : null,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
      seq: Number.isFinite(Number(raw.seq)) ? Math.max(0, Math.floor(Number(raw.seq))) : 0,
      submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : null,
      ackedMatchIds: Array.isArray(raw.ackedMatchIds)
        ? raw.ackedMatchIds.map((item) => String(item ?? '')).filter(Boolean)
        : [],
      ackedAt: typeof raw.ackedAt === 'string' ? raw.ackedAt : null,
      roster: normalizeRoster(raw.roster),
      assignment: normalizeAssignment(raw.assignment),
      assignmentUpdatedAt: typeof raw.assignmentUpdatedAt === 'string' ? raw.assignmentUpdatedAt : null,
      inbox: normalizeInbox(raw.inbox),
    };
  } catch {
    return emptyLocalState();
  }
}

function normalizeInbox(value: unknown): Record<string, CloudSyncUplinkPayload> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, CloudSyncUplinkPayload> = {};
  Object.entries(value as Record<string, unknown>).forEach(([code, payload]) => {
    const raw = (payload ?? {}) as Record<string, unknown>;
    if (!Array.isArray(raw.matches)) {
      return;
    }
    result[code] = {
      from: normalizeMachineCode(raw.from) || code,
      seq: Number.isFinite(Number(raw.seq)) ? Math.max(0, Math.floor(Number(raw.seq))) : 0,
      submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : '',
      matches: raw.matches as MatchRecord[],
    };
  });
  return result;
}

function saveLocalState(paths: AppPaths, patch: Partial<CloudSyncLocalState>): CloudSyncLocalState {
  const next = { ...loadLocalState(paths), ...patch };
  fs.mkdirSync(paths.cacheDir, { recursive: true });
  fs.writeFileSync(paths.cloudSyncFile, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

/** 记录一次操作结果：失败留最后一条原因（界面常显），成功清空 */
function finish(paths: AppPaths, patch: Partial<CloudSyncLocalState> = {}, error?: unknown): CloudSyncLocalState {
  return saveLocalState(paths, {
    ...patch,
    lastError: error ? (error instanceof Error ? error.message : String(error)) : '',
  });
}

/* ==================== 名册 / 指派规则规范化 ==================== */

function normalizeRoster(value: unknown): CloudSyncRosterEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const roster: CloudSyncRosterEntry[] = [];
  value.forEach((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const code = normalizeMachineCode(raw.code);
    if (!code || seen.has(code) || roster.length >= CLOUD_SYNC_ROSTER_MAX) {
      return;
    }
    seen.add(code);
    roster.push({ code, label: String(raw.label ?? '').trim().slice(0, 16) });
  });
  return roster;
}

function normalizeAssignment(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([matchId, code]) => {
    result[String(matchId)] = normalizeMachineCode(code);
  });
  return result;
}

/** 读取云同步包携带的策略载荷（名册 + 指派规则），缺字段按空处理 */
function readCloudOffer(bundle: unknown): CloudSyncOffer | null {
  if (!bundle || typeof bundle !== 'object') {
    return null;
  }
  const raw = (bundle as { cloud?: unknown }).cloud;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const offer = raw as Record<string, unknown>;
  const assignmentRaw = offer.assignment && typeof offer.assignment === 'object' && !Array.isArray(offer.assignment)
    ? offer.assignment as Record<string, unknown>
    : {};
  const overrides = normalizeAssignment(
    'overrides' in assignmentRaw ? assignmentRaw.overrides : assignmentRaw,
  );
  return {
    roster: normalizeRoster(offer.roster),
    assignment: {
      overrides,
      updatedAt: typeof assignmentRaw.updatedAt === 'string' ? assignmentRaw.updatedAt : new Date().toISOString(),
    },
  };
}

/** 读取云同步包里的机器码/时间（不跑完整校验，仅用于配对校验与展示） */
function readBundleMeta(bundle: unknown): { machine: string; exportedAt: string } {
  const raw = (bundle ?? {}) as Record<string, unknown>;
  return {
    machine: normalizeMachineCode(raw.machine),
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
  };
}

/* ==================== 本机角色 / 编排归属 ==================== */

function localCode(paths: AppPaths): string {
  return loadRuntimeConfig(paths).machineCode;
}

/** 系列赛 id 内嵌的编排机机器码（T{日期}_{机器码}{序号}） */
function tournamentOwnerCode(tournamentId: string): string | null {
  const matched = /^T\d{8}_([A-Za-z]{0,2})\d+$/.exec(tournamentId);
  return matched ? matched[1].toUpperCase() : null;
}

/** 本机为编排机的系列赛 id（确认台据此判断哪些赛果能真正写回推进） */
function ownedTournamentIds(paths: AppPaths): string[] {
  const machine = localCode(paths);
  return getTournamentStore(paths)
    .filter((record) => tournamentOwnerCode(record.id) === machine)
    .map((record) => record.id);
}

/** 指派作用域：显式指派优先；未列出/指派为空一律归主控端自己登记 */
function assignmentScopeOf(paths: AppPaths, matchId: string): string {
  return loadLocalState(paths).assignment[matchId] ?? '';
}

/* ==================== 待回传集（分控端现算） ==================== */

function displayLabelOf(match: MatchRecord): string {
  return `${match.leftPlayer || '左侧'} vs ${match.rightPlayer || '右侧'}`;
}

function toPendingMatch(match: MatchRecord, tournamentLabel: string): CloudSyncPendingMatch {
  return {
    matchId: match.id,
    label: displayLabelOf(match),
    tournamentLabel,
    leftScore: match.leftScore,
    rightScore: match.rightScore,
    winner: match.winner,
  };
}

const EMPTY_PENDING: CloudSyncPendingQueue = {
  matches: [],
  count: 0,
  seq: 0,
  submittedAt: null,
  ackedMatchIds: [],
  ackedAt: null,
};

/**
 * 待回传集：本机（分控端）已登记完赛、按指派规则归本机登记、且主控尚未确认的比赛。
 * 每次「同步最新」合并后重算（防主控回退后复活陈旧登记）；已确认条目按回执 id 清除。
 */
export function computePendingQueue(paths: AppPaths): CloudSyncPendingQueue {
  const state = loadLocalState(paths);
  const code = localCode(paths);
  const acked = new Set(state.ackedMatchIds);
  const matches = getMatchStore(paths).matches
    .filter((match) => match.status === 'completed' && match.winner && !acked.has(match.id))
    .filter((match) => code !== '' && assignmentScopeOf(paths, match.id) === code);
  const labels = resolveTournamentLabels(paths, matches);
  return {
    matches: matches.map((match) => toPendingMatch(match, labels[match.id] ?? '')),
    count: matches.length,
    seq: state.seq,
    submittedAt: state.submittedAt,
    ackedMatchIds: state.ackedMatchIds,
    ackedAt: state.ackedAt,
  };
}

/** 已确认比赛 id 集合（分控端禁止撤回的判据） */
export function ackedMatchIdSet(paths: AppPaths): Set<string> {
  return new Set(loadLocalState(paths).ackedMatchIds);
}

/* ==================== 主控收件箱 ==================== */

function inboxEntriesOf(paths: AppPaths): CloudSyncInboxEntry[] {
  const state = loadLocalState(paths);
  const config = loadRuntimeConfig(paths);
  return state.roster
    .filter((entry) => entry.code !== config.machineCode)
    .map((entry) => {
      const uplink = state.inbox[entry.code];
      if (!uplink || !uplink.matches.length) {
        return null;
      }
      const labels = resolveTournamentLabels(paths, uplink.matches);
      return {
        code: entry.code,
        label: entry.label,
        seq: uplink.seq,
        submittedAt: uplink.submittedAt,
        pending: uplink.matches.map((match) => toPendingMatch(match, labels[match.id] ?? '')),
      } satisfies CloudSyncInboxEntry;
    })
    .filter((entry): entry is CloudSyncInboxEntry => entry !== null);
}

/* ==================== 状态 ==================== */

export function getCloudSyncStatus(paths: AppPaths): CloudSyncStatus {
  const config = loadRuntimeConfig(paths);
  const state = loadLocalState(paths);
  const role: CloudSyncRole = config.syncRole;
  return {
    config: {
      syncKey: config.syncKey,
      syncToken: config.syncToken,
      role,
      workerUrl: config.workerUrl,
      machineCode: config.machineCode,
      machineLabel: config.machineLabel,
      pollEnabled: config.cloudPollEnabled,
      pollIntervalSeconds: config.cloudPollInterval,
    },
    // 四项齐全才算「已配置」：缺令牌时任何数据操作都会被 Worker 拒绝（503/401）
    configured: Boolean(config.syncKey && config.syncToken && config.workerUrl && config.machineCode),
    version: state.version,
    appliedVersion: state.appliedVersion,
    pending: role === 'sub'
      ? computePendingQueue(paths)
      : {
        ...EMPTY_PENDING,
        seq: state.seq,
        submittedAt: state.submittedAt,
        ackedMatchIds: state.ackedMatchIds,
        ackedAt: state.ackedAt,
      },
    inbox: role === 'main' ? inboxEntriesOf(paths) : [],
    roster: role === 'main' ? buildLocalRoster(paths) : state.roster,
    assignment: state.assignment,
    ownedTournamentIds: ownedTournamentIds(paths),
    lastContact: {
      pushedAt: state.lastPushedAt,
      pulledAt: state.lastPulledAt,
      uploadedAt: state.lastUploadedAt,
      ackedAt: state.lastAckedAt,
    },
    lastError: state.lastError,
  };
}

/** 房间名册：本机码 + 已配对分控码（本机显示名取配置值，保证「互不相同」校验总能跑） */
function buildLocalRoster(paths: AppPaths): CloudSyncRosterEntry[] {
  const config = loadRuntimeConfig(paths);
  const state = loadLocalState(paths);
  const entries: CloudSyncRosterEntry[] = [];
  if (config.machineCode) {
    entries.push({ code: config.machineCode, label: config.machineLabel });
  }
  state.roster.forEach((entry) => {
    if (entry.code !== config.machineCode) {
      entries.push(entry);
    }
  });
  return entries.slice(0, CLOUD_SYNC_ROSTER_MAX);
}

/* ==================== 设置 ==================== */

export interface CloudSyncConfigInput {
  syncKey?: unknown;
  syncToken?: unknown;
  role?: unknown;
  workerUrl?: unknown;
  machineLabel?: unknown;
  pollEnabled?: unknown;
  pollIntervalSeconds?: unknown;
  /** 分控端机器码列表（仅主控端填写；不含本机码，自动去重） */
  peerCodes?: unknown;
}

/**
 * 保存云同步设置：名册由主控端维护（分控端码列表），显示名取各机自己填的 machineLabel
 * （主控端拿不到分控端的显示名，只显示短码——名册里没有分控端标签）。
 */
export function saveCloudSyncConfig(paths: AppPaths, input: CloudSyncConfigInput): CloudSyncStatus {
  const patch: Partial<RuntimeConfig> = {};
  if (input.syncKey !== undefined) patch.syncKey = String(input.syncKey);
  if (input.syncToken !== undefined) patch.syncToken = String(input.syncToken);
  if (input.workerUrl !== undefined) patch.workerUrl = String(input.workerUrl);
  if (input.machineLabel !== undefined) patch.machineLabel = String(input.machineLabel);
  if (input.role !== undefined) patch.syncRole = input.role === 'sub' ? 'sub' : 'main';
  if (input.pollEnabled !== undefined) patch.cloudPollEnabled = input.pollEnabled !== false;
  if (input.pollIntervalSeconds !== undefined) patch.cloudPollInterval = Number(input.pollIntervalSeconds);

  const next = saveRuntimeConfig(paths, patch);
  const state = loadLocalState(paths);

  if (Array.isArray(input.peerCodes)) {
    const labels = new Map(state.roster.map((entry) => [entry.code, entry.label]));
    const peers = normalizeRoster(input.peerCodes.map((code) => ({
      code,
      label: labels.get(normalizeMachineCode(code)) ?? '',
    }))).filter((entry) => entry.code !== next.machineCode);
    saveLocalState(paths, { roster: peers, lastError: '' });
  }

  return getCloudSyncStatus(paths);
}

/* ==================== 「检测 Worker 在线」 ==================== */

/**
 * 自检：打 Worker 的 /health（**不需要令牌与房间密钥**，也不碰 KV，避免为测通白扣读写额度）。
 * 顺带读回 Worker 的鉴权状态：令牌没配（tokenConfigured=false）时明确提示运营者去
 * `wrangler secret put SYNC_TOKEN`，否则两端任何数据操作都会拿到 503。
 * 活动前两台机器各自实测一次——大陆网络对 *.workers.dev 可达性不稳。
 */
export async function testCloudConnection(paths: AppPaths): Promise<CloudSyncTestResult> {
  const config = loadRuntimeConfig(paths);
  if (!config.workerUrl) {
    return { ok: false, message: '未配置 Worker 地址', status: getCloudSyncStatus(paths), data: { ok: false } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_SYNC_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.workerUrl}/health`, {
      headers: authHeaders(config),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as
      | { success?: boolean; tokenRequired?: boolean; tokenConfigured?: boolean }
      | null;
    if (!response.ok || payload?.success !== true) {
      // 地址能连上但不是我们的 Worker（比如填成了别的站点/域名拼错）——给出可操作提示
      throw new Error(
        response.status === 404
          ? '该地址不存在 /health（404）：请确认填的是 Worker 根地址（形如 https://roco-sync.你的子域.workers.dev），不要带路径'
          : `该地址没有返回本软件的 Worker 标识（HTTP ${response.status}）：请确认填的是 Worker 根地址，形如 https://roco-sync.你的子域.workers.dev`,
      );
    }

    const health = {
      tokenRequired: payload.tokenRequired !== false,
      tokenConfigured: payload.tokenConfigured === true,
    };
    if (health.tokenRequired && !health.tokenConfigured) {
      const message = 'Worker 可达，但云端还没配置访问令牌（SYNC_TOKEN）：请在 cloudflare 目录执行 `npx wrangler secret put SYNC_TOKEN` 设置一个随机串，再把它填进两端「访问令牌」';
      finish(paths, {}, message);
      return { ok: false, message, status: getCloudSyncStatus(paths), data: { ok: false }, health };
    }
    if (!config.syncToken) {
      const message = 'Worker 可达，但本机还没填访问令牌：请填写与 Worker 的 SYNC_TOKEN 相同的随机串';
      finish(paths, {}, message);
      return { ok: false, message, status: getCloudSyncStatus(paths), data: { ok: false }, health };
    }

    finish(paths);
    return {
      ok: true,
      message: `Worker 可达且已启用访问令牌：${config.workerUrl}`,
      status: getCloudSyncStatus(paths),
      data: { ok: true },
      health,
    };
  } catch (error) {
    const message = controller.signal.aborted
      ? `检测超时（${CLOUD_SYNC_REQUEST_TIMEOUT_MS / 1000} 秒）：请检查网络或改用自定义域`
      : `Worker 不可达：${error instanceof Error ? error.message : String(error)}`;
    finish(paths, {}, message);
    return { ok: false, message, status: getCloudSyncStatus(paths), data: { ok: false } };
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== 主控端：同步分发 ==================== */

/**
 * 主控端「同步分发」：组包（matches + tournaments + profiles，不带头像）+ 指派规则 + 名册
 * → 写 downlink，再写小版本键 version（只含版本号 + 时间，供对端红点轮询）。
 * 每次都覆盖云端 downlink（幂等全量），分控端重复「同步最新」只是重复合并同一份包。
 */
export async function pushCloudSync(
  paths: AppPaths,
): Promise<CloudSyncActionResult<CloudSyncPushResult> & { version: CloudSyncVersion }> {
  const config = loadRuntimeConfig(paths);
  const state = loadLocalState(paths);

  try {
    if (config.syncRole !== 'main') {
      throw new Error('当前角色是分控端，只有主控端能执行「同步分发」');
    }
    if (!config.machineCode) {
      throw new Error('请先设置本机标识（machineCode），否则分控端无法区分赛果归属');
    }
    if (state.roster.some((entry) => entry.code === config.machineCode)) {
      throw new Error(`房间名册里出现了本机机器码（${config.machineCode}），两端必须互不相同，请先改正`);
    }

    const bundle: SyncBundle = exportSyncBundle(paths, { includeProfiles: true, includeAvatars: false });
    bundle.cloud = {
      roster: buildLocalRoster(paths),
      assignment: {
        overrides: state.assignment,
        updatedAt: state.assignmentUpdatedAt ?? new Date().toISOString(),
      },
    };

    const version: CloudSyncVersion = {
      v: (state.version?.v ?? 0) + 1,
      at: new Date().toISOString(),
      from: config.machineCode,
    };

    await writeBox(config, 'downlink', bundle);
    await writeBox(config, 'version', version);

    finish(paths, { version, lastPushedAt: version.at });

    return {
      status: getCloudSyncStatus(paths),
      version,
      data: {
        version,
        bytes: Buffer.byteLength(JSON.stringify(bundle), 'utf-8'),
        matchCount: bundle.matches.length,
        tournamentCount: bundle.tournaments.length,
      },
    };
  } catch (error) {
    finish(paths, {}, error);
    throw error;
  }
}

/* ==================== 分控端：同步最新 ==================== */

async function fetchVersion(paths: AppPaths): Promise<CloudSyncVersion | null> {
  const config = loadRuntimeConfig(paths);
  const mail = await readBox<CloudSyncVersion>(config, 'version');
  const version = normalizeVersion(mail.value);
  if (!version) {
    return null;
  }
  return { ...version, at: version.at || (mail.modifiedAt ?? '') };
}

/**
 * 分控端「同步最新」：读 downlink → 配对校验（本机码不能等于分发机码）→ 落盘待合并包
 * 并返回与现有导入完全一致的预览（字段级 diff、逐条勾选）。真正写入要再点一次「确认合并」。
 */
export async function previewCloudPull(paths: AppPaths): Promise<CloudSyncPullResult> {
  const config = loadRuntimeConfig(paths);

  try {
    if (config.syncRole !== 'sub') {
      throw new Error('当前角色是主控端，「同步最新」由分控端执行；主控端请用「同步分发」');
    }
    if (!config.machineCode) {
      throw new Error('请先设置本机标识（machineCode），否则无法与主控端区分');
    }

    const mail = await readBox<unknown>(config, 'downlink');
    if (!mail.exists || !mail.value) {
      throw new Error('云端暂无数据：请确认房间密钥两端一致，并等主控端点过「同步分发」（KV 异地区间最长约 60 秒才可见）');
    }

    const meta = readBundleMeta(mail.value);
    if (meta.machine && meta.machine === config.machineCode) {
      throw new Error(`云端分发机与本机机器码相同（都是 ${config.machineCode}），两端必须互不相同，请检查配对设置`);
    }

    // 结构校验与 diff 都走现有预览管线（错误信息与 U 盘导入一致）
    const preview = previewSyncImport(paths, mail.value, 'newer');

    const offer = readCloudOffer(mail.value);
    if (offer && offer.roster.filter((entry) => entry.code === config.machineCode).length > 1) {
      throw new Error(`房间名册中机器码 ${config.machineCode} 出现多次，两端必须互不相同`);
    }

    fs.mkdirSync(paths.cacheDir, { recursive: true });
    fs.writeFileSync(paths.cloudPendingFile, JSON.stringify(mail.value), 'utf-8');

    const version = await fetchVersion(paths);
    const patch: Partial<CloudSyncLocalState> = { lastPulledAt: new Date().toISOString() };
    if (version) {
      patch.version = version;
    }
    if (offer) {
      patch.roster = offer.roster;
      patch.assignment = offer.assignment.overrides;
      patch.assignmentUpdatedAt = offer.assignment.updatedAt;
    }
    finish(paths, patch);

    return {
      status: getCloudSyncStatus(paths),
      preview,
      bundle: mail.value as SyncBundle,
      data: { dist: meta.machine },
    };
  } catch (error) {
    finish(paths, {}, error);
    throw error;
  }
}

/**
 * 主控回退后重分发的冲突裁决（分控端「同步最新」专用）：
 * 本机把某场系列赛对局登记为已完成，而云端分发包里同一场仍是「未登记」（无胜者）——说明主控
 * **回退过这一波**（回退会清掉节点胜者、比赛回到 pending）。此时不允许分控端的旧登记"复活"：
 * 保留主控版本（丢弃本机登记），使主控该场回到 pending 且节点无胜者，分控端重新登记即可。
 *
 * 只对系列赛对局生效（普通对局的 pending 分发不构成回退信号，分控本地较新的登记照常保留）。
 * 返回需要丢弃的 matchId 集合（同时调用 resetMatchRegistrations 把本机登记清空）。
 */
function rollbackDiscardIds(paths: AppPaths, payload: SyncBundlePayload): Set<string> {
  const store = getMatchStore(paths);
  const localById = new Map(store.matches.map((match) => [match.id, match]));
  const tournaments = getTournamentStore(paths);
  const discarded = new Set<string>();

  payload.matches.forEach((raw) => {
    const incoming = (raw ?? {}) as Partial<MatchRecord>;
    const matchId = typeof incoming.id === 'string' ? incoming.id : '';
    const local = matchId ? localById.get(matchId) : undefined;
    if (!local || !matchId) {
      return;
    }
    if (incoming.status !== 'pending' || incoming.winner) {
      return;
    }
    if (local.status !== 'completed' || !local.tournamentRef) {
      return;
    }
    // 本机该节点已无胜者 → 本机登记属于主控回退后的陈旧赛果
    const record = tournaments.find((item) => item.id === local.tournamentRef?.tournamentId);
    const node = record?.waves
      .find((wave) => wave.stageIndex === local.tournamentRef?.stageIndex
        && wave.waveIndex === local.tournamentRef?.waveIndex)
      ?.nodes.find((item) => item.id === local.tournamentRef?.nodeId);
    if (node && !node.winnerId) {
      discarded.add(matchId);
    }
  });

  return discarded;
}

/**
 * 分控端「确认合并」：用落盘的待合并包 + 勾选条目走现有 applySyncImport
 * （mode 默认 newer，分控端本地较新的登记不会被主控版本压掉），合并后待回传集自动重算。
 * 主控回退后重分发的一波，本机陈旧登记会被保留主控版本（见 rollbackDiscardIds）。
 */
export async function finalizeCloudPull(
  paths: AppPaths,
  acceptedKeys: string[],
  mode: SyncConflictMode = 'newer',
): Promise<CloudSyncActionResult<{ applied: SyncImportPreview['summary']; warnings: string[] }>> {
  try {
    if (!fs.existsSync(paths.cloudPendingFile)) {
      throw new Error('没有待合并的云端数据，请先点「同步最新」');
    }
    const bundle = JSON.parse(fs.readFileSync(paths.cloudPendingFile, 'utf-8')) as SyncBundle;
    const payload = parseSyncBundle(bundle);
    const discarded = rollbackDiscardIds(paths, payload);

    if (discarded.size) {
      // 先清掉本机陈旧登记，再合并（否则被丢弃的条目仍会按本机较新被跳过），
      // 保证主控回退后本机该场回到未登记、待回传集自动重算。
      resetMatchRegistrations(paths, Array.from(discarded));
    }

    const result = await applySyncImport(paths, bundle, {
      mode,
      acceptedKeys,
      includeAvatars: false,
    });
    if (discarded.size) {
      // 丢弃本机陈旧赛果等于撤回：主控回执里的 id 也要清掉，否则该场永远不会重新进入待回传集
      const state = loadLocalState(paths);
      saveLocalState(paths, {
        ackedMatchIds: state.ackedMatchIds.filter((id) => !discarded.has(id)),
      });
      result.warnings.push(
        `有 ${discarded.size} 场本机已登记的赛果在云端仍是「未登记」（主控回退过这一波）：已按主控版本撤回本机登记，请重新登记后回传`,
      );
    }

    const state = loadLocalState(paths);
    finish(paths, {
      appliedVersion: state.version ? state.version.v : state.appliedVersion,
      lastPulledAt: new Date().toISOString(),
      // 丢弃本机陈旧赛果等于撤回：主控回执里的 id 也要清掉，否则该场永远不会重新进入待回传集
      ackedMatchIds: discarded.size
        ? state.ackedMatchIds.filter((id) => !discarded.has(id))
        : state.ackedMatchIds,
    });
    try {
      fs.rmSync(paths.cloudPendingFile);
    } catch {
      // 删不掉不影响合并结果，下次「同步最新」会覆盖它
    }

    return {
      status: getCloudSyncStatus(paths),
      data: { applied: result.applied, warnings: result.warnings },
    };
  } catch (error) {
    finish(paths, {}, error);
    throw error;
  }
}

/* ==================== 分控端：回传（现算累计集） ==================== */

/**
 * 分控端「回传」：把「所有未 ack 比赛的累计集合」（不是本次增量）写到 uplink:{本机码}。
 * 两次回传之间主控未确认时，第二次提交必须是并集，否则会覆盖丢失。
 */
export async function uploadCloudSync(paths: AppPaths): Promise<CloudSyncUploadResult> {
  const config = loadRuntimeConfig(paths);
  const state = loadLocalState(paths);

  try {
    if (config.syncRole !== 'sub') {
      throw new Error('当前角色是主控端，「回传」由分控端执行');
    }
    if (!config.machineCode) {
      throw new Error('请先设置本机标识（machineCode）');
    }

    const queue = computePendingQueue(paths);
    if (queue.count === 0) {
      throw new Error('无待回传：本机没有「已登记完赛 + 归本机登记 + 主控未确认」的比赛');
    }

    const pendingIds = new Set(queue.matches.map((item) => item.matchId));
    const matches = getMatchStore(paths).matches.filter((match) => pendingIds.has(match.id));
    const capped = matches.slice(0, CLOUD_SYNC_UPLINK_MAX_MATCHES);
    const seq = state.seq + 1;
    const submittedAt = new Date().toISOString();
    const payload: CloudSyncUplinkPayload = {
      from: config.machineCode,
      seq,
      submittedAt,
      matches: capped,
    };

    await writeBox(config, `uplink/${config.machineCode}`, payload);
    finish(paths, { seq, submittedAt, lastUploadedAt: submittedAt });

    return {
      status: getCloudSyncStatus(paths),
      submittedAt,
      data: { seq, count: capped.length },
    };
  } catch (error) {
    finish(paths, {}, error);
    throw error;
  }
}

/* ==================== 红点轮询（只读小键，绝不合并数据） ==================== */

/**
 * 红点轮询：读 version（两端）+ ack:{本机码}（分控端）+ 各分控端 uplink（主控端，按名册逐个读）。
 * 只更新界面提示，不读大包、不合并；分控端拿到回执后按 id 清理待回传标记。
 */
export async function pollCloudSync(paths: AppPaths): Promise<CloudSyncPollResult> {
  const config = loadRuntimeConfig(paths);
  const before = loadLocalState(paths);
  const patch: Partial<CloudSyncLocalState> = {};

  const version = await fetchVersion(paths);
  if (version) {
    patch.version = version;
  }

  if (config.syncRole === 'sub' && config.machineCode) {
    const ack = await readBox<CloudSyncAckPayload>(config, `ack/${config.machineCode}`);
    if (ack.value && Array.isArray(ack.value.ackedMatchIds)) {
      const ids = ack.value.ackedMatchIds.map((id) => String(id ?? '')).filter(Boolean);
      const seq = Number.isFinite(Number(ack.value.ackedSeq)) ? Math.max(0, Math.floor(Number(ack.value.ackedSeq))) : 0;
      // 回执序号不小于本机已回传序号（或带了明确 id）才当有效，避免旧回执清掉新的待回传标记
      if (seq >= before.seq || ids.length > 0) {
        patch.ackedMatchIds = Array.from(new Set([...before.ackedMatchIds, ...ids]));
        patch.ackedAt = typeof ack.value.at === 'string' ? ack.value.at : ack.modifiedAt;
      }
    }
  }

  if (config.syncRole === 'main') {
    const inbox: Record<string, CloudSyncUplinkPayload> = { ...before.inbox };
    for (const entry of before.roster) {
      if (!entry.code || entry.code === config.machineCode) {
        continue;
      }
      const mail = await readBox<CloudSyncUplinkPayload>(config, `uplink/${entry.code}`);
      if (mail.value && Array.isArray(mail.value.matches)) {
        inbox[entry.code] = mail.value;
      }
    }
    patch.inbox = inbox;
  }

  finish(paths, patch);

  return {
    version,
    changed: Boolean(version && version.v !== (before.version?.v ?? 0)),
    inbox: config.syncRole === 'main' ? inboxEntriesOf(paths) : [],
    status: getCloudSyncStatus(paths),
  };
}

/* ==================== 主控端：检查回传（确认台） ==================== */

/**
 * 回传包补全为一个合法的 SyncBundle（app/schema 取本机常量，profiles 不参与确认台：
 * 分控端回传只带赛果，档案/头像不随上行流转）。
 */
function buildUplinkBundle(uplink: CloudSyncUplinkPayload, code: string): SyncBundle {
  return {
    app: SYNC_APP_ID,
    schema: SYNC_BUNDLE_SCHEMA,
    machine: code,
    exportedAt: uplink.submittedAt,
    matches: uplink.matches,
    tournaments: [],
  };
}

/** 写回影响说明：确认这场后写入哪个系列赛节点、是否会推进波次 */
function impactOf(paths: AppPaths, match: MatchRecord, tournamentLabel: string): string {
  const ref = match.tournamentRef;
  if (!ref) {
    return '普通对局：确认后只写入本机比赛记录，不影响系列赛编排';
  }
  const record = getTournamentStore(paths).find((item) => item.id === ref.tournamentId);
  if (!record) {
    return `系列赛 ${ref.tournamentId} 在本机不存在：确认后按普通对局合并，不推进波次`;
  }
  const prefix = tournamentLabel || `${record.name} · ${ref.nodeId}`;
  if (tournamentOwnerCode(record.id) !== localCode(paths)) {
    return `${prefix}：本机不是该系列赛编排机，确认后只合并比赛记录，不推进波次`;
  }
  const winnerName = match.winner === 'left' ? match.leftPlayer : match.winner === 'right' ? match.rightPlayer : '';
  return `${prefix}：确认后写入节点 ${ref.nodeId}.winnerId（${winnerName || '胜者'}），该波打齐则自动推进下一波`;
}

function buildAckItem(
  paths: AppPaths,
  preview: SyncImportPreview,
  match: MatchRecord,
  tournamentLabel: string,
): CloudSyncAckItem {
  const item = preview.matchItems.find((entry) => entry.id === match.id);
  return {
    item: item ?? {
      key: `match:${match.id}`,
      kind: 'match',
      id: match.id,
      label: displayLabelOf(match),
      action: 'update',
      reason: '不在本次预览里的条目',
      localUpdatedAt: null,
      incomingUpdatedAt: match.updatedAt,
      conflict: false,
      diff: [],
    },
    record: match,
    impact: impactOf(paths, match, tournamentLabel),
  };
}

/**
 * 主控端「检查回传」：读各分控端 uplink → 包装成 SyncBundle → 复用现有预览
 * （字段级 diff、逐条勾选、冲突标记）并附「写回影响」。不写入任何数据。
 * code 为空时取收件箱里最近提交且有内容的分控端。
 */
export async function checkCloudSync(paths: AppPaths, code?: string | null): Promise<CloudSyncCheckResult> {
  const config = loadRuntimeConfig(paths);

  try {
    if (config.syncRole !== 'main') {
      throw new Error('当前角色是分控端，「检查回传」由主控端执行');
    }

    const state = loadLocalState(paths);
    const peers = state.roster.filter((entry) => entry.code !== config.machineCode);
    // 逐分控端读一次信箱（KV 不支持列键，靠名册决定读哪些）
    const inbox: Record<string, CloudSyncUplinkPayload> = { ...state.inbox };
    for (const peer of peers) {
      const mail = await readBox<CloudSyncUplinkPayload>(config, `uplink/${peer.code}`);
      if (mail.value && Array.isArray(mail.value.matches)) {
        inbox[peer.code] = { ...mail.value, from: normalizeMachineCode(mail.value.from) || peer.code };
      }
    }

    const sources: CloudSyncAckSource[] = [];
    peers.forEach((peer) => {
      const uplink = inbox[peer.code];
      if (!uplink || !uplink.matches.length) {
        return;
      }
      const preview = previewSyncImport(paths, buildUplinkBundle(uplink, peer.code), 'bundle');
      const labels = resolveTournamentLabels(paths, uplink.matches);
      const items = uplink.matches.map((match) => buildAckItem(paths, preview, match, labels[match.id] ?? ''));
      sources.push({
        code: peer.code,
        label: peer.label,
        seq: uplink.seq,
        submittedAt: uplink.submittedAt,
        items,
        selectableKeys: items.filter((entry) => entry.item.action !== 'skip').map((entry) => entry.item.key),
      });
    });

    const sorted = sources.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
    const target = code ? sorted.find((source) => source.code === code) ?? null : sorted[0] ?? null;
    finish(paths, { inbox });
    return { status: getCloudSyncStatus(paths), data: { sources: sorted, source: target } };
  } catch (error) {
    finish(paths, {}, error);
    throw error;
  }
}

/**
 * 主控端确认：把被确认的赛果合并进本机（服务端重分类，不盲信分控端勾选）+ 跑写回推进波次
 * + 写回执 ack:{code}。驳回走 rejectCloudSync（不写本地、不写回执）。
 */
export async function confirmCloudSync(
  paths: AppPaths,
  code: string,
  acceptedKeys: string[],
): Promise<CloudSyncConfirmResult> {
  const config = loadRuntimeConfig(paths);

  try {
    if (config.syncRole !== 'main') {
      throw new Error('当前角色是分控端，不能执行确认');
    }
    const state = loadLocalState(paths);
    const uplink = state.inbox[code];
    if (!uplink) {
      throw new Error(`收件箱里没有分控端 ${code} 的回传内容，请先点「检查回传」`);
    }

    const check = await checkCloudSync(paths, code);
    const source = check.data.source;
    if (!source) {
      throw new Error(`分控端 ${code} 的回传内容已为空`);
    }

    const accepted = new Set(acceptedKeys);
    const acceptedMatches = source.items
      .filter((entry) => accepted.has(entry.item.key) && entry.item.action !== 'skip')
      .map((entry) => entry.record);
    if (!acceptedMatches.length) {
      throw new Error('没有勾选任何赛果，未做任何改动');
    }

    // 只合并比赛记录（skipTournaments）：编排结构由本机（编排机）自己持有，绝不用分控端副本覆盖；
    // applySyncImport 内部的 runTournamentWriteBack 会把赛果写回节点、打齐则推进波次。
    const result = await applySyncImport(paths, {
      ...buildUplinkBundle(uplink, code),
      matches: acceptedMatches,
    }, {
      mode: 'bundle',
      acceptedKeys: acceptedMatches.map((match) => `match:${match.id}`),
      includeAvatars: false,
      skipTournaments: true,
    });

    const acceptedIds = acceptedMatches.map((match) => match.id);
    const acceptedIdSet = new Set(acceptedIds);
    const ackedMatchIds = Array.from(new Set([...state.ackedMatchIds, ...acceptedIds]));
    const nextState = loadLocalState(paths);
    const ack: CloudSyncAckPayload = {
      ackedMatchIds,
      ackedSeq: uplink.seq,
      at: new Date().toISOString(),
    };
    await writeBox(config, `ack/${code}`, ack);

    // 已确认条目从收件箱移除，剩下的留待下次确认
    const remaining = uplink.matches.filter((match) => !acceptedIdSet.has(match.id));
    const inbox = { ...nextState.inbox };
    if (remaining.length) {
      inbox[code] = { ...uplink, matches: remaining };
    } else {
      delete inbox[code];
    }
    finish(paths, { inbox, ackedMatchIds, ackedAt: ack.at, lastAckedAt: ack.at });

    return {
      status: getCloudSyncStatus(paths),
      result,
      data: { acked: acceptedIds, warnings: result.warnings },
    };
  } catch (error) {
    finish(paths, {}, error);
    throw error;
  }
}

/** 主控端驳回：不写本地、不写回执，分控端保持「待回传」 */
export async function rejectCloudSync(paths: AppPaths, code: string): Promise<CloudSyncRejectResult> {
  const config = loadRuntimeConfig(paths);
  try {
    if (config.syncRole !== 'main') {
      throw new Error('当前角色是分控端，不能执行驳回');
    }
    if (!loadLocalState(paths).inbox[code]) {
      throw new Error(`收件箱里没有分控端 ${code} 的回传内容`);
    }
    finish(paths);
    return { status: getCloudSyncStatus(paths), data: { code } };
  } catch (error) {
    finish(paths, {}, error);
    throw error;
  }
}

/* ==================== 指派（主控端） ==================== */

/**
 * 保存指派规则：overrides = 比赛 id -> 登记机器码（空字符串 = 主控端自己登记）。
 * 顺带清掉已不存在比赛的条目（只保留当前仍存在的比赛），避免规则无限膨胀。
 */
export function saveCloudAssignment(paths: AppPaths, overrides: unknown): CloudSyncStatus {
  const existing = new Set(getMatchStore(paths).matches.map((match) => match.id));
  const cleaned: Record<string, string> = {};
  Object.entries(normalizeAssignment(overrides)).forEach(([matchId, code]) => {
    if (existing.has(matchId)) {
      cleaned[matchId] = code;
    }
  });
  finish(paths, { assignment: cleaned, assignmentUpdatedAt: new Date().toISOString() });
  return getCloudSyncStatus(paths);
}

/* ==================== 机器码变更守卫 ==================== */

/**
 * 改 machineCode 前的守卫（堵「改码丢所有权」的坑）：
 * - 有 running 系列赛内嵌旧码 → 直接禁止改（先结束或删除这些系列赛）
 * - 有其它内嵌旧码的系列赛 → 要求二次确认（改码后本机失去这些系列赛的编排权）
 * 不做自动迁移 id（引用、头像目录名都会断）。
 */
export function checkMachineCodeChange(paths: AppPaths, nextCode: string): MachineCodeGuardResult {
  const current = loadRuntimeConfig(paths).machineCode;
  if (normalizeMachineCode(nextCode) === current) {
    return { blocked: false, requireConfirm: false, tournamentIds: [], message: '' };
  }

  const affected = getTournamentStore(paths).filter((record) => tournamentOwnerCode(record.id) === current);
  const running = affected.filter((record) => record.status === 'running');
  if (running.length) {
    return {
      blocked: true,
      requireConfirm: false,
      tournamentIds: running.map((record) => record.id),
      message: `有 ${running.length} 个进行中的系列赛由本机（${current || '未设置'}）编排，改机器码会让本机失去编排权（无法推进 / 回退波次），请先结束或删除这些系列赛`,
    };
  }
  if (affected.length) {
    return {
      blocked: false,
      requireConfirm: true,
      tournamentIds: affected.map((record) => record.id),
      message: `本机有 ${affected.length} 个系列赛（${affected.map((record) => record.id).join('、')}）内嵌旧机器码 ${current || '（空）'}，改码后你将失去这些系列赛的编排权（比赛 id 不重写、不做自动迁移）。确认继续？`,
    };
  }
  return { blocked: false, requireConfirm: false, tournamentIds: [], message: '' };
}

/* ==================== 分控端：登记入口与撤回判定 ==================== */

/**
 * 某场比赛在当前机器上能否登记（分控端按指派范围置灰入口）：
 * - 未启用云同步（没填 syncKey / 机器码）→ 不干预，保持单机行为
 * - 主控端：未指派或指派给本机的可登记
 * - 分控端：只有指派给本机的可登记
 */
export function canRegisterMatch(paths: AppPaths, matchId: string): { allowed: boolean; reason: string } {
  const config = loadRuntimeConfig(paths);
  if (!config.syncKey || !config.machineCode) {
    return { allowed: true, reason: '' };
  }
  const scope = assignmentScopeOf(paths, matchId);
  if (config.syncRole === 'main') {
    return scope === config.machineCode || scope === ''
      ? { allowed: true, reason: '' }
      : { allowed: false, reason: `该场已指派给分控端 ${scope} 登记，请到那台机器上登记` };
  }
  if (scope === config.machineCode) {
    return { allowed: true, reason: '' };
  }
  return {
    allowed: false,
    reason: scope
      ? `该场指派给 ${scope} 登记，本机不能登记`
      : '该场未指派给本机登记（未指派默认由主控端登记）',
  };
}

/**
 * 已 ack 的比赛在分控端禁止撤回：合并是整条替换、不会触发 onMatchUndo，
 * 单方面撤回会让比赛回到 pending 而系列赛节点胜者还在，状态分叉。
 */
export function checkSubUndoAllowed(paths: AppPaths, matchId: string): { allowed: boolean; reason: string } {
  if (loadRuntimeConfig(paths).syncRole !== 'sub') {
    return { allowed: true, reason: '' };
  }
  if (ackedMatchIdSet(paths).has(matchId)) {
    return {
      allowed: false,
      reason: '该场已被主控端确认：结果有误请联系主控端「回退上一波」后重新分发，再重新登记',
    };
  }
  return { allowed: true, reason: '' };
}
