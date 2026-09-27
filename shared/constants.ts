export const DEFAULT_PORT = 9988;
export const APP_DATA_DIRNAME = 'LuokePVPWebui';
export const MAX_SELECTION_COUNT = 6;
export const DEFAULT_OPACITY = 0.5;
export const DEFAULT_SATURATION = 1.0;
export const DEFAULT_HEALTH_PERCENT = 100;
export const DEFAULT_ENERGY_VALUE = 10;
export const DEFAULT_BEST_OF = 7;
export const DEFAULT_EVENT_TITLE = '';
export const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const SUPPORTED_BEST_OF = new Set([1, 3, 5, 7]);

/**
 * 直播推流画面 key 集合：决定推流载体页（index.html）加载哪个推流页面。
 * - page1-overlay: 推流页面1（Overlay 比分栏布局）
 * - page2: 推流页面2（全局阵容展示）
 * - page3: 推流页面3（头像比分阵容）
 * - page4: 推流页面4（MVP 结算画面）
 * - page5: 推流页面5（使用率/胜率排行）
 * - page6: 推流页面6（比赛结果）
 * - page7: 推流页面7（对局推送）
 * - page8: 推流页面8（比赛预告）
 * - page9: 推流页面9（团队积分榜）
 * - page10: 推流页面10（胜者结算画面）
 * - page11: 选手介绍-左侧选手（同一页面文件 ?mode=left）
 * - page12: 选手介绍-右侧选手（同一页面文件 ?mode=right）
 * - page13: 选手介绍-对战页（同一页面文件 ?mode=versus）
 * - blank: 黑场
 */
export const DEFAULT_STAGE_PAGE = 'page3';
export const SUPPORTED_STAGE_PAGES = new Set([
  'page1-overlay',
  'page2',
  'page3',
  'page4',
  'page5',
  'page6',
  'page7',
  'page8',
  'page9',
  'page10',
  'page11',
  'page12',
  'page13',
  'blank',
]);

/**
 * 直播推流切换过渡效果集合：
 * - none: 无过渡（直接切换）
 * - blinds: 双向百叶窗
 * - wolf: 狼头揭幕（白狼 Logo 淡入 → 黑幕狼形镂空 → 镜头穿越放大）
 */
export const DEFAULT_STAGE_TRANSITION = 'blinds';
export const SUPPORTED_STAGE_TRANSITIONS = new Set(['none', 'blinds', 'wolf']);
export const DEFAULT_PAGE3_SPRITE_SOURCE = 'sprite' as const;
export const SUPPORTED_PAGE3_SPRITE_SOURCES = new Set(['sprite', 'thumbnail']);
export const DEFAULT_PAGE3_RANK_VISIBLE = false;
export const DEFAULT_PAGE3_TEAM_VISIBLE = false;
/**
 * 推流页面3红光特效：
 * - page3RedLightMode: 持久策略，off = 关闭（不自动触发）/ auto = 自动开启（按阵亡阈值触发）
 * - page3RedLightInstant: 一次性「立即显示」（提前触发），进入下一局自动清除，不影响策略
 */
export const DEFAULT_PAGE3_RED_LIGHT_MODE = 'off' as const;
export const SUPPORTED_PAGE3_RED_LIGHT_MODES = new Set(['off', 'auto']);
export const DEFAULT_PAGE3_RED_LIGHT_INSTANT = false;
/** 选手介绍（page11-13）：默认显示选手排位排名 div（无排名时自动隐藏） */
export const DEFAULT_PAGE11_RANK_VISIBLE = true;
export const RANK_TEXT_MAX_LENGTH = 10;

/**
 * 下一局比赛（page3 下场对局）默认停留时长：
 * 默认 1 分钟，单位为分钟；单位可切换为秒。
 */
export const DEFAULT_NEXTGAME_DURATION = 1;
export const DEFAULT_NEXTGAME_DURATION_UNIT = 'minutes' as const;
export const SUPPORTED_NEXTGAME_DURATION_UNITS = new Set<string>(['seconds', 'minutes']);

/**
 * 胜者结算画面（page10）停留时长：
 * 赛事面板登记本局胜负后自动切入，停留该时长后自动切回原推流页面；默认 10 秒。
 */
export const DEFAULT_PAGE10_DURATION = 10;
export const DEFAULT_PAGE10_DURATION_UNIT = 'seconds' as const;

/**
 * 倒计时插件（推流载体顶部叠加小插件）：
 * 在直播推流画面顶部居中叠加显示，不影响原有推流页面；默认深色配色，默认 5 分钟。
 */
export const DEFAULT_COUNTDOWN_THEME = 'dark' as const;
export const DEFAULT_COUNTDOWN_DURATION = 5;
export const SUPPORTED_COUNTDOWN_THEMES = new Set(['dark', 'light']);
/** 倒计时时长上限（分钟） */
export const COUNTDOWN_DURATION_MAX = 60;

/**
 * MVP 结算（推流页面4）：
 * 后台「结算画面」最多可标记的精灵项数量（页面从左到右依次排列）。
 */
export const MVP_MAX_ITEMS = 6;
/** MVP 结算标签内容最大字数（最多四个字） */
export const MVP_TAG_MAX_LENGTH = 4;
/** 关闭 MVP 结算时切回的默认推流画面 */
export const DEFAULT_MVP_RETURN_PAGE = 'page3';
