import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Page14State, StageStandingRow, StageStandings } from '../../shared/types';

/**
 * 推流页面14 渲染逻辑测试：没有浏览器环境，这里用极简假 DOM 跑真实的 page14-display.js，
 * 覆盖最容易出问题的部分——分栏算法、分页切片、行元素增量复用（直播画面不能闪）。
 */

class FakeClassList {
  private names = new Set<string>();

  constructor(initial: string) {
    initial.split(/\s+/).filter(Boolean).forEach((name) => this.names.add(name));
  }

  add(name: string): void {
    this.names.add(name);
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }

  toggle(name: string, force?: boolean): void {
    const next = force === undefined ? !this.names.has(name) : force;
    if (next) {
      this.names.add(name);
    } else {
      this.names.delete(name);
    }
  }

  toString(): string {
    return Array.from(this.names).join(' ');
  }
}

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  classList: FakeClassList;
  dataset: Record<string, string> = {};
  textContent = '';
  hidden = false;
  style = { setProperty: (_name: string, _value: string) => undefined };
  cells?: { rank: FakeElement; name: FakeElement; win: FakeElement; loss: FakeElement };

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

/** 页面里用到的固定节点：JS 只按 id 取用，内容由测试断言 */
const ELEMENT_IDS = [
  'page14Title',
  'page14Subtitle',
  'page14Board',
  'page14Empty',
  'page14EmptyText',
  'page14Footer',
  'page14StageName',
  'page14PageText',
];

interface Harness {
  elements: Record<string, FakeElement>;
  socketHandlers: Record<string, (payload?: unknown) => void>;
  setResponse: (data: { state: Page14State; standings: StageStandings | null }) => void;
}

function createHarness(): Harness {
  const elements: Record<string, FakeElement> = {};
  ELEMENT_IDS.forEach((id) => {
    elements[id] = new FakeElement('div');
  });
  elements.page14Empty.hidden = true;
  elements.page14Footer.hidden = true;

  const documentStub = {
    readyState: 'complete',
    documentElement: new FakeElement('html'),
    getElementById: (id: string) => elements[id] ?? null,
    createElement: (tagName: string) => new FakeElement(tagName),
    addEventListener: () => undefined,
  };

  let payload: { state: Page14State; standings: StageStandings | null } = {
    state: createState(),
    standings: null,
  };
  const socketHandlers: Record<string, (payload?: unknown) => void> = {};

  const sandbox = {
    document: documentStub,
    window: {
      setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }),
    io: () => ({
      on: (event: string, handler: (payload?: unknown) => void) => {
        socketHandlers[event] = handler;
      },
    }),
    console,
    setTimeout,
    clearTimeout,
  };

  const source = readFileSync(join(process.cwd(), 'src/scripts/page14-display.js'), 'utf-8');
  vm.runInContext(source, vm.createContext(sandbox));

  return {
    elements,
    socketHandlers,
    setResponse: (data) => {
      payload = data;
    },
  };
}

function createState(patch: Partial<Page14State> = {}): Page14State {
  return {
    tournamentId: 'T20260928_A01',
    stageIndexes: [0, 1],
    activeStageIndex: 0,
    page: 0,
    title: '',
    subtitle: '',
    mtime: null,
    ...patch,
  };
}

function createRows(count: number, offset = 0): StageStandingRow[] {
  return Array.from({ length: count }, (_value, index) => {
    const rank = offset + index + 1;
    return {
      playerId: `p${rank - 1}`,
      name: `选手${rank - 1}`,
      rank,
      wins: rank <= count / 2 ? 2 : 0,
      losses: rank <= count / 2 ? 0 : 2,
      score: rank <= count / 2 ? 20 : -2,
      state: rank <= count / 2 ? 'promoted' : 'eliminated',
    };
  });
}

function createStandings(patch: Partial<StageStandings> = {}): StageStandings {
  const rows = patch.rows ?? createRows(16);
  return {
    stageIndex: 0,
    stageName: '16进8',
    format: 'double-life',
    bestOf: 1,
    total: rows.length,
    pageSize: 32,
    pageCount: 1,
    completedMatches: 0,
    totalMatches: 0,
    rows,
    ...patch,
  };
}

/** 每栏的行元素（跳过表头行） */
function columnRows(element: FakeElement, columnIndex: number): FakeElement[] {
  return element.children[columnIndex].children.slice(1);
}

