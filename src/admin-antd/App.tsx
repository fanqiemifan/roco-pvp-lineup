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
  Drawer,
  Dropdown,
  Form,
  Image,
  Input,
  InputNumber,
  Layout,
  List,
  Menu,
  Modal,
  Popconfirm,
  Radio,
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
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import {
  CLOUD_SYNC_POLL_INTERVALS,
  CLOUD_SYNC_ROSTER_MAX,
  DEFAULT_PAGE7_SWITCH_SECONDS,
  MVP_MAX_ITEMS,
  MVP_TAG_MAX_LENGTH,
  PAGE16_CARD_LABEL_OPTIONS,
  PAGE7_SWITCH_MAX_SECONDS,
  PAGE7_SWITCH_MIN_SECONDS,
  SYNC_BUNDLE_MAX_BYTES,
} from '../../shared/constants';
import type {
  AvatarCollectionState,
  CloudSyncAckSource,
  CloudSyncKeyGuardResult,
  CloudSyncPendingQueue,
  CloudSyncStatus,
  CloudSyncVersion,
  MachineCodeGuardResult,
  SyncImportTournamentGroup,
  CountdownPayload,
  CountdownState,
  MatchRecord,
  MatchStoreState,
  MvpSlotEntry,
  MvpState,
  MvpWinnerSnapshot,
  NextGamePayload,
  Page6State,
  Page7State,
  Page8State,
  Page9State,
  Page11State,
  Page14State,
  PanelState,
  PlayerProfile,
  ProfileStoreState,
  ScoreboardState,
  SpriteSource,
  Page3RedLightMode,
  Page16CardLabel,
  SlotState,
  SpriteRecord,
  StageConfig,
  StagePageKey,
  StageStandings,
  StageTransitionType,
  SyncBundle,
  SyncConflictMode,
  SyncImportCounts,
  SyncImportItem,
  SyncImportPreview,
  SyncImportResult,
  TeamProfile,
} from '../../shared/types';

import {
  DEFAULT_TAGS,
  EXCLUSIVE_FORM_FILTERS,
  MVP_TAG_PRESETS,
  STAGE_OPTIONS,
  STAGE_TRANSITION_OPTIONS,
  normalizeStagePage,
  normalizeStageTransition,
} from './constants';
import { rocoTheme } from '../theme';
import { AdminDataProvider } from './data/admin-data';
import { useAdminData } from './data/use-admin-data';
import { StageThumb } from './components/StageThumb';
import { SettingField } from './components/SettingField';
import { MatchPushCard } from './components/MatchPushCard';
import type { MatchPushKind, MatchPushPayload } from './components/MatchPushCard';
import { AdvanceRankCard } from './components/AdvanceRankCard';
import type { AdvanceRankPayload } from './components/AdvanceRankCard';
import { LiveWatchCard } from './components/LiveWatchCard';
import { formatDateTime } from './lib/format';
import {
  buildHistoryBattleEntries,
  buildHistoryCsv,
  buildHistoryLineupEntries,
  buildHistoryTags,
  buildHistoryTournamentFilters,
  filterLocallyRemovedMatches,
  getEffectiveTournamentId,
  getHistoryVisibleGames,
  getLineupEntryBlockReason,
  LINEUP_ENTRY_BLOCK_TEXT,
  PLAIN_HISTORY_MATCH_FILTER,
} from './lib/history';
import {
  buildPushCandidateGroups,
  formatStageRoundLabel,
  resolveMatchSemanticRound,
} from './lib/tournament';
import {
  LIVE_WATCH_POLL_MS,
  clampNumber,
  createLiveWatchSnapshot,
  extractLiveConfigPanel,
  findConfigTargetIndex,
  formatWatchError,
  getEnergyLevel,
  getHealthLevel,
  readNumberField,
  readStoredLiveWatchPath,
  stringifyLiveConfig,
  writeStoredLiveWatchPath,
  type LiveWatchSnapshot,
} from './lib/live';
import {
  buildProgressItems,
  getActiveMatch,
  getCurrentGame,
  getGameResultLabel,
  getGameStatusLabel,
  getNoticeTagColor,
  getRecentWinnerLineup,
  summarizeSeriesForBestOf,
} from './lib/match';
import {
  buildPanelRequest,
  cloneSelected,
  createDefaultSpriteFilterState,
  createEmptySlot,
  createSpriteFilterState,
} from './lib/panel';
import {
  PREVIEW_NAV_GROUPS,
  buildPreviewUrl,
  getLocalAddressText,
  getPreviewNavLabel,
} from './lib/preview';
import { copyText, requestJson, requestQuickFillMatches, uploadSingleFile } from './lib/request';
import { renderProfileTemplateXlsx } from './lib/profile-template-xlsx';
import type { ProfileXlsxImportResponse, ProfileXlsxPreviewResponse } from './types';
import { buildSpriteLookup } from './lib/sprite';
import { deriveMatchActionAvailability } from './lib/match-actions';
import { buildMvpProgressItems } from './lib/mvp';
import { CurrentMatchPanel } from './components/CurrentMatchPanel';
import { MatchLineupDetailPanel } from './views/MatchLineupDetailModal';
import { HistoryLineupEntryModal } from './views/HistoryLineupEntryModal';
import { RosterPanelEditor } from './views/RosterPanelEditor';
import { StatsView } from './views/StatsView';
import { SyncView } from './views/SyncView';
import { TournamentView } from './views/TournamentView';

import { type StatsMetricKey } from './lib/stats';

import rosterIcon from '../assets/ui/赛事面板.svg?raw';
import stageIcon from '../assets/ui/直播推流.svg?raw';
import liveIcon from '../assets/ui/实时控制.svg?raw';
import mvpIcon from '../assets/ui/结算页面.svg?raw';
// 图标沿用原「比赛历史」素材文件名，改文案时别动这里
import historyIcon from '../assets/ui/比赛历史.svg?raw';
import syncIcon from '../assets/ui/数据同步.svg?raw';
import profilesIcon from '../assets/ui/信息录入.svg?raw';
import introIcon from '../assets/ui/选手介绍.svg?raw';
import statsIcon from '../assets/ui/数据统计.svg?raw';
import previewIcon from '../assets/ui/页面预览.svg?raw';
import aboutIcon from '../assets/ui/关于项目.svg?raw';
import tournamentIcon from '../assets/ui/系列比赛.svg?raw';
import brandLogoRaw from '../assets/ui/logo.svg?raw';
import streamGuideAddress from '../assets/stream-guide/address-locate.png';
import streamGuideObs1 from '../assets/stream-guide/obs-1.png';
import streamGuideObs2 from '../assets/stream-guide/obs-2.png';
import streamGuideHime1 from '../assets/stream-guide/hime-1.png';
import streamGuideHime2 from '../assets/stream-guide/hime-2.png';
import streamGuideHime3 from '../assets/stream-guide/hime-3.png';
import type {
  CreateMatchValues,
  LiveField,
  MatchFormValues,
  NoticeState,
  PanelEditorState,
  PanelSide,
  PlayerAvatarBatchResponse,
  PlayerProfileFormValues,
  PreviewSlotKey,
  SpriteFilterState,
  TeamProfileFormValues,
  ViewKey,
} from './types';
import { Hint } from './ui/Hint';
import { MatchStatusTag } from './ui/StatusTag';
import { MODAL_WIDTH } from './ui/modal';
import { Surface } from './ui/Surface';
import { EmptyState } from './ui/EmptyState';

const { Header, Sider, Content } = Layout;
const { Title, Paragraph, Text, Link } = Typography;
const { TextArea } = Input;

/** 切换当前赛事确认弹窗的「不再提示」标记：按浏览器本地记忆（localStorage），跨会话保留 */
const SELECT_MATCH_CONFIRM_SUPPRESSED_KEY = 'roco-pvp-lineup:selectMatchConfirmSuppressed';

/** 比赛列表懒加载：一次渲染 6 条，滚动到底部再加载 6 条，赛事很多时避免全量渲染 */
const MATCH_LIST_PAGE_SIZE = 6;

/** 比赛列表行：分组标题行 或 比赛卡片行（扁平化后供懒加载切片） */
type DashboardListRow =
  | { rowType: 'group'; key: string; title: string; count: number }
  | { rowType: 'match'; key: string; match: MatchRecord };

function isSelectMatchConfirmSuppressed(): boolean {
  try {
    return window.localStorage.getItem(SELECT_MATCH_CONFIRM_SUPPRESSED_KEY) === '1';
  } catch {
    return false;
  }
}

