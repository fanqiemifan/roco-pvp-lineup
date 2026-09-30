import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { createTournament, getTournamentStore } from '../../electron/services/tournament-service';

let server: LocalServer;
let base: string;
let paths: AppPaths;
let tournamentId: string;

function connectRole(role: string): Socket {
  return ioClient(base, { transports: ['websocket'], query: { role } });
}

async function waitConnected(client: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

async function post(pathname: string, body?: unknown): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function get(pathname: string): Promise<{ status: number; data: any }> {
  const response = await fetch(`${base}${pathname}`);
  return { status: response.status, data: await response.json() };
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-page14-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });

  const playerIds: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    savePlayerProfile(paths, { id: `p${i}`, name: `选手${i}` });
    playerIds.push(`p${i}`);
  }
  tournamentId = createTournament(paths, { name: '星空杯S1', playerIds, seed: 42 }).id;

  // 不传 authConfig = 鉴权关闭
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe('晋级积分榜（page14）路由', () => {
  it('未配置时：GET 返回空配置与 null 榜单', async () => {
    const { status, data } = await get('/api/page14');
    expect(status).toBe(200);
    expect(data.state).toMatchObject({ tournamentId: '', stageIndexes: [], activeStageIndex: -1, page: 0 });
    expect(data.standings).toBeNull();
  });

  it('POST 保存系列赛与阶段：榜单按当前阶段重算，页码按页数夹紧', async () => {
    const record = getTournamentStore(paths).find((item) => item.id === tournamentId)!;
    const stageCount = record.stages.length;
    const { status, data } = await post('/api/page14', {
      tournamentId,
      stageIndexes: [0, 1],
      activeStageIndex: 0,
      page: 5,
      title: '星空杯 晋级积分榜',
      subtitle: '',
    });

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.state).toMatchObject({
      tournamentId,
      stageIndexes: [0, 1],
      activeStageIndex: 0,
      page: 0,
      title: '星空杯 晋级积分榜',
    });
    // 8 人系列赛的阶段 0 只有 1 页，越界页码被夹到 0
    expect(data.standings.stageIndex).toBe(0);
    expect(data.standings.rows).toHaveLength(8);
    expect(data.standings.pageCount).toBe(1);
    expect(stageCount).toBeGreaterThan(1);

    const fetched = await get('/api/page14');
    expect(fetched.data.state.title).toBe('星空杯 晋级积分榜');
    expect(fetched.data.standings.rows).toHaveLength(8);
    expect(fetched.data.standings.rows[0].name).toBeTruthy();

    // 未开打的阶段（setup 且还没轮到）不产生幽灵行
    const future = await post('/api/page14', { activeStageIndex: 1 });
    expect(future.data.state.activeStageIndex).toBe(1);
    expect(future.data.standings.rows).toHaveLength(0);
    expect(future.data.standings.pageCount).toBe(1);
    await post('/api/page14', { activeStageIndex: 0 });
  });

  it('POST 阶段越界/非法系列赛 id：夹紧到已选阶段、非法 id 归零', async () => {
    const outOfRange = await post('/api/page14', { activeStageIndex: 9 });
    expect(outOfRange.data.state.activeStageIndex).toBe(0);

    const badId = await post('/api/page14', { tournamentId: 'not-a-tournament-id' });
    expect(badId.data.state.tournamentId).toBe('');

    const missing = await post('/api/page14', { tournamentId: 'T20260101_A01' });
    expect(missing.data.state.tournamentId).toBe('T20260101_A01');
    expect(missing.data.standings).toBeNull();

    // 复原成可展示的配置，供后续 socket 用例使用
    await post('/api/page14', { tournamentId, stageIndexes: [0], activeStageIndex: 0, page: 0 });
  });

  it('阶段名/赛制等榜单元信息与系列赛一致', async () => {
    const { data } = await get('/api/page14');
    const record = getTournamentStore(paths).find((item) => item.id === tournamentId)!;
    expect(data.standings.stageName).toBe(record.stages[0].name);
    expect(data.standings.format).toBe(record.stages[0].format);
    expect(data.standings.rows).toHaveLength(8);
  });

  it('推流页面14 的静态文件与路由都存在（页面文件缺失会导致空白画面）', () => {
    // 用真实的项目根目录核对静态资源，避免路由指向不存在的页面文件
    const repoPaths = createAppPaths(process.cwd(), process.cwd());
    expect(existsSync(join(repoPaths.pagesDir, 'roco-pvp-page14.html'))).toBe(true);
    expect(existsSync(join(repoPaths.scriptsDir, 'page14-display.js'))).toBe(true);
    expect(existsSync(join(repoPaths.stylesDir, 'roco-pvp-page14.css'))).toBe(true);
  });
});

describe('晋级积分榜（page14）静态资源伺服', () => {
  let staticServer: LocalServer;
  let staticBase: string;

  beforeAll(async () => {
    // 项目根 = 仓库（页面/脚本/样式走真实文件），运行时数据仍落在临时目录
    const projectPaths = createAppPaths(process.cwd(), mkdtempSync(join(tmpdir(), 'roco-page14-static-')));
    mkdirSync(projectPaths.dataDir, { recursive: true });
    staticServer = await createLocalServer(projectPaths, 0, '127.0.0.1');
    staticBase = `http://127.0.0.1:${(staticServer.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await staticServer.close();
  });

  it('页面 / 脚本 / 样式均能取到，且页面引用了脚本与样式', async () => {
    const page = await fetch(`${staticBase}/roco-pvp-page14.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('/scripts/page14-display.js');
    expect(html).toContain('/styles/roco-pvp-page14.css');

    const script = await fetch(`${staticBase}/scripts/page14-display.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("query: { role: 'page14' }");

    const style = await fetch(`${staticBase}/styles/roco-pvp-page14.css`);
    expect(style.status).toBe(200);
    expect(await style.text()).toContain('.page14-board');
  });
});

describe('晋级积分榜（page14）socket 角色', () => {
  it('page14 只收自己的快照字段，不含比赛库大载荷', async () => {
    const client = connectRole('page14');
    const snapshot = await new Promise<any>((resolve) => client.once('snapshot', resolve));
    try {
      expect(snapshot.page14).toBeTruthy();
      expect(snapshot.page14.tournamentId).toBe(tournamentId);
      expect(snapshot.store).toBeUndefined();
      expect(snapshot.panels).toBeUndefined();
      expect(snapshot.tournaments).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it('POST /api/page14 广播 page14:update；比赛变化也投给 page14（榜单要实时刷新）', async () => {
    const client = connectRole('page14');
    await waitConnected(client);
    const updates: unknown[] = [];
    const matchEvents: unknown[] = [];
    client.on('page14:update', (payload) => updates.push(payload));
    client.on('matches:update', (payload) => matchEvents.push(payload));

    try {
      await post('/api/page14', { title: '榜单标题' });
      await vi.waitFor(() => expect(updates.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

      await post('/api/matches', { leftPlayer: '甲', rightPlayer: '乙' });
      await vi.waitFor(() => expect(matchEvents.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    } finally {
      client.close();
    }
  });
});
