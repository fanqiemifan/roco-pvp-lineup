import { describe, expect, it } from 'vitest';

import {
  buildLineupTemplateCsv,
  parseLineupJsonText,
  parseLineupSheetText,
} from '../../src/admin-antd/lib/lineup-sheet';
import type {
  GameRecord,
  MatchRecord,
  MatchSlotSnapshot,
  SpriteRecord,
  StageRule,
  TournamentRecord,
  TournamentWave,
} from '../../shared/types';

/* ---------- 夹具 ---------- */

function makeSlot(slot: number, petId: string | null): MatchSlotSnapshot {
  return {
    slot,
    pet_id: petId,
    name: '',
    form: '',
    opacityEnabled: false,
    opacity: 0.5,
    saturation: 1,
    healthEnabled: true,
    healthPercent: 100,
    energyValue: 10,
  };
}

function makeGame(
  left: Array<string | null>,
  right: Array<string | null>,
  patch: Partial<GameRecord> = {},
): GameRecord {
  return {
    gameNumber: 1,
    leftLineup: left.filter((value): value is string => Boolean(value)),
    rightLineup: right.filter((value): value is string => Boolean(value)),
    leftSlots: Array.from({ length: 6 }, (_unused, index) => makeSlot(index, left[index] ?? null)),
    rightSlots: Array.from({ length: 6 }, (_unused, index) => makeSlot(index, right[index] ?? null)),
    winner: null,
    status: 'pending',
    ...patch,
  };
}

function makeMatch(id: string, patch: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id,
    createdAt: '',
    updatedAt: '',
    status: 'pending',
    leftPlayer: '小明',
    rightPlayer: '小红',
    leftRank: '',
    rightRank: '',
    leftTeamId: '',
    leftTeamName: '',
    rightTeamId: '',
    rightTeamName: '',
    bestOf: 1,
    games: [makeGame([], [])],
    leftScore: 0,
    rightScore: 0,
    winner: null,
    completedAt: null,
    tags: [],
    ...patch,
  };
}

function makeSprite(id: string, displayName: string): SpriteRecord {
  return {
    id,
    filename: `${id}_${displayName}.png`,
    displayName,
    name: displayName,
    path: `/img/${id}_${displayName}.png`,
    aliases: [],
    number: null,
    attribute: '',
    attributeCodes: [],
    attributeIcon1: '',
    attributeIcon2: '',
    iconUrl: '',
    form: '',
    petForm: '',
    isFinalForm: false,
  };
}

