import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { loadRuntimeConfig, saveRuntimeConfig } from '../../electron/services/config-service';
import { saveProfilePlayerAvatar } from '../../electron/services/image-service';
import { createMatch } from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { getProfileStore, savePlayerProfile } from '../../electron/services/profile-service';
import { exportSyncBundle } from '../../electron/services/sync-service';
import { createTournament, getTournamentStore, startTournament } from '../../electron/services/tournament-service';
import type { SyncBundle, SyncImportPreview } from '../../shared/types';

let server: LocalServer;
let base: string;
let paths: AppPaths;
let foreignBundle: SyncBundle;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-sync-http-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  // 本机标识 A：本机新建比赛 id 形如 20260928_A001
  saveRuntimeConfig(paths, { machineCode: 'A' });
  createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });

  // 另一台机器（机器码 B）导出的同步包
  const sourceRoot = mkdtempSync(join(tmpdir(), 'roco-sync-http-source-'));
  const sourcePaths = createAppPaths(sourceRoot, sourceRoot);
  mkdirSync(sourcePaths.dataDir, { recursive: true });
  saveRuntimeConfig(sourcePaths, { machineCode: 'B' });
  createMatch(sourcePaths, { leftPlayer: '夜航', rightPlayer: '青栀', bestOf: 3 });
  foreignBundle = exportSyncBundle(sourcePaths, { includeProfiles: false, includeAvatars: false });

  // 不传 authConfig = 鉴权关闭，直接测业务路由
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

async function postJson(pathname: string, body?: unknown): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function postBundle(
  pathname: string,
  bundle: unknown,
  fields: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(bundle)], { type: 'application/json' }), 'sync-bundle.json');
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  const response = await fetch(`${base}${pathname}`, { method: 'POST', body: form });
  return { status: response.status, data: await response.json() };
}

describe('POST /api/sync/export', () => {
  it('导出同步包：200 + 机器码标识 + 本机全部比赛', async () => {
    const { status, data } = await postJson('/api/sync/export', { includeProfiles: false, includeAvatars: false });

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.bundle.machine).toBe('A');
    expect(data.bundle.matches).toHaveLength(1);
    expect(data.bundle.matches[0].id).toMatch(/^\d{8}_A\d{3}$/);
  });
});

describe('POST /api/sync/preview 与 /api/sync/import', () => {
  it('预览只读：返回逐条新增统计，不写入本机', async () => {
    const { status, data } = await postBundle('/api/sync/preview', foreignBundle);

    expect(status).toBe(200);
    expect(data.preview.meta.machine).toBe('B');
    expect(data.preview.summary.match).toEqual({ add: 1, update: 0, skip: 0 });
    expect(data.preview.avatars.players).toEqual({ fill: 0, existing: 0, unmatched: 0 });

    const exported = await postJson('/api/sync/export', { includeProfiles: false, includeAvatars: false });
    expect(exported.data.bundle.matches).toHaveLength(1);
  });

  it('应用导入：合并 + 只广播一次 matches:update；同包再次导入全部跳过（幂等）', async () => {
    const previewResponse = await postBundle('/api/sync/preview', foreignBundle);
    const preview = previewResponse.data.preview as SyncImportPreview;
    const accepted = preview.matchItems.filter((item) => item.action !== 'skip').map((item) => item.key);

    const client: Socket = ioClient(base, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });

    try {
      const updates: Array<{ store?: { matches?: unknown[] } }> = [];
      client.on('matches:update', (payload) => updates.push(payload));

      const { status, data } = await postBundle('/api/sync/import', foreignBundle, {
        mode: 'newer',
        accepted: JSON.stringify(accepted),
        includeAvatars: 'false',
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.result.store.matches).toHaveLength(2);
      expect(data.result.applied.match).toEqual({ add: 1, update: 0, skip: 0 });

      await vi.waitFor(() => expect(updates).toHaveLength(1), { timeout: 2000 });
      expect(updates[0].store?.matches).toHaveLength(2);

      // 二次导入同一包：幂等（全跳过、不重复新增）
      const secondPreview = await postBundle('/api/sync/preview', foreignBundle);
      const secondAccepted = (secondPreview.data.preview as SyncImportPreview).matchItems.map((item) => item.key);
      const second = await postBundle('/api/sync/import', foreignBundle, {
        mode: 'newer',
        accepted: JSON.stringify(secondAccepted),
        includeAvatars: 'false',
      });
      expect(second.data.result.store.matches).toHaveLength(2);
      expect(second.data.result.applied.match).toEqual({ add: 0, update: 0, skip: 1 });
    } finally {
      client.close();
    }
  });

  it('非法包：400 + 中文错误信息', async () => {
    const badApp = await postBundle('/api/sync/preview', { app: 'other-app', schema: 1, matches: [] });
    expect(badApp.status).toBe(400);
    expect(badApp.data.success).toBe(false);

    const notJson = await fetch(`${base}/api/sync/preview`, {
      method: 'POST',
      body: (() => {
        const form = new FormData();
        form.append('file', new Blob(['not-json'], { type: 'application/json' }), 'bad.json');
        return form;
      })(),
    });
    expect(notJson.status).toBe(400);
    const notJsonData = (await notJson.json()) as { error?: string };
    expect(notJsonData.error).toContain('JSON');
  });

  it('未收到文件：400', async () => {
    const form = new FormData();
    form.append('mode', 'newer');
    const response = await fetch(`${base}/api/sync/preview`, { method: 'POST', body: form });
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toContain('未收到同步包文件');
  });
});

