/*
This project uses Ant Design (https://ant.design), licensed under the MIT License.
*/
import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  ConfigProvider,
  Divider,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Layout,
  List,
  Menu,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Steps,
  Switch,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { io } from 'socket.io-client';

import { SOCKET_EVENTS } from '../../shared/events';
import type {
  AvatarCollectionState,
  CountdownPayload,
  CountdownState,
  MatchRecord,
  MatchStoreState,
  NextGamePayload,
  NextGameState,
  Page4PanelState,
  Page4SlotState,
  Page4State,
  Page6State,
  Page7State,
  Page8Background,
  Page8State,
  Page9State,
  Page11State,
  PanelState,
  PlayerProfile,
  ProfileStoreState,
  ScoreboardState,
  Page6Background,
  Page3SpriteSource,
  SlotState,
  SpriteRecord,
  StageConfig,
  StagePageKey,
  StageTransitionType,
  TeamProfile,
} from '../../shared/types';

import {
  DEFAULT_TAGS,
  EXCLUSIVE_FORM_FILTERS,
  STAGE_OPTIONS,
  STAGE_TRANSITION_OPTIONS,
  normalizeStagePage,
  normalizeStageTransition,
  theme,
} from './constants';
import { StageThumb } from './components/StageThumb';
import { SettingField } from './components/SettingField';
import { formatDateTime } from './lib/format';
import {
  buildHistoryBattleEntries,
  buildHistoryCsv,
  buildHistoryLineupEntries,
  buildHistoryTags,
  getLineupEntryBlockReason,
  getVisibleGames,
  LINEUP_ENTRY_BLOCK_TEXT,
} from './lib/history';
import {
  clampNumber,
  extractLiveConfigPanel,
  findConfigTargetIndex,
  getEnergyLevel,
  getHealthLevel,
  readNumberField,
  stringifyLiveConfig,
} from './lib/live';
import {
  buildProgressItems,
  getActiveMatch,
  getCurrentGame,
  getGameResultLabel,
  getGameStatusLabel,
  getMatchStatusColor,
  getMatchStatusLabel,
  getNoticeTagColor,
  getPendingDraftContext,
  summarizeSeriesForBestOf,
} from './lib/match';
import {
  buildPage4Request,
  buildPanelRequest,
  clonePage4Selected,
  cloneSelected,
  createDefaultSpriteFilterState,
  createEmptySlot,
  createPage4EmptySlot,
  createPage4PanelEditorState,
  createPanelEditorState,
  createSpriteFilterState,
  draftSlotsToSelected,
  page4PanelStateToSelected,
  panelStateToSelected,
} from './lib/panel';
import { buildPreviewUrl, getLocalAddressText, getPreviewPage } from './lib/preview';
import { copyText, requestJson, requestQuickFillMatches, uploadSingleFile } from './lib/request';
import { buildSpriteLookup } from './lib/sprite';
import { Page4DeathPanel } from './views/Page4DeathPanel';
import { Page4PanelEditor } from './views/Page4PanelEditor';
import { HistoryLineupEntryModal } from './views/HistoryLineupEntryModal';
import { RosterPanelEditor } from './views/RosterPanelEditor';
import { StatsView } from './views/StatsView';

import { type StatsMetricKey } from './lib/stats';

import rosterIcon from '../assets/ui/赛事面板.svg?raw';
import stageIcon from '../assets/ui/直播推流.svg?raw';
import liveIcon from '../assets/ui/实时控制.svg?raw';
import historyIcon from '../assets/ui/比赛历史.svg?raw';
import profilesIcon from '../assets/ui/信息录入.svg?raw';
import introIcon from '../assets/ui/选手介绍.svg?raw';
import statsIcon from '../assets/ui/数据统计.svg?raw';
import previewIcon from '../assets/ui/页面预览.svg?raw';
import panelsIcon from '../assets/ui/仅显阵容.svg?raw';
import aboutIcon from '../assets/ui/关于项目.svg?raw';
import brandLogoRaw from '../assets/ui/logo.svg?raw';
import type {
  CreateMatchValues,
  LiveField,
  MatchFormValues,
  NoticeState,
  Page4PanelEditorState,
  PanelEditorState,
  PanelSide,
  PlayerAvatarBatchResponse,
  PlayerProfileFormValues,
  PreviewSlotKey,
  SpriteFilterState,
  TeamProfileFormValues,
  ViewKey,
} from './types';

const { Header, Sider, Content } = Layout;
const { Title, Paragraph, Text, Link } = Typography;
const { TextArea } = Input;

/** 导航栏各视图对应的 SVG 图标（Assets 里提供的自定义图标），使用当前上下文颜色自适应 */
type NavIconName = 'roster' | 'stage' | 'live' | 'history' | 'profiles' | 'page11' | 'stats' | 'preview' | 'page4' | 'about';

/** 各导航视图对应的标题文案（与导航栏标签一致），顶部栏按当前视图显示 */
const VIEW_LABEL: Record<NavIconName, string> = {
  roster: '赛事面板',
  stage: '直播推流',
  live: '实时控制',
  history: '比赛历史',
  profiles: '信息录入',
  page11: '选手介绍',
  stats: '数据统计',
  preview: '页面预览',
  page4: '仅显阵容',
  about: '关于项目',
};

const NAV_ICONS: Record<NavIconName, string> = {
  roster: rosterIcon,
  stage: stageIcon,
  live: liveIcon,
  history: historyIcon,
  profiles: profilesIcon,
  page11: introIcon,
  stats: statsIcon,
  preview: previewIcon,
  page4: panelsIcon,
  about: aboutIcon,
};

function NavIcon({ name, size = 20 }: { name: NavIconName; size?: number }) {
  // 素材为黑色单色图标，替换成 currentColor 以随菜单文字/选中态自适应配色（memo 避免每次渲染重复正则替换）
  const html = useMemo(() => NAV_ICONS[name].replace(/\sfill="(?:black|#000|#000000)"/g, ' fill="currentColor"'), [name]);
  return (
    <span
      aria-hidden
      className="nav-icon"
      style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const CHANGELOG: Array<{ version: string; date: string; items: string[] }> = [
  {
    version: '1.5.7',
    date: '2026-09',
    items: [
      '修复阵容编辑器显示：切回待开始小局的赛事时改用该局草稿槽位回填编辑器（此前显示被清空的全局面板，造成“已登记阵容消失”的错觉，实际草稿一直保存于赛事记录）；推流页与悬浮窗行为不变，未开局阵容仍不上推流页',
      '待开始状态下编辑器缓冲区随草稿回填且切换赛事时自动取消未完成的防抖保存，避免误点精灵/快速填充把整份草稿覆盖为空或半份阵容',
    ],
  },
  {
    version: '1.5.6',
    date: '2026-09',
    items: [
      '推流页面切换入场动效：切到推流页面 1/2/3/5/6/7/8/9/10 时，页面内容区自上而下依次上浮淡入（fadeUp，--fx-delay 控制入场顺序）',
      '推流页面3 每次切入播放一次阵容入场动画（左右阵容卡交错入场，复用现有阵容出入场动画）',
    ],
  },
  {
    version: '1.5.5',
    date: '2026-08',
    items: [
      '直播推流画面切换卡片移除「黑场」选项（此前已保存的黑场状态仍有效，服务端与推流载体保持兼容）',
      '直播推流设置归一化：保存语义统一为即时保存（开关/选择/切换即点即存、文本输入失焦即存），移除「保存直播推流设置」「保存页面2设置」「保存对局推送设置」按钮（团队积分榜批量录入仍保留保存按钮）',
      '直播推流设置卡片重分组：页面3精灵图片/排位图标/战队标识合并为「推流页面3设置」，切换过渡效果与胜者结算停留时长合并为「画面切换行为」，选手介绍排位排名独立为「选手介绍显示」卡片',
      '直播推流设置卡片标题统一为 Card 标题，字段标签统一为 SettingField 组件（次级标签 + 说明 + 控件）',
      '新增推流页面7（对局推送）：按小局逐行展示双方选手、头像、排位排名与该局阵容（精灵卡复用页面2 样式，80×80），胜方一侧高亮 FFC65F 并显示胜/负图标',
      '页面7 布局：主标题（FCC34A 黄底、后台输入）+ 最多 4 行比赛信息（超出滚动显示最新 4 局，未选满以占位行补齐），每行左侧显示 GAME1-5 对局序号，底部温馨提示后台可编辑',
      '后台新增独立导航「对局推送」：选择单场比赛即时推送，可编辑主标题与温馨提示，并内嵌页面预览',
    ],
  },
  {
    version: '1.5.4',
    date: '2026-08',
    items: [
      '新增推流页面8（比赛预告）：复用页面6 布局，选手对局信息卡 w860×h88 两列网格（每列最多 6 场、第 7 场开启第二列），展示 vs + 双方选手名 + 排位排名图标（复用页面3 图标样式）',
      '后台「比赛历史」新增「预告」勾选：最多选择 12 场对局推送（可勾选待开始与进行中的对局，已完成对局不可选；选 0 场推送即清空页面），只取选手信息与排位排名',
      '「页面预览」新增推流页面8 预览与设置：可输入主标题/副标题、切换壁纸（图片1/图片2/自定义上传，自动缩放为 1920×1080）',
      '页面8 不加入直播推流设置（stage 可选画面），仅在页面预览中展示',
    ],
  },
  {
    version: '1.5.3',
    date: '2026-08',
    items: [
      '新增「下场对局」：推流页面3 右下角展示下一场待开始比赛（选手头像 + 名字）；直播推流可控制出现/关闭，并可设置开启后停留时长（默认 1 分钟，单位可切秒/分钟，到期自动隐藏）',
      '阵容悬浮窗中央新增圆形小按钮：点击弹出待开始比赛选择小窗，支持按选手名称搜索，确认后自动在推流页面3 显示',
      '修复下场对局头像：按所选比赛分别读取各自头像（按赛事隔离），未设置时回退默认头像',
      '下场对局停留时长默认单位为分钟，不再支持秒；直播推流页将「下场对局」与「切换过渡效果」设置位置互换',
      '直播推流设置：推流页面5统计口径、推流页面5/6标题与背景、下场对局 同行三列；切换过渡效果独立一行',
    ],
  },
  {
    version: '1.5.2',
    date: '2026-08',
    items: [
      '精灵名字字体改为 MiSans-Medium；推流页面3 选手名字使用 MiSans-Regular',
      'YouSheBiaoTiHei 改用系统已安装字体（@font-face local()），未安装时回退 MiSans',
      '新增推流页面6（比赛结果）：比赛历史中勾选已结束比赛（最多 8 场）并推送展示，支持赛事标签筛选；展示双方选手、比分与胜者高亮',
      '关于项目新增字体说明：注明使用 MiSans，并列出使用 YouSheBiaoTiHei 的页面与下载链接，引导用户自行安装',
      '等待页改名为推流页面7（公开免鉴权），其历史面板改为展示后台「比赛结果」推送选中的比赛',
    ],
  },
  {
    version: '1.5.1',
    date: '2026-08',
    items: [
      '新增桌面阵容悬浮窗：透明置顶小窗实时展示双方阵容，点击精灵可设置阵亡（HP=0）/复活，悬浮时显示关闭按钮',
      '右键精灵可按文件名基名匹配同系列多形态（如 岚鸟-1/-2）并一键切换，或打开更换精灵小窗；更换窗自动定位到精灵上方、更换后自动关闭、同时仅保留一个',
      '选手头像系统：头像按赛事隔离存储；赛事面板点击头像即可更换（64×64 圆形 + 1px 内描边）；创建赛事弹窗可设置选手头像；上传头像服务端等比缩放压缩为 128×128 PNG',
      '数据统计增强：属性分布胶囊化并显示属性图标；列头悬浮说明口径；前三名金/银/铜徽章；新增「胜场」字段；支持搜索选择选手与赛事标签；排行卡片加宽',
      '推流页：页面2赛事标题默认为空、未输入时推流页不显示；页面2阵容展示默认「仅头像展示」',
      '比赛列表比分胶囊化、列表高度显示 5 条；创建赛事弹窗比赛赛制标记为必填',
      '配置 antd 中文 locale，内置文本（如“点击排序”）本地化；Docker 登录密码改为 123',
      '修复：缩略图文件名零宽空格导致霹雳迪迪未使用缩略图；多形态列表显示精灵原始名称（如 卡瓦重（草地附近的样子））',
    ],
  },
  {
    version: '1.5.0',
    date: '',
    items: [
      '新增直播推流（导播台）：实时 iframe 缩略预览、页面切换、百叶窗/缩放冲击过渡动效、黑场/等待页',
      '推流页面 1 改为 page4 式阵容展示并使用赛事面板数据',
      '头像上传增加魔数校验，杜绝同源存储型 XSS',
      '内置 MiSans-Heavy 字体，修复精灵名字依赖系统字体导致变形',
    ],
  },
  {
    version: '1.4.0',
    date: '',
    items: [
      '管理后台重构：拆分 App.tsx，纯逻辑下沉 lib/、常量类型独立、视图组件化',
      '新增数据统计页：按赛事历史聚合精灵使用率/上场率/胜率/属性分布/登场趋势',
      '比赛历史支持 CSV 导出，阵容精灵名统一使用 sprites.json 精灵名称',
      '新增页面4（仅显阵容）与快速填充阵容功能',
    ],
  },
  {
    version: '1.3.0',
    date: '',
    items: [
      '赛事管理：创建赛事、BO 赛制、逐小局记录胜负、撤销/重做、历史与删除',
      '阵容编辑：左右两侧独立配置，调节血量/能量/透明度/饱和度，精灵筛选（属性/形态/最终形态）',
      '推流页面 2 / 3 与赛事标题、比分栏、头像设置',
      '新增后台账号密码登录验证与单会话管理',
    ],
  },
];

type HistorySortKey = 'updatedAt' | 'score' | 'bestOf' | 'status';

type HistorySortState = {
  key: HistorySortKey | null;
  order: 'asc' | 'desc' | null;
};

const UNCATEGORIZED_HISTORY_TAG = '__uncategorized__';

const HISTORY_STATUS_RANK: Record<MatchRecord['status'], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

const PAGE6_MAX_MATCHES = 8;
const PAGE8_MAX_MATCHES = 4;
/** 团队积分榜（page9）后台可录入的战队行数 */
const PAGE9_TEAM_COUNT = 4;

function HistorySortHeader({ text, sortKey, activeOrder, onSort }: {
  text: string;
  sortKey: HistorySortKey;
  activeOrder: 'asc' | 'desc' | null;
  onSort: (key: HistorySortKey) => void;
}) {
  return (
    <span
      className="history-sort-header"
      role="button"
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSort(sortKey);
        }
      }}
    >
      {text}
      <span className={`history-sort-triangle${activeOrder ? ` is-${activeOrder}` : ''}`}>
        {activeOrder === 'asc' ? '▲' : activeOrder === 'desc' ? '▼' : ''}
      </span>
    </span>
  );
}

