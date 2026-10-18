/*
This project uses Ant Design (https://ant.design), licensed under the MIT License.
*/
import React, { useEffect, useMemo, useState } from 'react';
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
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { MenuProps } from 'antd';

import {
  DEFAULT_PAGE7_SWITCH_SECONDS,
  PAGE16_CARD_LABEL_OPTIONS,
  PAGE7_SWITCH_MAX_SECONDS,
  PAGE7_SWITCH_MIN_SECONDS,
} from '../../shared/constants';
import type {
  AvatarCollectionState,
  CountdownPayload,
  CountdownState,
  MatchStoreState,
  NextGamePayload,
  PanelState,
  PlayerProfile,
  ScoreboardState,
  SpriteSource,
  Page3RedLightMode,
  Page16CardLabel,
  StageTransitionType,
} from '../../shared/types';

import {
  STAGE_TRANSITION_OPTIONS,
  normalizeStageTransition,
} from './constants';
import { rocoTheme } from '../theme';
import { AdminDataProvider } from './data/admin-data';
import { useAdminData } from './data/use-admin-data';
import { SettingField } from './components/SettingField';

import {
  buildHistoryTags,
  getAdminVisibleMatches,
} from './lib/history';
import { formatStageRoundLabel } from './lib/tournament';
import { getLiveConfigFileName } from './lib/live';
import {
  getActiveMatch,
  getNoticeTagColor,
} from './lib/match';
import { requestJson, uploadSingleFile } from './lib/request';
import { AboutView } from './views/AboutView';
import { Page11View } from './views/Page11View';
import { RosterView } from './views/RosterView';
import { StageView } from './views/StageView';
import { CurrentMatchPanelContainer } from './views/CurrentMatchPanelContainer';
import { RosterEditor } from './views/RosterEditor';
import { PreviewView } from './views/PreviewView';
import { MatchLineupDetailPanel } from './views/MatchLineupDetailModal';
import { HistoryLineupEntryModal } from './views/HistoryLineupEntryModal';
import { StatsView } from './views/StatsView';
import { SyncView } from './views/SyncView';
import { TournamentView } from './views/TournamentView';
import { LiveView } from './views/LiveView';
import { MvpView } from './views/MvpView';
import { ProfilesView } from './views/ProfilesView';
import { HistoryView } from './views/HistoryView';

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
  PanelSide,
  ViewKey,
} from './types';
import { Hint } from './ui/Hint';
import { MatchStatusTag } from './ui/StatusTag';
import { MODAL_WIDTH } from './ui/modal';

const { Header, Sider, Content } = Layout;
const { Title, Paragraph, Text } = Typography;

