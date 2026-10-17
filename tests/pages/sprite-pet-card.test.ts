import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * sprite-pet-card 精灵立绘卡片组件测试：node:vm + 极简假 DOM 跑真实组件脚本。
 * 覆盖双名字模式（page3 canvas 名字图 / page5 纯文本）、立绘候选降级与兜底、
 * 属性图标失败移除、render 增量（签名不变不重建卡片）、canvas 不可用降级纯文本。
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

  get length(): number {
    return this.names.size;
  }

  item(index: number): string | null {
    return Array.from(this.names)[index] ?? null;
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
  dataset: Record<string, string> = {};
  style = createStyle();
  clientWidth = 0;
  textContent = '';
  alt = '';
  src = '';
  width = 0;
  height = 0;
  onerror: (() => void) | null = null;

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

  removeAttribute(_name: string): void {}
}

/** canvas 桩：measureText 固定量宽，toDataURL 回固定 data URI */
class FakeCanvas extends FakeElement {
  width = 0;
  height = 0;

  getContext(kind: string): Record<string, unknown> | null {
    if (kind !== '2d') {
      return null;
    }
    return {
      font: '',
      fillStyle: '',
      textBaseline: '',
      scale: () => undefined,
      measureText: () => ({ width: 42 }),
      fillText: () => undefined,
    };
  }

  toDataURL(): string {
    return 'data:image/png;base64,TEST';
  }
}

/** canvas 不可用的环境：getContext 返回 null（真实浏览器降级路径） */
class FakeCanvasLessElement extends FakeElement {
  getContext(): null {
    return null;
  }
}

interface SpritePetCardGlobal {
  render: (slotEl: FakeElement, options: Record<string, unknown>) => FakeElement | null;
  create: (options: Record<string, unknown>) => FakeElement;
  clearNameImageCache: () => void;
}

function loadComponent(withCanvas: boolean): SpritePetCardGlobal {
  const createElement = (tagName: string): FakeElement => {
    const normalized = String(tagName).toLowerCase();
    if (normalized === 'canvas') {
      return withCanvas ? new FakeCanvas(normalized) : new FakeCanvasLessElement(normalized);
    }
    return new FakeElement(normalized);
  };
  const sandbox = {
    document: { createElement },
    window: {},
  };
  const source = readFileSync(join(process.cwd(), 'src/scripts/sprite-pet-card.js'), 'utf-8');
  vm.runInContext(source, vm.createContext(sandbox));
  return (sandbox.window as { SpritePetCard: SpritePetCardGlobal }).SpritePetCard;
}

function findChild(parent: FakeElement, className: string): FakeElement | null {
  return parent.children.find((child) => child.classList.contains(className)) ?? null;
}

