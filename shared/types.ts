export interface SpriteRecord {
  id: string;
  filename: string;
  displayName: string;
  name: string;
  path: string;
  aliases: string[];
  number: number | null;
  attribute: string;
  attributeCodes: string[];
  attributeIcon1: string;
  attributeIcon2: string;
  /** 精灵头像 URL（resources/sprites-icon，命名 {pet_id}_{name}.png；空串 = 无头像图，展示端回退立绘 path） */
  iconUrl: string;
  /** 形态筛选标签：由 pets.json stage 转换（一阶/二阶/三阶/首领） */
  form: string;
  /** pets.json 原始 form 字段（如 春天的样子，空字符串 = 无特殊形态），持久化快照用 */
  petForm: string;
  isFinalForm: boolean;
}

export interface SlotState {
  slot: number;
  sprite: SpriteRecord | null;
  opacityEnabled: boolean;
  opacity: number;
  effectiveOpacity: number;
  saturation: number;
  healthEnabled: boolean;
  healthPercent: number;
  energyValue: number;
}

export interface PanelState {
  position: 'left' | 'right';
  count: number;
  selected: SlotState[];
  mtime: number | null;
}

export interface ScoreboardState {
  leftName: string;
  leftScore: string;
  /** 左侧选手排位排名（仅数字，空字符串 = 未输入） */
  leftRank: string;
  rightName: string;
  rightScore: string;
  /** 右侧选手排位排名（仅数字，空字符串 = 未输入） */
  rightRank: string;
  bestOf: number;
  scoreboardEnabled: boolean;
  eventTitle: string;
  eventTitleEnabled: boolean;
  page2LineupDisplayMode: 'default' | 'avatar-only';
  page5Title: string;
  page6Title: string;
  nameFontSize: number;
  scoreFontSize: number;
  mtime: number | null;
}

export type Page6Background = 'image' | 'image-2' | 'video';

export interface MatchSlotSnapshot {
  slot: number;
  /** 精灵 id（pet_id），持久化主键 */
  pet_id: string | null;
  /** 精灵名称快照（冗余，便于人工核对持久化数据；以 pet_id 为准） */
  name: string;
  /** 精灵形态快照（pets.json 原始 form，如 春天的样子，空 = 无特殊形态；以 pet_id 为准） */
  form: string;
  opacityEnabled: boolean;
  opacity: number;
  saturation: number;
  healthEnabled: boolean;
  healthPercent: number;
  energyValue: number;
}

export interface GameRecord {
  gameNumber: number;
  leftLineup: string[];
  rightLineup: string[];
  leftSlots: MatchSlotSnapshot[];
  rightSlots: MatchSlotSnapshot[];
  winner: 'left' | 'right' | null;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface MatchRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'in_progress' | 'completed';
  leftPlayer: string;
  rightPlayer: string;
  /** 左侧选手排位排名（仅数字，空字符串 = 未输入） */
  leftRank: string;
  /** 右侧选手排位排名（仅数字，空字符串 = 未输入） */
  rightRank: string;
  /** 左侧选手所属战队 id（复用「信息录入」战队时记录，空字符串 = 手动输入或未填） */
  leftTeamId: string;
  /** 左侧选手所属战队名称（空字符串 = 未填） */
  leftTeamName: string;
  /** 右侧选手所属战队 id（复用「信息录入」战队时记录，空字符串 = 手动输入或未填） */
  rightTeamId: string;
  /** 右侧选手所属战队名称（空字符串 = 未填） */
  rightTeamName: string;
  bestOf: number;
  games: GameRecord[];
  leftScore: number;
  rightScore: number;
  winner: 'left' | 'right' | null;
  completedAt: string | null;
  tags: string[];
}

export interface MatchStoreState {
  activeMatchId: string | null;
  matches: MatchRecord[];
  /** 操作撤销能力（与页面上的「比赛历史」无关，纯 UI 撤销栈状态） */
  undo: {
    canUndo: boolean;
    canRedo: boolean;
    canUndoDelete: boolean;
    deleteUndoCount: number;
  };
  mtime: number | null;
}

export interface AvatarState {
  side: 'left' | 'right';
  exists: boolean;
  path?: string;
  size?: number;
  mtime?: number;
}

export interface AvatarCollectionState {
  left: AvatarState;
  right: AvatarState;
}

/**
 * 直播推流画面 key：决定推流载体页（index.html）要加载哪个推流页面。
 * - page1-overlay: 推流页面1（Overlay 比分栏布局）
 * - page2: 推流页面2（全局阵容展示）
 * - page3: 推流页面3（头像比分阵容）
 * - page5: 推流页面5（使用率/胜率排行）
 * - page6: 推流页面6（比赛结果）
 * - page7: 推流页面7（对局推送）
 * - page8: 推流页面8（比赛预告）
 * - page9: 推流页面9（团队积分榜）
 * - page10: 推流页面10（胜者结算画面）
 * - blank: 黑场（不加载任何画面）
 */
