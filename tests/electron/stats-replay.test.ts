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
import { buildPage15Replay, type Page15ReplaySpeed } from '../../electron/services/stats-service';
import { createTournament, startTournament } from '../../electron/services/tournament-service';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-stats-replay-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });
});

/** 建 4 名选手档案并开一场 4 人系列赛（默认模板两阶段，返回系列赛 id 与首波两张对局 id） */
function startFourPlayerSeries(name: string): { id: string; waveMatchIds: string[] } {
  const playerIds = Array.from({ length: 4 }, (_unused, index) => {
    const id = `p${index}`;
    savePlayerProfile(paths, { id, name: `选手${index}` });
    return id;
  });
  const record = createTournament(paths, { name, playerIds, seed: 42 });
  startTournament(paths, record.id);
  const waveMatchIds = getMatchStore(paths).matches
    .filter((item) => item.tournamentRef?.tournamentId === record.id && item.tournamentRef.stageIndex === 0)
    .map((item) => item.id);
  if (waveMatchIds.length !== 2) {
    throw new Error('系列赛首波应有 2 场对局');
  }
  return { id: record.id, waveMatchIds };
}

/** 为指定小局录入双方阵容并开局（之后用 recordMatchWinner 登记胜负） */
function lineupAndStart(matchId: string, gameNumber: number, left: string[], right: string[]): void {
  saveGameLineupForMatch(paths, matchId, gameNumber, {
    left: left.map((sprite) => ({ sprite })),
    right: right.map((sprite) => ({ sprite })),
  });
  startCurrentGame(paths, matchId);
}

