/**
 * 「上次操作的系列赛」本地记忆（lib/last-tournament）。
 *
 * 这条记忆决定「系列比赛」视图进详情时打开哪一个：读取失败/无记录都必须安静地返回 null，
 * 让详情回退列表第一条，绝不能抛异常把整个视图带崩。测试在 node 环境下用假 localStorage 覆盖读写与降级路径。
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  readLastTournamentId,
  writeLastTournamentId,
} from '../../src/admin-antd/lib/last-tournament';

/** 极简 localStorage 假实现：记录调用，便于断言「读到的就是写进去的」 */
function createFakeStorage(): {
  entries: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** 把假存储挂到 globalThis（lib 层只看 globalThis，不依赖 window） */
function installStorage(storage: unknown): void {
  (globalThis as { localStorage?: unknown }).localStorage = storage;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('系列赛「上次操作」记忆（lib/last-tournament）', () => {
  it('没有记忆时返回 null（详情回退列表第一条）', () => {
    installStorage(createFakeStorage());
    expect(readLastTournamentId()).toBeNull();
  });

  it('写入后能读回同一个 id', () => {
    installStorage(createFakeStorage());
    writeLastTournamentId('T20260929_A01');
    expect(readLastTournamentId()).toBe('T20260929_A01');
  });

  it('传 null 清除记忆', () => {
    installStorage(createFakeStorage());
    writeLastTournamentId('T20260929_A01');
    writeLastTournamentId(null);
    expect(readLastTournamentId()).toBeNull();
  });

  it('localStorage 整个不存在（node / 隐私模式）时读写都不抛异常', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(readLastTournamentId()).toBeNull();
    expect(() => writeLastTournamentId('T20260929_A01')).not.toThrow();
  });

  it('存储抛异常时静默降级为「没有记忆」', () => {
    installStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(readLastTournamentId()).toBeNull();
    expect(() => writeLastTournamentId('T20260929_A01')).not.toThrow();
    expect(() => writeLastTournamentId(null)).not.toThrow();
  });
});
