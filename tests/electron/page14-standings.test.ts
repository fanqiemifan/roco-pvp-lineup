import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { saveRuntimeConfig } from '../../electron/services/config-service';
import {
  getMatchStore,
  recordMatchWinner,
  saveGameLineupForMatch,
  startCurrentGame,
} from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import {
  createTournament,
  getTournamentStore,
  onMatchCompleted,
  resolveStageStandings,
  startTournament,
} from '../../electron/services/tournament-service';
import type { StageStandings } from '../../shared/types';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-page14-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });
});

function seedPlayers(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    savePlayerProfile(paths, { id: `p${i}`, name: `选手${i}` });
    ids.push(`p${i}`);
  }
  return ids;
}

function createSeries(count: number): string {
  const record = createTournament(paths, { name: '星空杯S1', playerIds: seedPlayers(count), seed: 42 });
  return record.id;
}

/** 打完一场对决（自动适配 BO1/BO3），每登记一小局都调用完成钩子 */
function playMatchToEnd(matchId: string, winnerSide: 'left' | 'right'): void {
  let match = getMatchStore(paths).matches.find((item) => item.id === matchId);
  let guard = 0;
  while (match && match.status !== 'completed') {
    const game = match.games.find((item) => item.status === 'pending');
    if (!game) {
      throw new Error('没有待开始小局');
    }
    saveGameLineupForMatch(paths, matchId, game.gameNumber, {
      left: [{ sprite: '3001' }],
      right: [{ sprite: '3002' }],
    });
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, winnerSide);
    onMatchCompleted(paths, matchId);
    match = getMatchStore(paths).matches.find((item) => item.id === matchId);
    guard += 1;
    if (guard > 10) {
      throw new Error('比赛无法收敛');
    }
  }
}

/** 打完某阶段当前所有待开始比赛（左侧胜），直到晋级推进/阶段结束 */
function playStageLeftWins(tournamentId: string, stageIndex: number): void {
  let guard = 0;
  while (true) {
    const record = getTournamentStore(paths).find((item) => item.id === tournamentId);
    if (!record || record.currentStageIndex !== stageIndex || record.status !== 'running') {
      return;
    }
    const nodeMatchIds = new Set(
      record.waves
        .filter((wave) => wave.stageIndex === stageIndex)
        .flatMap((wave) => wave.nodes.map((node) => node.matchId))
        .filter((matchId): matchId is string => Boolean(matchId)),
    );
    const pending = getMatchStore(paths).matches.filter(
      (match) => match.status === 'pending' && nodeMatchIds.has(match.id),
    );
    if (!pending.length) {
      return;
    }
    pending.forEach((match) => playMatchToEnd(match.id, 'left'));
    guard += 1;
    if (guard > 10) {
      throw new Error('阶段无法收敛');
    }
  }
}

function standingsOf(tournamentId: string, stageIndex: number): StageStandings {
  const standings = resolveStageStandings(paths, tournamentId, stageIndex);
  if (!standings) {
    throw new Error('榜单不存在');
  }
  return standings;
}

/** 按分数分组的行数统计（战绩同分的选手必然成组，便于断言） */
function scoreHistogram(standings: StageStandings): Record<number, number> {
  return standings.rows.reduce<Record<number, number>>((acc, row) => {
    acc[row.score] = (acc[row.score] ?? 0) + 1;
    return acc;
  }, {});
}

