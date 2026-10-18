// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';

import type { MatchRecord, MatchStoreState, TournamentRecord } from '../../shared/types';

/**
 * 比赛管理视图（HistoryView）组件测试（M6）：
 * mock 共享数据层与 lib/request，覆盖标签/系列赛/搜索三维 AND 筛选与提示条、
 * 批量标签入口、批量/单场删除、回收站恢复（删除撤销）、分页与展开行。
 * 不依赖真实 socket。
 */
const holder = vi.hoisted(() => ({
  data: null as unknown as Record<string, unknown>,
  requestJson: vi.fn(),
}));

vi.mock('../../src/admin-antd/data/use-admin-data', () => ({
  useAdminData: () => holder.data,
}));
vi.mock('../../src/admin-antd/lib/request', () => ({
  requestJson: holder.requestJson,
  uploadSingleFile: vi.fn(),
}));

// 组件在 `import` 之后才引用 HistoryView，避免 mock 未注册时先加载真实数据层
import { HistoryView } from '../../src/admin-antd/views/HistoryView';

const TOURNAMENT_ID = 'T20260101_A01';

function createGame(status: MatchRecord['games'][number]['status'] = 'pending'): MatchRecord['games'][number] {
  return {
    gameNumber: 1,
    leftLineup: [],
    rightLineup: [],
    leftSlots: [],
    rightSlots: [],
    winner: null,
    status,
  };
}

function createMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  const id = overrides.id ?? '20260101_A001';
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    leftPlayer: '左',
    rightPlayer: '右',
    leftRank: '',
    rightRank: '',
    leftTeamId: '',
    leftTeamName: '',
    rightTeamId: '',
    rightTeamName: '',
    bestOf: 3,
    games: [createGame()],
    leftScore: 0,
    rightScore: 0,
    winner: null,
    completedAt: null,
    tags: [],
    ...overrides,
  };
}

function createTournament(): TournamentRecord {
  return {
    id: TOURNAMENT_ID,
    name: '春季赛',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    seed: 1,
    drawVersion: 1,
    playerIds: ['p1', 'p2'],
    // 单败阶段：formatStageRoundLabel 走「阶段名」分支，不依赖 waves 结构
    stages: [{ name: '总决赛', format: 'single-elim', bestOf: 3 } as TournamentRecord['stages'][number]],
    currentStageIndex: 0,
    entries: [],
    waves: [],
  };
}

function createMatchStore(matches: MatchRecord[], deleteUndoCount = 0): MatchStoreState {
  return {
    activeMatchId: matches[0]?.id ?? null,
    matches,
    undo: { canUndo: false, canRedo: false, canUndoDelete: false, deleteUndoCount, byMatch: {} },
    mtime: null,
  };
}

/** 四场夹具：T1 两次（标签「A」「B」各一）+ 两场普通对局（「A」/无标签） */
function defaultMatches(): MatchRecord[] {
  return [
    createMatch({ id: '20260101_A001', leftPlayer: 'alpha', tags: ['A'], tournamentRef: { tournamentId: TOURNAMENT_ID, nodeId: 's0-w1-n01', stageIndex: 0, waveIndex: 1 } }),
    createMatch({ id: '20260101_A002', leftPlayer: 'beta', tags: ['B'], tournamentRef: { tournamentId: TOURNAMENT_ID, nodeId: 's0-w1-n02', stageIndex: 0, waveIndex: 1 } }),
    createMatch({ id: '20260101_A003', leftPlayer: 'gamma', tags: ['A'] }),
    createMatch({ id: '20260101_A004', leftPlayer: 'delta', tags: [] }),
  ];
}

function setupData(matches: MatchRecord[], options: { deleteUndoCount?: number } = {}): void {
  holder.data = {
    loading: false,
    pageError: '',
    scoreboard: null,
    matchStore: createMatchStore(matches, options.deleteUndoCount ?? 0),
    sprites: [],
    tournaments: [createTournament()],
    locallyRemoved: [],
    recycleBin: [],
    cloudStatus: null,
    cloudAckedMatchIds: [],
    page6: { matchIds: [], title: '', startTime: '', matchTimes: {} },
    page7: { matchIds: [], title: '', notice: '' },
    page8: { matchIds: [], title: '', startTime: '', matchTimes: {} },
    page14: { tournamentId: '', stageIndexes: [], activeStageIndex: -1, page: 0, title: '', subtitle: '', mtime: null },
    page14Standings: null,
    historyNotice: null,
    setHistoryNotice: vi.fn(),
    applyServerState: vi.fn(),
    setPage14: vi.fn(),
    setPage14Standings: vi.fn(),
  };
}

