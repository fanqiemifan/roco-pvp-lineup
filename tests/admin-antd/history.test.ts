import { describe, expect, it } from 'vitest';

import type { GameRecord, MatchRecord, MatchSlotSnapshot } from '../../shared/types';
import {
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

describe('LINEUP_ENTRY_BLOCK_TEXT', () => {
  it('四种锁定原因都有提示文案', () => {
    for (const reason of ['match-completed', 'game-not-current', 'game-started', 'game-completed'] as const) {
      expect(LINEUP_ENTRY_BLOCK_TEXT[reason]).toBeTruthy();
    }
  });
});