const STAGES: StageRule[] = [
  { id: 's0', name: '4进2', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed', avoidRematch: false, requireConfirm: false },
  { id: 's1', name: '总决赛', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed', avoidRematch: false, requireConfirm: false },
];

function makeWave(stageIndex: number, waveIndex: number, matchIds: string[]): TournamentWave {
  return {
    stageIndex,
    waveIndex,
    status: 'running',
    pairingStatus: 'locked',
    nodes: matchIds.map((matchId, index) => ({
      id: `s${stageIndex}-w${waveIndex}-n0${index}`,
      matchId,
      playerAId: 'p0',
      playerBId: 'p1',
      winnerId: null,
      isBye: false,
    })),
  };
}

function makeRecord(patch: Partial<TournamentRecord> = {}): TournamentRecord {
  return {
    id: 'T20260928_A01',
    name: '秋杯',
    createdAt: '',
    updatedAt: '',
    status: 'running',
    seed: 7,
    drawVersion: 0,
    playerIds: ['p0', 'p1', 'p2', 'p3'],
    stages: STAGES,
    currentStageIndex: 1,
    entries: [],
    waves: [makeWave(0, 1, ['20260928_A001', '20260928_A002']), makeWave(1, 1, ['20260928_A003'])],
    ...patch,
  };
}

/* ---------- parseLineupSheetText ---------- */

describe('parseLineupSheetText（表格回填 → 规范化对局）', () => {
  it('标准 CSV（带引号）：按「对局ID + 位置」两行配对，两侧全空的对局被过滤', () => {
    const text = [
      '"系列赛","阶段","对局ID","位置","选手","精灵1","精灵2","精灵3","精灵4","精灵5","精灵6"',
      '"秋杯","4进2","20260928_A001","左","小明","迪莫","3004 圣光迪莫","鸭吉吉","","",""',
      '"秋杯","4进2","20260928_A001","右","小红","雪绒鸟","","","","",""',
      '"秋杯","4进2","20260928_A002","左","阿宽","","","","","",""',
    ].join('\n');

    const result = parseLineupSheetText(text);
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { matchId: '20260928_A001', left: ['迪莫', '3004 圣光迪莫', '鸭吉吉'], right: ['雪绒鸟'] },
    ]);
  });

  it('TSV 粘贴：位置列容错（左侧 / right），列数不足也能解析', () => {
    const text = [
      '系列赛\t阶段\t对局ID\t位置\t选手\t精灵1\t精灵2',
      '秋杯\t4进2\t20260928_A001\t左侧\t小明\t迪莫\t圣光迪莫',
      '秋杯\t4进2\t20260928_A001\tright\t小红\t雪绒鸟\t',
    ].join('\n');

    const result = parseLineupSheetText(text);
    expect(result.entries).toEqual([
      { matchId: '20260928_A001', left: ['迪莫', '圣光迪莫'], right: ['雪绒鸟'] },
    ]);
  });

  it('同场同侧多行：黄标提示并采用最后一行', () => {
    const text = [
      '对局ID,位置,选手,精灵1,精灵2,精灵3,精灵4,精灵5,精灵6',
      '20260928_A001,左,小明,迪莫,,,,,',
      '20260928_A001,左,小明,怖哭菇,,,,,',
    ].join('\n');

    const result = parseLineupSheetText(text);
    expect(result.entries).toEqual([{ matchId: '20260928_A001', left: ['怖哭菇'], right: null }]);
    expect(result.warnings.some((item) => item.includes('仅采用最后一行'))).toBe(true);
  });

  it('格内多值展开：逗号 / 顿号 / 空格拆分；「数字 + 空格 + 名字」保持完整', () => {
    const text = [
      '对局ID,位置,选手,精灵1,精灵2,精灵3,精灵4,精灵5,精灵6',
      '20260928_A001,左,小明,"迪莫、圣光迪莫 怖哭菇","3004 圣光迪莫",,,,,',
    ].join('\n');

    const result = parseLineupSheetText(text);
    expect(result.entries).toEqual([
      {
        matchId: '20260928_A001',
        left: ['迪莫', '圣光迪莫', '怖哭菇', '3004 圣光迪莫'],
        right: null,
      },
    ]);
  });

  it('位置列无法识别 → 忽略该行并给出警示；表头缺列 → 整份报错', () => {
    const ignoreResult = parseLineupSheetText([
      '对局ID,位置,选手,精灵1,精灵2,精灵3,精灵4,精灵5,精灵6',
      '20260928_A001,中间,小明,迪莫,,,,,',
    ].join('\n'));
    expect(ignoreResult.entries).toEqual([]);
    expect(ignoreResult.warnings.some((item) => item.includes('无法识别'))).toBe(true);
    expect(ignoreResult.errors.length).toBeGreaterThan(0);

    const headerResult = parseLineupSheetText('阶段,对局ID,选手\n4进2,20260928_A001,小明');
    expect(headerResult.entries).toEqual([]);
    expect(headerResult.errors.some((item) => item.includes('表头缺少可识别列'))).toBe(true);
  });
});

/* ---------- parseLineupJsonText ---------- */