describe('buildPage15Replay（推流页面15 数据回放）', () => {
  it('单场单局：生成 1 步，增量口径与 getSpriteRanking 一致，比分与阶段名落地', () => {
    const series = startFourPlayerSeries('回放杯S1');
    lineupAndStart(series.waveMatchIds[0], 1, ['pet-a', 'pet-b'], ['pet-c']);
    recordMatchWinner(paths, series.waveMatchIds[0], 'left');

    const payload = buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 1 });
    expect(payload.tournamentId).toBe(series.id);
    expect(payload.tournamentName).toBe('回放杯S1');
    expect(payload.fromStage).toBe(0);
    expect(payload.toStage).toBe(1);
    expect(payload.speed).toBe('normal');
    expect(payload.steps).toHaveLength(1);

    const step = payload.steps[0];
    expect(step.matchId).toBe(series.waveMatchIds[0]);
    expect(step.stageIndex).toBe(0);
    expect(step.stageName).toBe('4进2');
    expect(step.score).toBe('1:0');
    const byKey = new Map(step.deltas.map((delta) => [delta.key, delta]));
    expect(byKey.get('pet-a')).toEqual({ key: 'pet-a', picks: 1, games: 1, wins: 1 });
    expect(byKey.get('pet-b')).toEqual({ key: 'pet-b', picks: 1, games: 1, wins: 1 });
    expect(byKey.get('pet-c')).toEqual({ key: 'pet-c', picks: 1, games: 1, wins: 0 });

    // 测试环境无精灵索引：元数据 name 回退 pet_id，图形路径为空串
    expect(payload.sprites['pet-a']).toEqual({ name: 'pet-a', displayName: '', iconPath: '', spritePath: '' });
  });

  it('同场多局合并为一步且镜像局记 0.5 胜；跨场各成一步（增量不重复累计）', () => {
    const series = startFourPlayerSeries('回放杯S1');
    const first = series.waveMatchIds[0];
    // 局1：a/b vs c，左胜；局2：a vs a/c，右胜（a 双侧登场 = 镜像局，wins 记 0.5）
    lineupAndStart(first, 1, ['pet-a', 'pet-b'], ['pet-c']);
    recordMatchWinner(paths, first, 'left');
    lineupAndStart(first, 2, ['pet-a'], ['pet-a', 'pet-c']);
    recordMatchWinner(paths, first, 'right');

    const second = series.waveMatchIds[1];
    lineupAndStart(second, 1, ['pet-x'], ['pet-y']);
    recordMatchWinner(paths, second, 'left');

    const payload = buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 1 });
    expect(payload.steps).toHaveLength(2);

    // 同波两场的展示顺序按 id 排（createdAt 相同），不依赖 waveMatchIds 的数组顺序
    const step1 = payload.steps.find((step) => step.matchId === first)!;
    const step2 = payload.steps.find((step) => step.matchId === second)!;
    expect(step1.score).toBe('1:1');
    const byKey = new Map(step1.deltas.map((delta) => [delta.key, delta]));
    // 镜像局（局2 a 双侧登场）：picks 左右各计 1 次、games 同局只计 1 场、wins 记 0.5
    expect(byKey.get('pet-a')).toEqual({ key: 'pet-a', picks: 3, games: 2, wins: 1.5 });
    expect(byKey.get('pet-b')).toEqual({ key: 'pet-b', picks: 1, games: 1, wins: 1 });
    expect(byKey.get('pet-c')).toEqual({ key: 'pet-c', picks: 2, games: 2, wins: 1 });

    // 第二步只含本场增量，不重复带上第一场的精灵
    expect(step2.deltas.map((delta) => delta.key).sort()).toEqual(['pet-x', 'pet-y']);
    expect(payload.sprites['pet-a']).toBeTruthy();
    expect(payload.sprites['pet-x']).toBeTruthy();
  });

  it('阶段范围过滤：from=to=0 只含首阶段；from=to=1 时第二阶段无对局 → steps 为空', () => {
    const series = startFourPlayerSeries('回放杯S1');
    lineupAndStart(series.waveMatchIds[0], 1, ['pet-a'], ['pet-b']);
    recordMatchWinner(paths, series.waveMatchIds[0], 'left');

    const stage0 = buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 0 });
    expect(stage0.steps).toHaveLength(1);
    expect(stage0.steps.every((step) => step.stageIndex === 0)).toBe(true);

    const stage1 = buildPage15Replay(paths, { tournamentId: series.id, fromStage: 1, toStage: 1 });
    expect(stage1.steps).toEqual([]);
  });

  it('未开打的场不产生步：只统计有已完赛小局的对局', () => {
    const series = startFourPlayerSeries('回放杯S1');
    lineupAndStart(series.waveMatchIds[0], 1, ['pet-a'], ['pet-b']);
    recordMatchWinner(paths, series.waveMatchIds[0], 'left');
    // waveMatchIds[1] 保持未开打

    const payload = buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 1 });
    expect(payload.steps.map((step) => step.matchId)).toEqual([series.waveMatchIds[0]]);
  });

  it('speed 归一：slow/fast 原样保留，其余（缺省/非法）回 normal', () => {
    const series = startFourPlayerSeries('回放杯S1');
    lineupAndStart(series.waveMatchIds[0], 1, ['pet-a'], ['pet-b']);
    recordMatchWinner(paths, series.waveMatchIds[0], 'left');

    expect(buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 1, speed: 'slow' }).speed).toBe('slow');
    expect(buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 1, speed: 'fast' }).speed).toBe('fast');
    expect(buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 1, speed: 'weird' as Page15ReplaySpeed }).speed).toBe('normal');
  });

  it('非法输入直接抛错：未知系列赛、范围倒挂、越界、负数', () => {
    const series = startFourPlayerSeries('回放杯S1');
    expect(() => buildPage15Replay(paths, { tournamentId: 'T19990101_A99', fromStage: 0, toStage: 1 })).toThrow('系列赛不存在');
    expect(() => buildPage15Replay(paths, { tournamentId: series.id, fromStage: 1, toStage: 0 })).toThrow('阶段范围无效');
    expect(() => buildPage15Replay(paths, { tournamentId: series.id, fromStage: 0, toStage: 2 })).toThrow('阶段范围无效');
    expect(() => buildPage15Replay(paths, { tournamentId: series.id, fromStage: -1, toStage: 1 })).toThrow('阶段范围无效');
  });
});
