import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * petscard2 精灵卡片组件测试：node:vm + 极简假 DOM 跑真实组件脚本（petscard.js 一并载入，
 * 复用其属性→背景/图标映射）。覆盖卡片结构、序号双位数左移、阵亡态、icon 右侧镜像、
 * 属性背景变量注入、种族值条（sum 高亮档）与 update 就地更新语义。
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
  attrs: Record<string, string> = {};
  textContent = '';
  alt = '';
  src = '';
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

  setAttribute(name: string, value: string): void {
    // SVG 的 class 只能经 setAttribute 写入，同步进 classList 便于查询
    if (name === 'class') {
      this.className = value;
      return;
    }
    this.attrs[name] = value;
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

  /** 类名（'.foo'）或标签名（'img'）在后代中找第一个匹配节点（组件只用类名查询） */
  querySelector(selector: string): FakeElement | null {
    const byClass = selector.startsWith('.');
    const wanted = byClass ? selector.slice(1) : selector;
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift()!;
      if (byClass ? node.classList.contains(wanted) : node.tagName === wanted) {
        return node;
      }
      stack.unshift(...node.children);
    }
    return null;
  }
}

interface Petscard2Global {
  // 与 petscard2.js 一致：target 可以是选择器字符串，也可以是已拿到的宿主元素
  render: (target: string | FakeElement, options: Record<string, unknown>) => FakeElement;
  update: (card: FakeElement, options: Record<string, unknown>) => void;
}

function loadComponent(): { Petscard2: Petscard2Global; host: FakeElement } {
  const host = new FakeElement('div');
  const sandbox = {
    document: {
      createElement: (tag: string) => new FakeElement(String(tag).toLowerCase()),
      createElementNS: (_ns: string, tag: string) => new FakeElement(String(tag).toLowerCase()),
      querySelector: (selector: string) => (selector === '#host' ? host : null),
    },
    window: {},
  };
  const context = vm.createContext(sandbox);
  // petscard.js 先入沙箱：petscard2 复用其 ATTR_BG / ATTR_NO 映射
  vm.runInContext(readFileSync(join(process.cwd(), 'src/scripts/petscard.js'), 'utf-8'), context);
  vm.runInContext(readFileSync(join(process.cwd(), 'src/scripts/petscard2.js'), 'utf-8'), context);
  return { Petscard2: (sandbox.window as { Petscard2: Petscard2Global }).Petscard2, host };
}

/** 按类名列表（支持多类）在后代中查找 */
function findChild(parent: FakeElement, classNames: string): FakeElement | null {
  const wanted = classNames.split(/\s+/);
  const stack = [...parent.children];
  while (stack.length) {
    const node = stack.shift()!;
    if (wanted.every((name) => node.classList.contains(name))) {
      return node;
    }
    stack.unshift(...node.children);
  }
  return null;
}

const STAT = { icon: '/resources/base-stats/sum.png', text: '582', highlight: true };

