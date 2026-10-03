import { describe, expect, it } from 'vitest';

import {
  buildBracketGraph,
  buildPlayerNameMap,
  buildPushCandidateGroups,
  buildWaveCards,
  countCompletedMatches,
  crossPairDeciderPool,
  findThirdPlaceWave,
  formatStageRoundLabel,
  getCurrentPositionText,
  getDraftBucketSpecs,
  getNodeStatus,
  getPairingLabel,
  getPlayerStateText,
  getStagePlayerCount,
  getStageState,
  getThirdPlaceRankText,
  getTournamentOwnerCode,
  getTournamentStatusMeta,
  getWaveGlobalIndex,
  getWaveRoundLabels,
  isThirdPlaceRef,
  isTournamentOwnedByLocal,
  resolvePlayerName,
  shuffleBucketPairs,
  summarizeStageMatches,
  validateDraftPairs,
} from '../../src/admin-antd/lib/tournament';
import { buildDefaultStages, THIRD_PLACE_LABEL } from '../../shared/constants';
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
    name: '夏季杯S1',
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

  it('决胜池交叉配对：W1 胜者只与 W1 败者配对，不出现同侧相遇', () => {
    const record = recordWithEntries([
      [1, 1, 'alive'],
      [1, 1, 'alive'],
      [1, 1, 'alive'],
      [1, 1, 'alive'],
    ]);
    // W1：p0 胜 p2、p1 胜 p3 ⇒ p0/p1 = 胜者组掉落者，p2/p3 = 败者组上扬者
    record.waves = [
      makeWave(0, 1, {
        nodes: [
          { id: 's0-w1-n00', matchId: 'm1', playerAId: 'p0', playerBId: 'p2', winnerId: 'p0', isBye: false },
          { id: 's0-w1-n01', matchId: 'm2', playerAId: 'p1', playerBId: 'p3', winnerId: 'p1', isBye: false },
        ],
      }),
    ];

    const pairs = crossPairDeciderPool(record, 0, ['p0', 'p1', 'p2', 'p3'], () => 0.5);
    expect(pairs).toHaveLength(2);
    const openingWinners = new Set(['p0', 'p1']);
    pairs.forEach(([a, b]) => {
      expect(openingWinners.has(a)).toBe(!openingWinners.has(b));
    });
    // 每人恰好出场一次
    expect(pairs.flat().sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
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

  it('跨阶段已交手（上一阶段有胜者节点）→ 仅警告不阻断，提醒带「阶段 · 轮次」出处', () => {
    const record = makeRecord({ status: 'running', currentStageIndex: 1 });
    // 上一阶段（8进4）已完赛：p0 击败 p2；当前 4进2 首波草稿又把他俩配到一起
    record.waves = [
      makeWave(0, 1, {
        status: 'completed',
        nodes: [
          { id: 's0-w1-n00', matchId: 'm1', playerAId: 'p0', playerBId: 'p2', winnerId: 'p0', isBye: false },
        ],
      }),
    ];
    const wave = makeWave(1, 1, { pairingStatus: 'draft' });
    const result = validateDraftPairs(record, wave, [
      { pair: ['p0', 'p2'] },
      { pair: ['p1', 'p3'] },
      { pair: ['p4', 'p5'] },
      { pair: ['p6', 'p7'] },
    ], false);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).toMatch(/已交手/);
    expect(result.warnings.join()).toMatch(/8进4 · 胜者组 R1/);
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

describe('buildBracketGraph（晋级图数据源）', () => {
  const names = new Map(
    Array.from({ length: 8 }, (_unused, index) => [`p${index}`, `选手${index}`] as [string, string]),
  );

  /** 构造节点（默认未建场、无胜者） */
  function makeNode(
    id: string,
    a: string | null,
    b: string | null,
    patch: Partial<TournamentRecord['waves'][number]['nodes'][number]> = {},
  ): TournamentRecord['waves'][number]['nodes'][number] {
    return { id, matchId: null, playerAId: a, playerBId: b, winnerId: null, isBye: false, ...patch };
  }

  it('setup 无波次 → 空图', () => {
    const graph = buildBracketGraph(makeRecord(), names, []);
    expect(graph.columns).toEqual([]);
    expect(graph.cardCount).toBe(0);
    expect(graph.completedCount).toBe(0);
  });

  it('双败一阶段按桶拆四列（胜者组 R1 → 败者组 R1 → 胜者组 R2 → 败者组 R2），列内节点按序号排序', () => {
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, {
          status: 'completed',
          nodes: [
            makeNode('s0-w1-n00', 'p0', 'p1', { matchId: 'm1', winnerId: 'p0' }),
            makeNode('s0-w1-n01', 'p2', 'p3', { matchId: 'm2', winnerId: 'p2' }),
            makeNode('s0-w1-n02', 'p4', 'p5', { matchId: 'm3', winnerId: 'p4' }),
            makeNode('s0-w1-n03', 'p6', 'p7', { matchId: 'm4', winnerId: 'p6' }),
          ],
        }),
        makeWave(0, 2, {
          status: 'completed',
          nodes: [
            // 1-0 桶（胜者组 R2）：胜者 2-0 晋级，败者落到 1-1
            makeNode('s0-w2-n00', 'p0', 'p2', { matchId: 'm5', winnerId: 'p0' }),
            makeNode('s0-w2-n01', 'p4', 'p6', { matchId: 'm6', winnerId: 'p4' }),
            // 0-1 桶（败者组 R1）：胜者升到 1-1，败者 0-2 淘汰
            makeNode('s0-w2-n02', 'p1', 'p3', { matchId: 'm7', winnerId: 'p1' }),
            makeNode('s0-w2-n03', 'p5', 'p7', { matchId: 'm8', winnerId: 'p5' }),
          ],
        }),
        makeWave(0, 3, {
          nodes: [
            // 1-1 桶（败者组 R2）
            makeNode('s0-w3-n00', 'p2', 'p1', { matchId: 'm9' }),
            makeNode('s0-w3-n01', 'p6', 'p5', { matchId: 'm10' }),
          ],
        }),
      ],
    });
    const matches = [
      makeMatch('m1', { status: 'completed', leftScore: 2, rightScore: 1 }),
      makeMatch('m2', { status: 'completed' }),
      makeMatch('m3', { status: 'completed' }),
      makeMatch('m4', { status: 'completed' }),
      makeMatch('m5', { status: 'completed', leftScore: 2, rightScore: 0 }),
      makeMatch('m6', { status: 'completed' }),
      makeMatch('m7', { status: 'completed' }),
      makeMatch('m8', { status: 'completed' }),
      makeMatch('m9', { status: 'pending' }),
      makeMatch('m10', { status: 'pending' }),
    ];
    const graph = buildBracketGraph(record, names, matches);

    // 同一波（W2）的 1-0 / 0-1 拆成两列，列序按 胜者组 R1 → 败者组 R1 → 胜者组 R2 → 败者组 R2
    expect(graph.columns.map((column) => column.key)).toEqual([
      '0-1-0-0',
      '0-2-0-1',
      '0-2-1-0',
      '0-3-1-1',
    ]);
    expect(graph.columns.map((column) => column.bucketKey)).toEqual(['0-0', '0-1', '1-0', '1-1']);
    expect(graph.columns.map((column) => column.label)).toEqual([
      '胜者组 R1',
      '败者组 R1',
      '胜者组 R2',
      '败者组 R2 · 决出4强',
    ]);
    expect(graph.columns.map((column) => column.stageName)).toEqual(['8进4', '8进4', '8进4', '8进4']);
    expect(graph.columns[0].formatLabel).toBe('双败');
    expect(graph.columns.map((column) => column.cards.length)).toEqual([4, 2, 2, 2]);

    // 列内按节点序号排序，槽位带名字与阶段内战绩脚注
    expect(graph.columns[0].cards.map((card) => card.nodeId)).toEqual([
      's0-w1-n00',
      's0-w1-n01',
      's0-w1-n02',
      's0-w1-n03',
    ]);
    const first = graph.columns[0].cards[0];
    expect(first.playerA.name).toBe('选手0');
    expect(first.playerA.isWinner).toBe(true);
    expect(first.playerB.isWinner).toBe(false);
    expect(first.statusLabel).toBe('已结束');
    expect(first.playerA.score).toBe('2');
    expect(first.playerB.score).toBe('1');
    expect(first.canForfeit).toBe(false);
    expect(first.isCrossBucket).toBe(false);
    expect(first.playerA.stateText).toBe('1-0 存活');

    // 未建场节点：状态按 winnerId 推断；败者组 R2 未开赛但已建场 → 可弃权
    const pending = graph.columns[3].cards[0];
    expect(pending.status).toBe('pending');
    expect(pending.statusLabel).toBe('待开始');
    expect(pending.playerA.score).toBe('');
    expect(pending.canForfeit).toBe(true);

    expect(graph.cardCount).toBe(10);
    expect(graph.completedCount).toBe(8);
  });

  it('双败：W1 胜者实线进胜者组 R2、败者虚线进败者组 R1', () => {
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, {
          status: 'completed',
          nodes: [
            makeNode('s0-w1-n00', 'p0', 'p1', { matchId: 'm1', winnerId: 'p0' }),
            makeNode('s0-w1-n01', 'p2', 'p3', { matchId: 'm2', winnerId: 'p2' }),
          ],
        }),
        makeWave(0, 2, {
          nodes: [
            makeNode('s0-w2-n00', 'p0', 'p2', { matchId: 'm3' }),
            makeNode('s0-w2-n01', 'p1', 'p3', { matchId: 'm4' }),
          ],
        }),
      ],
    });
    const graph = buildBracketGraph(record, names, [
      makeMatch('m1', { status: 'completed' }),
      makeMatch('m2', { status: 'completed' }),
      makeMatch('m3', { status: 'pending' }),
      makeMatch('m4', { status: 'pending' }),
    ]);

    const fallingPool = graph.columns.find((column) => column.bucketKey === '0-1');
    const risingPool = graph.columns.find((column) => column.bucketKey === '1-0');
    expect(risingPool?.label).toBe('胜者组 R2');
    expect(fallingPool?.label).toBe('败者组 R1');
    expect(risingPool?.cards[0].playerA.name).toBe('选手0');
    expect(risingPool?.cards[0].playerA.from).toEqual({ nodeId: 's0-w1-n00', kind: 'w' });
    expect(fallingPool?.cards[0].playerA.name).toBe('选手1');
    expect(fallingPool?.cards[0].playerA.from).toEqual({ nodeId: 's0-w1-n00', kind: 'l' });
  });

  it('双败：跨桶配对取左位战绩入列并打跨桶标记', () => {
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, {
          status: 'completed',
          nodes: [
            makeNode('s0-w1-n00', 'p0', 'p1', { matchId: 'm1', winnerId: 'p0' }),
            makeNode('s0-w1-n01', 'p2', 'p3', { matchId: 'm2', winnerId: 'p2' }),
          ],
        }),
        makeWave(0, 2, {
          nodes: [
            // 1-0 的 p0 对 0-1 的 p1（战绩不对等）
            makeNode('s0-w2-n00', 'p0', 'p1', { matchId: 'm3' }),
            makeNode('s0-w2-n01', 'p2', 'p3', { matchId: 'm4' }),
          ],
        }),
      ],
    });
    const graph = buildBracketGraph(record, names, [
      makeMatch('m1', { status: 'completed' }),
      makeMatch('m2', { status: 'completed' }),
      makeMatch('m3', { status: 'pending' }),
      makeMatch('m4', { status: 'pending' }),
    ]);

    const crossCard = graph.columns
      .flatMap((column) => column.cards)
      .find((card) => card.nodeId === 's0-w2-n00');
    // 两场都是跨桶且左位均为 1-0 → 一并归入胜者组 R2 列
    expect(crossCard?.isCrossBucket).toBe(true);
    const column = graph.columns.find((item) => item.key === '0-2-1-0');
    expect(column?.cards.map((card) => card.nodeId)).toEqual(['s0-w2-n00', 's0-w2-n01']);
    expect(graph.columns.some((item) => item.key === '0-2-0-1')).toBe(false);
  });

  it('单败跨阶段：胜者实线连到下一阶段出现的节点；首轮登场无连线', () => {
    const record = makeRecord({
      status: 'running',
      currentStageIndex: 1,
      waves: [
        makeWave(1, 1, {
          nodes: [makeNode('s1-w1-n00', 'p0', 'p2', { matchId: 'm3' })],
        }),
        makeWave(0, 1, {
          status: 'completed',
          nodes: [
            makeNode('s0-w1-n00', 'p0', 'p1', { matchId: 'm1', winnerId: 'p0' }),
            makeNode('s0-w1-n01', 'p2', 'p3', { matchId: 'm2', winnerId: 'p2' }),
          ],
        }),
      ],
    });
    const matches = [
      makeMatch('m1', { status: 'completed' }),
      makeMatch('m2', { status: 'completed' }),
      makeMatch('m3', { status: 'pending' }),
    ];
    const graph = buildBracketGraph(record, names, matches);

    // waves 乱序输入 → 列按阶段/波次升序（单败一阶段一列，无桶）
    expect(graph.columns.map((column) => column.key)).toEqual(['0-1-0-0', '1-1-all']);
    expect(graph.columns[1].bucketKey).toBeUndefined();
    // 单败无轮次细分：列标题留空，阶段名由晋级图的分组头承载
    expect(graph.columns[1].label).toBe('');
    expect(graph.columns[1].formatLabel).toBe('单败');
    expect(graph.columns[1].cards[0].playerA.from).toEqual({ nodeId: 's0-w1-n00', kind: 'w' });
    expect(graph.columns[1].cards[0].playerB.from).toEqual({ nodeId: 's0-w1-n01', kind: 'w' });
    // 首轮登场：无入场连线
    expect(graph.columns[0].cards[0].playerA.from).toBeNull();
    expect(graph.columns[0].cards[1].playerB.from).toBeNull();
    // 未开始但已建场 → 可弃权
    expect(graph.columns[1].cards[0].canForfeit).toBe(true);
  });

  it('阶段内战绩写入槽位脚注（已晋级/已淘汰）', () => {
    // p0 连胜两场到 2-0 晋级、p1 两连败 0-2 淘汰；脚注按节点历史累计，不读 entries
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, {
          status: 'completed',
          nodes: [
            makeNode('s0-w1-n00', 'p0', 'p1', { matchId: 'm1', winnerId: 'p0' }),
            makeNode('s0-w1-n01', 'p2', 'p3', { matchId: 'm2', winnerId: 'p2' }),
          ],
        }),
        makeWave(0, 2, {
          status: 'completed',
          nodes: [
            makeNode('s0-w2-n00', 'p0', 'p2', { matchId: 'm3', winnerId: 'p0' }),
            makeNode('s0-w2-n01', 'p1', 'p3', { matchId: 'm4', winnerId: 'p3' }),
          ],
        }),
      ],
    });
    const graph = buildBracketGraph(record, names, [makeMatch('m3', { status: 'completed' })]);

    const promoted = graph.columns.find((column) => column.key === '0-2-1-0')!.cards[0];
    expect(promoted.playerA.stateText).toBe('2-0 已晋级');
    expect(promoted.playerA.isWinner).toBe(true);

    const eliminated = graph.columns.find((column) => column.key === '0-2-0-1')!.cards[0];
    expect(eliminated.playerA.stateText).toBe('0-2 已淘汰');
    expect(eliminated.playerA.isWinner).toBe(false);
  });

  it('阶段推进后回首看过往阶段：脚注仍是该阶段战绩，不显示新阶段的 0-0', () => {
    // stage0（8进4 双败）三个阶段波全部打完 → stage1 已生成，entries 被换成 4 人 0-0/alive
    const record = makeRecord({
      status: 'running',
      currentStageIndex: 1,
      entries: ['p0', 'p4', 'p2', 'p6'].map((playerId): TournamentRecord['entries'][number] => ({
        playerId,
        stageWins: 0,
        stageLosses: 0,
        state: 'alive',
      })),
      waves: [
        makeWave(0, 1, {
          status: 'completed',
          nodes: [
            makeNode('s0-w1-n00', 'p0', 'p1', { matchId: 'm1', winnerId: 'p0' }),
            makeNode('s0-w1-n01', 'p2', 'p3', { matchId: 'm2', winnerId: 'p2' }),
            makeNode('s0-w1-n02', 'p4', 'p5', { matchId: 'm3', winnerId: 'p4' }),
            makeNode('s0-w1-n03', 'p6', 'p7', { matchId: 'm4', winnerId: 'p6' }),
          ],
        }),
        makeWave(0, 2, {
          status: 'completed',
          nodes: [
            makeNode('s0-w2-n00', 'p0', 'p2', { matchId: 'm5', winnerId: 'p0' }),
            makeNode('s0-w2-n01', 'p4', 'p6', { matchId: 'm6', winnerId: 'p4' }),
            makeNode('s0-w2-n02', 'p1', 'p3', { matchId: 'm7', winnerId: 'p1' }),
            makeNode('s0-w2-n03', 'p5', 'p7', { matchId: 'm8', winnerId: 'p5' }),
          ],
        }),
        makeWave(0, 3, {
          status: 'completed',
          nodes: [
            makeNode('s0-w3-n00', 'p2', 'p1', { matchId: 'm9', winnerId: 'p2' }),
            makeNode('s0-w3-n01', 'p6', 'p5', { matchId: 'm10', winnerId: 'p6' }),
          ],
        }),
        makeWave(1, 1, {
          nodes: [
            makeNode('s1-w1-n00', 'p0', 'p4', { matchId: 'm11', winnerId: 'p0' }),
            makeNode('s1-w1-n01', 'p2', 'p6', { matchId: 'm12' }),
          ],
        }),
      ],
    });
    const graph = buildBracketGraph(record, names, []);
    const cardOf = (columnKey: string, nodeId: string) =>
      graph.columns.find((column) => column.key === columnKey)?.cards.find((card) => card.nodeId === nodeId);

    // 决胜波（败者组 R2）：胜者 2-1 已晋级、败者 1-2 已淘汰（此前会显示成 0-0 存活 / 空白）
    expect(cardOf('0-3-1-1', 's0-w3-n00')?.playerA.stateText).toBe('2-1 已晋级');
    expect(cardOf('0-3-1-1', 's0-w3-n00')?.playerB.stateText).toBe('1-2 已淘汰');
    // 胜者组 R2 败者停在 1-1；败者组 R1 败者 0-2 淘汰
    expect(cardOf('0-2-1-0', 's0-w2-n00')?.playerB.stateText).toBe('1-1 存活');
    expect(cardOf('0-2-0-1', 's0-w2-n02')?.playerB.stateText).toBe('0-2 已淘汰');
    // 下一阶段（单败）：已打完 1-0 已晋级 / 0-1 已淘汰，未开打 0-0 存活
    expect(cardOf('1-1-all', 's1-w1-n00')?.playerA.stateText).toBe('1-0 已晋级');
    expect(cardOf('1-1-all', 's1-w1-n00')?.playerB.stateText).toBe('0-1 已淘汰');
    expect(cardOf('1-1-all', 's1-w1-n01')?.playerA.stateText).toBe('0-0 存活');
  });

  it('draft 波：候选配对解析成名字只读展示，节点为空', () => {
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, {
          pairingStatus: 'draft',
          pairingDraft: [
            { bucketKey: '0-0', pair: ['p0', 'p1'] },
            { bucketKey: '0-0', pair: ['p2', null] },
          ],
        }),
      ],
    });
    const graph = buildBracketGraph(record, names, []);

    const column = graph.columns[0];
    expect(column.pairingStatus).toBe('draft');
    expect(column.bucketKey).toBe('0-0');
    expect(column.label).toBe('胜者组 R1');
    expect(column.cards).toEqual([]);
    expect(column.draftPairs).toEqual([
      { bucketKey: '0-0', a: '选手0', b: '选手1' },
      { bucketKey: '0-0', a: '选手2', b: '' },
    ]);
  });

  it('draft 波：草稿按各自桶 key 拆到对应轮次列', () => {
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 2, {
          pairingStatus: 'draft',
          pairingDraft: [
            { bucketKey: '1-0', pair: ['p0', 'p1'] },
            { bucketKey: '0-1', pair: ['p2', 'p3'] },
          ],
        }),
      ],
    });
    const graph = buildBracketGraph(record, names, []);

    expect(graph.columns.map((column) => column.bucketKey)).toEqual(['0-1', '1-0']);
    expect(graph.columns.map((column) => column.label)).toEqual(['败者组 R1', '胜者组 R2']);
    expect(graph.columns[0].draftPairs).toEqual([{ bucketKey: '0-1', a: '选手2', b: '选手3' }]);
    expect(graph.columns[1].draftPairs).toEqual([{ bucketKey: '1-0', a: '选手0', b: '选手1' }]);
  });

  it('无关联比赛的节点按 winnerId 推断状态，比分留空', () => {
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, {
          nodes: [
            makeNode('s0-w1-n00', 'p0', 'p1', { winnerId: 'p1' }),
            makeNode('s0-w1-n01', 'p2', 'p3'),
          ],
        }),
      ],
    });
    const graph = buildBracketGraph(record, names, []);
    const [settled, pending] = graph.columns[0].cards;
    expect(settled.status).toBe('completed');
    expect(settled.playerB.isWinner).toBe(true);
    expect(settled.playerA.score).toBe('');
    expect(pending.statusLabel).toBe('待开始');
    expect(pending.playerA.score).toBe('');
    expect(pending.canForfeit).toBe(false);
    expect(graph.completedCount).toBe(1);
  });
});

