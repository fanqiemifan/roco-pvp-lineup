import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMatch,
  deleteMatches,
  getMatchStore,
  recordMatchWinner,
  redoMatchAction,
  saveGameLineupForMatch,
  setActiveMatch,
  startCurrentGame,
  undoDeletedMatches,
  undoMatchAction,
} from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-flow-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
});

/** 建一场 BO3 并为第 1 局录入双方阵容（开局的前置条件） */
function startMatchWithGame1(): string {
  const matchId = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 }).matches[0].id;
  saveGameLineupForMatch(paths, matchId, 1, {
    left: [{ sprite: 'pet-1' }],
    right: [{ sprite: 'pet-2' }],
  });
  return matchId;
}

/** 为指定小局录入阵容并开局 */
function lineupAndStart(matchId: string, gameNumber: number): void {
  saveGameLineupForMatch(paths, matchId, gameNumber, {
    left: [{ sprite: 'pet-1' }],
    right: [{ sprite: 'pet-2' }],
  });
  startCurrentGame(paths, matchId);
}

describe('赛事全流程（BO3）', () => {
  it('开局后 match 进入 in_progress，记分后自动追加下一局', () => {
    const matchId = startMatchWithGame1();
    startCurrentGame(paths, matchId);

    const afterStart = getMatchStore(paths);
    expect(afterStart.matches[0].status).toBe('in_progress');
    expect(afterStart.matches[0].games[0].status).toBe('in_progress');

    const afterGame1 = recordMatchWinner(paths, matchId, 'left');
    const match = afterGame1.matches[0];
    expect(match.leftScore).toBe(1);
    expect(match.games).toHaveLength(2);
    expect(match.games[0]).toMatchObject({ status: 'completed', winner: 'left' });
    expect(match.games[1]).toMatchObject({ status: 'pending', gameNumber: 2 });
  });

  it('2:0 横扫完赛：裁掉未打的第 3 局，completedAt 落地', () => {
    const matchId = startMatchWithGame1();
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, 'left');
    lineupAndStart(matchId, 2);

    const done = recordMatchWinner(paths, matchId, 'left');
    const match = done.matches[0];
    expect(match.status).toBe('completed');
    expect(match.winner).toBe('left');
    expect(match.leftScore).toBe(2);
    expect(match.rightScore).toBe(0);
    expect(match.completedAt).toBeTruthy();
    expect(match.games).toHaveLength(2);
    expect(match.games.every((game) => game.winner === 'left')).toBe(true);
  });

  it('2:1 打满三局完赛', () => {
    const matchId = startMatchWithGame1();
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, 'left');
    lineupAndStart(matchId, 2);
    recordMatchWinner(paths, matchId, 'right');
    lineupAndStart(matchId, 3);

    const done = recordMatchWinner(paths, matchId, 'left');
    const match = done.matches[0];
    expect(match.status).toBe('completed');
    expect(match.winner).toBe('left');
    expect(match.leftScore).toBe(2);
    expect(match.rightScore).toBe(1);
    expect(match.games).toHaveLength(3);
  });

  it('完赛后锁定：不能再记分、不能再录阵容', () => {
    const matchId = startMatchWithGame1();
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, 'left');
    lineupAndStart(matchId, 2);
    recordMatchWinner(paths, matchId, 'left');

    expect(() => recordMatchWinner(paths, matchId, 'right')).toThrow('该比赛已结束');
    expect(() => saveGameLineupForMatch(paths, matchId, 2, { left: [] })).toThrow('当前赛事已完赛，不能录入阵容');
  });

  it('未开局直接记分被拦截', () => {
    const matchId = startMatchWithGame1();
    expect(() => recordMatchWinner(paths, matchId, 'left')).toThrow('请先开始当前小局，再记录胜负');
  });

  it('undo 逐步撤回记分与开局，redo 原路恢复', () => {
    const matchId = startMatchWithGame1();
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, 'left');

    // 撤回记分：回到第 1 局进行中、比分 0:0、第 2 局消失
    const afterUndo1 = undoMatchAction(paths, matchId);
    expect(afterUndo1.matches[0].games).toHaveLength(1);
    expect(afterUndo1.matches[0].games[0].status).toBe('in_progress');
    expect(afterUndo1.matches[0].leftScore).toBe(0);

    // redo 恢复记分
    const afterRedo = redoMatchAction(paths, matchId);
    expect(afterRedo.matches[0].leftScore).toBe(1);
    expect(afterRedo.matches[0].games).toHaveLength(2);

    // 再次撤回记分，再撤回开局
    undoMatchAction(paths, matchId);
    const afterUndo2 = undoMatchAction(paths, matchId);
    expect(afterUndo2.matches[0].games[0].status).toBe('pending');
    expect(afterUndo2.matches[0].status).toBe('pending');
    expect(afterUndo2.matches[0].leftScore).toBe(0);

    // 栈空后继续撤回报错，redo 仍可恢复到「第 1 局进行中」
    expect(() => undoMatchAction(paths, matchId)).toThrow('没有可撤回的操作');
    const afterRedo2 = redoMatchAction(paths, matchId);
    expect(afterRedo2.matches[0].games[0].status).toBe('in_progress');
  });

  it('空栈 redo 报错', () => {
    const matchId = startMatchWithGame1();
    expect(() => redoMatchAction(paths, matchId)).toThrow('没有可取消撤回的操作');
  });
});

describe('赛事删除与恢复', () => {
  it('删除比赛可撤销：恢复原列表位置与当前赛事指向', () => {
    const m1 = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' }).matches[0].id;
    const m2 = createMatch(paths, { leftPlayer: '丙', rightPlayer: '丁' }).matches[0].id;

    const afterDelete = deleteMatches(paths, [m2]);
    expect(afterDelete.matches.map((match) => match.id)).toEqual([m1]);
    expect(afterDelete.activeMatchId).toBe(m1);

    const restored = undoDeletedMatches(paths);
    expect(restored.matches.map((match) => match.id)).toEqual([m2, m1]);
    expect(restored.activeMatchId).toBe(m2);
  });

  it('删除当前赛事后指向回退到列表第一场', () => {
    const m1 = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' }).matches[0].id;
    const m2 = createMatch(paths, { leftPlayer: '丙', rightPlayer: '丁' }).matches[0].id;

    const afterDelete = deleteMatches(paths, [m2, m1]);
    expect(afterDelete.matches).toHaveLength(0);
    expect(afterDelete.activeMatchId).toBeNull();
  });

  it('删除参数校验', () => {
    createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' });
    expect(() => deleteMatches(paths, [])).toThrow('请选择至少一条赛事记录');
    expect(() => deleteMatches(paths, ['no-such-id'])).toThrow('比赛不存在');
  });

  it('没有删除记录时撤销报错', () => {
    expect(() => undoDeletedMatches(paths)).toThrow('没有可撤回的删除记录');
  });
});

describe('setActiveMatch', () => {
  it('切换当前赛事；未知比赛报错', () => {
    const m1 = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' }).matches[0].id;
    const m2 = createMatch(paths, { leftPlayer: '丙', rightPlayer: '丁' }).matches[0].id;

    const switched = setActiveMatch(paths, m1);
    expect(switched.activeMatchId).toBe(m1);
    expect(() => setActiveMatch(paths, 'no-such-id')).toThrow('比赛不存在');
    expect(m2).toBeTruthy();
  });
});
