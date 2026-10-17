import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * 推流页面17（阵容展示5）渲染逻辑测试：node:vm + 极简假 DOM 跑真实的 page17-display.js
 * （Petscard2 用桩记录 render/update，Page16Rank 加载真实脚本）。
 * 覆盖：双方 1-12 排名摆位（首末位外扩 x82、中间 x32、y 步进 128）、镜像反转、
 * 黑色比分栏渲染口径、卡片标签切换（name 档回落 sum）与阵亡态。
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

  toggle(name: string, force?: boolean): boolean {
    const next = force === undefined ? !this.names.has(name) : force;
    if (next) {
      this.names.add(name);
    } else {
      this.names.delete(name);
    }
    return next;
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
  src = '';
  style = createStyle();
  /** 假 DOM 不做布局，fitPlayerName 的量宽判定自然跳过 */
  scrollWidth = 0;
  clientWidth = 0;

  constructor(tagName: string, className = '') {
    this.tagName = tagName;
    this.classList = new FakeClassList(className);
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

  /** 类名（'.foo'）在后代中找第一个匹配节点（renderRank 查 .page17-rank-txt） */
  querySelector(selector: string): FakeElement | null {
    const wanted = selector.replace(/^\./, '');
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift()!;
      if (node.classList.contains(wanted)) {
        return node;
      }
      stack.unshift(...node.children);
    }
    return null;
  }
}

interface Petscard2RenderCall {
  host: FakeElement;
  opts: { num: string; name: string; side: string; scale: number };
}

interface Harness {
  elements: Record<string, FakeElement>;
  screenHost: FakeElement;
  /** Petscard2.render 收到的调用（按时间序） */
  renderCalls: Petscard2RenderCall[];
  /** 卡片元素 → 最近一次 update 的 {num, stat} */
  cardContent: Map<FakeElement, { num: string; stat: { icon: string; highlight: boolean } | null }>;
  /** 卡片元素 → render 时的精灵名 */
  cardNames: Map<FakeElement, string>;
  emitStageUpdate: (stage: Record<string, unknown>) => void;
  fireDomReady: () => Promise<void>;
}

const ELEMENT_IDS = [
  'page17Scoreboard',
  'page17LeftScore',
  'page17RightScore',
  'page17BestOf',
  'page17LeftName',
  'page17RightName',
  'page17LeftRank',
  'page17RightRank',
  'page17LeftAvatar',
  'page17RightAvatar',
  'page17LeftAvatarImage',
  'page17RightAvatarImage',
];

interface SnapshotOverrides {
  panels?: unknown[];
  scoreboard?: Record<string, unknown>;
  avatars?: Record<string, unknown>;
  stage?: Record<string, unknown>;
}

