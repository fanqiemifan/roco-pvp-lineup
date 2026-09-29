import { describe, expect, it } from 'vitest';

import {
  buildPlayerNameMap,
  countCompletedMatches,
  getCurrentPositionText,
  getDraftBucketSpecs,
  getNodeStatus,
  getPlayerStateText,
  getStageState,
  getTournamentStatusMeta,
  getWaveGlobalIndex,
  resolvePlayerName,
  shuffleBucketPairs,
  validateDraftPairs,
} from '../../src/admin-antd/lib/tournament';
import { buildDefaultStages } from '../../shared/constants';
import type {
  MatchRecord,
  ProfileStoreState,
  StageRule,
  TournamentRecord,
  TournamentWave,
} from '../../shared/types';

/** 构造最小可用系列赛记录（默认 8 人默认模板、setup） */
function makeRecord(
  patch: Partial<TournamentRecord> = {},
  playerCount = 8,
): TournamentRecord {
  const playerIds = Array.from({ length: playerCount }, (_unused, index) => `p${index}`);
  return {
    id: 'T20260929_A01',
    name: '星空杯S1',
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    status: 'setup',
    seed: 42,
    drawVersion: 0,
    playerIds,
    stages: buildDefaultStages(playerCount),
    currentStageIndex: 0,
    entries: playerIds.map((id) => ({
      playerId: id,
      stageWins: 0,
      stageLosses: 0,
      state: 'alive',
    })),
    waves: [],
    ...patch,
  };
}

/** 构造波次（默认 locked 空节点） */
function makeWave(
  stageIndex: number,
  waveIndex: number,
  patch: Partial<TournamentWave> = {},
): TournamentWave {
  return {
    stageIndex,
    waveIndex,
    status: 'pending',
    pairingStatus: 'locked',
    nodes: [],
    ...patch,
  };
}

/** 构造比赛（默认 pending） */
function makeMatch(id: string, patch: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id,
    createdAt: '',
    updatedAt: '',
    status: 'pending',
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
    winner: null,
    completedAt: null,
    tags: [],
    ...patch,
  };
}

describe('buildPlayerNameMap / resolvePlayerName', () => {
  const profiles: ProfileStoreState = {
    players: [
      { id: 'p0', name: '阿炽', pets: '', declaration: '', rank: '', avatarExists: false, avatarMtime: null },
      { id: 'p1', name: '小岚', pets: '', declaration: '', rank: '', avatarExists: false, avatarMtime: null },
    ],
    teams: [],
    mtime: null,
  };

  it('id 映射名字；查不到时兜底显示 id；空 id 返回空串', () => {
    const names = buildPlayerNameMap(profiles);
    expect(names.size).toBe(2);
    expect(resolvePlayerName(names, 'p0')).toBe('阿炽');
    expect(resolvePlayerName(names, 'p9')).toBe('p9');
    expect(resolvePlayerName(names, null)).toBe('');
    expect(buildPlayerNameMap(null).size).toBe(0);
  });
});

describe('getTournamentStatusMeta', () => {
  it('setup=待开赛/default；running=进行中/processing；completed=已完赛/success', () => {
    expect(getTournamentStatusMeta(makeRecord())).toEqual({ label: '待开赛', color: 'default' });
    expect(getTournamentStatusMeta(makeRecord({ status: 'running' }))).toEqual({
      label: '进行中',
      color: 'processing',
    });
    expect(getTournamentStatusMeta(makeRecord({ status: 'completed' }))).toEqual({
      label: '已完赛',
      color: 'success',
    });
  });
});

describe('getStageState', () => {
  it('currentStageIndex 之前 done、当前 current（completed 时亦 done）、之后 pending', () => {
    const running = makeRecord({ status: 'running', currentStageIndex: 1 });
    expect(getStageState(running, 0)).toBe('done');
    expect(getStageState(running, 1)).toBe('current');
    expect(getStageState(running, 2)).toBe('pending');

    const completed = makeRecord({ status: 'completed', currentStageIndex: 2 });
    expect(getStageState(completed, 2)).toBe('done');
  });
});

