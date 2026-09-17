import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createMatch, saveGameLineupForMatch, startCurrentGame } from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-match-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
});

/** 建一场 BO3：新比赛只有第 1 局（后续小局在打到时才追加），并自动成为当前赛事 */
function createBo3Match(): string {
  const store = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
  return store.matches[0].id;
}

describe('createMatch', () => {
  it('创建 BO3 时生成待开始的第 1 局，并置为当前赛事', () => {
    const store = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });

    expect(store.matches).toHaveLength(1);
    expect(store.matches[0].games).toHaveLength(1);
    expect(store.matches[0].games[0].status).toBe('pending');
    expect(store.activeMatchId).toBe(store.matches[0].id);
  });
});

describe('saveGameLineupForMatch', () => {
  it('为待开始的当前小局写入双方阵容，保持 pending 且不新增小局', () => {
    const matchId = createBo3Match();

    const saved = saveGameLineupForMatch(paths, matchId, 1, {
      left: [{ sprite: 'pet-1001' }, null, null, null, null, null],
      right: [{ sprite: 'pet-2002' }],
    });

    expect(saved.matches).toHaveLength(1);
    expect(saved.matches[0].games).toHaveLength(1);
    const game = saved.matches[0].games[0];
    expect(game.status).toBe('pending');
    expect(game.leftSlots[0].pet_id).toBe('pet-1001');
    expect(game.leftSlots[1].pet_id).toBeNull();
    expect(game.leftLineup).toContain('pet-1001');
    expect(game.rightSlots[0].pet_id).toBe('pet-2002');
  });

  it('只传一侧时另一侧保留原值', () => {
    const matchId = createBo3Match();
    saveGameLineupForMatch(paths, matchId, 1, {
      left: [{ sprite: 'pet-1001' }],
      right: [{ sprite: 'pet-2002' }],
    });

    const saved = saveGameLineupForMatch(paths, matchId, 1, { left: [{ sprite: 'pet-3003' }] });

    const game = saved.matches[0].games[0];
    expect(game.leftSlots[0].pet_id).toBe('pet-3003');
    expect(game.rightSlots[0].pet_id).toBe('pet-2002');
  });

  it('左侧传空数组 = 清空该侧阵容，不影响另一侧', () => {
    const matchId = createBo3Match();
    saveGameLineupForMatch(paths, matchId, 1, {
      left: [{ sprite: 'pet-1001' }],
      right: [{ sprite: 'pet-2002' }],
    });

    const saved = saveGameLineupForMatch(paths, matchId, 1, { left: [] });

    const game = saved.matches[0].games[0];
    expect(game.leftSlots.every((slot) => slot.pet_id === null)).toBe(true);
    expect(game.rightSlots[0].pet_id).toBe('pet-2002');
  });

  it('拒绝录入不存在的比赛', () => {
    expect(() => saveGameLineupForMatch(paths, 'no-such-id', 1, { left: [] })).toThrow('比赛不存在');
  });

  it('拒绝非法小局编号', () => {
    const matchId = createBo3Match();
    expect(() => saveGameLineupForMatch(paths, matchId, 0, { left: [] })).toThrow('无效的小局编号');
  });

  it('拒绝录入还没轮到的小局', () => {
    const matchId = createBo3Match();
    expect(() => saveGameLineupForMatch(paths, matchId, 2, { left: [] })).toThrow('还没轮到第 2 局');
  });

  it('拒绝双侧都为空的录入', () => {
    const matchId = createBo3Match();
    expect(() => saveGameLineupForMatch(paths, matchId, 1, {})).toThrow('请至少提供一侧的阵容');
  });

  it('拒绝格式错误的槽位数据', () => {
    const matchId = createBo3Match();
    expect(() =>
      saveGameLineupForMatch(paths, matchId, 1, { left: 'oops' as unknown as unknown[] }),
    ).toThrow('selected must be a list');
  });

  it('该局开始后拒绝录入', () => {
    const matchId = createBo3Match();
    // 开局前置条件：双方都已有阵容（startCurrentGame 会拦截空阵容）
    saveGameLineupForMatch(paths, matchId, 1, {
      left: [{ sprite: 'pet-1001' }],
      right: [{ sprite: 'pet-2002' }],
    });
    startCurrentGame(paths, matchId);

    expect(() => saveGameLineupForMatch(paths, matchId, 1, { left: [] })).toThrow('该局已开始');
  });
});
