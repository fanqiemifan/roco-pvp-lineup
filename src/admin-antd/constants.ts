import type { StagePageKey, StageTransitionType } from '../../shared/types';
import attributeMapping from '../../resources/data/attribute_mapping.json';
import type { AttributeOption, PreviewConfig, PreviewSlotKey } from './types';

export const DEFAULT_TAGS = ['淘汰赛', '海选赛', '128进64', '64进32', '32进16', '16进8', '8进4', '4进2', '季军赛', '决赛'];

/** MVP 结算（推流页面4）标签预设：可在「结算画面」直接选择，也可手动输入（最多四个字） */
export const MVP_TAG_PRESETS = [
  '无人在意',
  '顶级摔炮',
  '顶级辅助',
  '顶级联防',
  '最自由的',
  '美美隐身',
  '顶级终端',
];

export const PREVIEW_PAGES: Record<PreviewSlotKey, PreviewConfig> = {
  stage: {
    title: '直播推流（全局推流页面）',
    fileName: 'index.html',
    path: '/',
  },
  page1: {
    title: '推流页面1',
    fileName: 'roco-pvp-page1.html',
    path: '/roco-pvp-page1.html',
  },
  page2: {
    title: '推流页面2',
    fileName: 'roco-pvp-page2.html',
    path: '/roco-pvp-page2.html',
  },
  page3: {
    title: '推流页面3',
    fileName: 'roco-pvp-page3.html',
    path: '/roco-pvp-page3.html',
  },
  page4: {
    title: '推流页面4（MVP 结算画面）',
    fileName: 'roco-pvp-page4.html',
    path: '/roco-pvp-page4.html',
  },
  page5: {
    title: '推流页面5',
    fileName: 'roco-pvp-page5.html',
    path: '/roco-pvp-page5.html',
  },
  page6: {
    title: '推流页面6',
    fileName: 'roco-pvp-page6.html',
    path: '/roco-pvp-page6.html',
  },
  page7: {
    title: '推流页面7（战绩详情）',
    fileName: 'roco-pvp-page7.html',
    path: '/roco-pvp-page7.html',
  },
  page8: {
    title: '推流页面8（比赛预告）',
    fileName: 'roco-pvp-page8.html',
    path: '/roco-pvp-page8.html',
  },
  page9: {
    title: '推流页面9（团队积分榜）',
    fileName: 'roco-pvp-page9.html',
    path: '/roco-pvp-page9.html',
  },
  page10: {
    title: '推流页面10（胜者结算画面）',
    fileName: 'roco-pvp-page10.html',
    path: '/roco-pvp-page10.html',
  },
  page11: {
    title: '选手介绍-左侧选手',
    fileName: 'roco-pvp-page11.html',
    path: '/roco-pvp-page11.html?mode=left',
  },
  page12: {
    title: '选手介绍-右侧选手',
    fileName: 'roco-pvp-page11.html',
    path: '/roco-pvp-page11.html?mode=right',
  },
  page13: {
    title: '选手介绍-对战页',
    fileName: 'roco-pvp-page11.html',
    path: '/roco-pvp-page11.html?mode=versus',
  },
  page14: {
    title: '推流页面14（晋级积分榜）',
    fileName: 'roco-pvp-page14.html',
    path: '/roco-pvp-page14.html',
  },
  page15: {
    title: '推流页面15（数据统计）',
    fileName: 'roco-pvp-page15.html',
    path: '/roco-pvp-page15.html',
  },
  page16: {
    title: '推流页面16（阵容同步）',
    fileName: 'roco-pvp-page16.html',
    path: '/roco-pvp-page16.html',
  },
  page17: {
    title: '推流页面17（阵容展示5）',
    fileName: 'roco-pvp-page17.html',
    path: '/roco-pvp-page17.html',
  },
};

