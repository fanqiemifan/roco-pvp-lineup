import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let server: LocalServer;
let base: string;
let paths: AppPaths;
let socket: Socket;
/** matches:update 事件计数（批量写入应只广播一次） */
let matchUpdates = 0;
let tournamentId = '';
let matchA = '';
let matchB = '';

/** 精灵库夹具：pets.json 索引 + spritesDir 对应文件（缺图条目不收录） */
function writeSpriteLibrary(): void {
  writeFileSync(
    join(paths.dataDir, 'pets.json'),
    JSON.stringify({
      items: [
        { pet_id: '1001', name: '暮星辰', handbook_no: 1 },
        { pet_id: '2001', name: '怖哭菇', handbook_no: 2 },
      ],
    }),
    'utf-8',
  );
  for (const filename of ['1001_暮星辰.png', '2001_怖哭菇.png']) {
    writeFileSync(join(paths.spritesDir, filename), 'png');
  }
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
const getJson = (pathname: string) => requestJson('GET', pathname);

/** 等待 socket 事件投递完成 */
async function flushEvents(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-lineup-import-http-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.spritesDir, { recursive: true });
  writeSpriteLibrary();
  saveRuntimeConfig(paths, { machineCode: 'A' });

  // 不传 authConfig = 鉴权关闭
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;

  socket = ioClient(base);
  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  socket.on('matches:update', () => {
    matchUpdates += 1;
  });

  // 4 人系列赛开赛 → 首波 2 场「待开始」对局
  for (let index = 0; index < 4; index += 1) {
    savePlayerProfile(paths, { id: `p${index}`, name: `选手${index}` });
  }
  const created = (
    await postJson('/api/tournaments', { name: '回填杯', playerIds: ['p0', 'p1', 'p2', 'p3'], seed: 5 })
  ).data.tournament;
  tournamentId = created.id;
  await postJson(`/api/tournaments/${tournamentId}/start`);
  const matches = (await getJson('/api/matches')).data.matches.filter(
    (match: { tournamentRef?: { tournamentId: string } }) => match.tournamentRef?.tournamentId === tournamentId,
  );
  expect(matches).toHaveLength(2);
  matchA = matches[0].id;
  matchB = matches[1].id;
});

afterAll(async () => {
  socket.close();
  await server.close();
});

describe('POST /api/tournaments/:id/lineup-import（dryRun 预览）', () => {
  it('逐格解析：常用名 / pet_id 前缀 / 未匹配，未匹配给场次级原因', async () => {
    const { status, data } = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      dryRun: true,
      rows: [
        {
          matchId: matchA,
          left: ['暮星辰', '2001 怖哭菇', '不存在的精灵'],
          right: ['1001 暮星辰'],
        },
      ],
    });

    expect(status).toBe(200);
    const row = data.rows[0];
    expect(row.matchId).toBe(matchA);
    expect(row.ok).toBe(false);
    expect(row.reason).toContain('未匹配');
    expect(row.left[0]).toMatchObject({ matched: true, matchType: 'exact-name' });
    expect(row.left[0].sprite.id).toBe('1001');
    expect(row.left[1]).toMatchObject({ matched: true, matchType: 'exact-pet-id' });
    expect(row.left[2].matched).toBe(false);
    expect(row.right[0]).toMatchObject({ matched: true, matchType: 'exact-pet-id' });
    expect(row.right[0].sprite.id).toBe('1001');
  });

  it('全部匹配 → ok=true；同场两格多候选时给出候选列表（不阻断）', async () => {
    const { data } = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      dryRun: true,
      rows: [
        { matchId: matchA, left: ['暮星辰'], right: ['怖哭菇'] },
        { matchId: matchB, left: [], right: null },
      ],
    });

    expect(data.rows[0].ok).toBe(true);
    expect(data.rows[0].reason).toBeUndefined();
    expect(data.rows[1].ok).toBe(false);
    expect(data.rows[1].reason).toBe('两侧均无阵容');
  });
});

