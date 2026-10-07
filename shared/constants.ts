import type { StageRule, ThirdPlaceBestOf } from './types.js';

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
 * - page7: 推流页面7（战绩详情）
 * - page8: 推流页面8（比赛预告）
 * - page9: 推流页面9（团队积分榜）
 * - page10: 推流页面10（胜者结算画面）
 * - page14: 推流页面14（晋级积分榜）
 * - page15: 推流页面15（数据统计：使用次数/登场场次排行）
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
  'page14',
  'page15',
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
 * 战绩详情（page7）整屏切换间隔：一屏 4 行停留多久后整屏交叉过渡到下一屏；默认 10 秒。
 * 下限要大于过渡动画时长（700ms），否则画面会一直在过渡、看不清内容。
 */
export const DEFAULT_PAGE7_SWITCH_SECONDS = 10;
export const PAGE7_SWITCH_MIN_SECONDS = 2;
export const PAGE7_SWITCH_MAX_SECONDS = 600;

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

/* ==================== 晋级积分榜（推流页面14） ==================== */

/**
 * 单页最多展示行数：参赛人数超出时（例如 64进32 的 64 人）分页展示，
 * 由裁判端在「比赛管理 → 晋级积分榜」卡片上控制当前页。
 */
export const PAGE14_ROWS_PER_PAGE = 32;
/** 标题留空时的兜底文案（副标题留空由展示页按阶段与赛制自动生成） */
export const DEFAULT_PAGE14_TITLE = '晋级积分榜';

/**
 * 双机数据同步：
 * - 同步包为单个 JSON 文件（比赛 + 档案 + 头像 base64），导入前先预览、逐条勾选、确认后合并
 * - 比赛 id 带本机标识（机器码）前缀：YYYYMMDD_A001；未设置机器码时沿用旧格式 YYYYMMDD_001
 */
export const SYNC_APP_ID = 'roco-pvp-lineup';
export const SYNC_BUNDLE_SCHEMA = 1;
/** 同步包文件大小上限（导入上传限制 + 前端预检） */
export const SYNC_BUNDLE_MAX_BYTES = 64 * 1024 * 1024;
/** 本机标识：1-2 位大写字母（空字符串 = 未设置） */
export const MACHINE_CODE_REGEX = /^[A-Z]{1,2}$/;
/**
 * 比赛 id：8 位日期 + 「_」+ 机器码（0-2 位字母，旧格式为空）+ 序号。
 * 解析端容忍小写，生成端只出大写；机器码只允许字母，避免与序号数字产生歧义。
 */
export const MATCH_ID_REGEX = /^(\d{8})_([A-Za-z]{0,2})(\d+)$/;

/* ==================== 云同步（点击式：Cloudflare Worker + KV 信箱） ==================== */

/** 云同步角色：主控端（编排机 + 确认台）/ 分控端（只读副本 + 登记点） */
export const CLOUD_SYNC_ROLES = new Set<string>(['main', 'sub']);
/**
 * 红点轮询间隔可选值（秒）：只读小键（version / ack / uplink），绝不自动合并数据。
 * 默认 60s，最低 30s（与 KV 异地区间可见延迟同量级，再密也拿不到更新）。
 */
export const CLOUD_SYNC_POLL_INTERVALS = [30, 60, 120, 300];
export const DEFAULT_CLOUD_SYNC_POLL_INTERVAL = 60;
export const DEFAULT_CLOUD_SYNC_POLL_ENABLED = true;
/** 房间名册容量上限（1 主 + N 分，机器码互不相同） */
export const CLOUD_SYNC_ROSTER_MAX = 8;
/** 单次「回传」最多携带的比赛数（KV 单值上限充裕，这里只是防误操作） */
export const CLOUD_SYNC_UPLINK_MAX_MATCHES = 200;
/**
 * 云端信箱 HTTP 超时（毫秒）：Cloudflare 免费版 Workers 单次请求上限 30s（CPU 时间 10ms），
 * 分包大小不带头像时只有几十 KB，留 20s 足够；超时给中文提示而不是让界面空转。
 */
export const CLOUD_SYNC_REQUEST_TIMEOUT_MS = 20_000;
/** 主控端认为分控端未通信而提示「对端尚未分发/回传」的展示时长（分钟） */
export const CLOUD_SYNC_STALE_MINUTES = 30;

/* ==================== 系列赛自动化管理 ==================== */

