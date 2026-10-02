import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvatarCollectionState, MatchRecord } from '../../shared/types';

/**
 * 推流页面7 渲染逻辑测试：没有浏览器环境，这里用极简假 DOM 跑真实的 page7-display.js，
 * 覆盖这次改造最容易出问题的部分——整屏过渡（含保持当前屏）、行首标签（系列赛两行）、
 * 空占位行，以及"数据更新不整表重建、不位移"。
 */

class FakeClassList {
  private names = new Set<string>();

  constructor(initial: string) {
    initial.split(/\s+/).filter(Boolean).forEach((name) => this.names.add(name));
  }

  add(name: string): void {
    this.names.add(name);
  }

  remove(name: string): void {
    this.names.delete(name);
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }

  toString(): string {
    return Array.from(this.names).join(' ');
  }
}

function createStyle(): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  style.setProperty = (name: string, value: string) => {
    style[name] = value;
  };
  return style;
}

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  classList: FakeClassList;
  textContent = '';
  hidden = false;
  style = createStyle();

  constructor(tagName: string, className = '') {
    this.tagName = tagName;
    this.classList = new FakeClassList(className);
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(value: string) {
    this.classList = new FakeClassList(value);
  }

  /** 脚本用 `layer.innerHTML = ''` 清空一屏；只支持清空语义 */
  set innerHTML(value: string) {
    if (!value) {
      this.children.forEach((child) => {
        child.parent = null;
      });
      this.children = [];
    }
  }

  get innerHTML(): string {
    return '';
  }

  appendChild(child: FakeElement): FakeElement {
    if (child.parent) {
      child.parent.children = child.parent.children.filter((item) => item !== child);
    }
    this.children.push(child);
    child.parent = this;
    return child;
  }

  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((item) => item !== this);
      this.parent = null;
    }
  }
}

interface Harness {
  elements: Record<string, FakeElement>;
  /** 手动驱动脚本里的 setTimeout（切屏节奏可控）；clearTimeout 生效，只留活的定时器 */
  pendingDelays: () => number[];
  runNextTimer: () => number;
  setPayload: (payload: unknown) => void;
  /** 画面设置（/api/stage）返回的整屏切换间隔（秒） */
  setSwitchSeconds: (seconds: unknown) => void;
  /** 模拟画面设置改动推送（stage:update） */
  emitStageUpdate: (seconds: unknown) => void;
  fireDomReady: () => Promise<void>;
}

const ELEMENT_IDS = ['page7Title', 'page7RowsTrack', 'page7Notice'];

