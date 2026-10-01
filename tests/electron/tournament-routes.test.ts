import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { updateMatch } from '../../electron/services/match-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import type { TournamentRecord } from '../../shared/types';

let server: LocalServer;
let base: string;
let paths: AppPaths;
let socket: Socket;
/** tournament:update 事件计数（每次写操作都应广播） */
let tournamentUpdates = 0;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-tournament-http-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });

  // 不传 authConfig = 鉴权关闭
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;

  socket = ioClient(base);
  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  socket.on('tournament:update', () => {
    tournamentUpdates += 1;
  });
});

afterAll(async () => {
  socket.close();
  await server.close();
});

/** 建立 n 名档案选手，返回 id 列表 */
function seedPlayers(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    savePlayerProfile(paths, { id: `p${i}`, name: `选手${i}` });
    ids.push(`p${i}`);
  }
  return ids;
}

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
const patchJson = (pathname: string, body?: unknown) => requestJson('PATCH', pathname, body);
const putJson = (pathname: string, body?: unknown) => requestJson('PUT', pathname, body);
const deleteJson = (pathname: string, body?: unknown) => requestJson('DELETE', pathname, body ?? {});
const getJson = (pathname: string) => requestJson('GET', pathname);

/** 等待 socket 事件投递完成（广播在响应前发出，但客户端回调可能略晚于 fetch 解析） */
async function flushEvents(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** 经 HTTP 打完一场（自动适配 BO1/BO3）：录阵容 → 开始 → 登记胜负，循环到 completed */
async function playMatchHttp(matchId: string, winnerSide: 'left' | 'right'): Promise<void> {
  let guard = 0;
  while (true) {
    const { data } = await getJson('/api/matches');
    const match = data.matches.find((item: { id: string }) => item.id === matchId);
    if (match.status === 'completed') {
      return;
    }
    const game = match.games.find((item: { status: string }) => item.status === 'pending');
    await postJson(`/api/matches/${matchId}/games/${game.gameNumber}/lineup`, {
      selections: { left: [{ sprite: '3001' }], right: [{ sprite: '3002' }] },
    });
    await postJson(`/api/matches/${matchId}/start`);
    await postJson(`/api/matches/${matchId}/winner`, { winner: winnerSide });
    guard += 1;
    if (guard > 10) {
      throw new Error('比赛无法收敛');
    }
  }
}

/** 经 HTTP 打完一整届（随机胜者） */
async function runWholeHttp(tournamentId: string): Promise<TournamentRecord> {
  let guard = 0;
  while (true) {
    const { data } = await getJson(`/api/tournaments/${tournamentId}`);
    if (data.tournament.status === 'completed') {
      return data.tournament;
    }
    const matches = (await getJson('/api/matches')).data.matches.filter(
      (match: { status: string; tournamentRef?: { tournamentId: string } }) =>
        match.status === 'pending' && match.tournamentRef?.tournamentId === tournamentId,
    );
    if (!matches.length) {
      throw new Error('系列赛卡死：无待开始比赛');
    }
    await playMatchHttp(matches[0].id, Math.random() < 0.5 ? 'left' : 'right');
    guard += 1;
    if (guard > 200) {
      throw new Error('系列赛无法收敛');
    }
  }
}

describe('GET /api/tournaments', () => {
  it('初始为空列表', async () => {
    const { status, data } = await getJson('/api/tournaments');
    expect(status).toBe(200);
    expect(data.tournaments).toEqual([]);
  });
});

describe('POST /api/tournaments', () => {
  it('合法创建：200 + setup 草稿 + 广播 tournament:update', async () => {
    const updatesBefore = tournamentUpdates;
    const playerIds = seedPlayers(8);
    const { status, data } = await postJson('/api/tournaments', {
      name: '星空杯S1',
      playerIds,
      seed: 42,
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.tournament.status).toBe('setup');
    expect(data.tournament.id).toMatch(/^T\d{8}_A\d{2}$/);
    await flushEvents();
    expect(tournamentUpdates).toBe(updatesBefore + 1);
  });

  it('非法人数 / 未知档案 / 重复选手：400 拒绝且不广播', async () => {
    await flushEvents();
    const ids = seedPlayers(8);
    const updatesBefore = tournamentUpdates;
    expect((await postJson('/api/tournaments', { name: '杯', playerIds: ids.slice(0, 3) })).status).toBe(400);
    expect((await postJson('/api/tournaments', {
      name: '杯',
      playerIds: [ids[0], ids[1], ids[2], 'unknown-x'],
    })).status).toBe(400);
    expect((await postJson('/api/tournaments', {
      name: '杯',
      playerIds: [ids[0], ids[0], ids[1], ids[2]],
    })).status).toBe(400);
    // 总决赛（只剩 2 人的阶段）为双败：400 拒绝且不广播
    const finalDoubleLife = await postJson('/api/tournaments', {
      name: '杯',
      playerIds: ids.slice(0, 4),
      stages: [
        { name: '4进2', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
        { name: '总决赛', format: 'double-life', bestOf: 3, pairing: 'random-bucket' },
      ],
    });
    expect(finalDoubleLife.status).toBe(400);
    expect(finalDoubleLife.data.error).toMatch(/总决赛阶段必须为单败/);
    await flushEvents();
    expect(tournamentUpdates).toBe(updatesBefore);
  });
});

describe('开赛 + 完整届（事件驱动建场）', () => {
  it('POST start：200，自动锁定 W1 并建场，GET 详情可查', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', { name: '自动杯', playerIds, seed: 7 })).data.tournament;
    const { status, data } = await postJson(`/api/tournaments/${created.id}/start`);
    expect(status).toBe(200);
    expect(data.tournament.status).toBe('running');
    expect(data.tournament.waves[0].nodes).toHaveLength(4);
    expect((await getJson('/api/matches')).data.matches).toHaveLength(4);

    const detail = await getJson(`/api/tournaments/${created.id}`);
    expect(detail.data.tournament.waves[0].status).toBe('running');
  });

  it('打完一整届：冠军产生、status completed、每步都有 tournament:update 广播', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', { name: '全程杯', playerIds, seed: 99 })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    const finalRecord = await runWholeHttp(created.id);
    expect(finalRecord.status).toBe('completed');
    expect(finalRecord.result?.championId).toBeTruthy();
    expect(finalRecord.result?.championId).not.toBe(finalRecord.result?.runnerUpId);
    // 至少在创建/开赛/波次推进处收到广播
    await flushEvents();
    expect(tournamentUpdates).toBeGreaterThan(3);
  }, 60000);
});

describe('GET /api/tournaments/:id/opening-wave（只读首波预览）', () => {
  it('setup 返回首波配对且不建场；开赛后与 W1 节点一致；非 setup 返回 400', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', { name: '预览杯', playerIds, seed: 11 })).data.tournament;

    const preview = await getJson(`/api/tournaments/${created.id}/opening-wave`);
    expect(preview.status).toBe(200);
    expect(preview.data.pairs).toHaveLength(4);
    expect(preview.data.pairs.every((item: { pair: unknown[] }) => item.pair[0] && item.pair[1])).toBe(true);

    // 只读：本系列赛未建场、未开赛（比赛库是文件级共享，只看本系列赛的对局）
    await flushEvents();
    const matchesAfter = (await getJson('/api/matches')).data.matches as
      Array<{ tournamentRef?: { tournamentId: string } }>;
    expect(matchesAfter.filter((match) => match.tournamentRef?.tournamentId === created.id)).toHaveLength(0);
    expect((await getJson(`/api/tournaments/${created.id}`)).data.tournament.status).toBe('setup');

    await postJson(`/api/tournaments/${created.id}/start`);
    const detail = await getJson(`/api/tournaments/${created.id}`);
    expect(detail.data.tournament.waves[0].nodes.map(
      (node: { playerAId: string; playerBId: string }) => [node.playerAId, node.playerBId],
    )).toEqual(preview.data.pairs.map((item: { pair: unknown[] }) => item.pair));

    expect((await getJson(`/api/tournaments/${created.id}/opening-wave`)).status).toBe(400);
    expect((await getJson('/api/tournaments/T20260929_A99/opening-wave')).status).toBe(400);
  });
});

