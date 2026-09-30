/**
 * 云同步（点击式：Cloudflare Worker + KV 信箱）端到端测试。
 *
 * 用一个「本地假 Worker」模拟 Cloudflare 侧（只做 KV 读写 + X-Sync-Key 校验，与 cloudflare/worker.js 同契约），
 * 在同一进程里起两台机器的 socket-server（主控 A / 分控 B），走真实 HTTP 完成：
 * 分发 → 同步最新 → 登记 → 回传 → 检查回传 → 确认 + 回执 → 红点轮询。
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { saveCloudSyncConfig } from '../../electron/services/cloud-sync-service';
import { loadRuntimeConfig, saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { createMatch, getMatchStore } from '../../electron/services/match-service';
import { createTournament, getTournamentStore, startTournament } from '../../electron/services/tournament-service';
import type { CloudSyncStatus, CloudSyncVersion, TournamentRecord } from '../../shared/types';

/* ==================== 本地假 Worker（KV 信箱的最小实现） ==================== */

interface FakeWorker {
  url: string;
  /** KV 内容：完整键 -> 对象 */
  kv: Map<string, unknown>;
  /** 每个键的最后写入时间（ISO） */
  writtenAt: Map<string, string>;
  close(): Promise<void>;
}

const BOX_PATTERN = /^(downlink|version|uplink\/[A-Za-z0-9_-]{1,8}|ack\/[A-Za-z0-9_-]{1,8})$/;
/** Worker 侧访问令牌（真实部署用 `wrangler secret put SYNC_TOKEN`） */
const SYNC_TOKEN = 'test-token-3f9a1c';