function createHarness(): Harness {
  const elements: Record<string, FakeElement> = {};
  ELEMENT_IDS.forEach((id) => {
    elements[id] = new FakeElement('div');
  });

  const domReadyHandlers: Array<() => unknown> = [];
  const documentStub = {
    readyState: 'complete',
    getElementById: (id: string) => elements[id] ?? null,
    createElement: (tagName: string) => new FakeElement(tagName),
    addEventListener: (event: string, handler: () => unknown) => {
      if (event === 'DOMContentLoaded') {
        domReadyHandlers.push(handler);
      }
    },
  };

  let payload: unknown = createPayload();
  let switchSeconds: unknown = undefined;
  const socketHandlers: Record<string, (data?: unknown) => void> = {};
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimerId = 0;

  function fakeSetTimeout(handler: () => void, ms?: number): number {
    nextTimerId += 1;
    timers.set(nextTimerId, { fn: handler, ms: ms ?? 0 });
    return nextTimerId;
  }

  function fakeClearTimeout(id: unknown): void {
    timers.delete(Number(id));
  }

  const sandbox = {
    document: documentStub,
    window: { setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout },
    fetch: (url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(
        url.includes('/api/sprites')
          ? createSprites()
          : (url.includes('/api/stage') ? { page7SwitchSeconds: switchSeconds } : payload),
      ),
    }),
    io: () => ({
      on: (event: string, handler: (data?: unknown) => void) => {
        socketHandlers[event] = handler;
      },
    }),
    console,
    // 脚本用全局 setTimeout/clearTimeout 排停留节奏；这里换成本地队列，测试逐次驱动
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  };

  const source = readFileSync(join(process.cwd(), 'src/scripts/page7-display.js'), 'utf-8');
  vm.runInContext(source, vm.createContext(sandbox));

  return {
    elements,
    pendingDelays: () => Array.from(timers.values()).map((timer) => timer.ms),
    runNextTimer: () => {
      const entry = timers.entries().next();
      if (entry.done) {
        throw new Error('没有待执行的定时器');
      }
      const [id, timer] = entry.value;
      timers.delete(id);
      timer.fn();
      return timer.ms;
    },
    setPayload: (next) => {
      payload = next;
    },
    setSwitchSeconds: (seconds) => {
      switchSeconds = seconds;
    },
    emitStageUpdate: (seconds) => {
      socketHandlers['stage:update']?.({ stage: { page7SwitchSeconds: seconds } });
    },
    fireDomReady: async () => {
      await Promise.all(domReadyHandlers.map((handler) => handler()));
      // 初始化里的 fetch 链是微任务，让它们跑完
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function createSprites(): { sprites: unknown[] } {
  return {
    sprites: [
      { id: '3001', displayName: '精灵甲', path: '/img/3001.png', iconUrl: '/icon/3001.png' },
      { id: '3002', displayName: '精灵乙', path: '/img/3002.png', iconUrl: '/icon/3002.png' },
    ],
  };
}

interface PayloadOptions {
  matches: MatchRecord[];
  tournamentLabels?: Record<string, string>;
}

function createPayload(options: PayloadOptions = { matches: [] }): unknown {
  const avatars: Record<string, AvatarCollectionState> = {};
  options.matches.forEach((match) => {
    avatars[match.id] = {
      left: { side: 'left', exists: false },
      right: { side: 'right', exists: false },
    };
  });
  return {
    state: { matchIds: options.matches.map((match) => match.id), title: '', notice: '', mtime: null },
    matches: options.matches,
    avatars,
    tournamentLabels: options.tournamentLabels ?? {},
  };
}

/** 造一场：默认 1 个小局（已完赛），便于用行数直接推断分屏 */
function makeMatch(id: string, name: string, options: { games?: number; completed?: number } = {}): MatchRecord {
  const gameCount = options.games ?? 1;
  const completed = options.completed ?? gameCount;
  return {
    id,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    status: 'completed',
    leftPlayer: `${name}-左`,
    rightPlayer: `${name}-右`,
    leftRank: '',
    rightRank: '',
    bestOf: 1,
    games: Array.from({ length: gameCount }, (_value, index) => ({
      gameNumber: index + 1,
      status: index < completed ? 'completed' as const : 'pending' as const,
      winner: index < completed ? 'left' as const : null,
      leftLineup: [],
      rightLineup: [],
      leftSlots: [{ pet_id: '3001' }],
      rightSlots: [{ pet_id: '3002' }],
    })),
  } as unknown as MatchRecord;
}

/** 当前可见层的 4 行（行首标签 + 左右选手名） */
function visibleRows(harness: Harness): Array<{ label: string; stacked: boolean; left: string }> {
  const track = harness.elements.page7RowsTrack;
  const layer = track.children.find((child) => child.classList.contains('is-visible'));
  if (!layer) {
    throw new Error('没有可见层');
  }
  return layer.children.map((row) => ({
    label: row.children[0].textContent,
    stacked: row.children[0].classList.contains('is-stacked'),
    left: row.children[1].children[0]?.children[1]?.textContent ?? '',
  }));
}

describe('page7-display.js 整屏过渡渲染', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('一屏 4 行：6 行内容分 2 屏，空位补占位行，不产生 transform（不再滚动）', async () => {
    const harness = createHarness();
    const matches = [1, 2, 3, 4, 5, 6].map((index) => makeMatch(`m${index}`, `场${index}`));
    harness.setPayload(createPayload({ matches }));
    await harness.fireDomReady();

    const track = harness.elements.page7RowsTrack;
    // 两层恒定（交叉淡入淡出），不是"把所有行铺成一条长轨道"
    expect(track.children).toHaveLength(2);
    expect(track.style.transform).toBeUndefined();

    const first = visibleRows(harness);
    expect(first).toHaveLength(4);
    expect(first.map((row) => row.left)).toEqual(['场1-左', '场2-左', '场3-左', '场4-左']);
    expect(first.map((row) => row.label)).toEqual(['GAME1', 'GAME2', 'GAME3', 'GAME4']);

    // 主标题为空时回落脚本内置默认值（改名时这里会先炸，避免画面标题与后台卡片名字不一致）
    expect(harness.elements.page7Title.textContent).toBe('战绩详情');

    // 画面设置未下发时用默认间隔：10 秒一屏（均匀节奏，不再先快后慢）
    expect(harness.runNextTimer()).toBe(10000);
    const second = visibleRows(harness);
    expect(second.map((row) => row.left)).toEqual(['场5-左', '场6-左', '', '']);
    expect(harness.runNextTimer()).toBe(10000);
    expect(visibleRows(harness).map((row) => row.left)).toEqual(['场1-左', '场2-左', '场3-左', '场4-左']);
  });

  it('切屏间隔由画面设置控制（默认 10 秒），改动立即生效、非法值回退默认', async () => {
    const harness = createHarness();
    harness.setSwitchSeconds(3);
    harness.setPayload(createPayload({
      matches: [1, 2, 3, 4, 5].map((index) => makeMatch(`m${index}`, `场${index}`)),
    }));
    await harness.fireDomReady();

    // 画面设置 = 3 秒 → 按 3000ms 排下一屏
    expect(harness.pendingDelays()).toEqual([3000]);
    harness.runNextTimer();
    expect(visibleRows(harness).map((row) => row.left)[0]).toBe('场5-左');

    // 设置改成 5 秒：当前屏的停留定时器按新间隔重排（不用等旧的 3 秒走完）
    harness.emitStageUpdate(5);
    expect(harness.pendingDelays()).toEqual([5000]);

    // 非法值（0 / 非数字）回退默认 10 秒；下限 2 秒
    harness.emitStageUpdate(0);
    expect(harness.pendingDelays()).toEqual([10000]);
    harness.emitStageUpdate('abc');
    expect(harness.pendingDelays()).toEqual([10000]);
    harness.emitStageUpdate(2);
    expect(harness.pendingDelays()).toEqual([2000]);
  });

  it('系列赛对局行首显示「阶段 / 轮次」两行，普通对局仍是 GAME 序号', async () => {
    const harness = createHarness();
    const matches = [makeMatch('m1', '甲'), makeMatch('m2', '乙'), makeMatch('m3', '丙')];
    harness.setPayload(createPayload({
      matches,
      tournamentLabels: { m1: '8进4·决胜轮', m2: '总决赛', m3: '季军赛' },
    }));
    await harness.fireDomReady();

    const rows = visibleRows(harness);
    expect(rows[0].label).toBe('8进4\n决胜轮');
    expect(rows[0].stacked).toBe(true);
    expect(rows[1].label).toBe('总决赛');
    expect(rows[1].stacked).toBe(false);
    expect(rows[2].label).toBe('季军赛');
  });

  it('数据更新原地过渡到当前屏：不跳回第一屏、不新增层、行元素数量恒定', async () => {
    const harness = createHarness();
    const matches = [1, 2, 3, 4, 5, 6].map((index) => makeMatch(`m${index}`, `场${index}`));
    harness.setPayload(createPayload({ matches }));
    await harness.fireDomReady();

    harness.runNextTimer(); // 进入第二屏
    expect(visibleRows(harness).map((row) => row.left)).toEqual(['场5-左', '场6-左', '', '']);

    // 新登记一局（第 5 场多一局 → 行数 7 → 仍 2 屏）后重新拉取
    const updated = [1, 2, 3, 4, 5, 6].map((index) => (
      index === 5 ? makeMatch('m5', '场5', { games: 2 }) : makeMatch(`m${index}`, `场${index}`)
    ));
    harness.setPayload(createPayload({ matches: updated }));
    await harness.fireDomReady();

    // 仍停在第二屏（旧实现每次数据变化都会跳回第一场），且层数/每层行数不变
    expect(visibleRows(harness).map((row) => row.left)).toEqual(['场5-左', '场5-左', '场6-左', '']);
    expect(harness.elements.page7RowsTrack.children).toHaveLength(2);
    expect(harness.elements.page7RowsTrack.children.every((layer) => layer.children.length === 4)).toBe(true);

    // 选场变少（只剩 2 行 = 1 屏）时当前屏越界 → 回到第一屏
    harness.setPayload(createPayload({ matches: [makeMatch('m1', '甲'), makeMatch('m2', '乙')] }));
    await harness.fireDomReady();
    expect(visibleRows(harness).map((row) => row.left)).toEqual(['甲-左', '乙-左', '', '']);
    // 只有一屏时不再排停留定时器
    expect(harness.pendingDelays()).toEqual([]);
  });
});