export type StagePageKey =
  | 'page1-overlay'
  | 'page2'
  | 'page3'
  | 'page5'
  | 'page6'
  | 'page7'
  | 'page8'
  | 'page9'
  | 'page10'
  | 'page11'
  | 'page12'
  | 'page13'
  | 'blank';

export type StageTransitionType = 'none' | 'blinds' | 'wolf';
export type Page3SpriteSource = 'sprite' | 'thumbnail';

export interface StageConfig {
  page: StagePageKey;
  transition: StageTransitionType;
  /** 推流页面3：精灵主体图片来源 */
  page3SpriteSource: Page3SpriteSource;
  /** 推流页面3：是否显示比分栏中央两侧的排位排名图标 */
  page3RankVisible: boolean;
  /** 推流页面3：是否显示比分栏两侧的战队 div（左右各一个：战队头像/logo + 底部名称色块） */
  page3TeamVisible: boolean;
  /** 选手介绍（page11-13）：是否显示选手排位排名 div */
  page11RankVisible: boolean;
  /** 推流页面5：选手过滤（空字符串 = 全部选手） */
  page5Player: string;
  /** 推流页面5：赛事标签过滤（空字符串 = 全部标签） */
  page5Tag: string;
  /** 胜者结算画面（page10）：登记本局胜负后自动切入的停留时长 */
  page10Duration: number;
  /** 胜者结算画面（page10）：停留时长单位（秒 / 分钟） */
  page10DurationUnit: NextGameDurationUnit;
  mtime: number | null;
}

/**
 * 比赛结果（page6）状态：展示哪些已结束的比赛，以及副标题（标题2）。
 */
export interface Page6State {
  /** 已选中的已结束比赛 id（最多 8 个，顺序即展示顺序） */
  matchIds: string[];
  /** 标题2 内容（后端输入，空字符串则隐藏） */
  title: string;
  /** 页面6背景类型：默认图片、备用图片或视频 */
  background: Page6Background;
  mtime: number | null;
}

/**
 * 对局推送（page7）状态：推送多场比赛，页面按小局逐行展示双方阵容与胜负。
 */
export interface Page7State {
  /** 已选中的比赛 id 列表（顺序即展示顺序，空数组 = 未选择，页面显示空占位行） */
  matchIds: string[];
  /** 主标题内容（后台输入，空字符串则使用默认「对局推送」） */
  title: string;
  /** 温馨提示内容（后台可编辑，默认「温馨提示：排名选自选手历史最高非实时」） */
  notice: string;
  mtime: number | null;
}

/**
 * 比赛预告（page8）背景类型：
 * - image: 内置背景图 1（Match-Preview.jpg）
 * - image-2: 内置背景图 2（back.for-page6-2.png）
 * - custom: 后台手动上传的自定义壁纸
 */
export type Page8Background = 'image' | 'image-2' | 'custom';

/**
 * 比赛预告（page8）状态：展示哪些待开始/进行中的比赛，以及主标题与壁纸。
 * 每场比赛一行卡片：左右选手信息 div（头像 + 名字 + 排位排名）+ 中央 vs。
 */
export interface Page8State {
  /** 已选中的比赛 id（最多 4 个，顺序即展示顺序） */
  matchIds: string[];
  /** 主标题内容（后台输入，空字符串则隐藏） */
  title: string;
  /** 页面8背景类型 */
  background: Page8Background;
  /** 自定义壁纸访问 URL（background 为 custom 时使用，空字符串则回退内置图） */
  wallpaperUrl: string;
  mtime: number | null;
}

/**
 * 团队积分榜（page9）单支战队录入项：
 * - name：战队名称（空字符串 = 未输入）
 * - r1 / r2 / r3：三轮积分（仅数字字符串，空字符串 = 未输入，页面显示「-」）
 * 排名与总积分由页面按总积分降序自动计算，不落盘。
 */
export interface Page9TeamEntry {
  name: string;
  r1: string;
  r2: string;
  r3: string;
}

/**
 * 团队积分榜（page9）状态：标题可在后台修改，战队积分在后台逐行输入。
 */
export interface Page9State {
  /** 主标题内容（后台输入，空字符串则使用默认「团队积分榜」） */
  title: string;
  /** 战队积分列表（顺序即录入顺序，最多 PAGE9_MAX_TEAMS 支） */
  teams: Page9TeamEntry[];
  mtime: number | null;
}

/**
 * 选手介绍（page11-13）单侧选手配置：
 * - source：数据来源。manual = 手动填写；match = 当前赛事（选手名取当前赛事，介绍按名字匹配「信息录入」）
 * - 手动填写时 name/rank/declaration/pets 生效，留空的字段回退「信息录入」按名字匹配到的值
 */
