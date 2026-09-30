import fs from 'node:fs';

import { DEFAULT_PORT, MACHINE_CODE_REGEX } from '../../shared/constants.js';
import type { CloudSyncRole } from '../../shared/types.js';
import type { AppPaths } from './path-service.js';

export interface RuntimeConfig {
  port: number;
  /** 本机标识（1-2 位大写字母，空字符串 = 未设置）：新比赛 id 前缀与同步包来源标识 */
  machineCode: string;
  /** 显示名（给机器码加人类语义，如「主播机」；纯展示，空字符串 = 只显示短码） */
  machineLabel: string;
  /** 云同步：房间密钥（两端一致才能配对，空字符串 = 未配置） */
  syncKey: string;
  /** 云同步：角色（main = 主控端 / sub = 分控端），主/分不靠 machineCode 表达 */
  syncRole: CloudSyncRole;
  /** 云同步：Worker 地址（一次性每机设置，不打包进 exe） */
  workerUrl: string;
  /** 云同步：红点轮询开关（只读小键提示，可关） */
  cloudPollEnabled: boolean;
  /** 云同步：红点轮询间隔（秒） */
  cloudPollInterval: number;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  port: DEFAULT_PORT,
  machineCode: '',
  machineLabel: '',
  syncKey: '',
  syncRole: 'main',
  workerUrl: '',
  cloudPollEnabled: true,
  cloudPollInterval: 60,
};

/** 本机标识规范化：去空白 → 转大写 → 仅保留字母 → 截 2 位（不满足 1-2 位字母即为空 = 未设置） */
export function normalizeMachineCode(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  return MACHINE_CODE_REGEX.test(code) ? code : '';
}

/** 显示名规范化：去首尾空白 + 截断（纯展示，允许中文/空格） */
export function normalizeMachineLabel(value: unknown): string {
  return String(value ?? '').trim().slice(0, 16);
}

/** 房间密钥规范化：去首尾空白 + 去掉不适合拼进 URL 路径的字符（两端必须填写一致） */
export function normalizeSyncKey(value: unknown): string {
  return String(value ?? '').trim().replace(/[^A-Za-z0-9_.~-]/g, '').slice(0, 64);
}

/** Worker 地址规范化：补全 scheme、去掉末尾斜杠；非 http(s) 视为未配置 */
export function normalizeWorkerUrl(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) {
    return '';
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? withScheme : '';
  } catch {
    return '';
  }
}

function normalizePort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

function normalizeSyncRole(value: unknown): CloudSyncRole {
  return value === 'sub' ? 'sub' : 'main';
}

function normalizePollInterval(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_CONFIG.cloudPollInterval;
  }
  return Math.min(300, Math.max(30, Math.round(seconds)));
}

export function loadRuntimeConfig(paths: AppPaths): RuntimeConfig {
  if (!fs.existsSync(paths.configFile)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(paths.configFile, 'utf-8')) as Partial<RuntimeConfig>;
    return {
      port: normalizePort(payload.port),
      machineCode: normalizeMachineCode(payload.machineCode),
      machineLabel: normalizeMachineLabel(payload.machineLabel),
      syncKey: normalizeSyncKey(payload.syncKey),
      syncRole: normalizeSyncRole(payload.syncRole),
      workerUrl: normalizeWorkerUrl(payload.workerUrl),
      cloudPollEnabled: payload.cloudPollEnabled === undefined
        ? DEFAULT_CONFIG.cloudPollEnabled
        : payload.cloudPollEnabled !== false,
      cloudPollInterval: normalizePollInterval(payload.cloudPollInterval),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 保存运行时配置：按传入字段合并覆盖（未传的字段保持现值），避免单传 machineCode 时把 port 重置为默认。
 */
export function saveRuntimeConfig(paths: AppPaths, patch: Partial<RuntimeConfig>): RuntimeConfig {
  const current = loadRuntimeConfig(paths);

  const normalized: RuntimeConfig = {
    port: patch.port === undefined ? current.port : normalizePort(patch.port),
    machineCode: patch.machineCode === undefined ? current.machineCode : normalizeMachineCode(patch.machineCode),
    machineLabel: patch.machineLabel === undefined ? current.machineLabel : normalizeMachineLabel(patch.machineLabel),
    syncKey: patch.syncKey === undefined ? current.syncKey : normalizeSyncKey(patch.syncKey),
    syncRole: patch.syncRole === undefined ? current.syncRole : normalizeSyncRole(patch.syncRole),
    workerUrl: patch.workerUrl === undefined ? current.workerUrl : normalizeWorkerUrl(patch.workerUrl),
    cloudPollEnabled: patch.cloudPollEnabled === undefined
      ? current.cloudPollEnabled
      : patch.cloudPollEnabled !== false,
    cloudPollInterval: patch.cloudPollInterval === undefined
      ? current.cloudPollInterval
      : normalizePollInterval(patch.cloudPollInterval),
  };

  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(paths.configFile, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}