function setSelectMatchConfirmSuppressed(suppressed: boolean): void {
  try {
    if (suppressed) {
      window.localStorage.setItem(SELECT_MATCH_CONFIRM_SUPPRESSED_KEY, '1');
    } else {
      window.localStorage.removeItem(SELECT_MATCH_CONFIRM_SUPPRESSED_KEY);
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：每次都提示
  }
}

/** 导航栏各视图对应的 SVG 图标（Assets 里提供的自定义图标），使用当前上下文颜色自适应 */
type NavIconName = 'roster' | 'stage' | 'live' | 'mvp' | 'history' | 'sync' | 'profiles' | 'page11' | 'stats' | 'preview' | 'tournament' | 'about';

/** 各导航视图对应的标题文案（与导航栏标签一致），顶部栏按当前视图显示 */
const VIEW_LABEL: Record<NavIconName, string> = {
  roster: '赛事面板',
  stage: '直播推流',
  live: '实时控制',
  mvp: '结算画面',
  history: '比赛管理',
  sync: '数据同步',
  profiles: '信息录入',
  page11: '选手介绍',
  stats: '数据统计',
  preview: '页面预览',
  tournament: '系列比赛',
  about: '关于项目',
};

const NAV_ICONS: Record<NavIconName, string> = {
  roster: rosterIcon,
  stage: stageIcon,
  live: liveIcon,
  mvp: mvpIcon,
  history: historyIcon,
  sync: syncIcon,
  profiles: profilesIcon,
  page11: introIcon,
  stats: statsIcon,
  preview: previewIcon,
  tournament: tournamentIcon,
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

/**
 * 推流页选场上限：比赛结果 / 比赛预告均为 9 场（3×3 卡片网格，结构决定）；
 * 战绩详情（page7）画面是一屏 4 行 + 整屏过渡，行数不影响结构，**不设上限**（不传 maxCount），
 * 支持整届 / 按阶段·波次勾选，规模提示由弹窗里的「已选 N 场 ≈ M 屏」承担。
 */
const PAGE6_MAX_MATCHES = 9;
const PAGE8_MAX_MATCHES = 9;
/** 团队积分榜（page9）后台可录入的战队行数 */
const PAGE9_TEAM_COUNT = 4;

/** MVP 结算（推流页面4）空槽位：后台固定展示 MVP_MAX_ITEMS 行 */
function createEmptyMvpSlots(): MvpSlotEntry[] {
  return Array.from({ length: MVP_MAX_ITEMS }, () => ({ petId: '', tag: '', isMvp: false }));
}

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

/**
 * 倒计时剩余时间显示：把 running 时的 500ms 节拍下沉在这个小组件内部，
 * 避免节拍每 0.5 秒触发整个 Dashboard（6000+ 行单组件）协调一遍。
 */
function CountdownRemainingText({ state, clockOffsetMs }: { state: CountdownState; clockOffsetMs: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!state.running) {
      return;
    }
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 500);
    return () => window.clearInterval(timer);
  }, [state.running]);

  const totalSeconds = !state.running || state.endAt === null
    ? Math.max(0, Math.round(state.remainingSeconds))
    : Math.max(0, Math.ceil((state.endAt - (Date.now() + clockOffsetMs)) / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;

  return (
    <Text strong style={{ fontSize: 16 }}>
      剩余 {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
    </Text>
  );
}

function Dashboard() {
  const { message, modal } = App.useApp();
  // 共享数据层（M1）：服务端状态、socket 订阅、初始加载与云同步轮询统一由 AdminDataProvider 持有。
  // 这里只留「仪表盘/视图自己的 UI 状态」（弹窗、草稿、筛选、当前 tab），后续按视图继续下沉。
  const {
    loading,
    pageError,
    scoreboard,
    matchStore,
    avatars,
    panels,
    sprites,
    stage,
    nextgame,
    countdown,
    countdownClockRef,
    mvp,
    mvpWinner,
    page6,
    page7,
    page8,
    page9,
    page11,
    page14,
    page14Standings,
    profiles,
    tournaments,
    locallyRemoved,
    recycleBin,
    machineCodeInput,
    cloudStatus,
    cloudKeyDraft,
    cloudTokenDraft,
    cloudRoleDraft,
    cloudWorkerUrlDraft,
    cloudLabelDraft,
    cloudPeerDraft,
    cloudBusy,
    cloudAckedMatchIds,
    setAvatars,
    setPanels,
    setStage,
    setPage14,
    setPage14Standings,
    setProfiles,
    setMachineCodeInput,
    setCloudKeyDraft,
    setCloudTokenDraft,
    setCloudRoleDraft,
    setCloudWorkerUrlDraft,
    setCloudLabelDraft,
    setCloudPeerDraft,
    setCloudBusy,
    applyServerState,
    loadInitialData,
    applyCloudStatus,
    postCloud,
    pollCloudStatus,
  } = useAdminData();
  const [view, setView] = useState<ViewKey>('roster');
  // 导航栏收起状态：收起后仅显示 SVG 图标
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  // 顶栏弹窗开关：倒计时 / 下一场预告 / 画面设置（页面2、页面3、选手介绍、画面切换行为）
  const [countdownModalOpen, setCountdownModalOpen] = useState(false);
  const [nextgameModalOpen, setNextgameModalOpen] = useState(false);
  const [screenSettingsModalOpen, setScreenSettingsModalOpen] = useState(false);
  // 顶栏弹窗开关：直播推送教程（获取推流地址 + OBS / 直播姬填入方式）
  const [streamGuideOpen, setStreamGuideOpen] = useState(false);
  const [createLeftAvatar, setCreateLeftAvatar] = useState<File | null>(null);
  const [createRightAvatar, setCreateRightAvatar] = useState<File | null>(null);
  const [createLeftAvatarUrl, setCreateLeftAvatarUrl] = useState<string | null>(null);
  const [createRightAvatarUrl, setCreateRightAvatarUrl] = useState<string | null>(null);
  // 赛事面板阵容编辑器共享一份精灵筛选
  const [spriteFilter, setSpriteFilter] = useState<SpriteFilterState>(createDefaultSpriteFilterState);
  // 赛事面板共享精灵搜索（输入即时回显，过滤用 useDeferredValue 防抖）
  const [rosterSearch, setRosterSearch] = useState('');
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
  /** 战队修改的目标比赛（赛事面板即当前比赛；系列比赛 Drawer 里可能是别的场次） */
  const [teamEditTargetId, setTeamEditTargetId] = useState<string | null>(null);
  const [teamEditForm] = Form.useForm<{ leftTeam?: string; rightTeam?: string }>();
  /** 系列比赛对局卡片：右键菜单 / Drawer 弹窗正在操作的那一场（null = 未打开） */
  const [matchPanelTargetId, setMatchPanelTargetId] = useState<string | null>(null);
  const [editingHistoryTagMatchId, setEditingHistoryTagMatchId] = useState<string | null>(null);
  const [editingHistoryTagValues, setEditingHistoryTagValues] = useState<string[]>([]);
  const [savingHistoryTagMatchId, setSavingHistoryTagMatchId] = useState<string | null>(null);
  const [selectedHistoryKeys, setSelectedHistoryKeys] = useState<React.Key[]>([]);
  const [expandedHistoryKeys, setExpandedHistoryKeys] = useState<React.Key[]>([]);
  const [historyTagFilter, setHistoryTagFilter] = useState<string | null>(null);
  // 系列赛维度筛选（独立于标签）：PLAIN_HISTORY_MATCH_FILTER=普通对局，或具体系列赛 id
  const [historyTournamentFilter, setHistoryTournamentFilter] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState<HistorySortState>({ key: 'updatedAt', order: 'desc' });
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchTagValue, setBatchTagValue] = useState<string | null>(null);
  const [batchTagSaving, setBatchTagSaving] = useState(false);
  const [statsMetric, setStatsMetric] = useState<StatsMetricKey>('pickRate');
  const [statsPlayer, setStatsPlayer] = useState<string | null>(null);
  const [statsTag, setStatsTag] = useState<string | null>(null);
  const [statsTournamentId, setStatsTournamentId] = useState<string | null>(null);
  const [statsSearch, setStatsSearch] = useState('');
  const [previewSlot, setPreviewSlot] = useState<PreviewSlotKey>('stage');
  const [previewScale, setPreviewScale] = useState(1);
  const [previewShellSize, setPreviewShellSize] = useState({ width: 960, height: 540 });
  const [stageSaving, setStageSaving] = useState(false);
  const [nextgameSaving, setNextgameSaving] = useState(false);
  const [countdownSaving, setCountdownSaving] = useState(false);
  const [mvpSaving, setMvpSaving] = useState(false);
  const [mvpSlotsDraft, setMvpSlotsDraft] = useState<MvpSlotEntry[]>(createEmptyMvpSlots);
  const [page5TitleDraft, setPage5TitleDraft] = useState('');
  const [page2EventTitleDraft, setPage2EventTitleDraft] = useState('');
  // 三个推流选场弹窗的推送中状态（key: page6/page7/page8）
  const [matchPushLoading, setMatchPushLoading] = useState<Record<string, boolean>>({});
  const [page14Saving, setPage14Saving] = useState(false);
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
  // 信息录入卡片内切换视图（选手 / 战队）
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
  // 选手批量导入（JSON / Excel）：预览确认弹窗与解析结果
  const [playerImportOpen, setPlayerImportOpen] = useState(false);
  const [playerImportPreview, setPlayerImportPreview] = useState<Array<{ name: string; rank: string; declaration: string; pets: string; hasAvatar?: boolean }>>([]);
  const [playerImporting, setPlayerImporting] = useState(false);
  const [playerExporting, setPlayerExporting] = useState(false);
  // 导入来源：json（前端解析）| xlsx（服务端解表，确认时二次上传原文件）。xlsx 的 File 仅在预览期间持有，用完即清。
  const [playerImportSource, setPlayerImportSource] = useState<'json' | 'xlsx'>('json');
  const [playerImportXlsxFile, setPlayerImportXlsxFile] = useState<File | null>(null);
  const [playerImportWarnings, setPlayerImportWarnings] = useState<string[]>([]);
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
  const [historyNotice, setHistoryNotice] = useState<NoticeState>(null);
  // 比赛管理「录入阵容」弹窗上下文：定位到某场比赛的当前小局（提前录入，不影响推流）
  const [lineupEntry, setLineupEntry] = useState<{ matchId: string; gameNumber: number } | null>(null);
  // === 数据同步（双机同步包导出 / 导入） ===
  const [machineCodeSaving, setMachineCodeSaving] = useState(false);
  const [syncExportInclProfiles, setSyncExportInclProfiles] = useState(true);
  const [syncExportInclAvatars, setSyncExportInclAvatars] = useState(true);
  const [syncExporting, setSyncExporting] = useState(false);
  // 选中的同步包文件与解析出的预览；确认导入前不写入任何数据
  const [syncFile, setSyncFile] = useState<File | null>(null);
  const [syncFileName, setSyncFileName] = useState('');
  const [syncPreview, setSyncPreview] = useState<SyncImportPreview | null>(null);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncConflictMode>('newer');
  const [syncSelectedKeys, setSyncSelectedKeys] = useState<string[]>([]);
  // 预览弹窗右侧差异面板当前查看的条目 key
  const [syncActiveKey, setSyncActiveKey] = useState<string | null>(null);
  const [syncIncludeAvatars, setSyncIncludeAvatars] = useState(true);
  // 覆盖已有头像：默认只补缺（本机已有头像保持不动），勾选后用包内图片覆盖同档案头像
  const [syncOverwriteAvatars, setSyncOverwriteAvatars] = useState(false);
  const [syncImporting, setSyncImporting] = useState(false);
  // === 云同步（点击式：主控「同步分发 / 检查回传 / 确认台」+ 分控「同步最新 / 回传」） ===
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudTesting, setCloudTesting] = useState(false);
  // 换房间守卫：改「房间号」时服务端回 409 + guard，弹窗让用户选「重置旧状态 / 原样保留」再重试（缺省拒绝保存）
  const [cloudRoomGuard, setCloudRoomGuard] = useState<{ action: 'save' | 'test'; guard: CloudSyncKeyGuardResult } | null>(null);
  // 云端数据走与「导入同步包」同一套预览：flow 区分「拉取待合并」与「主控确认台」
  const [cloudPreviewFlow, setCloudPreviewFlow] = useState<'pull' | 'incoming' | null>(null);
  const [cloudAckSource, setCloudAckSource] = useState<CloudSyncAckSource | null>(null);
  const [cloudAckSources, setCloudAckSources] = useState<CloudSyncAckSource[]>([]);
  const [cloudAckCode, setCloudAckCode] = useState('');
  const [cloudDistInfo, setCloudDistInfo] = useState('');
  // 指派工作台（按比赛勾选 / 按波次批量）
  const [cloudAssignOpen, setCloudAssignOpen] = useState(false);
  const [cloudAssignDraft, setCloudAssignDraft] = useState<Record<string, string>>({});
  // 预览里被取消勾选的系列赛 id（随导入一起提交：整条不导入，含它名下的比赛）
  const [syncExcludedTournamentIds, setSyncExcludedTournamentIds] = useState<string[]>([]);
  const [syncCollapsedGroupKeys, setSyncCollapsedGroupKeys] = useState<string[]>([]);
  const [visibleMatchCount, setVisibleMatchCount] = useState(MATCH_LIST_PAGE_SIZE);
  const [liveNotice, setLiveNotice] = useState<NoticeState>(null);
  const [liveFilePath, setLiveFilePath] = useState<string | null>(null);
  const [liveConfigEnabled, setLiveConfigEnabled] = useState(false);
  /** 监听状态快照（开始时间 / 最近同步 / 最近回写 / 错误），LiveWatchCard 只读展示 */
  const [liveWatch, setLiveWatch] = useState<LiveWatchSnapshot>(createLiveWatchSnapshot);
  /** 读取 / 切换监听文件过程中（按钮 loading） */
  const [liveWatchBusy, setLiveWatchBusy] = useState(false);
  /** 上次成功监听的文件路径（localStorage 记忆，重启后仍能一键恢复） */
  const [liveRememberedPath, setLiveRememberedPath] = useState<string>(() => readStoredLiveWatchPath());
  const [createMatchForm] = Form.useForm<CreateMatchValues>();
  const [playerProfileForm] = Form.useForm<PlayerProfileFormValues>();
  const [teamProfileForm] = Form.useForm<TeamProfileFormValues>();

  const liveApplyRef = useRef(false);
  const liveWriteRef = useRef(false);
  const liveSaveTimerRef = useRef<number | null>(null);
  const livePollTimerRef = useRef<number | null>(null);
  /**
   * 监听会话（轮询闭包只读这份 ref，不读 state）。
   *
   * 踩过的坑：以前 setInterval 里调的是渲染闭包中的 pollLiveConfigFile，它读到的是
   * 「开启监听之前」那次渲染的 liveConfigEnabled=false / liveFilePath=null，于是轮询
   * 每次都直接 return —— 界面显示「监听中」，实际从未读取过文件。会话状态必须放 ref。
   */
  const liveWatchRef = useRef<{
    enabled: boolean;
    filePath: string | null;
    /** 已应用到面板的文件内容（相同则跳过，避免自己回写后又被当成外部改动） */
    lastContent: string;
    lastModified: number | null;
  }>({ enabled: false, filePath: null, lastContent: '', lastModified: null });
  /** 轮询心跳（最近一次检查文件的时刻）：LiveWatchCard 每秒自读，用来展示「最近检查 x 秒前」 */
  const liveHeartbeatRef = useRef(0);
  /** 一次只允许一个轮询在跑（读取 + 应用期间不重入） */
  const livePollBusyRef = useRef(false);
  /** 最新面板状态：轮询 / 250ms 回写定时器都是异步回调，不能闭包读 panels（会写回旧值） */
  const livePanelsRef = useRef(panels);
  const previewFrameShellRef = useRef<HTMLDivElement | null>(null);

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
  // 桌面版才有本地文件读写能力：浏览器 / 无头模式下实时监听不可用（只能上传一次 JSON）
  const liveDesktopSupported = Boolean(window.rocoDesktop?.readTextFile && window.rocoDesktop?.statFile);
  const lineupLocked = activeMatch?.status === 'completed';
  const progress = buildProgressItems(activeMatch);
  const allHistoryTags = buildHistoryTags(matchStore.matches);
  // 系列赛筛选组：id→名称映射 + 有效 id 集合（系列赛删除后残留的孤儿引用按普通对局处理）
  const tournamentNameMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament.name])),
    [tournaments],
  );
  // 比赛管理标签列派生「阶段 · 轮次」只读 Tag 用：id → 完整系列赛记录
  const tournamentRecordMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament])),
    [tournaments],
  );
  // 系列赛对局的选手名 / 赛制由编排与档案决定（写回按选手名比对、赛制决定完赛局数），
  // 当前比赛表单据此锁定这两个字段，只留战队 / 排位排名可改（与后端 PATCH 守卫同口径）
  const activeMatchTournamentLocked = Boolean(
    activeMatch?.tournamentRef && tournamentRecordMap.has(activeMatch.tournamentRef.tournamentId),
  );
  // 系列比赛卡片 Drawer 的目标对局（比赛被删 / 被同步替换掉时自动失效为空 → 抽屉自行关闭）
  const matchPanelTarget = matchPanelTargetId
    ? matchStore.matches.find((match) => match.id === matchPanelTargetId) ?? null
    : null;
  // 对局面板底部「双方阵容」卡用的「阶段 · 轮次」摘要（普通对局 / 已解绑为 null）
  const matchPanelTargetStageRound = ((): string | null => {
    const ref = matchPanelTarget?.tournamentRef;
    if (!ref) {
      return null;
    }
    const tournament = tournamentRecordMap.get(ref.tournamentId);
    return tournament ? formatStageRoundLabel(tournament, ref) : null;
  })();
  const tournamentIdSet = useMemo(() => new Set(tournamentNameMap.keys()), [tournamentNameMap]);
  // 本机已「本机移除」的系列赛 id 集合：管理端操作面（比赛管理 / 推流选场）据此一并隐藏其关联对局
  const locallyRemovedIdSet = useMemo(
    () => new Set(locallyRemoved.map((tournament) => tournament.id)),
    [locallyRemoved],
  );
  // 回收站系列赛（grace 墓碑）：对局仍在 matches.json，管理面视图层一并隐藏（与本机移除同款）
  const recycleBinIdSet = useMemo(
    () => new Set(recycleBin.map((tournament) => tournament.id)),
    [recycleBin],
  );
  const adminVisibleMatches = useMemo(
    () => filterLocallyRemovedMatches(matchStore.matches, locallyRemovedIdSet)
      .filter((match) => {
        const tournamentId = match.tournamentRef?.tournamentId;
        return !tournamentId || !recycleBinIdSet.has(tournamentId);
      }),
    [matchStore.matches, locallyRemovedIdSet, recycleBinIdSet],
  );
  const historyTournamentFilters = useMemo(
    () => buildHistoryTournamentFilters(matchStore.matches, tournaments),
    [matchStore.matches, tournaments],
  );
  // 「实时控制 → 下场对局」待开始下拉：同口径隐藏「本机移除」系列赛的对局（adminVisibleMatches）
  const pendingMatches = adminVisibleMatches.filter((match) => match.status === 'pending');
  // MVP 结算（推流页面4）：胜者阵容（口径同推流页面10）+ 标记完成度
  const mvpWinnerLineup = useMemo(() => getRecentWinnerLineup(activeMatch), [activeMatch]);
  // 结算画面只收最终形态精灵：可点选与「载入当前对局胜方」同一口径（非最终形态不进结算页）
  const mvpWinnerPetIds = mvpWinnerLineup.petIds.filter((petId) => spriteMap.get(petId)?.isFinalForm === true);
  const mvpAssignedCount = mvpSlotsDraft.filter((slot) => slot.petId).length;
  const mvpTagsComplete = mvpAssignedCount > 0 && mvpSlotsDraft.every((slot) => !slot.petId || slot.tag.trim().length > 0);
  // 显示 MVP 结算的门槛：只要标记了 MVP（标签可选，不要求填写完整）
  const mvpMarked = mvpSlotsDraft.some((slot) => slot.petId && slot.isMvp);
  const mvpVisible = stage?.page === 'page4';
  // 当前对局胜方与已载入快照不一致：推流画面不会自动更新，需重新「载入当前对局胜方」
  const mvpWinnerOutdated = Boolean(mvpWinnerLineup.side) && (
    mvp?.winner?.matchId !== activeMatch?.id || mvp?.winner?.playerName !== mvpWinnerLineup.playerName
  );
  // 结算画面操作引导条（载入胜方 → 选择精灵 → 标记 MVP → 显示结算）
  const mvpProgress = buildMvpProgressItems({
    hasWinner: Boolean(mvp?.winner),
    assignedCount: mvpAssignedCount,
    marked: mvpMarked,
    visible: mvpVisible,
  });
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const filteredMatches = adminVisibleMatches.filter((match) => {
    if (historyTagFilter === UNCATEGORIZED_HISTORY_TAG) {
      if ((match.tags ?? []).length > 0) {
        return false;
      }
    } else if (historyTagFilter && !(match.tags ?? []).includes(historyTagFilter)) {
      return false;
    }
    // 系列赛维度与标签维度 AND 叠加：普通对局=无有效归属；否则按系列赛 id 精确过滤
    if (historyTournamentFilter) {
      const effectiveTournamentId = getEffectiveTournamentId(match, tournamentIdSet);
      if (historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER) {
        if (effectiveTournamentId) {
          return false;
        }
      } else if (effectiveTournamentId !== historyTournamentFilter) {
        return false;
      }
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
  /** 筛选状态提示：被筛掉多少场、当前按什么筛（避免「同步来的比赛看不见」被误判成丢数据） */
  const historyFilterSummary = (() => {
    const parts: string[] = [];
    if (historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER) {
      parts.push('只看普通对局');
    } else if (historyTournamentFilter) {
      parts.push(`只看系列赛「${tournamentNameMap.get(historyTournamentFilter) ?? historyTournamentFilter}」`);
    }
    if (historyTagFilter) {
      parts.push(historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? '只看无标签' : `只看标签「${historyTagFilter}」`);
    }
    if (normalizedHistorySearch) {
      parts.push(`搜索「${historySearch.trim()}」`);
    }
    if (!parts.length) {
      return '';
    }
    const hidden = adminVisibleMatches.length - filteredMatches.length;
    return `当前${parts.join(' + ')}：显示 ${filteredMatches.length} / 共 ${adminVisibleMatches.length} 场`
      + (hidden > 0 ? `（有 ${hidden} 场被筛选条件隐藏，刚同步来的比赛可能在其中）` : '');
  })();
  // 「录入阵容」弹窗的当前上下文：从最新 store 里解析比赛与小局（socket 更新后自动跟随）
  const lineupEntryMatch = lineupEntry ? matchStore.matches.find((match) => match.id === lineupEntry.matchId) ?? null : null;
  const lineupEntryGame = lineupEntryMatch && lineupEntry
    ? lineupEntryMatch.games.find((game) => game.gameNumber === lineupEntry.gameNumber) ?? null
    : null;
  // 赛事面板比赛列表：当前比赛置顶高亮（不参与懒加载计数），其余按「赛事 · 阶段 · 轮次」分组
  const dashboardActiveMatch = activeMatch || null;
  // 赛事面板快捷比赛列表：同口径隐藏「本机移除」系列赛的对局（当前比赛仍照常置顶展示，不打断在进行的推流）
  const dashboardNonActiveMatches = adminVisibleMatches.filter(
    (m) => m.id !== dashboardActiveMatch?.id,
  );
  const dashboardMatchGroups = buildPushCandidateGroups(dashboardNonActiveMatches, tournaments);
  const dashboardListRows = ((): DashboardListRow[] => {
    const rows: DashboardListRow[] = [];
    dashboardMatchGroups.forEach((group) => {
      rows.push({
        rowType: 'group',
        key: `group:${group.key}`,
        title: group.title,
        count: group.matches.length,
      });
      group.matches.forEach((match) => {
        rows.push({ rowType: 'match', key: match.id, match });
      });
    });
    return rows;
  })();
  const visibleDashboardRows = dashboardListRows.slice(0, visibleMatchCount);
  const hasMoreMatches = dashboardListRows.length > visibleMatchCount;

  /** 比赛列表滚动到底部（余量 32px）时追加一页卡片 */
  function handleMatchListScroll(event: React.UIEvent<HTMLDivElement>) {
    if (!hasMoreMatches) {
      return;
    }
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32) {
      setVisibleMatchCount((count) => Math.min(count + MATCH_LIST_PAGE_SIZE, dashboardListRows.length));
    }
  }

  /**
   * 比赛列表卡片行（分组列表内使用）。
   * 两行布局：第一行 = 状态点 + 选手名（单行截断，悬停看全名）；第二行 = 赛制/状态/比分胶囊 +「选择」按钮。
   * 不用 List.Item 的 actions：按钮独占右列会挤掉名字宽度，窗口一窄名字就折行、行高也参差。
   */
  function renderDashboardMatchItem(match: MatchRecord) {
    const title = `${match.leftPlayer || '左侧'} vs ${match.rightPlayer || '右侧'}`;
    return (
      <List.Item className="match-list-item">
        <div className="match-list-item-main">
          <Badge status={match.status === 'completed' ? 'success' : match.status === 'in_progress' ? 'processing' : 'default'} />
          <Tooltip title={title}>
            <span className="match-list-item-name">{title}</span>
          </Tooltip>
        </div>
        <div className="match-list-item-foot">
          <Space size={6} wrap>
            <Tag color="gold">BO{match.bestOf}</Tag>
            <MatchStatusTag status={match.status} />
            <Tag bordered={false} className="match-list-score-tag">{match.leftScore} : {match.rightScore}</Tag>
          </Space>
          <Button size="small" onClick={() => void selectMatch(match.id)}>选择</Button>
        </div>
      </List.Item>
    );
  }

  const deferredRosterSearch = useDeferredValue(rosterSearch);
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

  // 轮询 / 回写定时器在异步回调里读最新面板（闭包里的 panels 会是旧值，导致写回文件丢掉刚改的数值）
  useEffect(() => {
    livePanelsRef.current = panels;
  }, [panels]);

  useEffect(() => {
    // 赛事面板阵容编辑统一自动保存（600ms 防抖）；saving 期间跳过调度，避免保存触发的 saving/dirty 状态变化导致重复 POST
    if (panels.left.saving || !panels.left.dirty) {
      return;
    }
    const timer = window.setTimeout(() => {
      void savePanel('left', true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [panels.left]);

  useEffect(() => {
    if (panels.right.saving || !panels.right.dirty) {
      return;
    }
    const timer = window.setTimeout(() => {
      void savePanel('right', true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [panels.right]);

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

  function toggleAttributeFilter(attribute: string) {
    const current = spriteFilter.selectedAttributes;
    const isActive = current.includes(attribute);

    if (!isActive && current.length >= 2) {
      message.warning('精灵属性最多只能选择两个');
      return;
    }

    setSpriteFilter((filter) => ({
      ...filter,
      selectedAttributes: isActive
        ? filter.selectedAttributes.filter((item) => item !== attribute)
        : [...filter.selectedAttributes, attribute],
    }));
  }

  function toggleFormFilter(form: string) {
    setSpriteFilter((filter) => {
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

  function toggleFinalFormFilter() {
    setSpriteFilter((filter) => ({
      ...filter,
      selectedFinalForm: !filter.selectedFinalForm,
      selectedForms: filter.selectedFinalForm ? filter.selectedForms : [],
    }));
  }

  function clearSpriteFilters() {
    setSpriteFilter(createSpriteFilterState());
  }

  async function saveMatchMeta(matchId: string, values: MatchFormValues) {
    const target = matchStore.matches.find((match) => match.id === matchId);
    if (!target) {
      return;
    }

    const nextBestOf = Number(values.bestOf) || target.bestOf;
    const bestOfChanged = nextBestOf !== target.bestOf;
    const projection = bestOfChanged ? summarizeSeriesForBestOf(target, nextBestOf) : null;
    const endsMatchAfterBestOfChange = Boolean(projection?.winner && target.status !== 'completed');

    const save = async () => {
      try {
        const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState }>(`/api/matches/${encodeURIComponent(matchId)}`, {
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

  /** 切换当前赛事会把目标赛事的选手信息与当前小局阵容同步到推流画面（面板+比分栏被覆写），
   *  首次切换前弹窗确认，可勾选「不再提示」（按浏览器本地记忆）。
   *  options.navigate=false 供系列比赛 Drawer 用：切换但不离开当前视图（不跳赛事面板）。 */
  function selectMatch(matchId: string, options: { navigate?: boolean } = {}) {
    const targetMatch = matchStore.matches.find((match) => match.id === matchId);
    if (!targetMatch) {
      return;
    }
    // 已是当前赛事：重复点击不会改变推流指向，不弹确认
    if (matchId === activeMatch?.id || isSelectMatchConfirmSuppressed()) {
      void doSelectMatch(matchId, options);
      return;
    }

    let suppressNextTime = false;
    modal.confirm({
      title: '切换当前赛事？',
      content: (
        <div className="select-match-confirm">
          <Paragraph>
            切换后，推流页面将立即同步「{targetMatch.leftPlayer || '左侧'} vs {targetMatch.rightPlayer || '右侧'}」的
            选手信息与当前小局阵容（比分栏、推流页面1-3 会被覆盖）。
          </Paragraph>
          <Paragraph type="secondary">
            如当前正在推流其他对局，请先确认再切换。阵容可在「比赛管理」中提前录入，无需切换当前赛事。
          </Paragraph>
          <Checkbox onChange={(event) => { suppressNextTime = event.target.checked; }}>
            不再提示
          </Checkbox>
        </div>
      ),
      okText: '确认切换',
      cancelText: '取消',
      onOk: () => {
        if (suppressNextTime) {
          setSelectMatchConfirmSuppressed(true);
        }
        return doSelectMatch(matchId, options);
      },
    });
  }

  async function doSelectMatch(matchId: string, options: { navigate?: boolean } = {}) {
    const shouldNavigate = options.navigate !== false;
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
      if (shouldNavigate) {
        setView('roster');
      }
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

  function toggleQuickCreatePlayer(name: string) {
    setQuickCreatePlayerNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }
  /** 快速创建比赛：从「信息录入」选手多选、校验为双数后随机配对生成多场对局（公平起见随机分配，杜绝固定对阵） */
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

  // 战队修改：打开弹窗并回填目标比赛左右战队名称（系列比赛 Drawer 也能改非当前比赛）
  function openTeamEdit(matchId: string) {
    const target = matchStore.matches.find((match) => match.id === matchId);
    if (!target) {
      return;
    }
    setTeamEditTargetId(matchId);
    teamEditForm.setFieldsValue({
      leftTeam: target.leftTeamName || undefined,
      rightTeam: target.rightTeamName || undefined,
    });
    setTeamEditOpen(true);
  }

  // 保存目标比赛所属战队：按名称匹配「信息录入」战队复用 id；手动输入则仅记名称
  async function saveTeamEdit(values: { leftTeam?: string; rightTeam?: string }) {
    const matchId = teamEditTargetId;
    if (!matchId) {
      return;
    }
    const teamList = profiles?.teams ?? [];
    const leftTeamName = (values.leftTeam ?? '').trim();
    const rightTeamName = (values.rightTeam ?? '').trim();
    const leftTeam = leftTeamName ? teamList.find((team) => team.name === leftTeamName) : undefined;
    const rightTeam = rightTeamName ? teamList.find((team) => team.name === rightTeamName) : undefined;
    setTeamEditSaving(true);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState }>(`/api/matches/${encodeURIComponent(matchId)}`, {
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
      : placeholderAvatarSrc(side);
  }

  /** 头像占位图：非当前比赛时用它（推流头像按当前比赛存储，不能借用别场的头像） */
  function placeholderAvatarSrc(side: PanelSide): string {
    return side === 'left' ? '/assets/ui/left-avatar.png' : '/assets/ui/right-avatar.png';
  }

  /**
   * 阵容编辑器（赛事面板的卡片外那块）。它编辑的是**全局面板**，语义上属于当前比赛，
   * 因此只在「目标比赛 = 当前比赛」时调用；match 为 null 时保持原样（空编辑器）。
   */
  function buildRosterEditor(match: MatchRecord | null): React.ReactElement {
    return (
      <RosterPanelEditor
        panels={panels}
        filter={spriteFilter}
        locked={match?.status === 'completed'}
        players={{ left: match?.leftPlayer, right: match?.rightPlayer }}
        searchValue={rosterSearch}
        deferredSearchValue={deferredRosterSearch}
        sprites={sprites}
        spriteFormOptions={spriteFormOptions}
        onRosterSearchChange={setRosterSearch}
        onMutatePanel={mutatePanel}
        onRunQuickFill={runQuickFill}
        onClearPanel={clearPanel}
        onChooseQuickFillCandidate={chooseQuickFillCandidate}
        onApplySprite={applySprite}
        onToggleAttributeFilter={toggleAttributeFilter}
        onToggleFinalFormFilter={toggleFinalFormFilter}
        onToggleFormFilter={toggleFormFilter}
        onClearSpriteFilters={clearSpriteFilters}
      />
    );
  }

  /**
   * 「当前比赛」面板：赛事面板（inline，卡片外壳留在调用处）与系列比赛 Drawer（drawer）共用。
   * 动作与云闸门都在这里按**目标比赛**绑定 —— headless 登记，不要求该场是当前比赛。
   * 头像只对当前比赛可用（服务端按 activeMatchId 解析）；非当前比赛给占位图并禁用更换。
   */
  function buildCurrentMatchPanel(match: MatchRecord, variant: 'inline' | 'drawer'): React.ReactElement {
    const availability = deriveMatchActionAvailability(match, matchStore.activeMatchId, matchStore.undo);
    const isCurrent = availability.isCurrent;
    return (
      <CurrentMatchPanel
        match={match}
        variant={variant}
        avatars={isCurrent ? avatars : null}
        tournamentLocked={Boolean(match.tournamentRef && tournamentRecordMap.has(match.tournamentRef.tournamentId))}
        canUndo={availability.canUndo}
        canRedo={availability.canRedo}
        registerGate={cloudRegisterGate(match.id)}
        undoGate={cloudUndoGate(match.id)}
        avatarPreviewSrc={isCurrent ? getAvatarPreviewSrc : placeholderAvatarSrc}
        onUploadAvatar={(side, file) => void uploadAvatarFile(side, file)}
        onDeleteAvatar={(side) => void deleteAvatarFile(side)}
        onSaveMeta={(values) => void saveMatchMeta(match.id, values)}
        onOpenTeamEdit={() => openTeamEdit(match.id)}
        onAction={(action, extra) => void runMatchAction(match.id, action, extra)}
        rosterEditor={isCurrent && variant === 'drawer' ? buildRosterEditor(match) : undefined}
      />
    );
  }

  /** 系列比赛卡片菜单：打开某一场的 Drawer 面板 */
  function openMatchPanel(matchId: string): void {
    setMatchPanelTargetId(matchId);
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

  /** 清空选手导入的临时状态（xlsx 原文件用完即弃，避免大文件常驻内存） */
  function resetPlayerImportState() {
    setPlayerImportPreview([]);
    setPlayerImportWarnings([]);
    setPlayerImportXlsxFile(null);
    setPlayerImportSource('json');
  }

  /** 选手信息 .xlsx：交服务端解表（带行号 + 头像有无 + 提示），返回后打开确认弹窗 */
  async function handlePlayerImportXlsx(file: File) {
    try {
      const data = await uploadSingleFile<ProfileXlsxPreviewResponse>('/api/profiles/players/import/parse-xlsx', file);
      if (data.errors && data.errors.length > 0) {
        message.error(data.errors.join('；'));
        return;
      }
      if (!data.players || data.players.length === 0) {
        message.error('表格里没有可导入的选手（需要表头 + 至少一行填写「名字」）。');
        return;
      }
      setPlayerImportSource('xlsx');
      setPlayerImportXlsxFile(file);
      setPlayerImportWarnings(data.warnings ?? []);
      setPlayerImportPreview(
        data.players.map((player) => ({
          name: player.name,
          rank: player.rank,
          declaration: player.declaration,
          pets: player.pets,
          hasAvatar: player.hasAvatar,
        })),
      );
      setPlayerImportOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 解析选手导入文件：`.xlsx` 交服务端解表（可携带浮动头像）；否则按 JSON 白名单读取
   * 英文字段 名字 name / 排位排名 rank / 宣言 declaration / 常用精灵 pets，其余字段一律丢弃（防注入）。
   * 解析通过后打开确认弹窗。
   */
  function handlePlayerImportFile(file: File) {
    if (/\.xlsx$/i.test(file.name)) {
      void handlePlayerImportXlsx(file);
      return false;
    }
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
        setPlayerImportSource('json');
        setPlayerImportXlsxFile(null);
        setPlayerImportWarnings([]);
        setPlayerImportPreview(cleaned);
        setPlayerImportOpen(true);
      })
      .catch(() => {
        message.error('读取文件失败，请重试。');
      });
    return false;
  }

  /** 确认批量导入选手：JSON 走原接口；xlsx 二次上传原文件（解表 + 导入 + 落头像由服务端一次完成） */
  async function confirmPlayerImport() {
    setPlayerImporting(true);
    try {
      if (playerImportSource === 'xlsx') {
        if (!playerImportXlsxFile) {
          message.error('表格文件已失效，请重新选择后再导入。');
          return;
        }
        const importedCount = playerImportPreview.length;
        const data = await uploadSingleFile<ProfileXlsxImportResponse>('/api/profiles/players/import-xlsx', playerImportXlsxFile);
        setProfiles(data.profiles);
        setPlayerImportOpen(false);
        resetPlayerImportState();
        const avatarText = data.avatars.matched > 0 ? `，头像 ${data.avatars.matched} 张` : '';
        if (data.avatars.unmatched.length > 0 || data.avatars.failed.length > 0) {
          setAvatarBatchResult({ matched: data.avatars.matched, unmatched: data.avatars.unmatched, failed: data.avatars.failed });
          setAvatarBatchResultOpen(true);
        }
        if (data.review && data.review.length > 0) {
          setPlayerImportReview(data.review);
          setPetReviewSelection({});
          setPlayerImportReviewOpen(true);
          message.warning(`已导入 ${importedCount} 名选手${avatarText}，但 ${data.review.length} 个常用精灵未命中，请人工确认。`);
        } else {
          message.success(`已导入 ${importedCount} 名选手${avatarText}（同名记录已更新）`);
        }
        return;
      }

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

  /** 把生成的 xlsx 字节下载为文件（选手导出 / 模板共用） */
  function downloadXlsxBytes(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** 导出当前选手为带头像的 Excel 表格（列与导入模板一致；常用精灵带下拉，可用 WPS 编辑后直接导回） */
  async function exportPlayersXlsx() {
    if (!profiles) {
      message.error('选手档案尚未加载，请稍后重试。');
      return;
    }
    if (sprites.length === 0) {
      message.warning('精灵索引尚未加载，导出的表格将没有常用精灵下拉，请稍后重试');
    }
    setPlayerExporting(true);
    try {
      const data = await renderProfileTemplateXlsx({ players: profiles.players, sprites });
      const stamp = new Date();
      const pad = (value: number): string => String(value).padStart(2, '0');
      downloadXlsxBytes(data, `选手信息_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}.xlsx`);
      message.success(
        profiles.players.length > 0
          ? `已导出 ${profiles.players.length} 名选手（含头像与常用精灵下拉）`
          : '已导出空白模板（表头 + 填写说明）',
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setPlayerExporting(false);
    }
  }

  /** 下载 Excel 导入模板（空白：表头 + 精灵下拉 + 填写说明；导入时按同口径解析） */
  async function downloadPlayerImportXlsxTemplate() {
    if (sprites.length === 0) {
      message.warning('精灵索引尚未加载，模板将没有常用精灵下拉，请稍后重试');
    }
    setPlayerExporting(true);
    try {
      const data = await renderProfileTemplateXlsx({ players: [], sprites });
      downloadXlsxBytes(data, '选手导入模板.xlsx');
      message.success('已下载 Excel 模板（表头 + 常用精灵下拉 + 填写说明）');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '下载模板失败');
    } finally {
      setPlayerExporting(false);
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

  /**
   * 创建比赛时复用录入选手：自动带上排名与头像预览。
   *
   * 这里**只预览、不再复制一份赛事头像**：比赛头像由服务端统一解析
   * （赛事覆盖 > 按选手名匹配档案头像 > 占位），复制件会作为「赛事覆盖」永久压住
   * 档案头像，导致之后在「信息录入」换头像时这场比赛不跟着变。
   * 想让本场用别的头像，用下面的「选择头像」单独上传（那才会写赛事覆盖）。
   */
  function reusePlayerProfile(side: PanelSide, player: PlayerProfile) {
    createMatchForm.setFieldsValue({
      ...(side === 'left' ? { leftRank: player.rank || '' } : { rightRank: player.rank || '' }),
    });
    if (!player.avatarExists) {
      return;
    }
    const previewUrl = `/runtime/profiles/players/${encodeURIComponent(player.id)}.png?t=${player.avatarMtime ?? 0}`;
    if (side === 'left') {
      if (createLeftAvatarUrl) URL.revokeObjectURL(createLeftAvatarUrl);
      setCreateLeftAvatar(null);
      setCreateLeftAvatarUrl(previewUrl);
    } else {
      if (createRightAvatarUrl) URL.revokeObjectURL(createRightAvatarUrl);
      setCreateRightAvatar(null);
      setCreateRightAvatarUrl(previewUrl);
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

  // === 比赛回收站（普通删除 7 天内逐条恢复） ===
  interface RecycleBinRow {
    matchId: string;
    leftPlayer: string;
    rightPlayer: string;
    bestOf: number;
    status: 'pending' | 'in_progress' | 'completed';
    deletedAt: string;
  }
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [recycleBinRows, setRecycleBinRows] = useState<RecycleBinRow[]>([]);
  const [recycleSelectedKeys, setRecycleSelectedKeys] = useState<string[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleRestoring, setRecycleRestoring] = useState(false);

  async function openMatchRecycleBin(): Promise<void> {
    setRecycleBinOpen(true);
    setRecycleLoading(true);
    try {
      const data = await requestJson<{ entries: RecycleBinRow[] }>('/api/matches/recycle-bin');
      setRecycleBinRows(data.entries);
      setRecycleSelectedKeys([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRecycleLoading(false);
    }
  }

  async function restoreRecycleMatches(): Promise<void> {
    if (!recycleSelectedKeys.length) {
      return;
    }
    setRecycleRestoring(true);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; pagePush?: { page6?: Page6State; page7?: Page7State; page8?: Page8State } }>('/api/matches/restore-deleted', {
        method: 'POST',
        json: { matchIds: recycleSelectedKeys },
      });
      applyServerState({
        store: data.store,
        ...(data.pagePush ?? {}),
      });
      message.success(`已恢复 ${recycleSelectedKeys.length} 场赛事`);
      // 刷新回收站清单（被恢复的条目已移出）
      await openMatchRecycleBin();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRecycleRestoring(false);
    }
  }

  // 比赛管理上方三个功能卡片的统一推送：选场弹窗确认后调用，失败时抛错以保持弹窗打开
  async function pushMatchesForPage(kind: MatchPushKind, payload: MatchPushPayload): Promise<void> {
    setMatchPushLoading((prev) => ({ ...prev, [kind]: true }));
    let nextText = '';
    try {
      if (kind === 'page6') {
        const data = await requestJson<{ success: boolean; state: Page6State }>('/api/page6', {
          method: 'POST',
          json: payload,
        });
        applyServerState({ page6: data.state });
        nextText = data.state.matchIds.length
          ? `已推送 ${data.state.matchIds.length} 场比赛结果到推流页面6`
          : '已清空推流页面6 的比赛结果';
      } else if (kind === 'page8') {
        const data = await requestJson<{ success: boolean; state: Page8State }>('/api/page8', {
          method: 'POST',
          json: payload,
        });
        applyServerState({ page8: data.state });
        nextText = data.state.matchIds.length
          ? `已推送 ${data.state.matchIds.length} 场对局预告到推流页面8`
          : '已清空推流页面8 的对局预告';
      } else {
        const data = await requestJson<{ success: boolean; state: Page7State }>('/api/page7', {
          method: 'POST',
          json: payload,
        });
        applyServerState({ page7: data.state });
        nextText = data.state.matchIds.length
          ? `已推送 ${data.state.matchIds.length} 场对局到推流页面7（战绩详情）`
          : '已清空推流页面7 的战绩详情';
      }
      setHistoryNotice({ tone: 'success', text: nextText });
      message.success(nextText);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setMatchPushLoading((prev) => ({ ...prev, [kind]: false }));
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

  /**
   * 对某一场对局执行流程动作（开始 / 登记胜负 / 撤回 / 取消撤回）。
   * 服务端按 matchId 工作，因此**不必**先把该场设为当前比赛：系列比赛的右键菜单与 Drawer
   * 都是 headless 登记（推流画面保持原样）；只有当前比赛才触发 page10 自动切入（服务端守卫）。
   */
  async function runMatchAction(
    matchId: string,
    action: 'start' | 'undo' | 'redo' | 'winner',
    extra?: Record<string, unknown>,
  ) {
    const target = matchStore.matches.find((match) => match.id === matchId);
    if (!target) {
      return;
    }

    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState; panels?: PanelState[] }>(
        `/api/matches/${encodeURIComponent(matchId)}/${action}`,
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
      const nextMatch = nextStore.matches.find((match) => match.id === matchId) ?? null;
      // headless：推流画面没有跟着切，提示里必须说清楚，否则会被当成「没生效」
      const headlessSuffix = nextStore.activeMatchId === matchId
        ? ''
        : '（未切换当前比赛，推流画面保持不变）';
      if (action === 'start') {
        const nextText = `本局已开始，后续仍可继续编辑阵容、血量与能量值${headlessSuffix}`;
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
        return;
      }
      if (action === 'undo') {
        const nextText = `已撤回上一步操作${headlessSuffix}`;
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
        return;
      }
      if (action === 'redo') {
        const nextText = `已恢复刚刚撤回的操作${headlessSuffix}`;
        setRosterNotice({ tone: 'success', text: nextText });
        message.success(nextText);
        return;
      }
      if (action === 'winner') {
        const winner = extra?.winner === 'left' || extra?.winner === 'right' ? extra.winner : null;
        const sideText = winner === 'left' ? '左侧' : '右侧';
        const nextText = nextMatch?.status === 'completed'
          ? `比赛已结束，${sideText}拿下系列赛${headlessSuffix}`
          : `已记录${sideText}本局获胜，下一局等待开始${headlessSuffix}`;
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

  // 数据回放：把系列赛「从 xx 阶段到 xx 阶段」的逐场增量推给推流页面15 播放（错误提示在后台弹，回放画面由 socket 事件驱动）
  async function handlePage15Replay(payload: { tournamentId: string; fromStage: number; toStage: number; speed: 'slow' | 'normal' | 'fast' }) {
    try {
      const data = await requestJson<{ ok: boolean; tournamentName: string; steps: number }>('/api/stats/replay', {
        method: 'POST',
        json: payload,
      });
      message.success(`已推送数据回放（${data.tournamentName}，共 ${data.steps} 场）到推流页面15`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
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

  // MVP 结算草稿：服务端状态变化时回填（内容一致时保持原引用，避免编辑中的标签被覆盖）
  useEffect(() => {
    setMvpSlotsDraft((prev) => {
      const serverSlots = mvp?.slots ?? [];
      const next = Array.from({ length: MVP_MAX_ITEMS }, (_, index) => {
        const slot = serverSlots[index];
        return { petId: slot?.petId ?? '', tag: slot?.tag ?? '', isMvp: slot?.isMvp === true };
      });
      const same = next.every((slot, index) => (
        slot.petId === prev[index]?.petId
        && slot.tag === prev[index]?.tag
        && slot.isMvp === prev[index]?.isMvp
      ));
      return same ? prev : next;
    });
  }, [mvp?.slots]);

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

  /**
   * 保存晋级积分榜配置（卡片内联的阶段切换/翻页与弹窗确认共用）。
   * 失败时抛错给调用方（弹窗据此保持打开），此处负责提示与 saving 标记。
   */
  async function savePage14Settings(payload: AdvanceRankPayload): Promise<void> {
    setPage14Saving(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page14State; standings: StageStandings | null }>('/api/page14', {
        method: 'POST',
        json: payload,
      });
      setPage14(data.state);
      setPage14Standings(data.standings);
      message.success('晋级积分榜已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPage14Saving(false);
    }
  }

  async function saveStage(
    nextPage: StagePageKey,
    options?: { silent?: boolean; transition?: StageTransitionType; mirrorSides?: boolean; page3SpriteSource?: SpriteSource; page3RankVisible?: boolean; page3TeamVisible?: boolean; page3RedLightMode?: Page3RedLightMode; page3RedLightInstant?: boolean; page11RankVisible?: boolean; page5TournamentId?: string; page5Stage?: string; page15TournamentId?: string; page15Stage?: string; page15SortBy?: 'picks' | 'games' | 'winRate'; page15SortOrder?: 'asc' | 'desc'; page15ReplayPlay?: boolean; page16SpriteSource?: SpriteSource; page16RankVisible?: boolean; page16CardLabel?: Page16CardLabel; page7SwitchSeconds?: number; page10Duration?: number; page10DurationUnit?: 'seconds' | 'minutes' },
  ) {
    const silent = options?.silent ?? false;
    const normalized = normalizeStagePage(nextPage);
    const transition = normalizeStageTransition(options?.transition ?? stage?.transition);
    const mirrorSides = options?.mirrorSides ?? stage?.mirrorSides ?? false;
    const page3SpriteSource = options?.page3SpriteSource ?? stage?.page3SpriteSource ?? 'sprite';
    const page3RankVisible = options?.page3RankVisible ?? stage?.page3RankVisible ?? false;
    const page3TeamVisible = options?.page3TeamVisible ?? stage?.page3TeamVisible ?? false;
    const page3RedLightMode = options?.page3RedLightMode ?? stage?.page3RedLightMode ?? 'off';
    const page3RedLightInstant = options?.page3RedLightInstant ?? stage?.page3RedLightInstant ?? false;
    const page11RankVisible = options?.page11RankVisible ?? stage?.page11RankVisible ?? true;
    const page5TournamentId = options?.page5TournamentId ?? stage?.page5TournamentId ?? '';
    const page5Stage = options?.page5Stage ?? stage?.page5Stage ?? '';
    const page15TournamentId = options?.page15TournamentId ?? stage?.page15TournamentId ?? '';
    const page15Stage = options?.page15Stage ?? stage?.page15Stage ?? '';
    const page15SortBy = options?.page15SortBy ?? stage?.page15SortBy ?? 'picks';
    const page15SortOrder = options?.page15SortOrder ?? stage?.page15SortOrder ?? 'desc';
    const page15ReplayPlay = options?.page15ReplayPlay ?? stage?.page15ReplayPlay ?? false;
    const page16SpriteSource = options?.page16SpriteSource ?? stage?.page16SpriteSource ?? 'sprite';
    const page16RankVisible = options?.page16RankVisible ?? stage?.page16RankVisible ?? true;
    const page16CardLabel: Page16CardLabel = options?.page16CardLabel ?? stage?.page16CardLabel ?? 'sum';
    const page7SwitchSeconds = options?.page7SwitchSeconds ?? stage?.page7SwitchSeconds ?? DEFAULT_PAGE7_SWITCH_SECONDS;
    const page10Duration = options?.page10Duration ?? stage?.page10Duration ?? 10;
    const page10DurationUnit = options?.page10DurationUnit ?? stage?.page10DurationUnit ?? 'seconds';
    // 乐观更新，避免切换回弹
    setStage((prev) => (prev ? { ...prev, page: normalized, transition, mirrorSides, page3SpriteSource, page3RankVisible, page3TeamVisible, page3RedLightMode, page3RedLightInstant, page11RankVisible, page5TournamentId, page5Stage, page15TournamentId, page15Stage, page15SortBy, page15SortOrder, page15ReplayPlay, page16SpriteSource, page16RankVisible, page16CardLabel, page7SwitchSeconds, page10Duration, page10DurationUnit } : prev));
    setStageSaving(true);
    try {
      const data = await requestJson<{ success: boolean; stage: StageConfig }>('/api/stage', {
        method: 'POST',
        json: { page: normalized, transition, mirrorSides, page3SpriteSource, page3RankVisible, page3TeamVisible, page3RedLightMode, page3RedLightInstant, page11RankVisible, page5TournamentId, page5Stage, page15TournamentId, page15Stage, page15SortBy, page15SortOrder, page15ReplayPlay, page16SpriteSource, page16RankVisible, page16CardLabel, page7SwitchSeconds, page10Duration, page10DurationUnit },
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

  /** 已载入胜方的头像地址：按快照 matchId+side 解析（与推流页面4 同口径），未上传时回退默认占位图 */
  function getMvpWinnerAvatarSrc(): string {
    const side = mvpWinner?.side === 'right' ? 'right' : 'left';
    if (mvpWinner?.avatarExists && mvpWinner.avatarPath) {
      return `${mvpWinner.avatarPath}${mvpWinner.avatarMtime ? `?t=${Math.floor(mvpWinner.avatarMtime)}` : ''}`;
    }
    return side === 'right' ? '/assets/ui/right-avatar.png' : '/assets/ui/left-avatar.png';
  }

  /** MVP 结算（推流页面4）：保存精灵项（顺序即页面从左到右，未赋值槽位由服务端忽略；winner 不传时保留已载入的胜方快照） */
  async function saveMvpSlots(slots: MvpSlotEntry[], winner?: MvpWinnerSnapshot | null) {
    setMvpSaving(true);
    try {
      const data = await requestJson<{ success: boolean; state: MvpState }>('/api/mvp', {
        method: 'POST',
        json: winner === undefined ? { slots } : { slots, winner },
      });
      applyServerState({ mvp: data.state });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMvpSaving(false);
    }
  }

  /** MVP 结算：显示（记录当前推流画面后切到页面4） */
  async function showMvpSettlement() {
    setMvpSaving(true);
    try {
      const data = await requestJson<{ success: boolean; state: MvpState; stage: StageConfig }>('/api/mvp/show', {
        method: 'POST',
        json: {},
      });
      applyServerState({ mvp: data.state, stage: data.stage });
      message.success('推流画面已切换到：推流页面4（MVP 结算）');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMvpSaving(false);
    }
  }

  /** MVP 结算：关闭（切回开启前所在推流画面） */
  async function hideMvpSettlement() {
    setMvpSaving(true);
    try {
      const data = await requestJson<{ success: boolean; state: MvpState; stage: StageConfig }>('/api/mvp/hide', {
        method: 'POST',
        json: {},
      });
      applyServerState({ mvp: data.state, stage: data.stage });
      const label = STAGE_OPTIONS.find((option) => option.value === data.stage.page)?.label ?? data.stage.page;
      message.success(`推流画面已切回：${label}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMvpSaving(false);
    }
  }

  /** MVP 结算草稿：本地即时回显后保存（标签手动输入在失焦/回车时保存） */
  function applyMvpDraft(next: MvpSlotEntry[], winner?: MvpWinnerSnapshot | null) {
    setMvpSlotsDraft(next);
    void saveMvpSlots(next, winner);
  }

  function updateMvpSlotDraft(index: number, patch: Partial<MvpSlotEntry>) {
    setMvpSlotsDraft((prev) => prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  /** 点选胜者阵容精灵：已填入则移除，否则填入第一个空槽位 */
  function toggleMvpWinnerSprite(petId: string) {
    const existingIndex = mvpSlotsDraft.findIndex((slot) => slot.petId === petId);
    if (existingIndex >= 0) {
      applyMvpDraft(mvpSlotsDraft.map((slot, index) => (
        index === existingIndex ? { petId: '', tag: '', isMvp: false } : slot
      )));
      return;
    }
    const emptyIndex = mvpSlotsDraft.findIndex((slot) => !slot.petId);
    if (emptyIndex < 0) {
      message.warning(`最多只能标记 ${MVP_MAX_ITEMS} 个精灵`);
      return;
    }
    applyMvpDraft(mvpSlotsDraft.map((slot, index) => (index === emptyIndex ? { ...slot, petId } : slot)));
  }

  /** 载入当前对局胜方：把当前对局胜者名字与阵容快照（仅最终形态精灵）一并保存进结算配置，之后切换对局不会自动更新 */
  function fillMvpWinnerLineup() {
    const { side, playerName } = mvpWinnerLineup;
    const matchId = activeMatch?.id ?? '';
    if (!side || !matchId) {
      message.warning('当前对局还没有已分胜负的小局');
      return;
    }
    const petIds = mvpWinnerPetIds.slice(0, MVP_MAX_ITEMS);
    if (!petIds.length) {
      // 没有可用的最终形态精灵时不覆盖已标记的精灵项，仅更新胜方名字
      message.warning('胜者阵容中没有可用的最终形态精灵，仅载入胜方选手名字');
      applyMvpDraft(mvpSlotsDraft, { matchId, side, playerName });
      return;
    }
    applyMvpDraft(petIds.map((petId) => {
      const existed = mvpSlotsDraft.find((slot) => slot.petId === petId);
      return { petId, tag: existed?.tag ?? '', isMvp: existed?.isMvp === true };
    }), { matchId, side, playerName });
  }

  /** MVP 标记：全页最多一个，标记新精灵时取消原标记 */
  function toggleMvpSlotMvp(index: number) {
    const target = mvpSlotsDraft[index];
    if (!target || !target.petId) {
      return;
    }
    applyMvpDraft(mvpSlotsDraft.map((slot, i) => ({ ...slot, isMvp: i === index ? !target.isMvp : false })));
  }

  function clearMvpSlot(index: number) {
    applyMvpDraft(mvpSlotsDraft.map((slot, i) => (
      i === index ? { petId: '', tag: '', isMvp: false } : slot
    )));
  }

  /** 标签手动输入失焦/回车：保存当前草稿（选择预设标签时即时保存） */
  function saveMvpTagDraft() {
    void saveMvpSlots(mvpSlotsDraft);
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

  function rememberLiveWatchPath(filePath: string) {
    setLiveRememberedPath(filePath);
    writeStoredLiveWatchPath(filePath);
  }

  function forgetLiveWatchPath() {
    setLiveRememberedPath('');
    writeStoredLiveWatchPath(null);
    setLiveNotice({ tone: 'info', text: '已清除上次监听记录' });
  }

  async function writeLiveConfigToPath(filePath: string, text: string, notice?: string) {
    const desktop = window.rocoDesktop;
    if (!desktop?.writeTextFile || !desktop?.statFile) {
      throw new Error('当前环境不支持写入监听文件');
    }

    liveWriteRef.current = true;
    try {
      await desktop.writeTextFile(filePath, text);
      const stat = await desktop.statFile(filePath);
      // 记住刚写进去的内容：否则下一秒轮询会把我们自己的回写当成外部改动再应用一遍
      const session = liveWatchRef.current;
      if (session.filePath === filePath) {
        session.lastContent = text;
        session.lastModified = stat.mtimeMs;
      }
      setLiveWatch((prev) => ({ ...prev, lastWriteAt: Date.now() }));
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

  /**
   * 把监听 / 上传的 JSON 内容应用到面板。
   *
   * @param options.notify 是否在页面顶部弹提示：自动轮询默认静默（结果由 LiveWatchCard 的
   *   「最近同步」展示，每秒都在变的横幅纯属噪音），手动上传 / 首次开启由调用方提示。
   */
  async function applyLiveConfigText(text: string, source = '监听文件', options: { notify?: boolean } = {}) {
    const notify = options.notify !== false;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${source} JSON 格式错误`);
    }

    liveApplyRef.current = true;
    try {
      // 以 ref 里的最新面板为基准：轮询回调闭包里的 panels 可能是几秒前的旧值
      const basePanels = livePanelsRef.current;
      let changedSlots = 0;
      const nextPanels: Record<PanelSide, PanelEditorState> = {
        left: { ...basePanels.left, selected: cloneSelected(basePanels.left.selected) },
        right: { ...basePanels.right, selected: cloneSelected(basePanels.right.selected) },
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
          let slotChanged = false;

          if (hp !== null && slot.healthPercent !== hp) {
            slot.healthPercent = hp;
            slotChanged = true;
          }
          if (value !== null && slot.energyValue !== value) {
            slot.energyValue = value;
            slotChanged = true;
          }
          if (slotChanged) {
            changedSlots += 1;
          }

          nextPanels[panel].selected[targetIndex] = slot;
        });
      });

      if (!changedSlots) {
        setLiveWatch((prev) => ({ ...prev, lastAppliedAt: Date.now(), lastAppliedCount: 0, error: null, errorAt: null }));
        if (notify) {
          setLiveNotice({ tone: 'info', text: `${source}无变化（面板数值已经是文件里的值）` });
        }
        return;
      }

      livePanelsRef.current = nextPanels;
      startTransition(() => {
        setPanels(nextPanels);
      });
      await saveLivePanelsSilently(nextPanels);
      setLiveWatch((prev) => ({
        ...prev,
        lastAppliedAt: Date.now(),
        lastAppliedCount: changedSlots,
        error: null,
        errorAt: null,
      }));
      if (notify) {
        setLiveNotice({ tone: 'success', text: `已根据${source}更新 ${changedSlots} 个槽位` });
      }
    } finally {
      liveApplyRef.current = false;
    }
  }

  /**
   * 轮询监听文件（每秒一次）。
   *
   * 只能读 liveWatchRef / livePanelsRef：本函数被 setInterval 捕获，闭包里任何 state
   * 都停在「开启监听之前」的那次渲染（曾导致轮询检查 !liveConfigEnabled 永远成立、直接早退）。
   */
  async function pollLiveConfigFile() {
    const desktop = window.rocoDesktop;
    const session = liveWatchRef.current;
    if (!session.enabled || !session.filePath || !desktop?.readTextFile || !desktop?.statFile) {
      return;
    }
    if (livePollBusyRef.current || liveWriteRef.current || liveApplyRef.current) {
      return;
    }

    const filePath = session.filePath;
    livePollBusyRef.current = true;
    try {
      const [text, stat] = await Promise.all([desktop.readTextFile(filePath), desktop.statFile(filePath)]);
      const current = liveWatchRef.current;
      if (!current.enabled || current.filePath !== filePath) {
        return;
      }
      liveHeartbeatRef.current = Date.now();
      if (text === current.lastContent || stat.mtimeMs === current.lastModified) {
        // 读到了但没有变化：顺手清掉上一次读取失败的错误（文件恢复可读）
        setLiveWatch((prev) => (prev.error ? { ...prev, error: null, errorAt: null } : prev));
        return;
      }
      await applyLiveConfigText(text, '监听文件', { notify: false });
      if (liveWatchRef.current === current) {
        current.lastContent = text;
        current.lastModified = stat.mtimeMs;
      }
    } catch (error) {
      liveHeartbeatRef.current = Date.now();
      const message = formatWatchError(error);
      setLiveWatch((prev) => {
        // 同一个错误（如文件被删）每秒都会抛一次：5 秒内只更新一次，避免整个后台每秒重渲染
        if (prev.error === message && prev.errorAt !== null && Date.now() - prev.errorAt < 5000) {
          return prev;
        }
        return { ...prev, error: message, errorAt: Date.now() };
      });
    } finally {
      livePollBusyRef.current = false;
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
    if (!window.rocoDesktop?.showOpenDialog) {
      setLiveNotice({ tone: 'warning', text: '当前环境不支持持续监听：请在桌面版中选择监听文件' });
      return;
    }

    try {
      const filePath = await window.rocoDesktop.showOpenDialog();
      if (!filePath) {
        setLiveNotice({ tone: 'info', text: '已取消选择监听文件' });
        return;
      }
      await startLiveConfigWatchFromPath(filePath);
    } catch (error) {
      setLiveNotice({ tone: 'error', text: `实时监听开启失败：${formatWatchError(error)}` });
    }
  }

  /**
   * 开始（或切换）监听一个本地 JSON。
   *
   * - 读取失败 = 根本没法监听：抛错给调用方提示，并停掉旧监听。
   * - 首次解析 / 应用失败不算致命（外部计分工具可能正在写文件、读到半截 JSON）：保留监听、
   *   把错误挂到状态卡上，下一秒自动重试。
   */
  async function startLiveConfigWatchFromPath(filePath: string) {
    const desktop = window.rocoDesktop;
    if (!desktop?.readTextFile || !desktop?.statFile) {
      throw new Error('当前环境不支持实时监听');
    }

    setLiveWatchBusy(true);
    try {
      const [text, stat] = await Promise.all([desktop.readTextFile(filePath), desktop.statFile(filePath)]);

      clearLivePollTimer();
      liveWatchRef.current = { enabled: true, filePath, lastContent: '', lastModified: null };
      liveHeartbeatRef.current = 0;
      setLiveFilePath(filePath);
      setLiveConfigEnabled(true);
      setLiveWatch({ ...createLiveWatchSnapshot(), startedAt: Date.now() });
      rememberLiveWatchPath(filePath);

      let initialError = '';
      try {
        if (text.trim()) {
          await applyLiveConfigText(text, '监听文件', { notify: false });
          const session = liveWatchRef.current;
          if (session.filePath === filePath) {
            session.lastContent = text;
            session.lastModified = stat.mtimeMs;
          }
        } else {
          // 空文件：把当前面板写进去，外部工具才有初始结构可读
          await writeLiveConfigToPath(filePath, stringifyLiveConfig(livePanelsRef.current), `监听中：${getLiveConfigFileName(filePath)}`);
        }
      } catch (error) {
        initialError = formatWatchError(error);
        setLiveWatch((prev) => ({ ...prev, error: initialError, errorAt: Date.now() }));
        setLiveNotice({ tone: 'error', text: initialError });
      }

      livePollTimerRef.current = window.setInterval(() => {
        void pollLiveConfigFile();
      }, LIVE_WATCH_POLL_MS);
      // 立刻检查一次：让「最近检查」马上有心跳，不用等第一个整秒
      void pollLiveConfigFile();

      if (!initialError) {
        setLiveNotice({ tone: 'success', text: `实时监听已开启：${getLiveConfigFileName(filePath)}` });
      }
    } catch (error) {
      stopLiveConfigWatch(false);
      throw error;
    } finally {
      setLiveWatchBusy(false);
    }
  }

  async function restoreLiveConfigWatch() {
    if (!liveRememberedPath) {
      return;
    }
    try {
      await startLiveConfigWatchFromPath(liveRememberedPath);
    } catch (error) {
      setLiveNotice({
        tone: 'error',
        text: `无法恢复上次监听：${formatWatchError(error)}`,
      });
    }
  }

  async function handleLiveConfigUpload(file: File & { path?: string }) {
    try {
      // Electron 32+ 移除了 File.path：改由 preload 的 webUtils.getPathForFile 拿真实路径（拖拽 / 文件框都适用）
      const legacyPath = typeof file.path === 'string' ? file.path.trim() : '';
      const resolvedPath = legacyPath || window.rocoDesktop?.getPathForFile?.(file)?.trim() || '';

      if (resolvedPath) {
        await startLiveConfigWatchFromPath(resolvedPath);
        return false;
      }

      if (window.rocoDesktop?.showOpenDialog) {
        const filePath = await window.rocoDesktop.showOpenDialog();
        if (!filePath) {
          setLiveNotice({ tone: 'info', text: '已取消选择监听文件' });
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
      setLiveNotice({ tone: 'error', text: `实时监听开启失败：${formatWatchError(error)}` });
      return false;
    }
  }

  function stopLiveConfigWatch(shouldResetNotice = true) {
    clearLivePollTimer();
    clearLiveSaveTimer();
    liveApplyRef.current = false;
    liveWriteRef.current = false;
    livePollBusyRef.current = false;
    liveWatchRef.current = { enabled: false, filePath: null, lastContent: '', lastModified: null };
    liveHeartbeatRef.current = 0;
    setLiveConfigEnabled(false);
    setLiveFilePath(null);
    setLiveWatch(createLiveWatchSnapshot());
    if (shouldResetNotice) {
      setLiveNotice({ tone: 'info', text: '实时监听已关闭' });
    }
  }

  function scheduleLiveConfigWrite(reason = '已同步到监听文件') {
    const session = liveWatchRef.current;
    if (!session.enabled || !session.filePath || liveApplyRef.current || liveWriteRef.current) {
      return;
    }
    const filePath = session.filePath;
    clearLiveSaveTimer();
    liveSaveTimerRef.current = window.setTimeout(() => {
      liveSaveTimerRef.current = null;
      // 定时器是 250ms 后执行的：期间若正在应用外部文件的改动，这次回写让位，避免把文件内容改回去
      if (liveApplyRef.current) {
        return;
      }
      void writeLiveConfigToPath(filePath, stringifyLiveConfig(livePanelsRef.current), reason).catch((error) => {
        setLiveNotice({ tone: 'error', text: `监听文件写入失败：${formatWatchError(error)}` });
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
    // view 也作为依赖：预览外壳在「页面预览」与「战绩详情」两个视图中分别挂载，切换后需重新计算缩放
  }, [previewSlot, view]);

  /**
   * 导航「数据同步」角标：入口从「比赛管理」底部搬到导航后，云同步的待办状态必须仍然一眼可见
   * （口径与卡片里的 cloudLiveBadge 一致：主控看待确认场次，分控看待交回场次 + 云端有新版本）。
   */
  const cloudNavPending = cloudStatus?.configured
    ? (cloudStatus.config.role === 'main'
      ? cloudStatus.inbox.reduce((sum, entry) => sum + entry.pending.length, 0)
      : cloudStatus.pending.count)
    : 0;
  const cloudNavNewVersion = Boolean(
    cloudStatus?.configured
    && cloudStatus.config.role !== 'main'
    && cloudStatus.version
    && cloudStatus.version.v > cloudStatus.appliedVersion,
  );

  // 注意：该 useMemo 必须位于任何条件 return 之前（React Hooks 规则），否则 loading 切换时 hook 数量变化会触发 React #310 白屏
  const menuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'roster', icon: <NavIcon name="roster" />, label: VIEW_LABEL.roster },
      { key: 'stage', icon: <NavIcon name="stage" />, label: VIEW_LABEL.stage },
      { key: 'tournament', icon: <NavIcon name="tournament" />, label: VIEW_LABEL.tournament },
      { key: 'mvp', icon: <NavIcon name="mvp" />, label: VIEW_LABEL.mvp },
      { key: 'history', icon: <NavIcon name="history" />, label: VIEW_LABEL.history },
      { key: 'stats', icon: <NavIcon name="stats" />, label: VIEW_LABEL.stats },
      {
        key: 'sync',
        icon: <NavIcon name="sync" />,
        label: (
          <span className="nav-label-with-badge">
            {VIEW_LABEL.sync}
            {cloudNavPending > 0
              ? <Badge count={cloudNavPending} size="small" offset={[4, -2]} />
              : cloudNavNewVersion ? <Badge dot offset={[2, -2]} /> : null}
          </span>
        ),
      },
      { key: 'profiles', icon: <NavIcon name="profiles" />, label: VIEW_LABEL.profiles },
      { key: 'page11', icon: <NavIcon name="page11" />, label: VIEW_LABEL.page11 },
      { key: 'preview', icon: <NavIcon name="preview" />, label: VIEW_LABEL.preview },
      {
        key: 'live',
        icon: <NavIcon name="live" />,
        // 「监听是否开着」要能从任何视图一眼看到：开着时导航项带一个蓝色呼吸点（悬停看文件名）
        label: liveConfigEnabled ? (
          <span className="nav-label-with-badge">
            {VIEW_LABEL.live}
            <Tooltip title={`实时监听中：${liveFilePath ? getLiveConfigFileName(liveFilePath) : ''}`}>
              <Badge status="processing" />
            </Tooltip>
          </span>
        ) : VIEW_LABEL.live,
      },
      { key: 'about', icon: <NavIcon name="about" />, label: VIEW_LABEL.about },
    ],
    [cloudNavPending, cloudNavNewVersion, liveConfigEnabled, liveFilePath]
  );

  if (loading) {
    return (
      <div className="admin-antd-loading">
        <Spin size="large" />
        <Text>正在加载新的 Ant Design 后台...</Text>
      </div>
    );
  }

  const cloudPendingIdSet = new Set(cloudStatus?.pending.matches.map((item) => item.matchId) ?? []);
  const cloudAckedSet = new Set(cloudAckedMatchIds);

  const historyColumns: ColumnsType<MatchRecord> = [
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
              {record.tournamentRef && tournamentNameMap.has(record.tournamentRef.tournamentId) ? (
                <Tag
                  color="purple"
                  onClick={(event) => {
                    event.stopPropagation();
                    setHistoryTournamentFilter(record.tournamentRef?.tournamentId ?? null);
                  }}
                >
                  🏆 {tournamentNameMap.get(record.tournamentRef.tournamentId)}
                </Tag>
              ) : null}
              {/* 派生「阶段 · 轮次」只读 Tag：由 tournamentRef + 编排实时计算，不落 tags、不参与筛选 */}
              {(() => {
                const ref = record.tournamentRef;
                const tournament = ref ? tournamentRecordMap.get(ref.tournamentId) : undefined;
                const stageRound = ref && tournament ? formatStageRoundLabel(tournament, ref) : null;
                if (!stageRound) {
                  return null;
                }
                return (
                  <Tag
                    color="geekblue"
                    style={{ cursor: 'default' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {stageRound}
                  </Tag>
                );
              })()}
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
      render: (status: MatchRecord['status'], record: MatchRecord) => (
        <Space size={4} wrap>
          <MatchStatusTag status={status} />
          {cloudPendingIdSet.has(record.id) ? <Tag color="purple">待交回</Tag> : null}
          {cloudAckedSet.has(record.id) && cloudStatus?.config.role === 'sub' ? <Tag color="green">已确认</Tag> : null}
        </Space>
      ),
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
      render: (_: unknown, record: MatchRecord) => {
        // 行内直接录入：自动定位到该场比赛的当前小局，免展开操作
        const entryGame = getCurrentGame(record);
        const entryReason = entryGame
          ? getLineupEntryBlockReason(record, entryGame)
          : 'match-completed';
        return (
          <Space wrap>
            <Tooltip
              title={entryReason
                ? LINEUP_ENTRY_BLOCK_TEXT[entryReason]
                : `提前录入第 ${entryGame?.gameNumber ?? 1} 局双方阵容，开始对局时自动生效`}
            >
              <span>
                <Button
                  size="small"
                  type={entryReason ? 'default' : 'primary'}
                  ghost={!entryReason}
                  disabled={Boolean(entryReason)}
                  onClick={() => setLineupEntry({ matchId: record.id, gameNumber: entryGame?.gameNumber ?? 1 })}
                >
                  录入阵容
                </Button>
              </span>
            </Tooltip>
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
        );
      },
    },
  ];

  function exportHistoryCsv() {
    const csv = buildHistoryCsv(sortedMatches, spriteMap, tournaments);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '比赛管理.csv';
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${sortedMatches.length} 场赛事历史`);
  }

  // === 数据同步（双机同步包导出 / 导入） ===

  async function saveMachineCode(confirmChange = false) {
    setMachineCodeSaving(true);
    try {
      const result = await requestJson<{
        success: boolean;
        config: { port: number; machineCode: string };
        syncConfig?: CloudSyncStatus;
      }>('/api/runtime-config', {
        method: 'POST',
        json: { machineCode: machineCodeInput, confirmMachineCodeChange: confirmChange },
      });
      setMachineCodeInput(result.config.machineCode);
      if (result.syncConfig) {
        applyCloudStatus(result.syncConfig, true);
      }
      message.success(
        result.config.machineCode
          ? `本机标识已设为 ${result.config.machineCode}，新比赛编号将带该前缀`
          : '已清空本机标识：新比赛沿用旧编号格式（两机同跑请分别设置 A / B）',
      );
    } catch (error) {
      const guard = (error as { guard?: MachineCodeGuardResult }).guard;
      if (guard?.requireConfirm && !confirmChange) {
        // 改码丢所有权（坑 1）：本地还有内嵌旧码的系列赛，必须人工二次确认
        setMachineCodeSaving(false);
        modal.confirm({
          title: '确认修改机器码？',
          content: guard.message,
          okText: '确认修改',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => saveMachineCode(true),
        });
        return;
      }
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMachineCodeSaving(false);
    }
  }

  async function exportSyncBundle() {
    setSyncExporting(true);
    try {
      const result = await requestJson<{ success: boolean; bundle: SyncBundle }>('/api/sync/export', {
        method: 'POST',
        json: {
          includeProfiles: syncExportInclProfiles,
          includeAvatars: syncExportInclProfiles && syncExportInclAvatars,
        },
      });

      const blob = new Blob([JSON.stringify(result.bundle, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      link.href = url;
      link.download = `roco-sync-${result.bundle.machine || 'X'}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`;
      link.click();
      URL.revokeObjectURL(url);
      message.success(`已导出同步包（${result.bundle.matches.length} 场比赛）`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncExporting(false);
    }
  }

  function defaultSyncSelection(preview: SyncImportPreview): string[] {
    return [...preview.matchItems, ...preview.playerItems, ...preview.teamItems]
      .filter((item) => item.action !== 'skip')
      .map((item) => item.key);
  }

  /** 预览弹窗默认查看的条目：优先第一处冲突，否则列表里排最前的那条（与列表排序同口径） */
  function defaultSyncActiveKey(preview: SyncImportPreview): string | null {
    const items = [...preview.matchItems, ...preview.playerItems, ...preview.teamItems];
    const matchItems = preview.matchItems;
    const conflict = items.find((item) => item.conflict);
    if (conflict) {
      return conflict.key;
    }
    return [...matchItems].sort(compareSyncItems)[0]?.key ?? items[0]?.key ?? null;
  }

  /** 冲突批量处理：accept = true 全部用包内覆盖（勾选），false 全部保留本机（取消勾选） */
  function resolveSyncConflicts(accept: boolean) {
    if (!syncPreview) {
      return;
    }
    const conflictKeys = syncPreview.matchItems.filter((item) => item.conflict).map((item) => item.key);
    setSyncSelectedKeys((prev) => (accept
      ? Array.from(new Set([...prev, ...conflictKeys]))
      : prev.filter((key) => !conflictKeys.includes(key))));
  }

  async function loadSyncPreview(file: File, mode: SyncConflictMode) {
    setSyncPreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);
      const result = await requestJson<{ success: boolean; preview: SyncImportPreview }>('/api/sync/preview', {
        method: 'POST',
        body: formData,
      });
      setSyncPreview(result.preview);
      setSyncSelectedKeys(defaultSyncSelection(result.preview));
      setSyncActiveKey(defaultSyncActiveKey(result.preview));
      setSyncIncludeAvatars(true);
      setSyncOverwriteAvatars(false);
    } catch (error) {
      setSyncPreview(null);
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncPreviewLoading(false);
    }
  }

  function handleSyncFile(file: File) {
    if (file.size > SYNC_BUNDLE_MAX_BYTES) {
      message.error('同步包超过大小上限（64MB），请在导出时关闭「包含头像与 logo」后重试');
      return;
    }
    setSyncFile(file);
    setSyncFileName(file.name);
    void loadSyncPreview(file, syncMode);
  }

  function closeSyncPreview() {
    setSyncPreview(null);
    setSyncFile(null);
    setSyncFileName('');
    setSyncSelectedKeys([]);
    setSyncActiveKey(null);
    setSyncExcludedTournamentIds([]);
    setSyncCollapsedGroupKeys([]);
  }

  async function applySyncPreview() {
    if (!syncFile) {
      return;
    }
    setSyncImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', syncFile);
      formData.append('mode', syncMode);
      formData.append('accepted', JSON.stringify(syncSelectedKeys));
      formData.append('includeAvatars', syncIncludeAvatars ? 'true' : 'false');
      formData.append('overwriteAvatars', syncOverwriteAvatars ? 'true' : 'false');
      formData.append('excludeTournamentIds', JSON.stringify(syncExcludedTournamentIds));

      const result = await requestJson<{ success: boolean; result: SyncImportResult }>('/api/sync/import', {
        method: 'POST',
        body: formData,
      });

      if (result.result.profiles) {
        applyServerState({ store: result.result.store, profiles: result.result.profiles });
      } else {
        applyServerState({ store: result.result.store });
      }

      const applied = result.result.applied;
      const avatarCount = result.result.avatarsWritten.players + result.result.avatarsWritten.teams;
      const tournamentInfo = result.result.tournaments;
      // 系列赛编排自动合并（不参与勾选）：有变化时在摘要里带上；写回推进额外标注
      const tournamentSegment = tournamentInfo.added + tournamentInfo.updated + tournamentInfo.skipped > 0
        ? `；系列赛 新增 ${tournamentInfo.added} / 更新 ${tournamentInfo.updated} / 跳过 ${tournamentInfo.skipped}`
          + (tournamentInfo.advanced ? '（已补写回推进）' : '')
        : '';
      const summary = `比赛 新增 ${applied.match.add} / 更新 ${applied.match.update} / 跳过 ${applied.match.skip}；`
        + `档案 新增 ${applied.player.add + applied.team.add} / 更新 ${applied.player.update + applied.team.update}；`
        + `${syncOverwriteAvatars ? '头像写入' : '头像补缺'} ${avatarCount} 张${tournamentSegment}`;
      setHistoryNotice({ tone: 'success', text: `同步包导入完成：${summary}` });
      message.success('同步包导入完成');
      result.result.warnings.forEach((warning) => message.warning(warning));
      closeSyncPreview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncImporting(false);
    }
  }

  /* ==================== 云同步（点击式：主控分发/确认台，分控同步/回传） ==================== */

  /**
   * 「后台自动刷新收件箱」哨兵：确认/退回之后只想更新红点与待确认清单，
   * 不再重新弹确认台（曾因此导致确认完弹窗不关、还停在原条目上）。
   */
  const AUTO_REFRESH_INBOX = '__auto__';

  /** 勾选条目按动作计数（与导入预览 summary 同口径：只统计被勾选且非跳过的条目） */
  function countActions(items: SyncImportItem[]): SyncImportCounts {
    const counts: SyncImportCounts = { add: 0, update: 0, skip: 0 };
    items.forEach((item) => {
      counts[item.action] += 1;
    });
    return counts;
  }

  /**
   * 保存云同步设置。改「房间号」时服务端会先拦一次（409 + guard）：本机旧房间的同步状态
   * （版本水位 / 已确认集 / 回传水位 / 名册 / 指派）不带房间标识，必须由用户选「重置」还是「保留」。
   */
  async function saveCloudSettings(cloudStateAction?: 'reset' | 'keep') {
    setCloudSaving(true);
    try {
      const result = await requestJson<{ success: boolean; status: CloudSyncStatus }>('/api/cloud-sync/config', {
        method: 'POST',
        json: {
          syncKey: cloudKeyDraft,
          syncToken: cloudTokenDraft,
          role: cloudRoleDraft,
          workerUrl: cloudWorkerUrlDraft,
          machineLabel: cloudLabelDraft,
          cloudStateAction,
          peerCodes: cloudRoleDraft === 'main'
            ? cloudPeerDraft.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean)
            : undefined,
        },
      });
      applyCloudStatus(result.status, true);
      message.success(cloudStateAction === 'reset'
        ? '云同步设置已保存，本机旧房间的同步状态已清空'
        : '云同步设置已保存');
    } catch (error) {
      const guard = (error as { guard?: CloudSyncKeyGuardResult }).guard;
      if (guard?.requireConfirm && !cloudStateAction) {
        setCloudRoomGuard({ action: 'save', guard });
        return;
      }
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudSaving(false);
    }
  }

  async function testCloudWorker(cloudStateAction?: 'reset' | 'keep') {
    if (!cloudWorkerUrlDraft.trim()) {
      message.warning('请先填 Worker 地址（形如 https://roco-sync.xxx.workers.dev）');
      return;
    }
    setCloudTesting(true);
    try {
      // 检测在线会先把地址/密钥/令牌按当前草稿存下来（/health 本身不需要它们），省一步「保存设置」；
      // 因此这里同样可能被换房间守卫拦下（房间号变了 + 本机还留着旧房间状态）
      const result = await requestJson<{ success: boolean; ok: boolean; message: string; status: CloudSyncStatus }>(
        '/api/cloud-sync/test',
        {
          method: 'POST',
          json: {
            workerUrl: cloudWorkerUrlDraft,
            syncKey: cloudKeyDraft,
            syncToken: cloudTokenDraft,
            cloudStateAction,
          },
        },
      );
      if (result.status) {
        applyCloudStatus(result.status, true);
      }
      if (result.ok) {
        message.success(result.message);
      } else {
        // 失败原因明确指出是网络还是地址，不要只说「不可达」
        message.error({ content: result.message, duration: 8 });
      }
    } catch (error) {
      const guard = (error as { guard?: CloudSyncKeyGuardResult }).guard;
      if (guard?.requireConfirm && !cloudStateAction) {
        setCloudRoomGuard({ action: 'test', guard });
        return;
      }
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudTesting(false);
    }
  }

  /** 换房间守卫的选择：带选择把刚才被拦下的动作（保存 / 测试连通）重跑一次 */
  function resolveCloudRoomGuard(cloudStateAction: 'reset' | 'keep') {
    const pending = cloudRoomGuard;
    setCloudRoomGuard(null);
    if (!pending) {
      return;
    }
    if (pending.action === 'test') {
      void testCloudWorker(cloudStateAction);
      return;
    }
    void saveCloudSettings(cloudStateAction);
  }

  /** 主控「上传给其他电脑」：把本机赛事资料整体发到云端 */
  async function pushCloudBundle() {
    setCloudBusy('push');
    try {
      const result = await postCloud<{ data: { bytes: number; matchCount: number; tournamentCount: number }; version: CloudSyncVersion }>(
        '/api/cloud-sync/push',
      );
      const info = `已上传第 ${result.version.v} 版 · ${formatDateTime(result.version.at)} · ${Math.max(1, Math.round(result.data.bytes / 1024))} KB · 含 ${result.data.matchCount} 场比赛 / ${result.data.tournamentCount} 个系列赛`;
      setCloudDistInfo(info);
      message.success('已上传，请让其他电脑等半分钟后点「从云端获取最新」');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 分控「从云端获取最新」：拉取 + 预览（确认后才合并，与「导入同步包」同一套界面） */
  async function pullCloudBundle() {
    setCloudBusy('pull');
    try {
      const result = await postCloud<{ preview: SyncImportPreview; data: { dist: string } }>('/api/cloud-sync/pull');
      setCloudPreviewFlow('pull');
      // B1「记住上次排除」：上次确认合并时排除的系列赛，本次预览默认继续排除（墓碑永不入列——删除指令不可取消）
      const remembered = new Set(result.status.excludedTournamentIds ?? []);
      const defaultExcludedGroups = (result.preview.tournamentGroups ?? [])
        .filter((group) => group.id && remembered.has(group.id) && !group.tombstone);
      const defaultExcludedIds = defaultExcludedGroups.map((group) => group.id);
      const defaultExcludedKeys = new Set(defaultExcludedGroups.flatMap((group) => group.matchKeys));
      setSyncExcludedTournamentIds(defaultExcludedIds);
      setSyncCollapsedGroupKeys([]);
      setSyncPreview(result.preview);
      setSyncSelectedKeys(defaultSyncSelection(result.preview).filter((key) => !defaultExcludedKeys.has(key)));
      setSyncActiveKey(defaultSyncActiveKey(result.preview));
      setCloudDistInfo(`内容来自 ${result.data.dist} 号机`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** B1：清除「默认排除」记忆（本机持久化），并把本次预览的排除全部恢复导入 */
  async function clearRememberedExclusions(): Promise<void> {
    try {
      await postCloud('/api/cloud-sync/excluded-tournaments', { tournamentIds: [] });
      setSyncExcludedTournamentIds([]);
      setSyncSelectedKeys((prev) => Array.from(new Set([
        ...prev,
        ...syncTournamentGroups.flatMap((group) => group.matchKeys),
      ])));
      message.success('已清除默认排除记忆，本次预览已全部恢复导入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 分控「交回赛果」：把本机已登记、还没被确认的赛果一起交回去 */
  async function uploadCloudResults() {
    setCloudBusy('upload');
    try {
      const result = await postCloud<{ data: { seq: number; count: number }; submittedAt: string }>(
        '/api/cloud-sync/upload',
      );
      message.success(`已交回 ${result.data.count} 场赛果，等主控电脑确认`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 主控「查看其他电脑交回的赛果」：与导入预览同一套差异面板 */
  async function checkCloudInbox(code?: string) {
    setCloudBusy('check');
    try {
      const result = await postCloud<{ data: { sources: CloudSyncAckSource[]; source: CloudSyncAckSource | null } }>(
        '/api/cloud-sync/check',
        code ? { code } : {},
      );
      const sources = result.data.sources;
      if (!sources.length) {
        if (code !== AUTO_REFRESH_INBOX) {
          message.info('暂时没有待确认的赛果：其他电脑还没交回，或都已经确认过了');
        }
        return;
      }
      // 后台自动刷新（确认/退回之后）只更新红点与待确认清单，不重新弹窗打断用户
      if (code === AUTO_REFRESH_INBOX) {
        setCloudAckSources(sources);
        return;
      }
      const source = result.data.source ?? sources[0];
      setCloudAckSources(sources);
      setCloudAckSource(source);
      setCloudAckCode(source.code);
      const preview: SyncImportPreview = {
        meta: { app: '', schema: 1, machine: source.code, exportedAt: source.submittedAt },
        sameMachine: false,
        mode: 'bundle',
        matchItems: source.items.map((entry) => entry.item),
        playerItems: [],
        teamItems: [],
        summary: {
          match: countActions(source.items.map((entry) => entry.item)),
          player: { add: 0, update: 0, skip: 0 },
          team: { add: 0, update: 0, skip: 0 },
        },
        avatars: {
          players: { fill: 0, existing: 0, unmatched: 0 },
          teams: { fill: 0, existing: 0, unmatched: 0 },
        },
      };
      setCloudPreviewFlow('incoming');
      setSyncExcludedTournamentIds([]);
      setSyncCollapsedGroupKeys([]);
      setSyncPreview(preview);
      setSyncSelectedKeys(source.selectableKeys);
      setSyncActiveKey(defaultSyncActiveKey(preview));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 确认台切换分控端 */
  async function switchCloudAckSource(code: string) {
    const source = cloudAckSources.find((item) => item.code === code);
    if (!source) {
      return;
    }
    setCloudAckSource(source);
    setCloudAckCode(code);
    const preview: SyncImportPreview | null = syncPreview
      ? {
        ...syncPreview,
        meta: { ...syncPreview.meta, machine: source.code, exportedAt: source.submittedAt },
        matchItems: source.items.map((entry) => entry.item),
        summary: {
          ...syncPreview.summary,
          match: countActions(source.items.map((entry) => entry.item)),
        },
      }
      : null;
    if (preview) {
      setSyncPreview(preview);
      setSyncSelectedKeys(source.selectableKeys);
      setSyncActiveKey(defaultSyncActiveKey(preview));
    }
  }

  /** 云同步确认（拉取合并 / 确认台确认）——都用同一套勾选结果 */
  async function applyCloudPreview() {
    if (!cloudPreviewFlow) {
      return;
    }
    setCloudBusy('apply');
    try {
      if (cloudPreviewFlow === 'pull') {
        const result = await postCloud<{ data: { applied: SyncImportPreview['summary']; warnings: string[] } }>(
          '/api/cloud-sync/apply',
          { accepted: syncSelectedKeys, mode: syncMode, excludeTournamentIds: syncExcludedTournamentIds },
        );
        const applied = result.data.applied;
        message.success(`已更新本机数据：新增 ${applied.match.add} 场 / 更新 ${applied.match.update} 场 / 无变化 ${applied.match.skip} 场`);
        result.data.warnings.forEach((warning) => message.warning(warning));
        // 拉取下的数据可能带来新比赛/新系列赛，重新拉一次全量状态
        void loadInitialData();
      } else {
        const result = await postCloud<{ data: { acked: string[]; warnings: string[] }; result: SyncImportResult }>(
          '/api/cloud-sync/confirm',
          { code: cloudAckCode, accepted: syncSelectedKeys },
        );
        applyServerState(result.result.profiles
          ? { store: result.result.store, profiles: result.result.profiles }
          : { store: result.result.store });
        const updated = result.data.acked.length - result.result.applied.match.skip;
        if (updated > 0) {
          message.success(`已确认 ${result.data.acked.length} 场赛果（其中 ${updated} 场写入了本机），并自动推进了下一轮`);
        } else {
          message.success(`已确认 ${result.data.acked.length} 场赛果：本机内容本来就一致，只给对方回了「收到了」`);
        }
        result.data.warnings.forEach((warning) => message.warning(warning));
        // 确认完先把弹窗关掉（曾漏掉这一步：确认后弹窗不关，还停在原条目上）
        closeCloudPreview();
        // 可能还有别的电脑交了赛果：后台刷新确认台状态，刷新结果只影响红点/列表，不重新弹窗
        void checkCloudInbox(AUTO_REFRESH_INBOX);
        return;
      }
      closeCloudPreview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 主控驳回：不写本地、不通知对方，让对方改完再交一次 */
  async function rejectCloudInbox() {
    if (!cloudAckCode) {
      return;
    }
    setCloudBusy('apply');
    try {
      await postCloud('/api/cloud-sync/reject', { code: cloudAckCode });
      message.info(`已退回 ${cloudAckCode} 号机交回的赛果：本机数据没有任何改动，请对方改正后重新「交回赛果」`);
      // 与确认一致：先关弹窗，再后台刷新收件箱（刷新不再重新弹窗）
      closeCloudPreview();
      void checkCloudInbox(AUTO_REFRESH_INBOX);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 分控「无需改动，标记为已处理」：预览里没有可写入内容时收尾状态，避免「有新内容」一直挂着 */
  async function markCloudPullReviewed() {
    setCloudBusy('apply');
    try {
      const result = await postCloud<{ data: { appliedVersion: number } }>('/api/cloud-sync/skip');
      message.success(`已把这版云端内容标记为已处理（本机无需改动，当前第 ${result.data.appliedVersion} 版）`);
      closeCloudPreview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  function closeCloudPreview() {
    setCloudPreviewFlow(null);
    setCloudAckSource(null);
    setCloudAckCode('');
    closeSyncPreview();
  }

  /** 指派工作台：打开时以当前指派规则为草稿 */
  function openCloudAssign() {
    setCloudAssignDraft({ ...(cloudStatus?.assignment ?? {}) });
    setCloudAssignOpen(true);
  }

  async function saveCloudAssignDraft() {
    setCloudBusy('assignment');
    try {
      const result = await postCloud<{ status: CloudSyncStatus }>('/api/cloud-sync/assignment', {
        overrides: cloudAssignDraft,
      });
      applyCloudStatus(result.status);
      setCloudAssignOpen(false);
      message.success('已保存。记得点一次「上传给其他电脑」，对方才会收到最新的登记安排');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 指派作用域：空 = 主控端自己登记（未指派的比赛一律归主控端） */
  function cloudScopeOf(matchId: string): string {
    return cloudStatus?.assignment[matchId] ?? '';
  }

  /** 本机能否登记某场比赛（分控电脑只允许登记主控安排给本机的比赛；没启用云同步时不干预） */
  function cloudRegisterGate(matchId: string): { allowed: boolean; reason: string } {
    const status = cloudStatus;
    if (!status?.configured) {
      return { allowed: true, reason: '' };
    }
    const scope = cloudScopeOf(matchId);
    if (status.config.role === 'main') {
      return scope === '' || scope === status.config.machineCode
        ? { allowed: true, reason: '' }
        : { allowed: false, reason: `这场已安排给 ${scope} 号机登记，请到那台电脑上登记` };
    }
    if (scope === status.config.machineCode) {
      return { allowed: true, reason: '' };
    }
    return {
      allowed: false,
      reason: scope
        ? `这场安排给 ${scope} 号机登记，本机不能登记`
        : '这场没有安排给本机登记（没安排的默认由主控电脑登记）',
    };
  }

  /** 已被主控确认的赛果，分控电脑不能再撤回（会让两边的比分对不上） */
  function cloudUndoGate(matchId: string): { allowed: boolean; reason: string } {
    if (cloudStatus?.config.role !== 'sub') {
      return { allowed: true, reason: '' };
    }
    return cloudAckedMatchIds.includes(matchId)
      ? { allowed: false, reason: '这场已经被主控电脑确认了：如果结果有误，请联系主控电脑退回这一轮，重新获取后再登记' }
      : { allowed: true, reason: '' };
  }

  /** 本机在界面上的可读名称（备注名优先，没有就显示机器码） */
  function cloudMachineText(entry: { code: string; label: string }): string {
    return entry.label ? `${entry.label}（${entry.code}）` : `${entry.code} 号机`;
  }

  const SYNC_KIND_LABELS: Record<SyncImportItem['kind'], string> = { match: '比赛', player: '选手档案', team: '战队档案' };
  const SYNC_ACTION_LABELS: Record<SyncImportItem['action'], string> = { add: '新增', update: '更新', skip: '跳过' };
  const SYNC_ACTION_ORDER: Record<SyncImportItem['action'], number> = { update: 0, add: 1, skip: 2 };
  /** 预览条目排序：有变化的（更新 → 新增）在前，跳过在后；同一档里冲突优先 */
  const compareSyncItems = (a: SyncImportItem, b: SyncImportItem) => (
    SYNC_ACTION_ORDER[a.action] - SYNC_ACTION_ORDER[b.action] || Number(b.conflict) - Number(a.conflict)
  );
  /** 行权重（含冲突优先级），用于分组整体排序 */
  const syncRowRank = (item: SyncImportItem) => SYNC_ACTION_ORDER[item.action] * 2 + (item.conflict ? 0 : 1);

  const syncPreviewColumns: ColumnsType<SyncImportItem> = [
    {
      title: '类型',
      dataIndex: 'kind',
      width: 72,
      render: (kind: SyncImportItem['kind']) => SYNC_KIND_LABELS[kind],
    },
    {
      title: '对象',
      dataIndex: 'label',
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.label}</Text>
          <Hint>{record.id}</Hint>
        </Space>
      ),
    },
    {
      title: '处理',
      dataIndex: 'action',
      width: 108,
      render: (action: SyncImportItem['action'], record) => (
        <Space size={4}>
          <Tag color={action === 'add' ? 'green' : action === 'update' ? 'gold' : 'default'}>
            {SYNC_ACTION_LABELS[action]}
          </Tag>
          {record.conflict ? <Tag color="red">冲突</Tag> : null}
        </Space>
      ),
    },
    {
      title: '说明',
      dataIndex: 'reason',
      width: 148,
      ellipsis: true,
      render: (_value, record) => <Text type="secondary">{record.reason || '—'}</Text>,
    },
  ];

  const syncPreviewItems = syncPreview
    ? [...syncPreview.matchItems, ...syncPreview.playerItems, ...syncPreview.teamItems].sort(compareSyncItems)
    : [];
  const syncActiveItem = syncPreviewItems.find((item) => item.key === syncActiveKey) ?? null;
  const syncConflictCount = syncPreview ? syncPreview.matchItems.filter((item) => item.conflict).length : 0;

  // === 预览弹窗里的系列赛分组：让「这条系列赛包含哪些比赛」一眼可见，并可整条选择导不导入 ===
  const syncTournamentGroups = syncPreview?.tournamentGroups ?? [];
  const syncMatchRows = syncPreview?.matchItems ?? [];
  /** 系列赛 id -> 该组（含普通对局组 id = ''） */
  const syncGroupOfMatchKey = new Map<string, SyncImportTournamentGroup>();
  syncTournamentGroups.forEach((group) => {
    group.matchKeys.forEach((key) => syncGroupOfMatchKey.set(key, group));
  });
  /** 已取消勾选系列赛名下的比赛 key（这些行置灰、不可勾选） */
  const syncExcludedMatchKeys = new Set<string>();
  syncTournamentGroups.forEach((group) => {
    if (group.id && syncExcludedTournamentIds.includes(group.id)) {
      group.matchKeys.forEach((key) => syncExcludedMatchKeys.add(key));
    }
  });
  /** 可勾选比赛的 key 集合（排除已取消勾选系列赛名下的比赛） */
  const syncAvailableKeys = new Set(
    [...syncMatchRows, ...(syncPreview?.playerItems ?? []), ...(syncPreview?.teamItems ?? [])]
      .filter((item) => item.action !== 'skip' && !syncExcludedMatchKeys.has(item.key))
      .map((item) => item.key),
  );
  /** 分控「从云端获取最新」但勾选后没有任何需要写入的条目（点过确认合并 / 云端与本机一致） */
  const cloudPullNothingToMerge = cloudPreviewFlow === 'pull' && Boolean(syncPreview)
    && syncSelectedKeys.every((key) => !syncAvailableKeys.has(key));

  /** 取消/恢复整条系列赛：勾掉时不写入它的编排，也不写入它名下的比赛 */
  function toggleSyncTournamentGroup(group: SyncImportTournamentGroup) {
    if (group.tombstone) {
      // 删除指令不可取消：墓碑必须随导入应用，否则被取消勾选的旧副本永远清不掉
      return;
    }
    const excluded = syncExcludedTournamentIds.includes(group.id);
    if (excluded) {
      setSyncExcludedTournamentIds((prev) => prev.filter((id) => id !== group.id));
      setSyncSelectedKeys((prev) => Array.from(new Set([...prev, ...group.matchKeys])));
      return;
    }
    setSyncExcludedTournamentIds((prev) => [...prev, group.id]);
    setSyncSelectedKeys((prev) => prev.filter((key) => !group.matchKeys.includes(key)));
  }

  type SyncPreviewRow = SyncImportItem | (SyncImportTournamentGroup & { isGroup: true; rowKey: string });
  const matchItemByKey = new Map(syncMatchRows.map((item) => [item.key, item]));
  /** 组内比赛行排序：有变化的（更新 → 新增）在前，跳过在后；不动原数组（勾选/排除逻辑还在用它） */
  const sortSyncKeys = (keys: string[]) => [...keys].sort((a, b) => {
    const itemA = matchItemByKey.get(a);
    const itemB = matchItemByKey.get(b);
    return itemA && itemB ? compareSyncItems(itemA, itemB) : 0;
  });
  /** 分组整体权重 = 组内最靠前的那一行，让「有要处理比赛的系列赛」排前面；没有比赛行的组（墓碑 / 仅编排）排最后 */
  const syncGroupRank = (group: SyncImportTournamentGroup) => {
    let rank = Number.MAX_SAFE_INTEGER;
    group.matchKeys.forEach((key) => {
      const item = matchItemByKey.get(key);
      if (item) {
        rank = Math.min(rank, syncRowRank(item));
      }
    });
    return rank;
  };
  /** 表格数据：系列赛分组标题行 + 组内比赛行（普通对局单独一组），便于一眼区分归属 */
  const syncPreviewRows: SyncPreviewRow[] = [];
  // 组间也按「谁有要处理的比赛」排序；同权重保持服务端顺序（普通对局组本来就在最后）
  [...syncTournamentGroups]
    .sort((a, b) => syncGroupRank(a) - syncGroupRank(b))
    .forEach((group) => {
      const collapsed = syncCollapsedGroupKeys.includes(group.key);
      syncPreviewRows.push({ ...group, isGroup: true, rowKey: group.key });
      if (collapsed) {
        return;
      }
      sortSyncKeys(group.matchKeys).forEach((key) => {
        const item = matchItemByKey.get(key);
        if (item) {
          syncPreviewRows.push(item);
        }
      });
    });
  // 兜底：没被任何分组收录的比赛条目（异常包）直接平铺，避免「预览里有却看不见」
  const groupedKeys = new Set(syncTournamentGroups.flatMap((group) => group.matchKeys));
  syncMatchRows
    .filter((item) => !groupedKeys.has(item.key))
    .sort(compareSyncItems)
    .forEach((item) => syncPreviewRows.push(item));
  // 顶部速览：本次有哪些内容要处理（比赛行与档案项分开数，口径与列表一致）
  const syncMatchActionCounts = syncMatchRows.reduce(
    (acc, item) => { acc[item.action] += 1; return acc; },
    { add: 0, update: 0, skip: 0 } as Record<SyncImportItem['action'], number>,
  );
  const syncProfileItems = [...(syncPreview?.playerItems ?? []), ...(syncPreview?.teamItems ?? [])];
  const syncProfileActionCounts = syncProfileItems.reduce(
    (acc, item) => { acc[item.action] += 1; return acc; },
    { add: 0, update: 0, skip: 0 } as Record<SyncImportItem['action'], number>,
  );
  /**
   * 顶部说明行：原来这里是七八条 Alert 平铺，能把表格顶出可视区。
   * 压缩成一行小灰字——只留「排序口径 / 系列赛与墓碑规则 / 头像统计 / 上次排除」，
   * 需要用户点按钮的（冲突批量、空状态、同机器码）仍单独用 Alert。
   */
  const syncPreviewNotes: string[] = [];
  if (cloudPreviewFlow === 'incoming') {
    syncPreviewNotes.push('列表按「更新 → 新增 → 跳过」排序；勾选后点确认：内容不同的写入本机并推进系列赛，与本机已一致的只回一条「收到了」，没勾的对方仍显示待交回');
  } else {
    syncPreviewNotes.push('列表按「更新 → 新增 → 跳过」排序，要处理的排在最上面');
    if (cloudPreviewFlow === 'pull' && cloudDistInfo) {
      syncPreviewNotes.push(`${cloudDistInfo}：默认只覆盖比本机旧的内容，本机较新的登记不会被冲掉`);
    }
    if (syncTournamentGroups.some((group) => group.id)) {
      syncPreviewNotes.push('🏆 系列赛的编排随比赛自动合并、不用单独勾，勾掉整组就不导入它（编排与名下比赛都不写入）');
    }
    if (syncTournamentGroups.some((group) => group.tombstone)) {
      syncPreviewNotes.push('含已删除系列赛（墓碑）的项会清理本机副本与名单内对局，不可取消');
    }
    if (cloudPreviewFlow === 'pull' && syncExcludedTournamentIds.length > 0) {
      syncPreviewNotes.push(`已按上次选择默认排除 ${syncExcludedTournamentIds.length} 届系列赛（记在本机，下次预览继续生效）`);
    }
    if (syncProfileItems.length) {
      syncPreviewNotes.push(`档案 ${syncProfileItems.length} 项（更新 ${syncProfileActionCounts.update} / 新增 ${syncProfileActionCounts.add} / 跳过 ${syncProfileActionCounts.skip}）`);
    }
  }
  // === 云同步派生展示（红点 / 版本对比 / 最后通信时间） ===
  const cloudInboxCount = cloudStatus?.inbox.reduce((sum, entry) => sum + entry.pending.length, 0) ?? 0;
  const cloudLiveBadge = (() => {
    const status = cloudStatus;
    if (!status?.configured) {
      return '';
    }
    if (status.config.role === 'main') {
      return cloudInboxCount ? `有 ${cloudInboxCount} 场待确认` : '';
    }
    const hasNew = Boolean(status.version) && status.version!.v > status.appliedVersion;
    const pending = status.pending.count;
    if (hasNew) {
      return '云端有新内容';
    }
    // 「已交回等确认」不是「新内容」：不要用同一句话，否则用户会以为红点清不掉
    if (pending > 0) {
      const unconfirmed = status.pending.unconfirmedCount;
      return unconfirmed > 0 ? `${unconfirmed} 场已交回，等主控确认` : `${pending} 场待交回`;
    }
    return '';
  })();
  const cloudVersionText = (() => {
    const status = cloudStatus;
    if (!status) {
      return '';
    }
    const version = status.version;
    if (!version) {
      return '云端还没有内容：等主控电脑上传后，点「从云端获取最新」';
    }
    const synced = version.v === status.appliedVersion ? '本机已是最新' : '本机还没更新，请点「从云端获取最新」';
    const main = status.roster.find((entry) => entry.code === version.from);
    return `云端第 ${version.v} 版 · ${formatDateTime(version.at)} · ${synced}`
      + (main ? ` · 来自主控电脑 ${cloudMachineText(main)}` : '')
      + (status.lastContact.pulledAt ? ` · 上次获取 ${formatDateTime(status.lastContact.pulledAt)}` : '');
  })();

  // === 云同步状态卡的展示数据（版本对比 / 待办 / 本机动作时间线） ===
  /** 本机相对「云端最新版本」的同步状态：分控端用已处理版本判断，主控端本身没有可拉取的副本 */
  const cloudSyncState = (() => {
    const status = cloudStatus;
    if (!status) {
      return { tone: 'idle' as const, label: '未配置', hint: '' };
    }
    if (status.config.role === 'main') {
      return {
        tone: 'main' as const,
        label: '主控电脑',
        hint: '负责上传数据与确认其他电脑交回的赛果',
      };
    }
    if (!status.version) {
      return { tone: 'idle' as const, label: '云端暂无内容', hint: '等主控电脑上传后再获取' };
    }
    if (status.version.v > status.appliedVersion) {
      return {
        tone: 'warn' as const,
        label: '本机不是最新',
        hint: `本机已处理到第 ${status.appliedVersion} 版，点「从云端获取最新」`,
      };
    }
    return {
      tone: 'ok' as const,
      label: '本机已是最新',
      hint: status.appliedVersion ? `已处理第 ${status.appliedVersion} 版` : '',
    };
  })();
  /** 本机待办（分控＝待交回/等确认，主控＝待确认其他电脑的赛果） */
  const cloudTodo = (() => {
    const status = cloudStatus;
    if (!status?.configured) {
      return { count: 0, label: '未启用', hint: '填好设置即可使用' };
    }
    if (status.config.role === 'main') {
      return cloudInboxCount
        ? { count: cloudInboxCount, label: `${cloudInboxCount} 场待确认`, hint: '点「查看其他电脑交回的赛果」' }
        : { count: 0, label: '没有待确认', hint: '其他电脑交回赛果后会出现在这里' };
    }
    const pending = status.pending.count;
    if (pending > 0) {
      const unconfirmed = status.pending.unconfirmedCount;
      return unconfirmed > 0
        ? {
          count: pending,
          label: `${unconfirmed} 场已交回，等主控确认`,
          hint: pending > unconfirmed ? `另有 ${pending - unconfirmed} 场待交回` : '等主控电脑确认后会自动清除',
        }
        : { count: pending, label: `${pending} 场待交回`, hint: '点「交回赛果」把登记结果发给主控' };
    }
    return { count: 0, label: '没有待办', hint: '本机登记并交回后会自动出现在这里' };
  })();
  /** 本机动作时间线（按时间倒序，只保留有记录的项） */
  const cloudTimeline = (() => {
    const status = cloudStatus;
    if (!status?.configured) {
      return [] as Array<{ key: string; label: string; at: string }>;
    }
    const items: Array<{ key: string; label: string; at: string }> = [];
    if (status.lastContact.pushedAt) {
      items.push({ key: 'push', label: '上传给其他电脑', at: status.lastContact.pushedAt });
    }
    if (status.lastContact.uploadedAt) {
      items.push({ key: 'upload', label: '交回赛果', at: status.lastContact.uploadedAt });
    }
    if (status.lastContact.pulledAt) {
      items.push({ key: 'pull', label: '从云端获取最新', at: status.lastContact.pulledAt });
    }
    if (status.lastContact.ackedAt) {
      items.push({ key: 'ack', label: '确认对方的赛果', at: status.lastContact.ackedAt });
    }
    return items.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 4);
  })();
  // 指派工作台：只列出未结束的比赛（已完赛的指派没有意义），分控端码取自名册
  const cloudAssignPeers = (cloudStatus?.roster ?? []).filter((entry) => entry.code !== cloudStatus?.config.machineCode);
  const cloudAssignMatches = cloudStatus?.configured
    ? matchStore.matches.filter((match) => match.status !== 'completed')
    : [];
  // 整轮安排分组：按「赛事 · 阶段 · 语义轮次」归组（W2 按选手首轮战绩拆胜者组/败者组），
  // 编排缺失的孤儿引用兜底为「第 N 波」
  const cloudAssignWaveGroups = (() => {
    const groups = new Map<string, { key: string; label: string; matchIds: string[] }>();
    cloudAssignMatches.forEach((match) => {
      const ref = match.tournamentRef;
      let key = 'plain';
      let label = '普通对局';
      if (ref) {
        const name = tournamentNameMap.get(ref.tournamentId) ?? ref.tournamentId;
        const tournament = tournamentRecordMap.get(ref.tournamentId);
        const stageRound = tournament ? formatStageRoundLabel(tournament, ref) : null;
        // 分组键用语义轮次 key：双败 W2 按选手首轮战绩拆胜者组/败者组两个批次
        const roundKey = tournament
          ? resolveMatchSemanticRound(tournament, ref).key
          : `w${ref.waveIndex}`;
        key = `${ref.tournamentId}|${ref.stageIndex}|${roundKey}`;
        label = stageRound ? `${name} · ${stageRound}` : `${name} · 第 ${ref.waveIndex + 1} 波`;
      }
      const group = groups.get(key) ?? { key, label, matchIds: [] };
      group.matchIds.push(match.id);
      groups.set(key, group);
    });
    return Array.from(groups.values()).filter((group) => group.key !== 'plain');
  })();

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
            // 进入「战绩详情」视图时同步预览槽位，方便「页面预览」视图直达页面7
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
            <Tooltip title="如何进行直播推送？获取推流地址并填入 OBS / 直播姬的图文教程">
              <Button onClick={() => setStreamGuideOpen(true)}>直播推送教程</Button>
            </Tooltip>
            <Tooltip title="导播切视角用：仅交换推流页面1-3与16的画面左右展示，不影响数据、阵容与胜负登记">
              <Button
                type={stage?.mirrorSides ? 'primary' : 'default'}
                disabled={stageSaving}
                onClick={() => { void saveStage(stage?.page ?? 'page3', { silent: true, mirrorSides: !(stage?.mirrorSides ?? false) }); }}
              >
                {stage?.mirrorSides ? '镜像中' : '镜像反转'}
              </Button>
            </Tooltip>
            <Button onClick={() => setCountdownModalOpen(true)}>倒计时</Button>
            <Button onClick={() => setNextgameModalOpen(true)}>下一场预告</Button>
            <Button onClick={() => setScreenSettingsModalOpen(true)}>画面设置</Button>
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
                    <div className="match-list-scroll" onScroll={handleMatchListScroll}>
                      {dashboardActiveMatch ? (
                        <div className="match-list-current">
                          <div className="match-list-group-title">当前比赛</div>
                          {/* 独立 markup：List.Item 的 actions 是 ul，脱离 List 上下文会丢样式 */}
                          <Surface tone="highlight" className="match-list-current-card">
                            <Badge status={dashboardActiveMatch.status === 'completed' ? 'success' : dashboardActiveMatch.status === 'in_progress' ? 'processing' : 'default'} />
                            <span className="match-list-current-players">
                              {dashboardActiveMatch.leftPlayer || '左侧'} vs {dashboardActiveMatch.rightPlayer || '右侧'}
                            </span>
                            <Space size={6} wrap>
                              <Tag color="gold">BO{dashboardActiveMatch.bestOf}</Tag>
                              <MatchStatusTag status={dashboardActiveMatch.status} />
                              <Tag bordered={false} className="match-list-score-tag">{dashboardActiveMatch.leftScore} : {dashboardActiveMatch.rightScore}</Tag>
                            </Space>
                          </Surface>
                        </div>
                      ) : null}
                      <List
                        dataSource={visibleDashboardRows}
                        className="match-list"
                        locale={{ emptyText: dashboardActiveMatch ? '没有其他比赛了。' : '暂无赛事，先创建一场比赛吧。' }}
                        renderItem={(row) => (row.rowType === 'group' ? (
                          <div className="match-list-group-title">{row.title}（{row.count} 场）</div>
                        ) : renderDashboardMatchItem(row.match))}
                      />
                      {hasMoreMatches ? (
                        <div className="match-list-more">
                          下滑加载更多（已显示 {visibleDashboardRows.filter((row) => row.rowType === 'match').length}/{dashboardNonActiveMatches.length}）
                        </div>
                      ) : null}
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
                        <MatchStatusTag status={activeMatch?.status} fallback="未创建" />
                      </Space>
                    )}
                  >
                    {activeMatch ? (
                      buildCurrentMatchPanel(activeMatch, 'inline')
                    ) : (
                      <EmptyState title="先创建或选择一场赛事" />
                    )}
                  </Card>
                </Col>
              </Row>

              <Row gutter={[18, 18]}>
                <Col span={24}>
                  {buildRosterEditor(activeMatch)}
                </Col>
              </Row>
            </Space>
          ) : null}

          {view === 'history' ? (
            <Space direction="vertical" size={18} className="page-stack">
              {/* 四张推流功能卡片单独一行（不再内嵌进比赛管理卡片）；四卡等高，见 styles.css .match-push-card-row */}
              <Row gutter={[16, 16]} className="match-push-card-row">
                {page6 ? (
                  <Col xs={24} md={6}>
                    <MatchPushCard
                      kind="page6"
                      cardTitle="推送比赛结果"
                      maxCount={PAGE6_MAX_MATCHES}
                      matches={adminVisibleMatches}
                      allMatches={matchStore.matches}
                      tournaments={tournaments}
                      state={page6}
                      pushing={Boolean(matchPushLoading.page6)}
                      onPush={(payload) => pushMatchesForPage('page6', payload)}
                    />
                  </Col>
                ) : null}
                {page7 ? (
                  <Col xs={24} md={6}>
                    <MatchPushCard
                      kind="page7"
                      cardTitle="推送战绩详情"
                      matches={adminVisibleMatches}
                      allMatches={matchStore.matches}
                      tournaments={tournaments}
                      state={page7}
                      pushing={Boolean(matchPushLoading.page7)}
                      onPush={(payload) => pushMatchesForPage('page7', payload)}
                    />
                  </Col>
                ) : null}
                {page8 ? (
                  <Col xs={24} md={6}>
                    <MatchPushCard
                      kind="page8"
                      cardTitle="推送比赛预告"
                      maxCount={PAGE8_MAX_MATCHES}
                      matches={adminVisibleMatches}
                      allMatches={matchStore.matches}
                      tournaments={tournaments}
                      state={page8}
                      pushing={Boolean(matchPushLoading.page8)}
                      onPush={(payload) => pushMatchesForPage('page8', payload)}
                    />
                  </Col>
                ) : null}
                {page14 ? (
                  <Col xs={24} md={6}>
                    <AdvanceRankCard
                      tournaments={tournaments}
                      state={page14}
                      standings={page14Standings}
                      saving={page14Saving}
                      onSave={savePage14Settings}
                    />
                  </Col>
                ) : null}
              </Row>

              {/* 比赛回收站：普通删除 7 天内逐条恢复（purged 批次——回退上一波等不可恢复删除——不在列） */}
              <Modal
                title="♻ 比赛回收站"
                open={recycleBinOpen}
                width={MODAL_WIDTH.sm}
                okText={`恢复选中（${recycleSelectedKeys.length}）`}
                okButtonProps={{ disabled: !recycleSelectedKeys.length, loading: recycleRestoring }}
                onOk={() => void restoreRecycleMatches()}
                onCancel={() => setRecycleBinOpen(false)}
              >
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {recycleLoading ? (
                    <Text type="secondary">加载中…</Text>
                  ) : recycleBinRows.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {recycleBinRows.map((row) => (
                        <div
                          key={row.matchId}
                          style={{
                            border: '1px solid #f0f0f0',
                            borderRadius: 8,
                            padding: '6px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <Text strong>{row.leftPlayer} vs {row.rightPlayer}</Text>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                              {row.matchId} · BO{row.bestOf} · 删除于 {row.deletedAt.slice(0, 16).replace('T', ' ')}
                            </Text>
                          </div>
                          <Checkbox
                            checked={recycleSelectedKeys.includes(row.matchId)}
                            onChange={(event) => {
                              setRecycleSelectedKeys((prev) => (
                                event.target.checked
                                  ? [...prev, row.matchId]
                                  : prev.filter((id) => id !== row.matchId)
                              ));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Text type="secondary">回收站是空的（普通删除的比赛保留 7 天，过期自动清理）</Text>
                  )}
                </div>
              </Modal>

              <Card
                title="比赛管理"
                extra={(
                  <Space wrap>
                    <Button onClick={exportHistoryCsv} disabled={!filteredMatches.length}>导出 CSV</Button>
                    {selectedHistoryKeys.length > 1 ? (
                      <Button onClick={() => void handleBatchTag()}>批量添加标签</Button>
                    ) : null}
                    <Button danger disabled={!selectedHistoryKeys.length} onClick={() => void deleteHistoryMatches(selectedHistoryKeys.map(String))}>
                      删除选中赛事
                    </Button>
                    <Button onClick={() => void openMatchRecycleBin()} disabled={matchStore.undo.deleteUndoCount === 0}>
                      ♻ 回收站 ({matchStore.undo.deleteUndoCount})
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
                  <Text type="secondary" className="history-filter-group-label">系列赛</Text>
                  <Tag
                    color={historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER ? 'purple' : 'default'}
                    onClick={() => setHistoryTournamentFilter(
                      historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER ? null : PLAIN_HISTORY_MATCH_FILTER,
                    )}
                  >
                    普通对局
                  </Tag>
                  {historyTournamentFilters.map((item) => (
                    <Tag
                      key={item.id}
                      color={historyTournamentFilter === item.id ? 'purple' : 'default'}
                      onClick={() => setHistoryTournamentFilter(historyTournamentFilter === item.id ? null : item.id)}
                    >
                      🏆 {item.name}（{item.count}）
                    </Tag>
                  ))}
                  <Divider type="vertical" className="history-filter-divider" />
                  <Text type="secondary" className="history-filter-group-label">标签</Text>
                  <Tag
                    color={historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? 'processing' : 'default'}
                    onClick={() => setHistoryTagFilter(historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? null : UNCATEGORIZED_HISTORY_TAG)}
                  >
                    无标签
                  </Tag>
                  <Tag color={!historyTagFilter ? 'processing' : 'default'} onClick={() => setHistoryTagFilter(null)}>全部</Tag>
                  {allHistoryTags.map((tag) => (
                    <Tag key={tag} color={historyTagFilter === tag ? 'processing' : 'default'} onClick={() => setHistoryTagFilter(historyTagFilter === tag ? null : tag)}>
                      {tag}
                    </Tag>
                  ))}
                </Space>
                {/* 筛选状态要让用户看见：否则「刚同步过来的比赛没出现在列表里」会被当成丢失 */}
                {historyFilterSummary ? (
                  <Alert
                    type="info"
                    showIcon
                    className="history-filter-hint"
                    message={historyFilterSummary}
                    action={(
                      <Button
                        size="small"
                        onClick={() => {
                          setHistoryTournamentFilter(null);
                          setHistoryTagFilter(null);
                          setHistorySearch('');
                        }}
                      >
                        清除筛选
                      </Button>
                    )}
                  />
                ) : null}
                <Table
                  rowKey={(record) => record.id}
                  columns={historyColumns}
                  dataSource={sortedMatches}
                  pagination={{
                    defaultPageSize: 10,
                    pageSizeOptions: ['10', '20', '50', '100'],
                    showSizeChanger: {
                      // 下拉挂到 body：表格在卡片底部，触发器父链上的层叠上下文/包含块会让下拉算错位置或被裁掉
                      getPopupContainer: () => document.body,
                      // 下拉宽度按选项内容自适应：跟随「10 条/页」这个很窄的触发器会把选项文字裁没
                      popupMatchSelectWidth: false,
                    },
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
                        {getHistoryVisibleGames(record).map((game) => {
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
                    // 不显示左侧 + 号展开列，改为点击整行展开（见 Table onRow）
                    showExpandColumn: false,
                  }}
                  onRow={(record) => ({
                    style: { cursor: 'pointer' },
                    onClick: (event: React.MouseEvent<HTMLElement>) => {
                      // 点行内交互控件（勾选框 / 标签 / 按钮 / 行内编辑等）时不触发展开
                      if ((event.target as HTMLElement).closest(
                        'button, a, input, label, .ant-select, .ant-tag, .history-tag-cell',
                      )) {
                        return;
                      }
                      setExpandedHistoryKeys((prev) => (prev.includes(record.id) ? [] : [record.id]));
                    },
                  })}
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
                  <Text>已选中 {selectedHistoryKeys.length} 场赛事，选择要添加的标签（仅可选择一个）：</Text>
                  <Select
                    showSearch
                    autoFocus
                    value={batchTagValue ?? undefined}
                    placeholder="选择标签"
                    options={allHistoryTags.map((tag) => ({ value: tag, label: tag }))}
                    onChange={setBatchTagValue}
                    className="history-tag-select"
                    optionFilterProp="label"
                  />
                </Space>
              </Modal>
            </Space>
          ) : null}

          {view === 'sync' ? (
            <SyncView
              scope={{
                applyCloudPreview,
                applySyncPreview,
                checkCloudInbox,
                clearRememberedExclusions,
                closeCloudPreview,
                closeSyncPreview,
                cloudAckCode,
                cloudAckSource,
                cloudAckSources,
                cloudAssignDraft,
                cloudAssignMatches,
                cloudAssignOpen,
                cloudAssignPeers,
                cloudAssignWaveGroups,
                cloudBusy,
                cloudDistInfo,
                cloudInboxCount,
                cloudKeyDraft,
                cloudLabelDraft,
                cloudLiveBadge,
                cloudMachineText,
                cloudPeerDraft,
                cloudPreviewFlow,
                cloudPullNothingToMerge,
                cloudRoleDraft,
                cloudRoomGuard,
                cloudSaving,
                cloudStatus,
                cloudSyncState,
                cloudTesting,
                cloudTimeline,
                cloudTodo,
                cloudTokenDraft,
                cloudVersionText,
                cloudWorkerUrlDraft,
                exportSyncBundle,
                handleSyncFile,
                loadSyncPreview,
                machineCodeInput,
                machineCodeSaving,
                markCloudPullReviewed,
                openCloudAssign,
                pollCloudStatus,
                pullCloudBundle,
                pushCloudBundle,
                rejectCloudInbox,
                resolveCloudRoomGuard,
                resolveSyncConflicts,
                saveCloudAssignDraft,
                saveCloudSettings,
                saveMachineCode,
                setCloudAssignDraft,
                setCloudAssignOpen,
                setCloudKeyDraft,
                setCloudLabelDraft,
                setCloudPeerDraft,
                setCloudRoleDraft,
                setCloudRoomGuard,
                setCloudTokenDraft,
                setCloudWorkerUrlDraft,
                setMachineCodeInput,
                setSyncActiveKey,
                setSyncCollapsedGroupKeys,
                setSyncExportInclAvatars,
                setSyncExportInclProfiles,
                setSyncIncludeAvatars,
                setSyncMode,
                setSyncOverwriteAvatars,
                setSyncSelectedKeys,
                switchCloudAckSource,
                SYNC_ACTION_LABELS,
                SYNC_KIND_LABELS,
                syncActiveItem,
                syncActiveKey,
                syncCollapsedGroupKeys,
                syncConflictCount,
                syncExcludedMatchKeys,
                syncExcludedTournamentIds,
                syncExportInclAvatars,
                syncExportInclProfiles,
                syncExporting,
                syncFile,
                syncGroupOfMatchKey,
                syncImporting,
                syncIncludeAvatars,
                syncMatchActionCounts,
                syncMatchRows,
                syncMode,
                syncOverwriteAvatars,
                syncPreview,
                syncPreviewLoading,
                syncPreviewNotes,
                syncPreviewRows,
                syncSelectedKeys,
                testCloudWorker,
                toggleSyncTournamentGroup,
                tournamentNameMap,
                tournamentRecordMap,
                uploadCloudResults,
              }}
            />
          ) : null}

          {view === 'profiles' ? (
            <Card
              title="选手与战队"
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
                      <Dropdown
                        menu={{
                          items: [
                            { key: 'json', label: '下载 JSON 示例' },
                            { key: 'xlsx', label: '下载 Excel 模板' },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'json') {
                              downloadPlayerImportTemplate();
                            } else {
                              void downloadPlayerImportXlsxTemplate();
                            }
                          },
                        }}
                      >
                        <Button loading={playerExporting}>下载示例</Button>
                      </Dropdown>
                      <Tooltip title="导出当前选手为 Excel（含头像、常用精灵带下拉），可用 WPS 编辑后再导入；无选手时导出空白模板">
                        <Button loading={playerExporting} onClick={() => void exportPlayersXlsx()}>导出信息</Button>
                      </Tooltip>
                      <Tooltip title="支持 .xlsx（可携带嵌入的浮动头像）与 .json（仅文字字段）">
                        <Upload
                          accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          showUploadList={false}
                          beforeUpload={(file) => handlePlayerImportFile(file as File)}
                        >
                          <Button>导入信息</Button>
                        </Upload>
                      </Tooltip>
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
                              <Hint>{option.description}</Hint>
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
              tournaments={tournaments}
              metric={statsMetric}
              player={statsPlayer}
              tag={statsTag}
              tournamentId={statsTournamentId}
              search={statsSearch}
              onMetricChange={setStatsMetric}
              onPlayerChange={setStatsPlayer}
              onTagChange={setStatsTag}
              onTournamentChange={setStatsTournamentId}
              onSearchChange={setStatsSearch}
              page5TitleDraft={page5TitleDraft}
              page5TournamentId={stage?.page5TournamentId ?? ''}
              page5Stage={stage?.page5Stage ?? ''}
              stageSaving={stageSaving}
              onPage5TitleChange={setPage5TitleDraft}
              onPage5TitleBlur={() => { void savePage5TitleNow(); }}
              onPage5DisplayChange={(patch) => { void saveStage(stage?.page ?? 'page3', { silent: true, ...patch }); }}
              page15TournamentId={stage?.page15TournamentId ?? ''}
              page15Stage={stage?.page15Stage ?? ''}
              page15SortBy={stage?.page15SortBy ?? 'picks'}
              page15SortOrder={stage?.page15SortOrder ?? 'desc'}
              page15ReplayPlay={stage?.page15ReplayPlay ?? false}
              onPage15DisplayChange={(patch) => { void saveStage(stage?.page ?? 'page3', { silent: true, ...patch }); }}
              onPage15Replay={handlePage15Replay}
            />
          ) : null}

          {view === 'live' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                title="面板实时预览"
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
                              <Surface tone="card" key={`live-${side}-${index}`} className="live-slot-card">
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
                              </Surface>
                            ))}
                          </div>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                  <Row gutter={[16, 16]}>
                    <Col xs={24}>
                      <LiveWatchCard
                        enabled={liveConfigEnabled}
                        busy={liveWatchBusy}
                        supported={liveDesktopSupported}
                        filePath={liveFilePath}
                        fileName={liveFilePath ? getLiveConfigFileName(liveFilePath) : ''}
                        snapshot={liveWatch}
                        heartbeat={liveHeartbeatRef}
                        rememberedPath={liveRememberedPath}
                        onToggle={handleLiveConfigWatchToggle}
                        onPickFile={() => { void startLiveConfigWatch(); }}
                        onRestore={() => { void restoreLiveConfigWatch(); }}
                        onForget={forgetLiveWatchPath}
                        onUpload={handleLiveConfigUpload}
                      />
                    </Col>
                  </Row>
                </Space>
              </Card>
            </Space>
          ) : null}

          {view === 'mvp' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                className="stage-control-card"
                title="MVP 结算画面（推流页面4）"
                extra={(
                  <Space wrap>
                    <Button href="/roco-pvp-page4.html" target="_blank">打开结算画面</Button>
                  </Space>
                )}
              >
                <Space direction="vertical" size={16} className="page-stack">
                  {/* 操作引导条：与赛事面板「当前比赛」的状态条同款 */}
                  <div className="current-match-statusbar">
                    <Steps current={mvpProgress.current} items={mvpProgress.items} responsive />
                  </div>
                  <Row gutter={[16, 16]} className="stage-config-cards">
                    <Col xs={24} xl={10}>
                      <Card size="small" className="subtle-card" title="显示控制">
                        <Space direction="vertical" size={12} className="control-stack">
                          <Space wrap>
                            <Button type="primary" loading={mvpSaving} disabled={!mvpMarked} onClick={() => void showMvpSettlement()}>
                              显示 MVP 结算
                            </Button>
                            <Button danger loading={mvpSaving} disabled={!mvpVisible} onClick={() => void hideMvpSettlement()}>
                              关闭
                            </Button>
                            {mvpVisible ? <Tag color="green">正在显示</Tag> : <Tag>未显示</Tag>}
                          </Space>
                          <Space size={8} wrap>
                            <Tag color={mvpAssignedCount ? 'gold' : 'default'}>
                              已标记精灵 {mvpAssignedCount}/{MVP_MAX_ITEMS}
                            </Tag>
                            {mvpTagsComplete ? <Tag color="green">标签已完整</Tag> : <Tag color="orange">标签未完整</Tag>}
                            {mvpMarked
                              ? <Tag color="red">已标记 MVP</Tag>
                              : <Tag>未标记 MVP</Tag>}
                          </Space>
                          {/* 已载入胜方：名字 + 头像（头像按快照 matchId+side 解析，未上传回退默认占位图） */}
                          <Space size={10} align="center" wrap>
                            <img
                              className="mvp-winner-avatar"
                              src={getMvpWinnerAvatarSrc()}
                              alt={mvp?.winner?.playerName || '胜方选手'}
                            />
                            <Space direction="vertical" size={0}>
                              <Text strong>{mvp?.winner?.playerName || '未载入胜方'}</Text>
                              <Hint>
                                {mvp?.winner
                                  ? `已载入胜方 · ${mvp.winner.side === 'left' ? '左侧' : '右侧'} · ${mvp.winner.matchId}`
                                  : '点「载入当前对局胜方」后在这里显示选手头像'}
                              </Hint>
                            </Space>
                          </Space>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} xl={14}>
                      <Card
                        size="small"
                        className="subtle-card"
                        title={mvpWinnerLineup.side
                          ? `当前对局胜者阵容（${mvpWinnerLineup.playerName || '胜者'} · 第 ${mvpWinnerLineup.gameNumber} 局）`
                          : '当前对局胜者阵容'}
                        extra={(
                          <Button size="small" disabled={!mvpWinnerLineup.side || mvpSaving} onClick={fillMvpWinnerLineup}>
                            载入当前对局胜方
                          </Button>
                        )}
                      >
                        {mvpWinnerPetIds.length ? (
                          <>
                            <div className="mvp-lineup-grid">
                              {mvpWinnerPetIds.map((petId) => {
                                const sprite = spriteMap.get(petId);
                                const active = mvpSlotsDraft.some((slot) => slot.petId === petId);
                                return (
                                  <button
                                    key={petId}
                                    type="button"
                                    className={`mvp-lineup-item${active ? ' is-active' : ''}`}
                                    onClick={() => toggleMvpWinnerSprite(petId)}
                                  >
                                    <img src={sprite?.iconUrl || sprite?.path || '/assets/ui/back.png'} alt={sprite?.displayName || petId} />
                                    <span>{sprite?.displayName || petId}</span>
                                  </button>
                                );
                              })}
                            </div>
                            <Paragraph type="secondary" style={{ margin: '10px 0 0', fontSize: 12 }}>
                              点击精灵加入 / 再点移除（仅最终形态，最多 {MVP_MAX_ITEMS} 个），顺序即展示顺序。
                            </Paragraph>
                          </>
                        ) : (
                          <EmptyState title="当前对局还没有已分胜负的小局（或胜者阵容中没有最终形态精灵）" />
                        )}
                        {mvpWinnerOutdated ? (
                          <Paragraph type="warning" style={{ margin: '10px 0 0', fontSize: 12 }}>
                            当前对局胜方与已载入的不一致，推流画面仍显示已载入的胜方；如需更新请点「载入当前对局胜方」。
                          </Paragraph>
                        ) : null}
                      </Card>
                    </Col>
                  </Row>
                  <Card size="small" className="subtle-card" title="精灵项标签与 MVP 标记">
                    <Space direction="vertical" size={10} className="page-stack" style={{ width: '100%' }}>
                      {mvpSlotsDraft.map((slot, index) => {
                        const sprite = slot.petId ? spriteMap.get(slot.petId) : null;
                        return (
                          <Row key={index} gutter={[12, 8]} align="middle">
                            <Col flex="32px">
                              <Text strong>{index + 1}</Text>
                            </Col>
                            <Col flex="220px">
                              {sprite ? (
                                <Space size={8} align="center">
                                  <img
                                    className="mvp-slot-avatar"
                                    src={sprite.iconUrl || sprite.path || '/assets/ui/back.png'}
                                    alt={sprite.displayName}
                                  />
                                  <Text ellipsis style={{ maxWidth: 150 }}>{sprite.displayName}</Text>
                                </Space>
                              ) : (
                                <Text type="secondary">未选择精灵</Text>
                              )}
                            </Col>
                            <Col flex="280px">
                              <AutoComplete
                                value={slot.tag}
                                disabled={!slot.petId}
                                style={{ width: '100%' }}
                                options={MVP_TAG_PRESETS.map((tag) => ({ value: tag }))}
                                filterOption={(input, option) => String(option?.value ?? '').includes(input.trim())}
                                onChange={(value) => updateMvpSlotDraft(index, { tag: String(value ?? '').slice(0, MVP_TAG_MAX_LENGTH) })}
                              >
                                <Input
                                  maxLength={MVP_TAG_MAX_LENGTH}
                                  placeholder="标签，最多四个字（可留空）"
                                  onBlur={saveMvpTagDraft}
                                  onPressEnter={saveMvpTagDraft}
                                />
                              </AutoComplete>
                            </Col>
                            <Col flex="auto">
                              <Space wrap size={8}>
                                <Button
                                  size="small"
                                  type={slot.isMvp ? 'primary' : 'default'}
                                  disabled={!slot.petId}
                                  onClick={() => toggleMvpSlotMvp(index)}
                                >
                                  {slot.isMvp ? 'MVP 已标记' : '标记 MVP'}
                                </Button>
                                <Button size="small" type="text" danger disabled={!slot.petId} onClick={() => clearMvpSlot(index)}>
                                  清空
                                </Button>
                              </Space>
                            </Col>
                          </Row>
                        );
                      })}
                    </Space>
                  </Card>
                </Space>
              </Card>
            </Space>
          ) : null}

          {view === 'stage' ? (
            <Space direction="vertical" size={18} className="page-stack">
              <Card
                className="stage-control-card"
                title="推流画面"
                extra={
                  <Space wrap>
                    <Button href="/" target="_blank">打开推流页面</Button>
                    <Button onClick={handleCopyStageLocalAddress}>复制推流页地址</Button>
                  </Space>
                }
              >
                <Space direction="vertical" size={16} className="page-stack">
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
                              <Hint>{option.description}</Hint>
                              <StageThumb label={option.label} previewPath={option.previewPath} />
                            </Space>
                          </Card>
                        </Col>
                      );
                    })}
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
                title={getPreviewNavLabel(previewSlot)}
                extra={<Button type="primary" href={buildPreviewUrl(previewSlot)} target="_blank">新窗口打开</Button>}
              >
                <div className="preview-layout">
                  {/* 左侧分组导航：18 个预览槽位全部列出，超高在本列内滚动，不再像原来那排 Segmented 被裁掉 */}
                  <nav className="preview-nav" aria-label="预览页面选择">
                    {PREVIEW_NAV_GROUPS.map((group) => (
                      <div className="preview-nav-group" key={group.title}>
                        <div className="preview-nav-group-title">{group.title}</div>
                        {group.items.map((item) => {
                          const selected = item.slot === previewSlot;
                          return (
                            <button
                              type="button"
                              key={item.slot}
                              className={selected ? 'preview-nav-item is-active' : 'preview-nav-item'}
                              aria-current={selected ? 'page' : undefined}
                              onClick={() => setPreviewSlot(item.slot)}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </nav>
                  <div className="preview-main">
                    {/* 地址行：原来两张 Statistic 卡各占半屏，收成一行小字 + 复制按钮，把高度让给画面 */}
                    <div className="preview-address-row">
                      <div className="preview-address">
                        <span className="preview-address-label">预览地址</span>
                        <Tooltip title={`本地：${getLocalAddressText(previewSlot)}　完整：${buildPreviewUrl(previewSlot)}`}>
                          <code className="preview-address-text">{getLocalAddressText(previewSlot)}</code>
                        </Tooltip>
                      </div>
                      <Space size={8}>
                        <Button size="small" onClick={() => void handleCopyLocalAddress()}>复制地址</Button>
                        <Button size="small" onClick={() => void handleCopyPreviewLink()}>复制链接</Button>
                      </Space>
                    </div>
                    {previewSlot === 'page6' || previewSlot === 'page7' || previewSlot === 'page8' ? (
                      <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                        对局选择与推送在「比赛管理」视图顶部的功能卡片中完成：点击对应卡片，在弹窗内勾选比赛、调整场序{previewSlot === 'page6' || previewSlot === 'page8' ? '与场序时间' : ''}后确认推送（最多 {PAGE8_MAX_MATCHES} 场）。
                      </Paragraph>
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
                  </div>
                </div>
              </Card>
            </Space>
          ) : null}

          {view === 'tournament' ? (
            <TournamentView
              tournaments={tournaments}
              profiles={profiles}
              matches={matchStore.matches}
              activeMatchId={matchStore.activeMatchId}
              undo={matchStore.undo}
              onMatchAction={(matchId, action, extra) => void runMatchAction(matchId, action, extra)}
              onOpenMatchPanel={openMatchPanel}
              registerGate={cloudRegisterGate}
              undoGate={cloudUndoGate}
              sprites={sprites}
              machineCode={machineCodeInput}
              locallyRemoved={locallyRemoved}
              recycleBin={recycleBin}
              onJumpToRoster={() => setView('roster')}
              onMatchesStore={(store) => applyServerState({ store })}
            />
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
                    </Space>
                  </Card>
            </Space>
          ) : null}
        </Content>
      </Layout>

      {/* 系列比赛卡片：右键菜单 / 「⋯」打开的对局面板（复用「当前比赛」面板）。
          mask=false：晋级图仍可点，点另一张卡片即切换目标 → 连续登记多场；
          面板里的动作是 headless 登记（不切当前比赛、不覆写推流画面），只有「设为当前比赛」才切。 */}
      <Drawer
        title={matchPanelTarget
          ? `对局面板 · ${matchPanelTarget.leftPlayer || '左侧'} vs ${matchPanelTarget.rightPlayer || '右侧'}`
          : '对局面板'}
        placement="right"
        width={MODAL_WIDTH.lg}
        open={view === 'tournament' && Boolean(matchPanelTarget)}
        onClose={() => setMatchPanelTargetId(null)}
        mask={false}
        destroyOnHidden
        className="match-panel-drawer"
        // antd 里 Modal / Drawer 的默认 z-index 相同（均为 1000+100），谁在上只由 portal 的
        // DOM 顺序决定；Drawer 的 portal 后创建，会压住从它内部打开的弹窗（录入阵容、切换确认）。
        // 显式降到弹窗基值（1000）以下，保证抽屉里弹出的任何对话框都在抽屉之上。
        zIndex={900}
      >
        {matchPanelTarget ? (
          <Space direction="vertical" size={16} className="page-stack">
            {(() => {
              const target = matchPanelTarget;
              const isCurrent = target.id === activeMatch?.id;
              const ref = target.tournamentRef;
              const tournament = ref ? tournamentRecordMap.get(ref.tournamentId) : undefined;
              const stageRound = ref && tournament ? formatStageRoundLabel(tournament, ref) : null;
              return (
                <div className={`match-panel-status${isCurrent ? ' is-current' : ''}`}>
                  <Space wrap size={8} className="match-panel-status-head">
                    {tournament ? <Tag color="purple">🏆 {tournament.name}</Tag> : null}
                    {stageRound ? <Tag bordered={false}>{stageRound}</Tag> : null}
                    <MatchStatusTag status={target.status} />
                    {rosterNotice ? (
                      <Tag
                        closable
                        bordered={false}
                        color={getNoticeTagColor(rosterNotice.tone)}
                        onClose={() => setRosterNotice(null)}
                      >
                        {rosterNotice.text}
                      </Tag>
                    ) : null}
                  </Space>
                  <div className="match-panel-stream">
                    <span className="match-panel-stream-dot" aria-hidden="true" />
                    <span className="match-panel-stream-label">{isCurrent ? '本场正在推流' : '当前推流'}</span>
                    <span className="match-panel-stream-names">
                      {activeMatch ? (
                        <>
                          <span className="match-panel-stream-name">{activeMatch.leftPlayer || '左侧'}</span>
                          <span className="match-panel-stream-vs">vs</span>
                          <span className="match-panel-stream-name">{activeMatch.rightPlayer || '右侧'}</span>
                        </>
                      ) : (
                        <span className="match-panel-stream-name">未选择</span>
                      )}
                    </span>
                    {!isCurrent ? (
                      <Button
                        size="small"
                        className="match-panel-stream-action"
                        onClick={() => selectMatch(target.id, { navigate: false })}
                      >
                        设为当前比赛（覆写推流画面）
                      </Button>
                    ) : null}
                  </div>
                  <Text type="secondary" className="match-panel-status-note">
                    {isCurrent
                      ? '开始 / 登记 / 撤回都直接写本场，推流画面会同步更新。'
                      : '本场不是当前比赛：开始 / 登记 / 撤回都只写这场比赛，上面那场推流画面保持不变。'}
                  </Text>
                </div>
              );
            })()}
            {buildCurrentMatchPanel(matchPanelTarget, 'drawer')}
            {/* 阵容区分两种形态（互斥）：
                本场=当前比赛 → 上面 CurrentMatchPanel 的 rosterEditor 插槽已渲染可编辑的「当前阵容」面板；
                本场≠当前比赛 → 渲染该场自己的 6v6 阵容快照（复用「查看阵容」正文）。
                只读正文读的是目标比赛自己的 games（与推流面板无关），「录入阵容」只写比赛记录、不动画面。 */}
            {matchPanelTarget.id !== matchStore.activeMatchId ? (
              <Card size="small" title="双方阵容" className="match-panel-lineup-card">
                <MatchLineupDetailPanel
                  match={matchPanelTarget}
                  stageRoundText={matchPanelTargetStageRound}
                  sprites={sprites}
                  hideSummary
                  onEnterLineup={(matchId, gameNumber) => setLineupEntry({ matchId, gameNumber })}
                />
              </Card>
            ) : null}
          </Space>
        ) : null}
      </Drawer>

      {/* 录入阵容弹窗挂在 App 根：比赛管理「录入阵容」与系列比赛 Drawer「双方阵容」卡共用同一份目标状态 */}
      <HistoryLineupEntryModal
        open={Boolean(lineupEntry && lineupEntryMatch && lineupEntryGame)}
        match={lineupEntryMatch}
        game={lineupEntryGame}
        sprites={sprites}
        onClose={() => setLineupEntry(null)}
        onSaved={(store) => applyServerState({ store })}
      />

      {/* 顶栏弹窗：倒计时控制（原「直播推流 / 倒计时插件」卡片） */}
      <Modal
        title="倒计时控制"
        open={countdownModalOpen}
        onCancel={() => setCountdownModalOpen(false)}
        footer={null}
        width={MODAL_WIDTH.sm}
      >
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
            {countdown ? <CountdownRemainingText state={countdown} clockOffsetMs={countdownClockRef.current.offset} /> : null}
          </Space>
        </Space>
      </Modal>

      {/* 顶栏弹窗：下一场预告（原「直播推流 / 下场对局」卡片） */}
      <Modal
        title="下一场预告"
        open={nextgameModalOpen}
        onCancel={() => setNextgameModalOpen(false)}
        footer={null}
        width={MODAL_WIDTH.sm}
      >
        <Space direction="vertical" size={12} className="control-stack">
          <Text type="secondary">开启后仅在「阵容展示3」显示下场对局预告，其他展示页面不受影响。</Text>
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
      </Modal>

      {/* 顶栏弹窗：画面设置（原「直播推流」的四张设置卡片按 Tab 归并） */}
      <Modal
        title="画面设置"
        open={screenSettingsModalOpen}
        onCancel={() => setScreenSettingsModalOpen(false)}
        footer={null}
        width={MODAL_WIDTH.lg}
      >
        {/* 左侧竖向导航：分组名保留「对哪个页面设置」的语义；固定内容高度避免切换跳动 */}
        <Tabs
          tabPosition="left"
          style={{ minHeight: 500 }}
          items={[
            {
              key: 'page2',
              label: '阵容展示2',
              children: (
                <div className="control-stack">
                  <SettingField variant="stack" label="赛事标题" hint="阵容展示2 显示的比赛标题，最长 40 字。">
                    <Input
                      maxLength={40}
                      value={page2EventTitleDraft}
                      onChange={(event) => setPage2EventTitleDraft(event.target.value)}
                      onBlur={() => { void savePage2FieldNow({ eventTitle: page2EventTitleDraft }); }}
                    />
                  </SettingField>
                  <SettingField variant="row" label="阵容展示方式" hint="精灵行显示血量，或只显示头像。">
                    <Select
                      style={{ width: 220 }}
                      value={scoreboard?.page2LineupDisplayMode ?? 'default'}
                      disabled={!scoreboard}
                      options={[
                        { value: 'default', label: '血量展示' },
                        { value: 'avatar-only', label: '仅头像展示' },
                      ]}
                      onChange={(value) => { void savePage2FieldNow({ page2LineupDisplayMode: value as 'default' | 'avatar-only' }); }}
                    />
                  </SettingField>
                </div>
              ),
            },
            {
              key: 'page3',
              label: '阵容展示3',
              children: (
                <div className="control-stack">
                  <SettingField variant="row" label="精灵图片" hint="显示精灵原图还是头像。">
                    <Segmented
                      value={stage?.page3SpriteSource ?? 'sprite'}
                      disabled={stageSaving}
                      options={[
                        { value: 'sprite', label: '精灵原图' },
                        { value: 'icon', label: '精灵头像' },
                      ]}
                      onChange={(value) => { void saveStage(stage?.page ?? 'page3', { silent: true, page3SpriteSource: value as SpriteSource }); }}
                    />
                  </SettingField>
                  <SettingField
                    variant="row"
                    label="红光特效"
                    hint="一方阵亡 3 只精灵时自动亮起（含卡瓦重 / 卡卡虫 / 丢丢则需 4 只）；「立即显示」为手动触发一次，进入下一局自动取消。"
                  >
                    <Segmented
                      value={stage?.page3RedLightMode ?? 'off'}
                      disabled={stageSaving}
                      options={[
                        { value: 'off', label: '关闭' },
                        { value: 'auto', label: '自动开启' },
                      ]}
                      onChange={(value) => { void saveStage(stage?.page ?? 'page3', { silent: true, page3RedLightMode: value as Page3RedLightMode }); }}
                    />
                    <Button
                      type={stage?.page3RedLightInstant ? 'default' : 'primary'}
                      danger={Boolean(stage?.page3RedLightInstant)}
                      disabled={stageSaving}
                      loading={stageSaving}
                      onClick={() => { void saveStage(stage?.page ?? 'page3', { silent: true, page3RedLightInstant: !(stage?.page3RedLightInstant ?? false) }); }}
                    >
                      {stage?.page3RedLightInstant ? '取消显示' : '立即显示'}
                    </Button>
                    {stage?.page3RedLightInstant ? <span className="setting-status red">显示中</span> : null}
                  </SettingField>
                  <SettingField variant="row" label="排位图标" hint="比分栏两侧的排位排名徽标；阵容展示5 的排名显示也由这里控制。">
                    <Switch
                      checked={stage?.page3RankVisible ?? false}
                      disabled={stageSaving}
                      loading={stageSaving}
                      onChange={(checked) => { void saveStage(stage?.page ?? 'page3', { silent: true, page3RankVisible: checked }); }}
                    />
                    <span className={stage?.page3RankVisible ? 'setting-status on' : 'setting-status'}>
                      {stage?.page3RankVisible ? '已开启' : '已关闭'}
                    </span>
                  </SettingField>
                  <SettingField variant="row" label="战队标识" hint="显示选手的战队标识。">
                    <Switch
                      checked={stage?.page3TeamVisible ?? false}
                      disabled={stageSaving}
                      loading={stageSaving}
                      onChange={(checked) => { void saveStage(stage?.page ?? 'page3', { silent: true, page3TeamVisible: checked }); }}
                    />
                    <span className={stage?.page3TeamVisible ? 'setting-status on' : 'setting-status'}>
                      {stage?.page3TeamVisible ? '已开启' : '已关闭'}
                    </span>
                  </SettingField>
                </div>
              ),
            },
            {
              key: 'page16',
              label: '阵容展示4/5',
              children: (
                <div className="control-stack">
                  <SettingField variant="row" label="精灵图片" hint="阵容展示4/5 共用：卡片里的精灵显示原图还是头像。">
                    <Segmented
                      value={stage?.page16SpriteSource ?? 'sprite'}
                      disabled={stageSaving}
                      options={[
                        { value: 'sprite', label: '精灵原图' },
                        { value: 'icon', label: '精灵头像' },
                      ]}
                      onChange={(value) => { void saveStage(stage?.page ?? 'page16', { silent: true, page16SpriteSource: value as SpriteSource }); }}
                    />
                  </SettingField>
                  <SettingField variant="row" label="排名数字" hint="阵容展示4 底部选手头像卡上的排名数字，选手有排名时才显示；阵容展示5 的排名开关在「阵容展示3」的排位图标里。">
                    <Switch
                      checked={stage?.page16RankVisible ?? true}
                      disabled={stageSaving}
                      loading={stageSaving}
                      onChange={(checked) => { void saveStage(stage?.page ?? 'page16', { silent: true, page16RankVisible: checked }); }}
                    />
                    <span className={stage?.page16RankVisible ? 'setting-status on' : 'setting-status'}>
                      {stage?.page16RankVisible ? '已开启' : '已关闭'}
                    </span>
                  </SettingField>
                  <SettingField
                    variant="stack"
                    label="卡片标签"
                    hint={(
                      <>
                        <div>
                          <Tag style={{ marginInlineEnd: 6 }}>编号</Tag>
                          按所选数值从高到低给双方 12 张卡编号，数值相同的并列同名次；选「名字」时仍按种族值总和排。
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <Tag style={{ marginInlineEnd: 6 }}>标签</Tag>
                          显示对应数值的图标和数值；选「名字」时改显精灵名。
                        </div>
                      </>
                    )}
                  >
                    <Segmented
                      block
                      value={stage?.page16CardLabel ?? 'sum'}
                      disabled={stageSaving}
                      options={PAGE16_CARD_LABEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(value) => { void saveStage(stage?.page ?? 'page16', { silent: true, page16CardLabel: value as Page16CardLabel }); }}
                    />
                  </SettingField>
                </div>
              ),
            },
            {
              key: 'page11',
              label: '选手介绍',
              children: (
                <div className="control-stack">
                  <SettingField variant="row" label="排位排名" hint="选手介绍画面上的排名数字，选手有排名时才显示。">
                    <Switch
                      checked={stage?.page11RankVisible ?? true}
                      disabled={stageSaving}
                      loading={stageSaving}
                      onChange={(checked) => { void saveStage(stage?.page ?? 'page3', { silent: true, page11RankVisible: checked }); }}
                    />
                    <span className={stage?.page11RankVisible ? 'setting-status on' : 'setting-status'}>
                      {stage?.page11RankVisible ? '已开启' : '已关闭'}
                    </span>
                  </SettingField>
                </div>
              ),
            },
            {
              key: 'transition',
              label: '画面切换',
              children: (
                <div className="control-stack">
                  <SettingField variant="row" label="切换过渡效果" hint="切换直播推流画面时的过渡动效。">
                    <Segmented
                      value={normalizeStageTransition(stage?.transition)}
                      disabled={stageSaving}
                      options={STAGE_TRANSITION_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      onChange={(value) => { void saveStage(stage?.page ?? 'page3', { silent: true, transition: value as StageTransitionType }); }}
                    />
                  </SettingField>
                  <SettingField variant="row" label="胜者结算停留时长" hint="登记本局胜负后自动切入页面10，停留该时长后切回原画面。">
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
                  </SettingField>
                  <SettingField
                    variant="row"
                    label="战绩详情切屏间隔"
                    hint="页面7 每屏停留该时长后自动翻到下一屏，修改立即生效。"
                  >
                    <InputNumber
                      min={PAGE7_SWITCH_MIN_SECONDS}
                      max={PAGE7_SWITCH_MAX_SECONDS}
                      addonAfter="秒"
                      value={stage?.page7SwitchSeconds ?? DEFAULT_PAGE7_SWITCH_SECONDS}
                      disabled={stageSaving}
                      onChange={(value) => {
                        void saveStage(stage?.page ?? 'page3', {
                          silent: true,
                          page7SwitchSeconds: value === null || value === undefined
                            ? DEFAULT_PAGE7_SWITCH_SECONDS
                            : Number(value),
                        });
                      }}
                    />
                  </SettingField>
                </div>
              ),
            },
          ]}
        />
      </Modal>

      {/* 顶栏弹窗：直播推送教程（获取推流地址 → OBS / 直播姬 填入方式） */}
      <Modal
        title="如何进行直播推送？"
        open={streamGuideOpen}
        onCancel={() => setStreamGuideOpen(false)}
        footer={null}
        width={MODAL_WIDTH.lg}
      >
        <Space direction="vertical" size={16} className="control-stack" style={{ width: '100%' }}>
          <div>
            <Tag color="gold">第一步 · 获取推流地址</Tag>
            <div className="stream-guide-step-desc">
              在直播平台（如B站直播间设置页）按下图获取推流地址：
            </div>
            <img className="stream-guide-img" src={streamGuideAddress} alt="获取推流地址" />
          </div>
          <div>
            <Tag color="gold">第二步 · 填入直播软件</Tag>
            <div className="stream-guide-step-desc">按使用的软件选择对应教程，填入上一步拿到的推流地址：</div>
            <Tabs
              items={[
                {
                  key: 'obs',
                  label: 'OBS',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <img className="stream-guide-img" src={streamGuideObs1} alt="OBS 添加浏览器源（1）" />
                      <img className="stream-guide-img" src={streamGuideObs2} alt="OBS 填入推流地址（2）" />
                    </Space>
                  ),
                },
                {
                  key: 'hime',
                  label: '直播姬',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <img className="stream-guide-img" src={streamGuideHime1} alt="直播姬填入推流地址（1）" />
                      <img className="stream-guide-img" src={streamGuideHime2} alt="直播姬填入推流地址（2）" />
                      <img className="stream-guide-img" src={streamGuideHime3} alt="直播姬填入推流地址（3）" />
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title="快速创建比赛"
        open={quickCreateOpen}
        onCancel={() => setQuickCreateOpen(false)}
        onOk={() => void quickCreateMatches()}
        okText="随机配对创建"
        cancelText="取消"
        confirmLoading={quickCreateSaving}
        width={MODAL_WIDTH.md}
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
              prefix={<span className="roco-muted">搜索</span>}
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
                      {player.rank ? <Hint>（排名 {player.rank}）</Hint> : null}
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
              <Form.Item label="标签（可选）">
                <Select
                  mode="multiple"
                  allowClear
                  style={{ width: '100%' }}
                  placeholder="可选，选择标签"
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
                  reusePlayerProfile('left', player);
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
                  reusePlayerProfile('right', player);
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
              <Form.Item label="左侧选手头像（留空则用档案头像，无档案用默认）">
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
              <Form.Item label="右侧选手头像（留空则用档案头像，无档案用默认）">
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
          <Form.Item label="标签" name="tags">
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder="可选，选择标签"
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
              prefix={<span className="roco-muted">搜索</span>}
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
                        {selected ? <span style={{ marginLeft: 'auto', color: 'var(--roco-brand-text)', fontSize: 14 }}>✓</span> : null}
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
        title={playerImportSource === 'xlsx' ? '导入选手（Excel）' : '导入选手（JSON）'}
        open={playerImportOpen}
        onCancel={() => {
          setPlayerImportOpen(false);
          resetPlayerImportState();
        }}
        onOk={() => void confirmPlayerImport()}
        okText="确认导入"
        cancelText="取消"
        confirmLoading={playerImporting}
        width={MODAL_WIDTH.md}
      >
        {playerImportSource === 'xlsx' ? (
          <>
            <Paragraph>
              将导入 <Text strong>{playerImportPreview.length}</Text> 名选手。列口径：名字 / 排位排名 / 宣言 / 擅长精灵1..擅长精灵6；嵌入到「头像」列的浮动图片会一并导入。
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              同名选手将更新其排名、宣言与常用精灵，并保留原头像。常用精灵仅在 pets.json 精确命中时录入，未命中的会在导入后提示并给出候选。
            </Paragraph>
          </>
        ) : (
          <>
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
          </>
        )}
        {playerImportWarnings.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`导入提示（${playerImportWarnings.length}）`}
            description={(
              <div>
                {playerImportWarnings.map((warning, index) => (
                  <div key={index}>· {warning}</div>
                ))}
              </div>
            )}
          />
        ) : null}
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
            ...(playerImportSource === 'xlsx'
              ? [{ title: '头像', dataIndex: 'hasAvatar', key: 'hasAvatar', width: 64, render: (value: boolean) => (value ? '有' : '无') }]
              : []),
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
        width={MODAL_WIDTH.sm}
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
        width={MODAL_WIDTH.md}
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
                  <Hint>
                    {item.player.avatarExists ? '原头像' : '原头像（未设置）'}
                  </Hint>
                </div>
              </div>
              <Text type="secondary">→</Text>
              <div style={{ textAlign: 'center' }}>
                <Image preview={false} width={56} height={56} style={{ borderRadius: 8, objectFit: 'cover' }} src={item.url} />
                <div><Hint>新头像</Hint></div>
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
        width={MODAL_WIDTH.sm}
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
    <ConfigProvider theme={rocoTheme} locale={zhCN}>
      <App>
        <AdminDataProvider>
          <Dashboard />
        </AdminDataProvider>
      </App>
    </ConfigProvider>
  );
}