const onEnterLineup = vi.fn();
const onSelectMatch = vi.fn();

function renderView() {
  const utils = render(
    <App>
      <HistoryView onEnterLineup={onEnterLineup} onSelectMatch={onSelectMatch} />
    </App>,
  );
  return utils;
}

function bodyText(container: HTMLElement): string {
  return container.querySelector('.ant-table-tbody')?.textContent ?? '';
}

function filterRow(container: HTMLElement): HTMLElement {
  const node = container.querySelector('.history-filter-row');
  if (!node) {
    throw new Error('未找到筛选行 .history-filter-row');
  }
  return node as HTMLElement;
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
});

beforeEach(() => {
  holder.requestJson.mockReset();
  holder.requestJson.mockResolvedValue({ success: true });
  onEnterLineup.mockReset();
  onSelectMatch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('HistoryView 三维筛选（标签 / 系列赛 / 搜索 AND 叠加）', () => {
  it('逐维叠加筛选并显示提示条，清除筛选恢复全部', async () => {
    setupData(defaultMatches());
    const { container } = renderView();

    expect(bodyText(container)).toContain('alpha');
    expect(bodyText(container)).toContain('delta');
    expect(container.querySelector('.history-filter-hint')).toBeNull();

    // 系列赛维度：只留 T1（alpha / beta）
    fireEvent.click(within(filterRow(container)).getByText(/春季赛/));
    await waitFor(() => expect(bodyText(container)).toContain('alpha'));
    expect(bodyText(container)).not.toContain('gamma');
    expect(bodyText(container)).not.toContain('delta');
    expect(container.querySelector('.history-filter-hint')?.textContent).toContain('显示 2 / 共 4 场');

    // 叠加标签维度「A」→ AND：只剩 alpha
    fireEvent.click(within(filterRow(container)).getByText('A'));
    await waitFor(() => expect(bodyText(container)).not.toContain('beta'));
    expect(bodyText(container)).toContain('alpha');
    expect(container.querySelector('.history-filter-hint')?.textContent).toContain('只看标签「A」');

    // 叠加搜索「alp」→ AND：仍是 alpha
    const searchInput = container.querySelector('.history-search-input input') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'alp' } });
    await waitFor(() => expect(container.querySelector('.history-filter-hint')?.textContent).toContain('搜索「alp」'));
    expect(bodyText(container)).toContain('alpha');

    // 搜索不匹配 → 空表 + 提示条仍显示
    fireEvent.change(searchInput, { target: { value: 'zzz' } });
    await waitFor(() => expect(bodyText(container)).not.toContain('alpha'));
    expect(container.querySelector('.history-filter-hint')?.textContent).toContain('显示 0 / 共 4 场');

    // 清除筛选 → 全部恢复、提示条消失
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    await waitFor(() => expect(container.querySelector('.history-filter-hint')).toBeNull());
    expect(bodyText(container)).toContain('alpha');
    expect(bodyText(container)).toContain('delta');
  });
});