describe('buildWaveCards / getWaveRoundLabels（波次列表与晋级图同源）', () => {
  const names = new Map(
    Array.from({ length: 8 }, (_unused, index) => [`p${index}`, `选手${index}`] as [string, string]),
  );

  function node(
    id: string,
    a: string | null,
    b: string | null,
    patch: Partial<TournamentWave['nodes'][number]> = {},
  ): TournamentWave['nodes'][number] {
    return { id, matchId: null, playerAId: a, playerBId: b, winnerId: null, isBye: false, ...patch };
  }

  it('轮次表述：双败按战绩桶给胜者组/败者组 R1·R2，单败返回空数组', () => {
    const record = makeRecord({ status: 'running' });
    expect(getWaveRoundLabels(record, makeWave(0, 1))).toEqual(['胜者组 R1']);
    expect(getWaveRoundLabels(record, makeWave(0, 2))).toEqual(['败者组 R1', '胜者组 R2']);
    expect(getWaveRoundLabels(record, makeWave(0, 3))).toEqual(['败者组 R2']);
    // 8 人模板 stage1 = 4进2（单败），无轮次名，直接用阶段名
    expect(getWaveRoundLabels(record, makeWave(1, 1))).toEqual([]);
  });

  it('配对方式中文表述：与创建向导一致', () => {
    expect(getPairingLabel('random-bucket')).toBe('随机配对');
    expect(getPairingLabel('manual-bucket')).toBe('手动配对');
    expect(getPairingLabel('random-round')).toBe('每轮随机');
    expect(getPairingLabel('bracket-seed')).toBe('沿对阵树');
  });

  it('单波卡片与晋级图同源：按节点序号排序、带桶标记与每槽比分', () => {
    const record = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, {
          status: 'completed',
          nodes: [
            node('s0-w1-n00', 'p0', 'p1', { matchId: 'm1', winnerId: 'p0' }),
            node('s0-w1-n01', 'p2', 'p3', { matchId: 'm2', winnerId: 'p2' }),
          ],
        }),
        makeWave(0, 2, {
          nodes: [
            node('s0-w2-n01', 'p2', 'p3', { matchId: 'm4' }),
            node('s0-w2-n00', 'p0', 'p1', { matchId: 'm3' }),
          ],
        }),
      ],
    });
    const matches = [
      makeMatch('m1', { status: 'completed', leftScore: 2, rightScore: 1 }),
      makeMatch('m2', { status: 'completed' }),
      makeMatch('m3', { status: 'pending' }),
      makeMatch('m4', { status: 'pending' }),
    ];

    const cards = buildWaveCards(record, record.waves[1], names, matches);
    // 乱序输入 → 按节点序号排序
    expect(cards.map((card) => card.nodeId)).toEqual(['s0-w2-n00', 's0-w2-n01']);
    // p0（1-0）对 p1（0-1）为跨桶
    expect(cards[0].isCrossBucket).toBe(true);
    expect(cards[0].playerA.from).toEqual({ nodeId: 's0-w1-n00', kind: 'w' });
    expect(cards[0].playerA.score).toBe('');
    expect(cards[0].canForfeit).toBe(true);

    // 同一波经晋级图渲染出的卡片与之完全一致（内容与样式同源）
    const graph = buildBracketGraph(record, names, matches);
    expect(buildWaveCards(record, record.waves[0], names, matches)).toEqual(graph.columns[0].cards);
  });
});

