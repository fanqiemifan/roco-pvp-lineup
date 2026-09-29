import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMatch,
  getMatchStore,
  recordMatchWinner,
  saveGameLineupForMatch,
  startCurrentGame,
} from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let paths: AppPaths;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-store-cache-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
});

function readRawStore(): Record<string, any> {
  return JSON.parse(readFileSync(paths.matchesFile, 'utf-8'));
}

/** 建一场 BO3、录入阵容、开局并记分，使撤销栈压入 2 个快照 */
function prepareMatchWithUndoStack(): string {
  const matchId = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 }).matches[0].id;
  saveGameLineupForMatch(paths, matchId, 1, {
    left: [{ sprite: 'pet-1' }],
    right: [{ sprite: 'pet-2' }],
  });
  startCurrentGame(paths, matchId);
  recordMatchWinner(paths, matchId, 'left');
  return matchId;
}

describe('matches.json 内存缓存与原子写', () => {
  it('写入后读取直接命中内存态；落盘文件带 __version', () => {
    const matchId = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' }).matches[0].id;
    expect(getMatchStore(paths).matches[0].id).toBe(matchId);
    expect(readRawStore().__version).toBe(1);
  });

  it('原子写不残留临时文件', () => {
    createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' });
    const leftovers = readdirSync(paths.cacheDir).filter((name) => name.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('规范化的版本化文件重复读取不再回写（mtime 不变）', () => {
    createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' });
    getMatchStore(paths); // 确保已读入缓存且文件已是规范版本
    const before = statSync(paths.matchesFile).mtimeMs;
    getMatchStore(paths);
    getMatchStore(paths);
    expect(statSync(paths.matchesFile).mtimeMs).toBe(before);
  });

  it('外部修改 matches.json（mtime 变化）后缓存自动刷新', () => {
    createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙' });
    const raw = readRawStore();
    raw.matches[0].leftPlayer = '外部修改';
    writeFileSync(paths.matchesFile, JSON.stringify(raw), 'utf-8');
    // 显式推新 mtime，避免同毫秒写入分辨不出
    const future = new Date(Date.now() + 5000);
    utimesSync(paths.matchesFile, future, future);

    expect(getMatchStore(paths).matches[0].leftPlayer).toBe('外部修改');
  });

  it('文件不存在时返回空状态且不报错', () => {
    const store = getMatchStore(paths);
    expect(store.matches).toEqual([]);
    expect(store.activeMatchId).toBeNull();
    expect(existsSync(paths.matchesFile)).toBe(false);
  });
});

describe('撤销栈 7 天自动清理', () => {
  it('新压入的快照带 savedAt，7 天内可正常撤销', () => {
    const matchId = prepareMatchWithUndoStack();
    const raw = readRawStore();
    const stack = raw.flowHistory[matchId].undoStack;
    expect(stack).toHaveLength(2);
    expect(stack.every((snapshot: any) => typeof snapshot.savedAt === 'string')).toBe(true);
    expect(getMatchStore(paths).undo.canUndo).toBe(true);
  });

  it('超过 7 天的快照读取时自动清除并落盘，未过期的保留', () => {
    const matchId = prepareMatchWithUndoStack();
    const raw = readRawStore();
    const stack = raw.flowHistory[matchId].undoStack;
    stack[0].savedAt = new Date(Date.now() - 8 * DAY_MS).toISOString();
    stack[1].savedAt = new Date(Date.now() - 1 * DAY_MS).toISOString();
    writeFileSync(paths.matchesFile, JSON.stringify(raw), 'utf-8');

    const store = getMatchStore(paths);
    expect(store.undo.canUndo).toBe(true);
    const remaining = readRawStore().flowHistory[matchId].undoStack;
    expect(remaining).toHaveLength(1);
    expect(Date.parse(remaining[0].savedAt)).toBeGreaterThan(Date.now() - 7 * DAY_MS);
  });

  it('全部快照超过 7 天时撤销能力关闭，栈清空', () => {
    const matchId = prepareMatchWithUndoStack();
    const raw = readRawStore();
    for (const snapshot of raw.flowHistory[matchId].undoStack) {
      snapshot.savedAt = new Date(Date.now() - 9 * DAY_MS).toISOString();
    }
    writeFileSync(paths.matchesFile, JSON.stringify(raw), 'utf-8');

    expect(getMatchStore(paths).undo.canUndo).toBe(false);
    expect(readRawStore().flowHistory[matchId].undoStack).toEqual([]);
  });

  it('旧版数据（无 __version / savedAt）迁移：补时间戳保留完整 7 天并写版本号', () => {
    const matchId = prepareMatchWithUndoStack();
    const raw = readRawStore();
    delete raw.__version;
    for (const snapshot of raw.flowHistory[matchId].undoStack) {
      delete snapshot.savedAt;
    }
    writeFileSync(paths.matchesFile, JSON.stringify(raw), 'utf-8');

    const store = getMatchStore(paths);
    expect(store.undo.canUndo).toBe(true);
    const migrated = readRawStore();
    expect(migrated.__version).toBe(1);
    expect(migrated.flowHistory[matchId].undoStack).toHaveLength(2);
    expect(
      migrated.flowHistory[matchId].undoStack.every((snapshot: any) => typeof snapshot.savedAt === 'string'),
    ).toBe(true);
  });
});