/** 切换当前赛事确认弹窗的「不再提示」标记：按浏览器本地记忆（localStorage），跨会话保留 */
const SELECT_MATCH_CONFIRM_SUPPRESSED_KEY = 'roco-pvp-lineup:selectMatchConfirmSuppressed';

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
    panels,
    sprites,
    stage,
    stageSaving,
    nextgame,
    countdown,
    countdownClockRef,
    profiles,
    tournaments,
    locallyRemoved,
    recycleBin,
    rosterNotice,
    cloudStatus,
    setAvatars,
    setRosterNotice,
    applyServerState,
    savePanel,
    saveStage,
    live,
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
  const [createMatchOpen, setCreateMatchOpen] = useState(false);
  // 快速创建比赛：从「信息录入」选手多选后随机配对生成对局
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreatePlayerNames, setQuickCreatePlayerNames] = useState<string[]>([]);
  const [quickCreateBestOf, setQuickCreateBestOf] = useState<number>(3);
  const [quickCreateTags, setQuickCreateTags] = useState<string[]>([]);
  const [quickCreateSaving, setQuickCreateSaving] = useState(false);
  const [quickCreateKeyword, setQuickCreateKeyword] = useState('');
  /** 系列比赛对局卡片：右键菜单 / Drawer 弹窗正在操作的那一场（null = 未打开） */
  const [matchPanelTargetId, setMatchPanelTargetId] = useState<string | null>(null);
  const [nextgameSaving, setNextgameSaving] = useState(false);
  const [countdownSaving, setCountdownSaving] = useState(false);
  const [page2EventTitleDraft, setPage2EventTitleDraft] = useState('');
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
  // 比赛管理「录入阵容」弹窗上下文：定位到某场比赛的当前小局（提前录入，不影响推流）
  const [lineupEntry, setLineupEntry] = useState<{ matchId: string; gameNumber: number } | null>(null);
  const [createMatchForm] = Form.useForm<CreateMatchValues>();
  // 赛事面板阵容编辑统一自动保存（600ms 防抖）；始终挂载在 App，切走视图后异步填充仍会落盘
  useEffect(() => {
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
  const activeMatch = getActiveMatch(matchStore);
  const allHistoryTags = buildHistoryTags(matchStore.matches);
  // 比赛管理标签列派生「阶段 · 轮次」只读 Tag 用：id → 完整系列赛记录
  const tournamentRecordMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament])),
    [tournaments],
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
    () => getAdminVisibleMatches(matchStore.matches, locallyRemovedIdSet, recycleBinIdSet),
    [matchStore.matches, locallyRemovedIdSet, recycleBinIdSet],
  );
  // 「实时控制 → 下场对局」待开始下拉：同口径隐藏「本机移除」系列赛的对局（adminVisibleMatches）
  const pendingMatches = adminVisibleMatches.filter((match) => match.status === 'pending');
  // 「录入阵容」弹窗的当前上下文：从最新 store 里解析比赛与小局（socket 更新后自动跟随）
  const lineupEntryMatch = lineupEntry ? matchStore.matches.find((match) => match.id === lineupEntry.matchId) ?? null : null;
  const lineupEntryGame = lineupEntryMatch && lineupEntry
    ? lineupEntryMatch.games.find((game) => game.gameNumber === lineupEntry.gameNumber) ?? null
    : null;
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
    setPage2EventTitleDraft(scoreboard?.eventTitle ?? '');
  }, [scoreboard?.eventTitle]);

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
        label: live.liveConfigEnabled ? (
          <span className="nav-label-with-badge">
            {VIEW_LABEL.live}
            <Tooltip title={`实时监听中：${live.liveFilePath ? getLiveConfigFileName(live.liveFilePath) : ''}`}>
              <Badge status="processing" />
            </Tooltip>
          </span>
        ) : VIEW_LABEL.live,
      },
      { key: 'about', icon: <NavIcon name="about" />, label: VIEW_LABEL.about },
    ],
    [cloudNavPending, cloudNavNewVersion, live.liveConfigEnabled, live.liveFilePath]
  );

  if (loading) {
    return (
      <div className="admin-antd-loading">
        <Spin size="large" />
        <Text>正在加载新的 Ant Design 后台...</Text>
      </div>
    );
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
            <RosterView
              onOpenCreateMatch={() => setCreateMatchOpen(true)}
              onOpenQuickCreate={() => { setQuickCreateKeyword(''); setQuickCreateOpen(true); }}
              onSelectMatch={selectMatch}
            />
          ) : null}

          {view === 'history' ? (
            <HistoryView
              onEnterLineup={(matchId, gameNumber) => setLineupEntry({ matchId, gameNumber })}
              onSelectMatch={selectMatch}
            />
          ) : null}

          {view === 'sync' ? (
            <SyncView />
          ) : null}

          {view === 'profiles' ? (
            <ProfilesView />
          ) : null}

          {view === 'page11' ? (
            <Page11View />
          ) : null}

          {view === 'stats' ? (
            <StatsView />
          ) : null}

          {view === 'live' ? (
            <LiveView />
          ) : null}

          {view === 'mvp' ? (
            <MvpView />
          ) : null}

          {view === 'stage' ? (
            <StageView />
          ) : null}

          {view === 'preview' ? (
            <PreviewView />
          ) : null}

          {view === 'tournament' ? (
            <TournamentView
              onOpenMatchPanel={openMatchPanel}
              onJumpToRoster={() => setView('roster')}
            />
          ) : null}

          {view === 'about' ? (
            <AboutView />
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
            <CurrentMatchPanelContainer
              match={matchPanelTarget}
              variant="drawer"
              rosterEditor={<RosterEditor match={matchPanelTarget} />}
            />
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
