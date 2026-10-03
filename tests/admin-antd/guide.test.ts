/**
 * 「本页怎么用」纯逻辑（lib/guide）测试。
 *
 * 这块只服务顶栏那一个说明入口，所以测试面很窄，但两条不变量必须钉住：
 * 1. **12 个视图都要有说明**（少一个视图，用户在那一页点按钮就是空抽屉）；
 * 2. **每步的锚点必须是合法的 `data-tour` 选择器**（将来万一要把某步直接指到界面上，
 *    锚点写错就是静默失效——那时没人会发现，所以现在就用测试卡住格式）。
 *
 * 「读过哪些视图」的记录只写本机 localStorage，读写失败必须静默降级（隐私模式不能把页面带崩）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  allGuideBodies,
  buildViewTourSteps,
  countUnpairedBoldMarkers,
  DEMO_SPOTLIGHTS,
  GUIDE_VISIT_STORAGE_KEY,
  hasDemoSpotlight,
  readGuideVisits,
  recordGuideVisit,
  splitBoldSegments,
  VIEW_GUIDES,
  viewGuideDemoView,
  viewGuideSteps,
  viewGuideTitle,
} from '../../src/admin-antd/lib/guide';
import type { ViewKey } from '../../src/admin-antd/types';

/** 极简 localStorage 假实现 */
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

function installStorage(storage: unknown): void {
  (globalThis as { localStorage?: unknown }).localStorage = storage;
}

/** 12 个导航视图（与 types.ts 的 ViewKey 一致） */
const ALL_VIEWS: ViewKey[] = ['roster', 'stage', 'tournament', 'mvp', 'history', 'sync', 'profiles', 'page11', 'stats', 'preview', 'live', 'about'];

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('「读过哪些视图」的记录（lib/guide · localStorage）', () => {
  it('没有记录时返回空数组', () => {
    installStorage(createFakeStorage());
    expect(readGuideVisits()).toEqual([]);
  });

  it('记录后能读回来，重复打开不重复记', () => {
    installStorage(createFakeStorage());
    recordGuideVisit('tournament');
    recordGuideVisit('tournament');
    recordGuideVisit('stage');
    expect(readGuideVisits()).toEqual(['tournament', 'stage']);
  });

  it('值损坏时降级为空数组（不抛异常）', () => {
    const storage = createFakeStorage();
    storage.setItem(GUIDE_VISIT_STORAGE_KEY, '{不是 JSON');
    installStorage(storage);
    expect(readGuideVisits()).toEqual([]);

    storage.setItem(GUIDE_VISIT_STORAGE_KEY, JSON.stringify({ 不是: '数组' }));
    expect(readGuideVisits()).toEqual([]);
  });

  it('localStorage 不存在（node / 隐私模式）时读写都不抛异常', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(readGuideVisits()).toEqual([]);
    expect(() => recordGuideVisit('stage')).not.toThrow();
  });

  it('存储抛异常时静默降级', () => {
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
    expect(readGuideVisits()).toEqual([]);
    expect(() => recordGuideVisit('stage')).not.toThrow();
  });
});

