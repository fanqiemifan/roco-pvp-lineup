import { describe, expect, it } from 'vitest';

import { buildMvpProgressItems } from '../../src/admin-antd/lib/mvp';

/** MVP 结算画面操作引导：载入胜方 → 选择精灵 → 标记 MVP → 显示结算 */
describe('buildMvpProgressItems 结算画面引导步骤', () => {
  it('固定四步：载入胜方 / 选择精灵 / 标记 MVP / 显示结算', () => {
    const { items } = buildMvpProgressItems({ hasWinner: false, assignedCount: 0, marked: false, visible: false });
    expect(items.map((item) => item.title)).toEqual(['载入胜方', '选择精灵', '标记 MVP', '显示结算']);
  });

  it('未载入胜方停在第一步', () => {
    const { current } = buildMvpProgressItems({ hasWinner: false, assignedCount: 0, marked: false, visible: false });
    expect(current).toBe(0);
  });

  it('已载入胜方、未选精灵 → 第二步', () => {
    const { current } = buildMvpProgressItems({ hasWinner: true, assignedCount: 0, marked: false, visible: false });
    expect(current).toBe(1);
  });

  it('已选精灵、未标记 MVP → 第三步', () => {
    const { current } = buildMvpProgressItems({ hasWinner: true, assignedCount: 2, marked: false, visible: false });
    expect(current).toBe(2);
  });

  it('已标记 MVP、未显示 → 第四步', () => {
    const { current } = buildMvpProgressItems({ hasWinner: true, assignedCount: 2, marked: true, visible: false });
    expect(current).toBe(3);
  });

  it('结算画面显示中 → current 等于步骤数（全部完成态）', () => {
    const { current } = buildMvpProgressItems({ hasWinner: true, assignedCount: 2, marked: true, visible: true });
    expect(current).toBe(4);
  });

  it('显示中时此前状态不全也不回退（visible 优先级最高）', () => {
    const { current } = buildMvpProgressItems({ hasWinner: false, assignedCount: 0, marked: false, visible: true });
    expect(current).toBe(4);
  });
});
