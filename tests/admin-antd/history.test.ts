import { describe, expect, it } from 'vitest';

import type {
  GameRecord,
  MatchRecord,
  MatchSlotSnapshot,
  TournamentRecord,
} from '../../shared/types';
import {
  buildHistoryTournamentFilters,
  countPushRows,
  filterLocallyRemovedMatches,
  getEffectiveTournamentId,
  getHistoryVisibleGames,
  getLineupEntryBlockReason,
  LINEUP_ENTRY_BLOCK_TEXT,
} from '../../src/admin-antd/lib/history';

function makeSlot(index: number, petId: string | null = null): MatchSlotSnapshot {
  return {
    slot: index,
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

function makeGame(gameNumber: number, status: GameRecord['status'], lineup: string[] = []): GameRecord {
  return {
    gameNumber,
    status,
    winner: null,
    leftLineup: lineup,
    rightLineup: [],
    leftSlots: lineup.map((petId, index) => makeSlot(index, petId)),
    rightSlots: Array.from({ length: 6 }, (_, index) => makeSlot(index)),
  };
}

function makeMatch(games: GameRecord[], overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'm1',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    status: 'pending',
    leftPlayer: '甲',
    rightPlayer: '乙',
    leftRank: '',
    rightRank: '',
    leftTeamId: '',
    leftTeamName: '',
    rightTeamId: '',
    rightTeamName: '',
    bestOf: 3,
    games,
    leftScore: 0,
    rightScore: 0,
    winner: null,
    completedAt: null,
    tags: [],
    ...overrides,
  };
}

describe('getLineupEntryBlockReason', () => {
  it('当前小局待开始 → 可录入（null）', () => {
    const match = makeMatch([makeGame(1, 'pending')]);
    expect(getLineupEntryBlockReason(match, match.games[0])).toBeNull();
  });

  it('比赛已完赛 → match-completed', () => {
    const match = makeMatch([makeGame(1, 'completed')], { status: 'completed', winner: 'left' });
    expect(getLineupEntryBlockReason(match, match.games[0])).toBe('match-completed');
  });

  it('还没轮到的小局 → game-not-current', () => {
    const match = makeMatch([makeGame(1, 'pending'), makeGame(2, 'pending')]);
    expect(getLineupEntryBlockReason(match, match.games[1])).toBe('game-not-current');
  });

  it('当前小局进行中 → game-started', () => {
    const match = makeMatch([makeGame(1, 'in_progress'), makeGame(2, 'pending')]);
    expect(getLineupEntryBlockReason(match, match.games[0])).toBe('game-started');
  });

  it('进行中之后的空小局 → game-not-current', () => {
    const match = makeMatch([makeGame(1, 'in_progress'), makeGame(2, 'pending')]);
    expect(getLineupEntryBlockReason(match, match.games[1])).toBe('game-not-current');
  });
});

describe('getHistoryVisibleGames', () => {
  it('全新比赛：唯一的空当前小局也可见（否则无处录入阵容）', () => {
    const match = makeMatch([makeGame(1, 'pending')]);
    expect(getHistoryVisibleGames(match)).toHaveLength(1);
  });

  it('还没轮到的空小局隐藏', () => {
    const match = makeMatch([
      makeGame(1, 'pending', ['pet-1']),
      makeGame(2, 'pending'),
    ]);
    const visible = getHistoryVisibleGames(match);
    expect(visible).toHaveLength(1);
    expect(visible[0].gameNumber).toBe(1);
  });

  it('进行中小局之后的空小局隐藏', () => {
    const match = makeMatch([makeGame(1, 'in_progress'), makeGame(2, 'pending')]);
    expect(getHistoryVisibleGames(match)).toHaveLength(1);
  });

  it('完赛比赛：待开始的空小局一律不显示', () => {
    const match = makeMatch([makeGame(1, 'completed'), makeGame(2, 'pending')], {
      status: 'completed',
      winner: 'left',
    });
    const visible = getHistoryVisibleGames(match);
    expect(visible).toHaveLength(1);
    expect(visible[0].gameNumber).toBe(1);
  });
});

/** 最小系列赛夹具（纯函数只用 id/name） */
function makeTournament(id: string, name: string): TournamentRecord {
  return { id, name } as TournamentRecord;
}

describe('countPushRows（战绩详情选场规模估算）', () => {
  it('按每场「已展示小局」数累加（一场一个已打小局 = 一行）', () => {
    const match = makeMatch([makeGame(1, 'completed', ['pet-1']), makeGame(2, 'pending')]);
    expect(countPushRows([match])).toBe(1);
  });

  it('多场累加：整届选中时用来折算屏数（一屏 4 行）', () => {
    const matches = [1, 2, 3].map((index) => makeMatch([
      makeGame(1, 'completed', [`pet-${index}`]),
      makeGame(2, 'completed', [`pet-${index}`]),
    ]));
    expect(countPushRows(matches)).toBe(6);
    expect(Math.ceil(countPushRows(matches) / 4)).toBe(2);
  });

  it('空列表 = 0 行（画面只有占位行）', () => {
    expect(countPushRows([])).toBe(0);
  });
});

describe('getEffectiveTournamentId', () => {
  it('普通对局（无 tournamentRef）→ null', () => {
    const match = makeMatch([makeGame(1, 'pending')]);
    expect(getEffectiveTournamentId(match, new Set(['T20260928_A01']))).toBeNull();
  });

  it('有关联且系列赛存在 → 返回系列赛 id', () => {
    const match = makeMatch([makeGame(1, 'pending')], {
      tournamentRef: { tournamentId: 'T20260928_A01', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
    });
    expect(getEffectiveTournamentId(match, new Set(['T20260928_A01']))).toBe('T20260928_A01');
  });

  it('关联指向已删除系列赛（孤儿引用）→ null，按普通对局处理', () => {
    const match = makeMatch([makeGame(1, 'pending')], {
      tournamentRef: { tournamentId: 'T20260928_A99', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
    });
    expect(getEffectiveTournamentId(match, new Set(['T20260928_A01']))).toBeNull();
  });
});

describe('buildHistoryTournamentFilters', () => {
  it('只含有关联赛局的系列赛：名称/计数正确，0 场的不列', () => {
    const matches = [
      makeMatch([makeGame(1, 'pending')], {
        id: 'm1',
        tournamentRef: { tournamentId: 'T1', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
      }),
      makeMatch([makeGame(1, 'pending')], {
        id: 'm2',
        tournamentRef: { tournamentId: 'T1', nodeId: 's0-w1-n01', stageIndex: 0, waveIndex: 1 },
      }),
      makeMatch([makeGame(1, 'pending')], { id: 'm3' }),
      makeMatch([makeGame(1, 'pending')], {
        id: 'm4',
        tournamentRef: { tournamentId: 'T_GONE', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
      }),
    ];
    const tournaments = [makeTournament('T1', '星空杯'), makeTournament('T2', '无人杯')];

    const filters = buildHistoryTournamentFilters(matches, tournaments);
    expect(filters).toEqual([{ id: 'T1', name: '星空杯', count: 2 }]);
  });

  it('顺序按关联赛局首次出现位置（列表新对局在前，近期系列赛优先）', () => {
    const matches = [
      makeMatch([makeGame(1, 'pending')], {
        id: 'm1',
        tournamentRef: { tournamentId: 'TB', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
      }),
      makeMatch([makeGame(1, 'pending')], {
        id: 'm2',
        tournamentRef: { tournamentId: 'TA', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
      }),
      makeMatch([makeGame(1, 'pending')], {
        id: 'm3',
        tournamentRef: { tournamentId: 'TB', nodeId: 's0-w1-n01', stageIndex: 0, waveIndex: 1 },
      }),
    ];
    const tournaments = [makeTournament('TA', '甲杯'), makeTournament('TB', '乙杯')];

    expect(buildHistoryTournamentFilters(matches, tournaments).map((item) => item.id)).toEqual(['TB', 'TA']);
  });

  it('全部为普通对局时返回空列表', () => {
    expect(buildHistoryTournamentFilters([makeMatch([makeGame(1, 'pending')])], [])).toEqual([]);
  });
});

describe('LINEUP_ENTRY_BLOCK_TEXT', () => {
  it('四种锁定原因都有提示文案', () => {
    for (const reason of ['match-completed', 'game-not-current', 'game-started', 'game-completed'] as const) {
      expect(LINEUP_ENTRY_BLOCK_TEXT[reason]).toBeTruthy();
    }
  });
});

describe('filterLocallyRemovedMatches', () => {
  it('本机移除的系列赛对局一并隐藏；无引用与其他系列赛不受影响；空集合原样返回', () => {
    const matches = [
      makeMatch([makeGame(1, 'pending')], {
        id: 'm-removed',
        tournamentRef: { tournamentId: 'T-REMOVED', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
      }),
      makeMatch([makeGame(1, 'pending')], {
        id: 'm-kept',
        tournamentRef: { tournamentId: 'T-KEPT', nodeId: 's0-w1-n00', stageIndex: 0, waveIndex: 1 },
      }),
      makeMatch([makeGame(1, 'pending')], { id: 'm-plain' }),
    ];

    const filtered = filterLocallyRemovedMatches(matches, new Set(['T-REMOVED']));
    expect(filtered.map((match) => match.id)).toEqual(['m-kept', 'm-plain']);
    // 空集合（没有本机移除记录）原样返回，避免无谓复制
    expect(filterLocallyRemovedMatches(matches, new Set())).toBe(matches);
  });
});