describe('视图说明注册表不变量（VIEW_GUIDES）', () => {
  it('覆盖全部 12 个导航视图，且都有标题 / 摘要 / 步骤', () => {
    expect(Object.keys(VIEW_GUIDES).sort()).toEqual([...ALL_VIEWS].sort());
    for (const view of ALL_VIEWS) {
      const guide = VIEW_GUIDES[view];
      expect(guide.title.trim().length, view).toBeGreaterThan(0);
      expect(guide.summary.trim().length, view).toBeGreaterThan(0);
      expect(viewGuideSteps(view).length, view).toBeGreaterThan(0);
    }
  });

  it('视图标题与导航名一致（抽屉头部直接显示它）', () => {
    expect(viewGuideTitle('tournament')).toBe('系列比赛');
    expect(viewGuideTitle('mvp')).toBe('结算画面');
    expect(viewGuideTitle('history')).toBe('比赛管理');
    // 未知视图兜底，不抛异常
    expect(viewGuideTitle('nope' as ViewKey)).toBe('使用说明');
  });

  it('每一步都有标题、正文与合法 kind', () => {
    const kinds = new Set(['step', 'flow']);
    for (const view of ALL_VIEWS) {
      for (const step of viewGuideSteps(view)) {
        expect(step.title.trim().length, view).toBeGreaterThan(0);
        expect(step.body.trim().length, view).toBeGreaterThan(0);
        expect(kinds.has(step.kind), `${view} / ${step.title} 的 kind`).toBe(true);
      }
    }
  });

  it('锚点一律是 data-tour 选择器（不依赖组件库内部 class）', () => {
    // 允许 data-tour（真机界面锚点）与 data-demo-tour（模拟会话里的演示锚点）两种；
    // 两者都是"打标签 + 选择器"，一样不依赖组件库内部 class。
    const allowed = /^\[data-(?:demo-)?tour="[a-z0-9-]+"\]$/;
    for (const view of ALL_VIEWS) {
      for (const step of viewGuideSteps(view)) {
        if (step.target === null) {
          continue;
        }
        expect(step.target, `${view} / ${step.title}`).toMatch(allowed);
      }
    }
  });

  it('demoView 若给了必须是合法视图键（抽屉据此开模拟会话）', () => {
    for (const view of ALL_VIEWS) {
      for (const step of viewGuideSteps(view)) {
        if (step.demoView) {
          expect(ALL_VIEWS).toContain(step.demoView);
        }
      }
    }
  });

  it('viewGuideDemoView 取该视图第一个带 demoView 的步骤；没有则 null', () => {
    expect(viewGuideDemoView('tournament')).toBe('tournament');
    expect(viewGuideDemoView('sync')).toBe('sync');
    // 关于项目只有纯说明，没有可练的流程
    expect(viewGuideDemoView('about')).toBeNull();
  });

  it('「操作流程」类步骤都带 demoView（否则只能读文字、没法练）', () => {
    for (const view of ALL_VIEWS) {
      for (const step of viewGuideSteps(view)) {
        if (step.kind === 'flow') {
          expect(step.demoView, `${view} / ${step.title} 是操作流程但没有 demoView`).toBeTruthy();
        }
      }
    }
  });

  it('buildViewTourSteps 返回副本（「在界面上指出来」用它翻成 Tour 步骤）', () => {
    const copy = buildViewTourSteps('series-tournament' as ViewKey);
    expect(copy).toEqual([]);

    const tournamentCopy = buildViewTourSteps('tournament');
    expect(tournamentCopy).toHaveLength(viewGuideSteps('tournament').length);
    // 必须是副本：改它不能污染注册表（抽屉与 Tour 共用同一份文案）
    tournamentCopy[0]!.title = '被改过';
    expect(viewGuideSteps('tournament')[0]!.title).not.toBe('被改过');
  });

  it('每个视图至少有一半步骤可直接指向元素（否则"在界面上指出来"只能居中显示）', () => {
    for (const view of ALL_VIEWS) {
      const steps = viewGuideSteps(view);
      const anchored = steps.filter((step) => step.target !== null).length;
      expect(anchored, `${view} 可指点的步骤太少`).toBeGreaterThan(0);
    }
  });

  it('「系列比赛」的分步实操：7 步、每步都有锚点、且锚点格式合法', () => {
    const spotlight = DEMO_SPOTLIGHTS.tournament;
    expect(spotlight).toBeDefined();
    expect(spotlight!.length).toBe(7);
    // 锚点允许在 data-*tour 属性后追加后代选择器（如 `[data-demo-tour="x"] .ant-modal-body`）
    const anchorPattern = /^\[data-(?:demo-)?tour="[a-z0-9-]+"\](?:\s+[^\s]+)?$/;
    for (const step of spotlight!) {
      expect(step.id.trim().length, step.title).toBeGreaterThan(0);
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length, step.title).toBeGreaterThan(0);
      expect(step.target, step.title).toMatch(anchorPattern);
      expect(['bottom', 'bottomLeft', 'bottomRight', 'top', 'topLeft', 'topRight', 'left', 'right']).toContain(step.placement);
    }
    // 每一步的 id 唯一（便于将来埋点/断点续走）
    const ids = spotlight!.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('「比赛管理」的分步实操：只讲选场 / 展开看对局与录入阵容 / 台账，每步都有锚点', () => {
    const spotlight = DEMO_SPOTLIGHTS.history;
    expect(spotlight).toBeDefined();
    expect(spotlight!.length).toBe(4);
    for (const step of spotlight!) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length, step.title).toBeGreaterThan(0);
      expect(step.target, step.title).toMatch(/^\[data-(?:demo-)?tour="[a-z0-9-]+"\]$/);
    }
    // 重点覆盖：四张推流卡选场、展开行看对局（录入阵容并入这一步正文）
    const ids = spotlight!.map((step) => step.id);
    expect(ids).toContain('push-cards');
    expect(ids).toContain('table-row');
    // 「录入阵容」的说明必须还在（并进展开行那一步的正文）
    const tableRowStep = spotlight!.find((step) => step.id === 'table-row');
    expect(tableRowStep?.body).toContain('录入阵容');
  });

  it('hasDemoSpotlight 与 DEMO_SPOTLIGHTS 同源（抽屉入口据此显示）', () => {
    expect(hasDemoSpotlight('roster')).toBe(true);
    expect(hasDemoSpotlight('tournament')).toBe(true);
    expect(hasDemoSpotlight('history')).toBe(true);
    // 还没做分步实操的视图不该显示主入口
    expect(hasDemoSpotlight('about')).toBe(false);
    expect(hasDemoSpotlight('stats')).toBe(false);
  });

  it('「赛事面板」的分步实操：5 步覆盖 选比赛→阵容→开始→登记→下一局，每步都有锚点', () => {
    const spotlight = DEMO_SPOTLIGHTS.roster;
    expect(spotlight).toBeDefined();
    expect(spotlight!.length).toBe(5);
    for (const step of spotlight!) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length, step.title).toBeGreaterThan(0);
      expect(step.target, step.title).toMatch(/^\[data-(?:demo-)?tour="[a-z0-9-]+"\]$/);
    }
    const ids = spotlight!.map((step) => step.id);
    expect(ids).toEqual(['pick-match', 'lineup', 'start', 'register', 'next-game']);
    // BO3 的循环说明必须在最后一步正文里（用户明确要求"BO3 则继续这个流程"）
    const last = spotlight![spotlight!.length - 1];
    expect(last.body).toContain('BO3');
    expect(last.body).toContain('开始本次对局');
  });

  it('文案加粗标记：所有正文的 ** 都成对（不成对就会在界面上露出星号）', () => {
    const bodies = allGuideBodies();
    expect(bodies.length).toBeGreaterThan(20);
    for (const entry of bodies) {
      expect(countUnpairedBoldMarkers(entry.body), `${entry.from} / ${entry.title} 的加粗标记没配对`).toBe(0);
    }
  });

  it('splitBoldSegments：奇数下标是加粗段（GuideSpotlight 据此渲染 <strong>）', () => {
    expect(splitBoldSegments('普通**重点**普通')).toEqual(['普通', '重点', '普通']);
    expect(splitBoldSegments('没有标记')).toEqual(['没有标记']);
    // 多段加粗：1/3 下标为加粗
    const segments = splitBoldSegments('A**B**C**D**E');
    expect(segments[1]).toBe('B');
    expect(segments[3]).toBe('D');
    expect(countUnpairedBoldMarkers('A**B**C')).toBe(0);
    expect(countUnpairedBoldMarkers('A**B')).toBe(1);
  });

  it('分步实操里的演示动作只在模拟会话用到的步骤上（且动作名合法）', () => {
    const allowed = new Set(['open-create-tournament', 'close-modal']);
    for (const [view, steps] of Object.entries(DEMO_SPOTLIGHTS)) {
      for (const step of steps ?? []) {
        if (step.activate) {
          expect(allowed.has(step.activate), `${view} / ${step.title} 的动作名非法`).toBe(true);
        }
      }
    }
    // 系列比赛第 1 步必须会替用户打开创建弹窗（用户要求"正常演示弹窗"）
    expect(DEMO_SPOTLIGHTS.tournament?.[0]?.activate).toBe('open-create-tournament');
    // 紧接着那一步要把它关掉，否则后面几步的目标会被弹窗挡住
    expect(DEMO_SPOTLIGHTS.tournament?.[1]?.activate).toBe('close-modal');
  });
});