function createHarness(snapshot: SnapshotOverrides = {}): Harness {
  const elements: Record<string, FakeElement> = {};
  ELEMENT_IDS.forEach((id) => {
    elements[id] = new FakeElement('div');
  });
  // 左右排名徽章内嵌数字节点（renderRank 用 querySelector 查 .page17-rank-txt）
  (['page17LeftRank', 'page17RightRank'] as const).forEach((id) => {
    elements[id].appendChild(new FakeElement('div', 'page17-rank-txt'));
  });
  const screenHost = new FakeElement('div', 'page17-screen');

  const renderCalls: Petscard2RenderCall[] = [];
  const cardContent = new Map<FakeElement, { num: string; stat: { icon: string; highlight: boolean } | null }>();
  const cardNames = new Map<FakeElement, string>();

  const domReadyHandlers: Array<() => unknown> = [];
  const documentStub = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelector: (selector: string) => (selector === '.page17-screen' ? screenHost : null),
    addEventListener: (event: string, handler: () => unknown) => {
      if (event === 'DOMContentLoaded') {
        domReadyHandlers.push(handler);
      }
    },
  };

  const socketHandlers: Record<string, (data?: unknown) => void> = {};
  const payload = {
    panels: snapshot.panels ?? [],
    scoreboard: snapshot.scoreboard ?? {},
    avatars: snapshot.avatars ?? {},
    stage: snapshot.stage ?? {},
  };

  const sandbox = {
    document: documentStub,
    window: {
      Petscard2: {
        assetBase: '',
        render: (host: FakeElement, opts: Record<string, unknown>) => {
          const el = new FakeElement('div', 'petscard2');
          renderCalls.push({ host, opts: opts as Petscard2RenderCall['opts'] });
          cardNames.set(el, String(opts.name || ''));
          host.appendChild(el);
          return el;
        },
        update: (el: FakeElement, opts: { num: string; stat: { icon: string; highlight: boolean } | null }) => {
          cardContent.set(el, { num: opts.num, stat: opts.stat });
        },
      },
    },
    fetch: (url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(
        // 脚本用的是相对路径（无前导斜杠），按文件名匹配
        url.includes('api/panels') ? { panels: payload.panels }
          : url.includes('api/scoreboard') ? payload.scoreboard
          : url.includes('api/avatars') ? payload.avatars
          : payload.stage,
      ),
    }),
    io: () => ({
      on: (event: string, handler: (data?: unknown) => void) => {
        socketHandlers[event] = handler;
      },
    }),
    console,
  };

  const context = vm.createContext(sandbox);
  // 排名纯函数先入沙箱（display 脚本调 window.Page16Rank）
  const rankSource = readFileSync(join(process.cwd(), 'src/scripts/page16-rank.js'), 'utf-8');
  vm.runInContext(rankSource, context);
  const source = readFileSync(join(process.cwd(), 'src/scripts/page17-display.js'), 'utf-8');
  vm.runInContext(source, context);

  return {
    elements,
    screenHost,
    renderCalls,
    cardContent,
    cardNames,
    emitStageUpdate: (stage) => {
      socketHandlers['stage:update']?.({ stage });
    },
    fireDomReady: async () => {
      await Promise.all(domReadyHandlers.map((handler) => handler()));
      // 初始化里的 fetch 链是微任务，让它们跑完
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function makeSprite(id: string, displayName: string, baseStats: Record<string, number>): Record<string, unknown> {
  return {
    id,
    path: `/img/${id}.png`,
    displayName,
    name: displayName,
    attribute: '火',
    baseStats,
  };
}

/** 展示位（left+top 坐标）→ 卡片当前精灵名 */
function nameByPosition(harness: Harness): Record<string, string> {
  const result: Record<string, string> = {};
  harness.screenHost.children.forEach((card) => {
    const name = harness.cardNames.get(card);
    if (name) {
      result[`${String(card.style.left)},${String(card.style.top)}`] = name;
    }
  });
  return result;
}

function createSnapshot(): SnapshotOverrides {
  return {
    panels: [
      { position: 'left', selected: [
        { sprite: makeSprite('101', '灵左一', { sum: 600, hp: 90 }) },
        { sprite: makeSprite('102', '灵左二', { sum: 500, hp: 110 }) },
      ] },
      { position: 'right', selected: [
        { sprite: makeSprite('202', '灵右一', { sum: 550, hp: 100 }) },
      ] },
    ],
    scoreboard: {
      leftScore: '2',
      rightScore: '1',
      bestOf: 3,
      leftName: '玩家甲',
      rightName: '玩家乙',
      leftRank: '16000',
      rightRank: '32',
    },
    avatars: {
      left: { exists: true, path: '/avatars/a.png', mtime: 111 },
      right: { exists: true, path: '/avatars/b.png', mtime: 222 },
    },
    stage: { page3RankVisible: true },
  };
}

describe('page17-display.js 阵容展示5', () => {
  it('按双方 1-12 排名摆位：首末位 x82 外扩、中间 x32、y 步进 128；比分栏按 page3 口径渲染', async () => {
    const harness = createHarness(createSnapshot());
    await harness.fireDomReady();

    // 排名：灵左一 600 → 1（左首位）、灵右一 550 → 2（右首位）、灵左二 500 → 3（左第 2 位）
    const names = nameByPosition(harness);
    expect(names['82px,196px']).toBe('灵左一');
    expect(names['32px,324px']).toBe('灵左二');
    expect(names['1730px,196px']).toBe('灵右一');

    // 缩放倍率 108/214 注入 --pc2-scale
    expect(String(harness.renderCalls[0].opts.scale)).toBe(String(108 / 214));

    expect(harness.elements.page17LeftScore.textContent).toBe('2');
    expect(harness.elements.page17RightScore.textContent).toBe('1');
    expect(harness.elements.page17BestOf.textContent).toBe('BO3');
    expect(harness.elements.page17LeftName.textContent).toBe('玩家甲');
    expect(harness.elements.page17RightName.textContent).toBe('玩家乙');
    // 排名 >10000 显示 10000+（page3 比分栏口径）
    expect(harness.elements.page17LeftRank.querySelector('.page17-rank-txt')!.textContent).toBe('10000+');
    expect(harness.elements.page17LeftRank.querySelector('.page17-rank-txt')!.hidden).toBe(false);
    expect(harness.elements.page17RightRank.querySelector('.page17-rank-txt')!.textContent).toBe('32');

    expect(harness.elements.page17LeftAvatarImage.src).toBe('/avatars/a.png?t=111');
    expect(harness.elements.page17RightAvatarImage.src).toBe('/avatars/b.png?t=222');
  });

  it('卡片标签默认 sum 高亮；切 hp 按 hp 展示；name 档回落 sum', async () => {
    const harness = createHarness(createSnapshot());
    await harness.fireDomReady();

    const statOf = (name: string) => {
      const card = harness.screenHost.children.find((item) => harness.cardNames.get(item) === name)!;
      return harness.cardContent.get(card)!.stat;
    };
    expect(statOf('灵左一')!.icon).toBe('/resources/base-stats/sum.png');
    expect(statOf('灵左一')!.highlight).toBe(true);

    harness.emitStageUpdate({ page16CardLabel: 'hp' });
    expect(statOf('灵左一')!.icon).toBe('/resources/base-stats/hp.png');
    expect(statOf('灵左一')!.highlight).toBe(false);

    harness.emitStageUpdate({ page16CardLabel: 'name' });
    expect(statOf('灵左一')!.icon).toBe('/resources/base-stats/sum.png');
    expect(statOf('灵左一')!.highlight).toBe(true);
  });

  it('stage:update 切镜像：卡片摆位/记分牌/头像整体左右互换，关掉后还原', async () => {
    const harness = createHarness(createSnapshot());
    await harness.fireDomReady();

    harness.emitStageUpdate({ mirrorSides: true });

    // 视图左侧改为渲染实际右方数据（数据口径不变，仅展示互换）
    const names = nameByPosition(harness);
    expect(names['82px,196px']).toBe('灵右一');
    expect(names['1730px,196px']).toBe('灵左一');
    expect(names['1780px,324px']).toBe('灵左二');

    expect(harness.elements.page17LeftScore.textContent).toBe('1');
    expect(harness.elements.page17RightScore.textContent).toBe('2');
    expect(harness.elements.page17LeftName.textContent).toBe('玩家乙');
    expect(harness.elements.page17RightName.textContent).toBe('玩家甲');
    expect(harness.elements.page17LeftAvatarImage.src).toBe('/avatars/b.png?t=222');
    expect(harness.elements.page17RightAvatarImage.src).toBe('/avatars/a.png?t=111');

    harness.emitStageUpdate({ mirrorSides: false });

    const restored = nameByPosition(harness);
    expect(restored['82px,196px']).toBe('灵左一');
    expect(restored['1730px,196px']).toBe('灵右一');
    expect(harness.elements.page17LeftScore.textContent).toBe('2');
  });

  it('初始化快照带 mirrorSides=true：首帧即按镜像渲染', async () => {
    const snapshot = createSnapshot();
    snapshot.stage = { mirrorSides: true, page3RankVisible: true };
    const harness = createHarness(snapshot);
    await harness.fireDomReady();

    const names = nameByPosition(harness);
    expect(names['82px,196px']).toBe('灵右一');
    expect(names['1730px,196px']).toBe('灵左一');
    expect(harness.elements.page17LeftName.textContent).toBe('玩家乙');
    expect(harness.elements.page17LeftAvatarImage.src).toBe('/avatars/b.png?t=222');
  });

  it('阵亡槽位：卡片挂 is-dead，复活后移除', async () => {
    const snapshot = createSnapshot();
    (snapshot.panels![0] as { selected: unknown[] }).selected = [
      { sprite: makeSprite('101', '灵左一', { sum: 600, hp: 90 }) },
      {
        sprite: makeSprite('102', '灵左二', { sum: 500, hp: 110 }),
        healthEnabled: true,
        healthPercent: 0,
      },
    ];
    const harness = createHarness(snapshot);
    await harness.fireDomReady();

    const deadCard = harness.screenHost.children.find((item) => harness.cardNames.get(item) === '灵左二')!;
    expect(deadCard.classList.contains('is-dead')).toBe(true);
    expect(deadCard.style.top).toBe('324px');
  });
});