describe('配对确认台（手动配对 HTTP 流程）', () => {
  it('draft → PUT 暂存 → lock 锁定建场', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', {
      name: '手动杯',
      playerIds,
      seed: 5,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);

    // 系统已预填随机草稿：直接锁定（同环境有累积，断言增量）
    const matchesBefore = (await getJson('/api/matches')).data.matches.length;
    const { status, data } = await postJson(`/api/tournaments/${created.id}/waves/0/pairings/lock`, {});
    expect(status).toBe(200);
    expect(data.tournament.waves[0].pairingStatus).toBe('locked');
    expect((await getJson('/api/matches')).data.matches).toHaveLength(matchesBefore + 4);
  });

  it('PUT 暂存非法草稿后 lock：400', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', {
      name: '错误杯',
      playerIds,
      seed: 5,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    // 只配一对（其余漏配）
    await putJson(`/api/tournaments/${created.id}/waves/0/pairings`, {
      pairings: [{ bucketKey: '0-0', pair: ['p0', 'p1'] }],
    });
    const { status } = await postJson(`/api/tournaments/${created.id}/waves/0/pairings/lock`, {});
    expect(status).toBe(400);
  });

  it('advance 手动配对波：400（提示走确认台）', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', {
      name: '手动杯2',
      playerIds,
      seed: 5,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    expect((await postJson(`/api/tournaments/${created.id}/advance`)).status).toBe(400);
  });
});