export const STAGE_OPTIONS: Array<{ value: StagePageKey; label: string; description: string; previewPath: string }> = [
  {
    value: 'page1-overlay',
    label: '阵容展示1',
    description: '纯阵容展示：左右各 6 个精灵槽',
    previewPath: '/roco-pvp-page1.html',
  },
  {
    value: 'page2',
    label: '阵容展示2',
    description: '全局阵容：左右阵容 + 比分 + 赛事标题',
    previewPath: '/roco-pvp-page2.html',
  },
  {
    value: 'page3',
    label: '阵容展示3',
    description: '双方选手头像与 VS 比分栏',
    previewPath: '/roco-pvp-page3.html',
  },
  {
    value: 'page16',
    label: '阵容展示4',
    description: '精灵卡片阵容 + 顶部比分栏 + 选手头像卡',
    previewPath: '/roco-pvp-page16.html',
  },
  {
    value: 'page17',
    label: '阵容展示5',
    description: '精灵卡片阵容 + 底部黑色比分栏',
    previewPath: '/roco-pvp-page17.html',
  },
  {
    value: 'page4',
    label: 'MVP结算展示',
    description: '胜方阵容与标签展示，后台可标记',
    previewPath: '/roco-pvp-page4.html',
  },
  {
    value: 'page5',
    label: '前10精灵出场胜率',
    description: '精灵使用率与胜率排行',
    previewPath: '/roco-pvp-page5.html',
  },
  {
    value: 'page15',
    label: '数据统计展示',
    description: '精灵使用次数 / 登场 / 胜率排行',
    previewPath: '/roco-pvp-page15.html',
  },
  {
    value: 'page6',
    label: '比赛结果展示',
    description: '已结束比赛的结果一览',
    previewPath: '/roco-pvp-page6.html',
  },
  {
    value: 'page7',
    label: '战绩详情',
    description: '按小局逐行展示双方阵容与胜负',
    previewPath: '/roco-pvp-page7.html',
  },
  {
    value: 'page8',
    label: '比赛预告展示',
    description: '待开赛 / 进行中的比赛预告',
    previewPath: '/roco-pvp-page8.html',
  },
  {
    value: 'page9',
    label: '团队赛积分展示',
    description: '战队积分榜，排名与总积分自动计算',
    previewPath: '/roco-pvp-page9.html',
  },
  {
    value: 'page10',
    label: '胜者结算画面',
    description: '登记胜负后自动切入，停留时长可设置',
    previewPath: '/roco-pvp-page10.html',
  },
  {
    value: 'page11',
    label: '选手介绍-左侧选手',
    description: '人物立绘 + 擅长精灵 + 比赛宣言',
    previewPath: '/roco-pvp-page11.html?mode=left',
  },
  {
    value: 'page12',
    label: '选手介绍-右侧选手',
    description: '人物立绘 + 擅长精灵 + 比赛宣言',
    previewPath: '/roco-pvp-page11.html?mode=right',
  },
  {
    value: 'page13',
    label: '选手介绍-对战页',
    description: '双方头像卡 + 当前阵容条',
    previewPath: '/roco-pvp-page11.html?mode=versus',
  },
  {
    value: 'page14',
    label: '系列赛晋级积分榜',
    description: '按系列赛阶段统计选手晋级积分',
    previewPath: '/roco-pvp-page14.html',
  },
];

// 黑场不作为可选切换卡片展示，但已保存的黑场状态仍为合法值（避免静默改写当前画面）
export const STAGE_VALUE_SET = new Set<StagePageKey>([...STAGE_OPTIONS.map((option) => option.value), 'blank']);

export const STAGE_TRANSITION_OPTIONS: Array<{ value: StageTransitionType; label: string }> = [
  { value: 'blinds', label: '百叶窗' },
  { value: 'wolf', label: '狼头揭幕' },
  { value: 'none', label: '无过渡' },
];

export function normalizeStageTransition(value: unknown): StageTransitionType {
  if (typeof value === 'string' && STAGE_TRANSITION_OPTIONS.some((option) => option.value === value)) {
    return value as StageTransitionType;
  }
  return 'blinds';
}

export function normalizeStagePage(value: unknown): StagePageKey {
  if (typeof value === 'string' && STAGE_VALUE_SET.has(value as StagePageKey)) {
    return value as StagePageKey;
  }
  return 'page3';
}

export const ATTRIBUTE_OPTIONS: AttributeOption[] = (attributeMapping as Array<{ 编号: string; 属性: string }>).map((item) => ({
  code: item.编号,
  label: item.属性,
  iconPath: `/resources/attribute/${item.编号}.png`,
}));

export const ATTRIBUTE_ICON_BY_LABEL = new Map(ATTRIBUTE_OPTIONS.map((option) => [option.label, option.iconPath]));
export const FINAL_FORM_FILTER_LABEL = '最终形态';
export const EXCLUSIVE_FORM_FILTERS = ['首领', '一阶', '二阶', '三阶'];

// 主题 token 已迁到 src/theme.ts（后台与登录页唯一真源），这里不再保留第二份副本。
// 自研样式取色走 src/admin-antd/tokens.css 的 --roco-*，不要再往这里加颜色常量。