async function startFakeWorker(): Promise<FakeWorker> {
  const kv = new Map<string, unknown>();
  const writtenAt = new Map<string, string>();

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const send = (status: number, payload: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };

      if (url.pathname === '/health') {
        send(200, {
          success: true,
          service: 'roco-pvp-cloud-sync',
          tokenRequired: true,
          tokenConfigured: true,
        });
        return;
      }

      // 新契约：/room/{box}，房间密钥与令牌都走请求头（URL 里不出现任何密钥）
      const matched = /^\/room\/(.+)$/.exec(url.pathname);
      if (!matched) {
        send(404, { success: false, error: '未知的信箱地址' });
        return;
      }
      const box = decodeURIComponent(matched[1]);
      if (!BOX_PATTERN.test(box)) {
        send(400, { success: false, error: '未知的信箱名' });
        return;
      }
      if (request.headers['x-sync-token'] !== SYNC_TOKEN) {
        send(401, { success: false, error: '访问令牌不正确' });
        return;
      }
      const key = String(request.headers['x-sync-key'] ?? '');
      if (!key) {
        send(401, { success: false, error: '缺少房间密钥' });
        return;
      }

      const kvKey = `room:${key}:${box}`;
      if (request.method === 'GET') {
        if (!kv.has(kvKey)) {
          send(200, { success: true, exists: false, modifiedAt: null, value: null });
          return;
        }
        send(200, { success: true, exists: true, modifiedAt: writtenAt.get(kvKey) ?? null, value: kv.get(kvKey) });
        return;
      }
      if (request.method === 'PUT') {
        try {
          kv.set(kvKey, JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch {
          send(400, { success: false, error: '请求体必须是 JSON' });
          return;
        }
        const at = new Date().toISOString();
        writtenAt.set(kvKey, at);
        send(200, { success: true, modifiedAt: at });
        return;
      }
      if (request.method === 'DELETE') {
        kv.delete(kvKey);
        writtenAt.delete(kvKey);
        send(200, { success: true, deleted: true });
        return;
      }
      send(405, { success: false, error: '不支持的方法' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    kv,
    writtenAt,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/* ==================== 夹具 ==================== */

const SYNC_KEY = 'room-key-2026';

let worker: FakeWorker;
let root: string;
let mainPaths: AppPaths;
let subPaths: AppPaths;
let mainServer: LocalServer;
let subServer: LocalServer;
let mainBase: string;
let subBase: string;

beforeAll(async () => {
  worker = await startFakeWorker();
  root = mkdtempSync(join(tmpdir(), 'roco-cloud-sync-'));
  mainPaths = createAppPaths(join(root, 'main'), join(root, 'main'));
  subPaths = createAppPaths(join(root, 'sub'), join(root, 'sub'));
  mkdirSync(mainPaths.dataDir, { recursive: true });
  mkdirSync(subPaths.dataDir, { recursive: true });

  mainServer = await createLocalServer(mainPaths, 0, '127.0.0.1');
  subServer = await createLocalServer(subPaths, 0, '127.0.0.1');
  mainBase = `http://127.0.0.1:${(mainServer.server.address() as AddressInfo).port}`;
  subBase = `http://127.0.0.1:${(subServer.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await mainServer.close();
  await subServer.close();
  await worker.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  worker.kv.clear();
  worker.writtenAt.clear();
  // 每例重来：清掉两台机器的运行时数据与云同步状态
  [mainPaths, subPaths].forEach((paths) => {
    rmSync(paths.cacheDir, { recursive: true, force: true });
    rmSync(paths.configFile, { force: true });
  });
  saveRuntimeConfig(mainPaths, { machineCode: 'A', machineLabel: '主播机' });
  saveRuntimeConfig(subPaths, { machineCode: 'B', machineLabel: '现场机' });
});

async function post(base: string, pathname: string, body?: unknown): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, data: await response.json() };
}

async function get(base: string, pathname: string): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`);
  return { status: response.status, data: await response.json() };
}

/** 两端配置到同一个房间（A 主控 + B 分控）：密钥 + 令牌 + Worker 地址 */
function configureRoom(): void {
  saveCloudSyncConfig(mainPaths, {
    syncKey: SYNC_KEY,
    syncToken: SYNC_TOKEN,
    workerUrl: worker.url,
    role: 'main',
    machineLabel: '主播机',
    peerCodes: ['B'],
  });
  saveCloudSyncConfig(subPaths, {
    syncKey: SYNC_KEY,
    syncToken: SYNC_TOKEN,
    workerUrl: worker.url,
    role: 'sub',
    machineLabel: '现场机',
  });
}

const postMain = (pathname: string, body?: unknown) => post(mainBase, pathname, body);
const postSub = (pathname: string, body?: unknown) => post(subBase, pathname, body);

/** 建 n 名档案选手 */
function seedPlayers(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => {
    savePlayerProfile(mainPaths, { id: `p${index}`, name: `选手${index}` });
    return `p${index}`;
  });
}

/** 主控建一场 8 人系列赛并开赛（产生首波对局） */
function createRunningTournament(): { tournament: TournamentRecord; matches: string[] } {
  const playerIds = seedPlayers(8);
  const created = createTournament(mainPaths, { name: '云同步杯', playerIds, seed: 42 });
  startTournament(mainPaths, created.id);
  const matches = getMatchStore(mainPaths).matches
    .filter((match) => match.tournamentRef?.tournamentId === created.id)
    .map((match) => match.id);
  return { tournament: getTournamentStore(mainPaths).find((item) => item.id === created.id)!, matches };
}

/** 分控登记一场（逐小局：录阵容 → 开始 → 登记胜负，直到比赛完赛；适配 BO1/BO3） */
async function playMatchOnSub(matchId: string, winner: 'left' | 'right'): Promise<void> {
  for (let guard = 0; guard < 10; guard += 1) {
    const match = getMatchStore(subPaths).matches.find((item) => item.id === matchId);
    if (!match || match.status === 'completed') {
      expect(match?.winner).toBe(winner);
      return;
    }
    const game = match.games.find((item) => item.status === 'pending') ?? match.games[0];
    await postSub(`/api/matches/${matchId}/games/${game.gameNumber}/lineup`, {
      selections: { left: [{ sprite: '3001' }], right: [{ sprite: '3002' }] },
    });
    const started = await postSub(`/api/matches/${matchId}/start`);
    expect(started.status).toBe(200);
    const winnerResult = await postSub(`/api/matches/${matchId}/winner`, { winner });
    expect(winnerResult.status).toBe(200);
  }
  throw new Error(`比赛 ${matchId} 未能打完`);
}

/** 主控「同步分发」 */
async function push(): Promise<CloudSyncVersion> {
  const result = await postMain('/api/cloud-sync/push', { syncKey: SYNC_KEY, machineCode: 'A' });
  expect(result.status).toBe(200);
  expect(result.data.success).toBe(true);
  return result.data.version as CloudSyncVersion;
}

/** 分控「同步最新」+「确认合并」，返回预览 */
async function syncSub(): Promise<{ preview: any; applied: any }> {
  const pulled = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
  expect(pulled.status).toBe(200);
  const preview = pulled.data.preview;
  const accepted = [
    ...preview.matchItems,
    ...preview.playerItems,
    ...preview.teamItems,
  ].filter((item: { action: string }) => item.action !== 'skip').map((item: { key: string }) => item.key);

  const applied = await postSub('/api/cloud-sync/apply', {
    syncKey: SYNC_KEY,
    machineCode: 'B',
    accepted,
    mode: 'newer',
  });
  expect(applied.status).toBe(200);
  return { preview, applied: applied.data };
}

/* ==================== 设置与自检 ==================== */

describe('云同步设置与连通性', () => {
  it('保存设置后状态可读：房间密钥 / 角色 / 名册 / 是否已配置', async () => {
    configureRoom();
    const status = (await get(mainBase, '/api/cloud-sync/status')).data.status as CloudSyncStatus;
    expect(status.config.syncKey).toBe(SYNC_KEY);
    expect(status.config.role).toBe('main');
    expect(status.config.machineLabel).toBe('主播机');
    expect(status.configured).toBe(true);
    // 名册 = 本机码 + 分控码，且不含重复
    expect(status.roster.map((entry) => entry.code).sort()).toEqual(['A', 'B']);
  });

  it('「检测 Worker 在线」：可达返回 ok，地址写错返回中文错误而不是抛异常', async () => {
    configureRoom();
    const ok = await postMain('/api/cloud-sync/test', { syncKey: SYNC_KEY, workerUrl: worker.url });
    expect(ok.data.ok).toBe(true);
    expect(ok.data.message).toContain('可达');

    const bad = await postMain('/api/cloud-sync/test', { syncKey: SYNC_KEY, workerUrl: 'http://127.0.0.1:1' });
    expect(bad.data.ok).toBe(false);
    expect(String(bad.data.message)).toContain('不可达');
  });

  it('「检测 Worker 在线」不需要房间密钥，但需要访问令牌；令牌没填时明确提示', async () => {
    // 只填 workerUrl + 令牌（syncKey 留空）：检测在线必须通过，并把地址/令牌存下来
    const saved = await postMain('/api/cloud-sync/test', {
      syncKey: '',
      syncToken: SYNC_TOKEN,
      workerUrl: worker.url,
    });
    expect(saved.status).toBe(200);
    expect(saved.data.ok).toBe(true);
    expect(String(saved.data.message)).toContain('可达');
    expect((await get(mainBase, '/api/cloud-sync/status')).data.status.config.workerUrl).toBe(worker.url);

    // 令牌留空：不能只说「不可达」，要指出是缺访问令牌
    const noToken = await postMain('/api/cloud-sync/test', { syncKey: '', syncToken: '', workerUrl: worker.url });
    expect(noToken.data.ok).toBe(false);
    expect(String(noToken.data.message)).toContain('访问令牌');

    // 地址写成别的站点（能连上但不是本软件的 Worker）→ 给出可操作提示
    const wrong = await postMain('/api/cloud-sync/test', {
      syncKey: '',
      syncToken: SYNC_TOKEN,
      workerUrl: mainBase,
    });
    expect(wrong.data.ok).toBe(false);
    expect(String(wrong.data.message)).toMatch(/\/health|Worker 标识/);
  });

  it('房间密钥不一致时报中文错误，不写任何云端数据', async () => {
    configureRoom();
    const result = await postMain('/api/cloud-sync/push', { syncKey: '别的房间', machineCode: 'A' });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('房间密钥');
    expect(worker.kv.size).toBe(0);
  });

  it('访问令牌配错：Worker 拒绝（401）且给出中文原因，不写入任何数据', async () => {
    configureRoom();
    // 本机令牌与 Worker 的 SYNC_TOKEN 不一致
    saveCloudSyncConfig(mainPaths, { syncToken: '错误的令牌' });
    createMatch(mainPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });

    const result = await postMain('/api/cloud-sync/push', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('访问令牌');
    expect(worker.kv.size).toBe(0);

    // 检测在线也要把「令牌不对」说清楚，而不是笼统的不可达
    const test = await postMain('/api/cloud-sync/test', {
      workerUrl: worker.url,
      syncKey: SYNC_KEY,
      syncToken: '错误的令牌',
    });
    expect(test.data.ok).toBe(false);
    expect(String(test.data.message)).toContain('令牌');
  });
});

/* ==================== 下行链路 ==================== */

describe('下行：主控「同步分发」→ 分控「同步最新」', () => {
  it('分发写入 downlink + version，分包不带头像但含名册与指派规则', async () => {
    configureRoom();
    createMatch(mainPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    const version = await push();

    expect(version.v).toBe(1);
    expect(version.from).toBe('A');

    const downlink = worker.kv.get(`room:${SYNC_KEY}:downlink`) as any;
    expect(downlink.app).toBe('roco-pvp-lineup');
    expect(downlink.machine).toBe('A');
    expect(downlink.avatars).toBeUndefined();
    expect(downlink.cloud.roster.map((entry: { code: string }) => entry.code).sort()).toEqual(['A', 'B']);
    expect(downlink.cloud.assignment.overrides).toEqual({});

    const storedVersion = worker.kv.get(`room:${SYNC_KEY}:version`) as CloudSyncVersion;
    expect(storedVersion.v).toBe(1);

    // 再分发一次：版本号递增（红点轮询据此判断「有新分发」）
    expect((await push()).v).toBe(2);
  });

  it('分控「同步最新」拿到预览并合并；重复同步同一份包全部跳过（幂等）', async () => {
    configureRoom();
    createMatch(mainPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    await push();

    const first = await syncSub();
    expect(first.preview.meta.machine).toBe('A');
    expect(first.preview.summary.match).toEqual({ add: 1, update: 0, skip: 0 });
    expect(getMatchStore(subPaths).matches).toHaveLength(1);
    expect(getMatchStore(subPaths).matches[0].id).toMatch(/^\d{8}_A\d{3}$/);

    const second = await syncSub();
    expect(second.preview.summary.match).toEqual({ add: 0, update: 0, skip: 1 });
    expect(getMatchStore(subPaths).matches).toHaveLength(1);
  });

  it('配对校验：两台机器码相同时拒绝同步，不落盘', async () => {
    configureRoom();
    // 分控端误设成与主控相同的机器码
    saveRuntimeConfig(subPaths, { machineCode: 'A' });
    createMatch(mainPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    await push();

    const result = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('机器码相同');
    expect(getMatchStore(subPaths).matches).toHaveLength(0);
  });

  it('云端没有数据时给出「等主控分发 / KV 有延迟」的中文提示', async () => {
    configureRoom();
    const result = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('云端暂无数据');
  });

  it('主控端不能执行「同步最新」；分控端不能执行「同步分发」', async () => {
    configureRoom();
    const wrongPull = await postMain('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(wrongPull.status).toBe(400);
    expect(String(wrongPull.data.error)).toContain('分控端执行');

    const wrongPush = await postSub('/api/cloud-sync/push', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(wrongPush.status).toBe(400);
    expect(String(wrongPush.data.error)).toContain('只有主控端');
  });
});

/* ==================== 指派与登记闸门 ==================== */

describe('指派规则与登记入口', () => {
  it('指派随分发下发；未指派的比赛在分控端登记入口置灰', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    expect(matches.length).toBeGreaterThanOrEqual(2);

    // 主控把第一场指派给 B
    const assigned = await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    expect(assigned.status).toBe(200);
    await push();
    // 指派规则随分发包下发：分控端先「同步最新」才拿到最新指派
    await syncSub();

    const scope = await postSub('/api/cloud-sync/registration-scope', {
      matchIds: matches,
    });
    expect(scope.data.role).toBe('sub');
    expect(scope.data.scope[matches[0]].allowed).toBe(true);
    for (const matchId of matches.slice(1)) {
      expect(scope.data.scope[matchId].allowed).toBe(false);
      expect(String(scope.data.scope[matchId].reason)).toContain('未指派');
    }
  });

  it('分控端登记未指派的比赛被服务端拒绝（从源头杜绝误操作）', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await push();
    await syncSub();

    const result = await postSub(`/api/matches/${matches[0]}/winner`, { winner: 'left' });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('未指派');
  });

  it('未启用云同步（没填房间密钥）时不干预登记，保持单机行为', async () => {
    saveRuntimeConfig(subPaths, { machineCode: 'B' });
    createMatch(subPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 1 });
    const matchId = getMatchStore(subPaths).matches[0].id;
    await postSub(`/api/matches/${matchId}/games/1/lineup`, {
      selections: { left: [{ sprite: '3001' }], right: [{ sprite: '3002' }] },
    });
    const result = await postSub(`/api/matches/${matchId}/start`);
    // 未被指派闸门拦下（200 表示放行，说明未启用云同步时不干预单机行为）
    expect(result.status).toBe(200);
  });
});

/* ==================== 上行链路 ==================== */

describe('上行：分控「回传」→ 主控确认台 → 回执', () => {
  it('确认台复用导入预览（字段级 diff + 写回影响），确认后合并并写回执', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    await push();
    await syncSub();

    await playMatchOnSub(matches[0], 'left');

    // 分控视角：待回传 1 场
    const subStatus = (await get(subBase, '/api/cloud-sync/status')).data.status as CloudSyncStatus;
    expect(subStatus.pending.count).toBe(1);
    expect(subStatus.pending.matches[0].matchId).toBe(matches[0]);

    const upload = await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(upload.status).toBe(200);
    expect(upload.data.data.count).toBe(1);
    const uplink = worker.kv.get(`room:${SYNC_KEY}:uplink/B`) as any;
    expect(uplink.from).toBe('B');
    expect(uplink.seq).toBe(1);
    expect(uplink.matches[0].id).toBe(matches[0]);

    // 主控「检查回传」：拿到该分控端的待确认条目 + 写回影响
    const check = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(check.status).toBe(200);
    expect(check.data.data.sources).toHaveLength(1);
    const source = check.data.data.source;
    expect(source.code).toBe('B');
    expect(source.items).toHaveLength(1);
    expect(source.items[0].record.status).toBe('completed');
    // 系列赛对局：影响说明点明写入哪个节点、何时推进
    expect(source.items[0].impact).toContain('winnerId');
    expect(source.items[0].impact).toContain('自动推进下一波');

    // 确认前：主控本机的比赛还未合并（比分仍是 0 : 0）
    const before = getMatchStore(mainPaths).matches.find((match) => match.id === matches[0]);
    expect(before?.status).toBe('pending');

    const confirm = await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: source.selectableKeys,
    });
    expect(confirm.status).toBe(200);
    expect(confirm.data.data.acked).toEqual([matches[0]]);

    // 赛果已合并：比分与胜者写回，系列赛节点记录胜者
    const after = getMatchStore(mainPaths).matches.find((match) => match.id === matches[0]);
    expect(after?.status).toBe('completed');
    expect(after?.winner).toBe('left');
    const nodeWinner = getTournamentStore(mainPaths)[0].waves
      .flatMap((wave) => wave.nodes)
      .find((node) => node.id === after?.tournamentRef?.nodeId)?.winnerId;
    expect(nodeWinner).toBeTruthy();

    // 回执写到 ack:B；收件箱清空
    const ack = worker.kv.get(`room:${SYNC_KEY}:ack/B`) as any;
    expect(ack.ackedMatchIds).toEqual([matches[0]]);
    expect(ack.ackedSeq).toBe(1);
    const mainStatus = (await get(mainBase, '/api/cloud-sync/status')).data.status as CloudSyncStatus;
    expect(mainStatus.inbox).toHaveLength(0);
    expect(mainStatus.lastContact.ackedAt).toBeTruthy();
  });

  it('分控红点轮询拉到回执后清空待回传标记，并锁定该场撤回', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    await push();
    await syncSub();
    await playMatchOnSub(matches[0], 'right');
    await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });

    const check = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: check.data.data.source.selectableKeys,
    });

    // 分控轮询：只读小键，拿到回执并清标
    const poll = await postSub('/api/cloud-sync/poll', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(poll.status).toBe(200);
    expect(poll.data.status.pending.count).toBe(0);
    expect(poll.data.status.pending.ackedMatchIds).toContain(matches[0]);

    // 已 ack 的赛果在分控端禁止撤回
    const undo = await postSub(`/api/matches/${matches[0]}/undo`);
    expect(undo.status).toBe(400);
    expect(String(undo.data.error)).toContain('已被主控端确认');
  });

  it('驳回：不写本地、不写回执，分控端保持待回传', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    await push();
    await syncSub();
    await playMatchOnSub(matches[0], 'left');
    await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });

    const rejected = await postMain('/api/cloud-sync/reject', { syncKey: SYNC_KEY, machineCode: 'A', code: 'B' });
    expect(rejected.status).toBe(200);
    expect(worker.kv.has(`room:${SYNC_KEY}:ack/B`)).toBe(false);
    expect(getMatchStore(mainPaths).matches.find((match) => match.id === matches[0])?.status).toBe('pending');

    const subStatus = (await get(subBase, '/api/cloud-sync/status')).data.status as CloudSyncStatus;
    expect(subStatus.pending.count).toBe(1);
  });

  it('无待回传内容时「回传」拒绝并给出原因（按钮同时会置灰）', async () => {
    configureRoom();
    createMatch(mainPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    await push();
    await syncSub();
    const result = await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('无待回传');
  });

  it('确认后 KV 还读到旧回传值时，待确认清单不会被“复活”', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    await push();
    await syncSub();
    await playMatchOnSub(matches[0], 'left');
    await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });

    const check = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(check.data.data.sources).toHaveLength(1);
    await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: check.data.data.source.selectableKeys,
    });

    // KV 是最终一致的：模拟「确认之后仍读到确认前的旧 uplink」（seq 还是 1）
    const uplinkBefore = worker.kv.get(`room:${SYNC_KEY}:uplink/B`);
    const poll = await postMain('/api/cloud-sync/poll', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(poll.data.status.inbox).toHaveLength(0);
    expect(worker.kv.get(`room:${SYNC_KEY}:uplink/B`)).toEqual(uplinkBefore);

    // 再点一次「检查回传」也不该把已确认的赛果重新列出来
    const recheck = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(recheck.data.data.sources).toHaveLength(0);
    expect(recheck.data.data.source).toBeNull();

    // 分控端交了新一版（seq 更大）时仍然会被读到
    const second = await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(second.status).toBe(200);
    const afterNew = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(afterNew.data.data.sources).toHaveLength(1);
  });

  it('确认台确认后主控状态立刻清空（不会还显示待确认数量）', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    await push();
    await syncSub();
    await playMatchOnSub(matches[0], 'right');
    await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });

    const check = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(check.data.status.inbox[0].pending).toHaveLength(1);

    const confirm = await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: check.data.data.source.selectableKeys,
    });
    // 响应里带回的状态就是清空后的：界面不需要再猜
    expect(confirm.data.status.inbox).toHaveLength(0);
    expect(confirm.data.status.lastContact.ackedAt).toBeTruthy();
  });

  it('分控端交回后：待交回计数与「等确认」计数能区分开', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    await push();
    await syncSub();
    await playMatchOnSub(matches[0], 'left');

    const beforeUpload = (await get(subBase, '/api/cloud-sync/status')).data.status;
    expect(beforeUpload.pending.count).toBe(1);
    expect(beforeUpload.pending.unconfirmedCount).toBe(0);

    await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    const afterUpload = (await get(subBase, '/api/cloud-sync/status')).data.status;
    expect(afterUpload.pending.count).toBe(1);
    expect(afterUpload.pending.unconfirmedCount).toBe(1);
  });

  it('分控端「确认合并」后 appliedVersion 跟上：红点不会一直挂着', async () => {
    configureRoom();
    createMatch(mainPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    await push();

    const pulled = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
    const accepted = pulled.data.preview.matchItems.map((item: { key: string }) => item.key);
    const applied = await postSub('/api/cloud-sync/apply', {
      syncKey: SYNC_KEY,
      machineCode: 'B',
      accepted,
      mode: 'newer',
    });
    expect(applied.data.status.appliedVersion).toBe(applied.data.status.version.v);

    // 再点一次：没有可写入的条目 → 用「标记为已处理」收尾（不写入任何数据）
    const again = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
    const selectable = again.data.preview.matchItems.filter((item: { action: string }) => item.action !== 'skip');
    expect(selectable).toHaveLength(0);

    const skipped = await postSub('/api/cloud-sync/skip', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(skipped.status).toBe(200);
    expect(skipped.data.status.appliedVersion).toBe(skipped.data.status.version.v);
    expect(getMatchStore(subPaths).matches).toHaveLength(1);
  });

  it('对方重复交回同一批赛果时仍能确认：预览全是「内容一致」，只写回执不改数据', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    const matchId = matches[0];
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matchId]: 'B' },
    });
    await push();
    await syncSub();

    // 第一轮：分控登记 → 交回 → 主控确认（此后主控的这场就是最终态）
    await playMatchOnSub(matchId, 'left');
    await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    const firstCheck = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: firstCheck.data.data.source.selectableKeys,
    });

    // 第二轮：分控（还没收到回执）把同一批赛果再交回一次 → 主控预览里全是「内容一致」
    const reupload = await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(reupload.status).toBe(200);
    const check = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    const source = check.data.data.source;
    expect(source).toBeTruthy();
    expect(source.items.every((entry: { item: { action: string } }) => entry.item.action === 'skip')).toBe(true);
    // 关键：这类条目也必须可勾选，否则主控点不了确认、对方永远停在「等主控确认」
    expect(source.selectableKeys).toHaveLength(source.items.length);

    const storeBefore = JSON.stringify(getMatchStore(mainPaths).matches);
    const confirm = await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: source.selectableKeys,
    });
    expect(confirm.status).toBe(200);
    expect(confirm.data.data.acked).toEqual([matchId]);
    // 数据零改动 + 收件箱清空
    expect(JSON.stringify(getMatchStore(mainPaths).matches)).toBe(storeBefore);
    expect(confirm.data.result.applied.match.update).toBe(0);
    expect(confirm.data.status.inbox).toHaveLength(0);

    // 回执送达：分控端不再显示「等主控确认」
    const ack = worker.kv.get(`room:${SYNC_KEY}:ack/B`) as any;
    expect(ack.ackedMatchIds).toContain(matchId);
    await postSub('/api/cloud-sync/poll', { syncKey: SYNC_KEY, machineCode: 'B' });
    const subAfter = (await get(subBase, '/api/cloud-sync/status')).data.status;
    expect(subAfter.pending.count).toBe(0);
    expect(subAfter.pending.ackedMatchIds).toContain(matchId);
  });

  it('未在收件箱的回传内容不能确认（先「检查回传」）', async () => {
    configureRoom();
    const result = await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: ['match:20260930_A001'],
    });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('收件箱');
  });
  it('预览按系列赛分组：能看出哪条系列赛包含哪些比赛', async () => {
    configureRoom();
    const { tournament, matches } = createRunningTournament();
    createMatch(mainPaths, { leftPlayer: '散人甲', rightPlayer: '散人乙', bestOf: 3 });
    await push();

    const pulled = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
    const groups = pulled.data.preview.tournamentGroups;
    expect(pulled.data.preview.hasTournaments).toBe(true);

    const tournamentGroup = groups.find((group: { id: string }) => group.id === tournament.id);
    expect(tournamentGroup).toBeTruthy();
    expect(tournamentGroup.name).toBe('云同步杯');
    expect(tournamentGroup.playerCount).toBe(8);
    expect(tournamentGroup.incoming).toBe(true);
    expect(tournamentGroup.existsLocally).toBe(false);
    expect(tournamentGroup.matchKeys.sort()).toEqual(matches.map((id) => `match:${id}`).sort());

    // 普通对局单独一组，且不混进系列赛组
    const plainGroup = groups.find((group: { id: string }) => group.id === '');
    expect(plainGroup.matchKeys).toHaveLength(1);
    expect(tournamentGroup.matchKeys).not.toContain(plainGroup.matchKeys[0]);
  });

  it('取消勾选某条系列赛：它的编排与名下比赛都不导入，其他数据照常导入', async () => {
    configureRoom();
    const { tournament, matches } = createRunningTournament();
    createMatch(mainPaths, { leftPlayer: '散人甲', rightPlayer: '散人乙', bestOf: 3 });
    await push();

    const pulled = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
    const accepted = pulled.data.preview.matchItems.map((item: { key: string }) => item.key);
    const applied = await postSub('/api/cloud-sync/apply', {
      syncKey: SYNC_KEY,
      machineCode: 'B',
      accepted,
      mode: 'newer',
      excludeTournamentIds: [tournament.id],
    });
    expect(applied.status).toBe(200);

    // 系列赛与它的比赛都没进来，只有普通对局落地
    expect(getTournamentStore(subPaths)).toHaveLength(0);
    const subMatches = getMatchStore(subPaths).matches;
    expect(subMatches).toHaveLength(1);
    expect(matches).not.toContain(subMatches[0].id);
    expect(applied.data.data.warnings.join()).toContain('跳过');

    // 再同步一次、这次不排除：系列赛与比赛都会进来
    await push();
    const pulled2 = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
    const accepted2 = pulled2.data.preview.matchItems.map((item: { key: string }) => item.key);
    const applied2 = await postSub('/api/cloud-sync/apply', {
      syncKey: SYNC_KEY,
      machineCode: 'B',
      accepted: accepted2,
      mode: 'newer',
    });
    expect(applied2.status).toBe(200);
    expect(getTournamentStore(subPaths).map((record) => record.id)).toContain(tournament.id);
    const subIds = getMatchStore(subPaths).matches.map((match) => match.id);
    expect(matches.every((matchId) => subIds.includes(matchId))).toBe(true);
    // 普通对局不会被系列赛导入顺手删掉
    expect(subIds.length).toBe(matches.length + 1);
  });
});