/** 双败阶段晋级线 / 淘汰线：阶段内 2 胜晋级、2 败淘汰 */
export const TOURNAMENT_TARGET_WINS = 2;
export const TOURNAMENT_TARGET_LOSSES = 2;
/**
 * 双败阶段各波次的轮次名（战绩桶 key → 文案）：**晋级图/波次列表与对局标签共用同一份**。
 *
 * 这套引擎是 3 波桶模型（2 胜晋级 / 2 负淘汰），所以胜者组、败者组各只有两轮：
 * W1（0-0 池，全员）＝ 胜者组 R1 → 输的人掉进败者组；W2 的 1-0 池 ＝ 胜者组 R2、0-1 池 ＝ 败者组 R1；
 * W3 的 1-1 池 ＝ 败者组 R2（决胜）。别只给「胜者组/败者组」加编号而漏掉首尾两波，
 * 也别按「胜者组=R1、败者组=R2」简单配对——那是错的。
 */
export const DOUBLE_LIFE_ROUND_LABELS: Record<string, string> = {
  '0-0': '胜者组 R1',
  '1-0': '胜者组 R2',
  '0-1': '败者组 R1',
  '1-1': '败者组 R2',
};
/** 仅支持 2 的幂人数（双败桶恒偶，零轮空分支） */
export const SUPPORTED_TOURNAMENT_SIZES = new Set([4, 8, 16, 32, 64, 128]);
/**
 * 「总决赛」= 只剩 2 人的阶段（每阶段晋级半额，人数逐阶段减半）：必须单败。
 * 双败在 2 人阶段既产出不了冠军、也配不出下一波；创建校验、编辑赛制守卫与前端向导共用这一判据。
 * 用「阶段人数」而不是「最后一个阶段」判定：自定义阶段列表的末阶段不一定是 2 人。
 */
export function isFinalStage(playerCount: number, stageIndex: number): boolean {
  return playerCount / 2 ** stageIndex === 2;
}
/**
 * 系列赛 id：T 前缀 + 8 位日期 + 「_」+ 机器码（0-2 位字母）+ 序号，如 T20260928_A01。
 * 外部导入数据只接受该形态，防止路径穿越与字段注入。
 */
export const TOURNAMENT_ID_REGEX = /^T(\d{8})_([A-Za-z]{0,2})(\d+)$/;
/** 系列赛标签：跨桶配对 / 弃权场次标注 */
export const TOURNAMENT_CROSS_BUCKET_TAG = '跨桶';
export const TOURNAMENT_FORFEIT_TAG = '弃权';

/** 季军赛展示名（对局标签、晋级图分组头、波次列表标题共用） */
export const THIRD_PLACE_LABEL = '季军赛';
/** 季军赛局数可选值（0 = 不安排）；创建向导与引擎白名单共用同一份，别再各写一份 */
export const THIRD_PLACE_BEST_OF_OPTIONS = [0, 1, 3, 5, 7] as const;

/**
 * 季军赛局数解析：0 = 不安排；1/3/5/7 = 该局数；其余（含 null/缺省的旧数据）= 与总决赛同赛制。
 * 引擎（建场）与前端（展示 BO）共用它，保证「同一条记录只有一种解释」；
 * 入参放宽到 unknown：外部导入的 JSON 里这个字段什么类型都可能有。
 */
export function resolveThirdPlaceBestOf(record: {
  thirdPlaceBestOf?: unknown;
  stages: StageRule[];
}): ThirdPlaceBestOf {
  const raw = record.thirdPlaceBestOf;
  // 显式 0 = 不安排；null/undefined/空串 = 没配过（旧数据），走「与总决赛一致」
  const parsed = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (parsed === 0) {
    return 0;
  }
  if (parsed === 1 || parsed === 3 || parsed === 5 || parsed === 7) {
    return parsed;
  }
  return record.stages[record.stages.length - 1]?.bestOf ?? 3;
}

/**
 * 某波生效的赛制：W1 与单败阶段取阶段基础值；双败 W2/W3 取 waveBestOf 覆盖（缺省回落到基础）。
 * 建场、编辑校验、榜单标签与前端展示都走它，别各写一份。
 */
export function resolveWaveBestOf(
  stage: Pick<StageRule, 'bestOf' | 'waveBestOf'>,
  waveIndex: number,
): StageRule['bestOf'] {
  if (waveIndex >= 2) {
    const override = stage.waveBestOf?.[waveIndex as 2 | 3];
    if (override) {
      return override;
    }
  }
  return stage.bestOf;
}

/**
 * 阶段赛制展示文本：无波次覆盖时是「BO1」；有覆盖时按连续段压缩（如「W1 BO1 / W2·W3 BO3」）。
 * 供详情 Steps、晋级图横幅、page14 副标题、推流卡片等处统一使用。
 */