describe('rollback-wave（管理级回退）', () => {
  it('回退最后未打波：200，比赛删除、波次减少并广播', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', { name: '回退杯', playerIds, seed: 11 })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    // W1 打完（4 场 BO1）→ W2 自动锁定 pending
    const w1Matches = (await getJson('/api/matches')).data.matches;
    for (const match of w1Matches) {
      await playMatchHttp(match.id, 'left');
    }
    const beforeRollback = (await getJson(`/api/tournaments/${created.id}`)).data.tournament;
    expect(beforeRollback.waves).toHaveLength(2);

    const updatesBefore = tournamentUpdates;
    const { status, data } = await postJson(`/api/tournaments/${created.id}/rollback-wave`);
    expect(status).toBe(200);
    expect(data.tournament.waves).toHaveLength(1);
    await flushEvents();
    expect(tournamentUpdates).toBe(updatesBefore + 1);
  }, 30000);

  it('无波可回退：400', async () => {
    const playerIds = seedPlayers(4);
    const created = (await postJson('/api/tournaments', { name: '空杯', playerIds, seed: 1 })).data.tournament;
    expect((await postJson(`/api/tournaments/${created.id}/rollback-wave`)).status).toBe(400);
  });
});

describe('POST /api/matches/:matchId/undo（系列赛对局撤回）', () => {
  it('后续波已有赛果：400 拒绝，且比赛未被撤回（不留「比赛撤了、系列赛没撤」的半吊子状态）', async () => {
    const playerIds = seedPlayers(4);
    const created = (await postJson('/api/tournaments', {
      name: '撤回一致性杯',
      playerIds,
      seed: 42,
      stages: [
        { name: '4进2', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
        { name: '总决赛', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
      ],
    })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);

    const matchesOf = async (stageIndex?: number) =>
      (await getJson('/api/matches')).data.matches.filter(
        (match: { tournamentRef?: { tournamentId: string; stageIndex: number } }) =>
          match.tournamentRef?.tournamentId === created.id
          && (stageIndex === undefined || match.tournamentRef?.stageIndex === stageIndex),
      );

    const s0Matches = await matchesOf(0);
    for (const match of s0Matches) {
      await playMatchHttp(match.id, 'left');
    }
    // 打完总决赛 → 系列赛完赛（后续波已有赛果，不能再自动丢弃）
    const finalMatch = (await matchesOf(1))[0];
    await playMatchHttp(finalMatch.id, 'left');

    const s0MatchId = s0Matches[0].id;
    const { status, data } = await postJson(`/api/matches/${s0MatchId}/undo`);
    expect(status).toBe(400);
    expect(data.error).toMatch(/回退上一波/);

    const after = (await getJson('/api/matches')).data.matches.find(
      (match: { id: string }) => match.id === s0MatchId,
    );
    expect(after.status).toBe('completed');
    expect((await getJson(`/api/tournaments/${created.id}`)).data.tournament.status).toBe('completed');
  }, 30000);
});

describe('删除保护', () => {
  it('系列赛关联比赛 DELETE：400 拒绝', async () => {
    const playerIds = seedPlayers(4);
    const created = (await postJson('/api/tournaments', { name: '保护杯', playerIds, seed: 1 })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    const matchId = (await getJson('/api/matches')).data.matches[0].id;
    const response = await fetch(`${base}/api/matches/${matchId}`, { method: 'DELETE' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/回退/);
  });
});

describe('DELETE /api/tournaments/:id（删除系列赛）', () => {
  it('默认：200，系列赛删除、关联对局保留但解除关联，并广播', async () => {
    const playerIds = seedPlayers(4);
    const created = (await postJson('/api/tournaments', { name: '解绑杯', playerIds, seed: 1 })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    const related = (await getJson('/api/matches')).data.matches.filter(
      (match: { tournamentRef?: { tournamentId: string } }) =>
        match.tournamentRef?.tournamentId === created.id,
    );
    expect(related.length).toBeGreaterThan(0);
    const matchesBefore = (await getJson('/api/matches')).data.matches.length;

    const updatesBefore = tournamentUpdates;
    const { status, data } = await deleteJson(`/api/tournaments/${created.id}`);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.matchesDeleted).toBe(false);
    expect(data.matchIds).toHaveLength(related.length);
    await flushEvents();
    expect(tournamentUpdates).toBe(updatesBefore + 1);

    expect((await getJson(`/api/tournaments/${created.id}`)).status).toBe(404);
    const matchesAfter = (await getJson('/api/matches')).data.matches;
    expect(matchesAfter).toHaveLength(matchesBefore);
    const stillRelated = matchesAfter.filter(
      (match: { id: string; tournamentRef?: { tournamentId: string } }) =>
        data.matchIds.includes(match.id) && match.tournamentRef,
    );
    expect(stillRelated).toEqual([]);
  });

  it('deleteMatches=true：关联对局一并删除（比赛库数量下降）', async () => {
    const playerIds = seedPlayers(4);
    const created = (await postJson('/api/tournaments', { name: '连删杯', playerIds, seed: 1 })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    const relatedCount = (await getJson('/api/matches')).data.matches.filter(
      (match: { tournamentRef?: { tournamentId: string } }) =>
        match.tournamentRef?.tournamentId === created.id,
    ).length;
    const matchesBefore = (await getJson('/api/matches')).data.matches.length;

    const { status, data } = await deleteJson(`/api/tournaments/${created.id}`, { deleteMatches: true });
    expect(status).toBe(200);
    expect(data.matchesDeleted).toBe(true);
    expect(data.matchIds).toHaveLength(relatedCount);
    expect((await getJson('/api/matches')).data.matches).toHaveLength(matchesBefore - relatedCount);
  });

  it('系列赛不存在：400', async () => {
    const { status } = await deleteJson('/api/tournaments/T20260928_A99');
    expect(status).toBe(400);
  });
});

describe('forfeit（弃权判负）', () => {
  it('pending 系列赛比赛弃权：200，比赛 completed 并写回节点', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', { name: '弃权杯', playerIds, seed: 2 })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    const matchId = (await getJson('/api/matches')).data.matches[0].id;
    const { status, data } = await postJson(`/api/tournaments/${created.id}/forfeit`, {
      matchId,
      loserSide: 'right',
    });
    expect(status).toBe(200);
    const match = (await getJson('/api/matches')).data.matches.find((item: { id: string }) => item.id === matchId);
    expect(match.status).toBe('completed');
    expect(match.tags).toContain('弃权');
    expect(data.tournament.waves[0].nodes.find((n: { matchId: string }) => n.matchId === matchId).winnerId).toBeTruthy();
  });

  it('跨系列赛 matchId / 非系列赛比赛：400', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', { name: '杯A', playerIds, seed: 2 })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    const foreignId = (await getJson('/api/matches')).data.matches[0].id;

    const second = (await postJson('/api/tournaments', { name: '杯B', playerIds, seed: 3 })).data.tournament;
    const { status } = await postJson(`/api/tournaments/${second.id}/forfeit`, {
      matchId: foreignId,
      loserSide: 'left',
    });
    expect(status).toBe(400);
  });
});

describe('鉴权：系列赛管理路由受保护', () => {
  it('开启鉴权后 GET/POST /api/tournaments 返回 401', async () => {
    const authRoot = mkdtempSync(join(tmpdir(), 'roco-tournament-auth-'));
    const authPaths = createAppPaths(authRoot, authRoot);
    mkdirSync(authPaths.dataDir, { recursive: true });
    const authServer = await createLocalServer(authPaths, 0, '127.0.0.1', {
      username: 'admin',
      password: 'admin123',
    });
    const authPort = (authServer.server.address() as AddressInfo).port;
    const authBase = `http://127.0.0.1:${authPort}`;

    const getResponse = await fetch(`${authBase}/api/tournaments`);
    expect(getResponse.status).toBe(401);
    const postResponse = await fetch(`${authBase}/api/tournaments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '杯', playerIds: [] }),
    });
    expect(postResponse.status).toBe(401);

    await authServer.close();
  });
});

describe('本机移除 / 恢复（localOnly）', () => {
  it('移除 → 列表隐藏 → 恢复：路由顺序、幂等、广播载荷与归属闸门', async () => {
    const playerIds = seedPlayers(8);
    const created = (await postJson('/api/tournaments', { name: '本机移除杯', playerIds, seed: 42 })).data.tournament;
    // 模拟分控端视角：本机码改为 B（A 编排的系列赛变成只读副本）
    saveRuntimeConfig(paths, { machineCode: 'B' });
    const payloads: Array<{ locallyRemoved?: Array<{ id: string }> }> = [];
    const onUpdate = (payload: { locallyRemoved?: Array<{ id: string }> }) => payloads.push(payload);
    socket.on('tournament:update', onUpdate);
    try {
      // 归属闸门：本机码 B 下新建的系列赛归本机 → 拒绝本机移除（提示走真删除）
      const ownedHere = (await postJson('/api/tournaments', { name: '本机杯', playerIds, seed: 7 })).data.tournament;
      const rejected = await postJson(`/api/tournaments/${ownedHere.id}/local-remove`);
      expect(rejected.status).toBe(400);
      expect(String(rejected.data.error)).toContain('本机编排');

      // 移除 A 编排的系列赛：立即从列表隐藏
      const removed = await postJson(`/api/tournaments/${created.id}/local-remove`);
      expect(removed.status).toBe(200);
      expect(removed.data.changed).toBe(true);

      // 路由注册顺序：GET /local-removed 不会被 GET /:tournamentId 吃掉
      const list = await getJson('/api/tournaments');
      expect(list.data.tournaments.some((item: { id: string }) => item.id === created.id)).toBe(false);
      const removedList = await getJson('/api/tournaments/local-removed');
      expect(removedList.status).toBe(200);
      expect(removedList.data.tournaments.map((item: { id: string }) => item.id)).toContain(created.id);

      // 幂等：重复移除成功但不再写盘
      const again = await postJson(`/api/tournaments/${created.id}/local-remove`);
      expect(again.status).toBe(200);
      expect(again.data.changed).toBe(false);

      // 广播载荷带 locallyRemoved（admin 收全量）→ 其他标签页 / 恢复列表即时刷新
      await flushEvents();
      const latest = payloads[payloads.length - 1];
      expect(latest?.locallyRemoved?.some((item) => item.id === created.id)).toBe(true);

      // 恢复：立即重新可见，恢复列表清空对应项
      const restored = await postJson(`/api/tournaments/${created.id}/local-restore`);
      expect(restored.status).toBe(200);
      expect(restored.data.tournament.id).toBe(created.id);
      expect((await getJson('/api/tournaments')).data.tournaments.some((item: { id: string }) => item.id === created.id)).toBe(true);
      expect((await getJson('/api/tournaments/local-removed')).data.tournaments.some((item: { id: string }) => item.id === created.id)).toBe(false);

      // 非本机移除的记录不可恢复
      const wrongRestore = await postJson(`/api/tournaments/${created.id}/local-restore`);
      expect(wrongRestore.status).toBe(400);
    } finally {
      socket.off('tournament:update', onUpdate);
      saveRuntimeConfig(paths, { machineCode: 'A' });
    }
  });
});

describe('系列赛对局的选手名 / 赛制保护（赛事面板改不动，且登记前先校验）', () => {
  /** 建一届 4 人单败（BO1，单局即可完赛）并开赛，返回首个对局与它对应的节点 */
  async function startFourPlayerTournament(name: string, seed: number) {
    const playerIds = seedPlayers(4);
    const created = (await postJson('/api/tournaments', {
      name,
      playerIds,
      seed,
      stages: [
        { name: '4进2', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
        { name: '总决赛', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
      ],
    })).data.tournament;
    await postJson(`/api/tournaments/${created.id}/start`);
    const match = (await getJson('/api/matches')).data.matches.find(
      (item: { tournamentRef?: { tournamentId: string } }) => item.tournamentRef?.tournamentId === created.id,
    );
    const record = (await getJson(`/api/tournaments/${created.id}`)).data.tournament;
    const node = record.waves[0].nodes.find((item: { matchId: string }) => item.matchId === match.id);
    return { created, match, node };
  }

  it('PATCH 改选手名 / 赛制：400 且落盘不变；战队与排位排名仍可改', async () => {
    const { match } = await startFourPlayerTournament('字段守卫杯', 21);

    const renamed = await patchJson(`/api/matches/${match.id}`, { leftPlayer: '乱改的名字' });
    expect(renamed.status).toBe(400);
    expect(String(renamed.data.error)).toContain('左侧选手');
    const reBestOf = await patchJson(`/api/matches/${match.id}`, { bestOf: 7 });
    expect(reBestOf.status).toBe(400);
    expect(String(reBestOf.data.error)).toContain('比赛赛制');

    const untouched = (await getJson('/api/matches')).data.matches.find((item: { id: string }) => item.id === match.id);
    expect(untouched.leftPlayer).toBe(match.leftPlayer);
    expect(untouched.bestOf).toBe(match.bestOf);

    // 原样回填（赛事面板保存战队 / 排名时也会带上这三个字段）+ 改排名：放行
    const ok = await patchJson(`/api/matches/${match.id}`, {
      leftPlayer: match.leftPlayer,
      rightPlayer: match.rightPlayer,
      bestOf: match.bestOf,
      leftRank: '99',
    });
    expect(ok.status).toBe(200);
    expect(ok.data.store.matches.find((item: { id: string }) => item.id === match.id).leftRank).toBe('99');
  });

  it('节点选手档案被删：登记胜负 400，且比分不落盘（不留「半吊子」状态）', async () => {
    const { match, node } = await startFourPlayerTournament('档案缺失杯', 22);
    await deleteJson(`/api/profiles/players/${node.playerAId}`);

    await postJson(`/api/matches/${match.id}/games/1/lineup`, {
      selections: { left: [{ sprite: '3001' }], right: [{ sprite: '3002' }] },
    });
    await postJson(`/api/matches/${match.id}/start`);
    const registered = await postJson(`/api/matches/${match.id}/winner`, { winner: 'left' });
    expect(registered.status).toBe(400);
    expect(String(registered.data.error)).toContain('选手档案已不存在');

    const after = (await getJson('/api/matches')).data.matches.find((item: { id: string }) => item.id === match.id);
    expect(after.status).toBe('in_progress');
    expect(after.games[0].winner).toBeNull();
  });

  it('信息录入改名：自动回写对局名字快照，登记胜负照常写回对阵图', async () => {
    const { created, match, node } = await startFourPlayerTournament('改名回写杯', 23);
    const newName = `${match.leftPlayer}·新`;

    const saved = await postJson('/api/profiles/players', { id: node.playerAId, name: newName });
    expect(saved.status).toBe(200);
    const healed = (await getJson('/api/matches')).data.matches.find((item: { id: string }) => item.id === match.id);
    expect(healed.leftPlayer).toBe(newName);

    await playMatchHttp(match.id, 'left');
    const record = (await getJson(`/api/tournaments/${created.id}`)).data.tournament;
    expect(record.waves[0].nodes.find((item: { id: string }) => item.id === node.id).winnerId).toBe(node.playerAId);
  });

  it('历史遗留的名字不一致（加限制前改坏的脏数据）：登记前自愈后照常写回', async () => {
    const { created, match, node } = await startFourPlayerTournament('脏数据杯', 24);
    // 绕过路由守卫直接改服务层，模拟「加限制之前」被改坏的对局
    updateMatch(paths, match.id, { leftPlayer: '历史脏数据' });
    expect((await getJson('/api/matches')).data.matches.find(
      (item: { id: string }) => item.id === match.id,
    ).leftPlayer).toBe('历史脏数据');

    await postJson(`/api/matches/${match.id}/games/1/lineup`, {
      selections: { left: [{ sprite: '3001' }], right: [{ sprite: '3002' }] },
    });
    await postJson(`/api/matches/${match.id}/start`);
    const registered = await postJson(`/api/matches/${match.id}/winner`, { winner: 'right' });
    expect(registered.status).toBe(200);

    const healed = (await getJson('/api/matches')).data.matches.find((item: { id: string }) => item.id === match.id);
    expect(healed.leftPlayer).not.toBe('历史脏数据');
    const record = (await getJson(`/api/tournaments/${created.id}`)).data.tournament;
    expect(record.waves[0].nodes.find((item: { id: string }) => item.id === node.id).winnerId).toBe(node.playerBId);
  });
});