describe('getCurrentPositionText', () => {
  it('setup 显示抽签待开赛；running 显示「阶段名 · 第 N 波」；completed 显示已结束', () => {
    expect(getCurrentPositionText(makeRecord())).toBe('抽签待开赛');

    const wave = makeWave(0, 2, { status: 'running' });
    const running = makeRecord({ status: 'running', waves: [makeWave(0, 1), wave] });
    expect(getCurrentPositionText(running)).toBe('8进4 · 第 2 波');

    expect(getCurrentPositionText(makeRecord({ status: 'completed' }))).toBe('已结束');
  });
});

describe('countCompletedMatches', () => {
  it('只统计系列赛节点关联且 completed 的比赛', () => {
    const record = makeRecord({
      waves: [
        makeWave(0, 1, {
          nodes: [
            { id: 's0-w1-n00', matchId: 'm1', playerAId: 'p0', playerBId: 'p1', winnerId: 'p0', isBye: false },
            { id: 's0-w1-n01', matchId: 'm2', playerAId: 'p2', playerBId: 'p3', winnerId: null, isBye: false },
          ],
        }),
      ],
    });
    const matches = [
      makeMatch('m1', { status: 'completed' }),
      makeMatch('m2', { status: 'pending' }),
      makeMatch('m3', { status: 'completed' }), // 与本系列赛无关
    ];
    expect(countCompletedMatches(record, matches)).toBe(1);
  });
});

describe('getNodeStatus', () => {
  it('优先用关联比赛状态；无比赛时按节点 winnerId 推断', () => {
    const node = { id: 'n', matchId: 'm1', playerAId: 'p0', playerBId: 'p1', winnerId: null, isBye: false };
    expect(getNodeStatus(node, makeMatch('m1', { status: 'in_progress' }))).toBe('in_progress');
    expect(getNodeStatus(node)).toBe('pending');
    expect(getNodeStatus({ ...node, winnerId: 'p0' })).toBe('completed');
  });
});

describe('getWaveGlobalIndex', () => {
  it('waves 扁平数组中按 stage/wave 定位；找不到 -1', () => {
    const record = makeRecord({
      waves: [makeWave(0, 1), makeWave(0, 2), makeWave(1, 1)],
    });
    expect(getWaveGlobalIndex(record, 0, 1)).toBe(0);
    expect(getWaveGlobalIndex(record, 1, 1)).toBe(2);
    expect(getWaveGlobalIndex(record, 2, 1)).toBe(-1);
  });
});

