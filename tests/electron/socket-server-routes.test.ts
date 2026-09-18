import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { createAppPaths } from '../../electron/services/path-service';

let server: LocalServer;
let base: string;
let matchId: string;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-http-'));
  const paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  // 不传 authConfig = 鉴权关闭，直接测业务路由
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

async function post(pathname: string, body?: unknown): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

describe('POST /api/matches', () => {
  it('创建比赛：200 + store + 当前赛事指向', async () => {
    const { status, data } = await post('/api/matches', { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.store.matches).toHaveLength(1);
    expect(data.store.activeMatchId).toBe(data.store.matches[0].id);
    expect(data.scoreboard).toBeTruthy();
    matchId = data.store.matches[0].id;
  });

  it('缺少选手名：400 + 中文错误信息', async () => {
    const { status, data } = await post('/api/matches', {});
    expect(status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('请输入左右两侧选手名称');
  });
});

describe('POST /api/matches/:matchId/games/:gameNumber/lineup', () => {
  it('selections 缺失或非对象：400', async () => {
    const missing = await post(`/api/matches/${matchId}/games/1/lineup`, {});
    expect(missing.status).toBe(400);
    expect(missing.data.error).toContain('selections must be an object');

    const array = await post(`/api/matches/${matchId}/games/1/lineup`, { selections: [] });
    expect(array.status).toBe(400);
  });

  it('小局编号非法：400', async () => {
    const { status, data } = await post(`/api/matches/${matchId}/games/abc/lineup`, { selections: { left: [] } });
    expect(status).toBe(400);
    expect(data.error).toContain('invalid game number');
  });

  it('比赛不存在：透传服务端错误信息', async () => {
    const { status, data } = await post('/api/matches/no-such-id/games/1/lineup', { selections: { left: [] } });
    expect(status).toBe(400);
    expect(data.error).toContain('比赛不存在');
  });

  it('录入成功：200 + store，且只广播一次 matchesUpdate', async () => {
    const client: Socket = ioClient(base, { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });

    try {
      const updates: Array<{ store?: { matches?: unknown[] } }> = [];
      client.on('matches:update', (payload) => updates.push(payload));

      const { status, data } = await post(`/api/matches/${matchId}/games/1/lineup`, {
        selections: { left: [{ sprite: 'pet-1' }], right: [{ sprite: 'pet-2' }] },
      });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.store.matches[0].games[0].leftSlots[0].pet_id).toBe('pet-1');

      // 核心契约：双侧合并为一次请求 → 推流页只收到一次广播、只重渲染一遍
      await vi.waitFor(() => expect(updates).toHaveLength(1), { timeout: 2000 });
      expect(updates[0].store?.matches).toHaveLength(1);
    } finally {
      client.close();
    }
  });
});

describe('LocalServer.close', () => {
  it('存在 keep-alive 连接时也能干净关闭，不再抛 ERR_SERVER_NOT_RUNNING', async () => {
    const root = mkdtempSync(join(tmpdir(), 'roco-close-'));
    const paths = createAppPaths(root, root);
    mkdirSync(paths.dataDir, { recursive: true });
    const another = await createLocalServer(paths, 0, '127.0.0.1');
    const port = (another.server.address() as AddressInfo).port;

    // 发一次请求，让 undici 留下一条 keep-alive 空闲连接
    await fetch(`http://127.0.0.1:${port}/api/scoreboard`);

    // 旧实现：io.close 已关闭 http server，内部再调 server.close() 必然 reject
    await expect(another.close()).resolves.toBeUndefined();
  });
});