/** 等初始 fetch 的微任务链跑完（页面初始化是异步的） */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('page14-display.js 渲染', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('16 人榜单分 2 栏渲染，名次/选手/胜负写入、淘汰行压暗、副标题自动生成', async () => {
    const harness = createHarness();
    harness.setResponse({ state: createState(), standings: createStandings() });
    harness.socketHandlers.snapshot?.({ page14: createState() });
    await settle();

    const board = harness.elements.page14Board;
    expect(board.children).toHaveLength(2);
    expect(columnRows(board, 0)).toHaveLength(8);
    expect(columnRows(board, 1)).toHaveLength(8);

    const first = columnRows(board, 0)[0];
    expect(first.cells?.rank.textContent).toBe('1');
    expect(first.cells?.name.textContent).toBe('选手0');
    expect(first.cells?.win.textContent).toBe('2');
    expect(first.cells?.loss.textContent).toBe('0');
    expect(first.classList.contains('is-top')).toBe(true);

    const eliminated = columnRows(board, 1)[7];
    expect(eliminated.cells?.rank.textContent).toBe('16');
    expect(eliminated.classList.contains('is-out')).toBe(true);

    expect(harness.elements.page14Title.textContent).toBe('晋级积分榜');
    expect(harness.elements.page14Subtitle.textContent).toBe('16进8 · 双败淘汰 · BO1 · 赢满 2 场晋级');
    // 单页不显示页脚
    expect(harness.elements.page14Footer.hidden).toBe(true);
    expect(harness.elements.page14Empty.hidden).toBe(true);
  });

  it('32 行以上分 3 栏；64 人第 2 页显示 33-64 名并给出页码', async () => {
    const harness = createHarness();
    harness.setResponse({
      state: createState({ page: 1 }),
      standings: createStandings({ stageName: '64进32', rows: createRows(64), total: 64, pageCount: 2 }),
    });
    harness.socketHandlers.snapshot?.({ page14: createState({ page: 1 }) });
    await settle();

    const board = harness.elements.page14Board;
    expect(board.children).toHaveLength(3);
    expect(columnRows(board, 0)).toHaveLength(11);
    expect(columnRows(board, 2)).toHaveLength(10);
    expect(columnRows(board, 0)[0].cells?.rank.textContent).toBe('33');
    expect(columnRows(board, 2)[9].cells?.rank.textContent).toBe('64');

    expect(harness.elements.page14Footer.hidden).toBe(false);
    expect(harness.elements.page14StageName.textContent).toBe('64进32');
    expect(harness.elements.page14PageText.textContent).toBe('第 2 / 2 页');
  });

  it('后台标题/副标题覆盖自动文案', async () => {
    const harness = createHarness();
    harness.setResponse({
      state: createState({ title: '夏季杯 · 晋级积分榜', subtitle: 'BO1 · 双败淘汰赛' }),
      standings: createStandings(),
    });
    harness.socketHandlers.snapshot?.({ page14: createState() });
    await settle();

    expect(harness.elements.page14Title.textContent).toBe('夏季杯 · 晋级积分榜');
    expect(harness.elements.page14Subtitle.textContent).toBe('BO1 · 双败淘汰赛');
  });

  it('赛果变化时复用行元素、只改文本（不重建 DOM）', async () => {
    const harness = createHarness();
    harness.setResponse({ state: createState(), standings: createStandings() });
    harness.socketHandlers.snapshot?.({ page14: createState() });
    await settle();

    const board = harness.elements.page14Board;
    const firstBefore = columnRows(board, 0)[0];
    expect(firstBefore.cells?.win.textContent).toBe('2');

    // 同一批选手、战绩变化：行元素必须还是同一个实例
    const updatedRows = createRows(16).map((row) => (
      row.rank === 1 ? { ...row, wins: 1, losses: 1, state: 'alive' as const } : row
    ));
    harness.setResponse({
      state: createState(),
      standings: createStandings({ rows: updatedRows, completedMatches: 8 }),
    });
    harness.socketHandlers['page14:update']?.({ state: createState() });
    await vi.waitFor(() => {
      expect(harness.elements.page14Board.children[0].children[1].cells?.win.textContent).toBe('1');
    }, { timeout: 2000 });

    const firstAfter = columnRows(harness.elements.page14Board, 0)[0];
    expect(firstAfter).toBe(firstBefore);
    expect(firstAfter.cells?.win.textContent).toBe('1');
    expect(firstAfter.cells?.loss.textContent).toBe('1');
    expect(firstAfter.classList.contains('is-out')).toBe(false);
  });

  it('未配置系列赛 / 系列赛缺失时显示占位而不是空榜单', async () => {
    const harness = createHarness();
    harness.setResponse({
      state: createState({ tournamentId: '', activeStageIndex: -1, stageIndexes: [] }),
      standings: null,
    });
    harness.socketHandlers.snapshot?.({ page14: createState() });
    await settle();

    expect(harness.elements.page14Empty.hidden).toBe(false);
    expect(harness.elements.page14EmptyText.textContent).toContain('等待裁判端');
    expect(harness.elements.page14Board.children).toHaveLength(0);

    harness.setResponse({ state: createState(), standings: null });
    harness.socketHandlers['page14:update']?.({ state: createState() });
    await vi.waitFor(() => {
      expect(harness.elements.page14EmptyText.textContent).toContain('系列赛不存在');
    }, { timeout: 2000 });
  });

  it('阶段未开打（空行）时也给出占位文案', async () => {
    const harness = createHarness();
    harness.setResponse({
      state: createState({ activeStageIndex: 1 }),
      standings: createStandings({ stageIndex: 1, stageName: '8进4', rows: [], total: 0 }),
    });
    harness.socketHandlers.snapshot?.({ page14: createState() });
    await settle();

    expect(harness.elements.page14Empty.hidden).toBe(false);
    expect(harness.elements.page14EmptyText.textContent).toContain('尚无参赛数据');
  });
});