/* ==================== 主控回退后重分发（陈旧登记不得复活） ==================== */

describe('主控回退上一波后重新分发', () => {
  it('云端仍为「未登记」时，分控端陈旧赛果被撤回并移出待回传集', async () => {
    configureRoom();
    // 4 人单败首波只有 2 场：两场都打完 → 主控可以整波「回退上一波」
    const playerIds = seedPlayers(4);
    const created = createTournament(mainPaths, { name: '回退杯', playerIds, seed: 42 });
    startTournament(mainPaths, created.id);
    const matches = getMatchStore(mainPaths).matches.map((match) => match.id);
    expect(matches).toHaveLength(2);

    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: Object.fromEntries(matches.map((matchId) => [matchId, 'B'])),
    });
    await push();
    await syncSub();

    // 分控打完两场 → 回传 → 主控确认（整波完成）
    await playMatchOnSub(matches[0], 'left');
    await playMatchOnSub(matches[1], 'right');
    const subUpload = await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(subUpload.status).toBe(200);
    expect(subUpload.data.data.count).toBe(2);
    const check = await postMain('/api/cloud-sync/check', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(check.data.data.source.items).toHaveLength(2);
    await postMain('/api/cloud-sync/confirm', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      code: 'B',
      accepted: check.data.data.source.selectableKeys,
    });
    await postSub('/api/cloud-sync/poll', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect((await get(subBase, '/api/cloud-sync/status')).data.status.pending.count).toBe(0);

    // 主控「回退上一波」：清节点胜者、两场比赛复位为 pending，随后重新分发
    const rollback = await postMain(`/api/tournaments/${created.id}/rollback-wave`, {});
    expect(rollback.status).toBe(200);
    expect(getMatchStore(mainPaths).matches.map((match) => match.status)).toEqual(['pending', 'pending']);
    await push();

    const pulled = await postSub('/api/cloud-sync/pull', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(pulled.status).toBe(200);
    const accepted = pulled.data.preview.matchItems.map((item: { key: string }) => item.key);
    const applied = await postSub('/api/cloud-sync/apply', {
      syncKey: SYNC_KEY,
      machineCode: 'B',
      accepted,
      mode: 'newer',
    });
    expect(applied.status).toBe(200);

    // 陈旧登记被撤回（保留主控版本）：本机两场回到未登记，并给出中文提示
    const after = getMatchStore(subPaths).matches.filter((match) => matches.includes(match.id));
    expect(after.map((match) => match.status)).toEqual(['pending', 'pending']);
    expect(after.every((match) => match.winner === null)).toBe(true);
    expect(applied.data.data.warnings.join()).toContain('主控回退过这一波');
    // 回执里的 id 同时清掉：两场重新具备「重新登记 → 回传」的资格
    expect(applied.data.status.pending.ackedMatchIds.filter((id: string) => matches.includes(id))).toEqual([]);
    expect(applied.data.status.pending.count).toBe(0);
  });
});

