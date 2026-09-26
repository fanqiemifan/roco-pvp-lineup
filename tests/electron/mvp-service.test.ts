import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  it('未落盘时返回空状态：无精灵项 + 未载入胜方 + 默认关闭后切回页面3', () => {
    const state = getMvpState(paths);
    expect(state.slots).toEqual([]);
    expect(state.winner).toBeNull();
    expect(state.returnPage).toBe('page3');
    expect(state.mtime).toBeNull();
  });
});

describe('getMvpWinnerInfo（页面4 胜方选手信息条：读已载入的胜方快照）', () => {
  it('未载入胜方快照时返回空（页面显示「待定」）', () => {
    expect(getMvpWinnerInfo(paths)).toEqual({
      side: null,
      playerName: '',
      avatarExists: false,
      avatarPath: '',
      avatarMtime: null,
    });
  });

  it('保存快照后返回快照里的名字，切换当前对局（含登记新的胜负）不会改变', () => {
    const first = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    const firstId = first.matches[0].id;
    saveMvpState(paths, { winner: { matchId: firstId, side: 'right', playerName: '乙' } });

    // 新建比赛会切换当前对局，并登记一个小局胜负：快照仍应保持原样
    const second = createMatch(paths, { leftPlayer: '丙', rightPlayer: '丁', bestOf: 3 });
    const secondId = second.matches[0].id;
    saveGameLineupForMatch(paths, secondId, 1, { left: [{ sprite: '3004' }], right: [{ sprite: '3005' }] });
    startCurrentGame(paths, secondId);
    recordMatchWinner(paths, secondId, 'left');

    const winner = getMvpWinnerInfo(paths);
    expect(winner.side).toBe('right');
    expect(winner.playerName).toBe('乙');
  });

  it('头像按快照的 matchId + side 解析，未上传时回退占位图（avatarExists=false）', () => {
    const store = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    const matchId = store.matches[0].id;
    saveMvpState(paths, { winner: { matchId, side: 'right', playerName: '乙' } });

    expect(getMvpWinnerInfo(paths).avatarExists).toBe(false);

    // 直接落盘头像文件（getAvatarState 只检查存在与 mtime，不校验图片内容）
    mkdirSync(paths.avatarDir(matchId), { recursive: true });
    writeFileSync(paths.avatarFile('right', matchId), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const winner = getMvpWinnerInfo(paths);
    expect(winner.avatarExists).toBe(true);
    expect(winner.avatarPath).toBe(`/api/avatar/${encodeURIComponent(matchId)}/right-avatar.png`);
    expect(winner.avatarMtime).not.toBeNull();
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

  it('保存胜方快照；winner 不合法（缺 matchId/side）或显式传 null 时视为未载入', () => {
    const saved = saveMvpState(paths, { winner: { matchId: '20260926_001', side: 'right', playerName: ' 乙 ' } });
    expect(saved.winner).toEqual({ matchId: '20260926_001', side: 'right', playerName: '乙' });

    expect(saveMvpState(paths, { winner: { matchId: '', side: 'left' } }).winner).toBeNull();
    expect(saveMvpState(paths, { winner: { matchId: '20260926_001', side: 'top' } }).winner).toBeNull();
    expect(saveMvpState(paths, { winner: null }).winner).toBeNull();
  });

  it('胜方快照的 matchId 过滤路径字符（形如 20260926_001，避免拼进头像目录时越权）', () => {
    const state = saveMvpState(paths, { winner: { matchId: '../20260926_001/', side: 'left', playerName: '甲' } });
    expect(state.winner?.matchId).toBe('20260926_001');
  });

  it('未传字段时保留当前值（仅保存 returnPage 不清空精灵项与胜方快照）', () => {
    saveMvpState(paths, {
      slots: [{ petId: '3004', tag: '顶级辅助' }],
      winner: { matchId: '20260926_001', side: 'right', playerName: '乙' },
    });
    const state = saveMvpReturnPage(paths, 'page9');

    expect(state.returnPage).toBe('page9');
    expect(state.slots).toHaveLength(1);
    expect(state.winner?.playerName).toBe('乙');
  });

  it('payload 非对象时抛错', () => {
    expect(() => saveMvpState(paths, null)).toThrow('mvp payload must be an object');
  });
});