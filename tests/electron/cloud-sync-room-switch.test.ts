/**
 * 换房间守卫（改「房间号」= syncKey）。
 *
 * 背景（不改守卫时的真实出错路径）：
 * - 分控端 `appliedVersion` 比新房间的版本号大 → 界面显示「已是最新」，新房间的内容被整批跳过；
 * - 主控端旧 `ackedInboxSeq` 水位会把新房间的回传当成陈旧值**静默忽略**（对方登记了却永远不出现）。
 *
 * `cache/cloud-sync.json` 里的这些记录都不带房间标识，所以 `saveCloudSyncConfig` 在「房间号确实变了
 * 且本机还留着旧状态」时抛带 `guard` 的错误（HTTP 409），由界面弹「重置 / 保留」；
 * `reset` 必须先删该文件再写名册，顺序反了会把刚写进去的分控码名册一起清掉。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { checkSyncKeyChange, saveCloudSyncConfig } from '../../electron/services/cloud-sync-service';
import { loadRuntimeConfig, saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let root: string;
let paths: AppPaths;
let server: LocalServer;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'roco-cloud-room-switch-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A', machineLabel: '主播机' });
  server = await createLocalServer(paths, 0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

/** 写一份「旧房间用过的」本地云同步状态（形态与 cloud-sync-service 落盘一致） */
function seedLocalState(patch: Record<string, unknown> = {}): void {
  mkdirSync(paths.cacheDir, { recursive: true });
  writeFileSync(paths.cloudSyncFile, JSON.stringify({
    version: { v: 13, at: '2026-09-30T10:00:00.000Z', from: 'A' },
    appliedVersion: 13,
    lastPushedAt: null,
    lastPulledAt: '2026-09-30T10:00:00.000Z',
    lastUploadedAt: null,
    lastAckedAt: '2026-09-30T10:00:00.000Z',
    lastError: '',
    seq: 4,
    submittedAt: '2026-09-30T09:00:00.000Z',
    ackedMatchIds: ['20260930_A001', '20260930_A002'],
    ackedAt: '2026-09-30T10:00:00.000Z',
    roster: [{ code: 'B', label: '' }],
    assignment: { '20260930_A001': 'B' },
    assignmentUpdatedAt: '2026-09-30T09:30:00.000Z',
    ackedInboxSeq: { B: 9 },
    inbox: { B: { from: 'B', seq: 9, submittedAt: '2026-09-30T09:00:00.000Z', matches: [] } },
    pendingVersion: 13,
    ...patch,
  }), 'utf-8');
}

function readLocalState(): Record<string, unknown> {
  return JSON.parse(readFileSync(paths.cloudSyncFile, 'utf-8')) as Record<string, unknown>;
}

/** 捕获服务抛出的守卫错误（带 guard 字段） */
function catchGuard(run: () => unknown): { message?: string; guard?: { requireConfirm?: boolean } } {
  try {
    run();
  } catch (error) {
    return error as { message?: string; guard?: { requireConfirm?: boolean } };
  }
  throw new Error('预期抛出守卫错误，但没有抛');
}

async function post(pathname: string, body?: unknown): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, data: await response.json() };
}

