import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { saveRuntimeConfig } from '../../electron/services/config-service';
import {
  getMatchStore,
  recordMatchWinner,
  saveGameLineupForMatch,
  startCurrentGame,
} from '../../electron/services/match-service';
import { createAppPaths } from '../../electron/services/path-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { createTournament, startTournament } from '../../electron/services/tournament-service';
import { createLocalServer, type LocalServer } from '../../electron/socket-server';

/**
 * 推流页面15（数据统计）静态资源伺服：页面文件缺失会导致推流载体切到该页时白屏。
 * page15 无独立数据接口（复用公开的 /api/stats/ranking），因此只验证三件套与 socket 角色。
 */

describe('推流页面15（数据统计）静态资源伺服', () => {
  let staticServer: LocalServer;
  let staticBase: string;

  beforeAll(async () => {
    // 项目根 = 仓库（页面/脚本/样式走真实文件），运行时数据仍落在临时目录
    const projectPaths = createAppPaths(process.cwd(), mkdtempSync(join(tmpdir(), 'roco-page15-static-')));
    mkdirSync(projectPaths.dataDir, { recursive: true });
    staticServer = await createLocalServer(projectPaths, 0, '127.0.0.1');
    staticBase = `http://127.0.0.1:${(staticServer.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await staticServer.close();
  });

  it('页面 / 脚本 / 样式文件都存在（页面文件缺失会导致空白画面）', () => {
    const repoPaths = createAppPaths(process.cwd(), process.cwd());
    expect(existsSync(join(repoPaths.pagesDir, 'roco-pvp-page15.html'))).toBe(true);
    expect(existsSync(join(repoPaths.scriptsDir, 'page15-display.js'))).toBe(true);
    expect(existsSync(join(repoPaths.stylesDir, 'roco-pvp-page15.css'))).toBe(true);
  });

  it('页面 / 脚本 / 样式均能取到，且页面引用了脚本与样式', async () => {
    const page = await fetch(`${staticBase}/roco-pvp-page15.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('/scripts/page15-display.js');
    expect(html).toContain('/styles/roco-pvp-page15.css');
    // 数据统计页无标题，不引用 scoreboard 标题
    expect(html).not.toContain('page15Title');

    const script = await fetch(`${staticBase}/scripts/page15-display.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("query: { role: 'page15' }");

    const style = await fetch(`${staticBase}/styles/roco-pvp-page15.css`);
    expect(style.status).toBe(200);
    expect(await style.text()).toContain('.page15-avatar');
  });
});

describe('POST /api/stats/replay：数据回放推送', () => {
  let replayServer: LocalServer;
  let replayBase: string;
  let replaySeriesId: string;

  function connectPage15(): Promise<Socket> {
    const client = ioClient(replayBase, { transports: ['websocket'], query: { role: 'page15' } });
    return new Promise((resolve, reject) => {
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'roco-page15-replay-'));
    const paths = createAppPaths(root, root);
    mkdirSync(paths.dataDir, { recursive: true });
    saveRuntimeConfig(paths, { machineCode: 'A' });
    // 建 4 人系列赛并打完一小局，制造回放数据
    const playerIds = ['p0', 'p1', 'p2', 'p3'];
    for (const id of playerIds) {
      savePlayerProfile(paths, { id, name: `选手${id}` });
    }
    const record = createTournament(paths, { name: '回放杯', playerIds, seed: 42 });
    startTournament(paths, record.id);
    const match = getMatchStore(paths).matches.find(
      (item) => item.tournamentRef?.tournamentId === record.id,
    );
    if (!match) {
      throw new Error('系列赛未自动建场');
    }
    saveGameLineupForMatch(paths, match.id, 1, {
      left: [{ sprite: 'pet-a' }],
      right: [{ sprite: 'pet-b' }],
    });
    startCurrentGame(paths, match.id);
    recordMatchWinner(paths, match.id, 'left');
    replaySeriesId = record.id;

    replayServer = await createLocalServer(paths, 0, '127.0.0.1');
    replayBase = `http://127.0.0.1:${(replayServer.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await replayServer.close();
  });

  it('推送成功 → 200 且向 page15 角色广播 page15:replay 载荷', async () => {
    const client = await connectPage15();
    const events: any[] = [];
    client.on('page15:replay', (payload) => events.push(payload));
    try {
      const response = await fetch(`${replayBase}/api/stats/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournamentId: replaySeriesId, fromStage: 0, toStage: 1, speed: 'fast' }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toMatchObject({ ok: true, tournamentName: '回放杯', steps: 1 });

      await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2000 });
      expect(events[0]).toMatchObject({ tournamentName: '回放杯', speed: 'fast', fromStage: 0, toStage: 1 });
      expect(events[0].steps).toHaveLength(1);
      expect(events[0].steps[0].deltas.length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  it('未知系列赛 → 400 带错误信息且不广播', async () => {
    const client = await connectPage15();
    const events: any[] = [];
    client.on('page15:replay', (payload) => events.push(payload));
    try {
      const response = await fetch(`${replayBase}/api/stats/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournamentId: 'T19990101_A99', fromStage: 0, toStage: 1 }),
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(typeof data.error).toBe('string');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(events).toEqual([]);
    } finally {
      client.close();
    }
  });
});