describe('petscard2.js 组件（214×238 基准）', () => {
  it('render：结构齐备，属性1 注入背景变量，属性圈/种族值条按参数渲染', () => {
    const { Petscard2, host } = loadComponent();
    const card = Petscard2.render('#host', {
      num: '1',
      name: '迪莫',
      image: '/img/3004_迪莫.png',
      attributes: ['火', '翼'],
      stat: STAT,
    });

    expect(card.className).toBe('petscard2');
    const frame = findChild(card, 'petscard2-frame')!;
    expect(frame.querySelector('path')!.attrs['d']).toBe('M0 0H210L214 201L13 210L0 0Z');
    expect(findChild(card, 'petscard2-mask')).not.toBeNull();

    const num = findChild(card, 'petscard2-num')!;
    expect(num.textContent).toBe('1');
    expect(num.classList.contains('is-double')).toBe(false);

    // 属性1 = 火 → 背景变量与纹理文件（映射来自 petscard.ATTR_BG）
    const mask = findChild(card, 'petscard2-mask')!;
    expect(mask.style['--pc2-top']).toBe('#dd572a');
    expect(String(mask.style['--pc2-pattern'])).toContain('火_T_BackGround_huo.png');

    const pet = findChild(card, 'petscard2-pet')!;
    expect(pet.src).toBe('/img/3004_迪莫.png');
    expect(pet.alt).toBe('迪莫');
    expect(pet.classList.contains('is-flip')).toBe(false);

    // 双属性 → a1/a2 两枚属性圈，图标来自 petscard.ATTR_NO（assetBase 缺省 'assets'）
    const attr1 = findChild(card, 'petscard2-attr a1')!;
    const attr2 = findChild(card, 'petscard2-attr a2')!;
    expect(attr1.querySelector('img')!.src).toBe('assets/attribute/04.png');
    expect(attr2.querySelector('img')!.src).toBe('assets/attribute/15.png');

    // 种族值条：图标 + 数值，sum 高亮档
    const stat = findChild(card, 'petscard2-stat')!;
    expect(stat.classList.contains('is-highlight')).toBe(true);
    expect(stat.querySelector('img')!.src).toBe(STAT.icon);
    expect(stat.querySelector('.petscard2-stat-text')!.textContent).toBe('582');
  });

  it('双位数序号挂 is-double，icon + 右侧站位镜像翻转', () => {
    const { Petscard2 } = loadComponent();
    const card = Petscard2.render(new FakeElement('div'), {
      num: '12',
      image: '/img/icon.png',
      useIcon: true,
      side: '右',
    });

    expect(findChild(card, 'petscard2-num')!.classList.contains('is-double')).toBe(true);
    expect(findChild(card, 'petscard2-pet')!.classList.contains('is-flip')).toBe(true);
  });

  it('阵亡态挂 is-dead；缺 stat 时种族值条不渲染', () => {
    const { Petscard2 } = loadComponent();
    const card = Petscard2.render(new FakeElement('div'), { num: '3', dead: true });
    expect(card.classList.contains('is-dead')).toBe(true);
    expect(findChild(card, 'petscard2-stat')).toBeNull();
  });

  it('scale 参数写入 --pc2-scale，缺省不写', () => {
    const { Petscard2 } = loadComponent();
    const scaled = Petscard2.render(new FakeElement('div'), { scale: 108 / 214 });
    expect(scaled.style['--pc2-scale']).toBe(String(108 / 214));
    const plain = Petscard2.render(new FakeElement('div'), {});
    expect(plain.style['--pc2-scale']).toBeUndefined();
  });

  it('update：就地改序号/种族值/阵亡态，不重建卡片', () => {
    const { Petscard2 } = loadComponent();
    const card = Petscard2.render(new FakeElement('div'), { num: '1', stat: STAT });
    const before = findChild(card, 'petscard2-num');

    Petscard2.update(card, {
      num: 11,
      stat: { icon: '/resources/base-stats/speed.png', text: '120', highlight: false },
      dead: true,
    });

    expect(card.querySelector('.petscard2-num')).toBe(before);
    const num = findChild(card, 'petscard2-num')!;
    expect(num.textContent).toBe('11');
    expect(num.classList.contains('is-double')).toBe(true);
    expect(card.classList.contains('is-dead')).toBe(true);

    const stat = findChild(card, 'petscard2-stat')!;
    expect(stat.classList.contains('is-highlight')).toBe(false);
    expect(stat.querySelector('img')!.src).toBe('/resources/base-stats/speed.png');
    expect(stat.querySelector('.petscard2-stat-text')!.textContent).toBe('120');

    // stat 置 null：整条隐藏；dead 复位
    Petscard2.update(card, { stat: null, dead: false });
    expect(findChild(card, 'petscard2-stat')).toBeNull();
    expect(card.classList.contains('is-dead')).toBe(false);
  });
});