async function get(pathname: string): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`);
  return { status: response.status, data: await response.json() };
}

describe('换房间守卫 · 服务层', () => {
  it('房间号没变（含首尾空白与非法字符）不算改动，放行', () => {
    saveCloudSyncConfig(paths, { syncKey: 'room-a' });
    seedLocalState();

    // 规范化后与已保存值一致：' room-a ' 与 'room-a中文' 都不该触发守卫
    const guard = checkSyncKeyChange(paths, ' room-a中文 ');
    expect(guard.changed).toBe(false);
    expect(guard.requireConfirm).toBe(false);
    expect(() => saveCloudSyncConfig(paths, { syncKey: ' room-a中文 ' })).not.toThrow();
    expect(loadRuntimeConfig(paths).syncKey).toBe('room-a');
  });

  it('首次配置房间号（本机没有旧状态）不拦', () => {
    const guard = checkSyncKeyChange(paths, 'room-b');
    expect(guard.changed).toBe(true);
    expect(guard.hasLocalState).toBe(false);
    expect(guard.requireConfirm).toBe(false);
    expect(() => saveCloudSyncConfig(paths, { syncKey: 'room-b' })).not.toThrow();
    expect(loadRuntimeConfig(paths).syncKey).toBe('room-b');
  });

  it('房间号变了且本机还有旧状态：拦下保存、报出旧状态摘要、配置保持原样', () => {
    saveCloudSyncConfig(paths, { syncKey: 'room-a' });
    seedLocalState();

    const guard = checkSyncKeyChange(paths, 'room-b');
    expect(guard.requireConfirm).toBe(true);
    expect(guard.summary).toMatchObject({
      version: 13,
      appliedVersion: 13,
      ackedMatches: 2,
      inboxPeers: 1,
      uplinkWatermarks: 1,
      uplinkSeq: 4,
      assignments: 1,
      peers: 1,
    });
    // 提示词要说清「哪两个房间」和「建议重置」，否则界面弹窗没法让人判断
    expect(guard.message).toContain('room-a');
    expect(guard.message).toContain('room-b');
    expect(guard.message).toContain('建议重置');

    const caught = catchGuard(() => saveCloudSyncConfig(paths, { syncKey: 'room-b' }));
    expect(caught.guard?.requireConfirm).toBe(true);
    // 被拦下 = 什么都没保存（否则界面会显示成已换房间，实际状态还是旧的）
    expect(loadRuntimeConfig(paths).syncKey).toBe('room-a');
  });

  it('cloudStateAction=keep：房间号改掉，旧状态原样保留（只改错字时用）', () => {
    saveCloudSyncConfig(paths, { syncKey: 'room-a' });
    seedLocalState();
    const before = readFileSync(paths.cloudSyncFile, 'utf-8');

    saveCloudSyncConfig(paths, { syncKey: 'room-b', cloudStateAction: 'keep' });
    expect(loadRuntimeConfig(paths).syncKey).toBe('room-b');
    expect(readFileSync(paths.cloudSyncFile, 'utf-8')).toBe(before);
  });

  it('cloudStateAction=reset：旧状态整体清空，不写名册时连文件都不留', () => {
    saveCloudSyncConfig(paths, { syncKey: 'room-a' });
    seedLocalState();

    const status = saveCloudSyncConfig(paths, { syncKey: 'room-b', cloudStateAction: 'reset' });
    expect(loadRuntimeConfig(paths).syncKey).toBe('room-b');
    expect(status.config.syncKey).toBe('room-b');
    expect(status.appliedVersion).toBe(0);
    expect(status.version).toBeNull();
    expect(existsSync(paths.cloudSyncFile)).toBe(false);
  });

  it('cloudStateAction=reset：重置发生在写名册之前，本次填的分控码不会被一起清掉', () => {
    saveCloudSyncConfig(paths, { syncKey: 'room-a' });
    seedLocalState();

    saveCloudSyncConfig(paths, { syncKey: 'room-b', cloudStateAction: 'reset', peerCodes: ['B', 'C'] });
    const state = readLocalState();
    // 旧房间的一切都没了……
    expect(state.appliedVersion).toBe(0);
    expect(state.ackedMatchIds).toEqual([]);
    expect(state.ackedInboxSeq).toEqual({});
    expect(state.assignment).toEqual({});
    // ……但本次保存的名册还在（顺序反了这里会变成空数组）
    expect((state.roster as Array<{ code: string }>).map((entry) => entry.code)).toEqual(['B', 'C']);
  });

  it('非法 cloudStateAction（如拼错的字符串）视为没选，照样拦下', () => {
    saveCloudSyncConfig(paths, { syncKey: 'room-a' });
    seedLocalState();
    const caught = catchGuard(() => saveCloudSyncConfig(paths, { syncKey: 'room-b', cloudStateAction: 'RESET' }));
    expect(caught.guard?.requireConfirm).toBe(true);
    expect(loadRuntimeConfig(paths).syncKey).toBe('room-a');
  });
});

describe('换房间守卫 · HTTP 层', () => {
  it('/api/cloud-sync/config：改房间号先回 409 + guard，选了重置才保存', async () => {
    // 首次配置（本机无旧状态）不拦
    const first = await post('/api/cloud-sync/config', { syncKey: 'room-a', role: 'main' });
    expect(first.status).toBe(200);
    seedLocalState();

    const blocked = await post('/api/cloud-sync/config', { syncKey: 'room-b' });
    expect(blocked.status).toBe(409);
    expect(blocked.data.guard.requireConfirm).toBe(true);
    expect(String(blocked.data.error)).toContain('建议重置');
    expect((await get('/api/cloud-sync/status')).data.status.config.syncKey).toBe('room-a');

    const saved = await post('/api/cloud-sync/config', { syncKey: 'room-b', cloudStateAction: 'reset' });
    expect(saved.status).toBe(200);
    expect(saved.data.status.config.syncKey).toBe('room-b');
    expect(saved.data.status.appliedVersion).toBe(0);
    expect(existsSync(paths.cloudSyncFile)).toBe(false);
  });

  it('/api/cloud-sync/test：用「测试能否连上云端」顺手改房间号同样会被拦下', async () => {
    await post('/api/cloud-sync/config', { syncKey: 'room-a', role: 'main' });
    seedLocalState();

    const blocked = await post('/api/cloud-sync/test', { syncKey: 'room-b' });
    expect(blocked.status).toBe(409);
    expect(blocked.data.guard.requireConfirm).toBe(true);
    expect(loadRuntimeConfig(paths).syncKey).toBe('room-a');
  });
});