describe('POST /api/tournaments/:id/lineup-import（写入）', () => {
  it('批量写入第 1 局：对局级原子、单侧 null 不写、一次 matches:update 广播', async () => {
    const before = matchUpdates;
    const { status, data } = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      rows: [
        { matchId: matchA, left: ['1001', '2001'], right: ['2001'] },
        { matchId: matchB, left: ['1001'], right: null },
      ],
    });

    expect(status).toBe(200);
    expect(data.results).toEqual([
      { matchId: matchA, ok: true },
      { matchId: matchB, ok: true },
    ]);

    await flushEvents();
    expect(matchUpdates).toBe(before + 1);

    const matches = (await getJson('/api/matches')).data.matches;
    const a = matches.find((match: { id: string }) => match.id === matchA);
    expect(a.games[0].leftSlots[0]).toMatchObject({ pet_id: '1001', name: '暮星辰' });
    expect(a.games[0].leftSlots[1]).toMatchObject({ pet_id: '2001', name: '怖哭菇' });
    expect(a.games[0].leftSlots[2].pet_id).toBeNull();
    expect(a.games[0].leftLineup).toEqual(['1001', '2001']);
    expect(a.games[0].rightSlots[0].pet_id).toBe('2001');
    expect(a.games[0].rightLineup).toEqual(['2001']);

    // 单侧 null：右侧保持原样（空阵容）
    const b = matches.find((match: { id: string }) => match.id === matchB);
    expect(b.games[0].leftLineup).toEqual(['1001']);
    expect(b.games[0].rightLineup).toEqual([]);
  });

  it('重复导入同一份表：幂等（结果一致，非空侧覆盖）', async () => {
    const { data } = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      rows: [{ matchId: matchB, left: ['1001'], right: null }],
    });
    expect(data.results[0]).toMatchObject({ ok: true });
    const match = (await getJson('/api/matches')).data.matches.find(
      (item: { id: string }) => item.id === matchB,
    );
    expect(match.games[0].leftLineup).toEqual(['1001']);
  });
});

describe('POST /api/tournaments/:id/lineup-import（拒绝路径）', () => {
  it('对局不存在 / 非本系列赛 / 无效精灵 / 系列赛不存在', async () => {
    // 普通对局（无 tournamentRef）
    await postJson('/api/matches', { leftPlayer: '路人甲', rightPlayer: '路人乙', bestOf: 1 });
    const plain = (await getJson('/api/matches')).data.matches.find(
      (match: { leftPlayer: string }) => match.leftPlayer === '路人甲',
    );
    expect(plain).toBeTruthy();

    const preview = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      dryRun: true,
      rows: [
        { matchId: '20260101_A999', left: ['1001'] },
        { matchId: plain.id, left: ['1001'] },
      ],
    });
    expect(preview.data.rows[0]).toMatchObject({ ok: false, reason: '对局不存在' });
    expect(preview.data.rows[1]).toMatchObject({ ok: false, reason: '非本系列赛对局' });

    const invalid = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      rows: [{ matchId: matchB, left: ['9999'] }],
    });
    expect(invalid.data.results[0].ok).toBe(false);
    expect(invalid.data.results[0].reason).toContain('未知精灵');

    const missing = await postJson('/api/tournaments/T20260101_A99/lineup-import', {
      rows: [{ matchId: matchA, left: ['1001'] }],
    });
    expect(missing.status).toBe(404);

    const empty = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      rows: [],
    });
    expect(empty.status).toBe(400);
  });

  it('已开赛的比赛整场拒绝：该场已开赛', async () => {
    // matchA 已录好双方阵容，开始对局后状态变为进行中
    await postJson(`/api/matches/${matchA}/start`);

    const { data } = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      dryRun: true,
      rows: [{ matchId: matchA, left: ['1001'] }],
    });
    expect(data.rows[0].ok).toBe(false);
    expect(data.rows[0].reason).toContain('已开赛');

    const write = await postJson(`/api/tournaments/${tournamentId}/lineup-import`, {
      rows: [{ matchId: matchA, left: ['1001'] }],
    });
    expect(write.data.results[0].ok).toBe(false);
    expect(write.data.results[0].reason).toContain('已开赛');
  });
});