describe('POST /api/runtime-config 合并语义', () => {
  it('单传 machineCode 不重置 port；单传 port 不丢 machineCode；machineCode 归一化', async () => {
    const setCode = await postJson('/api/runtime-config', { machineCode: 'c' });
    expect(setCode.status).toBe(200);
    expect(setCode.data.config.machineCode).toBe('C');
    expect(setCode.data.config.port).toBe(9988);

    const setPort = await postJson('/api/runtime-config', { port: 9990 });
    expect(setPort.data.config.port).toBe(9990);
    expect(setPort.data.config.machineCode).toBe('C');

    // 恢复本机标识，避免影响其它用例
    const restore = await postJson('/api/runtime-config', { machineCode: 'A' });
    expect(restore.data.config.machineCode).toBe('A');
    expect(loadRuntimeConfig(paths).machineCode).toBe('A');
  });
});

describe('导入携带系列赛的同步包（只读副本 + 广播）', () => {
  it('编排机包内系列赛落到本机作为只读副本，并广播 tournament:update', async () => {
    // 另起一台编排机（机器码 C）建系列赛并导出
    const sourceRoot = mkdtempSync(join(tmpdir(), 'roco-sync-tourney-http-'));
    const sourcePaths = createAppPaths(sourceRoot, sourceRoot);
    mkdirSync(sourcePaths.dataDir, { recursive: true });
    saveRuntimeConfig(sourcePaths, { machineCode: 'C' });
    const playerIds = Array.from({ length: 8 }, (_unused, index) => `p${index}`);
    playerIds.forEach((id, index) => savePlayerProfile(sourcePaths, { id, name: `选手${index}` }));
    const created = createTournament(sourcePaths, { name: 'HTTP杯', playerIds, seed: 42 });
    startTournament(sourcePaths, created.id);
    const bundle = exportSyncBundle(sourcePaths, { includeProfiles: false, includeAvatars: false });
    expect(bundle.tournaments).toHaveLength(1);

    const client: Socket = ioClient(base, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });

    try {
      const tournamentUpdates: unknown[] = [];
      client.on('tournament:update', (payload) => tournamentUpdates.push(payload));

      const previewResponse = await postBundle('/api/sync/preview', bundle);
      const preview = previewResponse.data.preview as SyncImportPreview;
      const accepted = preview.matchItems.filter((item) => item.action !== 'skip').map((item) => item.key);

      const { status, data } = await postBundle('/api/sync/import', bundle, {
        mode: 'newer',
        accepted: JSON.stringify(accepted),
        includeAvatars: 'false',
      });

      expect(status).toBe(200);
      expect(data.result.tournaments.added).toBe(1);
      expect(data.result.tournaments.advanced).toBe(false); // 本机非编排机：导入不推进
      await vi.waitFor(() => expect(tournamentUpdates).toHaveLength(1), { timeout: 2000 });

      expect(getTournamentStore(paths).map((record) => record.id)).toContain(created.id);
    } finally {
      client.close();
    }
  });
});

describe('POST /api/sync/import 的头像写入选项', () => {
  it('默认只补缺；overwriteAvatars=true 才覆盖本机已有头像', async () => {
    savePlayerProfile(paths, { name: '路由头像选手' });
    const localId = getProfileStore(paths).players.find((player) => player.name === '路由头像选手')!.id;
    const localPng = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer();
    const incomingPng = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
      .png()
      .toBuffer();
    await saveProfilePlayerAvatar(paths, localId, localPng);
    const before = readFileSync(paths.profilePlayerAvatarFile(localId));

    // 包内：同名档案（对方的 id）+ 头像（尺寸与本机不同）
    const bundle: SyncBundle = JSON.parse(JSON.stringify(foreignBundle)) as SyncBundle;
    bundle.profiles = {
      players: [{ id: 'p_route_remote', name: '路由头像选手', pets: '', declaration: '', rank: '' }],
      teams: [],
    };
    bundle.avatars = { players: { p_route_remote: incomingPng.toString('base64') }, teams: {} };

    const previewResponse = await postBundle('/api/sync/preview', bundle);
    expect(previewResponse.data.preview.avatars.players).toEqual({ fill: 0, existing: 1, unmatched: 0 });

    // 只补缺（默认）：本机头像保持不动
    const onlyFill = await postBundle('/api/sync/import', bundle, { includeAvatars: 'true' });
    expect(onlyFill.status).toBe(200);
    expect(onlyFill.data.result.avatarsWritten.players).toBe(0);
    expect(readFileSync(paths.profilePlayerAvatarFile(localId))).toEqual(before);

    // 勾选覆盖：包内头像写到本机档案（别名解析，用本机 id 落盘）
    const overwritten = await postBundle('/api/sync/import', bundle, {
      includeAvatars: 'true',
      overwriteAvatars: 'true',
    });
    expect(overwritten.status).toBe(200);
    expect(overwritten.data.result.avatarsWritten.players).toBe(1);
    expect(readFileSync(paths.profilePlayerAvatarFile(localId))).not.toEqual(before);
  });
});