describe('sprite-pet-card.js 组件（page3 canvas 名字图 / page5 纯文本）', () => {
  it('text 模式（page5）：128 卡、名字 span、结构齐备、双属性走 has-attr2', () => {
    const { create } = loadComponent(true);
    const card = create({
      name: '迪莫',
      nameMode: 'text',
      size: 128,
      sprite: { attributeIcon1: '/attr1.png', attributeIcon2: '/attr2.png' },
      images: ['/sprite.png'],
      fallbackSrc: '/back.png',
      sourceKey: '/sprite.png',
    });

    expect(card.className).toBe('sprite-pet-card sprite-pet-card-has-attr2');
    expect(card.style['--pet-card-size']).toBe('128px');
    // 名字 2 字 → 名字条左偏移 44
    expect(card.style['--pet-name-left']).toBe('44');

    const sprite = findChild(card, 'sprite-pet-card-sprite');
    expect(sprite?.src).toBe('/sprite.png');
    expect(sprite?.alt).toBe('迪莫');
    expect(findChild(card, 'sprite-pet-card-bg')).not.toBeNull();
    expect(findChild(card, 'sprite-pet-card-attr-circle')).not.toBeNull();
    expect(findChild(card, 'sprite-pet-card-attr-1')).not.toBeNull();
    expect(findChild(card, 'sprite-pet-card-attr-2')).not.toBeNull();
    expect(findChild(card, 'sprite-pet-card-name-bg')).not.toBeNull();

    const name = findChild(card, 'sprite-pet-card-name');
    expect(name?.textContent).toBe('迪莫');
    expect(name?.classList.contains('sprite-pet-card-name-image')).toBe(false);
  });

  it('单属性时不带 attr-circle、名字按字数取左偏移', () => {
    const { create } = loadComponent(true);
    const card = create({
      name: '精灵名字五',
      nameMode: 'text',
      size: 128,
      sprite: { attributeIcon1: '/attr1.png' },
      images: ['/sprite.png'],
    });

    expect(card.className).toBe('sprite-pet-card');
    expect(card.style['--pet-name-left']).toBe('34');
    expect(findChild(card, 'sprite-pet-card-attr-circle')).toBeNull();
    expect(findChild(card, 'sprite-pet-card-attr-2')).toBeNull();
  });

  it('立绘候选依次降级，末尾落到兜底图后停止', () => {
    const { create } = loadComponent(true);
    const card = create({
      name: '迪莫',
      nameMode: 'text',
      size: 128,
      images: ['/a.png', '/b.png'],
      fallbackSrc: '/back.png',
    });
    const sprite = findChild(card, 'sprite-pet-card-sprite')!;
    expect(sprite.src).toBe('/a.png');

    sprite.onerror!();
    expect(sprite.src).toBe('/b.png');
    sprite.onerror!();
    expect(sprite.src).toBe('/back.png');
    // 兜底也失败：不再重试
    sprite.onerror!();
    expect(sprite.src).toBe('/back.png');
    expect(sprite.onerror).toBeNull();
  });

  it('属性图标加载失败自动移除，不残留破图', () => {
    const { create } = loadComponent(true);
    const card = create({
      name: '迪莫',
      nameMode: 'text',
      size: 128,
      sprite: { attributeIcon1: '/broken.png' },
      images: ['/sprite.png'],
    });
    const icon = findChild(card, 'sprite-pet-card-attr-1')!;
    icon.onerror!();
    expect(findChild(card, 'sprite-pet-card-attr-1')).toBeNull();
  });

  it('canvas 模式（page3）：名字画成 PNG（4x 超采样），同名同尺寸走缓存', () => {
    const { create } = loadComponent(true);
    const card = create({
      name: '迪莫',
      nameMode: 'canvas',
      size: 96,
      images: ['/sprite.png'],
    });
    const name = findChild(card, 'sprite-pet-card-name-image');
    expect(name).not.toBeNull();
    expect(name?.classList.contains('sprite-pet-card-name')).toBe(true);
    expect(name?.src).toBe('data:image/png;base64,TEST');
    // measureText 42 → 文本宽 44（+2 padding）；行高 96*14/96 = 14
    expect(name?.width).toBe(44);
    expect(name?.height).toBe(14);

    // 同名同尺寸再次创建：命中缓存（同一 data URI），两张卡互不影响
    const card2 = create({ name: '迪莫', nameMode: 'canvas', size: 96, images: ['/sprite.png'] });
    expect(findChild(card2, 'sprite-pet-card-name-image')?.src).toBe('data:image/png;base64,TEST');
  });

  it('canvas 不可用时自动降级纯文本，名字不空缺', () => {
    const { create } = loadComponent(false);
    const card = create({
      name: '迪莫',
      nameMode: 'canvas',
      size: 96,
      images: ['/sprite.png'],
    });
    expect(findChild(card, 'sprite-pet-card-name-image')).toBeNull();
    const name = findChild(card, 'sprite-pet-card-name');
    expect(name?.textContent).toBe('迪莫');
  });

  it('render 增量：签名不变返回同一卡片，身份变化才重建，全空清槽', () => {
    const { render } = loadComponent(true);
    const slot = new FakeElement('div', 'page3-spirit-slot');
    slot.clientWidth = 108;

    const options = {
      name: '迪莫',
      nameMode: 'canvas',
      sprite: { attributeIcon1: '/attr1.png' },
      images: ['/sprite.png?t=1'],
      sourceKey: 'sprite-1',
    };
    const first = render(slot, options);
    expect(first).not.toBeNull();
    expect(slot.children).toHaveLength(1);

    // images 换 cache-buster（签名不含）→ 不重建
    const same = render(slot, { ...options, images: ['/sprite.png?t=2'] });
    expect(same).toBe(first);
    expect(slot.children).toHaveLength(1);

    // 身份变化 → 重建（旧卡片移除）
    const rebuilt = render(slot, { ...options, sourceKey: 'sprite-2' });
    expect(rebuilt).not.toBe(first);
    expect(slot.children).toHaveLength(1);
    expect((rebuilt as FakeElement).parent).toBe(slot);

    // name 与 images 全空 → 清槽返回 null
    const cleared = render(slot, { name: '', images: [] });
    expect(cleared).toBeNull();
    expect(slot.children).toHaveLength(0);
  });
});
