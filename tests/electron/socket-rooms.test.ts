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

function connectRole(role: string | null): Socket {
  return ioClient(base, {
    transports: ['websocket'],
    query: role === null ? undefined : { role },
  });
}

async function waitConnected(client: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

async function post(pathname: string, body?: unknown): Promise<void> {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-rooms-'));
  const paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe('socket 角色分组：首连快照裁剪', () => {
  it('page9 只收到自己需要的快照字段，不含比赛库等大载荷', async () => {
    const client = connectRole('page9');
    const snapshot = await new Promise<any>((resolve) => client.once('snapshot', resolve));
    try {
      expect(snapshot.page9).toBeTruthy();
      expect(snapshot.store).toBeUndefined();
      expect(snapshot.panels).toBeUndefined();
      expect(snapshot.profiles).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it('page10 不读快照载荷，收到空对象', async () => {
    const client = connectRole('page10');
    const snapshot = await new Promise<any>((resolve) => client.once('snapshot', resolve));
    try {
      expect(snapshot).toEqual({});
    } finally {
      client.close();
    }
  });

  it('未声明角色（旧客户端）仍收全量快照', async () => {
    const client = connectRole(null);
    const snapshot = await new Promise<any>((resolve) => client.once('snapshot', resolve));
    try {
      expect(snapshot.store).toBeTruthy();
      expect(Array.isArray(snapshot.panels)).toBe(true);
      expect(snapshot.stage).toBeTruthy();
      expect(snapshot.mvp).toBeTruthy();
    } finally {
      client.close();
    }
  });
});

describe('socket 角色分组：事件定向投递', () => {
  it('记分牌更新只投订阅角色（page5 收到、page9 不收）', async () => {
    const page5 = connectRole('page5');
    const page9 = connectRole('page9');
    await Promise.all([waitConnected(page5), waitConnected(page9)]);

    const page5Events: unknown[] = [];
    const page9Events: unknown[] = [];
    page5.on('scoreboard:update', (payload) => page5Events.push(payload));
    page9.on('scoreboard:update', (payload) => page9Events.push(payload));

    try {
      await post('/api/scoreboard', { leftName: '甲', rightName: '乙' });
      await vi.waitFor(() => expect(page5Events).toHaveLength(1), { timeout: 2000 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(page9Events).toHaveLength(0);
    } finally {
      page5.close();
      page9.close();
    }
  });

  it('比赛更新投 page7 但不投 page9；面板更新投 page2 但不投 page9', async () => {
    const page2 = connectRole('page2');
    const page7 = connectRole('page7');
    const page9 = connectRole('page9');
    await Promise.all([waitConnected(page2), waitConnected(page7), waitConnected(page9)]);

    const page2Panels: unknown[] = [];
    const page7Matches: unknown[] = [];
    const page9Any: string[] = [];
    page2.on('panel:update', () => page2Panels.push('x'));
    page7.on('matches:update', () => page7Matches.push('x'));
    page9.on('panel:update', () => page9Any.push('panel'));
    page9.on('matches:update', () => page9Any.push('matches'));

    try {
      await post('/api/matches', { leftPlayer: '甲', rightPlayer: '乙' });
      await post('/api/panels/left', []);
      await vi.waitFor(() => expect(page7Matches.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
      await vi.waitFor(() => expect(page2Panels.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(page9Any).toEqual([]);
    } finally {
      page2.close();
      page7.close();
      page9.close();
    }
  });

  it('镜像反转广播投递页面1/2（stage:update，供三页实时镜像切换）', async () => {
    const page1 = connectRole('page1');
    const page2 = connectRole('page2');
    await Promise.all([waitConnected(page1), waitConnected(page2)]);

    const page1Events: any[] = [];
    const page2Events: any[] = [];
    page1.on('stage:update', (payload) => page1Events.push(payload));
    page2.on('stage:update', (payload) => page2Events.push(payload));

    try {
      await post('/api/stage', { mirrorSides: true });
      await vi.waitFor(() => expect(page1Events).toHaveLength(1), { timeout: 2000 });
      await vi.waitFor(() => expect(page2Events).toHaveLength(1), { timeout: 2000 });
      expect(page1Events[0].stage.mirrorSides).toBe(true);
      expect(page2Events[0].stage.mirrorSides).toBe(true);
    } finally {
      page1.close();
      page2.close();
    }
  });
});
