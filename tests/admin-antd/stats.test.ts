import { describe, expect, it } from 'vitest';

import { buildDefaultStages } from '../../shared/constants';
import type {
  GameRecord,
  MatchRecord,
  TournamentNode,
  TournamentRecord,
  TournamentWave,
} from '../../shared/types';
import { buildStatsStageAxis, buildUsageStats } from '../../src/admin-antd/lib/stats';

/** 已结束小局的极简构造（只需 lineups / winner / status 参与统计） */
function makeGame(
  gameNumber: number,
  left: string[],
  right: string[],
  winner: 'left' | 'right' = 'left',
): GameRecord {
  return {
    gameNumber,
    leftLineup: left,
    rightLineup: right,
    leftSlots: [],
    rightSlots: [],
    winner,
    status: 'completed',
  };
}

function makeMatch(id: string, patch: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id,
    createdAt: '',
    updatedAt: '',
    status: 'completed',
    leftPlayer: '甲',
    rightPlayer: '乙',
    leftRank: '',
    rightRank: '',
    leftTeamId: '',
    leftTeamName: '',
    rightTeamId: '',
    rightTeamName: '',
    bestOf: 1,
    games: [],
    leftScore: 0,
    rightScore: 0,
    winner: 'left',
    completedAt: null,
    tags: [],
    ...patch,
  };
}

function makeRecord(patch: Partial<TournamentRecord> = {}, playerCount = 8): TournamentRecord {
  const playerIds = Array.from({ length: playerCount }, (_unused, index) => `p${index}`);
  return {
    id: 'T20260929_A01',
    name: '星空杯S1',
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    status: 'running',
    seed: 42,
    drawVersion: 0,
    playerIds,
    stages: buildDefaultStages(playerCount),
    currentStageIndex: 0,
    entries: playerIds.map((id) => ({ playerId: id, stageWins: 0, stageLosses: 0, state: 'alive' })),
    waves: [],
    ...patch,
  };
}

function node(id: string, a: string | null, b: string | null, winnerId: string | null = null): TournamentNode {
  return { id, matchId: `m-${id}`, playerAId: a, playerBId: b, winnerId, isBye: false };
}

function makeWave(stageIndex: number, waveIndex: number, nodes: TournamentNode[]): TournamentWave {
  return { stageIndex, waveIndex, status: 'running', pairingStatus: 'locked', nodes };
}

function ref(
  tournamentId: string,
  nodeId: string,
  stageIndex: number,
  waveIndex: number,
): NonNullable<MatchRecord['tournamentRef']> {
  return { tournamentId, nodeId, stageIndex, waveIndex };
}

describe('buildStatsStageAxis', () => {
  it('选定系列赛：按「阶段 · 语义轮次」拆桶并按阶段/波次排序（双败拆胜者组 R1/R2、败者组 R1/R2）', () => {
    const record = makeRecord({
      waves: [
        makeWave(0, 1, [
          node('s0-w1-n00', 'p0', 'p1', 'p0'),
          node('s0-w1-n01', 'p2', 'p3', 'p2'),
        ]),
        makeWave(0, 2, [
          // 双方首轮均胜 → 胜者组
          node('s0-w2-n00', 'p0', 'p2', 'p0'),
          // 双方首轮均负 → 败者组
          node('s0-w2-n01', 'p1', 'p3', 'p1'),
        ]),
        makeWave(0, 3, [node('s0-w3-n00', 'p0', 'p2', 'p0')]),
        makeWave(1, 1, [node('s1-w1-n00', 'p0', 'p2', 'p0')]),
      ],
    });
    // 比赛列表故意乱序：轴应按系列赛结构排序，而不是按列表顺序
    const matches = [
      makeMatch('m3', { tournamentRef: ref(record.id, 's0-w3-n00', 0, 3) }),
      makeMatch('m2b', { tournamentRef: ref(record.id, 's0-w2-n01', 0, 2) }),
      makeMatch('m1', { tournamentRef: ref(record.id, 's0-w1-n00', 0, 1) }),
      makeMatch('m2a', { tournamentRef: ref(record.id, 's0-w2-n00', 0, 2) }),
      makeMatch('m4', { tournamentRef: ref(record.id, 's1-w1-n00', 1, 1) }),
      makeMatch('plain'), // 普通对局不进轴
    ];

    const axis = buildStatsStageAxis(matches, [record], record.id);
    expect(axis.map((bucket) => bucket.label)).toEqual([
      '8进4 · 胜者组 R1',
      '8进4 · 胜者组 R2',
      '8进4 · 败者组 R1',
      '8进4 · 败者组 R2',
      '4进2',
    ]);
  });

  it('未选系列赛：按阶段名聚合（跨系列赛合并），时间锚取该桶最早一场比赛', () => {
    const first = makeRecord({ id: 'T20260901_A01', name: '甲杯' });
    const second = makeRecord({ id: 'T20260902_B01', name: '乙杯' });
    const matches = [
      makeMatch('a2', { createdAt: '2026-09-05', tournamentRef: ref(second.id, 's1-w1-n00', 1, 1) }),
      makeMatch('a1', {
        createdAt: '2026-09-02',
        tournamentRef: ref(first.id, 's0-w1-n00', 0, 1),
      }),
      makeMatch('b1', {
        createdAt: '2026-09-03',
        tournamentRef: ref(second.id, 's0-w1-n00', 0, 1),
      }),
    ];

    const axis = buildStatsStageAxis(matches, [first, second], null);
    // 两场「8进4」跨系列赛合并为一个桶；排序按桶内最早比赛（09-02 早于 09-05）
    expect(axis.map((bucket) => bucket.key)).toEqual(['stage:8进4', 'stage:4进2']);
    expect(axis.map((bucket) => bucket.label)).toEqual(['8进4', '4进2']);
  });
});