describe('getPlayerStateText', () => {
  it('按赛制与阶段内战绩生成中文脚注；无战绩返回空串', () => {
    expect(getPlayerStateText('double-life', { wins: 2, losses: 0 })).toBe('2-0 已晋级');
    expect(getPlayerStateText('double-life', { wins: 0, losses: 2 })).toBe('0-2 已淘汰');
    expect(getPlayerStateText('double-life', { wins: 1, losses: 0 })).toBe('1-0 存活');
    expect(getPlayerStateText('double-life', { wins: 1, losses: 1 })).toBe('1-1 存活');
    expect(getPlayerStateText('single-elim', { wins: 1, losses: 0 })).toBe('1-0 已晋级');
    expect(getPlayerStateText('single-elim', { wins: 0, losses: 1 })).toBe('0-1 已淘汰');
    expect(getPlayerStateText('single-elim', { wins: 0, losses: 0 })).toBe('0-0 存活');
    expect(getPlayerStateText('double-life', undefined)).toBe('');
  });
});

describe('buildPushCandidateGroups（选场弹窗候选分组）', () => {
  /** 节点构造（本文件内共用字段形态） */
  function node(
    id: string,
    matchId: string,
    a: string,
    b: string,
    winnerId: string | null = null,
  ): TournamentWave['nodes'][number] {
    return { id, matchId, playerAId: a, playerBId: b, winnerId, isBye: false };
  }

  const record = makeRecord({
    status: 'running',
    waves: [
      makeWave(0, 1, {
        nodes: [
          node('s0-w1-n00', 'm1', 'p0', 'p1', 'p0'),
          node('s0-w1-n01', 'm2', 'p2', 'p3', 'p2'),
        ],
      }),
      makeWave(0, 2, {
        nodes: [
          // 1-0 池（双方首轮均胜）
          node('s0-w2-n00', 'm3', 'p0', 'p2'),
          // 0-1 池（双方首轮均负）
          node('s0-w2-n01', 'm4', 'p1', 'p3'),
        ],
      }),
      makeWave(0, 3, { nodes: [node('s0-w3-n00', 'm5', 'p1', 'p2')] }),
      makeWave(1, 1, { nodes: [node('s1-w1-n00', 'm6', 'p0', 'p2')] }),
      makeWave(2, 1, { nodes: [node('s2-w1-n00', 'm7', 'p0', 'p2')] }),
    ],
  });

  function ref(nodeId: string, stageIndex: number, waveIndex: number) {
    return { tournamentId: record.id, nodeId, stageIndex, waveIndex };
  }

  it('系列赛按 阶段+语义轮次 分组、普通对局与孤儿引用一组；组序按组内首场位置', () => {
    const matches = [
      makeMatch('m7', { tournamentRef: ref('s2-w1-n00', 2, 1) }), // 总决赛（单败）
      makeMatch('m3', { tournamentRef: ref('s0-w2-n00', 0, 2) }), // 胜者组 R2
      makeMatch('m5', { tournamentRef: ref('s0-w3-n00', 0, 3) }), // 败者组 R2（决胜）
      makeMatch('m1', { tournamentRef: ref('s0-w1-n00', 0, 1) }), // 胜者组 R1
      makeMatch('normal-1'), // 普通对局
      makeMatch('m4', { tournamentRef: ref('s0-w2-n01', 0, 2) }), // 败者组
      makeMatch('orphan-1', {
        tournamentRef: { tournamentId: 'T19990101_A99', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
      }),
    ];

    const groups = buildPushCandidateGroups(matches, [record]);

    expect(groups.map((group) => group.title)).toEqual([
      '🏆 夏季杯S1 · 总决赛',
      '🏆 夏季杯S1 · 8进4 · 胜者组 R2',
      '🏆 夏季杯S1 · 8进4 · 败者组 R2',
      '🏆 夏季杯S1 · 8进4 · 胜者组 R1',
      '普通对局',
      '🏆 夏季杯S1 · 8进4 · 败者组 R1',
    ]);
    expect(groups.map((group) => group.matches.map((match) => match.id))).toEqual([
      ['m7'],
      ['m3'],
      ['m5'],
      ['m1'],
      ['normal-1', 'orphan-1'],
      ['m4'],
    ]);
  });

  it('跨桶配对拿不到一致池归属：按波次归组、标题退回阶段名', () => {
    const crossRecord = makeRecord({
      status: 'running',
      waves: [
        makeWave(0, 1, { nodes: [node('s0-w1-n00', 'm1', 'p0', 'p1', 'p0')] }),
        // p0（首轮胜）对 p1（首轮负）：战绩不对等
        makeWave(0, 2, { nodes: [node('s0-w2-n00', 'm2', 'p0', 'p1')] }),
      ],
    });
    const groups = buildPushCandidateGroups(
      [makeMatch('m2', {
        tournamentRef: { tournamentId: crossRecord.id, nodeId: 's0-w2-n00', stageIndex: 0, waveIndex: 2 },
      })],
      [crossRecord],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('🏆 夏季杯S1 · 8进4');
    expect(groups[0].key).toBe(`${crossRecord.id}:0:wave2`);
  });

  it('无系列赛数据 / 空列表：全部归入普通对局组、空输入返回空数组', () => {
    const groups = buildPushCandidateGroups([makeMatch('a'), makeMatch('b')], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('普通对局');
    expect(groups[0].matches.map((match) => match.id)).toEqual(['a', 'b']);
    expect(buildPushCandidateGroups([], [])).toEqual([]);
  });
});

describe('季军赛（附加波次的展示口径）', () => {
  function node(
    id: string,
    matchId: string,
    a: string,
    b: string,
    winnerId: string | null = null,
  ): TournamentWave['nodes'][number] {
    return { id, matchId, playerAId: a, playerBId: b, winnerId, isBye: false };
  }

  /**
   * 8 人模板 + 半决赛（4进2 单败）打完 + 季军赛：
   * p0/p2 晋级决赛，p1/p3 打季军赛（p1 胜）。
   */
  const record = makeRecord({
    status: 'running',
    currentStageIndex: 2,
    thirdPlaceBestOf: 3,
    entries: [
      { playerId: 'p0', stageWins: 0, stageLosses: 0, state: 'alive' },
      { playerId: 'p2', stageWins: 0, stageLosses: 0, state: 'alive' },
    ],
    waves: [
      makeWave(1, 1, {
        status: 'completed',
        nodes: [
          node('s1-w1-n00', 'm1', 'p0', 'p1', 'p0'),
          node('s1-w1-n01', 'm2', 'p2', 'p3', 'p2'),
        ],
      }),
      makeWave(1, 2, {
        status: 'running',
        kind: 'third-place',
        nodes: [node('s1-w2-n00', 'm3', 'p1', 'p3', 'p1')],
      }),
      makeWave(2, 1, { nodes: [node('s2-w1-n00', 'm4', 'p0', 'p2')] }),
    ],
  });

  const names = new Map([['p0', '甲'], ['p1', '乙'], ['p2', '丙'], ['p3', '丁']]);

  it('晋级图：季军赛自成一列，排在所属阶段主赛之后、下一阶段之前', () => {
    const graph = buildBracketGraph(record, names, []);
    const keys = graph.columns.map((column) => `${column.stageIndex}-${column.waveIndex}`);
    expect(keys).toEqual(['1-1', '1-2', '2-1']);

    const third = graph.columns.find((column) => column.isThirdPlace)!;
    expect(third.stageName).toBe(THIRD_PLACE_LABEL);
    expect(third.formatLabel).toBe('单败');
    // 不套轮次标题（否则会按波次序号被标成「败者组 R2 · 决出2强」）
    expect(third.label).toBe('');
    expect(graph.columns.filter((column) => column.isThirdPlace)).toHaveLength(1);
  });

  it('卡片脚注给名次而不是阶段战绩（不给「已晋级」，也不标跨桶）', () => {
    const graph = buildBracketGraph(record, names, []);
    const card = graph.columns.find((column) => column.isThirdPlace)!.cards[0];
    expect(card.playerA.stateText).toBe('季军');
    expect(card.playerA.isWinner).toBe(true);
    expect(card.playerB.stateText).toBe('殿军');
    expect(card.isCrossBucket).toBe(false);
    // 未决出时不给名次
    expect(getThirdPlaceRankText({ winnerId: null }, 'p1')).toBe('');
    expect(getThirdPlaceRankText({ winnerId: null }, null)).toBe('');
  });

  it('波次列表：季军赛没有轮次标注；标签与统计不并入半决赛阶段', () => {
    const third = findThirdPlaceWave(record)!;
    expect(getWaveRoundLabels(record, third)).toEqual([]);
    expect(formatStageRoundLabel(record, {
      tournamentId: record.id,
      nodeId: 's1-w2-n00',
      stageIndex: 1,
      waveIndex: 2,
    })).toBe(THIRD_PLACE_LABEL);
    expect(isThirdPlaceRef(record, {
      tournamentId: record.id,
      nodeId: 's1-w2-n00',
      stageIndex: 1,
      waveIndex: 2,
    })).toBe(true);
    // 半决赛阶段只算它自己的 2 场；当前波仍是总决赛，不因季军赛的波次序号变成「第 2 波」
    expect(summarizeStageMatches(record, 1)).toEqual({ completed: 2, total: 2 });
    expect(getCurrentPositionText({ ...record, currentStageIndex: 1 })).toBe('4进2 · 第 1 波');
    expect(findThirdPlaceWave(makeRecord())).toBeNull();
  });
});

describe('双机同步：编排机判定（与服务端同口径）', () => {
  it('解析 id 机器码并按本机机器码判定所有权', () => {
    expect(getTournamentOwnerCode('T20260929_A01')).toBe('A');
    expect(getTournamentOwnerCode('T20260929_AB12')).toBe('AB');
    expect(getTournamentOwnerCode('T20260929_01')).toBe('');
    expect(getTournamentOwnerCode('not-an-id')).toBeNull();

    expect(isTournamentOwnedByLocal('T20260929_A01', 'A')).toBe(true);
    expect(isTournamentOwnedByLocal('T20260929_A01', 'a')).toBe(true);
    expect(isTournamentOwnedByLocal('T20260929_A01', 'B')).toBe(false);
    // 未设置机器标识（两侧都为空）时按本机编排处理，保持单机既有行为
    expect(isTournamentOwnedByLocal('T20260929_01', '')).toBe(true);
    expect(isTournamentOwnedByLocal('T20260929_01', 'B')).toBe(false);
  });
});

describe('晋级积分榜：阶段参赛人数与场次统计', () => {
  it('参赛人数按引擎口径逐阶段减半（64 人首阶段 64 人）', () => {
    const record = makeRecord({ playerIds: Array.from({ length: 64 }, (_v, i) => `p${i}`), stages: buildDefaultStages(64) }, 64);
    expect(getStagePlayerCount(record, 0)).toBe(64);
    expect(getStagePlayerCount(record, 1)).toBe(32);
    expect(getStagePlayerCount(record, 2)).toBe(16);
    expect(getStagePlayerCount(record, 5)).toBe(2);
    // 超出对阵树的阶段（人数不足 1）按 0 处理，不出现 0.5 人这类文案
    expect(getStagePlayerCount(record, 6)).toBe(1);
    expect(getStagePlayerCount(record, 7)).toBe(0);
    expect(getStagePlayerCount(record, -1)).toBe(0);
  });

  it('场次统计只数本阶段节点，已决出胜负的计 completed', () => {
    const record = makeRecord({
      waves: [
        makeWave(0, 1, {
          nodes: [
            { id: 's0-w1-n01', matchId: 'm1', playerAId: 'p0', playerBId: 'p1', winnerId: 'p0', isBye: false },
            { id: 's0-w1-n02', matchId: 'm2', playerAId: 'p2', playerBId: 'p3', winnerId: null, isBye: false },
          ],
        }),
        makeWave(0, 2, {
          nodes: [
            { id: 's0-w2-n01', matchId: 'm3', playerAId: 'p0', playerBId: 'p2', winnerId: 'p2', isBye: false },
          ],
        }),
        makeWave(1, 1, {
          nodes: [
            { id: 's1-w1-n01', matchId: 'm4', playerAId: 'p0', playerBId: 'p1', winnerId: 'p0', isBye: false },
          ],
        }),
      ],
    });

    expect(summarizeStageMatches(record, 0)).toEqual({ completed: 2, total: 3 });
    expect(summarizeStageMatches(record, 1)).toEqual({ completed: 1, total: 1 });
    expect(summarizeStageMatches(record, 2)).toEqual({ completed: 0, total: 0 });
  });
});