describe('晋级积分榜：按阶段重算选手战绩', () => {
  it('开赛前：32 人阶段榜单为全部种子选手、0-0 存活、名次按种子顺序', () => {
    const id = createSeries(32);
    const standings = standingsOf(id, 0);

    expect(standings.stageName).toBe('32进16');
    expect(standings.format).toBe('double-life');
    expect(standings.bestOf).toBe(1);
    expect(standings.total).toBe(32);
    expect(standings.pageSize).toBe(32);
    expect(standings.pageCount).toBe(1);
    expect(standings.completedMatches).toBe(0);
    expect(standings.rows.every((row) => row.wins === 0 && row.losses === 0 && row.state === 'alive')).toBe(true);
    expect(standings.rows.map((row) => row.rank)).toEqual(Array.from({ length: 32 }, (_value, index) => index + 1));
    expect(standings.rows[0].name).toBe('选手0');

    // 未开赛（setup）时阶段 1 还没有任何波次，也拿不到参赛者：不产生幽灵行
    const future = standingsOf(id, 1);
    expect(future.rows).toHaveLength(0);
    expect(future.totalMatches).toBe(0);
  });

  it('双败首轮：胜者 1-0 记 10 分、负者 0-1 记 -1 分，均仍存活', () => {
    const id = createSeries(32);
    startTournament(paths, id);
    const record = getTournamentStore(paths).find((item) => item.id === id)!;
    const wave1 = record.waves.find((wave) => wave.stageIndex === 0 && wave.waveIndex === 1)!;
    wave1.nodes.forEach((node) => playMatchToEnd(node.matchId!, 'left'));

    const standings = standingsOf(id, 0);
    expect(standings.completedMatches).toBe(16);
    // 首轮打完后 W2 会自动建场（16 场待打），所以已建场数为 32
    expect(standings.totalMatches).toBe(32);
    expect(scoreHistogram(standings)).toEqual({ 10: 16, [-1]: 16 });
    expect(standings.rows.every((row) => row.state === 'alive')).toBe(true);
    expect(standings.rows[0]).toMatchObject({ wins: 1, losses: 0, rank: 1 });
    expect(standings.rows[31]).toMatchObject({ wins: 0, losses: 1, rank: 32 });
  });

  it('双败整阶段（32 人 = 40 场）：8 人 2-0、8 人 2-1 晋级，8 人 1-2、8 人 0-2 淘汰', () => {
    const id = createSeries(32);
    startTournament(paths, id);
    playStageLeftWins(id, 0);

    const standings = standingsOf(id, 0);
    expect(standings.completedMatches).toBe(40);
    expect(standings.totalMatches).toBe(40);
    expect(scoreHistogram(standings)).toEqual({ 20: 8, 19: 8, 8: 8, [-2]: 8 });
    expect(standings.rows.filter((row) => row.state === 'promoted')).toHaveLength(16);
    expect(standings.rows.filter((row) => row.state === 'eliminated')).toHaveLength(16);
    expect(standings.rows.filter((row) => row.state === 'alive')).toHaveLength(0);
    expect(standings.rows.map((row) => row.rank)).toEqual(Array.from({ length: 32 }, (_value, index) => index + 1));
  });

  it('回看已完成阶段：阶段推进后 entries 已清零，榜单仍按节点重算（不能用 entries）', () => {
    const id = createSeries(32);
    startTournament(paths, id);
    playStageLeftWins(id, 0);

    // 阶段 1 已开打：entries 是「下一阶段的 0-0」，阶段 0 的战绩必须从节点重算
    const record = getTournamentStore(paths).find((item) => item.id === id)!;
    expect(record.currentStageIndex).toBe(1);
    expect(record.entries.every((entry) => entry.stageWins === 0 && entry.stageLosses === 0 && entry.state === 'alive')).toBe(true);

    const stage0 = standingsOf(id, 0);
    expect(stage0.total).toBe(32);
    expect(stage0.completedMatches).toBe(40);
    expect(stage0.rows.filter((row) => row.state === 'promoted')).toHaveLength(16);

    const stage1 = standingsOf(id, 1);
    expect(stage1.stageName).toBe('16进8');
    expect(stage1.total).toBe(16);
    expect(stage1.completedMatches).toBe(0);
    expect(stage1.totalMatches).toBe(8);
    expect(stage1.rows.every((row) => row.wins === 0 && row.losses === 0)).toBe(true);
  });

  it('单败阶段：一胜即晋级、一负即淘汰', () => {
    const id = createSeries(32);
    startTournament(paths, id);
    playStageLeftWins(id, 0);
    playStageLeftWins(id, 1);

    // 阶段 2「8进4」为单败 BO3
    const standings = standingsOf(id, 2);
    expect(standings.format).toBe('single-elim');
    expect(standings.bestOf).toBe(3);
    expect(standings.total).toBe(8);
    playStageLeftWins(id, 2);
    const played = standingsOf(id, 2);
    expect(played.completedMatches).toBe(4);
    expect(played.rows.filter((row) => row.state === 'promoted')).toHaveLength(4);
    expect(played.rows.filter((row) => row.state === 'eliminated')).toHaveLength(4);
    expect(played.rows.filter((row) => row.state === 'promoted').every((row) => row.wins === 1 && row.losses === 0)).toBe(true);
  });

  it('64 人系列赛：可创建，64进32 榜单 64 行、分 2 页', () => {
    const id = createSeries(64);
    const record = getTournamentStore(paths).find((item) => item.id === id)!;
    expect(record.playerIds).toHaveLength(64);
    expect(record.stages.map((stage) => stage.name)).toEqual([
      '64进32', '32进16', '16进8', '8进4', '4进2', '总决赛',
    ]);

    const standings = standingsOf(id, 0);
    expect(standings.stageName).toBe('64进32');
    expect(standings.total).toBe(64);
    expect(standings.pageCount).toBe(2);
    expect(standings.rows).toHaveLength(64);
    expect(standings.rows[63].rank).toBe(64);

    startTournament(paths, id);
    const wave1 = getTournamentStore(paths).find((item) => item.id === id)!
      .waves.find((wave) => wave.stageIndex === 0 && wave.waveIndex === 1)!;
    expect(wave1.nodes).toHaveLength(32);
  });

  it('系列赛不存在 / 阶段越界：返回 null', () => {
    const id = createSeries(8);
    expect(resolveStageStandings(paths, 'T20260101_A01', 0)).toBeNull();
    expect(resolveStageStandings(paths, id, 99)).toBeNull();
    expect(resolveStageStandings(paths, id, -1)).toBeNull();
  });
});
