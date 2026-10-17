import React, { createContext, startTransition, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { App } from 'antd';
import { io } from 'socket.io-client';

import { SOCKET_EVENTS } from '../../../shared/events';
import { DEFAULT_PAGE7_SWITCH_SECONDS } from '../../../shared/constants';
import type {
  AvatarCollectionState,
  CloudSyncInboxEntry,
  CloudSyncStatus,
  CloudSyncVersion,
  CountdownPayload,
  CountdownState,
  MatchRecord,
  MatchStoreState,
  MvpState,
  MvpWinnerInfo,
  NextGamePayload,
  NextGameState,
  Page3RedLightMode,
  Page6State,
  Page7State,
  Page8State,
  Page9State,
  Page11State,
  Page14State,
  Page16CardLabel,
  PanelState,
  ProfileStoreState,
  ScoreboardState,
  SpriteRecord,
  SpriteSource,
  StageConfig,
  StagePageKey,
  StageStandings,
  StageTransitionType,
  TournamentRecord,
} from '../../../shared/types';
import { STAGE_OPTIONS, normalizeStagePage, normalizeStageTransition } from '../constants';
import { getActiveMatch, getCurrentGame, getPendingDraftContext } from '../lib/match';
import { buildPanelRequest, createPanelEditorState, draftSlotsToSelected, panelStateToSelected } from '../lib/panel';
import { requestJson } from '../lib/request';
import { buildSpriteLookup } from '../lib/sprite';
import type { NoticeState, PanelEditorState, PanelSide } from '../types';
import { useLiveControl, type LiveControl } from './use-live-control';

/** 切换推流画面 / 保存画面设置的可选覆盖项（缺省沿用当前 stage） */
export interface SaveStageOptions {
  silent?: boolean;
  transition?: StageTransitionType;
  mirrorSides?: boolean;
  page3SpriteSource?: SpriteSource;
  page3RankVisible?: boolean;
  page3TeamVisible?: boolean;
  page3RedLightMode?: Page3RedLightMode;
  page3RedLightInstant?: boolean;
  page11RankVisible?: boolean;
  page5TournamentId?: string;
  page5Stage?: string;
  page15TournamentId?: string;
  page15Stage?: string;
  page15SortBy?: 'picks' | 'games' | 'winRate';
  page15SortOrder?: 'asc' | 'desc';
  page15ReplayPlay?: boolean;
  page16SpriteSource?: SpriteSource;
  page16RankVisible?: boolean;
  page16CardLabel?: Page16CardLabel;
  page7SwitchSeconds?: number;
  page10Duration?: number;
  page10DurationUnit?: 'seconds' | 'minutes';
}

/** applyServerState 的载荷：与各 REST 响应/ socket 广播一一对应，缺省字段表示本次不更新 */
export interface ApplyServerStatePayload {
  scoreboard?: ScoreboardState;
  store?: MatchStoreState;
  avatars?: AvatarCollectionState;
  panels?: PanelState[];
  panel?: PanelState;
  stage?: StageConfig;
  page6?: Page6State;
  page7?: Page7State;
  page8?: Page8State;
  page9?: Page9State;
  page11?: Page11State;
  page14?: Page14State;
  nextgame?: NextGamePayload;
  profiles?: ProfileStoreState;
  tournaments?: TournamentRecord[];
  locallyRemoved?: TournamentRecord[];
  recycleBin?: TournamentRecord[];
  countdown?: CountdownPayload;
  mvp?: MvpState;
}

/**
 * 管理后台共享数据层（M1 建立，M2 起视图把本地状态下沉）。
 *
 * 这里只放「服务端状态 + 订阅 + 初始加载 + 跨视图动作」；视图自己的弹窗 / 草稿 / 筛选
 * 留在各自视图（如 SyncView 的 `views/sync/use-sync-controller.ts`），数据层不再持有它们。
 *
 * 行为约定：
 * - 先保持「任一数据更新 → 全量重渲染」的现有行为（与拆解前完全等价），不做 Context 拆分；
 * - socket 订阅 / 云同步轮询 / 初始加载都只在这里注册一份，视图不得再各自订阅；
 * - 任何 hook 都必须在组件顶层、无条件调用（React #310 踩过）。
 */
export interface AdminData {
  /** 初始加载态（Dashboard 的整页 loading 早退分支读它） */
  loading: boolean;
  /** 初始加载失败文案（顶栏下方 Alert） */
  pageError: string;

  scoreboard: ScoreboardState | null;
  matchStore: MatchStoreState;
  avatars: AvatarCollectionState;
  panels: Record<PanelSide, PanelEditorState>;
  sprites: SpriteRecord[];
  stage: StageConfig | null;
  /** 画面切换 / 画面设置保存中（顶栏、数据统计、直播推流、选手介绍共用） */
  stageSaving: boolean;
  nextgame: NextGameState | null;
  nextgameMatch: MatchRecord | null;
  countdown: CountdownState | null;
  /** 倒计时剩余时间按「服务端时钟偏差」计算；与 state 不同批更新时也不能丢 */
  countdownClockRef: React.RefObject<{ offset: number }>;
  mvp: MvpState | null;
  mvpWinner: MvpWinnerInfo | null;
  page6: Page6State | null;
  page7: Page7State | null;
  page8: Page8State | null;
  page9: Page9State | null;
  page11: Page11State | null;
  page14: Page14State | null;
  page14Standings: StageStandings | null;
  profiles: ProfileStoreState | null;
  tournaments: TournamentRecord[];
  locallyRemoved: TournamentRecord[];
  recycleBin: TournamentRecord[];
  /** 本机标识（运行时配置；SyncView 的输入框以它为初值，保存后回写） */
  machineCode: string;
  /** 比赛管理顶部的最近一条操作提示（数据同步导入成功也会写它，跨视图） */
  historyNotice: NoticeState;
  /** 赛事面板顶部的最近一条操作提示（系列比赛的对局动作也会写它，跨视图） */
  rosterNotice: NoticeState;

  cloudStatus: CloudSyncStatus | null;
  /** 已被主控确认的赛果 id（分控端撤回闸门用） */
  cloudAckedMatchIds: string[];

  setAvatars: Dispatch<SetStateAction<AvatarCollectionState>>;
  setPanels: Dispatch<SetStateAction<Record<PanelSide, PanelEditorState>>>;
  setStage: Dispatch<SetStateAction<StageConfig | null>>;
  setPage6: Dispatch<SetStateAction<Page6State | null>>;
  setPage7: Dispatch<SetStateAction<Page7State | null>>;
  setPage8: Dispatch<SetStateAction<Page8State | null>>;
  setPage9: Dispatch<SetStateAction<Page9State | null>>;
  setPage11: Dispatch<SetStateAction<Page11State | null>>;
  setPage14: Dispatch<SetStateAction<Page14State | null>>;
  setPage14Standings: Dispatch<SetStateAction<StageStandings | null>>;
  setProfiles: Dispatch<SetStateAction<ProfileStoreState | null>>;
  setMachineCode: Dispatch<SetStateAction<string>>;
  setHistoryNotice: Dispatch<SetStateAction<NoticeState>>;
  setRosterNotice: Dispatch<SetStateAction<NoticeState>>;

  /** 统一应用服务端状态（REST 响应 / socket 广播共用） */
  applyServerState: (payload: ApplyServerStatePayload) => void;
  /** 保存某侧阵容草稿（600ms 自动保存的落盘动作；silent=true 不弹成功提示） */
  savePanel: (side: PanelSide, silent?: boolean) => Promise<void>;
  /** 切换推流画面 / 保存画面设置（跨视图共用；silent=true 不弹 toast） */
  saveStage: (nextPage: StagePageKey, options?: SaveStageOptions) => Promise<void>;
  /** 对某场执行流程动作（开始 / 登记胜负 / 撤回 / 取消撤回）：headless，不切当前比赛 */
  runMatchAction: (
    matchId: string,
    action: 'start' | 'undo' | 'redo' | 'winner',
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  /** 云同步登记闸门（分控端未指派 → 置灰） */
  cloudRegisterGate: (matchId: string) => { allowed: boolean; reason: string };
  /** 云同步撤回闸门（分控端已确认 → 禁撤回） */
  cloudUndoGate: (matchId: string) => { allowed: boolean; reason: string };
  /** 重新拉取全部后台数据（首屏、云同步合并后、监听异常兜底） */
  loadInitialData: (showToast?: boolean) => Promise<void>;
  /** 应用云同步状态（只写状态与已确认集；设置区草稿由 SyncView 自己回填） */
  applyCloudStatus: (next: CloudSyncStatus) => void;
  /** 云同步请求统一出口：自动带房间密钥、访问令牌与机器码 */
  postCloud: <T>(pathname: string, body?: Record<string, unknown>) => Promise<T & { status: CloudSyncStatus }>;
  /** 红点轮询：只读云端小键（version / ack / uplink），绝不自动合并数据 */
  pollCloudStatus: (silent?: boolean) => Promise<void>;

  /**
   * 实时控制：监听文件轮询 / 回写定时器 / 状态快照。
   * 挂在常驻 Provider 而不是 LiveView，视图切走监听仍继续、导航呼吸点能从任何视图看到。
   */
  live: LiveControl;
}

export const AdminDataContext = createContext<AdminData | null>(null);

export function AdminDataProvider({ children }: { children: React.ReactNode }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
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
      byMatch: {},
    },
    mtime: null,
  });
  const [avatars, setAvatars] = useState<AvatarCollectionState>({
    left: { side: 'left', exists: false },
    right: { side: 'right', exists: false },
  });
  const [panels, setPanels] = useState<Record<PanelSide, PanelEditorState>>({
    left: createPanelEditorState(),
    right: createPanelEditorState(),
  });
  const [sprites, setSprites] = useState<SpriteRecord[]>([]);
  const [stage, setStage] = useState<StageConfig | null>(null);
  const [stageSaving, setStageSaving] = useState(false);
  const [nextgame, setNextgame] = useState<NextGameState | null>(null);
  const [nextgameMatch, setNextgameMatch] = useState<MatchRecord | null>(null);
  const [countdown, setCountdown] = useState<CountdownState | null>(null);
  const countdownClockRef = useRef({ offset: 0 });
  const [mvp, setMvp] = useState<MvpState | null>(null);
  const [mvpWinner, setMvpWinner] = useState<MvpWinnerInfo | null>(null);
  const [page6, setPage6] = useState<Page6State | null>(null);
  const [page8, setPage8] = useState<Page8State | null>(null);
  const [page7, setPage7] = useState<Page7State | null>(null);
  const [page9, setPage9] = useState<Page9State | null>(null);
  const [page11, setPage11] = useState<Page11State | null>(null);
  const [page14, setPage14] = useState<Page14State | null>(null);
  // 服务端按系列赛阶段重算的榜单（当前阶段；系列赛缺失时为 null）
  const [page14Standings, setPage14Standings] = useState<StageStandings | null>(null);
  const [profiles, setProfiles] = useState<ProfileStoreState | null>(null);
  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  // 本机已「本机移除」的系列赛（localOnly，仅本机视图隐藏）
  const [locallyRemoved, setLocallyRemoved] = useState<TournamentRecord[]>([]);
  // 系列赛回收站（删除后 7 天内可整届恢复的 grace 墓碑）
  const [recycleBin, setRecycleBin] = useState<TournamentRecord[]>([]);
  // 本机标识（运行时配置）：由初始加载写入，SyncView 保存后回写
  const [machineCode, setMachineCode] = useState('');
  // 跨视图提示：比赛管理的操作提示 / 数据同步导入结果都会写它
  const [historyNotice, setHistoryNotice] = useState<NoticeState>(null);
  // 赛事面板顶部的提示：当前比赛面板与系列比赛的对局动作共用
  const [rosterNotice, setRosterNotice] = useState<NoticeState>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null);
  const [cloudPollNotified, setCloudPollNotified] = useState('');
  const [cloudAckedMatchIds, setCloudAckedMatchIds] = useState<string[]>([]);
  const cloudPollTimerRef = useRef<number | null>(null);

  // socket 回调里判断「是否配了系列赛」用（回调注册在 [] 依赖的 effect 里，读不到最新 state）
  const page14ConfiguredRef = useRef(false);
  // 待开始小局草稿上下文（getPendingDraftContext）：pending 时编辑器显示源为赛事草稿、全局面板仅供推流页，
  // 由 applyServerState / loadInitialData 应用 store 时同步维护，避免渲染闭包读到旧状态
  const pendingDraftRef = useRef<ReturnType<typeof getPendingDraftContext>>(null);
  // 已回填过的草稿上下文键（matchId|gameNumber），防止保存回显等 store 更新反复覆写编辑中的缓冲区
  const draftBackfillKeyRef = useRef<string | null>(null);

  // 保持 page14ConfiguredRef 与最新配置同步（供读不到 state 的 socket 回调用）
  useEffect(() => {
    page14ConfiguredRef.current = Boolean(page14?.tournamentId);
  }, [page14?.tournamentId]);

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

  function applyServerState(payload: ApplyServerStatePayload) {
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
      if (payload.page14) {
        setPage14(payload.page14);
      }
      if (payload.profiles) {
        setProfiles(payload.profiles);
      }
      if (payload.tournaments) {
        setTournaments(payload.tournaments);
      }
      if (payload.locallyRemoved) {
        setLocallyRemoved(payload.locallyRemoved);
      }
      if (payload.recycleBin) {
        setRecycleBin(payload.recycleBin);
      }
      if (payload.mvp) {
        setMvp(payload.mvp);
      }
    });
  }

  /** 保存某侧阵容草稿：自动保存（silent）与手动调用共用；完赛时只提示不改数据 */
  async function savePanel(side: PanelSide, silent = false) {
    const activeMatch = getActiveMatch(matchStore);
    if (activeMatch?.status === 'completed') {
      const nextText = '当前赛事已完赛，不能编辑阵容';
      setRosterNotice({ tone: 'warning', text: nextText });
      if (!silent) {
        message.warning(nextText);
      }
      return;
    }

    const current = panels[side];
    setPanels((prev) => ({
      ...prev,
      [side]: { ...prev[side], saving: true },
    }));
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
      setPanels((prev) => ({
        ...prev,
        [side]: { ...prev[side], dirty: false, saving: false },
      }));
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
      setPanels((prev) => ({
        ...prev,
        [side]: { ...prev[side], saving: false },
      }));
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 对某一场执行流程动作（开始 / 登记胜负 / 撤回 / 取消撤回）。
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

  /** 切换推流画面 / 保存画面设置：乐观更新，失败回滚到服务端最新值 */
  async function saveStage(nextPage: StagePageKey, options?: SaveStageOptions) {
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

  async function loadInitialData(showToast = false) {
    setPageError('');

    try {
      const [auth, nextScoreboard, nextMatches, nextAvatars, nextPanels, nextSprites, nextStage, nextPage6, nextPage7, nextPage8, nextPage9, nextPage11, nextPage14, nextNextgame, nextProfiles, nextCountdown, nextMvp, nextRuntimeConfig, nextTournaments, nextLocallyRemoved] = await Promise.all([
        requestJson<{ authenticated: boolean }>('/api/auth/check'),
        requestJson<ScoreboardState>('/api/scoreboard'),
        requestJson<MatchStoreState>('/api/matches'),
        requestJson<AvatarCollectionState>('/api/avatars'),
        requestJson<{ panels: [PanelState, PanelState] }>('/api/panels'),
        requestJson<{ sprites: SpriteRecord[] }>('/api/sprites'),
        requestJson<StageConfig>('/api/stage'),
        requestJson<{ state: Page6State }>('/api/page6'),
        requestJson<{ state: Page7State }>('/api/page7'),
        requestJson<{ state: Page8State }>('/api/page8'),
        requestJson<{ state: Page9State }>('/api/page9'),
        requestJson<{ state: Page11State }>('/api/page11'),
        requestJson<{ state: Page14State; standings: StageStandings | null }>('/api/page14'),
        requestJson<NextGamePayload>('/api/nextgame'),
        requestJson<ProfileStoreState>('/api/profiles'),
        requestJson<CountdownPayload>('/api/countdown'),
        requestJson<{ state: MvpState; winner: MvpWinnerInfo }>('/api/mvp'),
        requestJson<{ port: number; machineCode: string; syncConfig?: CloudSyncStatus }>('/api/runtime-config'),
        requestJson<{ tournaments: TournamentRecord[] }>('/api/tournaments'),
        requestJson<{ tournaments: TournamentRecord[] }>('/api/tournaments/local-removed'),
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
        setPage7(nextPage7.state);
        setPage8(nextPage8.state);
        setPage9(nextPage9.state);
        setPage11(nextPage11.state);
        setPage14(nextPage14.state);
        setPage14Standings(nextPage14.standings);
        setProfiles(nextProfiles);
        setTournaments(nextTournaments.tournaments);
        setLocallyRemoved(nextLocallyRemoved.tournaments);
        setNextgame(nextNextgame.state);
        setNextgameMatch(nextNextgame.match ?? null);
        setMvp(nextMvp.state);
        setMvpWinner(nextMvp.winner ?? null);
        setMachineCode(nextRuntimeConfig.machineCode ?? '');
        if (nextRuntimeConfig.syncConfig) {
          applyCloudStatus(nextRuntimeConfig.syncConfig);
        }
        // 与 applyServerState 一致：先维护草稿上下文再同步面板，避免 pending 时全局面板覆写编辑器
        pendingDraftRef.current = getPendingDraftContext(nextMatches);
        syncPanelFromApi('left', nextPanels.panels[0]);
        syncPanelFromApi('right', nextPanels.panels[1]);
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
    }
  }

  // 晋级积分榜（page14）：读取服务端算好的榜单（系列赛赛果/编排变化后由 socket 触发重取）
  async function refreshPage14View(): Promise<void> {
    try {
      const data = await requestJson<{ state: Page14State; standings: StageStandings | null }>('/api/page14');
      setPage14(data.state);
      setPage14Standings(data.standings);
    } catch {
      // 静默失败：榜单是展示信息，偶发请求失败不该打断登记操作
    }
  }

  /** 刷新 MVP 结算状态与已载入胜方信息（avatar:update 等无法从广播直接得到 winner 的场景） */
  async function refreshMvpWinner() {
    try {
      const data = await requestJson<{ state: MvpState; winner: MvpWinnerInfo }>('/api/mvp');
      applyServerState({ mvp: data.state });
      setMvpWinner(data.winner ?? null);
    } catch {
      // 刷新失败静默处理，不打断后台操作
    }
  }

  /** 应用云同步状态：只写状态与已确认集；设置区草稿由 SyncView 自己按需回填 */
  function applyCloudStatus(next: CloudSyncStatus) {
    setCloudStatus(next);
    setCloudAckedMatchIds(next.pending.ackedMatchIds);
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

  /** 云同步请求统一出口：自动带房间密钥、访问令牌与机器码（服务端校验一致才执行） */
  async function postCloud<T>(pathname: string, body: Record<string, unknown> = {}): Promise<T & { status: CloudSyncStatus }> {
    const result = await requestJson<T & { status: CloudSyncStatus }>(pathname, {
      method: 'POST',
      json: {
        syncKey: cloudStatus?.config.syncKey ?? '',
        syncToken: cloudStatus?.config.syncToken ?? '',
        machineCode: cloudStatus?.config.machineCode ?? machineCode,
        ...body,
      },
    });
    if (result?.status) {
      setCloudStatus(result.status);
      setCloudAckedMatchIds(result.status.pending.ackedMatchIds);
    }
    return result;
  }

  /** 红点轮询：只读云端小键（version / ack / uplink），绝不自动合并数据 */
  async function pollCloudStatus(silent = true) {
    const status = cloudStatus;
    if (!status?.config.syncKey || !status.config.workerUrl || !status.config.machineCode) {
      return;
    }
    try {
      const result = await postCloud<{ version: CloudSyncVersion | null; changed: boolean; inbox: CloudSyncInboxEntry[] }>(
        '/api/cloud-sync/poll',
      );
      if (status.config.role === 'sub' && result.changed && result.version) {
        const key = `v${result.version.v}`;
        if (cloudPollNotified !== key) {
          setCloudPollNotified(key);
          message.info('主控电脑上传了新内容，点「从云端获取最新」查看');
        }
      }
      if (status.config.role === 'main') {
        const pendingCount = result.inbox.reduce((sum, entry) => sum + entry.pending.length, 0);
        if (pendingCount > 0 && !silent) {
          message.info(`有 ${result.inbox.length} 台电脑交回了赛果，共 ${pendingCount} 场等你确认`);
        }
      }
      if (!silent) {
        message.success('已刷新同步状态');
      }
    } catch (error) {
      if (!silent) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    }
  }

  useEffect(() => {
    void loadInitialData();
  }, []);

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
    const spriteMap = buildSpriteLookup(sprites);
    const leftSelected = draftSlotsToSelected(draft.leftSlots, spriteMap);
    const rightSelected = draftSlotsToSelected(draft.rightSlots, spriteMap);
    setPanels((prev) => ({
      left: { ...prev.left, selected: leftSelected, dirty: false, saving: false },
      right: { ...prev.right, selected: rightSelected, dirty: false, saving: false },
    }));
  }, [matchStore, sprites]);

  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      query: { role: 'admin' },
    });

    socket.on(SOCKET_EVENTS.snapshot, (payload) => {
      applyServerState(payload ?? {});
      // 快照只带 page14 配置，榜单（standings）要另外取一次
      if (payload?.page14) {
        void refreshPage14View();
      }
    });

    socket.on(SOCKET_EVENTS.panelUpdate, (payload) => {
      if (payload?.panel) {
        applyServerState({ panel: payload.panel });
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
      // 登记/撤回赛果会改变系列赛阶段的胜负累计：重取榜单（未配系列赛时跳过）
      if (page14ConfiguredRef.current) {
        void refreshPage14View();
      }
    });

    socket.on(SOCKET_EVENTS.avatarUpdate, (payload) => {
      if (payload?.avatars) {
        applyServerState({ avatars: payload.avatars });
      }
      // 已载入胜方的头像按快照 matchId+side 解析：头像上传/删除后同步刷新面板展示
      void refreshMvpWinner();
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

    socket.on(SOCKET_EVENTS.page14Update, (payload) => {
      if (payload?.state) {
        applyServerState({ page14: payload.state });
        void refreshPage14View();
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

    socket.on(SOCKET_EVENTS.mvpUpdate, (payload) => {
      if (payload?.state) {
        applyServerState({ mvp: payload.state });
      }
      if (payload?.winner !== undefined) {
        setMvpWinner(payload.winner ?? null);
      }
    });

    socket.on(SOCKET_EVENTS.tournamentUpdate, (payload) => {
      if (Array.isArray(payload?.tournaments)) {
        applyServerState({ tournaments: payload.tournaments });
      }
      if (Array.isArray(payload?.locallyRemoved)) {
        applyServerState({ locallyRemoved: payload.locallyRemoved });
      }
      if (Array.isArray(payload?.recycleBin)) {
        applyServerState({ recycleBin: payload.recycleBin });
      }
      // 阶段推进/回退、阶段改名都会影响榜单标题与行
      if (page14ConfiguredRef.current) {
        void refreshPage14View();
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  // 红点轮询：默认开、可关、可设 30~300s；只读小键提示，绝不自动合并数据。
  // 必须位于任何条件 return 之前（React Hooks 规则），否则 loading 切换时 hook 数量变化会触发 React #310 白屏。
  useEffect(() => {
    if (!cloudStatus?.config.syncKey || !cloudStatus.config.workerUrl || !cloudStatus.config.machineCode) {
      return;
    }
    if (cloudStatus.config.pollEnabled === false) {
      return;
    }
    const intervalMs = Math.max(30, cloudStatus.config.pollIntervalSeconds || 60) * 1000;
    cloudPollTimerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pollCloudStatus(true);
      }
    }, intervalMs);
    return () => {
      if (cloudPollTimerRef.current) {
        window.clearInterval(cloudPollTimerRef.current);
        cloudPollTimerRef.current = null;
      }
    };
  }, [
    cloudStatus?.config.syncKey,
    cloudStatus?.config.workerUrl,
    cloudStatus?.config.machineCode,
    cloudStatus?.config.role,
    cloudStatus?.config.pollEnabled,
    cloudStatus?.config.pollIntervalSeconds,
  ]);

  // 实时控制（文件监听 / 回写定时器）挂在常驻 Provider：切走视图监听仍在跑，导航呼吸点也从这里读
  const live = useLiveControl({ panels, setPanels, applyServerState, loadInitialData });

  const value: AdminData = {
    loading,
    pageError,
    scoreboard,
    matchStore,
    avatars,
    panels,
    sprites,
    stage,
    stageSaving,
    nextgame,
    nextgameMatch,
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
    machineCode,
    historyNotice,
    rosterNotice,
    cloudStatus,
    cloudAckedMatchIds,
    setAvatars,
    setPanels,
    setStage,
    setPage6,
    setPage7,
    setPage8,
    setPage9,
    setPage11,
    setPage14,
    setPage14Standings,
    setProfiles,
    setMachineCode,
    setHistoryNotice,
    setRosterNotice,
    applyServerState,
    savePanel,
    saveStage,
    runMatchAction,
    cloudRegisterGate,
    cloudUndoGate,
    loadInitialData,
    applyCloudStatus,
    postCloud,
    pollCloudStatus,
    live,
  };

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}