/* ==================== 红点轮询 ==================== */

describe('红点轮询（只读小键、不合并数据）', () => {
  it('分控端检测到版本号变化（主控再次分发）', async () => {
    configureRoom();
    createMatch(mainPaths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    await push();
    await syncSub();

    const before = await postSub('/api/cloud-sync/poll', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(before.data.changed).toBe(false);

    await push();
    const after = await postSub('/api/cloud-sync/poll', { syncKey: SYNC_KEY, machineCode: 'B' });
    expect(after.data.changed).toBe(true);
    expect(after.data.version.v).toBe(2);
    // 轮询不合并数据：分控本机比赛数量不变
    expect(getMatchStore(subPaths).matches).toHaveLength(1);
  });

  it('主控端轮询读到分控端回传摘要（收件箱红点）', async () => {
    configureRoom();
    const { matches } = createRunningTournament();
    await postMain('/api/cloud-sync/assignment', {
      syncKey: SYNC_KEY,
      machineCode: 'A',
      overrides: { [matches[0]]: 'B' },
    });
    await push();
    await syncSub();
    await playMatchOnSub(matches[0], 'left');
    await postSub('/api/cloud-sync/upload', { syncKey: SYNC_KEY, machineCode: 'B' });

    const poll = await postMain('/api/cloud-sync/poll', { syncKey: SYNC_KEY, machineCode: 'A' });
    expect(poll.status).toBe(200);
    expect(poll.data.inbox).toHaveLength(1);
    expect(poll.data.inbox[0].code).toBe('B');
    expect(poll.data.inbox[0].pending).toHaveLength(1);
    expect(poll.data.status.inbox[0].seq).toBe(1);
  });
});

/* ==================== 机器码守卫 ==================== */

describe('改机器码守卫（坑 1：改码丢系列赛编排权）', () => {
  it('有进行中的系列赛内嵌旧码时禁止改码', async () => {
    configureRoom();
    const { tournament } = createRunningTournament();
    const result = await postMain('/api/runtime-config', { machineCode: 'C' });
    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('进行中的系列赛');
    expect(result.data.guard.tournamentIds).toContain(tournament.id);
    expect(loadRuntimeConfig(mainPaths).machineCode).toBe('A');
  });

  it('仅有已结束（setup）的旧码系列赛时要求二次确认，确认后才落盘', async () => {
    configureRoom();
    const playerIds = seedPlayers(8);
    createTournament(mainPaths, { name: '待开赛杯', playerIds, seed: 7 });

    const needsConfirm = await postMain('/api/runtime-config', { machineCode: 'C' });
    expect(needsConfirm.status).toBe(409);
    expect(String(needsConfirm.data.error)).toContain('失去这些系列赛的编排权');
    expect(loadRuntimeConfig(mainPaths).machineCode).toBe('A');

    const confirmed = await postMain('/api/runtime-config', { machineCode: 'C', confirmMachineCodeChange: true });
    expect(confirmed.status).toBe(200);
    expect(loadRuntimeConfig(mainPaths).machineCode).toBe('C');
  });

  it('无内嵌旧码的系列赛时直接改码（不打扰）', async () => {
    configureRoom();
    const result = await postMain('/api/runtime-config', { machineCode: 'C' });
    expect(result.status).toBe(200);
    expect(result.data.config.machineCode).toBe('C');
    expect(loadRuntimeConfig(mainPaths).machineCode).toBe('C');
  });
});