describe('buildUsageStats（系列赛维度）', () => {
  const first = makeRecord({ id: 'T20260929_A01', name: '星空杯S1' });
  const second = makeRecord({ id: 'T20260929_B01', name: '星空杯S1' });
  const matches = [
    makeMatch('ma', {
      tournamentRef: ref(first.id, 's0-w1-n00', 0, 1),
      games: [makeGame(1, ['pet-a'], ['pet-b'])],
    }),
    makeMatch('mb', {
      tournamentRef: ref(second.id, 's0-w1-n00', 0, 1),
      games: [makeGame(1, ['pet-c'], ['pet-b'])],
    }),
  ];

  it('同名系列赛按 id 精确过滤：只统计所选系列赛的比赛，不按名字合并', () => {
    const scoped = buildUsageStats(matches, new Map(), [first, second], {
      player: null,
      tag: null,
      tournamentId: first.id,
      metric: 'pickRate',
    });
    expect(scoped.rows.map((row) => row.name)).toEqual(['pet-a', 'pet-b']);
    expect(scoped.totalPicks).toBe(2);

    const all = buildUsageStats(matches, new Map(), [first, second], {
      player: null,
      tag: null,
      tournamentId: null,
      metric: 'pickRate',
    });
    expect(all.rows.map((row) => row.name)).toEqual(['pet-b', 'pet-a', 'pet-c']);
  });

  it('系列赛趋势：所选系列赛使用率 − 全量使用率；未选系列赛为 null', () => {
    const scoped = buildUsageStats(matches, new Map(), [first, second], {
      player: null,
      tag: null,
      tournamentId: first.id,
      metric: 'pickRate',
    });
    const byName = new Map(scoped.rows.map((row) => [row.name, row]));
    // pet-a：系列赛内 1/2 = 50%，全量 1/4 = 25% → +25.0
    expect(byName.get('pet-a')?.tournamentTrendDelta).toBe(25);
    // pet-b：50% vs 50% → 0
    expect(byName.get('pet-b')?.tournamentTrendDelta).toBe(0);

    const unscoped = buildUsageStats(matches, new Map(), [first, second], {
      player: null,
      tag: null,
      tournamentId: null,
      metric: 'pickRate',
    });
    expect(unscoped.rows.every((row) => row.tournamentTrendDelta === null)).toBe(true);
  });

  it('轴与逐桶取数只覆盖所选系列赛（同 id 才入桶，普通对局/孤儿引用不入轴）', () => {
    const orphan = makeMatch('orphan', {
      tournamentRef: ref('T19990101_A99', 's0-w1-n00', 0, 1),
      games: [makeGame(1, ['pet-x'], ['pet-y'])],
    });
    const scoped = buildUsageStats([...matches, orphan], new Map(), [first, second], {
      player: null,
      tag: null,
      tournamentId: first.id,
      metric: 'pickRate',
    });
    expect(scoped.stageAxis).toHaveLength(1);
    expect(scoped.stageAxis[0].label).toBe('8进4 · 胜者组 R1');
    // 桶内只统计该系列赛的比赛：pet-x/pet-y 不在逐桶数据里
    const bucketKey = scoped.stageAxis[0].key;
    expect(scoped.spriteStageRate.has('pet-x')).toBe(false);
    expect(scoped.spriteStageRate.get('pet-a')?.get(bucketKey)).toBe(0.5);
  });
});