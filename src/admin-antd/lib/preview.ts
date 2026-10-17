import { PREVIEW_PAGES } from '../constants';
import type { PreviewConfig, PreviewSlotKey } from '../types';

export function getPreviewOrigin(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

export function getPreviewPage(slot: PreviewSlotKey): PreviewConfig {
  return PREVIEW_PAGES[slot];
}

export function buildPreviewUrl(slot: PreviewSlotKey): string {
  return `${getPreviewOrigin()}${getPreviewPage(slot).path}`;
}

export function getLocalAddressText(slot: PreviewSlotKey): string {
  const host = window.location.port ? `127.0.0.1:${window.location.port}` : '127.0.0.1';
  const path = getPreviewPage(slot).path;
  return path === '/' ? host : `${host}${path}`;
}

/**
 * 「页面预览」左侧导航的分组。18 个预览槽位全部入列（原来那排 Segmented 只有 14 个，
 * page4 与选手介绍左/右/对战根本点不到，且一行排不下会被裁掉）。
 * 分组顺序 = 直播从开到关的实际使用顺序：载体页 → 阵容展示 → 对局 → 榜单 → 结算 → 选手介绍。
 */
export type PreviewNavItem = { slot: PreviewSlotKey; label: string };
export type PreviewNavGroup = { title: string; items: PreviewNavItem[] };

export const PREVIEW_NAV_GROUPS: PreviewNavGroup[] = [
  {
    title: '直播推流',
    items: [{ slot: 'stage', label: '直播推流（载体页）' }],
  },
  {
    title: '阵容展示',
    items: [
      { slot: 'page1', label: '阵容展示1' },
      { slot: 'page2', label: '阵容展示2' },
      { slot: 'page3', label: '阵容展示3' },
      { slot: 'page16', label: '阵容展示4' },
      { slot: 'page17', label: '阵容展示5' },
    ],
  },
  {
    title: '对局',
    items: [
      { slot: 'page6', label: '比赛结果' },
      { slot: 'page7', label: '战绩详情' },
      { slot: 'page8', label: '比赛预告' },
    ],
  },
  {
    title: '榜单与数据',
    items: [
      { slot: 'page5', label: '登场/胜率排行' },
      { slot: 'page9', label: '团队积分榜' },
      { slot: 'page14', label: '晋级积分榜' },
      { slot: 'page15', label: '数据统计' },
    ],
  },
  {
    title: '结算',
    items: [
      { slot: 'page4', label: 'MVP 结算' },
      { slot: 'page10', label: '胜者结算' },
    ],
  },
  {
    title: '选手介绍',
    items: [
      { slot: 'page11', label: '左侧选手' },
      { slot: 'page12', label: '右侧选手' },
      { slot: 'page13', label: '对战页' },
    ],
  },
];

/** 导航项文案（分组名 + 页面名）；找不到时回退 PREVIEW_PAGES 的标题 */
export function getPreviewNavLabel(slot: PreviewSlotKey): string {
  for (const group of PREVIEW_NAV_GROUPS) {
    const item = group.items.find((entry) => entry.slot === slot);
    if (item) {
      return item.label;
    }
  }
  return getPreviewPage(slot).title;
}
