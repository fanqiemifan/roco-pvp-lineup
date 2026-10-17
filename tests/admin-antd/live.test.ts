import { afterEach, describe, expect, it } from 'vitest';

import {
  LIVE_WATCH_STALL_MS,
  createLiveWatchSnapshot,
  describeWatchApply,
  formatWatchClock,
  formatWatchDuration,
  formatWatchRelative,
  formatWatchError,
  getLiveWatchBadge,
  readStoredLiveWatchPath,
  writeStoredLiveWatchPath,
} from '../../src/admin-antd/lib/live';

/** 内存版 localStorage：node 环境没有 DOM，用最小实现验证「上次监听」的记忆链路 */
function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    size: () => store.size,
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('getLiveWatchBadge 监听状态标签', () => {
  const now = 1_700_000_000_000;

  it('未开启监听 → 未监听（灰色）', () => {
    expect(getLiveWatchBadge(false, false, now, now)).toMatchObject({ color: 'default', text: '未监听', stalled: false });
  });

  it('刚开启、心跳还没落 → 正在连接', () => {
    expect(getLiveWatchBadge(true, false, 0, now)).toMatchObject({ color: 'processing', text: '正在连接' });
  });

  it('心跳新鲜 → 监听中（绿色）', () => {
    expect(getLiveWatchBadge(true, false, now - 1200, now)).toMatchObject({ color: 'green', text: '监听中', stalled: false });
  });

  it('心跳超过阈值没更新 → 监听停滞（橙色，用于暴露「看着在监听其实轮询死了」）', () => {
    const badge = getLiveWatchBadge(true, false, now - LIVE_WATCH_STALL_MS - 1, now);
    expect(badge).toMatchObject({ color: 'orange', text: '监听停滞', stalled: true });
  });

  it('读取失败优先于停滞判定 → 监听异常（红色，仍在重试）', () => {
    expect(getLiveWatchBadge(true, true, now - LIVE_WATCH_STALL_MS - 1, now)).toMatchObject({
      color: 'red',
      text: '监听异常',
    });
  });

  it('未开启时不显示停滞/异常', () => {
    expect(getLiveWatchBadge(false, true, 0, now)).toMatchObject({ color: 'default', text: '未监听' });
  });
});

describe('formatWatchRelative 心跳相对时间', () => {
  const now = 1_700_000_000_000;

  it('空值 → --', () => {
    expect(formatWatchRelative(null, now)).toBe('--');
  });

  it('不到 1 秒（含时钟回拨造成的未来时间）→ 刚刚', () => {
    expect(formatWatchRelative(now - 200, now)).toBe('刚刚');
    expect(formatWatchRelative(now + 5000, now)).toBe('刚刚');
  });

  it('秒 / 分 / 小时分档', () => {
    expect(formatWatchRelative(now - 3_000, now)).toBe('3 秒前');
    expect(formatWatchRelative(now - 65_000, now)).toBe('1 分 5 秒前');
    expect(formatWatchRelative(now - 3_700_000, now)).toBe('1 小时 1 分前');
  });
});

describe('formatWatchDuration 已监听时长', () => {
  const now = 1_700_000_000_000;

  it('空值 → --', () => {
    expect(formatWatchDuration(null, now)).toBe('--');
  });

  it('分:秒 与 时:分:秒', () => {
    expect(formatWatchDuration(now, now)).toBe('00:00');
    expect(formatWatchDuration(now - 65_000, now)).toBe('01:05');
    expect(formatWatchDuration(now - 3_661_000, now)).toBe('1:01:01');
  });
});

describe('formatWatchClock 时刻', () => {
  it('空值 / 非法时间 → --', () => {
    expect(formatWatchClock(null)).toBe('--');
    expect(formatWatchClock(Number.NaN)).toBe('--');
  });

  it('输出 HH:mm:ss', () => {
    expect(formatWatchClock(1_700_000_000_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('describeWatchApply 最近同步结果', () => {
  it('还没读到过 → 尚未从文件读到改动', () => {
    expect(describeWatchApply(null)).toBe('尚未从文件读到改动');
  });

  it('读到但无变化 / 有变化', () => {
    expect(describeWatchApply(0)).toBe('读到文件，内容无变化');
    expect(describeWatchApply(4)).toBe('已更新 4 个槽位');
  });
});

describe('formatWatchError 错误文案', () => {
  it('剥掉 Electron IPC 的远程方法前缀', () => {
    expect(
      formatWatchError(new Error("Error invoking remote method 'roco:read-text-file': Error: ENOENT: no such file")),
    ).toBe('ENOENT: no such file');
  });

  it('普通 Error 只去 Error: 前缀', () => {
    expect(formatWatchError(new Error('Error: 监听文件 JSON 格式错误'))).toBe('监听文件 JSON 格式错误');
    expect(formatWatchError(new Error('监听文件 JSON 格式错误'))).toBe('监听文件 JSON 格式错误');
  });

  it('空错误 / 非 Error → 兜底文案', () => {
    expect(formatWatchError(new Error(''))).toBe('监听文件读取失败');
    expect(formatWatchError(undefined)).toBe('监听文件读取失败');
  });
});

describe('createLiveWatchSnapshot 初始快照', () => {
  it('全部为空（没有开始时间 / 同步 / 错误）', () => {
    expect(createLiveWatchSnapshot()).toEqual({
      startedAt: null,
      lastAppliedAt: null,
      lastAppliedCount: null,
      lastWriteAt: null,
      error: null,
      errorAt: null,
    });
  });
});

describe('监听文件路径的本地记忆', () => {
  it('没有 localStorage 时读取为空、写入静默降级', () => {
    expect(readStoredLiveWatchPath()).toBe('');
    expect(() => writeStoredLiveWatchPath('D:\\logs\\live.json')).not.toThrow();
  });

  it('写入后可读回，传 null 清除', () => {
    const storage = createMemoryStorage();
    (globalThis as { localStorage?: unknown }).localStorage = storage;

    expect(readStoredLiveWatchPath()).toBe('');
    writeStoredLiveWatchPath('D:\\logs\\live.json');
    expect(readStoredLiveWatchPath()).toBe('D:\\logs\\live.json');
    expect(storage.size()).toBe(1);

    writeStoredLiveWatchPath(null);
    expect(readStoredLiveWatchPath()).toBe('');
    expect(storage.size()).toBe(0);
  });
});
