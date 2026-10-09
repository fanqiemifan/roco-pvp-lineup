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
  /** 系列赛关联（普通比赛无此字段；编排引擎经它把赛果写回 tournaments.json） */
  tournamentRef?: {
    tournamentId: string;
    /** 关联的 TournamentNode.id（形如 s0-w2-n03） */
    nodeId: string;
    stageIndex: number;
    waveIndex: number;
  };
}

export interface MatchStoreState {
  activeMatchId: string | null;
  matches: MatchRecord[];
  /** 操作撤销能力（与页面上的「比赛管理」无关，纯 UI 撤销栈状态） */
  undo: {
    /** 当前比赛（activeMatchId）的撤销栈状态：赛事面板那对按钮用 */
    canUndo: boolean;
    canRedo: boolean;
    canUndoDelete: boolean;
    deleteUndoCount: number;
    /**
     * 按比赛分组的撤销栈摘要（只收有栈的场次，仅布尔、不含快照体）。
     * 为什么需要：撤回栈本来就按比赛存，但上面两个字段只反映当前比赛，
     * 系列比赛的右键菜单 / Drawer 面板要在「不是当前比赛」的场次上准确置灰撤回按钮。
     */
    byMatch: Record<string, { canUndo: boolean; canRedo: boolean }>;
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
 * 各 key 的含义与完整清单见 constants.ts 的 SUPPORTED_STAGE_PAGES（唯一真源）。
 */
export type StagePageKey =
  | 'page1-overlay'
  | 'page2'
  | 'page3'
  | 'page4'
  | 'page5'
  | 'page6'
  | 'page7'
  | 'page8'
  | 'page9'
  | 'page10'
  | 'page11'
  | 'page12'
  | 'page13'
  | 'page14'
  | 'page15'
  | 'blank';

export type StageTransitionType = 'none' | 'blinds' | 'wolf';
export type Page3SpriteSource = 'sprite' | 'thumbnail';
/** 推流页面3红光特效策略：关闭 / 自动开启（按阵亡阈值触发） */
export type Page3RedLightMode = 'off' | 'auto';

export interface StageConfig {
  page: StagePageKey;
  transition: StageTransitionType;
  /** 页面1-3：阵容镜像反转（仅展示层左右互换，不改数据与胜负登记；开启后画面左侧展示实际右侧选手） */
  mirrorSides: boolean;
  /** 推流页面3：精灵主体图片来源 */
  page3SpriteSource: Page3SpriteSource;
  /** 推流页面3：是否显示比分栏中央两侧的排位排名图标 */
  page3RankVisible: boolean;
  /** 推流页面3：是否显示比分栏两侧的战队 div（左右各一个：战队头像/logo + 底部名称色块） */
  page3TeamVisible: boolean;
  /** 推流页面3：红光特效策略（关闭 / 自动开启） */
  page3RedLightMode: Page3RedLightMode;
  /** 推流页面3：红光特效「立即显示」一次性触发（进入下一局自动清除，不影响策略） */
  page3RedLightInstant: boolean;
  /** 选手介绍（page11-13）：是否显示选手排位排名 div */
  page11RankVisible: boolean;
  /** 推流页面5：阶段过滤（空字符串 = 全部阶段；非空为该系列赛 stages 下标的十进制字符串，随系列赛过滤生效） */
  page5Stage: string;
  /** 推流页面5：系列赛过滤 id（空字符串 = 全部系列赛；按 tournamentRef 精确匹配，不按名字） */
  page5TournamentId: string;
  /** 推流页面15（数据统计）：阶段过滤（空字符串 = 全部阶段；非空为该系列赛 stages 下标的十进制字符串） */
  page15Stage: string;
  /** 推流页面15（数据统计）：系列赛过滤 id（空字符串 = 全部系列赛） */
  page15TournamentId: string;
  /** 推流页面15（数据统计）：排序字段（picks = 使用次数/登场只次，games = 登场场次，winRate = 胜率，未登场排最后） */
  page15SortBy: 'picks' | 'games' | 'winRate';
  /** 推流页面15（数据统计）：排序方向（desc 降序 = 默认，asc 升序；未登场精灵无论方向都排最后） */
  page15SortOrder: 'asc' | 'desc';
  /** 战绩详情（page7）：整屏切换间隔（秒）——一屏 4 行停留该时长后整屏交叉过渡到下一屏 */
  page7SwitchSeconds: number;
  /** 胜者结算画面（page10）：登记本局胜负后自动切入的停留时长 */
  page10Duration: number;
  /** 胜者结算画面（page10）：停留时长单位（秒 / 分钟） */
  page10DurationUnit: NextGameDurationUnit;
  mtime: number | null;
}

/**
 * 比赛结果（page6）状态：展示哪些已结束的比赛、大标题与场序时间排期。
 * 画面采用与比赛预告（page8）相同的蓝色渐变卡片设计。
 */
export interface Page6State {
  /** 已选中的已结束比赛 id（最多 9 个，顺序即展示顺序与卡片场序） */
  matchIds: string[];
  /** 大标题内容（空字符串时前端兜底显示「比赛结果」） */
  title: string;
  /** 第一场开始时间 HH:mm（空字符串 = 未配置，卡片只显示「第N场」） */
  startTime: string;
  /** 按比赛 id 记录的手动场序时间覆盖（HH:mm），清空某场即恢复自动累加 */
  matchTimes: Record<string, string>;
  mtime: number | null;
}

/**
 * 战绩详情（page7）状态：推送多场比赛，页面按小局逐行展示双方阵容与胜负。
 */
export interface Page7State {
  /** 已选中的比赛 id 列表（顺序即展示顺序，空数组 = 未选择，页面显示空占位行） */
  matchIds: string[];
  /** 主标题内容（后台输入，空字符串则使用默认「战绩详情」） */
  title: string;
  /** 温馨提示内容（后台可编辑，默认「温馨提示：排名选自选手历史最高非实时」） */
  notice: string;
  mtime: number | null;
}

/**
 * 比赛预告（page8）状态：展示哪些待开始/进行中的比赛、大标题与场序时间排期。
 * 每场比赛一张卡片：底板 + BO/场序 + 左右选手条（头像/名字/比分/rank）。
 */
export interface Page8State {
  /** 已选中的比赛 id（最多 9 个，顺序即展示顺序与卡片场序） */
  matchIds: string[];
  /** 大标题内容（空字符串时前端兜底显示「比赛预告」） */
  title: string;
  /** 第一场开始时间 HH:mm（空字符串 = 未配置，卡片只显示「第N场」） */
  startTime: string;
  /** 按比赛 id 记录的手动场序时间覆盖（HH:mm），清空某场即恢复自动累加 */
  matchTimes: Record<string, string>;
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
 * 晋级积分榜（page14）单行选手战绩：只统计系列赛内、且属于同一阶段的比赛。
 * - wins/losses：该阶段内已分出胜负的场次累计（服务端按阶段现存节点重算）
 * - score：排序分 = 10×胜 − 负，只用于排序，不落盘也不展示
 * - state：阶段内状态，淘汰行页面压暗（与引擎 deriveState 同口径）
 */
export interface StageStandingRow {
  playerId: string;
  /** 展示名（取自「信息录入」档案，档案缺失时回退 playerId） */
  name: string;
  /** 名次（1 起；同分按种子顺序依次编号） */
  rank: number;
  wins: number;
  losses: number;
  score: number;
  state: 'alive' | 'promoted' | 'eliminated';
}

/**
 * 晋级积分榜（page14）某个阶段的完整榜单：
 * rows 为全部参赛选手（升序名次），分页由展示页按 pageSize 切片（当前页由后台控制）。
 */
export interface StageStandings {
  stageIndex: number;
  /** 阶段名（如「32进16」，自由文本，取自系列赛阶段配置） */
  stageName: string;
  format: StageFormat;
  bestOf: number;
  /** 赛制展示文本（含双败波次覆盖，如「BO1」/「W1 BO1 / W2·W3 BO3」）；展示页直接用，缺省回退 `BO{bestOf}` */
  bestOfText?: string;
  /** 参赛人数（= rows.length） */
  total: number;
  /** 每页最多展示行数（PAGE14_ROWS_PER_PAGE） */
  pageSize: number;
  /** 总页数（至少 1：无参赛者时也为 1，避免页码越界） */
  pageCount: number;
  /** 该阶段已分出胜负的场次 */
  completedMatches: number;
  /** 该阶段已建场场次（含未开打） */
  totalMatches: number;
  rows: StageStandingRow[];
}

/** 回退上一波影响预览的单场处置行（服务端只读预计算，与 rollbackWave 同口径） */
export interface RollbackWavePreviewRow {
  matchId: string;
  leftPlayer: string;
  rightPlayer: string;
  bestOf: number;
  /** 现状描述（如「已完赛 2:0」「未打」「进行中 1:0」） */
  stateLabel: string;
  /** 处置方式：reset-keep-lineup=复位保第 1 局阵容 / delete=删除（不可恢复，回退不可撤回）/
   *  discard-third-place=丢弃季军赛 / needs-undo=有赛况需逐场撤销 / none=无需处理 */
  action: 'reset-keep-lineup' | 'delete' | 'discard-third-place' | 'needs-undo' | 'none';
  /** 处置展示文案（预览行右侧 Tag 文本） */
  actionLabel: string;
}

/** 回退上一波影响预览（GET /api/tournaments/:id/rollback-preview 响应；判定与执行同源，以执行一刻为准） */
export interface RollbackWavePreview {
  /** false = 无法整体回退（部分进行 / 无波可退），界面渲染拒绝态 */
  executable: boolean;
  /** 不可回退时的原因（executable=false 必有） */
  reason?: string;
  /** 命中的回退分支：final-done=整波打完（撤销冠军）/ pristine=整波未打（删波重开前一波）/
   *  third-place=季军赛波 / to-setup=第一波回退整届回 setup */
  branch?: 'final-done' | 'pristine' | 'third-place' | 'to-setup';
  /** 波次标题（「阶段名 · 轮次」或「季军赛」，空字符串 = 无波可退） */
  waveLabel: string;
  /** 逐场处置清单（多对局时前端可截断展示，汇总剩余） */
  rows: RollbackWavePreviewRow[];
  /** 连带影响清单（撤销冠军 / 阶段回落 / 战绩重算 / 回到 setup 等） */
  impacts: string[];
  /** 是否存在「复位 · 保留第 1 局阵容」处置（前端用它展示安心提示） */
  keepLineup: boolean;
}

/**
 * 晋级积分榜（page14）状态：选一个系列赛、若干可播阶段与当前阶段，标题/副标题可改。
 * 每页最多展示 PAGE14_ROWS_PER_PAGE 行，超出（如 64进32 的 64 人）由裁判端在后台翻页。
 */
export interface Page14State {
  /** 关联系列赛 id（空字符串 = 未选择） */
  tournamentId: string;
  /** 可播阶段索引（后台弹窗一次性选中，顺序即后台切换顺序） */
  stageIndexes: number[];
  /** 当前激活阶段索引（-1 = 未选择） */
  activeStageIndex: number;
  /** 当前页码（0 起，每页 PAGE14_ROWS_PER_PAGE 行） */
  page: number;
  /** 主标题（空字符串 → 前端兜底「晋级积分榜」） */
  title: string;
  /** 副标题（空字符串 → 前端按阶段与赛制自动生成） */
  subtitle: string;
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

/**
 * MVP 结算（推流页面4）单个精灵项：
 * - petId：精灵主键（pet_id，空字符串 = 空槽，不落盘也不展示）
 * - tag：标签内容（最多四个字，可选，空字符串 = 不显示标签）
 * - isMvp：是否标记为 MVP（页面在该精灵项上叠加 MVP.png；全页最多一个）
 */
export interface MvpSlotEntry {
  petId: string;
  tag: string;
  isMvp: boolean;
}

/**
 * MVP 结算（page4）胜方快照（页面顶部选手信息条取数口径）：
 * 后台「结算画面」点「载入当前对局胜方」时把当前对局胜方写入 mvp.json，
 * 之后切换对局不会改变推流画面，需重新载入保存才会更新。
 * - matchId：胜方所属比赛 id（渲染时按它解析该场比赛头像；比赛被删/未上传时回退占位图）
 * - side：胜方所在侧
 * - playerName：保存时的胜方选手名字快照（不随赛事数据变化）
 */
export interface MvpWinnerSnapshot {
  matchId: string;
  side: 'left' | 'right';
  playerName: string;
}

/**
 * MVP 结算（推流页面4）状态：
 * - slots：最多 MVP_MAX_ITEMS 个精灵项，顺序即页面从左到右的展示顺序
 * - returnPage：开启结算前所在推流画面，关闭结算时切回
 * - winner：已载入的胜方快照（null = 未载入，页面显示「待定」与默认占位头像）
 */
export interface MvpState {
  slots: MvpSlotEntry[];
  returnPage: StagePageKey;
  winner: MvpWinnerSnapshot | null;
  mtime: number | null;
}

/**
 * MVP 结算（page4）胜方选手信息（页面顶部选手信息条）：
 * 由已保存的胜方快照下发（MvpWinnerSnapshot），切换对局不会改变。
 * - side 为 null：还没有已载入的胜方（页面显示「待定」与默认占位头像）
 * - avatarExists 为 false：该选手未上传头像，页面回退默认占位图
 */
export interface MvpWinnerInfo {
  side: 'left' | 'right' | null;
  playerName: string;
  avatarExists: boolean;
  avatarPath: string;
  avatarMtime: number | null;
}

/** 推流页面15 数据回放：单步 = 一场比赛对该榜单的增量贡献（按场序播放） */
export interface Page15ReplayStep {
  matchId: string;
  stageIndex: number;
  stageName: string;
  leftPlayer: string;
  rightPlayer: string;
  /** 该场已完赛小局的比分文本，如 "2:1" */
  score: string;
  /** 逐精灵增量：口径同 /api/stats/ranking（只统计已登记胜负的小局；镜像局 wins 记 0.5） */
  deltas: Array<{ key: string; picks: number; games: number; wins: number }>;
}

/** 推流页面15 数据回放载荷：后台「数据统计」推送，socket 事件 page15:replay 下发 */
export interface Page15ReplayPayload {
  tournamentId: string;
  tournamentName: string;
  fromStage: number;
  toStage: number;
  speed: 'slow' | 'normal' | 'fast';
  /** 出场精灵元数据映射（key → 展示信息），展示端据此建行 */
  sprites: Record<string, { name: string; displayName: string; iconPath: string; spritePath: string }>;
  /** 按场序（阶段升序 → 波次升序 → 创建时间）排列的逐场增量 */
  steps: Page15ReplayStep[];
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
  page14: Page14State;
  nextgame: NextGamePayload;
  profiles: ProfileStoreState;
  countdown: CountdownState;
  mvp: MvpState;
  tournaments: TournamentRecord[];
  /** 本机已「本机移除」（localOnly 墓碑）的系列赛：只在本机读取口径出现，绝不外传 */
  locallyRemoved: TournamentRecord[];
  /** 本机回收站（删除后 7 天内可整届恢复的 grace 墓碑）：只在本机读取口径出现，绝不外传 */
  recycleBin: TournamentRecord[];
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
  /**
   * id 别名：外部（另一台机器）的档案 id -> 本机档案 id。
   * 导入时若本机已有「同名但不同 id」的档案，会保留本机 id 并登记别名 ——
   * 系列赛编排里的 playerIds 可能是对方的 id，展示端按「原名 → 别名」依次解析才能显示出选手名字。
   */
  playerAliases?: Record<string, string>;
  teamAliases?: Record<string, string>;
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

/* ==================== 系列赛阵容批量导入（表格 / JSON 回填） ==================== */

/** 批量导入的逐场写入结果（或场次级预检结果） */
export interface LineupImportApplyResult {
  matchId: string;
  /** 是否已写入（false = 跳过，读取 reason 展示原因） */
  ok: boolean;
  /** 跳过原因（对局不存在 / 非本系列赛 / 该场已开赛 / 名字未匹配…） */
  reason?: string;
}

/** 批量导入预览（dryRun）的单场结果：按对局聚合，左右各一组逐格解析结果 */
export interface LineupImportPreviewRow {
  matchId: string;
  /** 是否可写入（比赛级预检通过，且两侧所有非空格均已解析出精灵） */
  ok: boolean;
  reason?: string;
  left: QuickFillMatch[];
  right: QuickFillMatch[];
}

/* ==================== 双机数据同步（导出 / 导入同步包） ==================== */

/** 同步包内嵌的选手档案（不含本地派生字段 avatarExists/avatarMtime） */
export type SyncBundlePlayerProfile = Pick<PlayerProfile, 'id' | 'name' | 'pets' | 'declaration' | 'rank'>;

/** 同步包内嵌的战队档案（不含本地派生字段 logoExists/logoMtime） */
export type SyncBundleTeamProfile = Pick<TeamProfile, 'id' | 'name' | 'captain' | 'declaration'>;

/** 同步包：单个 JSON 文件，含比赛、可选档案与头像（base64） */
export interface SyncBundle {
  app: string;
  schema: number;
  /** 导出机标识（机器码，空字符串 = 未设置） */
  machine: string;
  exportedAt: string;
  matches: MatchRecord[];
  /** 系列赛编排（全量随包流转；编辑权归编排机，只读副本由导入合并维护） */
  tournaments: TournamentRecord[];
  profiles?: {
    players: SyncBundlePlayerProfile[];
    teams: SyncBundleTeamProfile[];
  };
  /** 头像 / logo：档案 id -> base64（无 data: 前缀） */
  avatars?: {
    players: Record<string, string>;
    teams: Record<string, string>;
  };
  /**
   * 云同步策略载荷（仅云同步分发/回传包携带；U 盘导入导出仍不带该字段）：
   * 名册（房间内全部机器码，用于配对校验）+ 指派规则（哪场比赛交给哪个分控端登记）。
   */
  cloud?: CloudSyncOffer;
}

/** 导入冲突策略：newer = 较新覆盖（默认，看 updatedAt）；bundle = 以包为准（内容有差异即覆盖） */
export type SyncConflictMode = 'newer' | 'bundle';

export type SyncImportAction = 'add' | 'update' | 'skip';
export type SyncImportItemKind = 'match' | 'player' | 'team';

/** 导入预览的字段级差异项（本机 vs 包内） */
export interface SyncImportDiffField {
  label: string;
  /** 本机值（本机无该记录时为空字符串） */
  local: string;
  /** 包内值 */
  incoming: string;
}

/** 导入预览：头像 / logo 的左右对照（仅档案项、且包内带头像或本机已有头像时提供） */
export interface SyncImportAvatarCompare {
  /** 本机头像访问地址（本机无头像 = null） */
  localUrl: string | null;
  /** 包内头像 data URL（包内无头像 = null） */
  incomingDataUrl: string | null;
  /** 处理说明（如「导入后将补缺到本机」） */
  note: string;
}

/** 导入预览明细项：key 为 `${kind}:${id}`，前端勾选后原样回传 */
export interface SyncImportItem {
  key: string;
  kind: SyncImportItemKind;
  id: string;
  label: string;
  action: SyncImportAction;
  /** 跳过/覆盖原因（空字符串 = 无） */
  reason: string;
  /** 仅比赛项：本地版本更新时间（无本地记录 = null） */
  localUpdatedAt: string | null;
  /** 仅比赛项：包内版本更新时间 */
  incomingUpdatedAt: string | null;
  /** 双方都已登记且内容不同（疑似两台机器都录过这场，需要人工确认是否覆盖） */
  conflict: boolean;
  /** 字段级差异（只列出不同的字段；本机无该记录时为空数组） */
  diff: SyncImportDiffField[];
  /** 仅档案项：头像 / logo 的左右对照（无差异或包内不含头像时不提供） */
  avatarCompare?: SyncImportAvatarCompare;
  /**
   * 命中本机「已删除系列赛」的对局名单（防"已删对局回魂"）：合并时不会写入本机。
   * 预览据此标注为「已删名单拦截」（action = skip），不再显示为「新增」——避免
   * "预览说新增 N 场、合并后一场都看不到"的误导（预览与应用共用判定）。
   */
  blocked?: boolean;
}

export interface SyncImportCounts {
  add: number;
  update: number;
  skip: number;
}

/**
 * 导入预览里的系列赛分组：把包内的系列赛与它包含的比赛关联起来，
 * 让用户在预览弹窗里能一眼分辨「哪些比赛属于哪个系列赛」，并按系列赛决定要不要一起导入。
 * - key：`tournament:${id}` 或 `plain`（不属于任何系列赛的普通对局）
 * - id：系列赛 id（plain 组为空字符串）
 * - incoming：本包是否带了这条系列赛编排（false = 包内没有该系列赛的编排，只是比赛挂了引用）
 */
export interface SyncImportTournamentGroup {
  key: string;
  id: string;
  name: string;
  /** 本包是否携带该系列赛编排（会随导入自动合并） */
  incoming: boolean;
  /** 本机是否已有该系列赛 */
  existsLocally: boolean;
  /** 该系列赛的参赛人数（包内编排可见时才有值） */
  playerCount: number | null;
  /** 该系列赛现有的轮次摘要（如「8进4 · 第 2 波」），无编排时为空字符串 */
  stageSummary: string;
  /** 由它包含、且出现在本次预览里的比赛 key（match:xxx） */
  matchKeys: string[];
  /** 其中可勾选（新增/更新）的比赛数 */
  selectableCount: number;
  /** 本包携带的该系列赛是删除墓碑：随导入自动清理本机副本，不可取消勾选（删除指令不是可选项） */
  tombstone?: boolean;
  /** 该系列赛在本机已被「本机移除」（localOnly 墓碑）：导入后仍保持隐藏，可在系列比赛「已本机移除」中恢复 */
  localRemoved?: boolean;
  /** 本机已有该系列赛的真实墓碑（已删除）：组内名单对局会被合并侧拦截、不会写入（预览与应用同口径） */
  localTombstone?: boolean;
}

/** 头像 / logo 处理统计 */
export interface SyncAvatarCounts {
  /** 本地缺失、可从包内补缺的数量 */
  fill: number;
  /** 本地已有（保持不动） */
  existing: number;
  /** 包内头像找不到对应档案（含同名匹配失败） */
  unmatched: number;
}

export interface SyncImportPreview {
  meta: { app: string; schema: number; machine: string; exportedAt: string };
  /** 源包与本机机器码相同（提示可能覆盖本机数据） */
  sameMachine: boolean;
  mode: SyncConflictMode;
  matchItems: SyncImportItem[];
  playerItems: SyncImportItem[];
  teamItems: SyncImportItem[];
  /** 按系列赛分组的比赛（含「普通对局」组），用于预览弹窗里区分系列赛及其比赛 */
  tournamentGroups?: SyncImportTournamentGroup[];
  /** 本包是否携带系列赛编排（false = 只带了比赛，编排不参与本次导入） */
  hasTournaments?: boolean;
  summary: {
    match: SyncImportCounts;
    player: SyncImportCounts;
    team: SyncImportCounts;
  };
  avatars: {
    players: SyncAvatarCounts;
    teams: SyncAvatarCounts;
  };
}

/** 系列赛导入合并与写回统计（编排数据自动合并，不参与逐条勾选） */
export interface SyncTournamentReport {
  added: number;
  updated: number;
  skipped: number;
  /** 结构不合法被忽略的条目数 */
  rejected: number;
  /** 写回补跑是否真正改动了系列赛（如最后一场补齐后自动推进到下一波） */
  advanced: boolean;
}

/** 导入应用结果 */
export interface SyncImportResult {
  store: MatchStoreState;
  /** 包内不含档案时为 null */
  profiles: ProfileStoreState | null;
  applied: SyncImportPreview['summary'];
  avatarsWritten: { players: number; teams: number };
  tournaments: SyncTournamentReport;
  warnings: string[];
}

/* ==================== 云同步（点击式：主控分发 / 分控拉取回传 / 主控确认台） ==================== */

/** 云同步角色：main = 主控端（编排机 + 确认台）；sub = 分控端（只读副本 + 登记点） */
export type CloudSyncRole = 'main' | 'sub';

/**
 * 云同步配置（随同步包下发的策略/名册载荷，不带头像）。
 * - roster：房间名册（主控端维护，两端机器码必须互不相同）
 * - assignment.overrides：比赛 id -> 登记机器码；空字符串 = 主控端自己登记，未列出的同理
 */
export interface CloudSyncOffer {
  roster: CloudSyncRosterEntry[];
  assignment: { overrides: Record<string, string>; updatedAt: string };
}

export interface CloudSyncRosterEntry {
  code: string;
  /** 显示名（machineLabel，纯展示；空字符串 = 只显示短码） */
  label: string;
}

/** 云端版本号（小键，供红点轮询，不读大包） */
export interface CloudSyncVersion {
  v: number;
  at: string;
  /** 分发机机器码 */
  from: string;
}

/** 分控端已登记但未被主控确认的比赛（现算，用于回传） */
export interface CloudSyncPendingMatch {
  matchId: string;
  label: string;
  /** 系列赛阶段/波次标签（非系列赛对局为空字符串） */
  tournamentLabel: string;
  leftScore: number;
  rightScore: number;
  winner: 'left' | 'right' | null;
}

/** 分控端回传载荷（累计集合，非增量） */
export interface CloudSyncUplinkPayload {
  from: string;
  seq: number;
  submittedAt: string;
  matches: MatchRecord[];
}

/** 主控端确认回执 */
export interface CloudSyncAckPayload {
  ackedMatchIds: string[];
  ackedSeq: number;
  at: string;
}

/** 待回传集（分控端本地现算结果，含重算依据） */
export interface CloudSyncPendingQueue {
  matches: CloudSyncPendingMatch[];
  count: number;
  /** 其中「已经交回、还在等主控电脑确认」的场次数（用来区分「还没交回」和「交了没被确认」） */
  unconfirmedCount: number;
  /** 上次回传序号（0 = 未回传过） */
  seq: number;
  submittedAt: string | null;
  /** 已确认比赛 id（主控回执，用于清理待回传标记与锁定撤回） */
  ackedMatchIds: string[];
  ackedAt: string | null;
}

/** 主控端收件箱：按分控端分组 */
export interface CloudSyncInboxEntry {
  code: string;
  label: string;
  pending: CloudSyncPendingMatch[];
  seq: number;
  submittedAt: string;
}

/** 云同步状态（两端共用同一份结构，字段按角色填充） */
export interface CloudSyncStatus {
  config: {
    syncKey: string;
    /** 访问令牌（Worker 侧 SYNC_TOKEN）：只存本机 config.json 与 Cloudflare secret，不进 URL */
    syncToken: string;
    role: CloudSyncRole;
    workerUrl: string;
    machineCode: string;
    machineLabel: string;
    pollEnabled: boolean;
    pollIntervalSeconds: number;
  };
  /** 本机是否已配置到可用的程度（syncKey + workerUrl） */
  configured: boolean;
  /** 云端版本（未轮询/未拉取过为 null） */
  version: CloudSyncVersion | null;
  /** 本机已合并并落地的云端版本（分控端「已同步」判据） */
  appliedVersion: number;
  /** 待回传集（分控端；主控端为空集） */
  pending: CloudSyncPendingQueue;
  /** 收件箱（主控端；分控端为空数组） */
  inbox: CloudSyncInboxEntry[];
  /** 房间名册（主控端为本地配置，分控端来自最近一次拉取） */
  roster: CloudSyncRosterEntry[];
  /** 指派规则（比赛 id -> 机器码；空字符串 = 主控端登记） */
  assignment: Record<string, string>;
  /** 分控端 B1「记住上次排除」：最近一次确认合并时排除的系列赛（下次预览默认继续排除；墓碑永不入列） */
  excludedTournamentIds: string[];
  /** 主控端：本机为编排机的系列赛 id（分控端为空数组） */
  ownedTournamentIds: string[];
  /** 最后一次成功通信时间（本机记录，不做心跳） */
  lastContact: {
    pushedAt: string | null;
    pulledAt: string | null;
    uploadedAt: string | null;
    ackedAt: string | null;
  };
  /** 上一次云端操作失败原因（成功清空，供界面提示） */
  lastError: string;
}

/** 云动作结果：成功回执 + 更新后的状态 */
export interface CloudSyncActionResult<T = Record<string, unknown>> {
  status: CloudSyncStatus;
  data: T;
}

/** 红点轮询结果：只读小键，绝不合并数据（changed = 云端版本号比本机记录的新） */
export interface CloudSyncPollResult {
  version: CloudSyncVersion | null;
  changed: boolean;
  /** 主控端：各分控端回传摘要；分控端为空数组 */
  inbox: CloudSyncInboxEntry[];
  status: CloudSyncStatus;
}

/** 主控「同步分发」结果 */
export interface CloudSyncPushResult {
  version: CloudSyncVersion;
  bytes: number;
  matchCount: number;
  tournamentCount: number;
}

/** 分控「同步最新」结果：dist = 下发机（主控端）机器码 */
export interface CloudSyncPullResult extends CloudSyncActionResult<{ dist: string }> {
  preview: SyncImportPreview;
  bundle: SyncBundle;
}

/** 分控「回传」结果 */
export interface CloudSyncUploadResult extends CloudSyncActionResult<{ seq: number; count: number }> {
  submittedAt: string;
}

/**
 * 主控确认台单条赛果：把分控端回传条目重分类为现有导入预览条目，
 * 并附「写回影响」说明（确认后写入哪个系列赛节点、是否会推进波次）。
 */
export interface CloudSyncAckItem {
  item: SyncImportItem;
  /** 比赛记录（确认后按此项合并） */
  record: MatchRecord;
  /** 写回影响说明（非系列赛对局为空字符串） */
  impact: string;
}

export interface CloudSyncAckSource {
  code: string;
  label: string;
  seq: number;
  submittedAt: string;
  /** 全部待确认条目 */
  items: CloudSyncAckItem[];
  /** 可勾选条目（action != skip）的 key */
  selectableKeys: string[];
}

/** 主控「检查回传」结果：全体分控端待确认赛果（code = null 时取收件箱第一个有内容的分控端） */
export interface CloudSyncCheckResult extends CloudSyncActionResult<{ sources: CloudSyncAckSource[]; source: CloudSyncAckSource | null }> {}

/** 主控确认结果 */
export interface CloudSyncConfirmResult extends CloudSyncActionResult<{ acked: string[]; warnings: string[] }> {
  result: SyncImportResult;
}

/** 主控「驳回」结果：不写本地、不写回执，分控端保持待回传 */
export interface CloudSyncRejectResult extends CloudSyncActionResult<{ code: string }> {}

/** 主控「测试连接」结果 */
export interface CloudSyncTestResult extends CloudSyncActionResult<{ ok: boolean }> {
  ok: boolean;
  message: string;
  /** Worker 侧鉴权状态（来自 /health）：tokenConfigured=false 说明运营者还没设 SYNC_TOKEN，任何人都会拿到 503 */
  health?: { tokenRequired: boolean; tokenConfigured: boolean };
}

/** 机器码变更校验结果：blocked = 拒绝，需确认 = 前端二次确认 */
export interface MachineCodeGuardResult {
  blocked: boolean;
  requireConfirm: boolean;
  /** 受影响（内嵌旧机器码）的系列赛 id */
  tournamentIds: string[];
  message: string;
}

/**
 * 换房间守卫结果：改「房间号」（syncKey）时本机旧的云同步状态怎么处理。
 * 本机 `cache/cloud-sync.json`（版本水位 / 已确认集 / 回传水位 / 名册 / 指派）**不含房间标识**，
 * 原样带进新房间会让分控端被误判「已是最新」、主控端旧水位让新回传被静默忽略，
 * 因此要求显式选择「重置」或「保留」（缺省则拒绝保存）。
 */
export interface CloudSyncKeyGuardResult {
  /** 规范化后的房间号是否与已保存的不同 */
  changed: boolean;
  /** 本机是否留有旧房间的云同步状态 */
  hasLocalState: boolean;
  /** 需要二次确认（房间号确实变了 + 本机还留着旧状态） */
  requireConfirm: boolean;
  message: string;
  /** 会被一起重置的内容摘要（界面据 0 值隐藏该项） */
  summary: CloudSyncLocalStateSummary;
}

/** 旧房间本机云同步状态的摘要（换房间守卫展示用，全 0 = 没有旧状态） */
export interface CloudSyncLocalStateSummary {
  /** 云端最新版本号（0 = 没读到过） */
  version: number;
  /** 本机已处理到第几版（0 = 没处理过） */
  appliedVersion: number;
  /** 已确认赛果场次 */
  ackedMatches: number;
  /** 待确认回传的电脑台数 */
  inboxPeers: number;
  /** 记录过回传水位的电脑台数 */
  uplinkWatermarks: number;
  /** 本机回传序号（0 = 没回传过） */
  uplinkSeq: number;
  /** 指派规则条数 */
  assignments: number;
  /** 房间名册里的电脑台数（含分控码） */
  peers: number;
}

/** 云同步接口的键名（KV 中四类键的后两类按机器码分键） */
export type CloudSyncBoxName = 'downlink' | 'version' | `uplink/${string}` | `ack/${string}`;

/* ==================== 系列赛自动化管理（cache/tournaments.json） ==================== */

/** 阶段晋级赛制：双败积分制 / 单败淘汰制 */
export type StageFormat = 'double-life' | 'single-elim';

/**
 * 季军赛安排（系列赛级配置，创建时选定）：0 = 不安排；1/3/5/7 = 半决赛打完自动建场的局数。
 * 记录里缺省（旧数据未回填 / 手写对象）按「与总决赛同赛制」解析，见 resolveThirdPlaceBestOf。
 */
export type ThirdPlaceBestOf = 0 | 1 | 3 | 5 | 7;

export type PairingRule =
  | 'random-bucket'   // 双败：同战绩桶内随机配对
  | 'manual-bucket'   // 双败：同桶内手动配对（配对确认台）
  | 'bracket-seed'    // 单败：种子位手动/随机落位后沿树推进
  | 'random-round';   // 单败：每轮重新随机（备选）

export interface StageRule {
  id: string;
  /** 阶段名：32进16 / 16进8 / 8进4 / 4进2 / 总决赛 */
  name: string;
  format: StageFormat;
  /** 本阶段每场对决的局数（后台规则表放出 BO1 / BO3 / BO5 / BO7） */
  bestOf: 1 | 3 | 5 | 7;
  /**
   * 双败阶段按波次的赛制覆盖（只有 W2/W3 可覆盖；W1 与单败阶段一律沿用 bestOf）。
   * 缺省（或覆盖值等于 bestOf）= 全阶段同 BO；编辑某一波只重开该波，不动更早的波。
   * 统一口径见 shared/constants 的 resolveWaveBestOf / formatStageBestOf。
   */
  waveBestOf?: Partial<Record<2 | 3, 1 | 3 | 5 | 7>>;
  /** 配对方式：双败默认 random-bucket，单败默认 bracket-seed */
  pairing: PairingRule;
  /** 同阶段尽量避开已交手对手 */
  avoidRematch: boolean;
  /** 下一波/下一阶段生成是否需要手动确认 */
  requireConfirm: boolean;
}

/** 选手在「当前阶段内」的战绩（换阶段清零） */
export interface TournamentEntry {
  playerId: string;
  stageWins: number;
  stageLosses: number;
  state: 'alive' | 'promoted' | 'eliminated';
}

export interface TournamentNode {
  /** 节点 id：s{stageIndex}-w{waveIndex}-n{序号}，如 s0-w2-n03 */
  id: string;
  /** 关联 MatchRecord.id；轮空节点为 null（V1 不产生轮空） */
  matchId: string | null;
  playerAId: string | null;
  playerBId: string | null;
  winnerId: string | null;
  isBye: boolean;
  /** 单败对阵树连线：本节点胜者进入哪个节点的哪个槽位（双败不用，V1 单败每阶段仅一波亦不用） */
  next?: { nodeId: string; slot: 'a' | 'b' };
}

/** 配对确认台中的一个选手槽位 */
export interface PairingSlot {
  /** 双败战绩桶 key（"1-0"），单败为 undefined */
  bucketKey?: string;
  playerId: string | null;
}

export interface TournamentWave {
  stageIndex: number;
  /** 双败阶段 1..3，单败阶段 1 */
  waveIndex: number;
  status: 'pending' | 'running' | 'completed';
  /** draft = 配对草稿中（手动模式/需确认），未建任何比赛；locked = 已建场不可改 */
  pairingStatus: 'draft' | 'locked';
  /**
   * 缺省 = 主赛波次；'third-place' = 季军赛（4 人阶段的两名落败者的附加赛）。
   * 季军赛不在晋级链上：不写 entries、不参与阶段推进与战绩重算、不进阶段榜单，
   * 只是挂在本阶段下的一场普通对局（引擎各处按该标记跳过，见 tournament-service）。
   */
  kind?: 'third-place';
  /** draft 阶段暂存的候选配对；锁定后清空并落到 nodes */
  pairingDraft?: { bucketKey?: string; pair: [string | null, string | null] }[];
  nodes: TournamentNode[];
}

export interface TournamentRecord {
  /** 系列赛 id：T + 日期 + 机器码 + 序号，如 T20260928_A01 */
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'setup' | 'running' | 'completed';
  /** 抽签随机种子，洗牌过程可复现（测试可断言） */
  seed: number;
  /** 重抽次数 */
  drawVersion: number;
  /** 参赛选手 profile id，长度必须为 4/8/16/32/64/128（见 SUPPORTED_TOURNAMENT_SIZES），顺序即种子顺序 */
  playerIds: string[];
  stages: StageRule[];
  currentStageIndex: number;
  entries: TournamentEntry[];
  waves: TournamentWave[];
  /** 季军赛局数（0 = 不安排）；创建时选定，语义见 ThirdPlaceBestOf */
  thirdPlaceBestOf?: ThirdPlaceBestOf;
  /**
   * 冠军 / 亚军：总决赛波打完时写入。季军 / 殿军**不在这里**——
   * 它是季军赛波次节点的 winnerId（唯一真源，可能早于或晚于总决赛产生）。
   */
  result?: { championId: string; runnerUpId: string };
  /**
   * 删除墓碑：非空表示该系列赛已被编排机删除（记录作为墓碑保留而不物理移除）。
   * 对外读取路径过滤墓碑（getTournamentStore），墓碑随同步包传播：接收端据此清本机副本、
   * 解绑对局，且墓碑永远优先于存活副本（防旧包把已删系列赛带回来复活）。
   */
  deletedAt?: string | null;
  /** 墓碑携带：删除时关联的对局 id 名单（接收端据此清本地副本，两端据此拦截"已删对局回魂"） */
  deletedMatchIds?: string[];
  /** 墓碑携带：删除时是否"连同对局删除"（决定 deletedMatchIds 是否要在接收端一并移除） */
  deletedMatches?: boolean;
  /**
   * 回收站保留截止时间（仅编排机本机语义，随墓碑原样传播但对端不使用）：
   * 删除系列赛进入回收站 7 天，期间可「整届恢复」（编排 + 进度 + 对局一体还原，对局不解绑不删除）；
   * 到期自动终结 = 对局真正删除（不可恢复）+ 系列赛留为跨机墓碑。缺省（旧墓碑）= 已终结。
   */
  graceUntil?: string | null;
  /**
   * 本机移除标记（仅本机存在，**绝不随同步包外传**）：分控端对「非本机编排」的系列赛做视图层隐藏，
   * 立即隐藏且同步不复活；「恢复」时清除。对局引用与内容保留不动（不 detach、不删对局、不改 updatedAt）。
   * 编排机的真墓碑到达时，整条被替换并清除本标记（随之走正常解绑 / 清理收口）。
   */
  localOnly?: boolean;
}

/** 配对草稿校验结果（配对确认台锁定前） */
export interface PairingValidation {
  valid: boolean;
  errors: string[];
  /** 已交手提醒等不阻断信息 */
  warnings: string[];
}

/** 外部对阵表导入结果 */
export interface PairingImportResult {
  tournament: TournamentRecord;
  /** 未能唯一匹配到档案的行（原文 + 行号） */
  unmatched: Array<{ line: number; text: string }>;
}
