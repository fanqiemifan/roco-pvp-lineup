import fs from 'node:fs';

import { DEFAULT_PORT, MACHINE_CODE_REGEX } from '../../shared/constants.js';
import type { AppPaths } from './path-service.js';

export interface RuntimeConfig {
  port: number;
  /** 本机标识（1-2 位大写字母，空字符串 = 未设置）：新比赛 id 前缀与同步包来源标识 */
  machineCode: string;
}

const DEFAULT_CONFIG: RuntimeConfig = { port: DEFAULT_PORT, machineCode: '' };

/** 本机标识规范化：去空白 → 转大写 → 仅保留字母 → 截 2 位（不满足 1-2 位字母即为空 = 未设置） */
export function normalizeMachineCode(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  return MACHINE_CODE_REGEX.test(code) ? code : '';
}

function normalizePort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
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
  };

  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.writeFileSync(paths.configFile, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}
