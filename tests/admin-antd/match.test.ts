import { describe, expect, it } from 'vitest';

import { getRecentWinnerLineup } from '../../src/admin-antd/lib/match';
import type { GameRecord, MatchRecord } from '../../shared/types';

function createGame(overrides: Partial<GameRecord>): GameRecord {
  return {
    gameNumber: 1,
    leftLineup: [],
    rightLineup: [],
    leftSlots: [],
    rightSlots: [],
    winner: null,
    status: 'pending',
    ...overrides,
  };
}

function createMatch(games: GameRecord[]): MatchRecord {
  return {
    id: 'm1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'in_progress',
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
  };
}

describe('getRecentWinnerLineup（MVP 结算取胜者阵容）', () => {
  it('没有已分胜负的小局时返回空', () => {
    const match = createMatch([
      createGame({ status: 'in_progress' }),
      createGame({ gameNumber: 2 }),
    ]);

    expect(getRecentWinnerLineup(match)).toEqual({ side: null, playerName: '', gameNumber: null, petIds: [] });
    expect(getRecentWinnerLineup(null).petIds).toEqual([]);
  });

  it('取最近一个已分胜负小局的胜者一侧，用槽位快照的 pet_id 并去重', () => {
    const match = createMatch([
      createGame({
        gameNumber: 1,
        status: 'completed',
        winner: 'left',
        leftSlots: [{ slot: 0, pet_id: '3004', name: '', form: '', opacityEnabled: false, opacity: 1, saturation: 1, healthEnabled: false, healthPercent: 100, energyValue: 10 }],
      }),
      createGame({
        gameNumber: 2,
        status: 'completed',
        winner: 'right',
        leftLineup: ['3004', '3005'],
        rightLineup: ['3006', '3007', '3006'],
      }),
    ]);

    expect(getRecentWinnerLineup(match)).toEqual({
      side: 'right',
      playerName: '乙',
      gameNumber: 2,
      petIds: ['3006', '3007'],
    });
  });

  it('槽位快照为空时回退小局阵容数组', () => {
    const match = createMatch([
      createGame({ gameNumber: 1, status: 'completed', winner: 'left', leftLineup: ['3001', '3002'] }),
    ]);

    expect(getRecentWinnerLineup(match).petIds).toEqual(['3001', '3002']);
  });
});