export interface Page11SideConfig {
  source: 'manual' | 'match';
  /** 手动填写的选手名字 */
  name: string;
  /** 手动填写的排位排名（仅数字，空 = 回退信息录入匹配值） */
  rank: string;
  /** 手动填写的比赛宣言（空 = 回退信息录入匹配值） */
  declaration: string;
  /** 手动填写的擅长精灵（自由文本，空 = 回退信息录入匹配值） */
  pets: string;
}

/** 选手介绍（page11-13）状态：左右两侧选手的介绍配置 */
export interface Page11State {
  left: Page11SideConfig;
  right: Page11SideConfig;
  mtime: number | null;
}

/**
 * 下一局比赛（page3 下场对局）配置：
 * - matchId：所选待开始比赛
 * - visible：当前是否正在显示
 * - duration / durationUnit：开启后停留时长（默认 1 分钟，可切秒/分钟）
 * - shownAt：本次开启的时间戳（用于自动隐藏倒计时）
 */
export type NextGameDurationUnit = 'seconds' | 'minutes';

export interface NextGameState {
  matchId: string | null;
  visible: boolean;
  duration: number;
  durationUnit: NextGameDurationUnit;
  shownAt: number | null;
  mtime: number | null;
}

/** 推流页面3 / 后台/悬浮窗共用的下一局比赛完整载荷 */
export interface NextGamePayload {
  state: NextGameState;
  match: MatchRecord | null;
  avatars: AvatarCollectionState;
}

/**
 * 倒计时插件（推流载体顶部叠加小插件）状态：
 * - visible：是否显示在推流画面（叠加在当前推流页面之上）
 * - running：倒计时是否进行中（false = 时间静止显示 remainingSeconds）
 * - duration：配置的倒计时总时长（分钟）
 * - remainingSeconds：静止状态下的剩余秒数（running 时以 endAt 为准）
 * - endAt：running 时的截止时间戳（ms，服务端时钟）
 * - theme：配色（dark 深色 / light 浅色）
 */
export type CountdownTheme = 'dark' | 'light';

export interface CountdownState {
  visible: boolean;
  running: boolean;
  duration: number;
  remainingSeconds: number;
  endAt: number | null;
  theme: CountdownTheme;
  mtime: number | null;
}

/** 倒计时插件 API / Socket 载荷：serverNow 供客户端校准时钟偏差 */
export interface CountdownPayload {
  state: CountdownState;
  serverNow: number;
}

export interface SnapshotPayload {
  panels: [PanelState, PanelState];
  scoreboard: ScoreboardState;
  avatars: AvatarCollectionState;
  store: MatchStoreState;
  stage: StageConfig;
  page6: Page6State;
  page7: Page7State;
  page8: Page8State;
  page9: Page9State;
  page11: Page11State;
  nextgame: NextGamePayload;
  profiles: ProfileStoreState;
  countdown: CountdownState;
}

/**
 * 「信息录入」选手录入项：头像、名字、常用精灵、宣言、排名。
 * 创建比赛时可复用（名字 / 排名 / 头像）。
 */
export interface PlayerProfile {
  id: string;
  /** 选手名字 */
  name: string;
  /** 常用精灵（自由文本，空字符串 = 未输入） */
  pets: string;
  /** 宣言（空字符串 = 未输入） */
  declaration: string;
  /** 排位排名（仅数字，空字符串 = 未输入） */
  rank: string;
  /** 头像是否存在（文件位于 cache/profiles/players/{id}.png，公开访问路径 /runtime/profiles/players/{id}.png） */
  avatarExists: boolean;
  avatarMtime: number | null;
}

/**
 * 「信息录入」战队录入项：战队名称、队长名称、logo或头像、宣言。
 * 创建比赛（所属战队）与推流页面3 战队 div 可复用。
 */
export interface TeamProfile {
  id: string;
  /** 战队名称 */
  name: string;
  /** 队长名称（空字符串 = 未输入） */
  captain: string;
  /** 宣言（空字符串 = 未输入） */
  declaration: string;
  /** logo/头像是否存在（文件位于 cache/profiles/teams/{id}.png，公开访问路径 /runtime/profiles/teams/{id}.png） */
  logoExists: boolean;
  logoMtime: number | null;
}

/** 「信息录入」状态：选手 + 战队录入列表 */
export interface ProfileStoreState {
  players: PlayerProfile[];
  teams: TeamProfile[];
  mtime: number | null;
}

export interface QuickFillMatch {
  slot: number;
  input: string;
  matched: boolean;
  matchType: string | null;
  sprite: SpriteRecord | null;
  candidates: SpriteRecord[];
}

export interface QuickFillPreview {
  matches: QuickFillMatch[];
  acceptedCount: number;
  matchedCount: number;
  ignoredCount: number;
  unmatched: string[];
}
