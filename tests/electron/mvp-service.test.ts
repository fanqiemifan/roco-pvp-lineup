import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { getMvpState, getMvpWinnerInfo, saveMvpReturnPage, saveMvpState } from '../../electron/services/mvp-service';
import { createMatch, recordMatchWinner, saveGameLineupForMatch, startCurrentGame } from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-mvp-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
});

describe('getMvpState', () => {
  it('未落盘时返回空状态：无精灵项 + 默认关闭后切回页面3', () => {
    const state = getMvpState(paths);
    expect(state.slots).toEqual([]);
    expect(state.returnPage).toBe('page3');
    expect(state.mtime).toBeNull();
  });
});

describe('getMvpWinnerInfo（页面4 胜方选手信息条）', () => {
  it('没有当前赛事时返回空（页面显示「待定」）', () => {
    expect(getMvpWinnerInfo(paths)).toEqual({
      side: null,
      playerName: '',
      avatarExists: false,
      avatarPath: '',
      avatarMtime: null,
    });
  });

  it('取最近一个已分胜负小局的胜者选手名字（未上传头像时 avatarExists=false）', () => {
    const store = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    const matchId = store.matches[0].id;
    saveGameLineupForMatch(paths, matchId, 1, { left: [{ sprite: '3004' }], right: [{ sprite: '3005' }] });
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, 'right');

    const winner = getMvpWinnerInfo(paths);
    expect(winner.side).toBe('right');
    expect(winner.playerName).toBe('乙');
    expect(winner.avatarExists).toBe(false);
    expect(winner.avatarPath).toBe('');
  });
});

describe('saveMvpState', () => {
  it('保存精灵项与标签，并以 mtime 落地', () => {
    const state = saveMvpState(paths, {
      slots: [
        { petId: '3004', tag: '顶级辅助' },
        { petId: '3005', tag: '' },
      ],
    });

    expect(state.slots).toEqual([
      { petId: '3004', tag: '顶级辅助', isMvp: false },
      { petId: '3005', tag: '', isMvp: false },
    ]);
    expect(state.mtime).not.toBeNull();
    expect(getMvpState(paths).slots).toHaveLength(2);
  });

  it('最多 6 个精灵项，未赋值精灵（petId 为空）的项不落盘', () => {
    const state = saveMvpState(paths, {
      slots: [
        { petId: '', tag: '顶级终端' },
        { petId: '3004', tag: 'a' },
        { petId: '3005', tag: 'b' },
        { petId: '3006', tag: 'c' },
        { petId: '3007', tag: 'd' },
        { petId: '3008', tag: 'e' },
        { petId: '3009', tag: 'f' },
        { petId: '3010', tag: 'g' },
      ],
    });

    expect(state.slots.map((slot) => slot.petId)).toEqual(['3004', '3005', '3006', '3007', '3008', '3009']);
  });

  it('标签最多四个字，超长截断', () => {
    const state = saveMvpState(paths, { slots: [{ petId: '3004', tag: '顶级辅助输出' }] });
    expect(state.slots[0].tag).toBe('顶级辅助');
  });

  it('MVP 标记全局唯一：取第一个标记为 MVP 的精灵', () => {
    const state = saveMvpState(paths, {
      slots: [
        { petId: '3004', tag: '', isMvp: true },
        { petId: '3005', tag: '', isMvp: true },
      ],
    });

    expect(state.slots.map((slot) => slot.isMvp)).toEqual([true, false]);
  });

  it('returnPage 只接受合法推流画面，且不能是 MVP 结算自身', () => {
    expect(saveMvpState(paths, { returnPage: 'page7' }).returnPage).toBe('page7');
    expect(saveMvpState(paths, { returnPage: 'page4' }).returnPage).toBe('page3');
    expect(saveMvpState(paths, { returnPage: 'not-a-page' }).returnPage).toBe('page3');
  });

  it('未传字段时保留当前值（仅保存 returnPage 不清空精灵项）', () => {
    saveMvpState(paths, { slots: [{ petId: '3004', tag: '顶级辅助' }] });
    const state = saveMvpReturnPage(paths, 'page9');

    expect(state.returnPage).toBe('page9');
    expect(state.slots).toHaveLength(1);
  });

  it('payload 非对象时抛错', () => {
    expect(() => saveMvpState(paths, null)).toThrow('mvp payload must be an object');
  });
});