function Dashboard() {
  const { message, modal } = App.useApp();
  const [view, setView] = useState<ViewKey>('roster');
  // 导航栏收起状态：收起后仅显示 SVG 图标
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState('');
  const [scoreboard, setScoreboard] = useState<ScoreboardState | null>(null);
  const [matchStore, setMatchStore] = useState<MatchStoreState>({
    activeMatchId: null,
    matches: [],
    undo: {
      canUndo: false,
      canRedo: false,
      canUndoDelete: false,
      deleteUndoCount: 0,
    },
    mtime: null,
  });
  const [avatars, setAvatars] = useState<AvatarCollectionState>({
    left: { side: 'left', exists: false },
    right: { side: 'right', exists: false },
  });
  const [createLeftAvatar, setCreateLeftAvatar] = useState<File | null>(null);
  const [createRightAvatar, setCreateRightAvatar] = useState<File | null>(null);
  const [createLeftAvatarUrl, setCreateLeftAvatarUrl] = useState<string | null>(null);
  const [createRightAvatarUrl, setCreateRightAvatarUrl] = useState<string | null>(null);
  const [panels, setPanels] = useState<Record<PanelSide, PanelEditorState>>({
    left: createPanelEditorState(),
    right: createPanelEditorState(),
  });
  const [page4Panels, setPage4Panels] = useState<Record<PanelSide, Page4PanelEditorState>>({
    left: createPage4PanelEditorState(),
    right: createPage4PanelEditorState(),
  });
  const [spriteFilters, setSpriteFilters] = useState<Record<PanelSide, SpriteFilterState>>({
    left: createDefaultSpriteFilterState(),
    right: createDefaultSpriteFilterState(),
  });
  const [page4SpriteFilters, setPage4SpriteFilters] = useState<Record<PanelSide, SpriteFilterState>>({
    left: createDefaultSpriteFilterState(),
    right: createDefaultSpriteFilterState(),
  });
  const [sprites, setSprites] = useState<SpriteRecord[]>([]);
  const [createMatchOpen, setCreateMatchOpen] = useState(false);
  // 快速创建比赛：从「信息录入」选手多选后随机配对生成对局
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreatePlayerNames, setQuickCreatePlayerNames] = useState<string[]>([]);
  const [quickCreateBestOf, setQuickCreateBestOf] = useState<number>(3);
  const [quickCreateTags, setQuickCreateTags] = useState<string[]>([]);
  const [quickCreateSaving, setQuickCreateSaving] = useState(false);
  const [quickCreateKeyword, setQuickCreateKeyword] = useState('');
  // 当前比赛战队修改：开一局创建时未选战队可在此补填
  const [teamEditOpen, setTeamEditOpen] = useState(false);
  const [teamEditSaving, setTeamEditSaving] = useState(false);
  const [teamEditForm] = Form.useForm<{ leftTeam?: string; rightTeam?: string }>();
  const [editingHistoryTagMatchId, setEditingHistoryTagMatchId] = useState<string | null>(null);
  const [editingHistoryTagValues, setEditingHistoryTagValues] = useState<string[]>([]);
  const [savingHistoryTagMatchId, setSavingHistoryTagMatchId] = useState<string | null>(null);
  const [selectedHistoryKeys, setSelectedHistoryKeys] = useState<React.Key[]>([]);
  const [expandedHistoryKeys, setExpandedHistoryKeys] = useState<React.Key[]>([]);
  const [historyTagFilter, setHistoryTagFilter] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState<HistorySortState>({ key: 'updatedAt', order: 'desc' });
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchTagValue, setBatchTagValue] = useState<string | null>(null);
  const [batchTagSaving, setBatchTagSaving] = useState(false);
  const [statsMetric, setStatsMetric] = useState<StatsMetricKey>('pickRate');
  const [statsPlayer, setStatsPlayer] = useState<string | null>(null);
  const [statsTag, setStatsTag] = useState<string | null>(null);
  const [statsSearch, setStatsSearch] = useState('');
  const [previewSlot, setPreviewSlot] = useState<PreviewSlotKey>('stage');
  const [previewScale, setPreviewScale] = useState(1);
  const [previewShellSize, setPreviewShellSize] = useState({ width: 960, height: 540 });
  const [stage, setStage] = useState<StageConfig | null>(null);
  const [stageSaving, setStageSaving] = useState(false);
  const [nextgame, setNextgame] = useState<NextGameState | null>(null);
  const [nextgameMatch, setNextgameMatch] = useState<MatchRecord | null>(null);
  const [nextgameSaving, setNextgameSaving] = useState(false);
  // 倒计时插件：服务端时钟偏差（serverNow - 本地时间）用于 running 时计算剩余时间
  const [countdown, setCountdown] = useState<CountdownState | null>(null);
  const [countdownSaving, setCountdownSaving] = useState(false);
  const countdownClockRef = useRef({ offset: 0 });
  // running 时每秒强制刷新以更新剩余时间显示
  const [, setCountdownTick] = useState(0);
  const [page6, setPage6] = useState<Page6State | null>(null);
  const [page5TitleDraft, setPage5TitleDraft] = useState('');
  const [page6TitleDraft, setPage6TitleDraft] = useState('');
  const [page6BackgroundDraft, setPage6BackgroundDraft] = useState<Page6Background>('image');
  const [page2EventTitleDraft, setPage2EventTitleDraft] = useState('');
  const [page6Draft, setPage6Draft] = useState<string[]>([]);
  const [page6Pushing, setPage6Pushing] = useState(false);
  const [page8, setPage8] = useState<Page8State | null>(null);
  const [page7, setPage7] = useState<Page7State | null>(null);
  const [page7TitleDraft, setPage7TitleDraft] = useState('');
  const [page7NoticeDraft, setPage7NoticeDraft] = useState('');
  const [page7Draft, setPage7Draft] = useState<string[]>([]);
  const [page7Pushing, setPage7Pushing] = useState(false);
  const [page8Draft, setPage8Draft] = useState<string[]>([]);
  const [page8TitleDraft, setPage8TitleDraft] = useState('');
  const [page8BackgroundDraft, setPage8BackgroundDraft] = useState<Page8Background>('image');
  const [page8Pushing, setPage8Pushing] = useState(false);
  const [page8Saving, setPage8Saving] = useState(false);
  const [page8WallpaperUploading, setPage8WallpaperUploading] = useState(false);
  const [page8SettingsNotice, setPage8SettingsNotice] = useState<NoticeState>(null);
  const [page9, setPage9] = useState<Page9State | null>(null);
  const [page11, setPage11] = useState<Page11State | null>(null);
  // 选手介绍手动填写草稿（左侧/右侧），source 切换时同步
  const [page11LeftDraft, setPage11LeftDraft] = useState({ source: 'match' as 'manual' | 'match', name: '', rank: '', declaration: '', pets: '' });
  const [page11RightDraft, setPage11RightDraft] = useState({ source: 'match' as 'manual' | 'match', name: '', rank: '', declaration: '', pets: '' });
  const [page11Saving, setPage11Saving] = useState(false);
  const [page11Notice, setPage11Notice] = useState<NoticeState>(null);
  const [page9TitleDraft, setPage9TitleDraft] = useState('');
  const [page9TeamsDraft, setPage9TeamsDraft] = useState<Array<{ name: string; r1: string; r2: string; r3: string }>>(
    () => Array.from({ length: PAGE9_TEAM_COUNT }, () => ({ name: '', r1: '', r2: '', r3: '' })),
  );
  const [page9Saving, setPage9Saving] = useState(false);
  const [page9SettingsNotice, setPage9SettingsNotice] = useState<NoticeState>(null);
  // === 信息录入（选手 / 战队） ===
  const [profiles, setProfiles] = useState<ProfileStoreState | null>(null);
  // 快速创建弹窗选手列表：按信息录入添加时间排序（档案 id 内嵌 base36 创建时间戳，先录者在前；
  // 数组顺序可能被手动编辑/导入/删后重录打乱，id 解析失败的按原数组顺序兜底排在末尾）
  const quickCreatePlayerList = useMemo(() => {
    const createdMs = (id: string): number => {
      const parsed = Number.parseInt(id.slice(1, 9), 36);
      return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };
    return (profiles?.players ?? [])
      .map((player, index) => ({ player, index }))
      .sort((a, b) => createdMs(a.player.id) - createdMs(b.player.id) || a.index - b.index)
      .map((item) => item.player);
  }, [profiles]);
  // 信息录入卡片内切换视图：players = 选手信息，teams = 战队信息
  const [profileTab, setProfileTab] = useState<'players' | 'teams'>('players');
  const [playerEditorOpen, setPlayerEditorOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<PlayerProfile | null>(null);
  const [playerAvatarFile, setPlayerAvatarFile] = useState<File | null>(null);
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState<string | null>(null);
  const [playerSaving, setPlayerSaving] = useState(false);
  const [teamEditorOpen, setTeamEditorOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamProfile | null>(null);
  const [teamLogoFile, setTeamLogoFile] = useState<File | null>(null);
  const [teamLogoUrl, setTeamLogoUrl] = useState<string | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  // 信息录入多选删除：记录选手/战队勾选的 id（跨 tab 独立）
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // 选手批量导入（JSON）：预览确认弹窗与解析结果
  const [playerImportOpen, setPlayerImportOpen] = useState(false);
  const [playerImportPreview, setPlayerImportPreview] = useState<Array<{ name: string; rank: string; declaration: string; pets: string }>>([]);
  const [playerImporting, setPlayerImporting] = useState(false);
  // 常用精灵未命中 pets.json 的兜底人工确认：review 列表 + 每条选中的候选
  const [playerImportReview, setPlayerImportReview] = useState<Array<{ name: string; input: string; candidates: Array<{ name: string; number: number | null }> }>>([]);
  const [playerImportReviewOpen, setPlayerImportReviewOpen] = useState(false);
  const [petReviewSelection, setPetReviewSelection] = useState<Record<number, string>>({});
  // 选手头像批量上传：先按文件名本地匹配出「原头像 vs 新头像」对比预览弹窗，确认后才覆盖上传
  const [avatarBatchUploading, setAvatarBatchUploading] = useState(false);
  const [avatarBatchConfirmOpen, setAvatarBatchConfirmOpen] = useState(false);
  const [avatarBatchPreview, setAvatarBatchPreview] = useState<Array<{ file: File; url: string; player: PlayerProfile }>>([]);
  const [avatarBatchSkipped, setAvatarBatchSkipped] = useState<string[]>([]);
  // 上传后后端回执中未命中/失败明细的结果提醒弹窗
  const [avatarBatchResult, setAvatarBatchResult] = useState<{ matched: number; unmatched: string[]; failed: Array<{ name: string; reason: string }> } | null>(null);
  const [avatarBatchResultOpen, setAvatarBatchResultOpen] = useState(false);
  const avatarBatchInputRef = useRef<HTMLInputElement | null>(null);
  const [rosterNotice, setRosterNotice] = useState<NoticeState>(null);
  const [page4Notice, setPage4Notice] = useState<NoticeState>(null);
  const [historyNotice, setHistoryNotice] = useState<NoticeState>(null);
  // 比赛历史「录入阵容」弹窗上下文：定位到某场比赛的当前小局（提前录入，不影响推流）
  const [lineupEntry, setLineupEntry] = useState<{ matchId: string; gameNumber: number } | null>(null);
  const [liveNotice, setLiveNotice] = useState<NoticeState>(null);
  const [liveFilePath, setLiveFilePath] = useState<string | null>(null);
  const [liveFileName, setLiveFileName] = useState('');
  const [liveConfigEnabled, setLiveConfigEnabled] = useState(false);
  const [liveConfigLastModified, setLiveConfigLastModified] = useState<number | null>(null);
  const [liveConfigLastContent, setLiveConfigLastContent] = useState('');
  const [matchForm] = Form.useForm<MatchFormValues>();
  const [createMatchForm] = Form.useForm<CreateMatchValues>();
  const [playerProfileForm] = Form.useForm<PlayerProfileFormValues>();
  const [teamProfileForm] = Form.useForm<TeamProfileFormValues>();

  const liveApplyRef = useRef(false);
  const liveWriteRef = useRef(false);
  const liveSaveTimerRef = useRef<number | null>(null);
  const livePollTimerRef = useRef<number | null>(null);
  const previewFrameShellRef = useRef<HTMLDivElement | null>(null);
  // 待开始小局草稿上下文（getPendingDraftContext）：pending 时编辑器显示源为赛事草稿、全局面板仅供推流页，
  // 由 applyServerState / loadInitialData 应用 store 时同步维护，避免渲染闭包读到旧状态
  const pendingDraftRef = useRef<ReturnType<typeof getPendingDraftContext>>(null);
  // 已回填过的草稿上下文键（matchId|gameNumber），防止保存回显等 store 更新反复覆写编辑中的缓冲区
  const draftBackfillKeyRef = useRef<string | null>(null);

  const spriteMap = buildSpriteLookup(sprites);
  // 「信息录入」选手常用精灵多选选项：去重后的精灵名（选手介绍页按名字匹配精灵图渲染）
  const playerPetOptions = Array.from(
    new Set(sprites.map((sprite) => sprite.displayName.trim()).filter(Boolean)),
  ).map((name) => ({ value: name, label: name }));
  // 选手常用精灵「两列精灵网格」：按 displayName 去重（同一精灵多形态只显示一项）、用于名字+头像点选
  const playerPetGridItems = useMemo(() => {
    const seen = new Set<string>();
    const items: SpriteRecord[] = [];
    for (const sprite of sprites) {
      const displayName = sprite.displayName.trim();
      if (!displayName || seen.has(displayName)) continue;
      seen.add(displayName);
      items.push(sprite);
    }
    return items;
  }, [sprites]);
  // 选手常用精灵网格：当前表单选中集 + 顶栏搜索词
  const playerPetEditorValue = (Form.useWatch('pets', playerProfileForm) ?? []) as string[];
  const playerPetEditorSelected = new Set(playerPetEditorValue);
  const [petEditorKeyword, setPetEditorKeyword] = useState('');
  const activeMatch = getActiveMatch(matchStore);
  const currentGame = getCurrentGame(activeMatch);
  const lineupLocked = activeMatch?.status === 'completed';
  const progress = buildProgressItems(activeMatch);
  const allHistoryTags = buildHistoryTags(matchStore.matches);
  const pendingMatches = matchStore.matches.filter((match) => match.status === 'pending');
  const allPlayers = Array.from(new Set(matchStore.matches.flatMap((match) => [
    match.leftPlayer,
    match.rightPlayer,
  ]).filter(Boolean)));
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const filteredMatches = matchStore.matches.filter((match) => {
    if (historyTagFilter === UNCATEGORIZED_HISTORY_TAG) {
      if ((match.tags ?? []).length > 0) {
        return false;
      }
    } else if (historyTagFilter && !(match.tags ?? []).includes(historyTagFilter)) {
      return false;
    }
    if (!normalizedHistorySearch) {
      return true;
    }
    return [
      String(match.leftPlayer || ''),
      String(match.rightPlayer || ''),
      String(match.id || ''),
    ].some((value) => value.toLowerCase().includes(normalizedHistorySearch));
  });
  const sortedMatches = [...filteredMatches].sort(compareHistoryMatches);
  // 「录入阵容」弹窗的当前上下文：从最新 store 里解析比赛与小局（socket 更新后自动跟随）
  const lineupEntryMatch = lineupEntry ? matchStore.matches.find((match) => match.id === lineupEntry.matchId) ?? null : null;
  const lineupEntryGame = lineupEntryMatch && lineupEntry
    ? lineupEntryMatch.games.find((game) => game.gameNumber === lineupEntry.gameNumber) ?? null
    : null;

  const deferredLeftSearch = useDeferredValue(panels.left.search);
  const deferredRightSearch = useDeferredValue(panels.right.search);
  const deferredPage4LeftSearch = useDeferredValue(page4Panels.left.search);
  const deferredPage4RightSearch = useDeferredValue(page4Panels.right.search);
  const spriteFormOptions = EXCLUSIVE_FORM_FILTERS.filter((form) => (
    sprites.some((sprite) => sprite.form.trim() === form)
  ));

  function setPanelState(side: PanelSide, nextState: PanelEditorState) {
    setPanels((prev) => ({
      ...prev,
      [side]: nextState,
    }));
  }

  function mutatePanel(side: PanelSide, updater: (panel: PanelEditorState) => PanelEditorState) {
    setPanels((prev) => ({
      ...prev,
      [side]: updater(prev[side]),
    }));
  }

  function mutateSpriteFilter(side: PanelSide, updater: (filter: SpriteFilterState) => SpriteFilterState) {
    setSpriteFilters((prev) => ({
      ...prev,
      [side]: updater(prev[side]),
    }));
  }

  function mutatePage4Panel(side: PanelSide, updater: (panel: Page4PanelEditorState) => Page4PanelEditorState) {
    setPage4Panels((prev) => ({
      ...prev,
      [side]: updater(prev[side]),
    }));
  }

  function mutatePage4SpriteFilter(side: PanelSide, updater: (filter: SpriteFilterState) => SpriteFilterState) {
    setPage4SpriteFilters((prev) => ({
      ...prev,
      [side]: updater(prev[side]),
    }));
  }

  function syncPanelFromApi(side: PanelSide, panel: PanelState | null | undefined) {
    setPanels((prev) => ({
      ...prev,
      [side]: {
        ...prev[side],
        // 待开始小局：全局面板按设计为空（未开局阵容不上推流页），保留编辑器缓冲区等待草稿回填，
        // 仅重置 dirty/saving 让防抖自动保存随上下文切换一并取消，避免旧编辑写入新赛事草稿
        selected: pendingDraftRef.current ? prev[side].selected : panelStateToSelected(panel),
        dirty: false,
        saving: false,
      },
    }));
  }

  function syncPage4PanelFromApi(side: PanelSide, panel: Page4PanelState | null | undefined) {
    setPage4Panels((prev) => ({
      ...prev,
      [side]: {
        ...prev[side],
        selected: page4PanelStateToSelected(panel),
        dirty: false,
        saving: false,
      },
    }));
  }

  function applyServerState(payload: {
    scoreboard?: ScoreboardState;
    store?: MatchStoreState;
    avatars?: AvatarCollectionState;
    panels?: PanelState[];
    panel?: PanelState;
    page4?: Page4State;
    page4Panel?: Page4PanelState;
    stage?: StageConfig;
    page6?: Page6State;
    page7?: Page7State;
    page8?: Page8State;
    page9?: Page9State;
    page11?: Page11State;
    nextgame?: NextGamePayload;
    profiles?: ProfileStoreState;
    countdown?: CountdownPayload;
  }) {
    startTransition(() => {
      if (payload.scoreboard) {
        setScoreboard(payload.scoreboard);
      }
      if (payload.store) {
        setMatchStore(payload.store);
        // 先于同批 panels 处理维护草稿上下文：snapshot/select 响应里 store 与空 panels 同批到达时，
        // syncPanelFromApi 需据此判断当前是否 pending（pending 时全局面板不覆写编辑器）
        pendingDraftRef.current = getPendingDraftContext(payload.store);
      }
      if (payload.avatars) {
        setAvatars(payload.avatars);
      }
      if (payload.nextgame) {
        setNextgame(payload.nextgame.state);
        setNextgameMatch(payload.nextgame.match ?? null);
      }
      if (payload.countdown) {
        countdownClockRef.current.offset = payload.countdown.serverNow - Date.now();
        setCountdown(payload.countdown.state);
      }
      if (Array.isArray(payload.panels)) {
        payload.panels.forEach((panel) => {
          if (panel.position === 'left' || panel.position === 'right') {
            syncPanelFromApi(panel.position, panel);
          }
        });
      }
      if (payload.panel && (payload.panel.position === 'left' || payload.panel.position === 'right')) {
        syncPanelFromApi(payload.panel.position, payload.panel);
      }
      if (payload.page4) {
        payload.page4.panels.forEach((panel) => {
          if (panel.position === 'left' || panel.position === 'right') {
            syncPage4PanelFromApi(panel.position, panel);
          }
        });
      }
      if (payload.page4Panel && (payload.page4Panel.position === 'left' || payload.page4Panel.position === 'right')) {
        syncPage4PanelFromApi(payload.page4Panel.position, payload.page4Panel);
      }
      if (payload.stage) {
        setStage(payload.stage);
      }
      if (payload.page6) {
        setPage6(payload.page6);
      }
      if (payload.page7) {
        setPage7(payload.page7);
      }
      if (payload.page8) {
        setPage8(payload.page8);
      }
      if (payload.page9) {
        setPage9(payload.page9);
      }
      if (payload.page11) {
        setPage11(payload.page11);
      }
      if (payload.profiles) {
        setProfiles(payload.profiles);
      }
    });
  }

  async function loadInitialData(showToast = false) {
    setRefreshing(true);
    setPageError('');

    try {
      const [auth, nextScoreboard, nextMatches, nextAvatars, nextPanels, nextPage4, nextSprites, nextStage, nextPage6, nextPage7, nextPage8, nextPage9, nextPage11, nextNextgame, nextProfiles, nextCountdown] = await Promise.all([
        requestJson<{ authenticated: boolean }>('/api/auth/check'),
        requestJson<ScoreboardState>('/api/scoreboard'),
        requestJson<MatchStoreState>('/api/matches'),
        requestJson<AvatarCollectionState>('/api/avatars'),
        requestJson<{ panels: [PanelState, PanelState] }>('/api/panels'),
        requestJson<Page4State>('/api/page4'),
        requestJson<{ sprites: SpriteRecord[] }>('/api/sprites'),
        requestJson<StageConfig>('/api/stage'),
        requestJson<{ state: Page6State }>('/api/page6'),
        requestJson<{ state: Page7State }>('/api/page7'),
        requestJson<{ state: Page8State }>('/api/page8'),
        requestJson<{ state: Page9State }>('/api/page9'),
        requestJson<{ state: Page11State }>('/api/page11'),
        requestJson<NextGamePayload>('/api/nextgame'),
        requestJson<ProfileStoreState>('/api/profiles'),
        requestJson<CountdownPayload>('/api/countdown'),
      ]);

      if (!auth.authenticated) {
        window.location.href = '/login.html';
        return;
      }

      startTransition(() => {
        setScoreboard(nextScoreboard);
        setMatchStore(nextMatches);
        setAvatars(nextAvatars);
        setSprites(nextSprites.sprites);
        setStage(nextStage);
        setPage6(nextPage6.state);
        setPage6Draft(nextPage6.state.matchIds);
        setPage7(nextPage7.state);
        setPage7Draft(nextPage7.state.matchIds);
        setPage8(nextPage8.state);
        setPage8Draft(nextPage8.state.matchIds);
        setPage9(nextPage9.state);
        setPage11(nextPage11.state);
        setProfiles(nextProfiles);
        setNextgame(nextNextgame.state);
        setNextgameMatch(nextNextgame.match ?? null);
        // 与 applyServerState 一致：先维护草稿上下文再同步面板，避免 pending 时全局面板覆写编辑器
        pendingDraftRef.current = getPendingDraftContext(nextMatches);
        syncPanelFromApi('left', nextPanels.panels[0]);
        syncPanelFromApi('right', nextPanels.panels[1]);
        syncPage4PanelFromApi('left', nextPage4.panels[0]);
        syncPage4PanelFromApi('right', nextPage4.panels[1]);
      });

      if (showToast) {
        message.success('后台数据已刷新');
      }
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : String(error);
      if (nextMessage.includes('authenticated') || nextMessage.includes('请先登录')) {
        window.location.href = '/login.html';
        return;
      }
      setPageError(nextMessage);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadInitialData();
  }, []);

  // 倒计时进行中：本地节拍刷新后台的剩余时间显示
  useEffect(() => {
    if (!countdown?.running) {
      return;
    }
    const timer = window.setInterval(() => {
      setCountdownTick((value) => value + 1);
    }, 500);
    return () => window.clearInterval(timer);
  }, [countdown?.running]);

  // 切换/回显到待开始小局时，用赛事草稿槽位回填阵容编辑器：
  // pending 状态下全局面板被服务端清空（未开局阵容不上推流页），此前编辑器直接显示空面板，
  // 造成“已登记阵容消失”的错觉，且空缓冲区被误编辑后自动保存会覆盖整份草稿
  useEffect(() => {
    const draft = pendingDraftRef.current;
    if (!draft) {
      // 离开 pending 上下文（开局/完赛/切走）时重置键，下次回到 pending 会重新回填
      draftBackfillKeyRef.current = null;
      return;
    }
    const key = `${draft.matchId}|${draft.gameNumber}`;
    if (draftBackfillKeyRef.current === key) {
      return;
    }
    // 精灵库未加载完成（如 socket 快照先于初始加载到达）先不回填也不记键，待加载后重试
    if (!sprites.length) {
      return;
    }
    draftBackfillKeyRef.current = key;
    const leftSelected = draftSlotsToSelected(draft.leftSlots, spriteMap);
    const rightSelected = draftSlotsToSelected(draft.rightSlots, spriteMap);
    setPanels((prev) => ({
      left: { ...prev.left, selected: leftSelected, dirty: false, saving: false },
      right: { ...prev.right, selected: rightSelected, dirty: false, saving: false },
    }));
  }, [matchStore, sprites]);

  useEffect(() => {
    if (!activeMatch) {
      matchForm.resetFields();
      return;
    }

    matchForm.setFieldsValue({
      leftPlayer: activeMatch.leftPlayer,
      rightPlayer: activeMatch.rightPlayer,
      leftRank: activeMatch.leftRank,
      rightRank: activeMatch.rightRank,
      bestOf: activeMatch.bestOf,
    });
  }, [activeMatch, matchForm]);

  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
    });

    socket.on(SOCKET_EVENTS.snapshot, (payload) => {
      applyServerState(payload ?? {});
    });

    socket.on(SOCKET_EVENTS.panelUpdate, (payload) => {
      if (payload?.panel) {
        applyServerState({ panel: payload.panel });
      }
    });

    socket.on(SOCKET_EVENTS.page4Update, (payload) => {
      if (payload?.page4) {
        applyServerState({ page4: payload.page4 });
      }
    });

    socket.on(SOCKET_EVENTS.scoreboardUpdate, (payload) => {
      if (payload?.scoreboard) {
        applyServerState({ scoreboard: payload.scoreboard });
      }
    });

    socket.on(SOCKET_EVENTS.matchesUpdate, (payload) => {
      if (payload?.store) {
        applyServerState({ store: payload.store });
      }
    });

    socket.on(SOCKET_EVENTS.avatarUpdate, (payload) => {
      if (payload?.avatars) {
        applyServerState({ avatars: payload.avatars });
      }
    });

    socket.on(SOCKET_EVENTS.stageUpdate, (payload) => {
      if (payload?.stage) {
        applyServerState({ stage: payload.stage });
      }
    });

    socket.on(SOCKET_EVENTS.page6Update, (payload) => {
      if (payload?.state) {
        applyServerState({ page6: payload.state });
      }
    });

    socket.on(SOCKET_EVENTS.page7Update, (payload) => {
      if (payload?.state) {
        applyServerState({ page7: payload.state });
      }
    });

    socket.on(SOCKET_EVENTS.page8Update, (payload) => {
      if (payload?.state) {
        applyServerState({ page8: payload.state });
      }
    });

    socket.on(SOCKET_EVENTS.page9Update, (payload) => {
      if (payload?.state) {
        applyServerState({ page9: payload.state });
      }
    });

    socket.on(SOCKET_EVENTS.page11Update, (payload) => {
      if (payload?.state) {
        applyServerState({ page11: payload.state });
      }
    });

    socket.on(SOCKET_EVENTS.nextgameUpdate, (payload) => {
      if (payload?.state) {
        applyServerState({ nextgame: payload });
      }
    });

    socket.on(SOCKET_EVENTS.countdownUpdate, (payload) => {
      if (payload?.state) {
        applyServerState({ countdown: payload });
      }
    });

    socket.on(SOCKET_EVENTS.profilesUpdate, (payload) => {
      if (payload?.profiles) {
        applyServerState({ profiles: payload.profiles });
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    // saving 期间跳过调度，避免保存触发的 saving/dirty 状态变化导致重复 POST
    if (!panels.left.autoSaveEnabled || !panels.left.dirty || panels.left.saving) {
      return;
    }
    const timer = window.setTimeout(() => {
      void savePanel('left', true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [panels.left]);

  useEffect(() => {
    if (!panels.right.autoSaveEnabled || !panels.right.dirty || panels.right.saving) {
      return;
    }
    const timer = window.setTimeout(() => {
      void savePanel('right', true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [panels.right]);

  useEffect(() => {
    if (!page4Panels.left.autoSaveEnabled || !page4Panels.left.dirty || page4Panels.left.saving) {
      return;
    }
    const timer = window.setTimeout(() => {
      void savePage4Panel('left', true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [page4Panels.left]);

  useEffect(() => {
    if (!page4Panels.right.autoSaveEnabled || !page4Panels.right.dirty || page4Panels.right.saving) {
      return;
    }
    const timer = window.setTimeout(() => {
      void savePage4Panel('right', true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [page4Panels.right]);

  async function savePanel(side: PanelSide, silent = false) {
    if (lineupLocked) {
      const nextText = '当前赛事已完赛，不能编辑阵容';
      setRosterNotice({ tone: 'warning', text: nextText });
      if (!silent) {
        message.warning(nextText);
      }
      return;
    }

    const current = panels[side];
    mutatePanel(side, (panel) => ({ ...panel, saving: true }));
    try {
      const data = await requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>(`/api/panels/${side}`, {
        method: 'POST',
        json: {
          selected: buildPanelRequest(current.selected),
        },
      });
      applyServerState({
        panel: data.panel,
        store: data.store,
      });
      mutatePanel(side, (panel) => ({ ...panel, dirty: false, saving: false }));
      if (!silent) {
        const nextActiveMatch = data.store ? getActiveMatch(data.store) : activeMatch;
        const nextCurrentGame = getCurrentGame(nextActiveMatch);
        const nextText = nextCurrentGame?.status === 'in_progress'
          ? `${side === 'left' ? '左侧' : '右侧'}阵容已同步到当前对局与推流页面`
          : `${side === 'left' ? '左侧' : '右侧'}阵容草稿已保存，等待开始本局后同步前台`;
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
      }
    } catch (error) {
      mutatePanel(side, (panel) => ({ ...panel, saving: false }));
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function deletePanel(side: PanelSide) {
    try {
      const data = await requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>(`/api/panels/${side}`, {
        method: 'DELETE',
      });
      applyServerState({
        panel: data.panel,
        store: data.store,
      });
      mutatePanel(side, (panel) => ({
        ...panel,
        selected: Array.from({ length: 6 }, (_, index) => createEmptySlot(index)),
        quickFillMatches: [],
        dirty: false,
        activeSlot: 0,
      }));
      message.success(`${side === 'left' ? '左侧' : '右侧'}配置已删除`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function runQuickFill(side: PanelSide) {
    const text = panels[side].quickFillInput.trim();
    if (!text) {
      message.warning('先输入要匹配的精灵名称');
      return;
    }

    try {
      const matches = await requestQuickFillMatches(text);

      const nextSelected = Array.from({ length: 6 }, (_, index) => createEmptySlot(index));
      matches.forEach((match) => {
        if (match.slot >= 0 && match.slot < 6 && match.sprite) {
          nextSelected[match.slot] = {
            ...nextSelected[match.slot],
            sprite: match.sprite,
          };
        }
      });

      mutatePanel(side, (panel) => ({
        ...panel,
        selected: nextSelected,
        quickFillMatches: matches,
        dirty: true,
      }));
      message.success(`${side === 'left' ? '左侧' : '右侧'}快速填充已应用到本地草稿`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function chooseQuickFillCandidate(side: PanelSide, slotIndex: number, sprite: SpriteRecord) {
    mutatePanel(side, (panel) => {
      const selected = cloneSelected(panel.selected);
      selected[slotIndex] = {
        ...selected[slotIndex],
        sprite,
      };
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function updateSlot(side: PanelSide, updater: (slot: SlotState) => SlotState) {
    mutatePanel(side, (panel) => {
      const selected = cloneSelected(panel.selected);
      const current = selected[panel.activeSlot] ?? createEmptySlot(panel.activeSlot);
      selected[panel.activeSlot] = updater(current);
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function clearCurrentSlot(side: PanelSide) {
    mutatePanel(side, (panel) => {
      const selected = cloneSelected(panel.selected);
      selected[panel.activeSlot] = createEmptySlot(panel.activeSlot);
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function clearPanel(side: PanelSide) {
    mutatePanel(side, (panel) => ({
      ...panel,
      selected: Array.from({ length: 6 }, (_, index) => createEmptySlot(index)),
      quickFillMatches: [],
      dirty: true,
    }));
  }

  function applySprite(side: PanelSide, sprite: SpriteRecord) {
    updateSlot(side, (slot) => ({
      ...slot,
      sprite,
    }));
  }

  function toggleAttributeFilter(side: PanelSide, attribute: string) {
    const current = spriteFilters[side].selectedAttributes;
    const isActive = current.includes(attribute);

    if (!isActive && current.length >= 2) {
      message.warning('精灵属性最多只能选择两个');
      return;
    }

    mutateSpriteFilter(side, (filter) => ({
      ...filter,
      selectedAttributes: isActive
        ? filter.selectedAttributes.filter((item) => item !== attribute)
        : [...filter.selectedAttributes, attribute],
    }));
  }

  function toggleFormFilter(side: PanelSide, form: string) {
    mutateSpriteFilter(side, (filter) => {
      if (filter.selectedFinalForm) {
        return filter;
      }

      return {
        ...filter,
        selectedForms: filter.selectedForms.includes(form)
          ? filter.selectedForms.filter((item) => item !== form)
          : [...filter.selectedForms, form],
      };
    });
  }

  function toggleFinalFormFilter(side: PanelSide) {
    mutateSpriteFilter(side, (filter) => ({
      ...filter,
      selectedFinalForm: !filter.selectedFinalForm,
      selectedForms: filter.selectedFinalForm ? filter.selectedForms : [],
    }));
  }

  function clearSpriteFilters(side: PanelSide) {
    setSpriteFilters((prev) => ({
      ...prev,
      [side]: createSpriteFilterState(),
    }));
  }

  async function savePage4Panel(side: PanelSide, silent = false) {
    const current = page4Panels[side];
    mutatePage4Panel(side, (panel) => ({ ...panel, saving: true }));

    try {
      const data = await requestJson<{ success: boolean; page4?: Page4State }>(`/api/page4/${side}`, {
        method: 'POST',
        json: {
          selected: buildPage4Request(current.selected),
        },
      });

      applyServerState({
        page4: data.page4,
      });
      mutatePage4Panel(side, (panel) => ({ ...panel, dirty: false, saving: false }));

      if (!silent) {
        const nextText = `${side === 'left' ? '左侧' : '右侧'} 仅显阵容已保存`;
        setPage4Notice({ tone: 'success', text: nextText });
        message.success(nextText);
      }
    } catch (error) {
      mutatePage4Panel(side, (panel) => ({ ...panel, saving: false }));
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function updatePage4Slot(side: PanelSide, updater: (slot: Page4SlotState) => Page4SlotState) {
    mutatePage4Panel(side, (panel) => {
      const selected = clonePage4Selected(panel.selected);
      const current = selected[panel.activeSlot] ?? createPage4EmptySlot(panel.activeSlot);
      selected[panel.activeSlot] = updater(current);
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function clearPage4CurrentSlot(side: PanelSide) {
    mutatePage4Panel(side, (panel) => {
      const selected = clonePage4Selected(panel.selected);
      selected[panel.activeSlot] = createPage4EmptySlot(panel.activeSlot);
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function clearPage4Panel(side: PanelSide) {
    mutatePage4Panel(side, (panel) => ({
      ...panel,
      selected: Array.from({ length: 6 }, (_, index) => createPage4EmptySlot(index)),
      quickFillMatches: [],
      dirty: true,
    }));
  }

  async function runPage4QuickFill(side: PanelSide) {
    const text = page4Panels[side].quickFillInput.trim();
    if (!text) {
      message.warning('请先输入要匹配的精灵名称');
      return;
    }

    try {
      const matches = await requestQuickFillMatches(text);
      const nextSelected = Array.from({ length: 6 }, (_, index) => createPage4EmptySlot(index));
      matches.forEach((match) => {
        if (match.slot >= 0 && match.slot < 6 && match.sprite) {
          nextSelected[match.slot] = {
            ...nextSelected[match.slot],
            sprite: match.sprite,
          };
        }
      });

      mutatePage4Panel(side, (panel) => ({
        ...panel,
        selected: nextSelected,
        quickFillMatches: matches,
        dirty: true,
      }));
      message.success(`${side === 'left' ? '左侧' : '右侧'} 仅显阵容快速填充已应用到本地草稿`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function choosePage4QuickFillCandidate(side: PanelSide, slotIndex: number, sprite: SpriteRecord) {
    mutatePage4Panel(side, (panel) => {
      const selected = clonePage4Selected(panel.selected);
      selected[slotIndex] = {
        ...selected[slotIndex],
        sprite,
      };
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function updatePage4SlotAt(side: PanelSide, slotIndex: number, updater: (slot: Page4SlotState) => Page4SlotState) {
    mutatePage4Panel(side, (panel) => {
      const selected = clonePage4Selected(panel.selected);
      const current = selected[slotIndex] ?? createPage4EmptySlot(slotIndex);
      selected[slotIndex] = updater(current);
      return {
        ...panel,
        selected,
        dirty: true,
      };
    });
  }

  function applyPage4Sprite(side: PanelSide, sprite: SpriteRecord) {
    updatePage4Slot(side, (slot) => ({
      ...slot,
      sprite,
    }));
  }

  function togglePage4DeadAt(side: PanelSide, slotIndex: number) {
    updatePage4SlotAt(side, slotIndex, (slot) => (slot.sprite ? {
      ...slot,
      isDead: !slot.isDead,
    } : slot));
  }

  function togglePage4AttributeFilter(side: PanelSide, attribute: string) {
    const current = page4SpriteFilters[side].selectedAttributes;
    const isActive = current.includes(attribute);

    if (!isActive && current.length >= 2) {
      message.warning('精灵属性最多只能选择两个');
      return;
    }

    mutatePage4SpriteFilter(side, (filter) => ({
      ...filter,
      selectedAttributes: isActive
        ? filter.selectedAttributes.filter((item) => item !== attribute)
        : [...filter.selectedAttributes, attribute],
    }));
  }

  function togglePage4FormFilter(side: PanelSide, form: string) {
    mutatePage4SpriteFilter(side, (filter) => {
      if (filter.selectedFinalForm) {
        return filter;
      }

      return {
        ...filter,
        selectedForms: filter.selectedForms.includes(form)
          ? filter.selectedForms.filter((item) => item !== form)
          : [...filter.selectedForms, form],
      };
    });
  }

  function togglePage4FinalFormFilter(side: PanelSide) {
    mutatePage4SpriteFilter(side, (filter) => ({
      ...filter,
      selectedFinalForm: !filter.selectedFinalForm,
      selectedForms: filter.selectedFinalForm ? filter.selectedForms : [],
    }));
  }

  function clearPage4SpriteFilters(side: PanelSide) {
    setPage4SpriteFilters((prev) => ({
      ...prev,
      [side]: createSpriteFilterState(),
    }));
  }

  async function saveMatchMeta(values: MatchFormValues) {
    if (!activeMatch) {
      return;
    }

    const nextBestOf = Number(values.bestOf) || activeMatch.bestOf;
    const bestOfChanged = nextBestOf !== activeMatch.bestOf;
    const projection = bestOfChanged ? summarizeSeriesForBestOf(activeMatch, nextBestOf) : null;
    const endsMatchAfterBestOfChange = Boolean(projection?.winner && activeMatch.status !== 'completed');

    const save = async () => {
      try {
        const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState }>(`/api/matches/${encodeURIComponent(activeMatch.id)}`, {
          method: 'PATCH',
          json: values,
        });
        applyServerState({
          store: data.store,
          scoreboard: data.scoreboard,
        });

        if (endsMatchAfterBestOfChange && projection?.winner) {
          const winnerText = projection.winner === 'left'
            ? (values.leftPlayer || '左侧')
            : (values.rightPlayer || '右侧');
          const nextText = `BO 已改为 BO${nextBestOf}，本场比赛按已录入结果直接结束，${winnerText} 以 ${projection.leftScore}:${projection.rightScore} 获胜`;
          setRosterNotice({ tone: 'warning', text: nextText });
          message.success(nextText);
          return;
        }

        if (bestOfChanged) {
          const nextText = `比赛信息已保存，BO 已更新为 BO${nextBestOf}`;
          setRosterNotice({ tone: 'success', text: nextText });
          message.success(nextText);
          return;
        }

        setRosterNotice({ tone: 'success', text: '比赛信息已保存' });
        message.success('比赛信息已保存');
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    };

    if (endsMatchAfterBestOfChange && projection?.winner) {
      const winnerText = projection.winner === 'left'
        ? (values.leftPlayer || '左侧')
        : (values.rightPlayer || '右侧');
      modal.confirm({
        title: '修改 BO 会直接结束本场比赛',
        content: `当前已录入的战绩在 BO${nextBestOf} 下已经足以分出胜负。继续后会立即结束本场比赛，并按前 ${projection.completedGameCount} 局结算为 ${winnerText} ${projection.leftScore}:${projection.rightScore} 获胜。`,
        okText: '确认并结束比赛',
        cancelText: '取消',
        onOk: save,
      });
      return;
    }

    await save();
  }

  async function selectMatch(matchId: string) {
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState; panels?: PanelState[] }>(`/api/matches/${encodeURIComponent(matchId)}/select`, {
        method: 'POST',
      });
      applyServerState({
        store: data.store,
        scoreboard: data.scoreboard,
        panels: data.panels,
      });
      const nextAvatars = await requestJson<AvatarCollectionState>('/api/avatars');
      setAvatars(nextAvatars);
      setView('roster');
      const nextStore = data.store ?? matchStore;
      const nextActiveMatch = getActiveMatch(nextStore);
      const nextText = nextActiveMatch?.status === 'completed'
        ? `已切换到赛事 ${matchId}，比赛已完成，阵容不可编辑`
        : `已切换到赛事 ${matchId}`;
      setRosterNotice({ tone: nextActiveMatch?.status === 'completed' ? 'warning' : 'success', text: nextText });
      if (nextActiveMatch?.status === 'completed') {
        message.warning(nextText);
      } else {
        message.success(nextText);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 统一提交创建比赛请求并应用服务端状态（创建/快速创建共用） */
  async function postCreateMatch(values: CreateMatchValues) {
    // 所属战队：按名称匹配「信息录入」战队，命中则复用其 id（推流页可展示战队 logo）
    const teamList = profiles?.teams ?? [];
    const leftTeamName = (values.leftTeam ?? '').trim();
    const rightTeamName = (values.rightTeam ?? '').trim();
    const leftTeam = leftTeamName ? teamList.find((team) => team.name === leftTeamName) : undefined;
    const rightTeam = rightTeamName ? teamList.find((team) => team.name === rightTeamName) : undefined;
    const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState; panels?: PanelState[] }>('/api/matches', {
      method: 'POST',
      json: {
        ...values,
        leftTeamName,
        leftTeamId: leftTeam?.id ?? '',
        rightTeamName,
        rightTeamId: rightTeam?.id ?? '',
        tags: values.tags ?? [],
      },
    });
    applyServerState({
      store: data.store,
      scoreboard: data.scoreboard,
      panels: data.panels,
    });
  }

  async function createMatch(values: CreateMatchValues) {
    try {
      await postCreateMatch(values);
      // 新赛事创建后即为当前赛事，头像按赛事隔离上传到新赛事下
      if (createLeftAvatar) {
        await uploadSingleFile('/api/upload/avatar/left', createLeftAvatar);
      }
      if (createRightAvatar) {
        await uploadSingleFile('/api/upload/avatar/right', createRightAvatar);
      }
      if (createLeftAvatar || createRightAvatar) {
        const nextAvatars = await requestJson<AvatarCollectionState>('/api/avatars');
        setAvatars(nextAvatars);
      }
      setCreateMatchOpen(false);
      createMatchForm.resetFields();
      clearCreateAvatars();
      setRosterNotice({ tone: 'success', text: '新赛事已创建，系统已自动切到第 1 局草稿' });
      message.success('新赛事已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 快速创建比赛：从「信息录入」选手多选、校验为双数后随机配对生成多场对局（公平起见随机分配，杜绝固定对阵） */
  function toggleQuickCreatePlayer(name: string) {
    setQuickCreatePlayerNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }
  async function quickCreateMatches() {
    const players = (profiles?.players ?? []).filter((player) => quickCreatePlayerNames.includes(player.name));
    if (players.length < 2) {
      message.warning('请至少选择 2 名选手');
      return;
    }
    if (players.length % 2 !== 0) {
      message.warning(`选手数量必须为双数，当前 ${players.length} 人会存在一场不足 2 名选手的对局，请再选择 1 名或去掉 1 名`);
      return;
    }
    setQuickCreateSaving(true);
    try {
      // 随机洗牌（Fisher–Yates），保证配对随机、避免公平性问题
      const shuffled = [...players];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let created = 0;
      for (let i = 0; i < shuffled.length; i += 2) {
        const left = shuffled[i];
        const right = shuffled[i + 1];
        await postCreateMatch({
          leftPlayer: left.name,
          rightPlayer: right.name,
          leftRank: left.rank || '',
          rightRank: right.rank || '',
          bestOf: quickCreateBestOf,
          tags: quickCreateTags,
        });
        created += 1;
      }
      setRosterNotice({ tone: 'success', text: `已随机配对创建 ${created} 场比赛` });
      message.success(`已随机分配创建 ${created} 场比赛`);
      setQuickCreateOpen(false);
      setQuickCreatePlayerNames([]);
      setQuickCreateTags([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setQuickCreateSaving(false);
    }
  }

  // 战队修改：打开弹窗并回填当前比赛左右战队名称
  function openTeamEdit() {
    if (!activeMatch) {
      return;
    }
    teamEditForm.setFieldsValue({
      leftTeam: activeMatch.leftTeamName || undefined,
      rightTeam: activeMatch.rightTeamName || undefined,
    });
    setTeamEditOpen(true);
  }

  // 保存当前比赛所属战队：按名称匹配「信息录入」战队复用 id；手动输入则仅记名称
  async function saveTeamEdit(values: { leftTeam?: string; rightTeam?: string }) {
    if (!activeMatch) {
      return;
    }
    const teamList = profiles?.teams ?? [];
    const leftTeamName = (values.leftTeam ?? '').trim();
    const rightTeamName = (values.rightTeam ?? '').trim();
    const leftTeam = leftTeamName ? teamList.find((team) => team.name === leftTeamName) : undefined;
    const rightTeam = rightTeamName ? teamList.find((team) => team.name === rightTeamName) : undefined;
    setTeamEditSaving(true);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState }>(`/api/matches/${encodeURIComponent(activeMatch.id)}`, {
        method: 'PATCH',
        json: {
          leftTeamName,
          leftTeamId: leftTeam?.id ?? '',
          rightTeamName,
          rightTeamId: rightTeam?.id ?? '',
        },
      });
      applyServerState({
        store: data.store,
        scoreboard: data.scoreboard,
      });
      setTeamEditOpen(false);
      message.success('战队已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTeamEditSaving(false);
    }
  }

  function getAvatarPreviewSrc(side: PanelSide): string {
    const avatar = avatars[side];
    return avatar.exists
      ? `${avatar.path}?t=${avatar.mtime ?? 0}`
      : side === 'left'
        ? '/assets/ui/left-avatar.png'
        : '/assets/ui/right-avatar.png';
  }

  function pickCreateAvatar(side: PanelSide, file: File) {
    if (side === 'left') {
      if (createLeftAvatarUrl) URL.revokeObjectURL(createLeftAvatarUrl);
      setCreateLeftAvatar(file);
      setCreateLeftAvatarUrl(URL.createObjectURL(file));
    } else {
      if (createRightAvatarUrl) URL.revokeObjectURL(createRightAvatarUrl);
      setCreateRightAvatar(file);
      setCreateRightAvatarUrl(URL.createObjectURL(file));
    }
  }

  function clearCreateAvatars() {
    if (createLeftAvatarUrl) URL.revokeObjectURL(createLeftAvatarUrl);
    if (createRightAvatarUrl) URL.revokeObjectURL(createRightAvatarUrl);
    setCreateLeftAvatar(null);
    setCreateRightAvatar(null);
    setCreateLeftAvatarUrl(null);
    setCreateRightAvatarUrl(null);
  }

  // === 信息录入（选手 / 战队） ===
  function clearProfileEditorImages() {
    if (playerAvatarUrl) URL.revokeObjectURL(playerAvatarUrl);
    if (teamLogoUrl) URL.revokeObjectURL(teamLogoUrl);
    setPlayerAvatarFile(null);
    setPlayerAvatarUrl(null);
    setTeamLogoFile(null);
    setTeamLogoUrl(null);
  }

  function openPlayerEditor(player: PlayerProfile | null) {
    setEditingPlayer(player);
    playerProfileForm.resetFields();
    setPetEditorKeyword('');
    playerProfileForm.setFieldsValue({
      name: player?.name ?? '',
      // 存储为「、」分隔文本，编辑时拆回多选数组
      pets: (player?.pets ?? '').split(/[/、,，\s]+/).map((item) => item.trim()).filter(Boolean),
      declaration: player?.declaration ?? '',
      rank: player?.rank ?? '',
    });
    clearProfileEditorImages();
    setPlayerEditorOpen(true);
  }

  function openTeamEditor(team: TeamProfile | null) {
    setEditingTeam(team);
    teamProfileForm.resetFields();
    teamProfileForm.setFieldsValue({
      name: team?.name ?? '',
      captain: team?.captain ?? '',
      declaration: team?.declaration ?? '',
    });
    clearProfileEditorImages();
    setTeamEditorOpen(true);
  }

  function togglePetInEditor(name: string) {
    const next = playerPetEditorValue.includes(name)
      ? playerPetEditorValue.filter((value) => value !== name)
      : playerPetEditorValue.length >= 6
        ? playerPetEditorValue
        : [...playerPetEditorValue, name];
    playerProfileForm.setFieldValue('pets', next);
  }

  function pickPlayerAvatar(file: File) {
    if (playerAvatarUrl) URL.revokeObjectURL(playerAvatarUrl);
    setPlayerAvatarFile(file);
    setPlayerAvatarUrl(URL.createObjectURL(file));
  }

  function pickTeamLogo(file: File) {
    if (teamLogoUrl) URL.revokeObjectURL(teamLogoUrl);
    setTeamLogoFile(file);
    setTeamLogoUrl(URL.createObjectURL(file));
  }

  async function savePlayerProfile(values: PlayerProfileFormValues) {
    setPlayerSaving(true);
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>('/api/profiles/players', {
        method: 'POST',
        json: {
          id: editingPlayer?.id,
          name: values.name,
          pets: Array.isArray(values.pets) ? values.pets.filter(Boolean).join('、') : (values.pets ?? ''),
          declaration: values.declaration ?? '',
          rank: values.rank ?? '',
        },
      });
      // 保存成功后再上传头像（新增时由后端按名字生成/复用记录）
      const saved = data.profiles.players.find((item) => item.name === values.name.trim());
      if (playerAvatarFile && saved) {
        await uploadSingleFile(`/api/upload/player-avatar/${encodeURIComponent(saved.id)}`, playerAvatarFile);
      }
      const latest = await requestJson<ProfileStoreState>('/api/profiles');
      setProfiles(latest);
      setPlayerEditorOpen(false);
      clearProfileEditorImages();
      message.success(editingPlayer ? '选手信息已更新' : '选手信息已录入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPlayerSaving(false);
    }
  }

  async function removePlayerProfile(player: PlayerProfile) {
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>(`/api/profiles/players/${encodeURIComponent(player.id)}`, {
        method: 'DELETE',
      });
      setProfiles(data.profiles);
      message.success(`已删除选手「${player.name}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 下载选手导入示例 JSON（英文字段名，中文说明见界面提示） */
  function downloadPlayerImportTemplate() {
    const sample = [
      { name: '选手A', rank: '100', declaration: '目标冠军！', pets: '迪莫、火神' },
      { name: '选手B', rank: '88', declaration: '为胜利而战', pets: '水蓝蓝' },
      { name: '选手C', rank: '', declaration: '宣言（可选）', pets: '' },
    ];
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '选手导入示例.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /**
   * 解析选手导入 JSON：仅白名单读取英文字段 名字 name / 排位排名 rank / 宣言 declaration / 常用精灵 pets，
   * 其余字段一律丢弃（防注入病毒）；排名仅保留数字、pets 保留原始文本交由后端匹配 pets.json。
   * 解析通过后打开确认弹窗。
   */
  function handlePlayerImportFile(file: File) {
    void file
      .text()
      .then((text) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          message.error('JSON 解析失败，请检查文件是否为合法 JSON。');
          return;
        }
        if (!Array.isArray(parsed)) {
          message.error('导入文件必须是 JSON 数组，例如：[ { "name": "选手A", "rank": "100" } ]。');
          return;
        }
        const cleaned: Array<{ name: string; rank: string; declaration: string; pets: string }> = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const raw = item as Record<string, unknown>;
          const name = String(raw.name ?? '').trim().slice(0, 32);
          if (!name) continue;
          cleaned.push({
            name,
            rank: String(raw.rank ?? '').replace(/\D/g, '').slice(0, 10),
            declaration: String(raw.declaration ?? '').trim().slice(0, 120),
            pets: String(raw.pets ?? '').trim().slice(0, 300),
          });
        }
        if (cleaned.length === 0) {
          message.error('文件中没有可导入的有效选手记录（每条至少需要英文字段「name」）。');
          return;
        }
        setPlayerImportPreview(cleaned);
        setPlayerImportOpen(true);
      })
      .catch(() => {
        message.error('读取文件失败，请重试。');
      });
    return false;
  }

  /** 确认批量导入选手（排除额外字段后提交后端做二次白名单校验）；若有未命中常用精灵则打开兜底确认 */
  async function confirmPlayerImport() {
    setPlayerImporting(true);
    try {
      const data = await requestJson<{
        success: boolean;
        profiles: ProfileStoreState;
        review: Array<{ name: string; input: string; candidates: Array<{ name: string; number: number | null }> }>;
      }>('/api/profiles/players/import', {
        method: 'POST',
        json: playerImportPreview,
      });
      setProfiles(data.profiles);
      const matchedCount = playerImportPreview.length;
      setPlayerImportPreview([]);
      setPlayerImportOpen(false);
      if (data.review && data.review.length > 0) {
        setPlayerImportReview(data.review);
        setPetReviewSelection({});
        setPlayerImportReviewOpen(true);
        message.warning(`已导入 ${matchedCount} 名选手，但 ${data.review.length} 个常用精灵未在 pets.json 中找到，请人工确认。`);
      } else {
        message.success(`已导入 ${matchedCount} 名选手（同名记录已更新排名与宣言）`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPlayerImporting(false);
    }
  }

  /** 释放批量头像预览中创建的本地对象 URL 并清空预览状态 */
  function clearAvatarBatchPreview() {
    for (const item of avatarBatchPreview) {
      URL.revokeObjectURL(item.url);
    }
    setAvatarBatchPreview([]);
    setAvatarBatchSkipped([]);
  }

  /**
   * 选择批量头像文件后先做本地匹配预览：按文件名（去扩展名）精确匹配已录入选手，
   * 弹出「原头像 vs 新头像」左右对比弹窗，确认后才提交覆盖；未匹配到的文件列出提醒且不上传。
   */
  function handleAvatarBatchFiles(files: File[]) {
    if (files.length === 0) return;
    if (!profiles) {
      message.error('选手档案尚未加载，请稍后重试。');
      return;
    }
    // 换一批文件前先释放上一批预览的对象 URL
    clearAvatarBatchPreview();
    const nameToPlayer = new Map<string, PlayerProfile>();
    for (const player of profiles.players) {
      if (!nameToPlayer.has(player.name)) {
        nameToPlayer.set(player.name, player);
      }
    }
    const preview: Array<{ file: File; url: string; player: PlayerProfile }> = [];
    const skipped: string[] = [];
    for (const file of files) {
      const matchName = file.name.replace(/\.[^.]+$/, '').trim();
      const player = matchName ? nameToPlayer.get(matchName) : undefined;
      if (player) {
        preview.push({ file, url: URL.createObjectURL(file), player });
      } else {
        skipped.push(matchName || file.name);
      }
    }
    setAvatarBatchPreview(preview);
    setAvatarBatchSkipped(skipped);
    if (preview.length === 0) {
      message.error(`所选图片均未匹配到已录入选手（${skipped.length} 个文件已忽略），请检查文件名是否与选手名字一致。`);
      return;
    }
    setAvatarBatchConfirmOpen(true);
  }

  /**
   * 确认覆盖：只提交预览中匹配到的图片（文件名列表随表单 names 字段以 JSON 显式传递，
   * 规避 multer 将 multipart 文件名按 latin1 解码导致的中文乱码），后端二次按名字匹配
   * 并走与单个头像上传相同的魔数校验 + sharp 压缩管线落盘。
   */
  async function confirmPlayerAvatarBatch() {
    if (avatarBatchPreview.length === 0) return;
    setAvatarBatchUploading(true);
    try {
      const formData = new FormData();
      for (const item of avatarBatchPreview) {
        formData.append('files', item.file);
      }
      formData.append('names', JSON.stringify(avatarBatchPreview.map((item) => item.file.name)));
      const data = await requestJson<PlayerAvatarBatchResponse>('/api/upload/player-avatars/batch', {
        method: 'POST',
        body: formData,
      });
      setProfiles(data.profiles);
      clearAvatarBatchPreview();
      setAvatarBatchConfirmOpen(false);
      if (data.unmatched.length > 0 || data.failed.length > 0) {
        setAvatarBatchResult({ matched: data.matched, unmatched: data.unmatched, failed: data.failed });
        setAvatarBatchResultOpen(true);
      } else {
        message.success(`已为 ${data.matched} 位选手更新头像`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAvatarBatchUploading(false);
    }
  }

  /** 兜底确认：把选中的候选精灵写入对应选手的常用精灵 */
  async function applyPetReviewChoices() {
    try {
      const chosen = Object.entries(petReviewSelection).filter(([, value]) => Boolean(value));
      if (chosen.length === 0) {
        setPlayerImportReviewOpen(false);
        setPlayerImportReview([]);
        message.success('未选择任何候选，未做改动。');
        return;
      }
      let latest = profiles;
      for (const [indexKey, choice] of chosen) {
        const index = Number(indexKey);
        const reviewItem = playerImportReview[index];
        const player = latest?.players.find((item) => item.name === reviewItem?.name);
        if (!player) continue;
        const existing = (player.pets ?? '')
          .split(/[/、,，\s]+/)
          .map((token) => token.trim())
          .filter(Boolean);
        const pets = [...existing.filter((token) => token !== choice), choice].join('、');
        const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>('/api/profiles/players', {
          method: 'POST',
          json: { id: player.id, name: player.name, declaration: player.declaration, rank: player.rank, pets },
        });
        latest = data.profiles;
      }
      setProfiles(latest);
      setPlayerImportReviewOpen(false);
      setPlayerImportReview([]);
      setPetReviewSelection({});
      message.success(`已为 ${chosen.length} 个常用精灵补录对应选手。`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveTeamProfile(values: TeamProfileFormValues) {
    setTeamSaving(true);
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>('/api/profiles/teams', {
        method: 'POST',
        json: {
          id: editingTeam?.id,
          name: values.name,
          captain: values.captain ?? '',
          declaration: values.declaration ?? '',
        },
      });
      const saved = data.profiles.teams.find((item) => item.name === values.name.trim());
      if (teamLogoFile && saved) {
        await uploadSingleFile(`/api/upload/team-logo/${encodeURIComponent(saved.id)}`, teamLogoFile);
      }
      const latest = await requestJson<ProfileStoreState>('/api/profiles');
      setProfiles(latest);
      setTeamEditorOpen(false);
      clearProfileEditorImages();
      message.success(editingTeam ? '战队信息已更新' : '战队信息已录入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTeamSaving(false);
    }
  }

  async function removeTeamProfile(team: TeamProfile) {
    try {
      const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>(`/api/profiles/teams/${encodeURIComponent(team.id)}`, {
        method: 'DELETE',
      });
      setProfiles(data.profiles);
      message.success(`已删除战队「${team.name}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 批量删除选手/战队：逐条走单删接口，勾选后弹出确认（含将要删除的名称清单） */
  function bulkDeleteProfiles(kind: 'players' | 'teams', ids: string[]) {
    if (!ids.length) {
      return;
    }
    const isPlayers = kind === 'players';
    const label = isPlayers ? '选手' : '战队';
    const items = (isPlayers ? profiles?.players : profiles?.teams) ?? [];
    const names = items.filter((item) => ids.includes(item.id)).map((item) => item.name);
    modal.confirm({
      title: `确认删除所选 ${ids.length} 个${label}？`,
      content: `将删除：${names.join('、')}（同时移除其头像/logo 文件）。该操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setBulkDeleting(true);
        try {
          let latest = profiles;
          for (const id of ids) {
            const data = await requestJson<{ success: boolean; profiles: ProfileStoreState }>(
              `/api/profiles/${kind}/${encodeURIComponent(id)}`,
              { method: 'DELETE' },
            );
            latest = data.profiles;
          }
          if (latest) {
            setProfiles(latest);
          }
          if (isPlayers) {
            setSelectedPlayerIds([]);
          } else {
            setSelectedTeamIds([]);
          }
          message.success(`已删除 ${ids.length} 个${label}`);
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error));
        } finally {
          setBulkDeleting(false);
        }
      },
    });
  }

  /** 创建比赛时复用录入选手：自动带上排名与头像 */
  async function reusePlayerProfile(side: PanelSide, player: PlayerProfile) {
    createMatchForm.setFieldsValue({
      ...(side === 'left' ? { leftRank: player.rank || '' } : { rightRank: player.rank || '' }),
    });
    if (!player.avatarExists) {
      return;
    }
    try {
      const response = await fetch(`/runtime/profiles/players/${encodeURIComponent(player.id)}.png`);
      if (!response.ok) {
        return;
      }
      const blob = await response.blob();
      const file = new File([blob], `${player.id}.png`, { type: 'image/png' });
      if (side === 'left') {
        if (createLeftAvatarUrl) URL.revokeObjectURL(createLeftAvatarUrl);
        setCreateLeftAvatar(file);
        setCreateLeftAvatarUrl(URL.createObjectURL(file));
      } else {
        if (createRightAvatarUrl) URL.revokeObjectURL(createRightAvatarUrl);
        setCreateRightAvatar(file);
        setCreateRightAvatarUrl(URL.createObjectURL(file));
      }
    } catch {
      // 头像复用失败不影响继续创建
    }
  }

  async function deleteHistoryMatches(matchIds: string[]) {
    if (!matchIds.length) {
      return;
    }

    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState; panels?: PanelState[] }>('/api/matches/batch-delete', {
        method: 'POST',
        json: { matchIds },
      });
      applyServerState({
        store: data.store,
        scoreboard: data.scoreboard,
        panels: data.panels,
      });
      setSelectedHistoryKeys([]);
      setHistoryNotice({ tone: 'success', text: `已删除 ${matchIds.length} 场赛事` });
      message.success(`已删除 ${matchIds.length} 场赛事`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function undoDeletedHistoryMatches() {
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState; panels?: PanelState[] }>('/api/matches/undo-delete', {
        method: 'POST',
      });
      applyServerState({
        store: data.store,
        scoreboard: data.scoreboard,
        panels: data.panels,
      });
      setHistoryNotice({ tone: 'success', text: '已恢复最近一次删除的赛事记录' });
      message.success('最近删除的赛事已恢复');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function togglePage6Draft(matchId: string, checked: boolean) {
    setPage6Draft((prev) => {
      if (checked) {
        if (prev.includes(matchId) || prev.length >= PAGE6_MAX_MATCHES) {
          return prev;
        }
        return [...prev, matchId];
      }
      return prev.filter((id) => id !== matchId);
    });
  }

  async function pushPage6Matches() {
    setPage6Pushing(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page6State }>('/api/page6', {
        method: 'POST',
        json: { matchIds: page6Draft },
      });
      applyServerState({ page6: data.state });
      setPage6Draft(data.state.matchIds);
      const nextText = data.state.matchIds.length
        ? `已推送 ${data.state.matchIds.length} 场比赛结果到推流页面6`
        : '已清空推流页面6 的比赛结果';
      setHistoryNotice({ tone: 'success', text: nextText });
      message.success(nextText);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPage6Pushing(false);
    }
  }

  function togglePage8Draft(matchId: string, checked: boolean) {
    setPage8Draft((prev) => {
      if (checked) {
        if (prev.includes(matchId) || prev.length >= PAGE8_MAX_MATCHES) {
          return prev;
        }
        return [...prev, matchId];
      }
      return prev.filter((id) => id !== matchId);
    });
  }

  async function pushPage8Matches() {
    setPage8Pushing(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page8State }>('/api/page8', {
        method: 'POST',
        json: { matchIds: page8Draft },
      });
      applyServerState({ page8: data.state });
      setPage8Draft(data.state.matchIds);
      const nextText = data.state.matchIds.length
        ? `已推送 ${data.state.matchIds.length} 场对局预告到推流页面8`
        : '已清空推流页面8 的对局预告';
      setHistoryNotice({ tone: 'success', text: nextText });
      message.success(nextText);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPage8Pushing(false);
    }
  }

  function compareHistoryMatches(a: MatchRecord, b: MatchRecord): number {
    if (!historySort.key || !historySort.order) {
      return 0;
    }
    let value = 0;
    switch (historySort.key) {
      case 'updatedAt': {
        const ta = new Date(a.updatedAt).getTime() || 0;
        const tb = new Date(b.updatedAt).getTime() || 0;
        value = ta - tb;
        break;
      }
      case 'score': {
        const da = Math.abs((a.leftScore ?? 0) - (a.rightScore ?? 0));
        const db = Math.abs((b.leftScore ?? 0) - (b.rightScore ?? 0));
        value = da - db;
        break;
      }
      case 'bestOf': {
        value = (a.bestOf ?? 0) - (b.bestOf ?? 0);
        break;
      }
      case 'status': {
        value = HISTORY_STATUS_RANK[a.status] - HISTORY_STATUS_RANK[b.status];
        break;
      }
    }
    return historySort.order === 'asc' ? value : -value;
  }

  function cycleHistorySort(key: HistorySortKey) {
    setHistorySort((prev) => {
      if (prev.key !== key) {
        return { key, order: 'asc' };
      }
      if (prev.order === 'asc') {
        return { key, order: 'desc' };
      }
      return { key: null, order: null };
    });
  }

  async function handleBatchTag() {
    const ids = selectedHistoryKeys.map(String);
    const selected = matchStore.matches.filter((match) => ids.includes(match.id));
    if (!selected.length) {
      return;
    }
    setBatchTagValue(null);
    setBatchTagOpen(true);
  }

  async function submitBatchTag() {
    const ids = selectedHistoryKeys.map(String);
    if (!ids.length || !batchTagValue) {
      return;
    }
    setBatchTagSaving(true);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState }>('/api/matches/batch-tags', {
        method: 'POST',
        json: { matchIds: ids, tags: [batchTagValue] },
      });
      applyServerState({ store: data.store });
      const added = batchTagValue;
      setSelectedHistoryKeys([]);
      setBatchTagOpen(false);
      setBatchTagValue(null);
      setHistoryNotice({ tone: 'success', text: `已为 ${ids.length} 场赛事添加标签「${added}」` });
      message.success(`已为 ${ids.length} 场赛事添加标签「${added}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchTagSaving(false);
    }
  }

  async function runMatchAction(action: 'start' | 'undo' | 'redo' | 'winner', extra?: Record<string, unknown>) {
    if (!activeMatch) {
      return;
    }

    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState; panels?: PanelState[] }>(
        `/api/matches/${encodeURIComponent(activeMatch.id)}/${action}`,
        {
          method: 'POST',
          json: extra,
        },
      );
      applyServerState({
        store: data.store,
        scoreboard: data.scoreboard,
        panels: data.panels,
      });

      const nextStore = data.store ?? matchStore;
      const nextMatch = getActiveMatch(nextStore);
      if (action === 'start') {
        const nextText = '本局已开始，后续仍可继续编辑阵容、血量与能量值';
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
        return;
      }
      if (action === 'undo') {
        const nextText = '已撤回上一步操作';
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
        return;
      }
      if (action === 'redo') {
        const nextText = '已恢复刚刚撤回的操作';
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
        return;
      }
      if (action === 'winner') {
        const winner = extra?.winner === 'left' || extra?.winner === 'right' ? extra.winner : null;
        const sideText = winner === 'left' ? '左侧' : '右侧';
        const nextText = nextMatch?.status === 'completed'
          ? `比赛已结束，${sideText}拿下系列赛`
          : `已记录${sideText}本局获胜，下一局等待开始`;
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  // 即时保存：推流页面5标题（失焦触发，值未变化时跳过）
  async function savePage5TitleNow() {
    if (!scoreboard || page5TitleDraft === (scoreboard.page5Title ?? '')) {
      return;
    }
    try {
      const data = await requestJson<{ success: boolean; scoreboard: ScoreboardState }>('/api/scoreboard', {
        method: 'POST',
        json: { ...scoreboard, page5Title: page5TitleDraft },
      });
      applyServerState({ scoreboard: data.scoreboard });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setPage5TitleDraft(scoreboard.page5Title ?? '');
    }
  }

  // 即时保存：推流页面2字段（赛事标题失焦触发、阵容展示选择即存）
  async function savePage2FieldNow(patch: { eventTitle?: string; page2LineupDisplayMode?: 'default' | 'avatar-only' }) {
    if (!scoreboard) {
      return;
    }
    if (patch.page2LineupDisplayMode === undefined && patch.eventTitle === (scoreboard.eventTitle ?? '')) {
      return;
    }
    try {
      const data = await requestJson<{ success: boolean; scoreboard: ScoreboardState }>('/api/scoreboard', {
        method: 'POST',
        json: { ...scoreboard, ...patch },
      });
      applyServerState({ scoreboard: data.scoreboard });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      if (patch.eventTitle !== undefined) {
        setPage2EventTitleDraft(scoreboard.eventTitle ?? '');
      }
    }
  }

  useEffect(() => {
    setPage5TitleDraft(scoreboard?.page5Title ?? '');
  }, [scoreboard?.page5Title]);

  useEffect(() => {
    setPage2EventTitleDraft(scoreboard?.eventTitle ?? '');
  }, [scoreboard?.eventTitle]);

  useEffect(() => {
    setPage6TitleDraft(page6?.title ?? '');
    setPage6BackgroundDraft(page6?.background ?? 'image');
  }, [page6?.title, page6?.background]);

  useEffect(() => {
    setPage8TitleDraft(page8?.title ?? '');
    setPage8BackgroundDraft(page8?.background ?? 'image');
  }, [page8?.title, page8?.background]);

  useEffect(() => {
    setPage7TitleDraft(page7?.title ?? '');
    setPage7NoticeDraft(page7?.notice ?? '');
  }, [page7?.title, page7?.notice]);

  useEffect(() => {
    setPage9TitleDraft(page9?.title ?? '');
    // 以服务端数据回填草稿行，不足 PAGE9_TEAM_COUNT 行则补空行
    const serverTeams = Array.isArray(page9?.teams) ? page9.teams : [];
    setPage9TeamsDraft(
      Array.from({ length: PAGE9_TEAM_COUNT }, (_, index) => {
        const team = serverTeams[index];
        return {
          name: team?.name ?? '',
          r1: team?.r1 ?? '',
          r2: team?.r2 ?? '',
          r3: team?.r3 ?? '',
        };
      }),
    );
  }, [page9?.title, page9?.teams]);

  // 选手介绍（page11-13）草稿：服务端状态变化时回填（避免编辑中频繁覆盖，仅在结构变化时同步）
  useEffect(() => {
    setPage11LeftDraft((prev) => {
      const server = page11?.left;
      if (!server) {
        return prev;
      }
      return prev.source === server.source && prev.name === server.name && prev.rank === server.rank && prev.declaration === server.declaration && prev.pets === server.pets
        ? prev
        : { source: server.source, name: server.name, rank: server.rank, declaration: server.declaration, pets: server.pets };
    });
    setPage11RightDraft((prev) => {
      const server = page11?.right;
      if (!server) {
        return prev;
      }
      return prev.source === server.source && prev.name === server.name && prev.rank === server.rank && prev.declaration === server.declaration && prev.pets === server.pets
        ? prev
        : { source: server.source, name: server.name, rank: server.rank, declaration: server.declaration, pets: server.pets };
    });
  }, [page11?.left, page11?.right]);

  // 保存选手介绍配置（左右两侧数据来源与手动填写内容）
  async function savePage11Settings(payload?: { left?: typeof page11LeftDraft; right?: typeof page11RightDraft }) {
    setPage11Saving(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page11State }>('/api/page11', {
        method: 'POST',
        json: {
          left: payload?.left ?? page11LeftDraft,
          right: payload?.right ?? page11RightDraft,
        },
      });
      applyServerState({ page11: data.state });
      setPage11Notice({ tone: 'success', text: '选手介绍设置已保存' });
    } catch (error) {
      setPage11Notice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPage11Saving(false);
    }
  }

  // 即时保存：推流页面6副标题（失焦触发）与背景（切换即存）
  async function savePage6FieldNow(patch: { title?: string; background?: Page6Background }) {
    if (patch.background === undefined && patch.title === (page6?.title ?? '')) {
      return;
    }
    try {
      const data = await requestJson<{ success: boolean; state: Page6State }>('/api/page6', {
        method: 'POST',
        json: {
          matchIds: page6?.matchIds ?? [],
          title: patch.title ?? page6TitleDraft,
          background: patch.background ?? page6BackgroundDraft,
        },
      });
      applyServerState({ page6: data.state });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setPage6TitleDraft(page6?.title ?? '');
      setPage6BackgroundDraft(page6?.background ?? 'image');
    }
  }

  async function savePage8Settings() {
    setPage8Saving(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page8State }>('/api/page8', {
        method: 'POST',
        json: {
          matchIds: page8?.matchIds ?? page8Draft,
          title: page8TitleDraft,
          background: page8BackgroundDraft,
        },
      });
      applyServerState({ page8: data.state });
      setPage8SettingsNotice({ tone: 'success', text: '比赛预告页面设置已保存，预览已更新' });
      message.success('比赛预告页面设置已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setPage8SettingsNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPage8Saving(false);
    }
  }

  // 即时保存：推流页面7主标题与温馨提示（失焦触发，值未变化时跳过）
  async function savePage7FieldNow() {
    const serverTitle = page7?.title ?? '';
    const serverNotice = page7?.notice ?? '';
    if (page7TitleDraft === serverTitle && page7NoticeDraft === serverNotice) {
      return;
    }
    try {
      const data = await requestJson<{ success: boolean; state: Page7State }>('/api/page7', {
        method: 'POST',
        json: {
          matchIds: page7?.matchIds ?? page7Draft,
          title: page7TitleDraft,
          notice: page7NoticeDraft,
        },
      });
      applyServerState({ page7: data.state });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setPage7TitleDraft(serverTitle);
      setPage7NoticeDraft(serverNotice);
    }
  }

  function togglePage7Draft(matchId: string, checked: boolean) {
    setPage7Draft((prev) => {
      if (checked) {
        return prev.includes(matchId) ? prev : [...prev, matchId];
      }
      return prev.filter((id) => id !== matchId);
    });
  }

  // 更新团队积分榜某一行的某个字段（战队名称 / R1 / R2 / R3；积分仅允许数字）
  function updatePage9TeamDraft(rowIndex: number, field: 'name' | 'r1' | 'r2' | 'r3', value: string) {
    const nextValue = field === 'name' ? value : value.replace(/\D/g, '');
    setPage9TeamsDraft((prev) => prev.map((team, index) => (
      index === rowIndex ? { ...team, [field]: nextValue } : team
    )));
  }

  async function savePage9Settings() {
    setPage9Saving(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page9State }>('/api/page9', {
        method: 'POST',
        json: {
          title: page9TitleDraft,
          teams: page9TeamsDraft,
        },
      });
      applyServerState({ page9: data.state });
      setPage9SettingsNotice({ tone: 'success', text: '团队积分榜设置已保存，预览已更新' });
      message.success('团队积分榜设置已保存');
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      message.error(text);
      setPage9SettingsNotice({ tone: 'error', text });
    } finally {
      setPage9Saving(false);
    }
  }

  async function pushPage7Matches() {
    setPage7Pushing(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page7State }>('/api/page7', {
        method: 'POST',
        json: {
          matchIds: page7Draft,
          title: page7TitleDraft,
          notice: page7NoticeDraft,
        },
      });
      applyServerState({ page7: data.state });
      setPage7Draft(data.state.matchIds);
      const nextText = data.state.matchIds.length
        ? `已推送 ${data.state.matchIds.length} 场对局到推流页面7（对局推送）`
        : '已清空推流页面7 的对局推送';
      setHistoryNotice({ tone: 'success', text: nextText });
      message.success(nextText);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPage7Pushing(false);
    }
  }

  async function uploadPage8Wallpaper(file: File) {
    setPage8WallpaperUploading(true);
    try {
      const data = await uploadSingleFile<{ success: boolean; state: Page8State; wallpaperUrl: string }>('/api/page8/wallpaper', file);
      applyServerState({ page8: data.state });
      setPage8BackgroundDraft('custom');
      message.success('自定义壁纸已上传并应用');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      setPage8SettingsNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPage8WallpaperUploading(false);
    }
  }

  async function removePage8Wallpaper() {
    setPage8WallpaperUploading(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page8State }>('/api/page8/wallpaper', {
        method: 'DELETE',
      });
      applyServerState({ page8: data.state });
      setPage8BackgroundDraft('image');
      message.success('已删除自定义壁纸，回退到内置背景');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPage8WallpaperUploading(false);
    }
  }

  async function saveStage(
    nextPage: StagePageKey,
    options?: { silent?: boolean; transition?: StageTransitionType; page3SpriteSource?: Page3SpriteSource; page3RankVisible?: boolean; page3TeamVisible?: boolean; page11RankVisible?: boolean; page5Player?: string; page5Tag?: string; page10Duration?: number; page10DurationUnit?: 'seconds' | 'minutes' },
  ) {
    const silent = options?.silent ?? false;
    const normalized = normalizeStagePage(nextPage);
    const transition = normalizeStageTransition(options?.transition ?? stage?.transition);
    const page3SpriteSource = options?.page3SpriteSource ?? stage?.page3SpriteSource ?? 'sprite';
    const page3RankVisible = options?.page3RankVisible ?? stage?.page3RankVisible ?? false;
    const page3TeamVisible = options?.page3TeamVisible ?? stage?.page3TeamVisible ?? false;
    const page11RankVisible = options?.page11RankVisible ?? stage?.page11RankVisible ?? true;
    const page5Player = options?.page5Player ?? stage?.page5Player ?? '';
    const page5Tag = options?.page5Tag ?? stage?.page5Tag ?? '';
    const page10Duration = options?.page10Duration ?? stage?.page10Duration ?? 10;
    const page10DurationUnit = options?.page10DurationUnit ?? stage?.page10DurationUnit ?? 'seconds';
    // 乐观更新，避免切换回弹
    setStage((prev) => (prev ? { ...prev, page: normalized, transition, page3SpriteSource, page3RankVisible, page3TeamVisible, page11RankVisible, page5Player, page5Tag, page10Duration, page10DurationUnit } : prev));
    setStageSaving(true);
    try {
      const data = await requestJson<{ success: boolean; stage: StageConfig }>('/api/stage', {
        method: 'POST',
        json: { page: normalized, transition, page3SpriteSource, page3RankVisible, page3TeamVisible, page11RankVisible, page5Player, page5Tag, page10Duration, page10DurationUnit },
      });
      applyServerState({ stage: data.stage });
      if (!silent) {
        message.success(`已切换到：${STAGE_OPTIONS.find((option) => option.value === data.stage.page)?.label ?? data.stage.page}`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      // 失败时回滚到当前已知值
      try {
        const fresh = await requestJson<StageConfig>('/api/stage');
        setStage(fresh);
      } catch {
        // ignore
      }
    } finally {
      setStageSaving(false);
    }
  }

  async function saveNextGame(payload: {
    matchId?: string | null;
    duration?: number;
    durationUnit?: 'seconds' | 'minutes';
  }) {
    setNextgameSaving(true);
    try {
      const data = await requestJson<{ success: boolean } & NextGamePayload>('/api/nextgame', {
        method: 'POST',
        json: payload,
      });
      applyServerState({ nextgame: data });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setNextgameSaving(false);
    }
  }

  async function showNextGame(payload: {
    matchId?: string | null;
    duration?: number;
    durationUnit?: 'seconds' | 'minutes';
  }) {
    setNextgameSaving(true);
    try {
      const data = await requestJson<{ success: boolean } & NextGamePayload>('/api/nextgame/show', {
        method: 'POST',
        json: payload,
      });
      applyServerState({ nextgame: data });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setNextgameSaving(false);
    }
  }

  async function hideNextGameFromAdmin() {
    setNextgameSaving(true);
    try {
      const data = await requestJson<{ success: boolean } & NextGamePayload>('/api/nextgame/hide', {
        method: 'POST',
        json: {},
      });
      applyServerState({ nextgame: data });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setNextgameSaving(false);
    }
  }

  /** 倒计时插件：保存配置（时长 / 配色），不改变显示与进行状态 */
  async function saveCountdown(payload: { duration?: number; theme?: 'dark' | 'light' }) {
    setCountdownSaving(true);
    try {
      const data = await requestJson<{ success: boolean } & CountdownPayload>('/api/countdown', {
        method: 'POST',
        json: payload,
      });
      applyServerState({ countdown: data });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCountdownSaving(false);
    }
  }

  /** 倒计时插件操作：开启显示 / 关闭 / 开始 / 暂停 / 重置 */
  async function countdownAction(action: 'show' | 'hide' | 'start' | 'pause' | 'reset') {
    setCountdownSaving(true);
    try {
      const data = await requestJson<{ success: boolean } & CountdownPayload>(`/api/countdown/${action}`, {
        method: 'POST',
        json: {},
      });
      applyServerState({ countdown: data });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCountdownSaving(false);
    }
  }

  /** 倒计时当前剩余秒数：running 用 endAt 实时计算（按服务端时钟偏差校准） */
  function countdownRemainingSeconds(state: CountdownState): number {
    if (!state.running || state.endAt === null) {
      return Math.max(0, Math.round(state.remainingSeconds));
    }
    return Math.max(0, Math.ceil((state.endAt - (Date.now() + countdownClockRef.current.offset)) / 1000));
  }

  function formatCountdownText(state: CountdownState): string {
    const seconds = countdownRemainingSeconds(state);
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  async function saveMatchTags(matchId: string, tags: string[]) {
    const nextTags = Array.from(new Set(tags.map((item) => item.trim()).filter(Boolean))).slice(0, 10);

    setSavingHistoryTagMatchId(matchId);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState }>(`/api/matches/${encodeURIComponent(matchId)}/tags`, {
        method: 'PATCH',
        json: { tags: nextTags },
      });
      applyServerState({ store: data.store });
      setEditingHistoryTagMatchId(null);
      setEditingHistoryTagValues([]);
      setHistoryNotice({ tone: 'success', text: '标签已更新' });
      message.success('标签已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingHistoryTagMatchId(null);
    }
  }

  function beginInlineTagEdit(match: MatchRecord) {
    setEditingHistoryTagMatchId(match.id);
    setEditingHistoryTagValues(match.tags ?? []);
  }

  function cancelInlineTagEdit() {
    setEditingHistoryTagMatchId(null);
    setEditingHistoryTagValues([]);
  }

  async function commitInlineTagEdit(matchId: string) {
    if (savingHistoryTagMatchId === matchId) {
      return;
    }

    await saveMatchTags(matchId, editingHistoryTagValues);
  }

  async function removeMatchTag(record: MatchRecord, tagValue: string) {
    const tags = (record.tags ?? []).filter((tag) => tag !== tagValue);

    await saveMatchTags(record.id, tags);
    setHistoryNotice({ tone: 'success', text: `已从 ${record.id} 删除标签“${tagValue}”` });
    message.success('标签已删除');
  }

  async function uploadAvatarFile(side: PanelSide, file: File) {
    try {
      await uploadSingleFile(`/api/upload/avatar/${side}`, file);
      const nextAvatars = await requestJson<AvatarCollectionState>('/api/avatars');
      setAvatars(nextAvatars);
      message.success(`${side === 'left' ? '左侧' : '右侧'}头像已更新`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteAvatarFile(side: PanelSide) {
    try {
      await requestJson(`/api/delete/avatar/${side}`, {
        method: 'DELETE',
      });
      const nextAvatars = await requestJson<AvatarCollectionState>('/api/avatars');
      setAvatars(nextAvatars);
      message.success(`${side === 'left' ? '左侧' : '右侧'}头像已删除`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCopyLocalAddress() {
    try {
      await copyText(getLocalAddressText(previewSlot));
      message.success('本地地址已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  async function handleCopyPreviewLink() {
    try {
      await copyText(buildPreviewUrl(previewSlot));
      message.success('预览链接已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  async function handleCopyStageLocalAddress() {
    const host = window.location.port ? `127.0.0.1:${window.location.port}` : '127.0.0.1';
    try {
      await copyText(`${host}/`);
      message.success('推流页地址已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  function clearLivePollTimer() {
    if (livePollTimerRef.current !== null) {
      window.clearInterval(livePollTimerRef.current);
      livePollTimerRef.current = null;
    }
  }

  function clearLiveSaveTimer() {
    if (liveSaveTimerRef.current !== null) {
      window.clearTimeout(liveSaveTimerRef.current);
      liveSaveTimerRef.current = null;
    }
  }

  async function verifyFilePermission(fileHandle: {
    queryPermission?: (options?: unknown) => Promise<string>;
    requestPermission?: (options?: unknown) => Promise<string>;
  }, mode: 'read' | 'readwrite' = 'read') {
    if (!fileHandle || typeof fileHandle.queryPermission !== 'function') {
      return true;
    }

    const options = { mode };
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if (typeof fileHandle.requestPermission !== 'function') {
      return false;
    }
    return (await fileHandle.requestPermission(options)) === 'granted';
  }

  function downloadLiveConfig(text: string) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'roco-live-config.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function getLiveConfigFileName(filePath: string) {
    return String(filePath || '').split(/[\\/]/).pop() || 'roco-live-config.json';
  }

  async function writeLiveConfigToPath(filePath: string, text: string, notice?: string) {
    if (!window.rocoDesktop?.writeTextFile || !window.rocoDesktop?.statFile) {
      throw new Error('当前环境不支持写入监听文件');
    }

    liveWriteRef.current = true;
    try {
      await window.rocoDesktop.writeTextFile(filePath, text);
      const stat = await window.rocoDesktop.statFile(filePath);
      setLiveConfigLastModified(stat.mtimeMs);
      setLiveConfigLastContent(text);
      if (notice) {
        setLiveNotice({ tone: 'success', text: notice });
      }
    } finally {
      liveWriteRef.current = false;
    }
  }

  async function saveLivePanelsSilently(nextPanels: Record<PanelSide, PanelEditorState>) {
    const [leftData, rightData] = await Promise.all([
      requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>('/api/panels/left', {
        method: 'POST',
        json: { selected: buildPanelRequest(nextPanels.left.selected) },
      }),
      requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>('/api/panels/right', {
        method: 'POST',
        json: { selected: buildPanelRequest(nextPanels.right.selected) },
      }),
    ]);

    applyServerState({
      panel: rightData.panel,
      panels: [leftData.panel, rightData.panel].filter(Boolean) as PanelState[],
      store: rightData.store ?? leftData.store,
    });
  }

  async function applyLiveConfigText(text: string, source = '监听文件') {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${source} JSON 格式错误`);
    }

    liveApplyRef.current = true;
    try {
      let changed = false;
      const nextPanels: Record<PanelSide, PanelEditorState> = {
        left: { ...panels.left, selected: cloneSelected(panels.left.selected) },
        right: { ...panels.right, selected: cloneSelected(panels.right.selected) },
      };

      (['left', 'right'] as PanelSide[]).forEach((panel) => {
        const panelItems = extractLiveConfigPanel(payload, panel);
        if (!Array.isArray(panelItems)) {
          return;
        }

        const usedIndexes = new Set<number>();
        panelItems.slice(0, 6).forEach((rawItem, fallbackIndex) => {
          if (!rawItem || typeof rawItem !== 'object') {
            return;
          }

          const item = rawItem as Record<string, unknown>;
          const targetIndex = findConfigTargetIndex(panel, item, fallbackIndex, usedIndexes, nextPanels);
          if (targetIndex < 0 || targetIndex >= 6) {
            return;
          }
          usedIndexes.add(targetIndex);

          const slot = { ...nextPanels[panel].selected[targetIndex] };
          const hp = readNumberField(item, ['HP', 'hp', 'healthPercent', 'health'], 0, 100);
          const value = readNumberField(item, ['value', 'energyValue', 'energy'], 0, 10);

          if (hp !== null && slot.healthPercent !== hp) {
            slot.healthPercent = hp;
            changed = true;
          }
          if (value !== null && slot.energyValue !== value) {
            slot.energyValue = value;
            changed = true;
          }

          nextPanels[panel].selected[targetIndex] = slot;
        });
      });

      if (!changed) {
        setLiveNotice({ tone: 'info', text: `${source}无变化` });
        return;
      }

      startTransition(() => {
        setPanels(nextPanels);
      });
      await saveLivePanelsSilently(nextPanels);
      setLiveNotice({ tone: 'success', text: `已根据${source}更新` });
    } finally {
      liveApplyRef.current = false;
    }
  }

  async function pollLiveConfigFile() {
    if (!liveConfigEnabled || !liveFilePath || liveWriteRef.current) {
      return;
    }
    if (!window.rocoDesktop?.readTextFile || !window.rocoDesktop?.statFile) {
      return;
    }

    try {
      const [text, stat] = await Promise.all([
        window.rocoDesktop.readTextFile(liveFilePath),
        window.rocoDesktop.statFile(liveFilePath),
      ]);
      if (text === liveConfigLastContent || stat.mtimeMs === liveConfigLastModified) {
        return;
      }
      setLiveConfigLastModified(stat.mtimeMs);
      setLiveConfigLastContent(text);
      await applyLiveConfigText(text, '监听文件');
    } catch (error) {
      setLiveNotice({ tone: 'error', text: error instanceof Error ? error.message : '监听文件读取失败' });
    }
  }

  async function handleExportLiveConfig() {
    const text = stringifyLiveConfig(panels);

    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: 'roco-live-config.json',
          types: [{ description: 'JSON 文件', accept: { 'application/json': ['.json'] } }],
        });
        if (!(await verifyFilePermission(fileHandle, 'readwrite'))) {
          throw new Error('没有导出文件的写入权限');
        }
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        setLiveNotice({ tone: 'success', text: '配置导出成功' });
        return;
      }

      if (window.rocoDesktop?.showSaveDialog && window.rocoDesktop?.writeTextFile) {
        const filePath = await window.rocoDesktop.showSaveDialog();
        if (!filePath) {
          setLiveNotice({ tone: 'info', text: '已取消配置导出' });
          return;
        }
        await window.rocoDesktop.writeTextFile(filePath, text);
        setLiveNotice({ tone: 'success', text: '配置导出成功' });
        return;
      }

      downloadLiveConfig(text);
      setLiveNotice({ tone: 'success', text: '配置已下载' });
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
        setLiveNotice({ tone: 'info', text: '已取消配置导出' });
        return;
      }
      setLiveNotice({ tone: 'error', text: error instanceof Error ? error.message : '配置导出失败' });
    }
  }

  async function startLiveConfigWatch() {
    try {
      let filePath: string | null = null;

      if (window.rocoDesktop?.showOpenDialog) {
        filePath = await window.rocoDesktop.showOpenDialog();
      }

      if (!filePath) {
        setLiveNotice({ tone: 'info', text: '已取消实时监听' });
        return;
      }
      await startLiveConfigWatchFromPath(filePath);
    } catch (error) {
      stopLiveConfigWatch(false);
      setLiveNotice({ tone: 'error', text: error instanceof Error ? error.message : '实时监听开启失败' });
    }
  }

  async function startLiveConfigWatchFromPath(filePath: string) {
    if (!window.rocoDesktop?.readTextFile || !window.rocoDesktop?.statFile) {
      throw new Error('当前环境不支持实时监听');
    }

    const [text, stat] = await Promise.all([
      window.rocoDesktop.readTextFile(filePath),
      window.rocoDesktop.statFile(filePath),
    ]);

    setLiveFilePath(filePath);
    setLiveFileName(getLiveConfigFileName(filePath));
    setLiveConfigEnabled(true);
    setLiveConfigLastModified(stat.mtimeMs);
    setLiveConfigLastContent(text);

    if (text.trim()) {
      await applyLiveConfigText(text, '监听文件');
    } else {
      await writeLiveConfigToPath(filePath, stringifyLiveConfig(panels), `监听中：${getLiveConfigFileName(filePath)}`);
    }

    clearLivePollTimer();
    livePollTimerRef.current = window.setInterval(() => {
      void pollLiveConfigFile();
    }, 1000);
    setLiveNotice({ tone: 'success', text: `实时监听已开启：${getLiveConfigFileName(filePath)}` });
  }

  async function handleLiveConfigUpload(file: File & { path?: string }) {
    try {
      const uploadPath = typeof file.path === 'string' && file.path.trim() ? file.path.trim() : null;

      if (uploadPath) {
        await startLiveConfigWatchFromPath(uploadPath);
        return false;
      }

      if (window.rocoDesktop?.showOpenDialog) {
        const filePath = await window.rocoDesktop.showOpenDialog();
        if (!filePath) {
          setLiveNotice({ tone: 'info', text: '已取消实时监听' });
          return false;
        }
        await startLiveConfigWatchFromPath(filePath);
        return false;
      }

      const text = await file.text();
      await applyLiveConfigText(text, '上传文件');
      setLiveNotice({ tone: 'warning', text: '当前环境仅应用了上传内容，无法持续监听该文件' });
      return false;
    } catch (error) {
      stopLiveConfigWatch(false);
      setLiveNotice({ tone: 'error', text: error instanceof Error ? error.message : '实时监听开启失败' });
      return false;
    }
  }

  function stopLiveConfigWatch(shouldResetNotice = true) {
    clearLivePollTimer();
    clearLiveSaveTimer();
    liveApplyRef.current = false;
    liveWriteRef.current = false;
    setLiveConfigEnabled(false);
    setLiveFilePath(null);
    setLiveFileName('');
    setLiveConfigLastModified(null);
    setLiveConfigLastContent('');
    if (shouldResetNotice) {
      setLiveNotice({ tone: 'info', text: '实时监听已关闭' });
    }
  }

  function scheduleLiveConfigWrite(reason = '已同步到监听文件') {
    if (!liveConfigEnabled || !liveFilePath || liveApplyRef.current) {
      return;
    }
    clearLiveSaveTimer();
    liveSaveTimerRef.current = window.setTimeout(() => {
      void writeLiveConfigToPath(liveFilePath, stringifyLiveConfig(panels), reason).catch((error) => {
        setLiveNotice({ tone: 'error', text: error instanceof Error ? error.message : '监听文件写入失败' });
      });
    }, 250);
  }

  function handleLiveConfigWatchToggle() {
    if (liveConfigEnabled) {
      stopLiveConfigWatch(true);
      return;
    }
    void startLiveConfigWatch();
  }

  async function saveLiveField(side: PanelSide, slotIndex: number, field: LiveField, value: number) {
    const selected = cloneSelected(panels[side].selected);
    const target = { ...selected[slotIndex] };
    if (field === 'healthPercent') {
      target.healthPercent = clampNumber(Math.round(value), 0, 100);
    } else {
      target.energyValue = clampNumber(Math.round(value), 0, 10);
    }
    selected[slotIndex] = target;

    const nextPanels = {
      ...panels,
      [side]: {
        ...panels[side],
        selected,
      },
    };

    startTransition(() => {
      setPanels(nextPanels);
    });

    try {
      await requestJson<{ success: boolean; panel?: PanelState; store?: MatchStoreState }>(`/api/panels/${side}/slots/${slotIndex}`, {
        method: 'PATCH',
        json: {
          slot: buildPanelRequest(selected)[slotIndex],
        },
      });
      scheduleLiveConfigWrite();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      void loadInitialData();
    }
  }

  useEffect(() => {
    return () => {
      clearLivePollTimer();
      clearLiveSaveTimer();
    };
  }, []);

  useEffect(() => {
    const shell = previewFrameShellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updatePreviewLayout = () => {
      const rect = shell.getBoundingClientRect();
      const availableHeight = Math.max(320, Math.floor(window.innerHeight - rect.top - 24));
      const availableWidth = shell.clientWidth;

      if (!availableWidth || !availableHeight) {
        return;
      }

      const nextScale = Math.min(availableWidth / 1920, availableHeight / 1080, 1);
      const nextWidth = Math.floor(1920 * nextScale);
      const nextHeight = Math.floor(1080 * nextScale);

      setPreviewShellSize({ width: nextWidth, height: nextHeight });
      setPreviewScale(nextScale > 0 ? nextScale : 1);
    };

    updatePreviewLayout();
    const observer = new ResizeObserver(() => updatePreviewLayout());
    observer.observe(shell);
    window.addEventListener('resize', updatePreviewLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePreviewLayout);
    };
    // view 也作为依赖：预览外壳在「页面预览」与「对局推送」两个视图中分别挂载，切换后需重新计算缩放
  }, [previewSlot, view]);

  // 注意：该 useMemo 必须位于任何条件 return 之前（React Hooks 规则），否则 loading 切换时 hook 数量变化会触发 React #310 白屏
  const menuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'roster', icon: <NavIcon name="roster" />, label: VIEW_LABEL.roster },
      { key: 'stage', icon: <NavIcon name="stage" />, label: VIEW_LABEL.stage },
      { key: 'live', icon: <NavIcon name="live" />, label: VIEW_LABEL.live },
      { key: 'history', icon: <NavIcon name="history" />, label: VIEW_LABEL.history },
      { key: 'profiles', icon: <NavIcon name="profiles" />, label: VIEW_LABEL.profiles },
      { key: 'page11', icon: <NavIcon name="page11" />, label: VIEW_LABEL.page11 },
      { key: 'stats', icon: <NavIcon name="stats" />, label: VIEW_LABEL.stats },
      { key: 'preview', icon: <NavIcon name="preview" />, label: VIEW_LABEL.preview },
      { key: 'page4', icon: <NavIcon name="page4" />, label: VIEW_LABEL.page4 },
      { key: 'about', icon: <NavIcon name="about" />, label: VIEW_LABEL.about },
    ],
    []
  );

  if (loading) {
    return (
      <div className="admin-antd-loading">
        <Spin size="large" />
        <Text>正在加载新的 Ant Design 后台...</Text>
      </div>
    );
  }

  const historyColumns: ColumnsType<MatchRecord> = [
    {
      title: (
        <span>
          比赛结果
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            已选 {page6Draft.length}/{PAGE6_MAX_MATCHES}
          </Text>
        </span>
      ),
      key: 'page6',
      width: 92,
      render: (_: unknown, record: MatchRecord) => {
        const isSelected = page6Draft.includes(record.id);
        const isFull = page6Draft.length >= PAGE6_MAX_MATCHES && !isSelected;
        return (
          <Checkbox
            checked={isSelected}
            disabled={record.status !== 'completed' || isFull}
            onChange={(event) => togglePage6Draft(record.id, event.target.checked)}
          />
        );
      },
    },
    {
      title: (
        <span>
          对局信息
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            已选 {page7Draft.length}
          </Text>
        </span>
      ),
      key: 'page7',
      width: 92,
      render: (_: unknown, record: MatchRecord) => {
        const isSelected = page7Draft.includes(record.id);
        return (
          <Checkbox
            checked={isSelected}
            onChange={(event) => togglePage7Draft(record.id, event.target.checked)}
          />
        );
      },
    },
    {
      title: (
        <span>
          比赛预告
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            已选 {page8Draft.length}/{PAGE8_MAX_MATCHES}
          </Text>
        </span>
      ),
      key: 'page8',
      width: 92,
      render: (_: unknown, record: MatchRecord) => {
        const isSelected = page8Draft.includes(record.id);
        const isFull = page8Draft.length >= PAGE8_MAX_MATCHES && !isSelected;
        // 可勾选「待开始」与「进行中」的比赛；已完成对局不可勾选
        const selectable = record.status === 'pending' || record.status === 'in_progress';
        return (
          <Checkbox
            checked={isSelected}
            disabled={!selectable || isFull}
            onChange={(event) => togglePage8Draft(record.id, event.target.checked)}
          />
        );
      },
    },
    {
      title: '左侧选手',
      dataIndex: 'leftPlayer',
      key: 'leftPlayer',
      render: (value: MatchRecord['leftPlayer']) => <Text strong>{value || '左侧'}</Text>,
    },
    {
      title: (
        <HistorySortHeader
          text="比分"
          sortKey="score"
          activeOrder={historySort.key === 'score' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      key: 'score',
      render: (_: unknown, record: MatchRecord) => (
        <Text strong>{record.leftScore} : {record.rightScore}</Text>
      ),
    },
    {
      title: '右侧选手',
      dataIndex: 'rightPlayer',
      key: 'rightPlayer',
      render: (value: MatchRecord['rightPlayer']) => <Text strong>{value || '右侧'}</Text>,
    },
    {
      title: (
        <HistorySortHeader
          text="赛制"
          sortKey="bestOf"
          activeOrder={historySort.key === 'bestOf' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      dataIndex: 'bestOf',
      key: 'bestOf',
      render: (value: MatchRecord['bestOf']) => <Tag color="gold">BO{value}</Tag>,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[], record: MatchRecord) => (
        editingHistoryTagMatchId === record.id ? (
          <Select
            mode="multiple"
            autoFocus
            value={editingHistoryTagValues}
            options={allHistoryTags.map((tag) => ({ value: tag, label: tag }))}
            placeholder="选择标签"
            className="history-tag-select"
            open
            loading={savingHistoryTagMatchId === record.id}
            onChange={(values) => setEditingHistoryTagValues(values)}
            onBlur={() => void commitInlineTagEdit(record.id)}
            onDropdownVisibleChange={(open) => {
              if (!open) {
                void commitInlineTagEdit(record.id);
              }
            }}
          />
        ) : (
          <div className="history-tag-cell" onClick={() => beginInlineTagEdit(record)} role="button" tabIndex={0} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              beginInlineTagEdit(record);
            }
          }}>
            <Space wrap>
              {tags?.length ? tags.map((tag) => (
                <Tag
                  key={`${record.id}-${tag}`}
                  color={historyTagFilter === tag ? 'processing' : DEFAULT_TAGS.includes(tag) ? 'gold' : 'default'}
                  onClick={(event) => {
                    event.stopPropagation();
                    setHistoryTagFilter(tag);
                  }}
                >
                  {tag}
                </Tag>
              )) : <Text type="secondary">点击选择标签</Text>}
            </Space>
          </div>
        )
      ),
    },
    {
      title: (
        <HistorySortHeader
          text="状态"
          sortKey="status"
          activeOrder={historySort.key === 'status' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      dataIndex: 'status',
      key: 'status',
      render: (status: MatchRecord['status']) => <Tag color={getMatchStatusColor(status)}>{getMatchStatusLabel(status)}</Tag>,
    },
    {
      title: (
        <HistorySortHeader
          text="更新时间"
          sortKey="updatedAt"
          activeOrder={historySort.key === 'updatedAt' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (value: MatchRecord['updatedAt']) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: MatchRecord) => (
        <Space wrap>
          <Button size="small" onClick={() => void selectMatch(record.id)}>进入管理</Button>
          <Button
            size="small"
            danger
            onClick={() => {
              modal.confirm({
                title: '删除这场赛事？',
                content: `${record.leftPlayer || '左侧'} vs ${record.rightPlayer || '右侧'}`,
                onOk: () => deleteHistoryMatches([record.id]),
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  function exportHistoryCsv() {
    const csv = buildHistoryCsv(sortedMatches, spriteMap);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '比赛历史.csv';
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${sortedMatches.length} 场赛事历史`);
  }

  return (
    <Layout className="admin-shell">
      <Sider
        width={232}
        collapsible
        collapsed={siderCollapsed}
        collapsedWidth={64}
        trigger={null}
        className="admin-sider"
      >
        <div className="brand-block">
          <span
            className="brand-logo"
            dangerouslySetInnerHTML={{ __html: brandLogoRaw }}
          />
          {!siderCollapsed && (
            <div className="brand-title">
              <span className="brand-line-1">ROCO PVP LINEUP</span>
              <span className="brand-line-2">洛克王国世界阵容同步推流</span>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[view]}
          items={menuItems}
          onClick={({ key }) => {
            setView(key as ViewKey);
            // 进入「对局推送」视图时同步预览槽位，方便顶栏「打开当前预览」直达页面7
            if (key === 'page7') {
              setPreviewSlot('page7');
            }
          }}
          className="admin-menu"
        />
        <div className="sider-foot">
          <Button
            size="small"
            type="text"
            block
            title={siderCollapsed ? '展开导航栏' : '收起导航栏'}
            onClick={() => setSiderCollapsed((value) => !value)}
          >
            {siderCollapsed ? '⇉' : '⇐ 收起导航'}
          </Button>
        </div>
      </Sider>

      <Layout className="admin-main">
        <Header className="admin-header">
          <Title level={3} style={{ margin: 0 }}>
            {VIEW_LABEL[view]}
          </Title>
          <Space wrap>
            <Button
              onClick={() => {
                if (window.rocoFloat?.toggle) {
                  window.rocoFloat.toggle();
                } else {
                  window.open('/float.html', '_blank', 'width=587,height=56,popup=yes,noopener=yes');
                }
              }}
            >
              阵容悬浮窗
            </Button>
            <Button href={buildPreviewUrl(previewSlot)} target="_blank">打开当前预览</Button>
            <Button onClick={() => void handleCopyPreviewLink()}>复制预览链接</Button>
            <Button type="primary" loading={refreshing} onClick={() => void loadInitialData(true)}>
              刷新全部数据
            </Button>
          </Space>
        </Header>

        <Content className="admin-content">
          {pageError ? (
            <Alert showIcon type="error" message="页面加载失败" description={pageError} />
          ) : null}

          {view === 'roster' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Row gutter={[18, 18]} className="roster-overview-row">
                <Col xs={24} xl={7} className="roster-overview-col">
                  <Card
                    className="roster-overview-card roster-match-list-card"
                    title="比赛列表"
                    extra={
                      <Space size={8}>
                        <Button onClick={() => { setQuickCreateKeyword(''); setQuickCreateOpen(true); }}>快速创建比赛</Button>
                        <Button type="primary" onClick={() => setCreateMatchOpen(true)}>开一局</Button>
                      </Space>
                    }
                  >
                    <div className="match-list-scroll">
                      <List
                        dataSource={matchStore.matches}
                        className="match-list"
                        locale={{ emptyText: '暂无赛事，先创建一场比赛吧。' }}
                        renderItem={(match) => (
                          <List.Item
                            className="match-list-item"
                            actions={[
                              <Button key="select" type={match.id === activeMatch?.id ? 'primary' : 'default'} onClick={() => void selectMatch(match.id)}>
                                {match.id === activeMatch?.id ? '当前' : '选择'}
                              </Button>,
                            ]}
                          >
                            <List.Item.Meta
                              avatar={<Badge status={match.status === 'completed' ? 'success' : match.status === 'in_progress' ? 'processing' : 'default'} />}
                              title={`${match.leftPlayer || '左侧'} vs ${match.rightPlayer || '右侧'}`}
                              description={(
                                <Space wrap>
                                  <Tag color="gold">BO{match.bestOf}</Tag>
                                  <Tag color={getMatchStatusColor(match.status)}>{getMatchStatusLabel(match.status)}</Tag>
                                  <Tag bordered={false} className="match-list-score-tag">{match.leftScore} : {match.rightScore}</Tag>
                                </Space>
                              )}
                            />
                          </List.Item>
                        )}
                      />
                    </div>
                  </Card>
                </Col>
                <Col xs={24} xl={17} className="roster-overview-col">
                  <Card
                    className="roster-overview-card roster-current-card"
                    title="当前比赛"
                    extra={(
                      <Space wrap size={8} className="roster-card-head-extra">
                        {rosterNotice ? (
                          <Tag
                            closable
                            bordered={false}
                            color={getNoticeTagColor(rosterNotice.tone)}
                            className="roster-notice-tag"
                            onClose={() => setRosterNotice(null)}
                          >
                            {rosterNotice.text}
                          </Tag>
                        ) : null}
                        <Tag color={activeMatch ? getMatchStatusColor(activeMatch.status) : 'default'}>
                          {activeMatch ? getMatchStatusLabel(activeMatch.status) : '未创建'}
                        </Tag>
                      </Space>
                    )}
                  >
                    {activeMatch ? (
                      <Space direction="vertical" size={18} className="page-stack">
                        <div className="current-match-overview">
                          <div className="current-match-player current-match-player-left">
                            <div className="player-avatar-wrap">
                              <Upload
                                showUploadList={false}
                                beforeUpload={(file) => {
                                  void uploadAvatarFile('left', file as File);
                                  return false;
                                }}
                              >
                                <div className="player-avatar-circular current-match-player-avatar">
                                  <Image preview={false} src={getAvatarPreviewSrc('left')} alt="左侧选手头像" />
                                  <span className="player-avatar-hint">更换</span>
                                </div>
                              </Upload>
                              {avatars.left.exists ? (
                                <Button
                                  className="player-avatar-delete"
                                  size="small"
                                  danger
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void deleteAvatarFile('left');
                                  }}
                                >
                                  删除
                                </Button>
                              ) : null}
                            </div>
                            <Text strong className="current-match-player-name current-match-player-name-left">
                              {activeMatch.leftPlayer || '未设置'}
                            </Text>
                          </div>
                          <div className="current-match-score-block">
                            <Text type="secondary" className="current-match-score-label">当前比分</Text>

                            <div
                              className="current-match-score-card"
                              aria-label={`当前比分 ${activeMatch.leftScore} 比 ${activeMatch.rightScore}`}
                            >
                              <div className="current-match-scoreline">
                                <span className="current-match-score-value">{activeMatch.leftScore}</span>
                                <span className="current-match-score-separator">:</span>
                                <span className="current-match-score-value">{activeMatch.rightScore}</span>
                              </div>
                              
                            </div>
                            <Text type="secondary" className="current-match-meta">
                              BO{activeMatch.bestOf} · {currentGame ? `第 ${currentGame.gameNumber} 局` : '暂无对局'}
                            </Text>
                          </div>
                          <div className="current-match-player current-match-player-right">
                            <div className="player-avatar-wrap">
                              <Upload
                                showUploadList={false}
                                beforeUpload={(file) => {
                                  void uploadAvatarFile('right', file as File);
                                  return false;
                                }}
                              >
                                <div className="player-avatar-circular current-match-player-avatar">
                                  <Image preview={false} src={getAvatarPreviewSrc('right')} alt="右侧选手头像" />
                                  <span className="player-avatar-hint">更换</span>
                                </div>
                              </Upload>
                              {avatars.right.exists ? (
                                <Button
                                  className="player-avatar-delete"
                                  size="small"
                                  danger
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void deleteAvatarFile('right');
                                  }}
                                >
                                  删除
                                </Button>
                              ) : null}
                            </div>
                            <Text strong className="current-match-player-name current-match-player-name-right">
                              {activeMatch.rightPlayer || '未设置'}
                            </Text>
                          </div>
                        </div>
                        <div className="current-match-statusbar">
                          <Steps current={progress.current} items={progress.items} responsive />
                        </div>
                        <Form
                          form={matchForm}
                          layout="vertical"
                          className="current-match-form"
                          onFinish={(values) => void saveMatchMeta(values)}
                        >
                          <Row gutter={[16, 16]}>
                            <Col xs={24} md={10}>
                              <Row gutter={8} wrap={false} className="current-match-player-inputs">
                                <Col flex="auto" style={{ minWidth: 0 }}>
                                  <Form.Item label="左侧选手" name="leftPlayer">
                                    <Input maxLength={32} placeholder="输入左侧选手名字" />
                                  </Form.Item>
                                </Col>
                                <Col flex="112px">
                                  <Form.Item
                                    label="排位排名"
                                    name="leftRank"
                                    getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}
                                  >
                                    <Input maxLength={10} inputMode="numeric" placeholder="仅数字" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </Col>
                            <Col xs={24} md={10}>
                              <Row gutter={8} wrap={false} className="current-match-player-inputs">
                                <Col flex="auto" style={{ minWidth: 0 }}>
                                  <Form.Item label="右侧选手" name="rightPlayer">
                                    <Input maxLength={32} placeholder="输入右侧选手名字" />
                                  </Form.Item>
                                </Col>
                                <Col flex="112px">
                                  <Form.Item
                                    label="排位排名"
                                    name="rightRank"
                                    getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}
                                  >
                                    <Input maxLength={10} inputMode="numeric" placeholder="仅数字" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </Col>
                            <Col xs={24} md={4}>
                              <Form.Item label="比赛赛制" name="bestOf">
                                <Select
                                  style={{ width: '100%' }}
                                  options={[
                                    { value: 1, label: 'BO1' },
                                    { value: 3, label: 'BO3' },
                                    { value: 5, label: 'BO5' },
                                    { value: 7, label: 'BO7' },
                                  ]}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          <div className="current-match-action-row">
                            <Space wrap size={12} className="current-match-action-group">
                              <Button
                                type="primary"
                                onClick={() => void runMatchAction('start')}
                                disabled={!currentGame || currentGame.status !== 'pending' || !currentGame.leftLineup.length || !currentGame.rightLineup.length}
                              >
                                开始本次对局
                              </Button>
                              <Button type="dashed" onClick={openTeamEdit}>战队修改</Button>
                              <Button htmlType="submit">保存比赛信息</Button>
                            </Space>
                            <Space wrap size={12} className="current-match-action-group current-match-action-group-right">
                              <Button type="dashed" onClick={() => void runMatchAction('winner', { winner: 'left' })} disabled={currentGame?.status !== 'in_progress'}>
                                左侧赢了
                              </Button>
                              <Button type="dashed" onClick={() => void runMatchAction('winner', { winner: 'right' })} disabled={currentGame?.status !== 'in_progress'}>
                                右侧赢了
                              </Button>
                              <Button onClick={() => void runMatchAction('undo')} disabled={!matchStore.undo.canUndo}>撤回上一步</Button>
                              <Button onClick={() => void runMatchAction('redo')} disabled={!matchStore.undo.canRedo}>取消撤回</Button>
                            </Space>
                          </div>
                        </Form>
                      </Space>
                    ) : (
                      <Empty description="先创建或选择一场赛事" />
                    )}
                  </Card>
                </Col>
              </Row>

              <Row gutter={[18, 18]}>
                <Col xs={24} xl={12}>
                  <RosterPanelEditor
                    side="left"
                    panel={panels.left}
                    filter={spriteFilters.left}
                    locked={lineupLocked}
                    searchValue={deferredLeftSearch}
                    sprites={sprites}
                    spriteFormOptions={spriteFormOptions}
                    onMutatePanel={mutatePanel}
                    onSavePanel={savePanel}
                    onRunQuickFill={runQuickFill}
                    onClearCurrentSlot={clearCurrentSlot}
                    onClearPanel={clearPanel}
                    onChooseQuickFillCandidate={chooseQuickFillCandidate}
                    onApplySprite={applySprite}
                    onClearSpriteFilters={clearSpriteFilters}
                    onToggleAttributeFilter={toggleAttributeFilter}
                    onToggleFinalFormFilter={toggleFinalFormFilter}
                    onToggleFormFilter={toggleFormFilter}
                  />
                </Col>
                <Col xs={24} xl={12}>
                  <RosterPanelEditor
                    side="right"
                    panel={panels.right}
                    filter={spriteFilters.right}
                    locked={lineupLocked}
                    searchValue={deferredRightSearch}
                    sprites={sprites}
                    spriteFormOptions={spriteFormOptions}
                    onMutatePanel={mutatePanel}
                    onSavePanel={savePanel}
                    onRunQuickFill={runQuickFill}
                    onClearCurrentSlot={clearCurrentSlot}
                    onClearPanel={clearPanel}
                    onChooseQuickFillCandidate={chooseQuickFillCandidate}
                    onApplySprite={applySprite}
                    onClearSpriteFilters={clearSpriteFilters}
                    onToggleAttributeFilter={toggleAttributeFilter}
                    onToggleFinalFormFilter={toggleFinalFormFilter}
                    onToggleFormFilter={toggleFormFilter}
                  />
                </Col>
              </Row>
            </Space>
          ) : null}

          {view === 'page4' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Page4DeathPanel
                page4Panels={page4Panels}
                onTogglePage4DeadAt={togglePage4DeadAt}
              />
              <Row gutter={[18, 18]}>
                <Col xs={24} xl={12}>
                  <Page4PanelEditor
                    side="left"
                    panel={page4Panels.left}
                    filter={page4SpriteFilters.left}
                    notice={page4Notice}
                    searchValue={deferredPage4LeftSearch}
                    sprites={sprites}
                    spriteFormOptions={spriteFormOptions}
                    onMutatePanel={mutatePage4Panel}
                    onDismissNotice={() => setPage4Notice(null)}
                    onSavePanel={savePage4Panel}
                    onRunQuickFill={runPage4QuickFill}
                    onClearCurrentSlot={clearPage4CurrentSlot}
                    onClearPanel={clearPage4Panel}
                    onChooseQuickFillCandidate={choosePage4QuickFillCandidate}
                    onApplySprite={applyPage4Sprite}
                    onClearSpriteFilters={clearPage4SpriteFilters}
                    onToggleAttributeFilter={togglePage4AttributeFilter}
                    onToggleFinalFormFilter={togglePage4FinalFormFilter}
                    onToggleFormFilter={togglePage4FormFilter}
                  />
                </Col>
                <Col xs={24} xl={12}>
                  <Page4PanelEditor
                    side="right"
                    panel={page4Panels.right}
                    filter={page4SpriteFilters.right}
                    notice={page4Notice}
                    searchValue={deferredPage4RightSearch}
                    sprites={sprites}
                    spriteFormOptions={spriteFormOptions}
                    onMutatePanel={mutatePage4Panel}
                    onDismissNotice={() => setPage4Notice(null)}
                    onSavePanel={savePage4Panel}
                    onRunQuickFill={runPage4QuickFill}
                    onClearCurrentSlot={clearPage4CurrentSlot}
                    onClearPanel={clearPage4Panel}
                    onChooseQuickFillCandidate={choosePage4QuickFillCandidate}
                    onApplySprite={applyPage4Sprite}
                    onClearSpriteFilters={clearPage4SpriteFilters}
                    onToggleAttributeFilter={togglePage4AttributeFilter}
                    onToggleFinalFormFilter={togglePage4FinalFormFilter}
                    onToggleFormFilter={togglePage4FormFilter}
                  />
                </Col>
              </Row>
            </Space>
          ) : null}

          {view === 'history' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                title="比赛历史"
                extra={(
                  <Space wrap>
                    <Button onClick={exportHistoryCsv} disabled={!filteredMatches.length}>导出 CSV</Button>
                    {selectedHistoryKeys.length > 1 ? (
                      <Button onClick={() => void handleBatchTag()}>批量添加标签</Button>
                    ) : null}
                    <Button danger disabled={!selectedHistoryKeys.length} onClick={() => void deleteHistoryMatches(selectedHistoryKeys.map(String))}>
                      删除选中赛事
                    </Button>
                    <Button onClick={() => void undoDeletedHistoryMatches()} disabled={!matchStore.undo.canUndoDelete}>
                      撤回最近删除
                    </Button>
                    <Button
                      type="primary"
                      loading={page6Pushing}
                      onClick={() => void pushPage6Matches()}
                    >
                      推送比赛结果（{page6Draft.length}/{PAGE6_MAX_MATCHES}）
                    </Button>
                    <Button
                      type="primary"
                      loading={page7Pushing}
                      onClick={() => void pushPage7Matches()}
                    >
                      推送对局推送（{page7Draft.length}）
                    </Button>
                    <Button
                      type="primary"
                      loading={page8Pushing}
                      onClick={() => void pushPage8Matches()}
                    >
                      推送比赛预告（{page8Draft.length}/{PAGE8_MAX_MATCHES}）
                    </Button>
                  </Space>
                )}
              >
                {historyNotice ? (
                  <Alert
                    showIcon
                    closable
                    type={historyNotice.tone}
                    message={historyNotice.text}
                    className="history-notice"
                    onClose={() => setHistoryNotice(null)}
                  />
                ) : null}
                <Space wrap className="history-filter-row">
                  <Input.Search
                    placeholder="搜索选手名或赛事ID"
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                    allowClear
                    className="history-search-input"
                  />
                  <Tag
                    color={historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? 'processing' : 'default'}
                    onClick={() => setHistoryTagFilter(historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? null : UNCATEGORIZED_HISTORY_TAG)}
                  >
                    未分类赛事
                  </Tag>
                  <Tag color={!historyTagFilter ? 'processing' : 'default'} onClick={() => setHistoryTagFilter(null)}>全部</Tag>
                  {allHistoryTags.map((tag) => (
                    <Tag key={tag} color={historyTagFilter === tag ? 'processing' : 'default'} onClick={() => setHistoryTagFilter(historyTagFilter === tag ? null : tag)}>
                      {tag}
                    </Tag>
                  ))}
                </Space>
                <Table
                  rowKey={(record) => record.id}
                  columns={historyColumns}
                  dataSource={sortedMatches}
                  pagination={{
                    defaultPageSize: 10,
                    pageSizeOptions: ['10', '20', '50', '100'],
                    showSizeChanger: true,
                    showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`,
                  }}
                  rowSelection={{
                    selectedRowKeys: selectedHistoryKeys,
                    onChange: (keys) => setSelectedHistoryKeys(keys),
                  }}
                  expandable={{
                    expandedRowRender: (record) => (
                      <Space direction="vertical" size={16} className="history-detail">
                        <Text type="secondary">
                          {record.id} · BO{record.bestOf} · 已记录 {record.games.filter((game) => game.status === 'completed').length} 局
                          {record.completedAt ? ` · 完成于 ${formatDateTime(record.completedAt)}` : ''}
                        </Text>
                        {getVisibleGames(record).map((game) => {
                          const battleEntries = buildHistoryBattleEntries(game, spriteMap);
                          const leftLost = game.winner === 'right';
                          const rightLost = game.winner === 'left';
                          const lineupBlockReason = getLineupEntryBlockReason(record, game);

                          return (
                          <Card key={`${record.id}-${game.gameNumber}`} size="small" className="subtle-card">
                            <Space direction="vertical" size={12} className="control-stack">
                              <Space wrap>
                                <Tag color="gold">第 {game.gameNumber} 局</Tag>
                                <Tag color={game.status === 'completed' ? 'success' : game.status === 'in_progress' ? 'processing' : 'default'}>
                                  {getGameStatusLabel(game.status)}
                                </Tag>
                                <Tag color={game.winner === 'left' ? 'success' : game.winner === 'right' ? 'volcano' : 'default'}>
                                  {getGameResultLabel(game)}
                                </Tag>
                                <Text type="secondary">左侧 1-6 · 右侧 7-12</Text>
                                <Tooltip
                                  title={lineupBlockReason
                                    ? LINEUP_ENTRY_BLOCK_TEXT[lineupBlockReason]
                                    : `提前录入第 ${game.gameNumber} 局双方阵容，开始对局时自动生效`}
                                >
                                  <Button
                                    size="small"
                                    type={lineupBlockReason ? 'default' : 'primary'}
                                    ghost={!lineupBlockReason}
                                    disabled={Boolean(lineupBlockReason)}
                                    onClick={() => setLineupEntry({ matchId: record.id, gameNumber: game.gameNumber })}
                                  >
                                    录入阵容
                                  </Button>
                                </Tooltip>
                              </Space>
                              <div className="history-battle-grid">
                                {battleEntries.map((entry, index) => {
                                  const isLeft = index < 6;
                                  const lost = isLeft ? leftLost : rightLost;

                                  return (
                                    <Card
                                      key={`${record.id}-${game.gameNumber}-${isLeft ? 'left' : 'right'}-${index}`}
                                      size="small"
                                      className={`history-slot-card history-slot-card-${isLeft ? 'left' : 'right'}${lost ? ' is-lost' : ''}${!entry ? ' is-empty' : ''}`}
                                    >
                                      <Space direction="vertical" size={6} className="history-slot-stack">
                                        {entry?.path ? (
                                          <Image
                                            preview={false}
                                            src={entry.path}
                                            alt={entry.name}
                                            className="history-slot-image"
                                            fallback="/assets/ui/back.png"
                                          />
                                        ) : (
                                          <div className="history-slot-fallback">{index + 1}</div>
                                        )}
                                        <Text ellipsis className="history-slot-name">{entry?.name ?? `空位 ${index + 1}`}</Text>
                                      </Space>
                                    </Card>
                                  );
                                })}
                              </div>
                            </Space>
                          </Card>
                          );
                        })}
                      </Space>
                    ),
                    expandedRowKeys: expandedHistoryKeys,
                    onExpand: (expanded, record) => {
                      setExpandedHistoryKeys(expanded ? [record.id] : []);
                    },
                  }}
                  locale={{ emptyText: '暂无历史赛事' }}
                />
              </Card>
              <Modal
                title="批量添加标签"
                open={batchTagOpen}
                onCancel={() => setBatchTagOpen(false)}
                onOk={() => void submitBatchTag()}
                okButtonProps={{ disabled: !batchTagValue }}
                confirmLoading={batchTagSaving}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Text>已选中 {selectedHistoryKeys.length} 场赛事，选择要添加的赛事标签（仅可选择一个）：</Text>
                  <Select
                    showSearch
                    autoFocus
                    value={batchTagValue ?? undefined}
                    placeholder="选择赛事标签"
                    options={allHistoryTags.map((tag) => ({ value: tag, label: tag }))}
                    onChange={setBatchTagValue}
                    className="history-tag-select"
                    optionFilterProp="label"
                  />
                </Space>
              </Modal>
              <HistoryLineupEntryModal
                open={Boolean(lineupEntry && lineupEntryMatch && lineupEntryGame)}
                match={lineupEntryMatch}
                game={lineupEntryGame}
                sprites={sprites}
                onClose={() => setLineupEntry(null)}
                onSaved={(store) => applyServerState({ store })}
              />
            </Space>
          ) : null}

          {view === 'profiles' ? (
            <Card
              title="信息录入"
              extra={
                <Space size={12}>
                  <Segmented
                    value={profileTab}
                    options={[
                      { value: 'players', label: '选手信息' },
                      { value: 'teams', label: '战队信息' },
                    ]}
                    onChange={(value) => {
                      setProfileTab(value as 'players' | 'teams');
                      setSelectedPlayerIds([]);
                      setSelectedTeamIds([]);
                    }}
                  />
                  {profileTab === 'players' ? (
                    <>
                      <Button onClick={downloadPlayerImportTemplate}>下载示例</Button>
                      <Upload
                        accept=".json,application/json"
                        showUploadList={false}
                        beforeUpload={(file) => handlePlayerImportFile(file as File)}
                      >
                        <Button>导入JSON</Button>
                      </Upload>
                      <Tooltip title="一次多选图片，先按文件名（去掉扩展名）匹配选手并预览原/新头像对比，确认后才覆盖保存；未命中的不上传">
                        <Button loading={avatarBatchUploading} onClick={() => avatarBatchInputRef.current?.click()}>批量头像</Button>
                      </Tooltip>
                      <Button
                        danger
                        disabled={!selectedPlayerIds.length}
                        loading={bulkDeleting}
                        onClick={() => bulkDeleteProfiles('players', selectedPlayerIds)}
                      >
                        删除所选（{selectedPlayerIds.length}）
                      </Button>
                      <Button type="primary" onClick={() => openPlayerEditor(null)}>新增选手</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        danger
                        disabled={!selectedTeamIds.length}
                        loading={bulkDeleting}
                        onClick={() => bulkDeleteProfiles('teams', selectedTeamIds)}
                      >
                        删除所选（{selectedTeamIds.length}）
                      </Button>
                      <Button type="primary" onClick={() => openTeamEditor(null)}>新增战队</Button>
                    </>
                  )}
                </Space>
              }
            >
              {profileTab === 'players' ? (
                <>
                  <input
                    ref={avatarBatchInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    multiple
                    hidden
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = '';
                      if (files.length > 0) handleAvatarBatchFiles(files);
                    }}
                  />
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={profiles?.players ?? []}
                    pagination={false}
                    rowSelection={{
                      selectedRowKeys: selectedPlayerIds,
                      onChange: (keys) => setSelectedPlayerIds(keys as string[]),
                      getCheckboxProps: () => ({ disabled: bulkDeleting }),
                    }}
                    locale={{ emptyText: '暂无选手录入，点击「新增选手」录入头像、名字、常用精灵、宣言与排名。' }}
                    columns={[
                      {
                        title: '头像',
                        key: 'avatar',
                        width: 72,
                        render: (_: unknown, record: PlayerProfile) => (
                          <div className="player-avatar-circular">
                            {record.avatarExists ? (
                              <Image
                                preview={false}
                                src={`/runtime/profiles/players/${encodeURIComponent(record.id)}.png?t=${record.avatarMtime ?? 0}`}
                                alt={record.name}
                              />
                            ) : (
                              <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认头像" />
                            )}
                          </div>
                        ),
                      },
                      { title: '名字', dataIndex: 'name', key: 'name', render: (value: string) => <Text strong>{value}</Text> },
                      { title: '排名', dataIndex: 'rank', key: 'rank', width: 80, render: (value: string) => value || '-' },
                      { title: '常用精灵', dataIndex: 'pets', key: 'pets', ellipsis: true, render: (value: string) => value || '-' },
                      { title: '宣言', dataIndex: 'declaration', key: 'declaration', ellipsis: true, render: (value: string) => value || '-' },
                      {
                        title: '操作',
                        key: 'actions',
                        width: 130,
                        render: (_: unknown, record: PlayerProfile) => (
                          <Space size={4}>
                            <Button size="small" onClick={() => openPlayerEditor(record)}>编辑</Button>
                            <Popconfirm title={`确认删除选手「${record.name}」？`} onConfirm={() => void removePlayerProfile(record)}>
                              <Button size="small" danger>删除</Button>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                  <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                    创建赛事时输入选手名字会自动联想已录入选手，选中后自动复用其头像与排名。
                    「批量头像」支持一次多选图片，按文件名（去掉扩展名）匹配选手名字，先弹出原/新头像对比预览，确认后才覆盖保存；未命中的会提醒且不上传。
                  </Paragraph>
                </>
              ) : (
                <>
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={profiles?.teams ?? []}
                    pagination={false}
                    rowSelection={{
                      selectedRowKeys: selectedTeamIds,
                      onChange: (keys) => setSelectedTeamIds(keys as string[]),
                      getCheckboxProps: () => ({ disabled: bulkDeleting }),
                    }}
                    locale={{ emptyText: '暂无战队录入，点击「新增战队」录入战队名称、队长、logo 与宣言。' }}
                    columns={[
                      {
                        title: 'Logo',
                        key: 'logo',
                        width: 72,
                        render: (_: unknown, record: TeamProfile) => (
                          <div className="player-avatar-circular">
                            {record.logoExists ? (
                              <Image
                                preview={false}
                                src={`/runtime/profiles/teams/${encodeURIComponent(record.id)}.png?t=${record.logoMtime ?? 0}`}
                                alt={record.name}
                              />
                            ) : (
                              <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认logo" />
                            )}
                          </div>
                        ),
                      },
                      { title: '战队名称', dataIndex: 'name', key: 'name', render: (value: string) => <Text strong>{value}</Text> },
                      { title: '队长', dataIndex: 'captain', key: 'captain', width: 120, render: (value: string) => value || '-' },
                      { title: '宣言', dataIndex: 'declaration', key: 'declaration', ellipsis: true, render: (value: string) => value || '-' },
                      {
                        title: '操作',
                        key: 'actions',
                        width: 130,
                        render: (_: unknown, record: TeamProfile) => (
                          <Space size={4}>
                            <Button size="small" onClick={() => openTeamEditor(record)}>编辑</Button>
                            <Popconfirm title={`确认删除战队「${record.name}」？`} onConfirm={() => void removeTeamProfile(record)}>
                              <Button size="small" danger>删除</Button>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                  <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                    创建赛事时可在「所属战队」中选择已录入战队复用；推流页面3 开启战队显示后会展示战队 logo 与名称。
                  </Paragraph>
                </>
              )}
            </Card>
          ) : null}

          {view === 'page11' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                title="选手介绍画面切换"
                extra={<Button href="/roco-pvp-page11.html?mode=left" target="_blank">打开介绍页面</Button>}
              >
                <Space direction="vertical" size={16} className="page-stack">
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    切换选手介绍的三种推流画面；「选手介绍-左侧/右侧选手」依次展示单侧选手的立绘、头像、擅长精灵与比赛宣言，「对战页」展示双方头像与当前阵容。
                  </Paragraph>
                  <Row gutter={[16, 16]}>
                    {([
                      { value: 'page11', label: '介绍左侧选手', description: '立绘在左，介绍当前左侧选手' },
                      { value: 'page12', label: '介绍右侧选手', description: '立绘在右，介绍当前右侧选手' },
                      { value: 'page13', label: '对战页', description: '双方头像 + 当前阵容 + 分割线' },
                    ] as Array<{ value: StagePageKey; label: string; description: string }>).map((option) => {
                      const active = (stage?.page ?? null) === option.value;
                      return (
                        <Col xs={24} sm={8} key={option.value}>
                          <Card
                            size="small"
                            hoverable
                            className={`stage-card ${active ? 'stage-card-active' : ''}`}
                            onClick={() => void saveStage(option.value)}
                          >
                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Text strong>{option.label}</Text>
                                {active ? <Tag color="green">当前画面</Tag> : null}
                              </Space>
                              <Text type="secondary" style={{ fontSize: 12 }}>{option.description}</Text>
                            </Space>
                          </Card>
                        </Col>
                      );
                    })}
                  </Row>
                </Space>
              </Card>

              <Card
                title="选手介绍数据"
                extra={(
                  <Button type="primary" loading={page11Saving} onClick={() => void savePage11Settings()}>
                    保存选手介绍设置
                  </Button>
                )}
              >
                <Space direction="vertical" size={16} className="page-stack">
                  {page11Notice ? (
                    <Alert
                      showIcon
                      closable
                      type={page11Notice.tone}
                      message={page11Notice.text}
                      onClose={() => setPage11Notice(null)}
                    />
                  ) : null}
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    数据来源可选「当前赛事」（选手名/排名取当前赛事，介绍内容按名字匹配「信息录入」自动补全）或「手动填写」（留空的字段同样回退「信息录入」匹配值）。当前赛事：{activeMatch ? `${activeMatch.leftPlayer || '左侧'} vs ${activeMatch.rightPlayer || '右侧'}` : '未选择'}。
                  </Paragraph>
                  {(['left', 'right'] as const).map((side) => {
                    const draft = side === 'left' ? page11LeftDraft : page11RightDraft;
                    const setDraft = side === 'left' ? setPage11LeftDraft : setPage11RightDraft;
                    return (
                      <Card
                        key={side}
                        size="small"
                        className="subtle-card"
                        title={side === 'left' ? '左侧选手' : '右侧选手'}
                        extra={(
                          <Segmented
                            value={draft.source}
                            options={[
                              { value: 'match', label: '当前赛事' },
                              { value: 'manual', label: '手动填写' },
                            ]}
                            onChange={(value) => setDraft({ ...draft, source: value as 'manual' | 'match' })}
                          />
                        )}
                      >
                        {draft.source === 'manual' ? (
                          <Row gutter={[16, 16]}>
                            <Col xs={24} md={6}>
                              <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>选手名字：</Text>
                              <AutoComplete
                                style={{ width: '100%' }}
                                value={draft.name}
                                options={(profiles?.players ?? []).map((item) => ({ value: item.name }))}
                                filterOption={(input, option) =>
                                  String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
                                }
                                onChange={(value) => setDraft({ ...draft, name: String(value ?? '') })}
                              >
                                <Input maxLength={32} placeholder="输入或联想「信息录入」选手" />
                              </AutoComplete>
                            </Col>
                            <Col xs={24} md={4}>
                              <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>排位排名：</Text>
                              <Input
                                maxLength={10}
                                placeholder="仅数字，留空回退赛事/信息录入"
                                value={draft.rank}
                                onChange={(event) => setDraft({ ...draft, rank: event.target.value.replace(/\D/g, '') })}
                              />
                            </Col>
                            <Col xs={24} md={14}>
                              <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>擅长精灵：</Text>
                              <Select
                                mode="multiple"
                                allowClear
                                showSearch
                                maxCount={6}
                                popupMatchSelectWidth={false}
                                style={{ width: '100%' }}
                                placeholder="搜索并选择擅长精灵，最多 6 个"
                                options={playerPetOptions}
                                value={draft.pets.split(/[/、,，\s]+/).map((item) => item.trim()).filter(Boolean)}
                                filterOption={(input, option) =>
                                  String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
                                }
                                onChange={(values) => setDraft({ ...draft, pets: Array.isArray(values) ? values.filter(Boolean).join('、') : '' })}
                              />
                            </Col>
                            <Col xs={24}>
                              <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>比赛宣言：</Text>
                              <Input
                                maxLength={120}
                                placeholder="留空回退「信息录入」宣言"
                                value={draft.declaration}
                                onChange={(event) => setDraft({ ...draft, declaration: event.target.value })}
                              />
                            </Col>
                          </Row>
                        ) : (
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            使用当前赛事选手：{activeMatch ? (side === 'left' ? activeMatch.leftPlayer : activeMatch.rightPlayer) || '未填写' : '未选择赛事'}；排名取赛事录入，宣言/擅长精灵按名字匹配「信息录入」。
                          </Paragraph>
                        )}
                      </Card>
                    );
                  })}
                </Space>
              </Card>
            </Space>
          ) : null}

          {view === 'stats' ? (
            <StatsView
              matches={matchStore.matches}
              spriteMap={spriteMap}
              metric={statsMetric}
              player={statsPlayer}
              tag={statsTag}
              search={statsSearch}
              onMetricChange={setStatsMetric}
              onPlayerChange={setStatsPlayer}
              onTagChange={setStatsTag}
              onSearchChange={setStatsSearch}
            />
          ) : null}

          {view === 'live' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                title="实时控制"
                extra={(
                  <Space wrap>
                    <Button onClick={() => void loadInitialData(true)}>重新加载</Button>
                    <Button onClick={() => void handleExportLiveConfig()}>配置导出</Button>
                  </Space>
                )}
              >
                <Space direction="vertical" size={16} className="page-stack">
                  {liveNotice ? (
                    <Alert
                      showIcon
                      closable
                      type={liveNotice.tone}
                      message={liveNotice.text}
                      onClose={() => setLiveNotice(null)}
                    />
                  ) : null}
                  <Row gutter={[18, 18]}>
                    {(['left', 'right'] as PanelSide[]).map((side) => (
                      <Col key={side} xs={24} xl={12}>
                        <Card title={side === 'left' ? '左侧实时面板' : '右侧实时面板'}>
                          <div className="live-grid">
                            {panels[side].selected.map((slot, index) => (
                              <div key={`live-${side}-${index}`} className="live-slot-card">
                                <div className="live-slot-preview">
                                  <span className="live-slot-index">{index + 1}</span>
                                  {slot.sprite?.path ? (
                                    <Image preview={false} src={slot.sprite.path} alt={slot.sprite.displayName} className="live-slot-image" fallback="/assets/ui/back.png" />
                                  ) : (
                                    <div className="live-slot-empty">空槽位</div>
                                  )}
                                  <Text ellipsis className="live-slot-name">{slot.sprite?.displayName ?? '未选择精灵'}</Text>
                                </div>
                                <div className="live-slot-controls">
                                  <div className="live-input-row">
                                    <Text strong className="live-input-label">HP</Text>
                                    <Slider
                                      key={`live-health-${side}-${index}-${slot.sprite?.id ?? 'empty'}-${slot.healthEnabled ? 'on' : 'off'}-${getHealthLevel(slot)}`}
                                      min={0}
                                      max={100}
                                      defaultValue={getHealthLevel(slot)}
                                      onChangeComplete={(value) => void saveLiveField(side, index, 'healthPercent', Number(value))}
                                      className="live-input-slider"
                                      tooltip={{ formatter: (value) => `${value ?? 0}%` }}
                                    />
                                  </div>
                                  <div className="live-input-row">
                                    <Text strong className="live-input-label">能量</Text>
                                    <Slider
                                      key={`live-energy-${side}-${index}-${slot.sprite?.id ?? 'empty'}-${getEnergyLevel(slot)}`}
                                      min={0}
                                      max={10}
                                      step={1}
                                      defaultValue={getEnergyLevel(slot)}
                                      onChangeComplete={(value) => void saveLiveField(side, index, 'energyValue', Number(value))}
                                      className="live-input-slider"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                  <Row gutter={[16, 16]}>
                    <Col xs={24}>
                      <Card size="small" className="subtle-card live-watch-card">
                        <Space direction="vertical" size={14} className="control-stack">
                          <Space align="start" className="live-watch-header">
                            <div>
                              <Text type="secondary">监听目标 JSON</Text>
                              <Title level={5}>{liveConfigEnabled ? '监听中' : '未监听'}</Title>
                              <Text type="secondary">{liveFileName || '点击或拖拽选择要监听的 JSON 文件'}</Text>
                            </div>
                            <Button type={liveConfigEnabled ? 'default' : 'primary'} danger={liveConfigEnabled} onClick={handleLiveConfigWatchToggle}>
                              {liveConfigEnabled ? '关闭监听' : '开启实时监听'}
                            </Button>
                          </Space>
                          <Upload.Dragger
                            accept=".json,application/json"
                            showUploadList={false}
                            className="live-watch-uploader"
                            beforeUpload={(file) => handleLiveConfigUpload(file as File & { path?: string })}
                          >
                            <p className="ant-upload-text">选择或拖拽监听 JSON</p>
                            <p className="ant-upload-hint">监听开启后，后台会持续读取这个本地文件并回写当前数值。</p>
                          </Upload.Dragger>
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                </Space>
              </Card>
            </Space>
          ) : null}

          {view === 'stage' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                className="stage-control-card"
                title="直播推流"
                extra={
                  <Space wrap>
                    <Button href="/" target="_blank">打开推流页面</Button>
                    <Button onClick={handleCopyStageLocalAddress}>复制推流页地址</Button>
                  </Space>
                }
              >
                <Space direction="vertical" size={16} className="page-stack">
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    推流软件（OBS 等）只需固定捕获根路径 <code>/</code>。在此切换后，推流页面会实时加载所选画面，无需修改推流来源；下列各项设置修改后即时保存生效（团队积分榜为批量录入，仍需点击保存）。
                  </Paragraph>
                  <Row gutter={[16, 16]} className="stage-config-cards">
                    <Col xs={24} md={12} xl={8}>
                      <Card size="small" className="subtle-card" title="推流页面5-精灵出场胜率-统计口径">
                        <Space direction="vertical" size={12} className="control-stack">
                          <SettingField label="页面5标题：">
                            <Input
                              maxLength={40}
                              placeholder="例如：洛克比赛（自动拼上赛事标签与精灵出场胜率）"
                              value={page5TitleDraft}
                              onChange={(event) => setPage5TitleDraft(event.target.value)}
                              onBlur={() => { void savePage5TitleNow(); }}
                            />
                          </SettingField>
                          <SettingField label="赛事标签：">
                            <Select
                              className="stage-page5-tag-select"
                              value={stage?.page5Tag || undefined}
                              disabled={stageSaving}
                              options={[
                                { value: '', label: '全部' },
                                ...allHistoryTags.map((tag) => ({ value: tag, label: tag })),
                              ]}
                              onChange={(value) => { void saveStage(stage?.page ?? 'page3', { silent: true, page5Tag: value ?? '' }); }}
                            />
                          </SettingField>
                          <SettingField label="选手：">
                            <Select
                              showSearch
                              className="stage-page5-tag-select"
                              value={stage?.page5Player || undefined}
                              disabled={stageSaving}
                              options={[
                                { value: '', label: '全部' },
                                ...allPlayers.map((playerName) => ({ value: playerName, label: playerName })),
                              ]}
                              onChange={(value) => { void saveStage(stage?.page ?? 'page3', { silent: true, page5Player: value ?? '' }); }}
                            />
                          </SettingField>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} md={12} xl={8}>
                      <Card size="small" className="subtle-card" title="倒计时插件">
                        <Space direction="vertical" size={12} className="control-stack">
                          <SettingField label="倒计时时长（分钟）：">
                            <InputNumber
                              style={{ width: '100%' }}
                              min={1}
                              max={60}
                              value={countdown?.duration ?? 5}
                              disabled={countdownSaving}
                              onChange={(value) => {
                                void saveCountdown({ duration: value === null || value === undefined ? 5 : Number(value) });
                              }}
                            />
                          </SettingField>
                          <SettingField label="配色：">
                            <Segmented
                              block
                              value={countdown?.theme ?? 'dark'}
                              disabled={countdownSaving}
                              options={[
                                { value: 'dark', label: '深色' },
                                { value: 'light', label: '浅色' },
                              ]}
                              onChange={(value) => { void saveCountdown({ theme: value as 'dark' | 'light' }); }}
                            />
                          </SettingField>
                          <Space wrap>
                            {countdown?.visible ? (
                              <>
                                {countdown.running ? (
                                  <Button disabled={countdownSaving} onClick={() => void countdownAction('pause')}>暂停倒计时</Button>
                                ) : (
                                  <Button type="primary" disabled={countdownSaving} onClick={() => void countdownAction('start')}>开始倒计时</Button>
                                )}
                                <Button disabled={countdownSaving} onClick={() => void countdownAction('reset')}>重置</Button>
                                <Button danger disabled={countdownSaving} onClick={() => void countdownAction('hide')}>关闭显示</Button>
                              </>
                            ) : (
                              <Button type="primary" disabled={countdownSaving} onClick={() => void countdownAction('show')}>开启显示</Button>
                            )}
                          </Space>
                          <Space size={8} wrap>
                            {countdown?.visible ? <Tag color="green">显示中</Tag> : <Tag>已关闭</Tag>}
                            {countdown?.running ? <Tag color="blue">倒计时中</Tag> : <Tag>时间静止</Tag>}
                            {countdown ? <Text strong style={{ fontSize: 16 }}>剩余 {formatCountdownText(countdown)}</Text> : null}
                          </Space>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} md={12} xl={8}>
                      <Card size="small" className="subtle-card" title="下场对局">
                        <Space direction="vertical" size={12} className="control-stack">
                          <SettingField label="待开始比赛：">
                            <Select
                              className="stage-page5-tag-select"
                              style={{ width: '100%' }}
                              showSearch
                              optionFilterProp="label"
                              placeholder="选择待开始的比赛"
                              value={nextgame?.matchId || undefined}
                              disabled={nextgameSaving}
                              options={pendingMatches.map((match) => ({
                                value: match.id,
                                label: `${match.leftPlayer || '左侧'} vs ${match.rightPlayer || '右侧'}（BO${match.bestOf}）`,
                              }))}
                              onChange={(value) => { void saveNextGame({ matchId: value ?? null }); }}
                            />
                          </SettingField>
                          <SettingField label="开启后停留时长（分钟）：">
                            <InputNumber
                              style={{ width: '100%' }}
                              min={1}
                              max={60}
                              value={nextgame?.duration ?? 1}
                              disabled={nextgameSaving}
                              onChange={(value) => {
                                void saveNextGame({
                                  duration: value === null || value === undefined ? 1 : Number(value),
                                  durationUnit: 'minutes',
                                });
                              }}
                            />
                          </SettingField>
                          <Space wrap>
                            <Button
                              type="primary"
                              disabled={!nextgame?.matchId || !pendingMatches.some((match) => match.id === nextgame.matchId)}
                              loading={nextgameSaving}
                              onClick={() => void showNextGame({})}
                            >
                              显示下场对局
                            </Button>
                            <Button
                              danger
                              disabled={!nextgame?.visible}
                              loading={nextgameSaving}
                              onClick={() => void hideNextGameFromAdmin()}
                            >
                              关闭
                            </Button>
                            {nextgame?.visible ? <Tag color="green">正在显示</Tag> : <Tag>已隐藏</Tag>}
                          </Space>
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                  <Row gutter={[16, 16]}>
                    {STAGE_OPTIONS.map((option) => {
                      const active = (stage?.page ?? null) === option.value;
                      return (
                        <Col xs={24} sm={12} md={8} key={option.value}>
                          <Card
                            size="small"
                            hoverable
                            className={`stage-card ${active ? 'stage-card-active' : ''}`}
                            onClick={() => void saveStage(option.value)}
                          >
                            <Space direction="vertical" size={6} className="page-stack" style={{ width: '100%' }}>
                              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Text strong>{option.label}</Text>
                                {active ? <Tag color="green">当前画面</Tag> : null}
                              </Space>
                              <Text type="secondary" style={{ fontSize: 12 }}>{option.description}</Text>
                              <StageThumb label={option.label} previewPath={option.previewPath} />
                            </Space>
                          </Card>
                        </Col>
                      );
                    })}
                  </Row>
                  <Row gutter={[16, 16]} className="stage-config-cards">
                    <Col xs={24} md={8}>
                      <Card size="small" className="subtle-card" title="推流页面3设置">
                        <Space direction="vertical" size={12} className="control-stack">
                          <SettingField label="精灵图片：" hint="切换显示精灵完整立绘或者头像缩略图。">
                            <Segmented
                              block
                              value={stage?.page3SpriteSource ?? 'sprite'}
                              disabled={stageSaving}
                              options={[
                                { value: 'sprite', label: '精灵原图' },
                                { value: 'thumbnail', label: '精灵头像' },
                              ]}
                              onChange={(value) => { void saveStage(stage?.page ?? 'page3', { silent: true, page3SpriteSource: value as Page3SpriteSource }); }}
                            />
                          </SettingField>
                          <SettingField label="排位图标：" hint="比分栏中显示选手的排名">
                            <Space wrap>
                              <Switch
                                checked={stage?.page3RankVisible ?? false}
                                disabled={stageSaving}
                                loading={stageSaving}
                                onChange={(checked) => { void saveStage(stage?.page ?? 'page3', { silent: true, page3RankVisible: checked }); }}
                              />
                              {stage?.page3RankVisible ? <Tag color="green">已开启</Tag> : <Tag>已关闭</Tag>}
                            </Space>
                          </SettingField>
                          <SettingField label="战队标识：" hint="显示选手所在战队">
                            <Space wrap>
                              <Switch
                                checked={stage?.page3TeamVisible ?? false}
                                disabled={stageSaving}
                                loading={stageSaving}
                                onChange={(checked) => { void saveStage(stage?.page ?? 'page3', { silent: true, page3TeamVisible: checked }); }}
                              />
                              {stage?.page3TeamVisible ? <Tag color="green">已开启</Tag> : <Tag>已关闭</Tag>}
                            </Space>
                          </SettingField>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" className="subtle-card" title="画面切换行为">
                        <Space direction="vertical" size={12} className="control-stack">
                          <SettingField label="切换过渡效果：" hint="切换直播推流画面时的过渡动效。">
                            <Segmented
                              block
                              value={normalizeStageTransition(stage?.transition)}
                              disabled={stageSaving}
                              options={STAGE_TRANSITION_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                              onChange={(value) => { void saveStage(stage?.page ?? 'page3', { silent: true, transition: value as StageTransitionType }); }}
                            />
                          </SettingField>
                          <SettingField label="胜者结算停留时长（推流页面10）：" hint="赛事面板登记本局胜负时自动显示">
                            <Space wrap>
                              <InputNumber
                                min={1}
                                max={stage?.page10DurationUnit === 'minutes' ? 60 : 3600}
                                value={stage?.page10Duration ?? 10}
                                disabled={stageSaving}
                                onChange={(value) => {
                                  void saveStage(stage?.page ?? 'page3', {
                                    silent: true,
                                    page10Duration: value === null || value === undefined ? 1 : Number(value),
                                  });
                                }}
                              />
                              <Segmented
                                value={stage?.page10DurationUnit ?? 'seconds'}
                                disabled={stageSaving}
                                options={[
                                  { value: 'seconds', label: '秒' },
                                  { value: 'minutes', label: '分钟' },
                                ]}
                                onChange={(value) => {
                                  void saveStage(stage?.page ?? 'page3', { silent: true, page10DurationUnit: value as 'seconds' | 'minutes' });
                                }}
                              />
                            </Space>
                          </SettingField>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" className="subtle-card" title="推流页面6-比赛结果标题与背景切换">
                        <Space direction="vertical" size={12} className="control-stack">
                          <SettingField label="推流页面6副标题：">
                            <Input
                              maxLength={40}
                              placeholder="页面6比赛结果页标题2内容，可留空"
                              value={page6TitleDraft}
                              onChange={(event) => setPage6TitleDraft(event.target.value)}
                              onBlur={() => { void savePage6FieldNow({ title: page6TitleDraft }); }}
                            />
                          </SettingField>
                          <SettingField label="推流页面6背景：">
                            <Segmented
                              block
                              value={page6BackgroundDraft}
                              options={[
                                { value: 'image', label: '图片' },
                                { value: 'image-2', label: '图片2' },
                                { value: 'video', label: '视频' },
                              ]}
                              onChange={(value) => {
                                setPage6BackgroundDraft(value as Page6Background);
                                void savePage6FieldNow({ background: value as Page6Background });
                              }}
                            />
                          </SettingField>
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                  <Row gutter={[16, 16]} className="stage-config-cards">
                    <Col xs={24} md={12} xl={8}>
                      <Card size="small" className="subtle-card stage-settings-card" title="推流页面2设置">
                        <Row gutter={[16, 16]}>
                          <Col xs={24} md={12}>
                            <SettingField label="页面2赛事标题：">
                              <Input
                                maxLength={40}
                                value={page2EventTitleDraft}
                                onChange={(event) => setPage2EventTitleDraft(event.target.value)}
                                onBlur={() => { void savePage2FieldNow({ eventTitle: page2EventTitleDraft }); }}
                              />
                            </SettingField>
                          </Col>
                          <Col xs={24} md={12}>
                            <SettingField label="页面2阵容展示：">
                              <Select
                                style={{ width: '100%' }}
                                value={scoreboard?.page2LineupDisplayMode ?? 'default'}
                                disabled={!scoreboard}
                                options={[
                                  { value: 'default', label: '默认血量展示' },
                                  { value: 'avatar-only', label: '仅头像展示' },
                                ]}
                                onChange={(value) => { void savePage2FieldNow({ page2LineupDisplayMode: value as 'default' | 'avatar-only' }); }}
                              />
                            </SettingField>
                          </Col>
                        </Row>
                      </Card>
                    </Col>
                    <Col xs={24} md={12} xl={8}>
                      <Card size="small" className="subtle-card stage-settings-card" title="选手介绍显示（推流页面11-13）">
                        <SettingField label="排位排名：" hint="关闭后选手介绍三种画面均不显示排位排名；开启时选手有排名才显示。">
                          <Space wrap>
                            <Switch
                              checked={stage?.page11RankVisible ?? true}
                              disabled={stageSaving}
                              loading={stageSaving}
                              onChange={(checked) => { void saveStage(stage?.page ?? 'page3', { silent: true, page11RankVisible: checked }); }}
                            />
                            {stage?.page11RankVisible ? <Tag color="green">已开启</Tag> : <Tag>已关闭</Tag>}
                          </Space>
                        </SettingField>
                      </Card>
                    </Col>
                    <Col xs={24} md={12} xl={8}>
                      <Card size="small" className="subtle-card stage-settings-card" title="推流页面7标题文本设置">
                        <Space direction="vertical" size={12} className="page-stack" style={{ width: '100%' }}>
                          <Row gutter={[16, 16]}>
                            <Col xs={24} md={12}>
                              <SettingField label="主标题：">
                                <Input
                                  maxLength={40}
                                  placeholder="例如：S2洛克联赛，留空显示默认「对局推送」"
                                  value={page7TitleDraft}
                                  onChange={(event) => setPage7TitleDraft(event.target.value)}
                                  onBlur={() => { void savePage7FieldNow(); }}
                                />
                              </SettingField>
                            </Col>
                            <Col xs={24} md={12}>
                              <SettingField label="温馨提示：">
                                <Input
                                  maxLength={60}
                                  placeholder="页面底部提示文字，留空使用默认内容"
                                  value={page7NoticeDraft}
                                  onChange={(event) => setPage7NoticeDraft(event.target.value)}
                                  onBlur={() => { void savePage7FieldNow(); }}
                                />
                              </SettingField>
                            </Col>
                          </Row>
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                  <Row gutter={[16, 16]} className="stage-config-cards">
                    <Col xs={24}>
                      <Card
                        size="small"
                        className="subtle-card stage-settings-card"
                        title="团队积分榜设置（推流页面9）"
                        extra={(
                          <Button type="primary" loading={page9Saving} onClick={() => void savePage9Settings()}>
                            保存页面9设置
                          </Button>
                        )}
                      >
                        <Space direction="vertical" size={12} className="page-stack" style={{ width: '100%' }}>
                          {page9SettingsNotice ? (
                            <Alert
                              showIcon
                              closable
                              type={page9SettingsNotice.tone}
                              message={page9SettingsNotice.text}
                              onClose={() => setPage9SettingsNotice(null)}
                            />
                          ) : null}
                          <Row gutter={[16, 16]}>
                            <Col xs={24} md={8}>
                              <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>标题：</Text>
                              <Input
                                maxLength={40}
                                placeholder="留空显示默认「团队积分榜」"
                                value={page9TitleDraft}
                                onChange={(event) => setPage9TitleDraft(event.target.value)}
                              />
                            </Col>
                          </Row>
                          <div>
                            <Row gutter={[16, 8]}>
                              <Col xs={24} md={12}><Text type="secondary">战队名称</Text></Col>
                              <Col xs={8} md={4}><Text type="secondary">R1 积分</Text></Col>
                              <Col xs={8} md={4}><Text type="secondary">R2 积分</Text></Col>
                              <Col xs={8} md={4}><Text type="secondary">R3 积分</Text></Col>
                            </Row>
                            {page9TeamsDraft.map((team, index) => (
                              <Row key={index} gutter={[16, 8]} style={{ marginTop: 8 }}>
                                <Col xs={24} md={12}>
                                  <AutoComplete
                                    style={{ width: '100%' }}
                                    value={team.name}
                                    options={(profiles?.teams ?? []).map((item) => ({ value: item.name }))}
                                    filterOption={(input, option) =>
                                      String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
                                    }
                                    onChange={(value) => updatePage9TeamDraft(index, 'name', String(value ?? ''))}
                                  >
                                    <Input
                                      maxLength={40}
                                      placeholder={`战队 ${index + 1} 名称，可联想「信息录入」战队`}
                                    />
                                  </AutoComplete>
                                </Col>
                                <Col xs={8} md={4}>
                                  <Input
                                    maxLength={3}
                                    placeholder="-"
                                    value={team.r1}
                                    onChange={(event) => updatePage9TeamDraft(index, 'r1', event.target.value)}
                                  />
                                </Col>
                                <Col xs={8} md={4}>
                                  <Input
                                    maxLength={3}
                                    placeholder="-"
                                    value={team.r2}
                                    onChange={(event) => updatePage9TeamDraft(index, 'r2', event.target.value)}
                                  />
                                </Col>
                                <Col xs={8} md={4}>
                                  <Input
                                    maxLength={3}
                                    placeholder="-"
                                    value={team.r3}
                                    onChange={(event) => updatePage9TeamDraft(index, 'r3', event.target.value)}
                                  />
                                </Col>
                              </Row>
                            ))}
                          </div>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            积分留空显示「-」；排名与总积分按三轮积分之和自动降序计算（同分保持录入顺序）；名称与积分全空的行不展示；最多 {PAGE9_TEAM_COUNT} 支战队。
                          </Paragraph>
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                </Space>
              </Card>
            </Space>
          ) : null}

          {view === 'preview' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                className="preview-page-card"
                title={getPreviewPage(previewSlot).title}
                extra={<Button type="primary" href={buildPreviewUrl(previewSlot)} target="_blank">新窗口打开</Button>}
              >
                <Space direction="vertical" size={16} className="page-stack">
                  <Segmented
                    value={previewSlot}
                    options={[
                      { value: 'stage', label: '直播推流' },
                      { value: 'page1', label: '推流页面1' },
                      { value: 'page2', label: '推流页面2' },
                      { value: 'page3', label: '推流页面3' },
                      { value: 'page4', label: '仅显阵容' },
                      { value: 'page5', label: '推流页面5' },
                      { value: 'page6', label: '推流页面6' },
                      { value: 'page7', label: '推流页面7' },
                      { value: 'page8', label: '推流页面8' },
                      { value: 'page9', label: '推流页面9' },
                      { value: 'page10', label: '推流页面10' },
                    ]}
                    onChange={(value) => setPreviewSlot(value as PreviewSlotKey)}
                  />
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <Card size="small" className="subtle-card preview-info-card">
                        <Statistic title="本地部署地址" value={getLocalAddressText(previewSlot)} />
                        <Divider />
                        <Button block onClick={() => void handleCopyLocalAddress()}>复制地址</Button>
                      </Card>
                    </Col>
                    <Col xs={24} md={12}>
                      <Card size="small" className="subtle-card preview-info-card">
                        <Statistic title="完整预览链接" value={buildPreviewUrl(previewSlot)} />
                        <Divider />
                        <Button block onClick={() => void handleCopyPreviewLink()}>复制链接</Button>
                      </Card>
                    </Col>
                  </Row>
                  {previewSlot === 'page8' ? (
                    <Card
                      size="small"
                      className="subtle-card"
                      title="比赛预告设置（推流页面8）"
                      extra={(
                        <Space wrap>
                          <Button
                            type="primary"
                            loading={page8Saving}
                            onClick={() => void savePage8Settings()}
                          >
                            保存页面设置
                          </Button>
                        </Space>
                      )}
                    >
                      <Space direction="vertical" size={12} className="page-stack" style={{ width: '100%' }}>
                        {page8SettingsNotice ? (
                          <Alert
                            showIcon
                            closable
                            type={page8SettingsNotice.tone}
                            message={page8SettingsNotice.text}
                            onClose={() => setPage8SettingsNotice(null)}
                          />
                        ) : null}
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          对局勾选与推送在「比赛历史」中完成：勾选「预告」列（最多 {PAGE8_MAX_MATCHES} 场，可勾选待开始与进行中的对局，已完成不可选）后点击「推送比赛预告」。
                        </Paragraph>
                        <Row gutter={[16, 16]}>
                          <Col xs={24} md={12}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>主标题：</Text>
                            <Input
                              maxLength={40}
                              placeholder="例如：赛事预告，可留空隐藏"
                              value={page8TitleDraft}
                              onChange={(event) => setPage8TitleDraft(event.target.value)}
                            />
                          </Col>
                          <Col xs={24} md={12}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>壁纸：</Text>
                            <Space wrap>
                              <Segmented
                                value={page8BackgroundDraft}
                                options={[
                                  { value: 'image', label: '图片1' },
                                  { value: 'image-2', label: '图片2' },
                                  { value: 'custom', label: '自定义' },
                                ]}
                                onChange={(value) => setPage8BackgroundDraft(value as Page8Background)}
                              />
                              <Upload
                                accept="image/*"
                                showUploadList={false}
                                beforeUpload={(file) => {
                                  void uploadPage8Wallpaper(file);
                                  return false;
                                }}
                              >
                                <Button size="small" loading={page8WallpaperUploading} disabled={page8BackgroundDraft === 'custom'}>
                                  上传壁纸
                                </Button>
                              </Upload>
                              {page8BackgroundDraft === 'custom' ? (
                                <Button size="small" danger loading={page8WallpaperUploading} onClick={() => void removePage8Wallpaper()}>
                                  删除壁纸
                                </Button>
                              ) : null}
                            </Space>
                          </Col>
                        </Row>
                      </Space>
                    </Card>
                  ) : null}
                  <div className="preview-frame-shell" ref={previewFrameShellRef}>
                    <div
                      className="preview-frame-viewport"
                      style={{ width: `${previewShellSize.width}px`, height: `${previewShellSize.height}px` }}
                    >
                      <div className="preview-frame-stage" style={{ transform: `scale(${previewScale})` }}>
                      <iframe title="preview" className="preview-frame" src={buildPreviewUrl(previewSlot)} />
                      </div>
                    </div>
                  </div>
                </Space>
              </Card>
            </Space>
          ) : null}

          {view === 'about' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card title="项目链接">
                <Space wrap size={12}>
                  <Link href="/login.html" target="_blank">登录页入口</Link>
                  <Link href="/admin.html" target="_blank">当前后台入口</Link>
                  <Link href="/roco-pvp-page3.html" target="_blank">推流页面 3</Link>
                  <Link href="rocom.shallow.ink" target="_blank">精灵图素材来源</Link>
                  <Link href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans" target="_blank">CC BY-NC-SA 4.0</Link>
                </Space>
              </Card>
              <Card>
                <Space direction="vertical" size={16} className="page-stack">
                      <div>
                        <Text className="eyebrow">About This Site</Text>
                        <Title level={3}>关于这应用的说明</Title>
                      </div>
                      <Paragraph>
                        这个应用面向洛克王国 PVP 直播场景，把赛事录入、阵容同步、比分控制、素材管理和推流页面预览统一收口到同一套 Ant Design 工作台里。
                      </Paragraph>
                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={8}>
                          <Card size="small" className="subtle-card">
                            <Title level={5}>赛事与比分统一管理</Title>
                            <Paragraph type="secondary">创建赛事、维护 BO 赛制、记录每小局胜负，并把当前状态同步到推流页面。</Paragraph>
                          </Card>
                        </Col>
                        <Col xs={24} md={8}>
                          <Card size="small" className="subtle-card">
                            <Title level={5}>左右阵容独立编辑</Title>
                            <Paragraph type="secondary">两边阵容可分别配置，并独立调节血量、能力值、透明度和饱和度。</Paragraph>
                          </Card>
                        </Col>
                        <Col xs={24} md={8}>
                          <Card size="small" className="subtle-card">
                            <Title level={5}>素材与预览联动</Title>
                            <Paragraph type="secondary">头像、推流页面 1/2/3 和等待页都能在后台里一起管理。</Paragraph>
                          </Card>
                        </Col>
                      </Row>
                      <Card size="small" className="subtle-card" title="作者与许可">
                        <Space direction="vertical" size={8} className="page-stack">
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            作者邮箱：<Link href="mailto:463218006@qq.com">463218006@qq.com</Link>
                          </Paragraph>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            本软件<Text strong>免费开源使用</Text>，基于 MIT License 发布，可自由使用、复制、修改与分发（分发时需保留版权声明与许可声明）。
                          </Paragraph>
                        </Space>
                      </Card>
                      <Card size="small" className="subtle-card" title="字体说明">
                        <Space direction="vertical" size={8} className="page-stack">
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            本项目内置了 <Text strong>MiSans</Text> 系列字体（精灵名字使用 MiSans-Medium、推流页面3 选手名字使用 MiSans-Regular 等）。
                          </Paragraph>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            以下推流页面使用了 <Text strong>YouSheBiaoTiHei</Text>（优设标题黑）字体，该字体<Text strong>未随软件打包</Text>，需要您在电脑上自行安装后才能正常显示，未安装时页面会自动回退到 MiSans：
                          </Paragraph>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            · 推流页面2（比分栏等标题）· 推流页面5（登场/胜率排行）· 推流页面6（比赛结果）· 等待页
                          </Paragraph>
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            下载 YouSheBiaoTiHei：
                            <Link href="https://www.fonts.net.cn/font-38213257557.html" target="_blank">免登录下载</Link>
                            &nbsp;·&nbsp;
                            <Link href="https://www.uisdc.com/uisdc-first-free-font" target="_blank">官网下载（需登录）</Link>
                          </Paragraph>
                        </Space>
                      </Card>
                      <Card size="small" className="subtle-card" title="数据来源">
                        <Space direction="vertical" size={8} className="page-stack">
                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            本应用相关数据由洛克魔法书（rocom.shallow.ink）提供，仅供娱乐参考。数据源于民间整理、用户授权接口返回或算法推断，非《洛克王国》官方数据，与官方无任何关联。游戏素材及版权归属于《洛克王国》项目组，准确信息请以官方游戏内为准。因使用数据产生的任何后果与争议，由使用者自行承担，本应用及洛克魔法书团队不承担任何责任。
                          </Paragraph>
                        </Space>
                      </Card>
                      <Card size="small" className="subtle-card" title="更新日志">
                        <Timeline
                          items={CHANGELOG.map((entry) => ({
                            color: entry.version === '1.5.1' ? 'gold' : 'gray',
                            children: (
                              <Space direction="vertical" size={4}>
                                <Space wrap>
                                  <Text strong>v{entry.version}</Text>
                                  {entry.date ? <Text type="secondary">{entry.date}</Text> : null}
                                </Space>
                                <ul className="changelog-list">
                                  {entry.items.map((item) => (
                                    <li key={item}>
                                      <Text type="secondary">{item}</Text>
                                    </li>
                                  ))}
                                </ul>
                              </Space>
                            ),
                          }))}
                        />
                      </Card>
                    </Space>
                  </Card>
            </Space>
          ) : null}
        </Content>
      </Layout>

      <Modal
        title="快速创建比赛"
        open={quickCreateOpen}
        onCancel={() => setQuickCreateOpen(false)}
        onOk={() => void quickCreateMatches()}
        okText="随机配对创建"
        cancelText="取消"
        confirmLoading={quickCreateSaving}
        width={640}
      >
        <Form layout="vertical">
          <Form.Item
            label="参赛选手（可多选，支持搜索；选择数量必须为双数）"
            required
            extra={(() => {
              const count = quickCreatePlayerNames.length;
              const isEven = count % 2 === 0;
              return (
                <Text type={isEven ? 'secondary' : 'danger'}>
                  已选择 {count} 人{count > 0 && !isEven ? ' —— 当前为奇数，会存在一场不足 2 名选手的对局，请再选 1 名或去掉 1 名' : ''}
                </Text>
              );
            })()}
          >
            <Input
              allowClear
              prefix={<span style={{ color: '#999' }}>搜索</span>}
              placeholder="输入选手名字过滤"
              value={quickCreateKeyword}
              onChange={(event) => setQuickCreateKeyword(event.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div
              style={{
                maxHeight: 240,
                overflowY: 'auto',
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                padding: 4,
                background: '#fff',
              }}
            >
              {quickCreatePlayerList
                .filter((player) => {
                  const keyword = quickCreateKeyword.trim().toLowerCase();
                  return !keyword || player.name.toLowerCase().includes(keyword);
                })
                .map((player) => {
                  const checked = quickCreatePlayerNames.includes(player.name);
                  return (
                    <div
                      key={player.id}
                      onClick={() => toggleQuickCreatePlayer(player.name)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: checked ? '#e6f4ff' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        userSelect: 'none',
                      }}
                    >
                      <Checkbox checked={checked} />
                      <span>{player.name}</span>
                      {player.rank ? <Text type="secondary" style={{ fontSize: 12 }}>（排名 {player.rank}）</Text> : null}
                    </div>
                  );
                })}
              {quickCreatePlayerList.filter((player) => {
                const keyword = quickCreateKeyword.trim().toLowerCase();
                return !keyword || player.name.toLowerCase().includes(keyword);
              }).length === 0 ? (
                <Text type="secondary" style={{ display: 'block', padding: '10px 12px' }}>
                  无匹配选手
                </Text>
              ) : null}
            </div>
          </Form.Item>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item label="比赛赛制">
                <Select
                  style={{ width: '100%' }}
                  value={quickCreateBestOf}
                  onChange={(value) => setQuickCreateBestOf(value as number)}
                  options={[
                    { value: 1, label: 'BO1' },
                    { value: 3, label: 'BO3' },
                    { value: 5, label: 'BO5' },
                    { value: 7, label: 'BO7' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="赛事标签（可选）">
                <Select
                  mode="multiple"
                  allowClear
                  style={{ width: '100%' }}
                  placeholder="可选，选择赛事标签"
                  value={quickCreateTags}
                  onChange={(value) => setQuickCreateTags(value as string[])}
                  options={allHistoryTags.map((tag) => ({ value: tag, label: tag }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            确认后将把所选选手随机洗牌并两两配对，为每对生成一场比赛（同「开一局」创建），保证配对随机、避免固定对阵造成的公平性问题。
          </Paragraph>
        </Form>
      </Modal>

      <Modal
        title={activeMatch ? `战队修改：${activeMatch.leftPlayer || '左侧'} vs ${activeMatch.rightPlayer || '右侧'}` : '战队修改'}
        open={teamEditOpen}
        onCancel={() => setTeamEditOpen(false)}
        onOk={() => teamEditForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={teamEditSaving}
      >
        <Form
          form={teamEditForm}
          layout="vertical"
          onFinish={(values) => void saveTeamEdit(values)}
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item label="左侧所属战队（可选）" name="leftTeam">
                <AutoComplete
                  maxLength={40}
                  style={{ width: '100%' }}
                  placeholder="选择已录入战队复用，或手动输入"
                  options={(profiles?.teams ?? []).map((team) => ({ value: team.name, label: team.name }))}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="右侧所属战队（可选）" name="rightTeam">
                <AutoComplete
                  maxLength={40}
                  style={{ width: '100%' }}
                  placeholder="选择已录入战队复用，或手动输入"
                  options={(profiles?.teams ?? []).map((team) => ({ value: team.name, label: team.name }))}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  allowClear
                />
              </Form.Item>
            </Col>
          </Row>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            选择「信息录入」中的战队会自动复用其 id（推流页 3 可展示战队 logo）；手动输入则仅记录战队名称。
          </Paragraph>
        </Form>
      </Modal>

      <Modal
        title="创建赛事"
        open={createMatchOpen}
        onCancel={() => {
          setCreateMatchOpen(false);
          clearCreateAvatars();
        }}
        onOk={() => createMatchForm.submit()}
        okText="创建比赛"
        cancelText="取消"
      >
        <Form
          form={createMatchForm}
          layout="vertical"
          initialValues={{ bestOf: 3, tags: [] }}
          onFinish={(values) => void createMatch(values)}
        >
          <Form.Item label="左侧选手" name="leftPlayer" rules={[{ required: true, message: '请输入左侧选手名' }]}>
            <AutoComplete
              maxLength={32}
              style={{ width: '100%' }}
              placeholder="输入名字联想「信息录入」选手，选中后自动复用头像与排名"
              options={(profiles?.players ?? []).map((player) => ({ value: player.name, label: `${player.name}${player.rank ? `（排名 ${player.rank}）` : ''}` }))}
              filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              onSelect={(value) => {
                const player = (profiles?.players ?? []).find((item) => item.name === value);
                if (player) {
                  void reusePlayerProfile('left', player);
                }
              }}
            />
          </Form.Item>
          <Form.Item label="右侧选手" name="rightPlayer" rules={[{ required: true, message: '请输入右侧选手名' }]}>
            <AutoComplete
              maxLength={32}
              style={{ width: '100%' }}
              placeholder="输入名字联想「信息录入」选手，选中后自动复用头像与排名"
              options={(profiles?.players ?? []).map((player) => ({ value: player.name, label: `${player.name}${player.rank ? `（排名 ${player.rank}）` : ''}` }))}
              filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              onSelect={(value) => {
                const player = (profiles?.players ?? []).find((item) => item.name === value);
                if (player) {
                  void reusePlayerProfile('right', player);
                }
              }}
            />
          </Form.Item>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item
                label="左侧选手排位排名（可选）"
                name="leftRank"
                id="createLeftRank"
                getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}
              >
                <Input maxLength={10} inputMode="numeric" placeholder="仅数字，例如：123" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="右侧选手排位排名（可选）"
                name="rightRank"
                id="createRightRank"
                getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}
              >
                <Input maxLength={10} inputMode="numeric" placeholder="仅数字，例如：456" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item label="左侧所属战队（可选）" name="leftTeam">
                <AutoComplete
                  maxLength={40}
                  style={{ width: '100%' }}
                  placeholder="选择已录入战队复用，或手动输入"
                  options={(profiles?.teams ?? []).map((team) => ({ value: team.name, label: team.name }))}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="右侧所属战队（可选）" name="rightTeam">
                <AutoComplete
                  maxLength={40}
                  style={{ width: '100%' }}
                  placeholder="选择已录入战队复用，或手动输入"
                  options={(profiles?.teams ?? []).map((team) => ({ value: team.name, label: team.name }))}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  allowClear
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item label="左侧选手头像（留空则使用默认）">
                <div className="create-avatar-row">
                  <div className="player-avatar-circular">
                    {createLeftAvatarUrl ? (
                      <img src={createLeftAvatarUrl} alt="左侧头像预览" />
                    ) : (
                      <Image preview={false} src="/assets/ui/left-avatar.png" alt="左侧头像预览" />
                    )}
                  </div>
                  <Upload
                    showUploadList={false}
                    beforeUpload={(file) => {
                      pickCreateAvatar('left', file as File);
                      return false;
                    }}
                  >
                    <Button>选择头像</Button>
                  </Upload>
                </div>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="右侧选手头像（留空则使用默认）">
                <div className="create-avatar-row">
                  <div className="player-avatar-circular">
                    {createRightAvatarUrl ? (
                      <img src={createRightAvatarUrl} alt="右侧头像预览" />
                    ) : (
                      <Image preview={false} src="/assets/ui/right-avatar.png" alt="右侧头像预览" />
                    )}
                  </div>
                  <Upload
                    showUploadList={false}
                    beforeUpload={(file) => {
                      pickCreateAvatar('right', file as File);
                      return false;
                    }}
                  >
                    <Button>选择头像</Button>
                  </Upload>
                </div>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="比赛赛制" name="bestOf" rules={[{ required: true, message: '请选择比赛赛制' }]}>
            <Select
              style={{ width: '100%' }}
              options={[
                { value: 1, label: 'BO1' },
                { value: 3, label: 'BO3' },
                { value: 5, label: 'BO5' },
                { value: 7, label: 'BO7' },
              ]}
            />
          </Form.Item>
          <Form.Item label="赛事标签" name="tags">
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder="可选，选择赛事标签"
              options={allHistoryTags.map((tag) => ({ value: tag, label: tag }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingPlayer ? `编辑选手：${editingPlayer.name}` : '新增选手'}
        open={playerEditorOpen}
        onCancel={() => {
          setPlayerEditorOpen(false);
          clearProfileEditorImages();
        }}
        onOk={() => playerProfileForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={playerSaving}
      >
        <Form
          form={playerProfileForm}
          layout="vertical"
          onFinish={(values) => void savePlayerProfile(values)}
        >
          <Form.Item label="选手头像（可选）">
            <div className="create-avatar-row">
              <div className="player-avatar-circular">
                {playerAvatarUrl ? (
                  <img src={playerAvatarUrl} alt="选手头像预览" />
                ) : editingPlayer?.avatarExists ? (
                  <Image
                    preview={false}
                    src={`/runtime/profiles/players/${encodeURIComponent(editingPlayer.id)}.png?t=${editingPlayer.avatarMtime ?? 0}`}
                    alt="当前头像"
                  />
                ) : (
                  <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认头像" />
                )}
              </div>
              <Upload
                showUploadList={false}
                beforeUpload={(file) => {
                  pickPlayerAvatar(file as File);
                  return false;
                }}
              >
                <Button>选择头像</Button>
              </Upload>
            </div>
          </Form.Item>
          <Form.Item label="名字" name="name" rules={[{ required: true, message: '请输入选手名字' }]}>
            <Input maxLength={32} placeholder="例如：选手A（同名保存会更新已有录入）" />
          </Form.Item>
          <Form.Item label="排名（可选）" name="rank" getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) => event.target.value.replace(/\D/g, '')}>
            <Input maxLength={10} inputMode="numeric" placeholder="仅数字，例如：123" />
          </Form.Item>
          <Form.Item label={`常用精灵（点击选择，最多 6 个，可选可不选）当前已选 ${playerPetEditorValue.length}/6`} name="pets">
            <Input
              allowClear
              prefix={<span style={{ color: '#999' }}>搜索</span>}
              placeholder="输入精灵名字快速过滤"
              value={petEditorKeyword}
              onChange={(event) => setPetEditorKeyword(event.target.value)}
              style={{ marginBottom: 8 }}
            />
            <div
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                padding: 6,
                maxHeight: 320,
                overflowY: 'auto',
                background: '#fff',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {playerPetGridItems
                  .filter((sprite) => {
                    const keyword = petEditorKeyword.trim().toLowerCase();
                    return !keyword || sprite.displayName.toLowerCase().includes(keyword);
                  })
                  .map((sprite) => {
                    const name = sprite.displayName.trim();
                    const selected = playerPetEditorSelected.has(name);
                    return (
                      <div
                        key={`${name}-${sprite.id}`}
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() => togglePetInEditor(name)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 8px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: selected ? '#e6f4ff' : 'transparent',
                          border: selected ? '1px solid #91caff' : '1px solid transparent',
                          userSelect: 'none',
                        }}
                      >
                        <span
                          style={{
                            width: 40,
                            height: 40,
                            flexShrink: 0,
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 6,
                            background: 'rgba(0,0,0,0.03)',
                          }}
                        >
                          <img
                            src={sprite.iconUrl || sprite.path}
                            alt={name}
                            style={{ width: 36, height: 36, objectFit: 'contain' }}
                            loading="lazy"
                          />
                        </span>
                        <Text style={{ fontSize: 13, lineHeight: 1.2 }} ellipsis={{ tooltip: name }}>
                          {name}
                        </Text>
                        {selected ? <span style={{ marginLeft: 'auto', color: '#1677ff', fontSize: 14 }}>✓</span> : null}
                      </div>
                    );
                  })}
                {playerPetGridItems.filter((sprite) => {
                  const keyword = petEditorKeyword.trim().toLowerCase();
                  return !keyword || sprite.displayName.toLowerCase().includes(keyword);
                }).length === 0 ? (
                  <Text type="secondary" style={{ padding: '10px 12px' }}>无匹配精灵</Text>
                ) : null}
              </div>
            </div>
          </Form.Item>
          <Form.Item label="宣言（可选）" name="declaration">
            <TextArea rows={2} maxLength={120} placeholder="例如：目标冠军！" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入选手（JSON）"
        open={playerImportOpen}
        onCancel={() => setPlayerImportOpen(false)}
        onOk={() => void confirmPlayerImport()}
        okText="确认导入"
        cancelText="取消"
        confirmLoading={playerImporting}
        width={560}
      >
        <Paragraph>
          将导入 <Text strong>{playerImportPreview.length}</Text> 条选手记录。仅识别以下英文字段，其余字段一律忽略（防止恶意字段注入）：
        </Paragraph>
        <Space size={16} wrap style={{ marginBottom: 12 }}>
          <span><Text code>name</Text> <Text type="secondary">选手名字（必填）</Text></span>
          <span><Text code>rank</Text> <Text type="secondary">排位排名（仅数字）</Text></span>
          <span><Text code>declaration</Text> <Text type="secondary">宣言</Text></span>
          <span><Text code>pets</Text> <Text type="secondary">常用精灵（需在 pets.json 中命中）</Text></span>
        </Space>
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          同名选手将更新其排名、宣言与常用精灵，并保留原头像。常用精灵仅在 pets.json 精确命中时录入，未命中的会在导入后提示并给出候选。
        </Paragraph>
        <Table
          size="small"
          rowKey={(record, index) => `${index}`}
          dataSource={playerImportPreview}
          pagination={false}
          scroll={{ y: 220 }}
          locale={{ emptyText: '无可导入记录' }}
          columns={[
            { title: '名字', dataIndex: 'name', key: 'name', render: (value: string) => <Text strong>{value}</Text> },
            { title: '排位排名', dataIndex: 'rank', key: 'rank', width: 90, render: (value: string) => value || '-' },
            { title: '常用精灵', dataIndex: 'pets', key: 'pets', ellipsis: true, render: (value: string) => value || '-' },
            { title: '宣言', dataIndex: 'declaration', key: 'declaration', ellipsis: true, render: (value: string) => value || '-' },
          ]}
        />
      </Modal>

      <Modal
        title="常用精灵需要人工确认"
        open={playerImportReviewOpen}
        onOk={() => void applyPetReviewChoices()}
        okText="确认（写入选中的精灵）"
        cancelText="忽略全部"
        onCancel={() => {
          setPlayerImportReviewOpen(false);
          setPlayerImportReview([]);
          setPetReviewSelection({});
        }}
        width={560}
      >
        <Paragraph>
          有 <Text strong>{playerImportReview.length}</Text> 个常用精灵未在 pets.json 中命中，选手的其它信息已正常导入。请在下方选择正确的精灵以录入（每条最多 5 个候选），或忽略。
        </Paragraph>
        {playerImportReview.map((item, index) => (
          <div key={`${item.name}-${index}`} style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <Text strong>{item.name}</Text>
              <Text type="secondary">：「{item.input}」未匹配到</Text>
            </div>
            <Select
              allowClear
              showSearch
              style={{ width: '100%' }}
              placeholder={item.candidates.length > 0 ? '选择候选精灵（可留空忽略）' : '无匹配候选，已跳过'}
              value={petReviewSelection[index]}
              disabled={item.candidates.length === 0}
              filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())}
              onChange={(value) => setPetReviewSelection((prev) => ({ ...prev, [index]: String(value ?? '') }))}
              options={item.candidates.map((candidate) => ({
                value: candidate.name,
                label: `${candidate.name}${candidate.number != null ? `（编号 ${candidate.number}）` : ''}`,
              }))}
            />
          </div>
        ))}
      </Modal>

      <Modal
        title="批量头像预览"
        open={avatarBatchConfirmOpen}
        onCancel={() => {
          setAvatarBatchConfirmOpen(false);
          clearAvatarBatchPreview();
        }}
        onOk={() => void confirmPlayerAvatarBatch()}
        okText={`确认覆盖（${avatarBatchPreview.length} 张）`}
        cancelText="取消"
        confirmLoading={avatarBatchUploading}
        width={620}
      >
        <Paragraph>
          已按文件名匹配 <Text strong>{avatarBatchPreview.length}</Text> 位选手，确认后覆盖原头像（统一压缩为 480×480 PNG）；未匹配的文件不会上传。
        </Paragraph>
        {avatarBatchSkipped.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${avatarBatchSkipped.length} 个文件未匹配到已录入选手，将不上传：${avatarBatchSkipped.join('、')}`}
          />
        ) : null}
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {avatarBatchPreview.map((item, index) => (
            <div
              key={`${item.player.id}-${index}`}
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
            >
              <div style={{ textAlign: 'center' }}>
                <Image
                  preview={false}
                  width={56}
                  height={56}
                  style={{ borderRadius: 8, objectFit: 'cover' }}
                  src={item.player.avatarExists
                    ? `/runtime/profiles/players/${encodeURIComponent(item.player.id)}.png?t=${item.player.avatarMtime ?? 0}`
                    : '/assets/ui/left-avatar.png'}
                />
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.player.avatarExists ? '原头像' : '原头像（未设置）'}
                  </Text>
                </div>
              </div>
              <Text type="secondary">→</Text>
              <div style={{ textAlign: 'center' }}>
                <Image preview={false} width={56} height={56} style={{ borderRadius: 8, objectFit: 'cover' }} src={item.url} />
                <div><Text type="secondary" style={{ fontSize: 12 }}>新头像</Text></div>
              </div>
              <Text strong style={{ marginLeft: 'auto', marginRight: 8 }}>{item.player.name}</Text>
            </div>
          ))}
        </div>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          同一选手匹配到多张图片时以后上传的为准；确认后按文件名覆盖对应选手档案。
        </Paragraph>
      </Modal>

      <Modal
        title="批量头像上传结果"
        open={avatarBatchResultOpen}
        onCancel={() => setAvatarBatchResultOpen(false)}
        footer={null}
        width={520}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {(avatarBatchResult?.matched ?? 0) > 0 ? (
            <Alert type="success" showIcon message={`已为 ${avatarBatchResult?.matched} 位选手更新头像（统一压缩为 480×480 PNG）`} />
          ) : null}
          {(avatarBatchResult?.unmatched.length ?? 0) > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`${avatarBatchResult?.unmatched.length} 张图片未匹配到已录入选手名字，已跳过`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {avatarBatchResult?.unmatched.map((name, index) => (
                    <li key={`${name}-${index}`}>{name}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          {(avatarBatchResult?.failed.length ?? 0) > 0 ? (
            <Alert
              type="error"
              showIcon
              message={`${avatarBatchResult?.failed.length} 张图片处理失败`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {avatarBatchResult?.failed.map((item, index) => (
                    <li key={`${item.name}-${index}`}>{item.name}：{item.reason}</li>
                  ))}
                </ul>
              }
            />
          ) : null}
          <Text type="secondary">提示：图片文件名（去掉扩展名）需与已录入选手名字一致，例如「小明.png」匹配选手「小明」。</Text>
        </Space>
      </Modal>

      <Modal
        title={editingTeam ? `编辑战队：${editingTeam.name}` : '新增战队'}
        open={teamEditorOpen}
        onCancel={() => {
          setTeamEditorOpen(false);
          clearProfileEditorImages();
        }}
        onOk={() => teamProfileForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={teamSaving}
      >
        <Form
          form={teamProfileForm}
          layout="vertical"
          onFinish={(values) => void saveTeamProfile(values)}
        >
          <Form.Item label="战队 Logo / 头像（可选）">
            <div className="create-avatar-row">
              <div className="player-avatar-circular">
                {teamLogoUrl ? (
                  <img src={teamLogoUrl} alt="战队logo预览" />
                ) : editingTeam?.logoExists ? (
                  <Image
                    preview={false}
                    src={`/runtime/profiles/teams/${encodeURIComponent(editingTeam.id)}.png?t=${editingTeam.logoMtime ?? 0}`}
                    alt="当前logo"
                  />
                ) : (
                  <Image preview={false} src="/assets/ui/left-avatar.png" alt="默认logo" />
                )}
              </div>
              <Upload
                showUploadList={false}
                beforeUpload={(file) => {
                  pickTeamLogo(file as File);
                  return false;
                }}
              >
                <Button>选择图片</Button>
              </Upload>
            </div>
          </Form.Item>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Form.Item label="战队名称" name="name" rules={[{ required: true, message: '请输入战队名称' }]}>
                <Input maxLength={40} placeholder="例如：星辰战队（同名保存会更新已有录入）" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="队长名称（可选）" name="captain">
                <Input maxLength={32} placeholder="例如：选手A" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="宣言（可选）" name="declaration">
            <TextArea rows={2} maxLength={120} placeholder="例如：为荣耀而战！" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}

export function AdminApp() {
  return (
    <ConfigProvider theme={theme} locale={zhCN}>
      <App>
        <Dashboard />
      </App>
    </ConfigProvider>
  );
}
