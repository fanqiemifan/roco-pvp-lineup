/**
 * 「本页怎么用」的纯逻辑层：**每个导航视图一套步骤注册表**。
 *
 * 定位（2026-10 调整）：这里只服务顶栏那一个「本页怎么用」按钮——点开右侧抽屉，
 * 按步骤讲清当前这个视图怎么操作，需要动手的流程给一个「开模拟会话（假数据）」入口。
 * **没有**"首访自动弹引导 / 主线多步漫游 / 上下文提示卡"这套东西了：
 * 用户只要一个随时能点、随时能关的说明入口，不需要被打断。
 *
 * 锚点仍然一律用 `data-tour="xxx"`（不依赖组件库内部 class），便于将来需要时把某一步
 * 直接指到界面元素上；当前抽屉只展示文字清单，不跑 Tour。
 *
 * 本文件不引用 DOM 类型与 React，可在 tests/admin-antd 的 node 环境直接单测。
 */

import type { ViewKey } from '../types';

/** 每视图「怎么用」是否被打开过的记录键（只写本机 localStorage，不建接口、不进同步包） */
export const GUIDE_VISIT_STORAGE_KEY = 'guide:roco-pvp:v1:visits';

/**
 * 本地存储的最小结构。故意不用 DOM 的 `Storage` 类型：
 * 本文件会被 tests/admin-antd 的 node 环境测试导入，而测试工程的 tsconfig 不带 DOM lib。
 */
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): KeyValueStorage | null {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** 读过哪些视图的说明（无记录 / 存储不可用 / 值损坏都返回空数组，静默降级） */
export function readGuideVisits(): string[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(GUIDE_VISIT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** 记一次「这个视图的怎么用被打开过」；重复打开不重复记 */
export function recordGuideVisit(view: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    const visited = readGuideVisits();
    if (visited.includes(view)) {
      return;
    }
    storage.setItem(GUIDE_VISIT_STORAGE_KEY, JSON.stringify([...visited, view]));
  } catch {
    // 写入失败（配额 / 隐私模式）静默降级：只是少一条"读过"记录
  }
}

/* ==================== 步骤类型与注册表 ==================== */

/** 卡片相对锚点的位置（留给"直接在界面上指出来"的将来用） */
export type GuidePlacement =
  | 'bottom' | 'bottomLeft' | 'bottomRight' | 'top' | 'topLeft' | 'topRight'
  | 'left' | 'leftTop' | 'leftBottom' | 'right' | 'rightTop' | 'rightBottom' | 'center';

/** 一步说明的类型（决定抽屉里的标签，以及要不要给"开模拟会话"入口） */
export type GuideStepKind =
  /** 讲一间界面 + 指向一个锚点 */
  | 'step'
  /** 讲一个复合流程（回退上一波 / 右键菜单 / 登记胜负…），文案更长，通常带模拟会话入口 */
  | 'flow';

export interface GuideStep {
  /** 步骤标题 */
  title: string;
  /** 步骤正文 */
  body: string;
  /** 锚点选择器（`data-tour` 属性）；null = 这一步没有可直接指的位置 */
  target: string | null;
  placement: GuidePlacement;
  kind: GuideStepKind;
  /** 该流程适合在哪个视图的模拟会话里练（抽屉据此给「开模拟会话」） */
  demoView?: ViewKey;
}

export interface ViewGuide {
  /** 视图标题（抽屉头部） */
  title: string;
  /** 一句话说明这是干什么的 */
  summary: string;
  steps: GuideStep[];
}

/** 视图键 → 该视图的步骤表（12 个导航视图全覆盖） */
export const VIEW_GUIDES: Record<ViewKey, ViewGuide> = {
  roster: {
    title: '赛事面板',
    summary: '建比赛、选当前比赛、录入左右阵容，并在这里开始/登记每一小局。',
    steps: [
      {
        title: '比赛列表',
        body: '「开一局」手动建一场；「快速创建比赛」勾选选手后随机配对批量建场（参赛人数必须是偶数）。'
          + '列表按「赛事 · 阶段 · 轮次」分组，点「选择」把某场设为当前比赛（会覆写推流画面）。',
        target: '[data-tour="roster-match-list"]',
        placement: 'bottom',
        kind: 'step',
      },
      {
        title: '当前比赛：开始与登记',
        body: '「开始本次对局」开第 1 局；左侧赢了 / 右侧赢了 登记本局胜负，满 BO 局数自动完赛。'
          + '「撤回上一步」「取消撤回」可回退登记。当前比赛是系列赛对局时，选手名与赛制由编排锁定（改名去「信息录入」）。',
        target: '[data-tour="current-match-panel"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'roster',
      },
      {
        title: '当前阵容：左 6 / 右 6',
        body: '点右侧「点击选中」决定接下来填哪一侧，再从下面点精灵填入；6 个槽位各管一只。'
          + '改完自动保存（600ms 防抖），推流画面会跟着变。待开始的小局填的是赛事草稿，开局后才上推流页。',
        target: '[data-tour="roster-slots"]',
        placement: 'top',
        kind: 'flow',
        demoView: 'roster',
      },
    ],
  },
  stage: {
    title: '直播推流',
    summary: '选一路画面推出去；OBS 只固定捕获根路径，换画面都在这里点。',
    steps: [
      {
        title: '画面切换',
        body: '每张卡片就是一路画面，点一下即切换（当前画面带绿标）。'
          + '推流软件固定捕获根路径 `/`，之后换画面全在这里点，不用再动 OBS。',
        target: '[data-tour="stage-cards"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'stage',
      },
      {
        title: '推流地址',
        body: '「打开推流页面」在本机新开一个标签看效果；「复制推流页地址」拿到的是给 OBS 用的完整地址'
          + '（含本机 IP，别的电脑/第二个显示器也能打开）。',
        target: '[data-tour="stage-address"]',
        placement: 'bottom',
        kind: 'step',
      },
      {
        title: '团队积分榜（页面9）',
        body: '这张表是批量录入的：填战队名与三轮积分后必须点「保存页面9设置」才生效（切画面不会自动保存）。',
        target: '[data-tour="stage-page9"]',
        placement: 'top',
        kind: 'step',
      },
    ],
  },
  tournament: {
    title: '系列比赛',
    summary: '一届赛事的编排台：抽签、配对、建场、推进波次、回退与登记赛果。',
    steps: [
      {
        title: '创建一届',
        body: '「＋ 创建系列赛」开向导：①名称 → ②勾选选手（人数只能是 4/8/16/32/64，且必须来自「信息录入」档案）'
          + '→ ③阶段规则（阶段名 / BO / 配对方式 / 是否需确认；只剩 2 人的总决赛固定单败，可另安排季军赛）'
          + '→ ④抽签并「确认开赛」生成第 1 波。中途关掉可在列表点「继续配置」。',
        target: '[data-tour="tournament-create"]',
        placement: 'bottomRight',
        kind: 'step',
      },
      {
        title: '详情：晋级图 / 波次列表',
        body: '点系列赛名进详情。默认「晋级图」按阶段分组、双败按战绩桶拆列；切到「波次列表」看每一波的建场状态。'
          + '赛果写回后对阵图会自动更新——别手改选手名（那是写回比对的依据）。',
        target: '[data-tour="tournament-detail"]',
        placement: 'bottom',
        kind: 'step',
      },
      {
        title: '回退上一波',
        body: '打错了整波要重来：这里删掉最后一波**未开始**的比赛并复位战绩（该波已有结果时引擎会拒绝整波回退，'
          + '改走逐场「撤回」）。季军赛是附加波次、不在晋级链上，重开半决赛时会被一起丢弃并按新落败者重建。',
        target: '[data-tour="tournament-rollback"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'tournament',
      },
      {
        title: '对局卡片：右键与「⋯」菜单',
        body: '右键卡片任意位置 = 直接打开该场的对局面板（连续登记多场不用来回切）；点右上「⋯」出菜单：'
          + '开始本局 / 左赢 / 右赢 / 撤回 / 查看阵容 / 弃权判负 / 进入管理。**这些动作默认 headless**——'
          + '只写目标那场，不切当前比赛、不影响正在推流的画面。',
        target: '[data-tour="tournament-node-card"]',
        placement: 'top',
        kind: 'flow',
        demoView: 'tournament',
      },
      {
        title: '抽签与配对确认台',
        body: '需确认或手动配对的波先停在「配对确认台」：按桶填两侧选手、可「桶内随机重排」，'
          + '「导入对阵表」支持每行 A vs B 的文本。锁定后才批量建场——锁定前的错配对在这里改，锁定后只能回退重来。',
        target: '[data-demo-tour="tournament-waves"]',
        placement: 'top',
        kind: 'flow',
        demoView: 'tournament',
      },
      {
        title: '阵容表批量导出 / 导入',
        body: '「导出阵容模板」把待开始比赛的第 1 局导成「一场两行」的 Excel（精灵列带下拉），线下填完再「导入阵容」。'
          + '只写比赛记录、不碰编排，只读副本也能用。',
        target: '[data-tour="tournament-lineup"]',
        placement: 'bottom',
        kind: 'step',
      },
    ],
  },
  mvp: {
    title: '结算画面',
    summary: '把本局胜方与高光精灵做成 MVP 结算页（推流页面4）。',
    steps: [
      {
        title: '载入当前对局胜方',
        body: '点它把「最近一个已分胜负小局」的胜方名字 + 阵容快照存进结算配置（只收最终形态精灵）。'
          + '**切换对局不会自动更新画面**，要重新载入才会变；胜方与已载入不一致时卡片上会给提示。',
        target: '[data-tour="mvp-load"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'mvp',
      },
      {
        title: '标记精灵与标签',
        body: '点当前对局胜者阵容里的精灵填入第一个空槽（再点移除）；每行可填标签（≤4 字）并标记 MVP（全页最多一个）。'
          + '没标记 MVP 时「显示」按钮是灰的——标签可以留空。',
        target: '[data-tour="mvp-slots"]',
        placement: 'top',
        kind: 'flow',
        demoView: 'mvp',
      },
      {
        title: '显示 / 关闭',
        body: '「显示 MVP 结算」会记住当前画面并切到页面4，「关闭」切回去。演出时先标记好再显示，避免把还没填完的画面播出去。',
        target: '[data-tour="mvp-control"]',
        placement: 'bottom',
        kind: 'step',
      },
    ],
  },
  history: {
    title: '比赛管理',
    summary: '所有对局的台账：筛选、标签、批量删除，以及推流选场与阵容录入。',
    steps: [
      {
        title: '推流选场（四张卡）',
        body: '比赛结果 / 战绩详情 / 比赛预告 / 晋级积分榜各一张卡，点「选择比赛」打开选场弹窗。'
          + '候选按系列赛「阶段 + 语义轮次」分组可整组勾选；结果页与预告页上限 9 场（3×3 网格），战绩详情不限。'
          + '选场只决定推流画面播什么，不影响登记。',
        target: '[data-tour="context-hint"]',
        placement: 'top',
        kind: 'flow',
        demoView: 'history',
      },
      {
        title: '阵容录入',
        body: '比赛还没开始时先把双方 6 只精灵填好：导出「一场两行」模板（精灵列带下拉）→ 线下填 → 导入。'
          + '只写比赛记录、不切当前比赛、不影响推流画面；已开赛 / 已完赛的场次自动跳过。',
        target: '[data-tour="match-lineup"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'history',
      },
      {
        title: '台账与筛选',
        body: '搜索选手名 / 赛事ID；紫色「系列赛」与蓝色「标签」两组筛选是叠加的。'
          + '筛选生效时上方会提示"显示 M / 共 N 场"——刚同步来的比赛可能被筛掉，别当成丢数据。',
        target: '[data-tour="history-table"]',
        placement: 'top',
        kind: 'step',
      },
      {
        title: '单项与批量操作',
        body: '展开一行可以「录入阵容」；「批量添加标签」给勾选场次加标签，「删除选中赛事」与「撤回最近删除」成对使用。'
          + '带系列赛归属的对局不能用删除按钮清掉，要走系列赛的「回退上一波」。',
        target: '[data-tour="history-actions"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'history',
      },
    ],
  },
  sync: {
    title: '数据同步',
    summary: '两台机（或云上）对齐数据：本机标识、导出/导入同步包、云同步。',
    steps: [
      {
        title: '本机标识',
        body: '两台机分别设成 A / B（1-2 位大写字母）。新比赛编号形如 `20260928_A001`，靠它区分来源、'
          + '也是系列赛"归谁编排"的判据。有在跑的比赛时改这个会被拒绝。',
        target: '[data-tour="sync-machine"]',
        placement: 'bottom',
        kind: 'step',
      },
      {
        title: '导出同步包',
        body: '把比赛 + 系列赛编排打包成一个 JSON（可选带上档案与头像）。赛前把它发给对端做「基线分发」。'
          + '注意：**同一场比赛不要在两台机分别创建**，导入时会合并成两条。',
        target: '[data-tour="sync-export"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'sync',
      },
      {
        title: '导入同步包',
        body: '选文件后先出预览：字段级 diff、逐条可勾选、冲突可分别选择保留哪一边，确认后才合并。'
          + '导入不会覆盖本机更新的记录（默认冲突按"较新者胜"）。',
        target: '[data-tour="sync-import"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'sync',
      },
      {
        title: '云同步',
        body: '填好 worker 地址 / 房间号 / 访问令牌 / 角色后：主控端负责「同步分发 / 检查回传 / 确认台 / 指派」，'
          + '分控端只有「同步最新 / 回传」。**除红点轮询外没有任何定时器会碰数据**，合并与推进全靠点击，出问题可复现。',
        target: '[data-tour="sync-cloud"]',
        placement: 'top',
        kind: 'step',
      },
    ],
  },
  profiles: {
    title: '信息录入',
    summary: '选手 / 战队档案：头像、宣言、常用精灵与排位排名，比赛与系列赛都从这里取人。',
    steps: [
      {
        title: '选手与战队',
        body: '两个页签共用同一张卡。选手的「常用精灵」是自由文本（选手介绍页按名字匹配图）；'
          + '头像按文件名批量上传（先本地匹配、对比预览、确认后才覆盖）。',
        target: '[data-tour="profiles-card"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'profiles',
      },
      {
        title: 'JSON 导入与批量删除',
        body: '「导入 JSON」只认白名单字段 name / rank / declaration / pets，导入前会预览、未命中的常用精灵逐条让你选。'
          + '多选后「删除所选」会连带删头像文件且不可撤销——删除参与中的选手会让该场无法登记赛果。',
        target: '[data-tour="profiles-card"]',
        placement: 'bottom',
        kind: 'step',
      },
    ],
  },
  page11: {
    title: '选手介绍',
    summary: '推流页面 11-13：左 / 右 / 对战三种画面的选手介绍数据与来源。',
    steps: [
      {
        title: '画面切换',
        body: '三种画面共用一张配置：左侧选手 / 右侧选手 / 对战页。点哪张卡就切到哪个画面（推流端不用动）。',
        target: '[data-tour="page11-switch"]',
        placement: 'bottom',
        kind: 'step',
      },
      {
        title: '介绍数据来源',
        body: '每侧可选「当前赛事」或「手动填写」：选当前赛事时名字取比赛、介绍按名字匹配「信息录入」；'
          + '手动填写留空的字段会回退到档案里按名字匹配的值。',
        target: '[data-tour="page11-data"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'page11',
      },
    ],
  },
  stats: {
    title: '数据统计',
    summary: '使用率 / 上场率排行、属性分布、系列赛阶段趋势，以及页面5 的显示口径。',
    steps: [
      {
        title: '统计口径',
        body: '按选手 / 系列赛 / 标签三个维度过滤，系列赛趋势按「阶段 · 语义轮次」拆桶。'
          + '这里的筛选只影响本页表格，不影响推流画面。',
        target: '[data-tour="stats-scope"]',
        placement: 'bottom',
        kind: 'step',
      },
      {
        title: '页面5 显示设置',
        body: '页面5标题、系列赛、选手三项控制的是**推流画面5的内容**，与上面的统计筛选相互独立——'
          + '想让画面只统计某一届，在这里选系列赛。',
        target: '[data-tour="stats-page5"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'stats',
      },
    ],
  },
  preview: {
    title: '页面预览',
    summary: '在后台里按页预览 1-14，核对版式与数据。',
    steps: [
      {
        title: '选择预览页面',
        body: '切上面这排就是换预览的推流页面（含页面4 MVP 结算）。'
          + 'page6/7/8 的内容要去「比赛管理」上方那排功能卡里选场推送，本页只负责看效果。',
        target: '[data-tour="preview-switch"]',
        placement: 'bottom',
        kind: 'step',
      },
      {
        title: '地址与投屏核对',
        body: '「本地部署地址 / 完整预览链接」就是 OBS 要填的那条；把第二个显示器接到这个地址，'
          + '可以一边改一边核对画面。推流页默认透明底，叠加在游戏画面上即可。',
        target: '[data-tour="preview-address"]',
        placement: 'bottom',
        kind: 'step',
      },
    ],
  },
  live: {
    title: '实时控制',
    summary: '演出时的操作台：开局、登记胜负、撤销恢复，以及左右实时面板的监控。',
    steps: [
      {
        title: '流程按钮',
        body: '「开始本次对局」→ 打完后「左侧赢了 / 右侧赢了」→ 需要回退就「撤回上一步」。'
          + '登记本局胜负时若画面在页面1-3，会自动切到胜者结算（页面10）停留一会儿再切回。',
        target: '[data-tour="live-control"]',
        placement: 'bottom',
        kind: 'flow',
        demoView: 'live',
      },
      {
        title: '左右实时面板',
        body: '这两块是当前比赛阵容的实时视图（血量 / 能量 / 阵亡）。改阵容仍去「赛事面板」或卡片里的「录入阵容」，'
          + '这里只做监控，避免误改正在推的画面。',
        target: '[data-tour="live-panels"]',
        placement: 'bottom',
        kind: 'step',
      },
    ],
  },
  about: {
    title: '关于项目',
    summary: '入口链接、许可与字体说明、数据来源。',
    steps: [
      {
        title: '常用入口与许可',
        body: '「项目链接」是后台 / 登录页 / 推流页的直达入口；本软件基于 MIT 许可，免费开源使用。'
          + '字体说明里写了哪些画面依赖本机安装的字体（没装会自动回退，不影响使用）。',
        target: '[data-tour="about-links"]',
        placement: 'bottom',
        kind: 'step',
      },
    ],
  },
};

/** 视图标题（顶栏按钮 Tooltip、抽屉头部用） */
export function viewGuideTitle(view: ViewKey): string {
  return VIEW_GUIDES[view]?.title ?? '使用说明';
}

/** 取某视图的步骤表（未知视图返回空数组，调用方据此不渲染入口） */
export function viewGuideSteps(view: ViewKey): readonly GuideStep[] {
  return VIEW_GUIDES[view]?.steps ?? [];
}

/** 该视图是否有说明（没有就不渲染「本页怎么用」按钮，避免点开是空的） */
export function hasViewGuide(view: ViewKey): boolean {
  return viewGuideSteps(view).length > 0;
}

/** 该视图的说明里是否提供模拟会话（决定抽屉要不要给「开模拟会话」按钮） */
export function viewGuideDemoView(view: ViewKey): ViewKey | null {
  return (viewGuideSteps(view).map((step) => step.demoView).find(Boolean) ?? null) as ViewKey | null;
}

/**
 * 就地指点用的步骤（「在界面上指出来」）：返回副本，不注入抽屉的行为。
 *
 * 与 `viewGuideSteps` 的区别只是"给谁用"——抽屉拿它渲染文字清单，
 * `GuideSpotlight` 拿它翻成 antd Tour 的 steps（高亮框 + 箭头指向 `target`）。
 * 文案仍然只有一份，改这里两处同时生效。
 *
 * 注意：给某一步 `target` 打锚点时**要打在"那排控件/那个按钮"上**，别打在整张大卡片上——
 * 高亮把整页圈进去等于没指（`GuideSpotlight` 会把量到超过视口 85% 的目标退回居中卡片）。
 */
export function buildViewTourSteps(view: ViewKey): GuideStep[] {
  return viewGuideSteps(view).map((step) => ({ ...step }));
}

/* ==================== 系列比赛：模拟会话里的分步实操 ==================== */

export interface SpotlightStep {
  id: string;
  title: string;
  body: string;
  /** 要指点/高亮的选择器（模拟会话里通常用 `data-demo-tour` 标在演示控件上） */
  target: string;
  /** 提示卡片相对目标的方位 */
  placement: GuidePlacement;
}

/**
 * 「系列比赛」的重点流程分步实操 —— **在模拟会话（假数据）里跑**。
 *
 * 为什么单独做一条：系列比赛是后台最复杂的一组操作，文字讲不清；而拿真数据做引导会一边讲
 * 一边改自己的赛事，风险不可接受。所以在假数据里带用户把主流程走一遍，走坏了刷新即恢复。
 *
 * **两条硬约束**（决定了下面的步骤与顺序）：
 * 1. **每一步的目标都要在当下屏幕上存在**，否则 GuideSpotlight 会退回居中卡片（= 指了个寂寞）。
 *    模拟会话固定停在**进行中**的「2026 秋季杯」，所以每一步都只依赖"打开这个页面就有的元素"，
 *    需要"换届 / 切波次视图 / 先开赛"的环节（抽签面板、配对确认台）**写进正文讲清楚**，
 *    不放进步骤里指 —— 那种步骤在自动化与真人手上都会时有时无。
 * 2. **别指整张大卡片**：宽或高超过视口 1.3 倍的目标会被当作"整页级"退化为居中卡片。
 */
export const TOURNAMENT_SPOTLIGHT_STEPS: readonly SpotlightStep[] = [
  {
    id: 'create',
    title: '第一步：创建一届',
    body: '点「＋ 创建系列赛」开向导：①名称 → ②勾选选手（人数只能 4/8/16/32/64，且必须来自「信息录入」档案）'
      + '→ ③阶段规则（阶段名 / BO / 配对方式 / 是否需确认；只剩 2 人的总决赛固定单败，可另安排季军赛）'
      + '→ ④抽签并「确认开赛」生成第 1 波。中途关掉可在列表点「继续配置」。'
      + '**开赛前那一段**（抽签面板与配对确认台）说明在第 6、7 步的正文里。',
    target: '[data-tour="tournament-create"]',
    placement: 'bottomRight',
  },
  {
    id: 'list',
    title: '第二步：系列赛列表',
    body: '每一行是一届：名称点进去看详情，「当前阶段 / 进度 / 状态」一眼看出打到哪了。'
      + '模拟数据里有两届——「2026 秋季杯」进行中（8进4 打完、半决赛在打）、'
      + '「春季热身赛」停在抽签（想练"抽签 + 配对确认台"就点开它，那届会显示「抽签与首波对阵」面板）。',
    target: '[data-demo-tour="tournament-list"]',
    placement: 'bottom',
  },
  {
    id: 'detail',
    title: '第三步：详情页看什么',
    body: '详情上方是阶段进度（8进4 → 总决赛），下面是「晋级图 / 波次列表」两种视图：'
      + '晋级图看整棵树与晋级关系（点选手行看单人链路、点卡片其他位置看整场链路、按住空白处可拖动平移）；'
      + '波次列表看每一波建场没有。赛果写回后两边都会自动更新。',
    target: '[data-tour="tournament-detail"]',
    placement: 'top',
  },
  {
    id: 'node-menu',
    title: '第四步：右键卡片登记（headless）',
    body: '右键任意对局卡片 = 直接打开该场的「对局面板」，可以连着登记好几场；'
      + '点卡片右上「⋯」出菜单：开始本局 / 左赢 / 右赢 / 撤回 / 查看阵容 / 弃权判负 / 进入管理。'
      + '**这些动作只写目标那场，不会切当前比赛、不会顶掉正在推流的画面**——登记别人的场次也不怕播错。',
    target: '[data-tour="tournament-node-card"]',
    placement: 'top',
  },
  {
    id: 'rollback',
    title: '第五步：回退上一波',
    body: '整波打错要重来时点它：删掉最后一波**未开始**的比赛并复位战绩。该波已经有结果时引擎会拒绝整波回退，'
      + '改走逐场「撤回」。季军赛是附加波次、不在晋级链上，重开半决赛时会被一起丢弃并按新落败者重建。',
    target: '[data-tour="tournament-rollback"]',
    placement: 'bottom',
  },
  {
    id: 'lineup',
    title: '第六步：阵容表批量导入导出',
    body: '「导出阵容模板」把待开始比赛的第 1 局导成「一场两行」的 Excel（精灵列带下拉，不用手打名字），'
      + '线下填完再「导入阵容」（也支持 CSV / 粘贴表格 / JSON）。只写比赛记录、不碰编排，只读副本也能用。'
      + '**开赛前的那段流程**：抽签阶段的届打开后是「抽签与首波对阵」——「重新抽签」换一组对阵（seed 可复现，'
      + '预览只读不建场），满意了才点「确认开赛」生成第 1 波；手动配对 / 需确认的波会停在「配对确认台」'
      + '（切到波次列表可见）：按桶填选手、可「🎲 桶内随机重排」或「📋 导入对阵表」，'
      + '「锁定并创建 N 场」才真正建场，锁定后就只能回退重来。',
    target: '[data-demo-tour="tournament-lineup"]',
    placement: 'bottom',
  },
  {
    id: 'waves',
    title: '第七步：波次列表',
    body: '切到这个 Segmented 就是「波次列表」：最新一波在最上面，每波一张卡显示配对方式与建场状态；'
      + 'draft 的波显示配对确认台，已锁定的波显示节点卡片（右键 = 开对局面板）。'
      + '「回退上一波」与详情工具栏的操作都以这里的波顺序为准。',
    target: '[data-demo-tour="tournament-waves-toggle"]',
    placement: 'bottom',
  },
];

/**
 * 「比赛管理」的重点流程分步实操（同样跑在模拟会话里）。
 *
 * 这一页重点就两块：**四张推流卡怎么选场** → **列表里展开一行看对局信息 / 录入阵容**，
 * 其余都是台账操作（筛选/标签/批量删除），文字讲得清，合成最后一步。
 *
 * 步骤里的目标都取"打开这页就必然存在"的元素（阵容录入卡在演示数据里不一定渲染，
 * 所以它的用法写进正文而不是指出来）。
 */
export const HISTORY_SPOTLIGHT_STEPS: readonly SpotlightStep[] = [
  {
    id: 'push-cards',
    title: '第一步：四张推流卡 = 四条画面的选场入口',
    body: '「推送比赛结果 / 战绩详情 / 比赛预告 / 晋级积分榜」各一张卡，分别对应推流画面 6 / 7 / 8 / 14。'
      + '点卡片上的「选择比赛」打开选场弹窗——**选场只决定那一路画面播什么，不影响比赛登记**。'
      + '四张卡是并列关系：想切哪路画面的内容就点对应那张，互不干扰。',
    target: '[data-demo-tour="history-push-row"]',
    placement: 'bottom',
  },
  {
    id: 'push-limit',
    title: '第二步：两个上限不一样',
    body: '比赛结果（6）与比赛预告（8）的画面是 3×3 卡片网格，所以**最多 9 场**；'
      + '战绩详情（7）是一屏 4 行 + 整屏滚动，**不限场数**（弹窗里按「已选 N 场 ≈ M 屏」估算规模）。'
      + '晋级积分榜不是逐场勾选：它一次性选中一个系列赛的某个阶段，榜单由服务端按赛果算——'
      + '所以它没有场数上限，只有阶段与翻页。',
    target: '[data-demo-tour="history-push-row"]',
    placement: 'bottom',
  },
  {
    id: 'table-row',
    title: '第三步：展开一行 = 逐局对局信息 + 录入阵容',
    body: '点表格行左侧的展开箭头：逐局显示双方 6v6 阵容与胜负（只列打过的小局 + 当前未开始那局）；'
      + '**「录入阵容」就在每一局那一行上**，只有"当前小局且待开始"时可用，其余局置灰并给出原因。'
      + '这里看到的是比赛自己的快照（与推流面板无关），所以翻别人的场次不会影响正在推的画面。'
      + '要整届批量填，用上方那张「阵容录入」卡导出/导入模板（一场两行的 Excel，精灵列带下拉）。',
    target: '[data-demo-tour="history-expand"]',
    placement: 'top',
  },
  {
    id: 'actions',
    title: '第四步：剩下的都是台账操作',
    body: '搜索选手名 / 赛事ID；紫色「系列赛」与蓝色「标签」两组筛选叠加生效（筛选生效时上方会提示'
      + '"显示 M / 共 N 场"，别把被筛掉的场次当成丢数据）；勾选后可批量加标签、删除，'
      + '删错了用「撤回最近删除」。带系列赛归属的对局不能用删除清掉，要走系列赛的「回退上一波」。',
    target: '[data-demo-tour="history-actions"]',
    placement: 'top',
  },
];

/**
 * 「赛事面板」的重点流程分步实操（跑在模拟会话里）。
 *
 * 这一页是一场**从选到打完**的主循环，所以顺序按真实操作走：
 * 选比赛 → 改/录阵容 → 开始本局 → 登记胜负 → 下一局（BO3 就重复"开始→登记"直到有人先到 2 胜）。
 * 模拟数据里「小明 vs 小红」正好是 BO3、第 1 局已打完、第 2 局进行中，所以这套循环能真演出来。
 */
export const ROSTER_SPOTLIGHT_STEPS: readonly SpotlightStep[] = [
  {
    id: 'pick-match',
    title: '第一步：选一场当「当前比赛」',
    body: '比赛列表每一行是一场比赛（按「赛事 · 阶段 · 轮次」分组）。点行尾的「选择」把它设为**当前比赛**——'
      + '这一步会覆写推流画面（比分栏 / 阵容页播的就是它），正在推别的场次时会先弹确认（可勾"不再提示"）。'
      + '右边那张卡是当前比赛的摘要与操作区：选手、BO 赛制、比分、状态。',
    target: '[data-tour="roster-match-list"]',
    placement: 'bottom',
  },
  {
    id: 'lineup',
    title: '第二步：改阵容 / 提前录入阵容',
    body: '「当前阵容」编的就是**当前比赛当前小局**的双方阵容：先在右侧点「点击选中」决定填哪一侧，'
      + '再从下面精灵池点选填入 6 个槽位，改完自动保存（600ms 防抖），推流画面立刻跟着变。'
      + '比赛还没开始时也在这里提前录（这时存的是赛事草稿，开局后才上推流页，所以别让画面空着开打）。',
    target: '[data-demo-tour="roster-lineup-card"]',
    placement: 'top',
  },
  {
    id: 'start',
    title: '第三步：开始本局',
    body: '「开始本次对局」把当前小局置为进行中。开局前建议先把双方阵容录完；'
      + '开局后仍可继续改阵容 / 血量，但比分与状态由后面的登记胜负推进。',
    target: '[data-demo-tour="current-match-actions"]',
    placement: 'top',
  },
  {
    id: 'register',
    title: '第四步：登记本局胜负',
    body: '本局打完点「左侧赢了」或「右侧赢了」：该侧比分 +1 并自动进入下一局。'
      + '登记**只作用于当前这场比赛**；如果推流画面当时停在页面1-3，会自动切到胜者结算（页面10）停留几秒再切回。'
      + '点错了用「撤回上一步」回退，「取消撤回」可以再恢复。',
    target: '[data-demo-tour="current-match-actions"]',
    placement: 'top',
  },
  {
    id: 'next-game',
    title: '第五步：下一局 —— BO3 就继续这套循环',
    body: '登记完胜负，同一块按钮区就进入下一局：**「开始本次对局」→「登记胜负」再来一遍**，'
      + '直到一方先拿到「半数 + 1」胜：BO3 = 2 胜、BO5 = 3 胜、BO1 = 1 胜。'
      + '达到后比赛自动完赛（状态变已结束、写入完成时间），这套循环结束——'
      + '接着回第一步「选择」下一场，或去「系列比赛」看赛果怎么写回对阵图。',
    target: '[data-demo-tour="current-match-actions"]',
    placement: 'top',
  },
];

/** 模拟会话里要跑的分步实操表（按视图） */
export const DEMO_SPOTLIGHTS: Partial<Record<ViewKey, readonly SpotlightStep[]>> = {
  roster: ROSTER_SPOTLIGHT_STEPS,
  tournament: TOURNAMENT_SPOTLIGHT_STEPS,
  history: HISTORY_SPOTLIGHT_STEPS,
};

/** 有"假数据分步实操"的视图（抽屉据此显示主入口；与 DEMO_SPOTLIGHTS 同源，别另写一份） */
export function hasDemoSpotlight(view: ViewKey): boolean {
  return Boolean(DEMO_SPOTLIGHTS[view]?.length);
}

/** 标签页关闭后推进到哪一步（刷新/重进模拟会话时从这继续） */
export const DEMO_TOUR_STEP_STORAGE_KEY = 'guide:roco-pvp:v1:demoTourStep';
