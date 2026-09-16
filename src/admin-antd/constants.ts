import type { StagePageKey, StageTransitionType } from '../../shared/types';
import attributeMapping from '../../resources/data/attribute_mapping.json';
import type { AttributeOption, PreviewConfig, PreviewSlotKey } from './types';

export const DEFAULT_TAGS = ['淘汰赛', '海选赛', '128进64', '64进32', '32进16', '16进8', '8进4', '4进2', '季军赛', '决赛'];

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
    title: '仅显阵容',
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
    title: '推流页面7（对局推送）',
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
};

export const STAGE_OPTIONS: Array<{ value: StagePageKey; label: string; description: string; previewPath: string }> = [
  {
    value: 'page1-overlay',
    label: '推流页面1',
    description: '带比分栏 + 左右精灵槽的经典 Overlay 布局',
    previewPath: '/roco-pvp-page1.html',
  },
  {
    value: 'page2',
    label: '推流页面2',
    description: '全局阵容展示（左右阵容 + 比分 + 赛事标题）',
    previewPath: '/roco-pvp-page2.html',
  },
  {
    value: 'page3',
    label: '推流页面3',
    description: '头像比分阵容展示（带头像 VS 比分栏）',
    previewPath: '/roco-pvp-page3.html',
  },
  {
    value: 'page5',
    label: '推流页面5',
    description: '使用率 / 胜率排行统计页',
    previewPath: '/roco-pvp-page5.html',
  },
  {
    value: 'page6',
    label: '推流页面6',
    description: '比赛结果展示（最多 8 场已结束比赛）',
    previewPath: '/roco-pvp-page6.html',
  },
  {
    value: 'page7',
    label: '推流页面7',
    description: '对局推送（多场比赛按小局逐行滚动展示）',
    previewPath: '/roco-pvp-page7.html',
  },
  {
    value: 'page8',
    label: '推流页面8',
    description: '比赛预告（后台选择待开赛/进行中比赛，展示预告信息）',
    previewPath: '/roco-pvp-page8.html',
  },
  {
    value: 'page9',
    label: '推流页面9',
    description: '团队积分榜（后台录入战队积分，排名与总积分自动计算）',
    previewPath: '/roco-pvp-page9.html',
  },
  {
    value: 'page10',
    label: '推流页面10',
    description: '胜者结算画面（登记本局胜负后自动切入展示，停留时长可设置）',
    previewPath: '/roco-pvp-page10.html',
  },
  {
    value: 'page11',
    label: '选手介绍-左侧选手',
    description: '介绍左侧选手：人物立绘 + 头像卡 + 擅长精灵与比赛宣言',
    previewPath: '/roco-pvp-page11.html?mode=left',
  },
  {
    value: 'page12',
    label: '选手介绍-右侧选手',
    description: '介绍右侧选手：人物立绘 + 头像卡 + 擅长精灵与比赛宣言',
    previewPath: '/roco-pvp-page11.html?mode=right',
  },
  {
    value: 'page13',
    label: '选手介绍-对战页',
    description: '对战页：双方头像卡 + 当前阵容条 + 中央分割线',
    previewPath: '/roco-pvp-page11.html?mode=versus',
  },
];

// 黑场不作为可选切换卡片展示，但已保存的黑场状态仍为合法值（避免静默改写当前画面）
export const STAGE_VALUE_SET = new Set<StagePageKey>([...STAGE_OPTIONS.map((option) => option.value), 'blank']);

export const STAGE_TRANSITION_OPTIONS: Array<{ value: StageTransitionType; label: string }> = [
  { value: 'blinds', label: '百叶窗' },
  { value: 'zoom', label: '缩放冲击' },
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

export const theme = {
  token: {
    colorPrimary: '#c7632f',
    colorInfo: '#b8894c',
    colorSuccess: '#2d7a58',
    colorWarning: '#d38b2d',
    colorError: '#c24635',
    colorBgBase: '#f6efe6',
    colorBgContainer: '#fbf5ec',
    colorTextBase: '#2f2418',
    colorBorder: 'rgba(91, 67, 43, 0.14)',
    borderRadius: 12,
    borderRadiusLG: 16,
    controlHeight: 42,
    fontFamily: '"Avenir Next", "Microsoft YaHei", sans-serif',
  },
  components: {
    Layout: {
      bodyBg: 'transparent',
      siderBg: 'rgba(255, 251, 246, 0.92)',
      headerBg: 'transparent',
    },
    Card: {
      borderRadiusLG: 16,
    },
    Button: {
      borderRadius: 12,
      controlHeight: 42,
    },
    Input: {
      borderRadius: 12,
    },
    InputNumber: {
      borderRadius: 12,
    },
    Select: {
      borderRadius: 12,
    },
    Collapse: {
      borderRadiusLG: 14,
    },
    Upload: {
      colorFillAlter: 'rgba(255, 250, 245, 0.9)',
    },
    Menu: {
      // 导航选中项：主题棕橙实底 + 近白暖色文字，奶油色侧栏上更醒目（图标走 currentColor 同步变色）
      itemSelectedBg: '#c7632f',
      itemSelectedColor: '#fff8ef',
    },
    Table: {
      borderColor: '#ece2d5',
      headerBg: '#f7f0e8',
      headerSplitColor: '#ece2d5',
      rowHoverBg: '#f8f1e8',
    },
  },
};
