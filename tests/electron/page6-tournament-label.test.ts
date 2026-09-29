import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let server: LocalServer;
let base: string;
let paths: AppPaths;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-page6-label-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });

  // 不传 authConfig = 鉴权关闭
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

interface TournamentMatch {
  id: string;
  status: string;
  leftPlayer: string;
  rightPlayer: string;
  winner: 'left' | 'right' | null;
  tournamentRef?: { tournamentId: string; stageIndex: number; waveIndex: number };
}

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
const getJson = (pathname: string) => requestJson('GET', pathname);

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

/** 该系列赛的全部比赛（可按阶段过滤） */
async function tournamentMatches(tournamentId: string, stageIndex?: number): Promise<TournamentMatch[]> {
  const { data } = await getJson('/api/matches');
  return (data.matches as TournamentMatch[]).filter(
    (match) => match.tournamentRef?.tournamentId === tournamentId
      && (stageIndex === undefined || match.tournamentRef.stageIndex === stageIndex),
  );
}

/** 当前待开始对局（自动建场后即下一波/下一阶段） */
async function pendingMatches(tournamentId: string): Promise<TournamentMatch[]> {
  return (await tournamentMatches(tournamentId)).filter((match) => match.status === 'pending');
}

/** 把某批比赛设为 page6 展示清单（需已完成）并回读标签映射 */
async function page6Labels(matchIds: string[]): Promise<Record<string, string>> {
  const saved = await postJson('/api/page6', { matchIds });
  expect(saved.status).toBe(200);
  const { data } = await getJson('/api/page6');
  return data.tournamentLabels as Record<string, string>;
}

/** 依次打完一批比赛（默认全部左侧取胜） */
async function playAll(matches: TournamentMatch[]): Promise<void> {
  for (const match of matches) {
    await playMatchHttp(match.id, 'left');
  }
}

describe('page6 系列赛阶段标注', () => {
  it(
    '8进4 双败三波 + 单败阶段：首轮/胜者组/败者组/决胜轮/纯阶段名；普通对局无标注、page6/page8 同口径',
    async () => {
      const playerIds = seedPlayers(8);
      const created = (await postJson('/api/tournaments', { name: '标注杯', playerIds, seed: 21 })).data.tournament;
      expect((await postJson(`/api/tournaments/${created.id}/start`)).status).toBe(200);

      // W1 首轮：4 场 → 「8进4·首轮」
      const w1 = await pendingMatches(created.id);
      expect(w1).toHaveLength(4);
      await playAll(w1);
      const w1Labels = await page6Labels(w1.map((match) => match.id));
      w1.forEach((match) => expect(w1Labels[match.id]).toBe('8进4·首轮'));

      // W1 胜负名单（用于校验 W2 池归属）
      const w1Done = (await tournamentMatches(created.id)).filter(
        (match) => match.status === 'completed' && match.tournamentRef?.waveIndex === 1,
      );
      const w1Winners = new Set(
        w1Done.map((match) => (match.winner === 'left' ? match.leftPlayer : match.rightPlayer)),
      );
      const w1Losers = new Set(
        w1Done.map((match) => (match.winner === 'left' ? match.rightPlayer : match.leftPlayer)),
      );

      // W2 胜者组（1-0 池，双方均为首轮胜者）/ 败者组（0-1 池，双方均为首轮败者）：各 2 场
      const w2 = await pendingMatches(created.id);
      expect(w2).toHaveLength(4);
      // W2 待开始：page8（比赛预告）与 page6 同口径下发系列赛语义标签
      expect((await postJson('/api/page8', { matchIds: [w2[0].id] })).status).toBe(200);
      const page8Labels = (await getJson('/api/page8')).data.tournamentLabels as Record<string, string>;
      expect(['8进4·胜者组', '8进4·败者组']).toContain(page8Labels[w2[0].id]);
      await playAll(w2);
      const w2Labels = await page6Labels(w2.map((match) => match.id));
      for (const match of w2) {
        const label = w2Labels[match.id];
        const both = [match.leftPlayer, match.rightPlayer];
        if (label === '8进4·胜者组') {
          both.forEach((name) => expect(w1Winners.has(name)).toBe(true));
        } else {
          expect(label).toBe('8进4·败者组');
          both.forEach((name) => expect(w1Losers.has(name)).toBe(true));
        }
      }
      const w2LabelValues = w2.map((match) => w2Labels[match.id]);
      expect(w2LabelValues.filter((label) => label === '8进4·胜者组')).toHaveLength(2);
      expect(w2LabelValues.filter((label) => label === '8进4·败者组')).toHaveLength(2);

      // W3 决胜轮（1-1 池交叉）：2 场
      const w3 = await pendingMatches(created.id);
      expect(w3).toHaveLength(2);
      await playAll(w3);
      const w3Labels = await page6Labels(w3.map((match) => match.id));
      w3.forEach((match) => expect(w3Labels[match.id]).toBe('8进4·决胜轮'));

      // 4进2（单败）：只显示阶段名
      const semi = await pendingMatches(created.id);
      expect(semi).toHaveLength(2);
      await playAll(semi);
      const semiLabels = await page6Labels(semi.map((match) => match.id));
      semi.forEach((match) => expect(semiLabels[match.id]).toBe('4进2'));

      // 总决赛（单败）：只显示阶段名
      const final = await pendingMatches(created.id);
      expect(final).toHaveLength(1);
      await playAll(final);
      const finalLabels = await page6Labels(final.map((match) => match.id));
      expect(finalLabels[final[0].id]).toBe('总决赛');

      // page6 混排：普通对局无标注、系列赛对局有标注
      const normal = (await postJson('/api/matches', {
        leftPlayer: '路人甲',
        rightPlayer: '路人乙',
        bestOf: 1,
      })).data.store.matches[0] as TournamentMatch;
      await playMatchHttp(normal.id, 'left');
      const mixed = await page6Labels([normal.id, final[0].id]);
      expect(mixed[normal.id]).toBeUndefined();
      expect(mixed[final[0].id]).toBe('总决赛');

      // page8（比赛预告）与 page6 同口径下发标签：普通对局无标签（空映射）
      const preview = (await postJson('/api/matches', {
        leftPlayer: '预告甲',
        rightPlayer: '预告乙',
        bestOf: 1,
      })).data.store.matches[0] as TournamentMatch;
      expect((await postJson('/api/page8', { matchIds: [preview.id] })).status).toBe(200);
      expect((await getJson('/api/page8')).data.tournamentLabels).toEqual({});
    },
    120000,
  );
});