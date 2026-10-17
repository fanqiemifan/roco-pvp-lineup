/**
 * page16 卡片排名 · 独立纯函数（零依赖，可在 node:vm 中单测）
 *
 * 双方阵容 12 张卡片统一编排 1-12 序号：按排序依据降序，数值相同同名次
 * （competition ranking：1、2、2、4，跳号）；无属性值的卡片并列排在最后
 * （名次 = 有值卡片数 + 1）。
 *
 * 用法：
 *   <script src="page16-rank.js"></script>
 *   const rankMap = Page16Rank.assignRanks(entries, 'sum');
 *   // entries: [{ side: 'left'|'right', slot: 0..5, sprite }]
 *   // rankMap: Map<`${side}:${slot}`, { rank, value }>
 */

(function (global) {
  'use strict';

  /**
   * 排序取值：sum → 种族值总和；hp → 体力；name → 回退按 sum 排（只显名字时序号仍有意义）
   * @param {{stats?: {sum?: number|null, hp?: number|null}|null}|null} sprite
   * @param {'sum'|'hp'|'name'} mode
   * @returns {number|null}
   */
  function getSortValue(sprite, mode) {
    const stats = sprite && sprite.stats ? sprite.stats : null;
    if (!stats) {
      return null;
    }
    if (mode === 'hp') {
      return stats.hp == null ? null : stats.hp;
    }
    return stats.sum == null ? null : stats.sum;
  }

  /**
   * 双方阵容统一排名（1-12，同值同名次）。
   * 同值卡片的先后展示顺序保持入参顺序（左先右后、槽位升序），由调用方保证入参稳定。
   * @param {Array<{side: 'left'|'right', slot: number, sprite: object|null}>} entries
   * @param {'sum'|'hp'|'name'} mode
   * @returns {Map<string, {rank: number, value: number|null}>} key = `${side}:${slot}`
   */
  function assignRanks(entries, mode) {
    const keyed = (entries || []).map((entry) => ({
      side: entry.side,
      slot: entry.slot,
      value: getSortValue(entry.sprite, mode),
    }));
    // 降序、无值排末位；sort 稳定（ES2019+），同值保持入参顺序
    const sorted = keyed.slice().sort((left, right) => {
      if (left.value == null && right.value == null) return 0;
      if (left.value == null) return 1;
      if (right.value == null) return -1;
      return right.value - left.value;
    });
    const nonNullCount = sorted.filter((item) => item.value != null).length;

    const result = new Map();
    let prevValue = null;
    let prevRank = 0;
    sorted.forEach((item, index) => {
      let rank;
      if (item.value == null) {
        rank = nonNullCount + 1;
      } else if (item.value === prevValue) {
        rank = prevRank;
      } else {
        rank = index + 1;
        prevValue = item.value;
        prevRank = rank;
      }
      result.set(`${item.side}:${item.slot}`, { rank, value: item.value });
    });
    return result;
  }

  global.Page16Rank = { assignRanks, getSortValue };
})(typeof window !== 'undefined' ? window : this);
