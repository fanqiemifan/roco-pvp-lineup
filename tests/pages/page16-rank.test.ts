import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import type { SpriteRecord } from '../../shared/types';

/**
 * page16 卡片排名纯函数测试：双方阵容 12 张卡片统一编排 1-12 序号。
 * 重点覆盖：同值同名次（跳号）、无值并列末位、任意种族值字段排序、name/未知模式回退按 sum 排。
 */

interface Page16Rank {
  assignRanks: (entries: Array<{ side: string; slot: number; sprite: SpriteRecord | null }>, mode: string) => Map<string, { rank: number; value: number | null }>;
  getSortValue: (sprite: SpriteRecord | null, mode: string) => number | null;
}

function loadPage16Rank(): Page16Rank {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  const source = readFileSync(join(process.cwd(), 'src/scripts/page16-rank.js'), 'utf-8');
  vm.runInContext(source, sandbox);
  return (sandbox.window as { Page16Rank: Page16Rank }).Page16Rank;
}

function makeSprite(
  baseStats: { sum?: number; hp?: number; speed?: number; physical_attack?: number } | null,
): SpriteRecord {
  return {
    id: '1001',
    filename: '1001_测试.png',
    displayName: '测试',
    name: '测试',
    path: '/img/1001_测试.png',
    aliases: [],
    number: 1,
    attribute: '',
    attributeCodes: [],
    attributeIcon1: '',
    attributeIcon2: '',
    iconUrl: '',
    form: '',
    petForm: '',
    isFinalForm: true,
    baseStats: {
      hp: baseStats ? baseStats.hp ?? null : null,
      physical_attack: baseStats ? baseStats.physical_attack ?? null : null,
      physical_defense: null,
      magic_attack: null,
      magic_defense: null,
      speed: baseStats ? baseStats.speed ?? null : null,
      sum: baseStats ? baseStats.sum ?? null : null,
    },
  };
}

const { assignRanks, getSortValue } = loadPage16Rank();

describe('page16-rank：双方阵容 1-12 统一排名', () => {
  it('按 sum 降序编排名次，左右两侧混排', () => {
    const entries = [
      { side: 'left', slot: 0, sprite: makeSprite({ sum: 500 }) },
      { side: 'left', slot: 1, sprite: makeSprite({ sum: 700 }) },
      { side: 'right', slot: 0, sprite: makeSprite({ sum: 600 }) },
    ];
    const ranks = assignRanks(entries, 'sum');
    expect(ranks.get('left:1')?.rank).toBe(1);
    expect(ranks.get('right:0')?.rank).toBe(2);
    expect(ranks.get('left:0')?.rank).toBe(3);
  });

  it('数值相同同名次，后续名次跳号（1、2、2、4）', () => {
    const entries = [
      { side: 'left', slot: 0, sprite: makeSprite({ sum: 900 }) },
      { side: 'left', slot: 1, sprite: makeSprite({ sum: 850 }) },
      { side: 'right', slot: 0, sprite: makeSprite({ sum: 850 }) },
      { side: 'right', slot: 1, sprite: makeSprite({ sum: 800 }) },
    ];
    const ranks = assignRanks(entries, 'sum');
    expect(ranks.get('left:0')?.rank).toBe(1);
    expect(ranks.get('left:1')?.rank).toBe(2);
    expect(ranks.get('right:0')?.rank).toBe(2);
    expect(ranks.get('right:1')?.rank).toBe(4);
  });

  it('无属性值的卡片并列排在最后（名次 = 有值卡片数 + 1）', () => {
    const entries = [
      { side: 'left', slot: 0, sprite: makeSprite({ sum: 700 }) },
      { side: 'left', slot: 1, sprite: makeSprite(null) },
      { side: 'right', slot: 0, sprite: makeSprite({ sum: 600 }) },
      { side: 'right', slot: 1, sprite: makeSprite(null) },
    ];
    const ranks = assignRanks(entries, 'sum');
    expect(ranks.get('left:0')?.rank).toBe(1);
    expect(ranks.get('right:0')?.rank).toBe(2);
    expect(ranks.get('left:1')?.rank).toBe(3);
    expect(ranks.get('right:1')?.rank).toBe(3);
  });

  it('hp 模式按体力排序，sum 模式值随 key 返回', () => {
    const entries = [
      { side: 'left', slot: 0, sprite: makeSprite({ sum: 500, hp: 200 }) },
      { side: 'left', slot: 1, sprite: makeSprite({ sum: 700, hp: 80 }) },
    ];
    const hpRanks = assignRanks(entries, 'hp');
    expect(hpRanks.get('left:0')?.rank).toBe(1);
    expect(hpRanks.get('left:1')?.rank).toBe(2);

    const sumRanks = assignRanks(entries, 'sum');
    expect(sumRanks.get('left:0')?.rank).toBe(2);
    expect(sumRanks.get('left:1')?.rank).toBe(1);
    expect(sumRanks.get('left:0')?.value).toBe(500);
  });

  it('name 模式只显名字，序号仍按 sum 排序', () => {
    const entries = [
      { side: 'left', slot: 0, sprite: makeSprite({ sum: 500 }) },
      { side: 'left', slot: 1, sprite: makeSprite({ sum: 700 }) },
    ];
    const ranks = assignRanks(entries, 'name');
    expect(ranks.get('left:0')?.rank).toBe(2);
    expect(ranks.get('left:1')?.rank).toBe(1);
  });

  it('任意种族值字段（speed/physical_attack）都可作为排序依据，与 sum 互不影响', () => {
    const entries = [
      { side: 'left', slot: 0, sprite: makeSprite({ sum: 700, speed: 90, physical_attack: 120 }) },
      { side: 'left', slot: 1, sprite: makeSprite({ sum: 500, speed: 110, physical_attack: 80 }) },
    ];
    const speedRanks = assignRanks(entries, 'speed');
    expect(speedRanks.get('left:1')?.rank).toBe(1);
    expect(speedRanks.get('left:0')?.rank).toBe(2);
    expect(speedRanks.get('left:1')?.value).toBe(110);

    const attackRanks = assignRanks(entries, 'physical_attack');
    expect(attackRanks.get('left:0')?.rank).toBe(1);
    expect(attackRanks.get('left:1')?.rank).toBe(2);

    // 某字段缺值时并列末位，不影响其他字段排序
    const attackRanksMissing = assignRanks([
      { side: 'left', slot: 0, sprite: makeSprite({ physical_attack: 100 }) },
      { side: 'left', slot: 1, sprite: makeSprite({ sum: 900 }) },
    ], 'physical_attack');
    expect(attackRanksMissing.get('left:0')?.rank).toBe(1);
    expect(attackRanksMissing.get('left:1')?.rank).toBe(2);
  });

  it('未知模式回退按 sum 排', () => {
    const entries = [
      { side: 'left', slot: 0, sprite: makeSprite({ sum: 500 }) },
      { side: 'left', slot: 1, sprite: makeSprite({ sum: 700 }) },
    ];
    const ranks = assignRanks(entries, 'hack');
    expect(ranks.get('left:0')?.rank).toBe(2);
    expect(ranks.get('left:1')?.rank).toBe(1);
  });

  it('空阵容返回空 Map；getSortValue 对缺 stats 的精灵返回 null', () => {
    expect(assignRanks([], 'sum').size).toBe(0);
    expect(getSortValue(makeSprite(null), 'hp')).toBeNull();
    expect(getSortValue(null, 'sum')).toBeNull();
  });
});