describe('parseLineupJsonText（JSON 回填 → 规范化对局）', () => {
  it('对局分组式：null / 短写 / 空串按语义归一', () => {
    const text = JSON.stringify({
      tournamentId: 'T20260928_A01',
      rows: [
        {
          matchId: '20260928_A001',
          left: ['迪莫', '3004 圣光迪莫', null, '', null, null],
          right: ['雪绒鸟'],
        },
        { matchId: '20260928_A002', left: ['怖哭菇'], right: null },
      ],
    });

    const result = parseLineupJsonText(text, 'T20260928_A01');
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { matchId: '20260928_A001', left: ['迪莫', '3004 圣光迪莫'], right: ['雪绒鸟'] },
      { matchId: '20260928_A002', left: ['怖哭菇'], right: null },
    ]);
  });

  it('tournamentId 与目标系列赛不一致 → 整份拒绝', () => {
    const text = JSON.stringify({
      tournamentId: 'T20260928_B01',
      rows: [{ matchId: '20260928_A001', left: ['迪莫'] }],
    });
    const result = parseLineupJsonText(text, 'T20260928_A01');
    expect(result.entries).toEqual([]);
    expect(result.errors.some((item) => item.includes('与目标系列赛不一致'))).toBe(true);
  });

  it('兼容顶层数组；非法 JSON / 缺 rows / 无内容给出明确报错', () => {
    const arrayResult = parseLineupJsonText(
      JSON.stringify([{ matchId: '20260928_A001', right: ['雪绒鸟'] }]),
    );
    expect(arrayResult.entries).toEqual([{ matchId: '20260928_A001', left: null, right: ['雪绒鸟'] }]);

    expect(parseLineupJsonText('{bad json').errors.length).toBeGreaterThan(0);
    expect(parseLineupJsonText(JSON.stringify({ foo: 1 })).errors.some((item) => item.includes('rows'))).toBe(true);
    expect(
      parseLineupJsonText(JSON.stringify({ rows: [{ matchId: '20260928_A001' }] }))
        .errors.length,
    ).toBeGreaterThan(0);
  });
});

/* ---------- buildLineupTemplateCsv ---------- */

describe('buildLineupTemplateCsv（模板生成：一场两行）', () => {
  const sprites = [makeSprite('1001', '暮星辰'), makeSprite('2001', '怖哭菇')];
  const record = makeRecord();
  const ref = (stageIndex: number, nodeId: string) => ({
    tournamentId: 'T20260928_A01',
    nodeId,
    stageIndex,
    waveIndex: 1,
  });
  const matches = [
    makeMatch('20260928_A001', {
      tournamentRef: ref(0, 's0-w1-n00'),
      games: [makeGame(['1001'], ['2001'])],
    }),
    // 第 1 局已开始 → 不导出
    makeMatch('20260928_A002', {
      tournamentRef: ref(0, 's0-w1-n01'),
      games: [makeGame([], [], { status: 'in_progress' })],
    }),
    // 第 2 阶段（下一波）待开始 → 可导出
    makeMatch('20260928_A003', { tournamentRef: ref(1, 's1-w1-n00') }),
  ];

  it('整届：只收待开始且第 1 局未开赛的对局，一场两行并回显已有阵容', () => {
    const { csv, count } = buildLineupTemplateCsv({ record, matches, sprites, scope: { kind: 'all' } });
    expect(count).toBe(2);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1 + 2 * 2);
    expect(lines[0]).toContain('"对局ID"');
    expect(csv).toContain('"20260928_A001"');
    expect(csv).toContain('"20260928_A003"');
    // 左行回显暮星辰（displayName），右行回显怖哭菇
    const leftRow = lines.find((line) => line.includes('20260928_A001') && line.includes('"左"'));
    expect(leftRow).toContain('"暮星辰"');
    const rightRow = lines.find((line) => line.includes('20260928_A001') && line.includes('"右"'));
    expect(rightRow).toContain('"怖哭菇"');
    // 第 1 局已开始的场不出现
    expect(csv).not.toContain('20260928_A002');
  });

  it('范围过滤：按阶段 / 仅当前波（最新一波）', () => {
    const stage0 = buildLineupTemplateCsv({ record, matches, sprites, scope: { kind: 'stage', stageIndex: 0 } });
    expect(stage0.count).toBe(1);
    expect(stage0.csv).toContain('"20260928_A001"');

    const stage1 = buildLineupTemplateCsv({ record, matches, sprites, scope: { kind: 'stage', stageIndex: 1 } });
    expect(stage1.count).toBe(1);
    expect(stage1.csv).toContain('"20260928_A003"');

    const latest = buildLineupTemplateCsv({ record, matches, sprites, scope: { kind: 'current-wave' } });
    expect(latest.count).toBe(1);
    expect(latest.csv).toContain('"20260928_A003"');
    expect(latest.csv).not.toContain('"20260928_A001"');
  });

  it('阶段列输出语义轮次（单败仅阶段名；双败带分组）', () => {
    const { csv } = buildLineupTemplateCsv({ record, matches, sprites, scope: { kind: 'all' } });
    expect(csv).toContain('"4进2"');
    expect(csv).toContain('"总决赛"');
  });
});