describe('getDraftBucketSpecs（draft 期望选手桶）', () => {
  /** 把 entries 直接改成指定战绩 */
  function recordWithEntries(
    entries: Array<[number, number, TournamentRecord['entries'][number]['state']]>,
    waveStageIndex = 0,
  ): TournamentRecord {
    const record = makeRecord({ status: 'running', currentStageIndex: waveStageIndex });
    record.entries = entries.map(([wins, losses, state], index) => ({
      playerId: `p${index}`,
      stageWins: wins,
      stageLosses: losses,
      state,
    }));
    return record;
  }

  it('W1：全部 alive 归 0-0 单桶', () => {
    const record = recordWithEntries([
      [0, 0, 'alive'],
      [0, 0, 'alive'],
      [0, 0, 'alive'],
      [0, 0, 'alive'],
    ]);
    const wave = makeWave(0, 1, { pairingStatus: 'draft' });
    const specs = getDraftBucketSpecs(record, wave);
    expect(specs).toHaveLength(1);
    expect(specs[0].bucketKey).toBe('0-0');
    expect(specs[0].playerIds).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('W2：1-0 / 0-1 两桶（已晋级/淘汰的不出现）', () => {
    const record = recordWithEntries([
      [1, 0, 'alive'],
      [1, 0, 'alive'],
      [0, 1, 'alive'],
      [0, 1, 'alive'],
      [2, 0, 'promoted'],
      [0, 2, 'eliminated'],
    ]);
    const wave = makeWave(0, 2, { pairingStatus: 'draft' });
    const specs = getDraftBucketSpecs(record, wave);
    expect(specs.map((spec) => spec.bucketKey)).toEqual(['1-0', '0-1']);
    expect(specs[0].playerIds).toEqual(['p0', 'p1']);
    expect(specs[1].playerIds).toEqual(['p2', 'p3']);
  });

  it('W3：全部 1-1 归决胜池', () => {
    const record = recordWithEntries([
      [1, 1, 'alive'],
      [1, 1, 'alive'],
    ]);
    const wave = makeWave(0, 3, { pairingStatus: 'draft' });
    expect(getDraftBucketSpecs(record, wave)).toEqual([
      { bucketKey: '1-1', playerIds: ['p0', 'p1'] },
    ]);
  });

  it('单败阶段：无 bucketKey 整池', () => {
    const record = makeRecord(
      { status: 'running', currentStageIndex: 1 },
      8,
    );
    // stage1 单败：entries 4 人 alive
    record.entries = ['p0', 'p1', 'p2', 'p3'].map((playerId) => ({
      playerId,
      stageWins: 0,
      stageLosses: 0,
      state: 'alive',
    }));
    const wave = makeWave(1, 1, { pairingStatus: 'draft' });
    const specs = getDraftBucketSpecs(record, wave);
    expect(specs).toHaveLength(1);
    expect(specs[0].bucketKey).toBeUndefined();
    expect(specs[0].playerIds).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
});

describe('validateDraftPairs（配对草稿校验）', () => {
  /** 构造带 W2 draft 场景的记录：2 名 1-0 + 2 名 0-1 */
  function w2Record(): { record: TournamentRecord; wave: TournamentWave } {
    const record = makeRecord({ status: 'running' });
    record.entries = [
      { playerId: 'p0', stageWins: 1, stageLosses: 0, state: 'alive' },
      { playerId: 'p1', stageWins: 1, stageLosses: 0, state: 'alive' },
      { playerId: 'p2', stageWins: 0, stageLosses: 1, state: 'alive' },
      { playerId: 'p3', stageWins: 0, stageLosses: 1, state: 'alive' },
      // 其余四人已晋级/淘汰
      { playerId: 'p4', stageWins: 2, stageLosses: 0, state: 'promoted' },
      { playerId: 'p5', stageWins: 2, stageLosses: 0, state: 'promoted' },
      { playerId: 'p6', stageWins: 0, stageLosses: 2, state: 'eliminated' },
      { playerId: 'p7', stageWins: 0, stageLosses: 2, state: 'eliminated' },
    ];
    return { record, wave: makeWave(0, 2, { pairingStatus: 'draft' }) };
  }

  it('合法同桶配对：valid，无错误', () => {
    const { record, wave } = w2Record();
    const result = validateDraftPairs(record, wave, [
      { bucketKey: '1-0', pair: ['p0', 'p1'] },
      { bucketKey: '0-1', pair: ['p2', 'p3'] },
    ], false);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('漏配（空槽 / 缺行）→ 错误', () => {
    const { record, wave } = w2Record();
    const result = validateDraftPairs(record, wave, [
      { bucketKey: '1-0', pair: ['p0', null] },
      { bucketKey: '0-1', pair: ['p2', 'p3'] },
    ], false);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/漏配|选手漏配/);
  });

  it('重复选手 → 错误', () => {
    const { record, wave } = w2Record();
    const result = validateDraftPairs(record, wave, [
      { bucketKey: '1-0', pair: ['p0', 'p1'] },
      { bucketKey: '0-1', pair: ['p2', 'p0'] },
    ], false);
    expect(result.errors.join()).toMatch(/重复/);
  });

  it('自己对自己 → 错误', () => {
    const { record, wave } = w2Record();
    const result = validateDraftPairs(record, wave, [
      { bucketKey: '1-0', pair: ['p0', 'p0'] },
      { bucketKey: '1-0', pair: ['p1', 'p1'] },
    ], false);
    expect(result.errors.join()).toMatch(/自己/);
  });

  it('跨桶：未显式允许 → 错误；允许后 valid', () => {
    const { record, wave } = w2Record();
    const pairs = [
      { bucketKey: '1-0', pair: ['p0', 'p2'] as [string, string] },
      { bucketKey: '1-0', pair: ['p1', 'p3'] as [string, string] },
    ];
    expect(validateDraftPairs(record, wave, pairs, false).valid).toBe(false);
    expect(validateDraftPairs(record, wave, pairs, false).errors.join()).toMatch(/跨桶/);
    expect(validateDraftPairs(record, wave, pairs, true).valid).toBe(true);
  });

  it('已交手（本阶段前序波有胜者节点）→ 同一对再次配上时仅警告不阻断（跨桶需显式允许）', () => {
    const { record, wave } = w2Record();
    record.waves = [
      makeWave(0, 1, {
        status: 'completed',
        nodes: [
          { id: 's0-w1-n00', matchId: 'm1', playerAId: 'p0', playerBId: 'p2', winnerId: 'p0', isBye: false },
        ],
      }),
    ];
    // W2 草稿把已交手过的 p0/p2 重新配成一对（跨桶 → allowCrossBucket）
    const pairs = [
      { bucketKey: '1-0', pair: ['p0', 'p2'] as [string, string] },
      { bucketKey: '1-0', pair: ['p1', 'p3'] as [string, string] },
    ];
    const result = validateDraftPairs(record, wave, pairs, true);
    expect(result.valid).toBe(true);
    expect(result.warnings.join()).toMatch(/已交手/);
  });

  it('不在本波名单（已晋级选手）→ 错误', () => {
    const { record, wave } = w2Record();
    const result = validateDraftPairs(record, wave, [
      { bucketKey: '1-0', pair: ['p0', 'p4'] }, // p4 已 promoted
      { bucketKey: '0-1', pair: ['p2', 'p3'] },
    ], false);
    expect(result.errors.join()).toMatch(/不在本波/);
  });
});

describe('shuffleBucketPairs', () => {
  it('配对覆盖全部选手且每人恰一次；结果数 = 人数/2', () => {
    const ids = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
    const pairs = shuffleBucketPairs(ids, () => 0.5);
    expect(pairs).toHaveLength(3);
    const flattened = pairs.flat();
    expect(flattened.sort()).toEqual([...ids].sort());
  });

  it('RNG 固定时结果确定（同一种子序列永远同一排列）', () => {
    const ids = ['p0', 'p1', 'p2', 'p3'];
    // rng 恒 0：j 恒为 0，置换确定（不依赖「原位」假设）
    const expected = shuffleBucketPairs(ids, () => 0);
    expect(shuffleBucketPairs(ids, () => 0)).toEqual(expected);
    expect(expected.flat().sort()).toEqual([...ids].sort());
  });
});

describe('getPlayerStateText', () => {
  it('按选手当前状态与战绩生成中文脚注；查不到/空 id 返回空串', () => {
    const record = makeRecord({ status: 'running' });
    record.entries = [
      { playerId: 'p0', stageWins: 2, stageLosses: 0, state: 'promoted' },
      { playerId: 'p1', stageWins: 0, stageLosses: 2, state: 'eliminated' },
      { playerId: 'p2', stageWins: 1, stageLosses: 0, state: 'alive' },
    ];
    expect(getPlayerStateText(record, 'p0')).toBe('2-0 已晋级');
    expect(getPlayerStateText(record, 'p1')).toBe('0-2 已淘汰');
    expect(getPlayerStateText(record, 'p2')).toBe('1-0 存活');
    expect(getPlayerStateText(record, 'p9')).toBe('');
    expect(getPlayerStateText(record, null)).toBe('');
  });
});
