import { describe, expect, it } from 'vitest';

import {
  deriveMatchActionAvailability,
  formatWinnerActionLabel,
  resolveUndoState,
} from '../../src/admin-antd/lib/match-actions';
import type { GameRecord, MatchRecord, MatchStoreState } from '../../shared/types';

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

function createMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: '20260928_A001',
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    status: 'pending',
    leftPlayer: '小明',
    rightPlayer: '小红',
    leftRank: '',
    rightRank: '',
    leftTeamId: '',
    leftTeamName: '',
    rightTeamId: '',
    rightTeamName: '',
    bestOf: 3,
    games: [createGame({})],
    leftScore: 0,
    rightScore: 0,
    winner: null,
    completedAt: null,
    tags: [],
    ...overrides,
  };
}

function createUndo(overrides: Partial<MatchStoreState['undo']> = {}): MatchStoreState['undo'] {
  return {
    canUndo: false,
    canRedo: false,
    canUndoDelete: false,
    deleteUndoCount: 0,
    byMatch: {},
    ...overrides,
  };
}

describe('deriveMatchActionAvailability（对局动作可用性）', () => {
  it('待开始且双方阵容已录：可开始，不可登记', () => {
    const match = createMatch({
      games: [createGame({ leftLineup: ['3001'], rightLineup: ['3002'] })],
    });
    const result = deriveMatchActionAvailability(match, match.id, createUndo());
    expect(result.canStart).toBe(true);
    expect(result.canRegister).toBe(false);
    expect(result.isCurrent).toBe(true);
  });

  it('只录了一侧阵容：不能开始', () => {
    const match = createMatch({
      games: [createGame({ leftLineup: ['3001'] })],
    });
    expect(deriveMatchActionAvailability(match, null, createUndo()).canStart).toBe(false);
  });

  it('当前小局进行中：可登记，不可开始', () => {
    const match = createMatch({
      status: 'in_progress',
      games: [createGame({ status: 'in_progress', leftLineup: ['3001'], rightLineup: ['3002'] })],
    });
    const result = deriveMatchActionAvailability(match, null, createUndo());
    expect(result.canStart).toBe(false);
    expect(result.canRegister).toBe(true);
  });

  it('已完赛：两个动作都不可用，且 isCurrent 看 activeMatchId', () => {
    const match = createMatch({ status: 'completed' });
    const result = deriveMatchActionAvailability(match, '20260928_A999', createUndo());
    expect(result.canStart).toBe(false);
    expect(result.canRegister).toBe(false);
    expect(result.isCurrent).toBe(false);
  });

  it('match 为空：全部不可用', () => {
    const result = deriveMatchActionAvailability(null, '20260928_A001', createUndo());
    expect(result).toEqual({
      isCurrent: false,
      canStart: false,
      canRegister: false,
      canUndo: false,
      canRedo: false,
    });
  });
});

describe('resolveUndoState（撤回可用性按比赛取值）', () => {
  it('非当前比赛：取 byMatch，缺失时视为不可撤回', () => {
    const undo = createUndo({
      canUndo: true,
      byMatch: { '20260928_A002': { canUndo: true, canRedo: false } },
    });
    expect(resolveUndoState('20260928_A002', '20260928_A001', undo)).toEqual({ canUndo: true, canRedo: false });
    // 当前比赛的栈不能套用到别的比赛上
    expect(resolveUndoState('20260928_A003', '20260928_A001', undo)).toEqual({ canUndo: false, canRedo: false });
  });

  it('当前比赛且 byMatch 缺失（旧数据）：回落到 canUndo/canRedo', () => {
    const undo = createUndo({ canUndo: true, canRedo: true });
    expect(resolveUndoState('20260928_A001', '20260928_A001', undo)).toEqual({ canUndo: true, canRedo: true });
  });

  it('没有 matchId 或没有 undo 状态：不可撤回', () => {
    expect(resolveUndoState(null, '20260928_A001', createUndo({ canUndo: true })).canUndo).toBe(false);
    expect(resolveUndoState('20260928_A001', '20260928_A001', null).canUndo).toBe(false);
  });
});

describe('formatWinnerActionLabel（菜单用选手名）', () => {
  it('用选手名生成菜单文案：左边是小明 → 小明赢了', () => {
    expect(formatWinnerActionLabel('left', '小明')).toBe('小明赢了');
    expect(formatWinnerActionLabel('right', '小红')).toBe('小红赢了');
  });

  it('名字为空 / 缺失时回落「左侧/右侧赢了」，去掉首尾空白', () => {
    expect(formatWinnerActionLabel('left', '  ')).toBe('左侧赢了');
    expect(formatWinnerActionLabel('right', null)).toBe('右侧赢了');
    expect(formatWinnerActionLabel('left', ' 小明 ')).toBe('小明赢了');
  });
});
