import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let server: LocalServer;
let base: string;
let paths: AppPaths;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-page-push-delete-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  // 不传 authConfig = 鉴权关闭
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

async function requestJson(
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

const postJson = (pathname: string, body?: unknown) => requestJson('POST', pathname, body);
const getJson = (pathname: string) => requestJson('GET', pathname);

/** 建一场普通对局（默认待开始），返回 matchId */
async function createMatch(leftPlayer: string, rightPlayer: string): Promise<string> {
  const { status, data } = await postJson('/api/matches', { leftPlayer, rightPlayer, bestOf: 1 });
  expect(status).toBe(200);
  return data.store.matches[0].id as string;
}

/** 经 HTTP 打完一场（BO1：录阵容 → 开始 → 登记胜负） */
async function playMatchHttp(matchId: string): Promise<void> {
  await postJson(`/api/matches/${matchId}/games/1/lineup`, {
    selections: { left: [{ sprite: '3001' }], right: [{ sprite: '3002' }] },
  });
  await postJson(`/api/matches/${matchId}/start`);
  await postJson(`/api/matches/${matchId}/winner`, { winner: 'left' });
}

async function connectClient(): Promise<Socket> {
  const client: Socket = ioClient(base, { transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
  return client;
}

describe('推流选场（page6/7/8）删除比赛后的状态同步', () => {
  it('批量删除：三个页面的悬空 matchId 被清理、按脏页广播新状态，未受影响的页面不广播', async () => {
    // ① 三场已结束对局进 page6，两场待开始进 page7/page8
    const completedA = await createMatch('完成甲', '完成乙');
    await playMatchHttp(completedA);
    const completedB = await createMatch('完成丙', '完成丁');
    await playMatchHttp(completedB);
    const pendingA = await createMatch('预告甲', '预告乙');
    const pendingB = await createMatch('预告丙', '预告丁');

    expect((await postJson('/api/page6', { matchIds: [completedA, completedB] })).status).toBe(200);
    expect((await postJson('/api/page7', { matchIds: [completedA, pendingA] })).status).toBe(200);
    expect((await postJson('/api/page8', { matchIds: [pendingA, pendingB] })).status).toBe(200);

    const client = await connectClient();
    try {
      const page6Events: Array<{ state: { matchIds: string[] } }> = [];
      const page7Events: Array<{ state: { matchIds: string[] } }> = [];
      const page8Events: Array<{ state: { matchIds: string[] } }> = [];
      client.on('page6:update', (payload) => page6Events.push(payload));
      client.on('page7:update', (payload) => page7Events.push(payload));
      client.on('page8:update', (payload) => page8Events.push(payload));

      // ② 删除 completedA：page6 悬空引用清理（剩 1 场）、page7 悬空引用清理（剩 1 场）；page8 不受影响
      const deleted = await postJson('/api/matches/batch-delete', { matchIds: [completedA] });
      expect(deleted.status).toBe(200);
      expect(deleted.data.pagePush.page6.matchIds).toEqual([completedB]);
      expect(deleted.data.pagePush.page7.matchIds).toEqual([pendingA]);
      expect(deleted.data.pagePush.page8).toBeUndefined();

      await vi.waitFor(() => {
        expect(page6Events).toHaveLength(1);
        expect(page7Events).toHaveLength(1);
      }, { timeout: 2000 });
      expect(page8Events).toHaveLength(0);

      // ③ GET 与落盘一致：state.matchIds 不再含已删 id，且 matches 数量与之一致
      const page6 = await getJson('/api/page6');
      expect(page6.data.state.matchIds).toEqual([completedB]);
      expect(page6.data.matches.map((match: { id: string }) => match.id)).toEqual([completedB]);
      const page7 = await getJson('/api/page7');
      expect(page7.data.state.matchIds).toEqual([pendingA]);
      expect(page7.data.matches.map((match: { id: string }) => match.id)).toEqual([pendingA]);
      const page8 = await getJson('/api/page8');
      expect(page8.data.state.matchIds).toEqual([pendingA, pendingB]);

      // ④ 幂等：再删一场与选场无关的对局，不产生新的选场广播
      const unrelated = await createMatch('无关甲', '无关乙');
      await postJson('/api/matches/batch-delete', { matchIds: [unrelated] });
      expect(page6Events).toHaveLength(1);
      expect(page7Events).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  it('单场删除：page6/7/8 全部含该场时一并清理并广播', async () => {
    const pending = await createMatch('单删甲', '单删乙');
    expect((await postJson('/api/page7', { matchIds: [pending] })).status).toBe(200);
    expect((await postJson('/api/page8', { matchIds: [pending] })).status).toBe(200);

    const client = await connectClient();
    try {
      const page7Events: Array<{ state: { matchIds: string[] } }> = [];
      const page8Events: Array<{ state: { matchIds: string[] } }> = [];
      client.on('page7:update', (payload) => page7Events.push(payload));
      client.on('page8:update', (payload) => page8Events.push(payload));

      const deleted = await requestJson('DELETE', `/api/matches/${pending}`);
      expect(deleted.status).toBe(200);
      expect(deleted.data.pagePush.page7.matchIds).toEqual([]);
      expect(deleted.data.pagePush.page8.matchIds).toEqual([]);

      await vi.waitFor(() => {
        expect(page7Events).toHaveLength(1);
        expect(page8Events).toHaveLength(1);
      }, { timeout: 2000 });
      expect(page7Events[0].state.matchIds).toEqual([]);
      expect(page8Events[0].state.matchIds).toEqual([]);

      expect((await getJson('/api/page7')).data.state.matchIds).toEqual([]);
      expect((await getJson('/api/page8')).data.state.matchIds).toEqual([]);
    } finally {
      client.close();
    }
  });

  it('状态变更：page8 选中的待开始比赛完赛后自动移出选场并广播', async () => {
    const match = await createMatch('预告完赛甲', '预告完赛乙');
    expect((await postJson('/api/page8', { matchIds: [match] })).status).toBe(200);

    const client = await connectClient();
    try {
      const page8Events: Array<{ state: { matchIds: string[] } }> = [];
      client.on('page8:update', (payload) => page8Events.push(payload));

      // 比赛进行中仍可展示（不清理），完赛后才移出
      await playMatchHttp(match);

      await vi.waitFor(() => expect(page8Events).toHaveLength(1), { timeout: 2000 });
      expect(page8Events[0].state.matchIds).toEqual([]);

      const page8 = await getJson('/api/page8');
      expect(page8.data.state.matchIds).toEqual([]);
      expect(page8.data.matches).toEqual([]);
    } finally {
      client.close();
    }
  });

  it('场序时间固化：page8 掉场后剩余比赛的固定时间不重排', async () => {
    // 模拟后台「确认推送」：把 19:00 起按每场占用累加的结果整份写入 matchTimes（固化）
    const first = await createMatch('固化甲', '固化乙');
    const second = await createMatch('固化丙', '固化丁');
    const third = await createMatch('固化戊', '固化己');
    const pushed = await postJson('/api/page8', {
      matchIds: [first, second, third],
      startTime: '19:00',
      matchTimes: { [first]: '19:00', [second]: '19:30', [third]: '20:00' },
    });
    expect(pushed.status).toBe(200);

    const client = await connectClient();
    try {
      const page8Events: Array<{ state: { matchTimes: Record<string, string> } }> = [];
      client.on('page8:update', (payload) => page8Events.push(payload));

      // 第一场完赛被移出选场：固化值（19:30 / 20:00）跟随比赛 id 保留，
      // 不按剩余列表从头重算（否则第二场会回退成 19:00）
      await playMatchHttp(first);

      await vi.waitFor(() => expect(page8Events).toHaveLength(1), { timeout: 2000 });
      expect(page8Events[0].state.matchTimes).toEqual({ [second]: '19:30', [third]: '20:00' });

      const page8 = await getJson('/api/page8');
      expect(page8.data.state.matchIds).toEqual([second, third]);
      expect(page8.data.scheduleTimes[second]).toBe('19:30');
      expect(page8.data.scheduleTimes[third]).toBe('20:00');
    } finally {
      client.close();
    }
  });

  it('状态变更：page6 选中的已结束比赛被撤回后自动移出选场并广播', async () => {
    const match = await createMatch('结果撤回甲', '结果撤回乙');
    await playMatchHttp(match);
    expect((await postJson('/api/page6', { matchIds: [match] })).status).toBe(200);

    const client = await connectClient();
    try {
      const page6Events: Array<{ state: { matchIds: string[] } }> = [];
      client.on('page6:update', (payload) => page6Events.push(payload));

      // 撤回本局胜负：比赛回到进行中，不再是「已结束」，应从比赛结果选场移出
      const undone = await postJson(`/api/matches/${match}/undo`);
      expect(undone.status).toBe(200);

      await vi.waitFor(() => expect(page6Events).toHaveLength(1), { timeout: 2000 });
      expect(page6Events[0].state.matchIds).toEqual([]);

      const page6 = await getJson('/api/page6');
      expect(page6.data.state.matchIds).toEqual([]);
      expect(page6.data.matches).toEqual([]);
    } finally {
      client.close();
    }
  });

  it('GET 兜底：存量配置含已删比赛的悬空 id 时不下发', async () => {
    const existing = await createMatch('兜底甲', '兜底乙');
    expect((await postJson('/api/page8', { matchIds: [existing] })).status).toBe(200);

    // 模拟历史遗留的悬空引用（绕过删除路由，直接改写落盘文件）
    const metadata = JSON.parse(readFileSync(paths.page8File, 'utf-8')) as { matchIds: string[] };
    writeFileSync(paths.page8File, JSON.stringify({ ...metadata, matchIds: ['20200101_A999', existing] }), 'utf-8');

    const page8 = await getJson('/api/page8');
    expect(page8.data.state.matchIds).toEqual([existing]);
    expect(page8.data.matches.map((match: { id: string }) => match.id)).toEqual([existing]);
  });
});