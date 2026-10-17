import type { ThemeConfig } from 'antd';

/**
 * 后台与登录页共用的**唯一**主题源。
 *
 * 约定（DS-lite 设计契约）：
 * - 颜色、圆角、控件高度只在这里改，两个入口不允许再各自覆盖颜色；
 * - 登录页只允许覆盖「密度类」token（控件高度、卡片内边距），见 loginTheme；
 * - 自研样式一律走 `src/admin-antd/tokens.css` 的 `--roco-*`，不要再写裸色值。
 *
 * 与旧值相比只有三处变化（视觉影响见桌面《DS-lite 设计契约-前后对比》）：
 * - colorPrimary #c7632f → #b3552a：白字对比度 4.00 → 4.93，过 WCAG AA；
 * - colorInfo #b8894c → #8f4323：原值当文字只有 2.88:1；
 * - borderRadius 12/16 → 10/14：贴合自研样式里最高频的 10px。
 */
const components: ThemeConfig['components'] = {
  Layout: {
    bodyBg: 'transparent',
    siderBg: 'rgba(255, 251, 246, 0.92)',
    headerBg: 'transparent',
  },
  Card: {
    borderRadiusLG: 14,
  },
  Button: {
    borderRadius: 10,
    controlHeight: 40,
  },
  Input: {
    borderRadius: 10,
  },
  InputNumber: {
    borderRadius: 10,
  },
  Select: {
    borderRadius: 10,
  },
  Collapse: {
    borderRadiusLG: 14,
  },
  Upload: {
    colorFillAlter: 'rgba(255, 250, 245, 0.9)',
  },
  Menu: {
    // 导航选中项：主题棕橙实底 + 近白暖色文字（图标走 currentColor 同步变色）
    itemSelectedBg: '#b3552a',
    itemSelectedColor: '#fff8ef',
  },
  Table: {
    borderColor: '#ece2d5',
    headerBg: '#f7f0e8',
    headerSplitColor: '#ece2d5',
    rowHoverBg: '#f8f1e8',
  },
};

export const rocoTheme: ThemeConfig = {
  // 开启 CSS 变量模式：自研样式可以用 var(--ant-color-primary) 跟随主题，
  // 不用再手抄色值；前缀保持默认 --ant-，避免已存在的 --ant-* 覆写失效。
  cssVar: { key: 'ant' },
  token: {
    colorPrimary: '#b3552a',
    colorInfo: '#8f4323',
    colorSuccess: '#2d7a58',
    colorWarning: '#d38b2d',
    colorError: '#c24635',
    colorBgBase: '#f6efe6',
    colorBgContainer: '#fbf5ec',
    colorTextBase: '#2f2418',
    colorBorder: 'rgba(91, 67, 43, 0.14)',
    borderRadius: 10,
    borderRadiusLG: 14,
    controlHeight: 40,
    fontFamily: '"Avenir Next", "Microsoft YaHei", sans-serif',
  },
  components,
};

/**
 * 登录页主题：继承后台，只放大密度（登录页是单卡布局，控件更大）。
 * **禁止在这里覆盖任何颜色** —— 这是两个入口此前分叉出 #b6532a / 圆角 18 的根因。
 */
export const loginTheme: ThemeConfig = {
  ...rocoTheme,
  token: { ...rocoTheme.token },
  components: {
    ...components,
    Card: { ...components?.Card, bodyPadding: 36 },
    Button: { ...components?.Button, controlHeightLG: 52, fontWeight: 700 },
    Input: { ...components?.Input, controlHeightLG: 52 },
  },
};