describe('HistoryView 批量操作与删除', () => {
  it('勾选多行显示「批量添加标签」，删除选中赛事调用 batch-delete', async () => {
    setupData(defaultMatches());
    const { container } = renderView();

    expect(screen.queryByRole('button', { name: '批量添加标签' })).toBeNull();

    const checkboxes = container.querySelectorAll<HTMLInputElement>('.ant-table-tbody .ant-checkbox-input');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    await waitFor(() => expect(screen.getByRole('button', { name: '批量添加标签' })).toBeTruthy());

    // 「删除选中赛事」直接调用批量删除（不像行内删除那样弹确认框）
    fireEvent.click(screen.getByRole('button', { name: '删除选中赛事' }));

    await waitFor(() => {
      expect(holder.requestJson).toHaveBeenCalledWith(
        '/api/matches/batch-delete',
        expect.objectContaining({ method: 'POST', json: { matchIds: expect.arrayContaining(['20260101_A001', '20260101_A002']) } }),
      );
    });
  });

  it('行内「删除」弹确认并调用 batch-delete 且只带该场', async () => {
    setupData(defaultMatches());
    const { container } = renderView();

    const row = container.querySelectorAll('.ant-table-tbody .ant-table-row')[0] as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /删\s?除/ }));

    const confirmOk = await waitFor(() => {
      const button = document.querySelector('.ant-modal-confirm-btns .ant-btn-primary');
      expect(button).toBeTruthy();
      return button as HTMLElement;
    });
    fireEvent.click(confirmOk);

    await waitFor(() => {
      expect(holder.requestJson).toHaveBeenCalledWith(
        '/api/matches/batch-delete',
        expect.objectContaining({ json: { matchIds: expect.any(Array) } }),
      );
    });
    const call = holder.requestJson.mock.calls.find(([url]) => url === '/api/matches/batch-delete');
    expect((call?.[1] as { json: { matchIds: string[] } }).json.matchIds).toHaveLength(1);
  });

  it('回收站：打开拉取条目、勾选后恢复选中（删除撤销）', async () => {
    setupData(defaultMatches(), { deleteUndoCount: 1 });
    holder.requestJson.mockImplementation(async (url: string) => {
      if (url === '/api/matches/recycle-bin') {
        return {
          entries: [
            { matchId: '20251201_A009', leftPlayer: '旧甲', rightPlayer: '旧乙', bestOf: 3, status: 'completed', deletedAt: '2025-12-01T10:00:00.000Z' },
          ],
        };
      }
      return { success: true };
    });
    const { container } = renderView();

    fireEvent.click(await waitFor(() => {
      const button = screen.getByRole('button', { name: /回收站/ }) as HTMLElement;
      expect(button.getAttribute('disabled')).toBeNull();
      return button;
    }));

    await waitFor(() => expect(holder.requestJson).toHaveBeenCalledWith('/api/matches/recycle-bin'));

    const dialog = await screen.findByRole('dialog', undefined, { timeout: 3000 });
    await within(dialog).findByText(/旧甲/, undefined, { timeout: 3000 });
    const entryCheckbox = within(dialog).getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(entryCheckbox);

    const restoreButton = await within(dialog).findByRole('button', { name: /恢复选中（1）/ }, { timeout: 3000 });
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(holder.requestJson).toHaveBeenCalledWith(
        '/api/matches/restore-deleted',
        expect.objectContaining({ json: { matchIds: ['20251201_A009'] } }),
      );
    });
    expect(container.querySelector('.ant-table')).toBeTruthy();
  });
});

describe('HistoryView 列表渲染', () => {
  it('分页展示总数并可翻页，点击行可展开小局', async () => {
    const matches = Array.from({ length: 12 }, (_value, index) => createMatch({
      id: `20260101_A${String(index + 1).padStart(3, '0')}`,
      leftPlayer: `选手${index + 1}`,
      // 递增 updatedAt：默认按更新时间倒序，首屏为后 10 场
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    setupData(matches);
    const { container } = renderView();

    await waitFor(() => expect(container.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(10));
    // showTotal 渲染在分页区（不在 tbody 内），故查整表容器文本
    expect(container.textContent).toContain('共 12 条');

    const page2 = document.querySelector('.ant-pagination-item-2') as HTMLElement;
    fireEvent.click(page2);
    await waitFor(() => expect(container.querySelectorAll('.ant-table-tbody .ant-table-row')).toHaveLength(2));

    // 展开行：点第二列（左侧选手）触发展开，渲染小局卡片
    const row = container.querySelectorAll('.ant-table-tbody .ant-table-row')[0] as HTMLElement;
    const cells = row.querySelectorAll('td');
    fireEvent.click(cells[1]);
    await waitFor(() => expect(container.querySelector('.history-detail')).toBeTruthy());
    expect(container.querySelector('.history-detail')?.textContent).toContain('第 1 局');
  });
});
