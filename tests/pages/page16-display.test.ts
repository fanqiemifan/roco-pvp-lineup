import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * 推流页面16 渲染逻辑测试：node:vm + 极简假 DOM 跑真实的 page16-display.js
 * （Petscard 用桩记录 render/update，Page16Rank 加载真实脚本）。
 * 重点覆盖「阵容镜像反转」：渲染时左右互换（卡片摆位/记分牌/头像），数据与排名口径不变。
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

  querySelector(_selector: string): FakeElement | null {
    return null;
  }
}

interface PetscardRenderCall {
  host: FakeElement;
  opts: { name: string; side: string };
}

interface Harness {
  elements: Record<string, FakeElement>;
  screenHost: FakeElement;
  /** Petscard.render 收到的调用（按时间序） */
  renderCalls: PetscardRenderCall[];
  /** 卡片元素 → 最近一次 update 的 {num, name} */
  cardContent: Map<FakeElement, { num: string; name: string }>;
  emitStageUpdate: (stage: Record<string, unknown>) => void;
  fireDomReady: () => Promise<void>;
}

const ELEMENT_IDS = [
  'page16Score',
  'page16BestOf',
  'page16LeftName',
  'page16RightName',
  'page16LeftRank',
  'page16RightRank',
  'page16LeftAvatarImage',
  'page16RightAvatarImage',
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
  const screenHost = new FakeElement('div', 'page16-screen');

  const renderCalls: PetscardRenderCall[] = [];
  const cardContent = new Map<FakeElement, { num: string; name: string }>();

  const domReadyHandlers: Array<() => unknown> = [];
  const documentStub = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelector: (selector: string) => (selector === '.page16-screen' ? screenHost : null),
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
      Petscard: {
        assetBase: '',
        render: (host: FakeElement, opts: { name: string; side: string }) => {
          const el = new FakeElement('div', 'petscard');
          renderCalls.push({ host, opts });
          host.appendChild(el);
          return el;
        },
        update: (el: FakeElement, opts: { num: string; name: string }) => {
          cardContent.set(el, { num: opts.num, name: opts.name });
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
  const source = readFileSync(join(process.cwd(), 'src/scripts/page16-display.js'), 'utf-8');
  vm.runInContext(source, context);

  return {
    elements,
    screenHost,
    renderCalls,
    cardContent,
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

function makeSprite(id: string, displayName: string, sum: number): Record<string, unknown> {
  return {
    id,
    path: `/img/${id}.png`,
    displayName,
    name: displayName,
    attribute: '火',
    baseStats: { sum },
  };
}

function createSnapshot(): SnapshotOverrides {
  return {
    panels: [
      { position: 'left', selected: [{ sprite: makeSprite('101', '灵左', 600) }] },
      { position: 'right', selected: [{ sprite: makeSprite('202', '灵右', 500) }] },
    ],
    scoreboard: {
      leftScore: '2',
      rightScore: '1',
      bestOf: 3,
      leftName: '玩家甲',
      rightName: '玩家乙',
      leftRank: '16',
      rightRank: '32',
    },
    avatars: {
      left: { exists: true, path: '/avatars/a.png', mtime: 111 },
      right: { exists: true, path: '/avatars/b.png', mtime: 222 },
    },
    // /api/stage 全量配置在脚本里按「字段 === true」判定，这里给上排名默认开
    stage: { page16RankVisible: true },
  };
}

/** 展示位（按 left 坐标）→ 卡片当前名字 */
function nameByPosition(harness: Harness): Record<string, string> {
  const result: Record<string, string> = {};
  harness.screenHost.children.forEach((card) => {
    const content = harness.cardContent.get(card);
    if (content) {
      result[String(card.style.left)] = content.name;
    }
  });
  return result;
}

describe('page16-display.js 阵容镜像反转', () => {
  it('默认不镜像：视图左侧显实际左方数据，记分牌/头像按原左右渲染', async () => {
    const harness = createHarness(createSnapshot());
    await harness.fireDomReady();

    // 卡片摆位：灵左（sum 600 → 名次1）在视图左首位 220px，灵右在视图右首位 1578px
    const names = nameByPosition(harness);
    expect(names['220px']).toBe('灵左');
    expect(names['1578px']).toBe('灵右');

    expect(harness.elements.page16Score.textContent).toBe('2 : 1');
    expect(harness.elements.page16LeftName.textContent).toBe('玩家甲');
    expect(harness.elements.page16RightName.textContent).toBe('玩家乙');
    expect(harness.elements.page16LeftRank.textContent).toBe('16');
    expect(harness.elements.page16RightRank.textContent).toBe('32');

    expect(harness.elements.page16LeftAvatarImage.src).toBe('/avatars/a.png?t=111');
    expect(harness.elements.page16RightAvatarImage.src).toBe('/avatars/b.png?t=222');
  });

  it('stage:update 切镜像：卡片摆位/记分牌/头像整体左右互换，关掉后还原', async () => {
    const harness = createHarness(createSnapshot());
    await harness.fireDomReady();

    harness.emitStageUpdate({ mirrorSides: true });

    // 视图左侧改为渲染实际右方数据（数据口径不变，仅展示互换）
    const names = nameByPosition(harness);
    expect(names['220px']).toBe('灵右');
    expect(names['1578px']).toBe('灵左');

    expect(harness.elements.page16Score.textContent).toBe('1 : 2');
    expect(harness.elements.page16LeftName.textContent).toBe('玩家乙');
    expect(harness.elements.page16RightName.textContent).toBe('玩家甲');
    expect(harness.elements.page16LeftRank.textContent).toBe('32');
    expect(harness.elements.page16RightRank.textContent).toBe('16');

    expect(harness.elements.page16LeftAvatarImage.src).toBe('/avatars/b.png?t=222');
    expect(harness.elements.page16RightAvatarImage.src).toBe('/avatars/a.png?t=111');

    harness.emitStageUpdate({ mirrorSides: false });

    const restored = nameByPosition(harness);
    expect(restored['220px']).toBe('灵左');
    expect(restored['1578px']).toBe('灵右');
    expect(harness.elements.page16Score.textContent).toBe('2 : 1');
    expect(harness.elements.page16LeftName.textContent).toBe('玩家甲');
    expect(harness.elements.page16LeftAvatarImage.src).toBe('/avatars/a.png?t=111');
  });

  it('初始化快照带 mirrorSides=true：首帧即按镜像渲染', async () => {
    const snapshot = createSnapshot();
    snapshot.stage = { mirrorSides: true, page16RankVisible: true };
    const harness = createHarness(snapshot);
    await harness.fireDomReady();

    const names = nameByPosition(harness);
    expect(names['220px']).toBe('灵右');
    expect(names['1578px']).toBe('灵左');
    expect(harness.elements.page16LeftName.textContent).toBe('玩家乙');
    expect(harness.elements.page16LeftAvatarImage.src).toBe('/avatars/b.png?t=222');
  });
});