export function formatStageBestOf(
  stage: Pick<StageRule, 'bestOf' | 'waveBestOf' | 'format'>,
): string {
  if (stage.format !== 'double-life' || !stage.waveBestOf) {
    return `BO${stage.bestOf}`;
  }
  const waves = [1, 2, 3].map((waveIndex) => resolveWaveBestOf(stage, waveIndex));
  const groups: Array<{ from: number; to: number; bo: StageRule['bestOf'] }> = [];
  waves.forEach((bo, index) => {
    const waveIndex = index + 1;
    const last = groups[groups.length - 1];
    if (last && last.bo === bo) {
      last.to = waveIndex;
    } else {
      groups.push({ from: waveIndex, to: waveIndex, bo });
    }
  });
  if (groups.length === 1) {
    return `BO${groups[0].bo}`;
  }
  return groups
    .map((group) => {
      const label = group.from === group.to ? `W${group.from}` : `W${group.from}·W${group.to}`;
      return `${label} BO${group.bo}`;
    })
    .join(' / ');
}

/**
 * 按参赛人数生成默认阶段规则（创建系列赛时 stages 可省略）：
 * - 128 人：128进64 双败BO1 → 64进32 双败BO1 → 32进16 单败BO3 → 16进8 单败BO3 → 8进4 单败BO3 → 4进2 单败BO3 → 总决赛 单败BO3
 * - 64 人：64进32 双败BO1 → 32进16 双败BO1 → 16进8 单败BO3 → 8进4 单败BO3 → 4进2 单败BO3 → 总决赛 单败BO3
 * - 32 人：32进16 双败BO1 → 16进8 双败BO1 → 8进4 单败BO3 → 4进2 单败BO3 → 总决赛 单败BO3
 * - 16 人：16进8 双败BO1 → 8进4 单败BO3 → 4进2 单败BO3 → 总决赛
 * - 8 人：8进4 双败BO1 → 4进2 单败BO3 → 总决赛
 * - 4 人：4进2 单败BO3 → 总决赛
 * 全部默认同桶/种子配对、避免重复对手、自动推进（requireConfirm=false）。
 */
export function buildDefaultStages(playerCount: number): StageRule[] {
  const stage = (
    index: number,
    name: string,
    format: 'double-life' | 'single-elim',
    bestOf: 1 | 3,
    pairing: 'random-bucket' | 'bracket-seed',
  ): StageRule => ({
    id: `s${index}`,
    name,
    format,
    bestOf,
    pairing,
    avoidRematch: true,
    requireConfirm: false,
  });

  switch (playerCount) {
    case 128:
      return [
        stage(0, '128进64', 'double-life', 1, 'random-bucket'),
        stage(1, '64进32', 'double-life', 1, 'random-bucket'),
        stage(2, '32进16', 'single-elim', 3, 'bracket-seed'),
        stage(3, '16进8', 'single-elim', 3, 'bracket-seed'),
        stage(4, '8进4', 'single-elim', 3, 'bracket-seed'),
        stage(5, '4进2', 'single-elim', 3, 'bracket-seed'),
        stage(6, '总决赛', 'single-elim', 3, 'bracket-seed'),
      ];
    case 64:
      return [
        stage(0, '64进32', 'double-life', 1, 'random-bucket'),
        stage(1, '32进16', 'double-life', 1, 'random-bucket'),
        stage(2, '16进8', 'single-elim', 3, 'bracket-seed'),
        stage(3, '8进4', 'single-elim', 3, 'bracket-seed'),
        stage(4, '4进2', 'single-elim', 3, 'bracket-seed'),
        stage(5, '总决赛', 'single-elim', 3, 'bracket-seed'),
      ];
    case 32:
      return [
        stage(0, '32进16', 'double-life', 1, 'random-bucket'),
        stage(1, '16进8', 'double-life', 1, 'random-bucket'),
        stage(2, '8进4', 'single-elim', 3, 'bracket-seed'),
        stage(3, '4进2', 'single-elim', 3, 'bracket-seed'),
        stage(4, '总决赛', 'single-elim', 3, 'bracket-seed'),
      ];
    case 16:
      return [
        stage(0, '16进8', 'double-life', 1, 'random-bucket'),
        stage(1, '8进4', 'single-elim', 3, 'bracket-seed'),
        stage(2, '4进2', 'single-elim', 3, 'bracket-seed'),
        stage(3, '总决赛', 'single-elim', 3, 'bracket-seed'),
      ];
    case 8:
      return [
        stage(0, '8进4', 'double-life', 1, 'random-bucket'),
        stage(1, '4进2', 'single-elim', 3, 'bracket-seed'),
        stage(2, '总决赛', 'single-elim', 3, 'bracket-seed'),
      ];
    case 4:
      return [
        stage(0, '4进2', 'single-elim', 3, 'bracket-seed'),
        stage(1, '总决赛', 'single-elim', 3, 'bracket-seed'),
      ];
    default:
      return [];
  }
}
