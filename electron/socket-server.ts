import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';

import { SOCKET_EVENTS } from '../shared/events.js';
import { SYNC_BUNDLE_MAX_BYTES } from '../shared/constants.js';
import { computeScheduleTimes } from '../shared/match-schedule.js';
import type { AvatarCollectionState, CloudSyncKeyGuardResult, CountdownState, LineupImportPreviewRow, MatchRecord, MatchStoreState, Page6State, Page7State, Page8State, SnapshotPayload, StagePageKey, SyncConflictMode } from '../shared/types.js';
import { buildQuickFillPreview, listSprites, spriteMatchesKeyword } from './services/sprite-service.js';
import { getSpriteRanking } from './services/stats-service.js';
import {
  ensureRuntimeDirs,
  saveAvatar,
  saveProfilePlayerAvatar,
  saveProfileTeamLogo,
  deleteAvatar,
  readAvatarMimeType,
} from './services/image-service.js';
import { createAvatarResolver, resolveMatchAvatars } from './services/avatar-resolver.js';
import {
  getProfileStore,
  savePlayerProfile,
  importPlayerProfiles,
  importPlayerAvatarFiles,
  deletePlayerProfile,
  saveTeamProfile,
  deleteTeamProfile,
} from './services/profile-service.js';
import { loadRuntimeConfig, saveRuntimeConfig } from './services/config-service.js';
import { applySyncImport, exportSyncBundle, previewSyncImport } from './services/sync-service.js';
import {
  canRegisterMatch,
  checkCloudSync,
  checkMachineCodeChange,
  checkSubUndoAllowed,
  confirmCloudSync,
  finalizeCloudPull,
  getCloudSyncStatus,
  pollCloudSync,
  previewCloudPull,
  pushCloudSync,
  rejectCloudSync,
  saveCloudAssignment,
  saveCloudExcludedTournaments,
  saveCloudSyncConfig,
  skipCloudPull,
  testCloudConnection,
  uploadCloudSync,
} from './services/cloud-sync-service.js';
import {
  getStageState,
  saveStageState,
} from './services/stage-service.js';
import {
  getPage6State,
  PAGE6_MATCH_STATUSES,
  prunePage6State,
  savePage6State,
} from './services/page6-service.js';
import {
  getPage7State,
  prunePage7State,
  savePage7State,
} from './services/page7-service.js';
import {
  getPage8State,
  PAGE8_MATCH_STATUSES,
  prunePage8State,
  savePage8State,
} from './services/page8-service.js';
import {
  getPage9State,
  savePage9State,
} from './services/page9-service.js';
import {
  getPage14State,
  resolvePage14View,
  savePage14State,
} from './services/page14-service.js';
import {
  getPage11State,
  savePage11State,
} from './services/page11-service.js';
import {
  getMvpState,
  getMvpWinnerInfo,
  saveMvpReturnPage,
  saveMvpState,
} from './services/mvp-service.js';
import {
  getNextGamePayload,
  hideNextGame,
  saveNextGameState,
  showNextGame,
} from './services/nextgame-service.js';
import {
  getCountdownState,
  hideCountdown,
  pauseCountdown,
  resetCountdown,
  saveCountdownState,
  showCountdown,
  startCountdown,
} from './services/countdown-service.js';
import {
  applyLineupImport,
  createMatch,
  deleteMatch,
  deleteMatches,
  forfeitMatch,
  getMatchStore,
  inspectLineupImportTargets,
  recordMatchWinner,
  redoMatchAction,
  saveDraftPanelStateForActiveMatch,
  saveDraftPanelSlotStateForActiveMatch,
  saveGameLineupForMatch,
  setActiveMatch,
  startCurrentGame,
  syncActiveMatchLineupsFromPanels,
  undoDeletedMatches,
  undoMatchAction,
  updateMatch,
  updateMatchTags,
  updateMatchesTags,
} from './services/match-service.js';
import {
  advanceTournament,
  assertTournamentMatchFieldsEditable,
  createTournament,
  deleteTournament,
  getLocallyRemovedTournaments,
  getTournamentStore,
  importPairings,
  lockPairings,
  onMatchCompleted,
  onMatchUndo,
  prepareTournamentWriteBack,
  previewOpeningWave,
  redrawTournament,
  removeLocalTournament,
  resolveTournamentLabels,
  restoreLocalTournament,
  rollbackWave,
  savePairingDraft,
  startTournament,
  syncTournamentMatchNames,
} from './services/tournament-service.js';
import {
  clearPanelState,
  getPanelState,
  getScoreboardState,
  savePanelSlotState,
  savePanelState,
  saveScoreboardBestOf,
  saveScoreboardState,
} from './services/state-service.js';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import type { AppPaths } from './services/path-service.js';

// Augment express-session to include our auth flag
declare module 'express-session' {
  interface SessionData {
    isAuthenticated?: boolean;
    sessionId?: string;
  }
}

const upload = multer({ storage: multer.memoryStorage() });

// 双机数据同步：同步包为单个 JSON 文件（内嵌 base64 头像，可能几十 MB），单独限制单文件大小
const syncUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SYNC_BUNDLE_MAX_BYTES, files: 1 },
});

// ===== socket 角色分组：每个推流页/悬浮窗连接时声明 role，服务端只投递它需要的事件与快照字段 =====
// 未声明或未知 role 一律按 admin 处理（收全量），旧版客户端行为完全不变。
const ROLE_ADMIN = 'admin';
const KNOWN_SOCKET_ROLES = new Set([
  ROLE_ADMIN,
  'page1', 'page2', 'page3', 'page4', 'page5', 'page6',
  'page7', 'page8', 'page9', 'page10', 'page11', 'page14',
  'float', 'carrier', 'countdown',
]);
const ROLE_ROOM_PREFIX = 'role:';

function normalizeSocketRole(value: unknown): string {
  const role = String(Array.isArray(value) ? value[0] : value ?? '');
  return KNOWN_SOCKET_ROLES.has(role) ? role : ROLE_ADMIN;
}

// 各角色首次连接需要的快照字段（依据各页面 snapshot 处理函数实际读取审计得出）；
// page3 与 admin 收全量；page10/11 只把 snapshot 当刷新信号、不读载荷，给空对象即可。
const SNAPSHOT_FIELDS_BY_ROLE: Partial<Record<string, Array<keyof SnapshotPayload>>> = {
  page1: ['panels'],
  page2: ['panels', 'scoreboard'],
  page4: ['mvp'],
  page5: ['stage', 'scoreboard'],
  page6: ['page6'],
  page7: ['page7'],
  page8: ['page8'],
  page9: ['page9'],
  page14: ['page14'],
  page10: [],
  page11: [],
  float: ['panels'],
  carrier: ['stage'],
  countdown: [],
};

// 事件 → 需要该事件的角色（admin 房间始终收到全部）
// page1/page2 订阅 stage:update 仅为「阵容镜像反转」实时切换（两页其余渲染不依赖 stage 配置）；
// page7 订阅它是为「战绩详情整屏切换间隔」（画面设置里改，改完立即按新节奏走）
const ROLES_FOR_STAGE = ['page1', 'page2', 'page3', 'page5', 'page7', 'page11', 'carrier'];
const ROLES_FOR_AVATAR = ['page3', 'page4', 'page6', 'page7', 'page8', 'page10', 'page11'];
const ROLES_FOR_MATCHES = ['page3', 'page5', 'page6', 'page7', 'page8', 'page10', 'page11', 'page14'];
const ROLES_FOR_SCOREBOARD = ['page2', 'page3', 'page5'];
const ROLES_FOR_PANEL = ['page1', 'page2', 'page3', 'page11', 'float'];
const ROLES_FOR_PROFILES = ['page3', 'page11'];

/** 活跃比赛记录（头像解析需要选手名做档案兜底，故不只是取 id） */
function findActiveMatch(store: MatchStoreState): MatchRecord | null {
  return store.activeMatchId
    ? store.matches.find((match) => match.id === store.activeMatchId) ?? null
    : null;
}

function snapshotPayload(paths: AppPaths): SnapshotPayload {
  const store = getMatchStore(paths);
  return {
    panels: [getPanelState(paths, 'left'), getPanelState(paths, 'right')],
    scoreboard: getScoreboardState(paths),
    avatars: resolveMatchAvatars(paths, findActiveMatch(store)),
    store,
    stage: getStageState(paths),
    page6: getPage6State(paths),
    page7: getPage7State(paths),
    page8: getPage8State(paths),
    page9: getPage9State(paths),
    page11: getPage11State(paths),
    page14: getPage14State(paths),
    nextgame: getNextGamePayload(paths),
    profiles: getProfileStore(paths),
    countdown: getCountdownState(paths),
    mvp: getMvpState(paths),
    tournaments: getTournamentStore(paths),
    locallyRemoved: getLocallyRemovedTournaments(paths),
  };
}

function sendPage(paths: AppPaths, response: Response, pageFile: string): void {
  // 页面随版本更新：禁止启发式缓存，避免升级后仍加载旧页面（资源文件名带 hash 不受影响）
  response.set('Cache-Control', 'no-cache');
  response.sendFile(path.join(paths.pagesDir, pageFile));
}

/**
 * 卡片排位排名兜底：对局自身未填排名时，按选手名回退「信息录入」档案中的排名。
 * 系列赛引擎早期自动建场的对局没有排名快照，避免比赛结果/比赛预告卡片 rank 区空显示；
 * 对局已填排名时以对局值为准（不覆盖）。
 */
function withProfileRankFallback(paths: AppPaths, matches: MatchRecord[]): MatchRecord[] {
  const rankByName = new Map(getProfileStore(paths).players.map((player) => [player.name, player.rank]));
  if (rankByName.size === 0) {
    return matches;
  }
  return matches.map((match) => {
    const leftRank = match.leftRank || rankByName.get(match.leftPlayer) || '';
    const rightRank = match.rightRank || rankByName.get(match.rightPlayer) || '';
    if (leftRank === match.leftRank && rightRank === match.rightRank) {
      return match;
    }
    return { ...match, leftRank, rightRank };
  });
}

function sendAdminAntdPage(paths: AppPaths, response: Response): void {
  const builtPage = path.join(paths.rendererDistDir, 'src', 'pages', 'admin-antd.html');
  if (fs.existsSync(builtPage)) {
    response.set('Cache-Control', 'no-cache');
    response.sendFile(builtPage);
    return;
  }

  response.status(503).type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Admin Antd 未构建</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #f7efe3 0%, #f0e0c7 100%);
        color: #3f2b1d;
        font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
      }
      main {
        width: min(640px, calc(100vw - 32px));
        padding: 32px;
        border-radius: 24px;
        background: rgba(255, 251, 245, 0.94);
        box-shadow: 0 24px 60px rgba(90, 55, 26, 0.14);
      }
      code {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(199, 99, 47, 0.12);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Admin Ant Design 验证页尚未构建</h1>
      <p>请先运行 <code>npm run build:renderer</code> 或 <code>npm run build</code>，然后刷新本页。</p>
    </main>
  </body>
</html>`);
}

function sendLoginPage(paths: AppPaths, response: Response): void {
  const builtPage = path.join(paths.rendererDistDir, 'src', 'pages', 'login.html');
  if (fs.existsSync(builtPage)) {
    response.sendFile(builtPage);
    return;
  }

  response.status(503).type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Login 未构建</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #f7efe3 0%, #f0e0c7 100%);
        color: #3f2b1d;
        font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
      }
      main {
        width: min(640px, calc(100vw - 32px));
        padding: 32px;
        border-radius: 24px;
        background: rgba(255, 251, 245, 0.94);
        box-shadow: 0 24px 60px rgba(90, 55, 26, 0.14);
      }
      code {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(199, 99, 47, 0.12);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>登录页尚未构建</h1>
      <p>请先运行 <code>npm run build:renderer</code> 或 <code>npm run build</code>，然后刷新本页。</p>
    </main>
  </body>
</html>`);
}

export interface LocalServer {
  port: number;
  server: http.Server;
  io: SocketIOServer;
  close(): Promise<void>;
}

export interface AuthConfig {
  username: string;
  password: string;
}

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function safePasswordEquals(input: string, expected: string): boolean {
  return crypto.timingSafeEqual(sha256(input), sha256(expected));
}

export async function createLocalServer(
  paths: AppPaths,
  port: number,
  host = '127.0.0.1',
  authConfig?: AuthConfig,
): Promise<LocalServer> {
  // Single-session tracking: only one active session at a time.
  // Each new login generates a random sessionId, invalidating all previous sessions.
  let activeSessionId: string | null = null;

  ensureRuntimeDirs(paths);

  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
    },
  });

  // 定向广播：admin 房间始终收到全部事件；roles 之外的页面不再收到无关事件，
  // 避免多 iframe/悬浮窗场景下每连接都全量扇出（未知角色默认加入 admin 房间，行为与旧版一致）。
  const roleRoom = (role: string): string => `${ROLE_ROOM_PREFIX}${role}`;
  const broadcast = (
    event: string,
    payload: unknown,
    roles?: string[],
  ): void => {
    if (!roles) {
      io.emit(event, payload);
      return;
    }
    const rooms = Array.from(new Set([ROLE_ADMIN, ...roles])).map(roleRoom);
    io.to(rooms).emit(event, payload);
  };

  // 按角色裁剪首连快照（全量快照只发给 admin 与 page3）
  const snapshotForRole = (role: string): SnapshotPayload | Partial<SnapshotPayload> => {
    const full = snapshotPayload(paths);
    if (role === ROLE_ADMIN || role === 'page3' || !(role in SNAPSHOT_FIELDS_BY_ROLE)) {
      return full;
    }
    const fields = SNAPSHOT_FIELDS_BY_ROLE[role] ?? [];
    const subset: Partial<SnapshotPayload> = {};
    const target = subset as Record<string, unknown>;
    const source = full as unknown as Record<string, unknown>;
    for (const field of fields) {
      target[field] = source[field];
    }
    return subset;
  };

  // === 胜者结算画面（page10）自动切回计时 ===
  // 赛事面板登记本局胜负时，若当前画面是推流页面1-3，先切入 page10，停留设定时长后自动切回原画面。
  let winnerStageReturnTimer: ReturnType<typeof setTimeout> | null = null;
  let winnerStageReturnPage: StagePageKey | null = null;

  function clearWinnerStageReturnTimer(): void {
    if (winnerStageReturnTimer) {
      clearTimeout(winnerStageReturnTimer);
      winnerStageReturnTimer = null;
    }
    winnerStageReturnPage = null;
  }

  /** 登记胜负后自动切入胜者结算画面，并在设定时长后切回原推流页面 */
  function triggerWinnerStage(): void {
    const stageBefore = getStageState(paths);
    if (stageBefore.page !== 'page1-overlay' && stageBefore.page !== 'page2' && stageBefore.page !== 'page3') {
      return;
    }

    const stage = saveStageState(paths, { ...stageBefore, page: 'page10' });
    broadcast(SOCKET_EVENTS.stageUpdate, { stage }, ROLES_FOR_STAGE);

    const durationMs = stage.page10Duration * (stage.page10DurationUnit === 'minutes' ? 60 : 1) * 1000;
    clearWinnerStageReturnTimer();
    winnerStageReturnPage = stageBefore.page;
    winnerStageReturnTimer = setTimeout(() => {
      winnerStageReturnTimer = null;
      const current = getStageState(paths);
      // 仍停留在胜者结算画面才自动切回（期间被手动切走则不再处理）
      if (current.page === 'page10') {
        const restored = saveStageState(paths, { ...current, page: winnerStageReturnPage ?? 'page3' });
        broadcast(SOCKET_EVENTS.stageUpdate, { stage: restored }, ROLES_FOR_STAGE);
      }
      winnerStageReturnPage = null;
    }, durationMs);
  }

  // 广播当前赛事对应的头像（活跃赛事变化时推流页等需要同步）
  const emitAvatarUpdate = (): void => {
    const store = getMatchStore(paths);
    const matchId = store.activeMatchId;
    broadcast(SOCKET_EVENTS.avatarUpdate, { matchId, avatars: resolveMatchAvatars(paths, findActiveMatch(store)) }, ROLES_FOR_AVATAR);
  };

  // 红光特效「立即显示」为一次性触发：进入下一局（换比赛 / 新小局开始）时自动清除并广播，
  // 不影响「关闭 / 自动开启」策略；边界以对局签名（活跃比赛 + 当前小局状态）变化判断。
  let redLightBoundaryBase: { matchId: string; phase: string } | null = null;

  const redLightBoundarySnapshot = (store: MatchStoreState): { matchId: string; phase: string } => {
    const activeMatch = store.activeMatchId
      ? store.matches.find((match) => match.id === store.activeMatchId) ?? null
      : null;
    const currentGame = activeMatch && Array.isArray(activeMatch.games)
      ? activeMatch.games.find((game) => game.status !== 'completed') ?? null
      : null;
    return {
      matchId: store.activeMatchId ?? '',
      phase: currentGame && currentGame.status === 'in_progress' ? 'in_progress' : 'waiting',
    };
  };

  const clearRedLightInstantOnBoundary = (store: MatchStoreState): void => {
    const next = redLightBoundarySnapshot(store);
    const previous = redLightBoundaryBase;
    redLightBoundaryBase = next;
    if (!previous) {
      return;
    }
    const matchChanged = previous.matchId !== next.matchId;
    const gameStarted = previous.phase !== 'in_progress' && next.phase === 'in_progress';
    if (!matchChanged && !gameStarted) {
      return;
    }
    const stage = getStageState(paths);
    if (!stage.page3RedLightInstant) {
      return;
    }
    const saved = saveStageState(paths, { ...stage, page3RedLightInstant: false });
    broadcast(SOCKET_EVENTS.stageUpdate, { stage: saved }, ROLES_FOR_STAGE);
  };

  // 比赛数据统一广播出口：广播后检查红光特效「立即显示」是否已进入下一局需清除，
  // 并同步推流选场（page6/7/8）——比赛删除/状态变更后清理不再可展示的引用，返回变化页面
  const emitMatchesUpdate = (store: MatchStoreState): PagePushPruneResult => {
    broadcast(SOCKET_EVENTS.matchesUpdate, { store }, ROLES_FOR_MATCHES);
    clearRedLightInstantOnBoundary(store);
    return prunePagePushSelections();
  };

  // 系列赛数据广播：admin（第 11 视图）与 page14（晋级积分榜按阶段重算榜单）消费；
  // locallyRemoved 只在本机口径出现（恢复列表 / 对局过滤），绝不进出站同步包
  const emitTournamentUpdate = (): void => {
    broadcast(
      SOCKET_EVENTS.tournamentUpdate,
      { tournaments: getTournamentStore(paths), locallyRemoved: getLocallyRemovedTournaments(paths) },
      ['page14'],
    );
  };

  // 推流选场（page6/7/8）清理结果：仅含发生变化的页面
  type PagePushPruneResult = Partial<Record<'page6' | 'page7' | 'page8', Page6State | Page7State | Page8State>>;

  // GET 下发的选场 id 白名单过滤：只保留仍存在且状态符合页面收录口径的比赛（与落盘口径同源）
  const filterSelectableMatchIds = (
    matchIds: string[],
    statuses: ReadonlySet<MatchRecord['status']>,
  ): string[] => {
    const allowed = new Set(
      getMatchStore(paths).matches
        .filter((match) => statuses.has(match.status))
        .map((match) => match.id),
    );
    return matchIds.filter((id) => allowed.has(id));
  };

  // 战绩详情（page7）不限状态：只过滤已被删除的悬空引用
  const filterExistingMatchIds = (matchIds: string[]): string[] => {
    const existing = new Set(getMatchStore(paths).matches.map((match) => match.id));
    return matchIds.filter((id) => existing.has(id));
  };

  /**
   * 推流选场（page6/7/8）与比赛数据保持一致：
   * 比赛删除（悬空引用）或状态变更（不再符合页面收录状态）后清理选场清单，
   * 只广播实际变化的页面（避免多余刷新），返回清理结果供删除类路由回传发起端。
   */
  const prunePagePushSelections = (): PagePushPruneResult => {
    const next: PagePushPruneResult = {};

    const page6 = prunePage6State(paths);
    if (page6) {
      broadcast(SOCKET_EVENTS.page6Update, { state: page6 }, ['page6']);
      next.page6 = page6;
    }

    const page7 = prunePage7State(paths);
    if (page7) {
      broadcast(SOCKET_EVENTS.page7Update, { state: page7 }, ['page7']);
      next.page7 = page7;
    }

    const page8 = prunePage8State(paths);
    if (page8) {
      broadcast(SOCKET_EVENTS.page8Update, { state: page8 }, ['page8']);
      next.page8 = page8;
    }

    return next;
  };

  // 记录启动基线，保证服务启动后首次进入下一局也能被识别
  redLightBoundaryBase = redLightBoundarySnapshot(getMatchStore(paths));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'roco-pvp-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  });

  app.use(cookieParser(process.env.SESSION_SECRET || 'roco-pvp-session-secret'));
  app.use(sessionMiddleware);

  // Share session with Socket.IO so admin sockets can verify auth
  io.engine.use(sessionMiddleware);

  // Static files (public, no auth)
  // 打包随版本发布/内容不可变的素材：30 天长缓存 + immutable（精灵立绘/头像、字体、
  // 带 hash 的后台 bundle、UI 图）；资源更新时文件名必变或随版本重启，不会读到旧缓存。
  // 用户上传内容（/runtime）与页面脚本（/scripts、/styles）保持协商缓存，避免改名/升级后滞留。
  const immutableStaticOptions = {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    setHeaders: (response: Response) => {
      response.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    },
  };
  app.use('/scripts', express.static(paths.scriptsDir));
  app.use('/styles', express.static(paths.stylesDir));
  app.use('/assets', express.static(paths.assetsDir, immutableStaticOptions));
  app.use('/antd-assets', express.static(path.join(paths.rendererDistDir, 'antd-assets'), immutableStaticOptions));
  app.use('/resources', express.static(paths.resourcesDir, immutableStaticOptions));
  app.use('/runtime', express.static(paths.cacheDir));

  app.use('/img', express.static(paths.spritesDir, immutableStaticOptions));
  app.use('/json', express.static(paths.dataDir));
  app.use('/image', express.static(path.join(paths.assetsDir, 'ui'), immutableStaticOptions));
  app.use('/font', express.static(path.join(paths.assetsDir, 'fonts'), immutableStaticOptions));

  // === Public routes (no auth required) ===
  app.get('/', (_request, response) => sendPage(paths, response, 'index.html'));
  app.get('/login.html', (_request, response) => sendLoginPage(paths, response));
  app.get('/roco-pvp-page2.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page2.html'));
  app.get('/roco-pvp-page3.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page3.html'));
  app.get('/roco-pvp-page4.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page4.html'));
  app.get('/roco-pvp-page5.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page5.html'));
  app.get('/roco-pvp-page6.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page6.html'));
  app.get('/roco-pvp-page7.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page7.html'));
  app.get('/roco-pvp-page8.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page8.html'));
  app.get('/roco-pvp-page9.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page9.html'));
  app.get('/roco-pvp-page10.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page10.html'));
  app.get('/roco-pvp-page14.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page14.html'));
  // 选手介绍（page11-13）：同一页面文件通过 ?mode=left/right/versus 区分三种画面
  app.get('/roco-pvp-page11.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page11.html'));
  app.get('/roco-pvp-page1.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page1.html'));
  app.get('/float.html', (_request, response) => sendPage(paths, response, 'float.html'));
  app.get('/float-menu.html', (_request, response) => sendPage(paths, response, 'float-menu.html'));
  app.get('/float-nextgame.html', (_request, response) => sendPage(paths, response, 'float-nextgame.html'));

  // Auth API — always public
  app.post('/api/auth/login', async (req, res) => {
    // Auth disabled in desktop mode
    if (!authConfig) {
      req.session.isAuthenticated = true;
      return res.json({ success: true });
    }
    const { username, password } = req.body || {};
    try {
      const passwordMatch = safePasswordEquals(password || '', authConfig.password);
      if (username === authConfig.username && passwordMatch) {
        // Invalidate all previous sessions by rotating the active session ID
        activeSessionId = crypto.randomUUID();
        req.session.sessionId = activeSessionId;
        req.session.isAuthenticated = true;
        return res.json({ success: true });
      }
    } catch {
      // 密码比对过程抛错 — 落到下方统一 401
    }
    res.status(401).json({ success: false, error: '账号或密码错误' });
  });

  app.post('/api/auth/logout', (req, res) => {
    activeSessionId = crypto.randomUUID(); // invalidate any lingering sessions
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get('/api/auth/check', (req, res) => {
    if (!authConfig) {
      return res.json({ authenticated: true });
    }
    if (req.session?.isAuthenticated && req.session.sessionId === activeSessionId) {
      return res.json({ authenticated: true });
    }
    res.status(401).json({ authenticated: false });
  });

  // === Auth guard for protected routes ===
  if (authConfig) {
    app.use((req, res, next) => {
      const publicStaticPrefixes = [
        '/scripts', '/styles', '/assets', '/resources', '/runtime',
        '/img', '/image', '/json', '/font', '/cache',
      ];
      const isPublicStatic = publicStaticPrefixes.some(p =>
        req.path === p || req.path.startsWith(p + '/')
      );
      const isPublicPage = ['/', '/login.html', '/roco-pvp-page1.html', '/roco-pvp-page2.html', '/roco-pvp-page3.html', '/roco-pvp-page4.html', '/roco-pvp-page5.html', '/roco-pvp-page6.html', '/roco-pvp-page7.html', '/roco-pvp-page8.html', '/roco-pvp-page9.html', '/roco-pvp-page10.html', '/roco-pvp-page11.html', '/roco-pvp-page14.html', '/float.html', '/float-menu.html', '/float-nextgame.html'].includes(req.path);
      // 推流页面仅用于展示，所需的数据 GET 接口公开（含选手头像/录入信息），写操作仍受保护
      const isPublicPage5Api = req.method === 'GET' && ['/api/stage', '/api/scoreboard', '/api/stats/ranking', '/api/page6', '/api/page7', '/api/page8', '/api/page9', '/api/page10', '/api/page11', '/api/page14', '/api/mvp', '/api/panels', '/api/matches', '/api/sprites', '/api/nextgame', '/api/profiles', '/api/avatars', '/api/countdown'].includes(req.path);
      // 头像图片公开访问（含按赛事隔离的 /api/avatar/{matchId}/{side}-avatar.png），推流页无需登录
      const isPublicAvatarImage = req.method === 'GET' && req.path.startsWith('/api/avatar/');
      const isAuthApi = req.path.startsWith('/api/auth/');
      // 云同步涉及房间密钥读写与跨机赛果合并，必须在公开 GET 白名单之外（Node 模式下强制登录）
      const isCloudSyncApi = req.path.startsWith('/api/cloud-sync/');
      const isFavicon = req.path === '/favicon.ico';

      if (isCloudSyncApi) {
        if (req.session?.isAuthenticated && req.session.sessionId === activeSessionId) return next();
        return res.status(401).json({ success: false, error: '请先登录' });
      }
      if (isPublicStatic || isPublicPage || isPublicPage5Api || isPublicAvatarImage || isAuthApi || isFavicon) return next();
      if (req.session?.isAuthenticated && req.session.sessionId === activeSessionId) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: '请先登录' });
    }
    res.redirect('/login.html');
    });
  }

  // === Protected routes (auth required when authConfig is set) ===
  app.get('/admin.html', (_request, response) => sendAdminAntdPage(paths, response));
  app.get('/admin-antd.html', (_request, response) => sendAdminAntdPage(paths, response));

  // 阵容面板状态（左右两侧），供推流页与管理后台初始加载
  app.get('/api/panels', (_request, response) => {
    response.json({ panels: [getPanelState(paths, 'left'), getPanelState(paths, 'right')] });
  });

  app.get('/api/avatars', (_request, response) => {
    const store = getMatchStore(paths);
    response.json(resolveMatchAvatars(paths, findActiveMatch(store)));
  });

  app.get('/api/scoreboard', (_request, response) => {
    response.json(getScoreboardState(paths));
  });

  app.get('/api/stage', (_request, response) => {
    response.json(getStageState(paths));
  });

  app.post('/api/stage', (request, response) => {
    try {
      const stage = saveStageState(paths, request.body ?? {});
      // 管理端手动切走胜者结算画面时，取消尚未到期的自动切回计时
      if (stage.page !== 'page10') {
        clearWinnerStageReturnTimer();
      }
      broadcast(SOCKET_EVENTS.stageUpdate, { stage }, ROLES_FOR_STAGE);
      response.json({ success: true, stage });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 胜者结算画面（page10）：返回当前活跃比赛与双方头像，页面自行解析最近一个已分胜负的小局胜者
  app.get('/api/page10', (_request, response) => {
    const store = getMatchStore(paths);
    const match = findActiveMatch(store);
    const avatars = resolveMatchAvatars(paths, match);
    response.json({ match, avatars });
  });

  app.get('/api/page6', (_request, response) => {
    const matchStore = getMatchStore(paths);
    const savedState = getPage6State(paths);
    // 失效引用兜底：存量配置里已删或不再可展示（非已结束）的 id 不下发（state.matchIds 与 matches 需同源）
    const state = { ...savedState, matchIds: filterSelectableMatchIds(savedState.matchIds, PAGE6_MATCH_STATUSES) };
    // 排名兜底：对局未填排名时按选手名回退「信息录入」档案排名（系列赛早期对局无快照）
    const matches = withProfileRankFallback(
      paths,
      state.matchIds
        .map((id) => matchStore.matches.find((match) => match.id === id))
        .filter((match): match is NonNullable<typeof match> => match !== undefined && match.status === 'completed'),
    );
    // 头像统一解析（赛事覆盖 > 档案头像兜底）：{ [matchId]: { left, right } }
    const avatarResolver = createAvatarResolver(paths);
    const avatars: Record<string, AvatarCollectionState> = {};
    for (const match of matches) {
      avatars[match.id] = avatarResolver.forMatch(match);
    }
    // 卡片场序时间：开始时间 + 按 BO×30 分钟累加（手动覆盖由 service 归一化在 state.matchTimes）
    const scheduleTimes = computeScheduleTimes(
      matches.map((match) => ({ id: match.id, bestOf: match.bestOf })),
      state.startTime,
      state.matchTimes,
    );
    // 系列赛阶段语义标签（仅系列赛对局有值，page6 卡片用它替换场序信息行）
    const tournamentLabels = resolveTournamentLabels(paths, matches);
    response.json({ state, matches, avatars, scheduleTimes, tournamentLabels });
  });

  app.post('/api/page6', (request, response) => {
    try {
      const state = savePage6State(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.page6Update, { state }, ["page6"]);
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 战绩详情（page7）：返回所选多场比赛完整数据（含每个小局阵容）与按赛事隔离的选手头像
  app.get('/api/page7', (_request, response) => {
    const matchStore = getMatchStore(paths);
    const savedState = getPage7State(paths);
    // 悬空引用兜底：存量配置里指向已删比赛的 id 不下发（战绩详情不限状态）
    const state = { ...savedState, matchIds: filterExistingMatchIds(savedState.matchIds) };
    const matches = state.matchIds
      .map((id) => matchStore.matches.find((item) => item.id === id))
      .filter((match): match is NonNullable<typeof match> => Boolean(match));
    // 头像统一解析（赛事覆盖 > 档案头像兜底）：{ [matchId]: { left, right } }
    const avatarResolver = createAvatarResolver(paths);
    const avatars: Record<string, AvatarCollectionState> = {};
    for (const match of matches) {
      avatars[match.id] = avatarResolver.forMatch(match);
    }
    // 系列赛阶段语义标签（仅系列赛对局有值）：page7 行首标签用它替代 GAME 序号，与 page6/page8 同口径
    const tournamentLabels = resolveTournamentLabels(paths, matches);
    response.json({ state, matches, avatars, tournamentLabels });
  });

  app.post('/api/page7', (request, response) => {
    try {
      const state = savePage7State(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.page7Update, { state }, ["page7"]);
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 比赛预告（page8）：返回所选比赛完整数据与按赛事隔离的选手头像
  app.get('/api/page8', (_request, response) => {
    const matchStore = getMatchStore(paths);
    const savedState = getPage8State(paths);
    // 失效引用兜底：存量配置里已删或不再可展示（已结束）的 id 不下发（state.matchIds 与 matches 需同源）
    const state = { ...savedState, matchIds: filterSelectableMatchIds(savedState.matchIds, PAGE8_MATCH_STATUSES) };
    // 排名兜底：与 page6 同口径，按选手名回退「信息录入」档案排名
    const matches = withProfileRankFallback(
      paths,
      state.matchIds
        .map((id) => matchStore.matches.find((match) => match.id === id))
        .filter((match): match is NonNullable<typeof match> => match != null && (match.status === 'pending' || match.status === 'in_progress')),
    );
    // 头像统一解析（赛事覆盖 > 档案头像兜底）：{ [matchId]: { left, right } }
    const avatarResolver = createAvatarResolver(paths);
    const avatars: Record<string, AvatarCollectionState> = {};
    for (const match of matches) {
      avatars[match.id] = avatarResolver.forMatch(match);
    }
    // 卡片场序时间：开始时间 + 按 BO×30 分钟累加（手动覆盖由 service 归一化在 state.matchTimes）
    const scheduleTimes = computeScheduleTimes(
      matches.map((match) => ({ id: match.id, bestOf: match.bestOf })),
      state.startTime,
      state.matchTimes,
    );
    // 系列赛阶段语义标签（仅系列赛对局有值，page8 与 page6 同口径）
    const tournamentLabels = resolveTournamentLabels(paths, matches);
    response.json({ state, matches, avatars, scheduleTimes, tournamentLabels });
  });

  app.post('/api/page8', (request, response) => {
    try {
      const state = savePage8State(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.page8Update, { state }, ["page8"]);
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/page9', (_request, response) => {
    response.json({ state: getPage9State(paths) });
  });

  app.post('/api/page9', (request, response) => {
    try {
      const state = savePage9State(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.page9Update, { state }, ["page9"]);
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // === 晋级积分榜（page14） ===
  // 榜单由服务端按系列赛阶段的现存节点重算（只统计系列赛内的比赛），页面只负责渲染。
  app.get('/api/page14', (_request, response) => {
    const view = resolvePage14View(paths);
    response.json({ state: view.state, standings: view.standings });
  });

  app.post('/api/page14', (request, response) => {
    try {
      savePage14State(paths, request.body ?? {});
      const view = resolvePage14View(paths);
      broadcast(SOCKET_EVENTS.page14Update, { state: view.state }, ["page14"]);
      response.json({ success: true, state: view.state, standings: view.standings });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // === 选手介绍（page11-13） ===
  // 返回配置 + 信息录入 + 当前赛事（含头像）+ 实时阵容面板，页面按 mode 自行解析两侧选手
  app.get('/api/page11', (_request, response) => {
    const store = getMatchStore(paths);
    const match = findActiveMatch(store);
    response.json({
      state: getPage11State(paths),
      profiles: getProfileStore(paths),
      match,
      avatars: resolveMatchAvatars(paths, match),
      panels: [getPanelState(paths, 'left'), getPanelState(paths, 'right')],
      stage: getStageState(paths),
    });
  });

  app.post('/api/page11', (request, response) => {
    try {
      const state = savePage11State(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.page11Update, { state }, ["page11"]);
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // === 信息录入（选手 / 战队） ===
  // 选手头像与战队 logo 存于 cache/profiles/**，通过公开静态路径 /runtime/profiles/** 访问
  app.get('/api/profiles', (_request, response) => {
    response.json(getProfileStore(paths));
  });

  app.post('/api/profiles/players', (request, response) => {
    try {
      const profiles = savePlayerProfile(paths, request.body ?? {});
      // 选手名是系列赛对局的名字快照来源，也是完成钩子写回的比对依据：改名后必须回写，
      // 否则该场登记胜负会被「比赛选手与系列赛节点不一致」拒绝（档案改名本身不该让人发现不了）
      if (syncTournamentMatchNames(paths)) {
        emitMatchesUpdate(getMatchStore(paths));
      }
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles }, ROLES_FOR_PROFILES);
      // 选手名是头像匹配键：档案变更后各页需重解析头像（赛事覆盖 > 档案头像）
      emitAvatarUpdate();
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 批量导入选手（JSON）：仅识别 body 数组，或 { players: [...] } 形式
  app.post('/api/profiles/players/import', (request, response) => {
    try {
      const body = request.body;
      const list = Array.isArray(body)
        ? body
        : body && Array.isArray(body.players)
          ? body.players
          : null;
      const result = importPlayerProfiles(paths, list);
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles: result.profiles }, ROLES_FOR_PROFILES);
      emitAvatarUpdate();
      response.json({ success: true, profiles: result.profiles, review: result.review });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/profiles/players/:playerId', (request, response) => {
    try {
      const profiles = deletePlayerProfile(paths, request.params.playerId ?? '');
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles }, ROLES_FOR_PROFILES);
      emitAvatarUpdate();
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/profiles/teams', (request, response) => {
    try {
      const profiles = saveTeamProfile(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles }, ROLES_FOR_PROFILES);
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/profiles/teams/:teamId', (request, response) => {
    try {
      const profiles = deleteTeamProfile(paths, request.params.teamId ?? '');
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles }, ROLES_FOR_PROFILES);
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/upload/player-avatar/:playerId', upload.single('file'), async (request, response) => {
    const playerId = String(request.params.playerId ?? '');
    if (!playerId) {
      response.status(400).json({ success: false, error: 'Invalid player id' });
      return;
    }
    if (!request.file?.buffer) {
      response.status(400).json({ success: false, error: 'No file data' });
      return;
    }

    try {
      // 基于文件魔数校验 + sharp 缩放压缩为 PNG，杜绝存储型同源 XSS
      await saveProfilePlayerAvatar(paths, playerId, request.file.buffer);
      const profiles = getProfileStore(paths);
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles }, ROLES_FOR_PROFILES);
      // 档案头像变了：让 page3/4/6/7/8/10/11 立即重解析（不必等重新载入）
      emitAvatarUpdate();
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 批量导入选手头像：图片文件名（去扩展名）精确匹配已录入选手名字，命中即压缩落盘，
  // 未命中/校验失败的文件在回执中列出由前端提醒。
  // 文件名随表单字段 names（JSON 数组，与文件顺序对齐）显式传递——multer 会把 multipart
  // 文件名按 latin1 解码导致中文乱码，而字段值始终按 UTF-8 解码；names 缺失时回退到
  // originalname 的 latin1→utf8 修复值。
  const PLAYER_AVATAR_BATCH_MAX = 100;
  app.post('/api/upload/player-avatars/batch', upload.array('files', PLAYER_AVATAR_BATCH_MAX), async (request, response) => {
    const files = (request.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      response.status(400).json({ success: false, error: '未收到任何图片文件' });
      return;
    }

    let names: string[] | null = null;
    const rawNames = (request.body as Record<string, unknown> | undefined)?.names;
    if (typeof rawNames === 'string') {
      try {
        const parsed: unknown = JSON.parse(rawNames);
        if (Array.isArray(parsed)) {
          names = parsed.map((item) => String(item ?? ''));
        }
      } catch {
        names = null;
      }
    }

    try {
      const result = await importPlayerAvatarFiles(
        paths,
        files.map((file, index) => ({
          name: names && index < names.length
            ? names[index]
            : Buffer.from(file.originalname, 'latin1').toString('utf8'),
          buffer: file.buffer,
        })),
      );
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles: result.profiles }, ROLES_FOR_PROFILES);
      emitAvatarUpdate();
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // multer 中间件错误（如单批超出数量上限）统一转 400 提示
  app.use('/api/upload/player-avatars/batch', (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(400).json({ success: false, error: error instanceof Error ? error.message : '批量头像上传失败' });
  });

  app.post('/api/upload/team-logo/:teamId', upload.single('file'), async (request, response) => {
    const teamId = String(request.params.teamId ?? '');
    if (!teamId) {
      response.status(400).json({ success: false, error: 'Invalid team id' });
      return;
    }
    if (!request.file?.buffer) {
      response.status(400).json({ success: false, error: 'No file data' });
      return;
    }

    try {
      await saveProfileTeamLogo(paths, teamId, request.file.buffer);
      const profiles = getProfileStore(paths);
      broadcast(SOCKET_EVENTS.profilesUpdate, { profiles }, ROLES_FOR_PROFILES);
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // === MVP 结算（page4） ===
  // GET 公开：推流页面4 首拉（含胜方选手名字与头像）；POST / 显示 / 关闭 需登录（后台「结算画面」控制）
  app.get('/api/mvp', (_request, response) => {
    response.json({ state: getMvpState(paths), winner: getMvpWinnerInfo(paths) });
  });

  app.post('/api/mvp', (request, response) => {
    try {
      const state = saveMvpState(paths, request.body ?? {});
      // 广播带 winner（胜方快照解析出的名字与头像）：后台「结算画面」直接据此展示，无需再拉一次
      broadcast(SOCKET_EVENTS.mvpUpdate, { state, winner: getMvpWinnerInfo(paths) }, ['page4']);
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 显示 MVP 结算：记录当前画面用于关闭时切回，并把推流画面切到页面4
  app.post('/api/mvp/show', (_request, response) => {
    try {
      const stageBefore = getStageState(paths);
      const mvp = stageBefore.page === 'page4'
        ? getMvpState(paths)
        : saveMvpReturnPage(paths, stageBefore.page);
      const stage = saveStageState(paths, { ...stageBefore, page: 'page4' });
      broadcast(SOCKET_EVENTS.mvpUpdate, { state: mvp, winner: getMvpWinnerInfo(paths) }, ['page4']);
      broadcast(SOCKET_EVENTS.stageUpdate, { stage }, ROLES_FOR_STAGE);
      response.json({ success: true, state: mvp, stage });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 关闭 MVP 结算：切回开启前所在画面
  app.post('/api/mvp/hide', (_request, response) => {
    try {
      const current = getStageState(paths);
      const mvp = getMvpState(paths);
      const stage = saveStageState(paths, { ...current, page: mvp.returnPage });
      broadcast(SOCKET_EVENTS.stageUpdate, { stage }, ROLES_FOR_STAGE);
      response.json({ success: true, state: mvp, stage });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/matches', (_request, response) => {
    response.json(getMatchStore(paths));
  });

  app.get('/api/nextgame', (_request, response) => {
    response.json(getNextGamePayload(paths));
  });

  // 下一局比赛自动隐藏定时器：当显示开启后按停留时长到期自动关闭
  let nextgameTimer: NodeJS.Timeout | null = null;
  function scheduleNextGameAutoHide(): void {
    if (nextgameTimer) {
      clearTimeout(nextgameTimer);
      nextgameTimer = null;
    }
    const payload = getNextGamePayload(paths);
    if (!payload.state.visible || !payload.state.shownAt) {
      return;
    }
    const unit = payload.state.durationUnit;
    const durationMs = (unit === 'seconds' ? payload.state.duration : payload.state.duration * 60) * 1000;
    const elapsed = Date.now() - payload.state.shownAt;
    const remaining = durationMs - elapsed;
    if (remaining <= 0) {
      const next = hideNextGame(paths);
      broadcast(SOCKET_EVENTS.nextgameUpdate, next, ["page3"]);
      return;
    }
    nextgameTimer = setTimeout(() => {
      const next = hideNextGame(paths);
      broadcast(SOCKET_EVENTS.nextgameUpdate, next, ["page3"]);
    }, remaining);
  }
  scheduleNextGameAutoHide();

  app.post('/api/nextgame', (request, response) => {
    try {
      const payload = saveNextGameState(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.nextgameUpdate, payload, ["page3"]);
      scheduleNextGameAutoHide();
      response.json({ success: true, ...payload });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/nextgame/show', (request, response) => {
    try {
      const payload = showNextGame(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.nextgameUpdate, payload, ["page3"]);
      scheduleNextGameAutoHide();
      response.json({ success: true, ...payload });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/nextgame/hide', (_request, response) => {
    try {
      const payload = hideNextGame(paths);
      broadcast(SOCKET_EVENTS.nextgameUpdate, payload, ["page3"]);
      scheduleNextGameAutoHide();
      response.json({ success: true, ...payload });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // === 倒计时插件（推流载体顶部叠加小插件） ===
  // GET 公开：推流载体页轮询/首拉；POST 需登录（后台控制）

  // 倒计时归零广播定时器：running 到期后广播静止 00:00 状态
  let countdownZeroTimer: NodeJS.Timeout | null = null;
  function scheduleCountdownZero(): void {
    if (countdownZeroTimer) {
      clearTimeout(countdownZeroTimer);
      countdownZeroTimer = null;
    }
    const state = getCountdownState(paths);
    if (!state.running || state.endAt === null) {
      return;
    }
    const remaining = state.endAt - Date.now();
    if (remaining <= 0) {
      const next = getCountdownState(paths); // 懒归一化已把状态落地为静止 00:00
      broadcast(SOCKET_EVENTS.countdownUpdate, { state: next, serverNow: Date.now() }, ["countdown"]);
      return;
    }
    countdownZeroTimer = setTimeout(() => {
      const next = getCountdownState(paths);
      broadcast(SOCKET_EVENTS.countdownUpdate, { state: next, serverNow: Date.now() }, ["countdown"]);
    }, remaining + 50);
  }
  scheduleCountdownZero();

  function applyCountdownAction(action: 'show' | 'hide' | 'start' | 'pause' | 'reset'): CountdownState {
    switch (action) {
      case 'show':
        return showCountdown(paths);
      case 'hide':
        return hideCountdown(paths);
      case 'start':
        return startCountdown(paths);
      case 'pause':
        return pauseCountdown(paths);
      case 'reset':
        return resetCountdown(paths);
    }
  }

  app.get('/api/countdown', (_request, response) => {
    response.json({ state: getCountdownState(paths), serverNow: Date.now() });
  });

  app.post('/api/countdown', (request, response) => {
    try {
      const state = saveCountdownState(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.countdownUpdate, { state, serverNow: Date.now() }, ["countdown"]);
      scheduleCountdownZero();
      response.json({ success: true, state, serverNow: Date.now() });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/countdown/:action', (request, response) => {
    const action = request.params.action;
    if (action !== 'show' && action !== 'hide' && action !== 'start' && action !== 'pause' && action !== 'reset') {
      response.status(404).json({ success: false, error: `未知的倒计时操作: ${action}` });
      return;
    }
    try {
      const state = applyCountdownAction(action);
      broadcast(SOCKET_EVENTS.countdownUpdate, { state, serverNow: Date.now() }, ["countdown"]);
      scheduleCountdownZero();
      response.json({ success: true, state, serverNow: Date.now() });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches', (request, response) => {
    try {
      // 公开入口不接受 tournamentRef：系列赛比赛只能由引擎锁定配对时内部创建，
      // 剥离它防止普通手建比赛伪造关联
      const { tournamentRef: _stripped, ...sanitizedBody } = (request.body ?? {}) as Record<string, unknown>;
      const matches = createMatch(paths, sanitizedBody);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      emitMatchesUpdate(matches);
      emitAvatarUpdate();
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch('/api/matches/:matchId', (request, response) => {
    try {
      // 系列赛对局的选手名 / 赛制由编排与档案决定（选手名是完成钩子写回的比对依据、赛制决定完赛局数），
      // 面板只允许改战队 / 排位排名等展示字段（与 DELETE 的系列赛守卫同口径）
      assertTournamentMatchFieldsEditable(paths, request.params.matchId, request.body ?? {});
      const matches = updateMatch(paths, request.params.matchId, request.body ?? {});
      const scoreboard = getScoreboardState(paths);
      emitMatchesUpdate(matches);
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      response.json({ success: true, store: matches, scoreboard });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch('/api/matches/:matchId/tags', (request, response) => {
    try {
      const matches = updateMatchTags(paths, request.params.matchId, request.body ?? {});
      emitMatchesUpdate(matches);
      response.json({ success: true, store: matches });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/batch-tags', (request, response) => {
    try {
      const body = (request.body ?? {}) as { matchIds?: unknown; tags?: unknown };
      const matches = updateMatchesTags(paths, body.matchIds, { tags: body.tags });
      emitMatchesUpdate(matches);
      response.json({ success: true, store: matches });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/matches/:matchId', (request, response) => {
    try {
      const target = getMatchStore(paths).matches.find((match) => match.id === request.params.matchId);
      if (target?.tournamentRef) {
        throw new Error('系列赛关联比赛不能直接删除，请使用「回退上一波」');
      }
      const matches = deleteMatch(paths, request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      // 广播出口同步清理推流选场（page6/7/8）中的该场引用，清理结果一并回传
      const pagePush = emitMatchesUpdate(matches);
      emitAvatarUpdate();
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels, pagePush });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/batch-delete', (request, response) => {
    try {
      const guarded = getMatchStore(paths).matches.filter((match) =>
        (request.body?.matchIds ?? []).includes(match.id) && match.tournamentRef,
      );
      if (guarded.length) {
        throw new Error('选中的比赛含系列赛关联场次，不能直接删除，请使用「回退上一波」');
      }
      const matches = deleteMatches(paths, request.body?.matchIds ?? []);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      // 广播出口同步清理推流选场（page6/7/8）中的已删引用，清理结果一并回传
      const pagePush = emitMatchesUpdate(matches);
      emitAvatarUpdate();
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels, pagePush });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/undo-delete', (_request, response) => {
    try {
      const matches = undoDeletedMatches(paths);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      emitMatchesUpdate(matches);
      emitAvatarUpdate();
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/:matchId/select', (request, response) => {
    try {
      const matches = setActiveMatch(paths, request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      emitMatchesUpdate(matches);
      emitAvatarUpdate();
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ===== 云同步登记闸门：分控端只能登记指派给本机的比赛，已确认赛果禁止撤回 =====
  // 从源头杜绝误操作（分控端登记了未指派的比赛 → 回传 → 主控还得驳回）。
  const assertMatchRegistration = (matchId: string): void => {
    const gate = canRegisterMatch(paths, matchId);
    if (!gate.allowed) {
      throw new Error(gate.reason);
    }
  };

  const assertMatchUndoAllowed = (matchId: string): void => {
    const gate = checkSubUndoAllowed(paths, matchId);
    if (!gate.allowed) {
      throw new Error(gate.reason);
    }
  };

  // 系列赛写回前置校验：必须在比分落盘前跑，否则钩子抛错会留下
  // 「比分已写入、系列赛没推进」且无法再登记的半吊子状态
  const assertTournamentWriteBack = (matchId: string): void => {
    const gate = prepareTournamentWriteBack(paths, matchId);
    if (!gate.allowed) {
      throw new Error(gate.reason);
    }
  };

  app.post('/api/matches/:matchId/winner', (request, response) => {
    try {
      const winner = request.body?.winner;
      if (winner !== 'left' && winner !== 'right') {
        throw new Error('winner must be left or right');
      }
      assertMatchRegistration(request.params.matchId);
      assertTournamentWriteBack(request.params.matchId);
      const matches = recordMatchWinner(paths, request.params.matchId, winner);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      emitMatchesUpdate(matches);
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      // 系列赛完成钩子：带 ref 且刚完成的比赛写回节点，可能触发下一波/下一阶段
      const updatedTournament = onMatchCompleted(paths, request.params.matchId);
      if (updatedTournament) {
        // 钩子可能批量建场：再广播一次 matches，并广播 tournament:update
        emitMatchesUpdate(getMatchStore(paths));
        emitTournamentUpdate();
      }
      // 登记本局胜负：当前画面是推流页面1-3 时自动切入胜者结算画面（page10）。
      // 只在登记的就是「当前比赛」时触发——page10 的内容取活动比赛，系列赛里 headless
      // 登记别的场次若也跟着切页，会把正在推流的那一场顶掉、播出别人的比分。
      if (request.params.matchId === getMatchStore(paths).activeMatchId) {
        triggerWinnerStage();
      }
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/:matchId/start', (request, response) => {
    try {
      assertMatchRegistration(request.params.matchId);
      const matches = startCurrentGame(paths, request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      emitMatchesUpdate(matches);
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 比赛管理「录入阵容」：只写指定赛事当前小局（待开始）的双方阵容记录，一次写入
  // 单次广播 matchesUpdate（避免推流页因两次事件重渲染两遍产生闪烁），不触碰面板/比分栏
  app.post('/api/matches/:matchId/games/:gameNumber/lineup', (request, response) => {
    const selections = request.body?.selections;
    if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
      response.status(400).json({ success: false, error: 'selections must be an object with left/right lineups' });
      return;
    }
    const gameNumber = Number.parseInt(request.params.gameNumber, 10);
    if (!Number.isInteger(gameNumber) || gameNumber < 1) {
      response.status(400).json({ success: false, error: 'invalid game number' });
      return;
    }

    try {
      const matches = saveGameLineupForMatch(paths, request.params.matchId, gameNumber, {
        left: selections.left,
        right: selections.right,
      });
      emitMatchesUpdate(matches);
      response.json({ success: true, store: matches });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/:matchId/undo', (request, response) => {
    try {
      // 已 ack 的赛果在分控端禁止撤回（整条替换合并不会触发 onMatchUndo，单方面撤回会让状态分叉）
      assertMatchUndoAllowed(request.params.matchId);
      // 系列赛反向钩子必须先跑：无法回退时（后续波已开打/人工对阵）直接失败，
      // 避免出现「比赛已撤回、系列赛仍显示晋级」的半吊子状态（后续登记还会被节点胜者幂等吞掉）
      const undoneTournament = onMatchUndo(paths, request.params.matchId);
      if (undoneTournament) {
        emitTournamentUpdate();
      }
      const matches = undoMatchAction(paths, request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      emitMatchesUpdate(matches);
      emitAvatarUpdate();
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/:matchId/redo', (_request, response) => {
    try {
      const matches = redoMatchAction(paths, _request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      emitMatchesUpdate(matches);
      emitAvatarUpdate();
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      panels.forEach((panel) => broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ==================== 系列赛自动化管理（管理端，受鉴权保护） ====================
  app.get('/api/tournaments', (_request, response) => {
    response.json({ tournaments: getTournamentStore(paths) });
  });

  // 本机已「本机移除」的系列赛（localOnly，仅本机存在）：恢复弹窗数据源。
  // 必须注册在 GET /:tournamentId 之前，否则会被当成 id 吃掉
  app.get('/api/tournaments/local-removed', (_request, response) => {
    response.json({ tournaments: getLocallyRemovedTournaments(paths) });
  });

  app.get('/api/tournaments/:tournamentId', (request, response) => {
    const tournament = getTournamentStore(paths).find((item) => item.id === request.params.tournamentId);
    if (!tournament) {
      response.status(404).json({ success: false, error: '系列赛不存在' });
      return;
    }
    response.json({ tournament });
  });

  // 系列赛阵容批量导入：dryRun 预览（名字解析 + 场次预检）/ 写入（一次 matchesUpdate 广播）。
  // 门槛与单场「录入阵容」一致（比赛待开始 + 第 1 局尚未开赛），属比赛记录写入——任意机器可用
  app.post('/api/tournaments/:tournamentId/lineup-import', (request, response) => {
    const tournamentId = request.params.tournamentId;
    const body = (request.body ?? {}) as { dryRun?: unknown; rows?: unknown };
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows || rows.length === 0 || rows.length > 256) {
      response.status(400).json({ success: false, error: 'rows 必须是非空数组（最多 256 场）' });
      return;
    }
    if (!getTournamentStore(paths).some((record) => record.id === tournamentId)) {
      response.status(404).json({ success: false, error: '系列赛不存在' });
      return;
    }

    const normalized = rows.map((row) => {
      const item = (row ?? {}) as Record<string, unknown>;
      return {
        matchId: String(item.matchId ?? '').trim(),
        left: item.left,
        right: item.right,
      };
    });
    const sideToText = (value: unknown): string =>
      Array.isArray(value)
        ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean).join('\n')
        : '';

    // 预览：场次级预检（归属 / 待开始 / 第 1 局）+ 逐格名字解析（与「快速填充」同一套匹配）
    if (body.dryRun) {
      const checks = inspectLineupImportTargets(paths, tournamentId, normalized.map((row) => row.matchId));
      const preview: LineupImportPreviewRow[] = normalized.map((row, index) => {
        const check = checks[index];
        const left = buildQuickFillPreview(paths, sideToText(row.left)).matches;
        const right = buildQuickFillPreview(paths, sideToText(row.right)).matches;
        const cells = [...left, ...right].filter((cell) => cell.input);
        const unmatchedCount = cells.filter((cell) => !cell.matched).length;
        const reason = !check.ok
          ? check.reason
          : cells.length === 0
            ? '两侧均无阵容'
            : unmatchedCount > 0
              ? `有 ${unmatchedCount} 个精灵未匹配`
              : undefined;
        return {
          matchId: row.matchId,
          ok: check.ok && cells.length > 0 && unmatchedCount === 0,
          reason,
          left,
          right,
        };
      });
      response.json({ success: true, rows: preview });
      return;
    }

    try {
      const { store, results } = applyLineupImport(paths, tournamentId, normalized);
      emitMatchesUpdate(store);
      response.json({ success: true, results });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments', (request, response) => {
    try {
      const tournament = createTournament(paths, request.body ?? {});
      emitTournamentUpdate();
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments/:tournamentId/draw', (request, response) => {
    try {
      const tournament = redrawTournament(paths, request.params.tournamentId, request.body ?? {});
      emitTournamentUpdate();
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 只读：按当前 seed 预览首波对阵（不建场），供 setup 抽签面板展示
  app.get('/api/tournaments/:tournamentId/opening-wave', (request, response) => {
    try {
      response.json(previewOpeningWave(paths, request.params.tournamentId));
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments/:tournamentId/start', (request, response) => {
    try {
      const tournament = startTournament(paths, request.params.tournamentId);
      emitMatchesUpdate(getMatchStore(paths));
      emitTournamentUpdate();
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments/:tournamentId/advance', (request, response) => {
    try {
      const tournament = advanceTournament(paths, request.params.tournamentId);
      emitMatchesUpdate(getMatchStore(paths));
      emitTournamentUpdate();
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put('/api/tournaments/:tournamentId/waves/:waveGlobalIndex/pairings', (request, response) => {
    try {
      const tournament = savePairingDraft(
        paths,
        request.params.tournamentId,
        request.params.waveGlobalIndex,
        request.body ?? {},
      );
      emitTournamentUpdate();
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments/:tournamentId/waves/:waveGlobalIndex/pairings/lock', (request, response) => {
    try {
      const tournament = lockPairings(
        paths,
        request.params.tournamentId,
        request.params.waveGlobalIndex,
        request.body ?? {},
      );
      emitMatchesUpdate(getMatchStore(paths));
      emitTournamentUpdate();
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments/:tournamentId/waves/:waveGlobalIndex/pairings/import', (request, response) => {
    try {
      const result = importPairings(
        paths,
        request.params.tournamentId,
        request.params.waveGlobalIndex,
        request.body ?? {},
      );
      emitTournamentUpdate();
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments/:tournamentId/rollback-wave', (request, response) => {
    try {
      const tournament = rollbackWave(paths, request.params.tournamentId);
      // 回退会删除未打的对局：广播出口同步清理推流选场里的引用
      const pagePush = emitMatchesUpdate(getMatchStore(paths));
      emitTournamentUpdate();
      response.json({ success: true, tournament, pagePush });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/tournaments/:tournamentId/forfeit', (request, response) => {
    try {
      const body = (request.body ?? {}) as { matchId?: unknown; loserSide?: unknown };
      const matchId = String(body.matchId ?? '').trim();
      if (!matchId) {
        throw new Error('请指定弃权比赛 matchId');
      }
      if (body.loserSide !== 'left' && body.loserSide !== 'right') {
        throw new Error('loserSide must be left or right');
      }
      const target = getMatchStore(paths).matches.find((match) => match.id === matchId);
      if (!target) {
        throw new Error('比赛不存在');
      }
      if (!target.tournamentRef || target.tournamentRef.tournamentId !== request.params.tournamentId) {
        throw new Error('该比赛不属于本系列赛');
      }
      // 同登记胜负：弃权也走完成钩子，先校验再落盘，避免半吊子状态
      assertTournamentWriteBack(matchId);

      forfeitMatch(paths, matchId, body.loserSide);
      const updated = onMatchCompleted(paths, matchId);
      emitMatchesUpdate(getMatchStore(paths));
      if (updated) {
        emitTournamentUpdate();
      }
      const tournament = getTournamentStore(paths).find((item) => item.id === request.params.tournamentId);
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 删除系列赛：默认仅解绑关联比赛（保留为普通对局）；body.deleteMatches=true 连同比赛一起删
  app.delete('/api/tournaments/:tournamentId', (request, response) => {
    try {
      const body = (request.body ?? {}) as { deleteMatches?: unknown };
      const result = deleteTournament(
        paths,
        request.params.tournamentId,
        { deleteMatches: body.deleteMatches === true },
      );
      // 连同对局删除时由广播出口同步清理推流选场里的引用（仅解绑不影响选场）
      const pagePush = emitMatchesUpdate(getMatchStore(paths));
      emitTournamentUpdate();
      response.json({ success: true, ...result, pagePush });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 本机移除：分控端对「非本机编排」的系列赛做视图层隐藏（幂等；不物理删除、不传播、对局引用不动）
  app.post('/api/tournaments/:tournamentId/local-remove', (request, response) => {
    try {
      const result = removeLocalTournament(paths, request.params.tournamentId);
      emitTournamentUpdate();
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 恢复本机移除：记录立即重新可见；下次同步自动补齐编排机的最新编排与变更
  app.post('/api/tournaments/:tournamentId/local-restore', (request, response) => {
    try {
      const tournament = restoreLocalTournament(paths, request.params.tournamentId);
      emitTournamentUpdate();
      response.json({ success: true, tournament });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/scoreboard', (request, response) => {
    try {
      const scoreboard = saveScoreboardState(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      response.json({ success: true, scoreboard });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/scoreboard/best-of', (request, response) => {
    try {
      const scoreboard = saveScoreboardBestOf(paths, request.body ?? {});
      broadcast(SOCKET_EVENTS.scoreboardUpdate, { scoreboard }, ROLES_FOR_SCOREBOARD);
      response.json({ success: true, scoreboard });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/sprites', (request, response) => {
    const keyword = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const sprites = listSprites(paths).filter((sprite) => !keyword || spriteMatchesKeyword(sprite, keyword));
    response.json({ sprites, count: sprites.length });
  });

  app.get('/api/stats/ranking', (request, response) => {
    const player = typeof request.query.player === 'string' ? request.query.player : '';
    const tag = typeof request.query.tag === 'string' ? request.query.tag : '';
    const tournamentId = typeof request.query.tournamentId === 'string' ? request.query.tournamentId : '';
    response.json(getSpriteRanking(paths, {
      player: player || null,
      tag: tag || null,
      tournamentId: tournamentId || null,
    }));
  });

  app.post('/api/panels/:position', (request, response) => {
    const position = request.params.position;
    if (position !== 'left' && position !== 'right') {
      response.status(404).json({ success: false, error: 'Invalid position' });
      return;
    }

    try {
      const activeStore = getMatchStore(paths);
      const activeMatch = activeStore.matches.find((match) => match.id === activeStore.activeMatchId);
      if (activeMatch?.status === 'completed') {
        throw new Error('当前赛事已完赛，不能编辑阵容');
      }

      const activeGame =
        activeMatch?.games.find((game) => game.status === 'in_progress')
        ?? activeMatch?.games.find((game) => game.status === 'pending')
        ?? null;

      if (activeMatch && activeGame?.status === 'pending') {
        const matches = saveDraftPanelStateForActiveMatch(paths, position, request.body?.selected ?? []);
        emitMatchesUpdate(matches);
        response.json({ success: true, store: matches });
        return;
      }

      if (activeMatch && activeGame?.status === 'in_progress') {
        const panel = savePanelState(paths, position, request.body?.selected ?? []);
        const matches = saveDraftPanelStateForActiveMatch(paths, position, request.body?.selected ?? []);
        broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL);
        emitMatchesUpdate(matches);
        response.json({ success: true, panel, matches });
        return;
      }

      const panel = savePanelState(paths, position, request.body?.selected ?? []);
      const matches = syncActiveMatchLineupsFromPanels(paths);
      broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL);
      emitMatchesUpdate(matches);
      response.json({ success: true, panel, matches });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(message.startsWith('Sprite not found') ? 404 : 400).json({ success: false, error: message });
    }
  });

  app.patch('/api/panels/:position/slots/:slot', (request, response) => {
    const position = request.params.position;
    const slotIndex = Number.parseInt(request.params.slot, 10);
    if (position !== 'left' && position !== 'right') {
      response.status(404).json({ success: false, error: 'Invalid position' });
      return;
    }
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 6) {
      response.status(400).json({ success: false, error: 'Invalid slot index' });
      return;
    }

    try {
      const activeStore = getMatchStore(paths);
      const activeMatch = activeStore.matches.find((match) => match.id === activeStore.activeMatchId);
      if (activeMatch?.status === 'completed') {
        throw new Error('当前赛事已完赛，不能编辑阵容');
      }

      const activeGame =
        activeMatch?.games.find((game) => game.status === 'in_progress')
        ?? activeMatch?.games.find((game) => game.status === 'pending')
        ?? null;

      if (activeMatch && activeGame?.status === 'pending') {
        const matches = saveDraftPanelSlotStateForActiveMatch(paths, position, slotIndex, request.body?.slot ?? null);
        emitMatchesUpdate(matches);
        response.json({ success: true, store: matches });
        return;
      }

      if (activeMatch && activeGame?.status === 'in_progress') {
        const panel = savePanelSlotState(paths, position, slotIndex, request.body?.slot ?? null);
        const matches = saveDraftPanelSlotStateForActiveMatch(paths, position, slotIndex, request.body?.slot ?? null);
        broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL);
        emitMatchesUpdate(matches);
        response.json({ success: true, panel, matches });
        return;
      }

      const panel = savePanelSlotState(paths, position, slotIndex, request.body?.slot ?? null);
      const matches = syncActiveMatchLineupsFromPanels(paths);
      broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL);
      emitMatchesUpdate(matches);
      response.json({ success: true, panel, matches });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(message.startsWith('Sprite not found') ? 404 : 400).json({ success: false, error: message });
    }
  });

  app.delete('/api/panels/:position', (request, response) => {
    const position = request.params.position;
    if (position !== 'left' && position !== 'right') {
      response.status(404).json({ success: false, error: 'Invalid position' });
      return;
    }

    try {
      const activeStore = getMatchStore(paths);
      const activeMatch = activeStore.matches.find((match) => match.id === activeStore.activeMatchId);
      if (activeMatch?.status === 'completed') {
        throw new Error('当前赛事已完赛，不能编辑阵容');
      }

      const activeGame =
        activeMatch?.games.find((game) => game.status === 'in_progress')
        ?? activeMatch?.games.find((game) => game.status === 'pending')
        ?? null;

      if (activeMatch && activeGame?.status === 'pending') {
        const matches = saveDraftPanelStateForActiveMatch(paths, position, []);
        emitMatchesUpdate(matches);
        response.json({ success: true, position, matches });
        return;
      }

      if (activeMatch && activeGame?.status === 'in_progress') {
        clearPanelState(paths, position);
        const panel = getPanelState(paths, position);
        const matches = saveDraftPanelStateForActiveMatch(paths, position, []);
        broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL);
        emitMatchesUpdate(matches);
        response.json({ success: true, position, panel, matches });
        return;
      }

      clearPanelState(paths, position);
      const panel = getPanelState(paths, position);
      const matches = syncActiveMatchLineupsFromPanels(paths);
      broadcast(SOCKET_EVENTS.panelUpdate, { panel }, ROLES_FOR_PANEL);
      emitMatchesUpdate(matches);
      response.json({ success: true, position, panel, matches });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/quick-fill', (request, response) => {
    try {
      const preview = buildQuickFillPreview(paths, String(request.body?.text ?? ''));
      response.json({ success: true, ...preview });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/upload/avatar/:side', upload.single('file'), async (request, response) => {
    const side = request.params.side;
    if (side !== 'left' && side !== 'right') {
      response.status(400).json({ success: false, error: 'Invalid avatar side' });
      return;
    }
    if (!request.file?.buffer) {
      response.status(400).json({ success: false, error: 'No file data' });
      return;
    }
    const matchId = getMatchStore(paths).activeMatchId;
    if (!matchId) {
      response.status(400).json({ success: false, error: '请先创建或选择一场赛事再设置头像' });
      return;
    }

    try {
      // saveAvatar now validates the payload's magic bytes and only accepts
      // real raster images, then resizes/compresses to a square PNG, so
      // HTML/etc. payloads are rejected before storage. Avatars are scoped
      // to the active match (cache/avatars/{matchId}).
      const avatar = await saveAvatar(paths, side, matchId, request.file.buffer);
      const store = getMatchStore(paths);
      broadcast(SOCKET_EVENTS.avatarUpdate, { matchId, avatar, avatars: resolveMatchAvatars(paths, findActiveMatch(store)) }, ROLES_FOR_AVATAR);
      response.json({ success: true, side, matchId, avatar });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/delete/avatar/:side', (request, response) => {
    const side = request.params.side;
    if (side !== 'left' && side !== 'right') {
      response.status(400).json({ success: false, error: 'Invalid avatar side' });
      return;
    }
    const matchId = getMatchStore(paths).activeMatchId;
    if (!matchId) {
      response.status(400).json({ success: false, error: '请先创建或选择一场赛事再设置头像' });
      return;
    }

    const avatar = deleteAvatar(paths, side, matchId);
    const store = getMatchStore(paths);
    broadcast(SOCKET_EVENTS.avatarUpdate, { matchId, side, avatar, avatars: resolveMatchAvatars(paths, findActiveMatch(store)) }, ROLES_FOR_AVATAR);
    response.json({ success: true, side, matchId, avatar });
  });

  app.get('/api/runtime-config', (_request, response) => {
    // 云同步状态也一并下发：前端「数据同步」视图一次请求就能渲染设置区（含名册与最后通信时间）
    response.json({
      ...loadRuntimeConfig(paths),
      syncConfig: getCloudSyncStatus(paths),
    });
  });

  app.post('/api/runtime-config', (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    // 合并语义：只覆盖传入字段（单传 machineCode 不会把 port 重置为默认）
    // 改机器码守卫：有 running 系列赛内嵌旧码直接拒绝；有其它系列赛内嵌旧码要求二次确认
    let guard = { blocked: false, requireConfirm: false, tournamentIds: [] as string[], message: '' };
    if (body.machineCode !== undefined) {
      guard = checkMachineCodeChange(paths, String(body.machineCode));
      if (guard.blocked) {
        response.status(400).json({ success: false, error: guard.message, guard });
        return;
      }
      if (guard.requireConfirm && body.confirmMachineCodeChange !== true) {
        response.status(409).json({ success: false, error: guard.message, guard });
        return;
      }
    }

    const config = saveRuntimeConfig(paths, {
      port: body.port === undefined ? undefined : Number(body.port),
      machineCode: body.machineCode === undefined ? undefined : String(body.machineCode),
    });
    response.json({ success: true, config, guard, syncConfig: getCloudSyncStatus(paths) });
  });

  // === 云同步（点击式）：主控「同步分发 / 检查回传 / 确认台」+ 分控「同步最新 / 回传」+ 红点轮询 ===

  /** 云同步写操作必须带房间密钥与机器码（两道校验：键一致 + 本机已设置标识） */
  const readCloudRequest = (request: Request): { key: string; machine: string } => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const config = loadRuntimeConfig(paths);
    const key = String(body.syncKey ?? config.syncKey ?? '').trim();
    const machine = String(body.machineCode ?? config.machineCode ?? '').trim();
    if (!key) {
      throw new Error('未配置房间密钥（syncKey），请先在「云同步设置区」填写并保存');
    }
    if (key !== config.syncKey) {
      throw new Error('界面上的房间密钥与已保存的不一致，请重新保存云同步设置');
    }
    if (!machine) {
      throw new Error('请先设置本机标识（machineCode）');
    }
    return { key, machine };
  };

  const readStringArray = (value: unknown): string[] => (
    Array.isArray(value) ? value.map((item) => String(item ?? '')) : []
  );

  /**
   * 保存云同步设置类接口的错误出口：换房间守卫回 409 + guard（前端据此弹「重置旧状态 / 原样保留」
   * 二次确认，选了再重试一次），其余（字段非法等）照旧 400。
   */
  const respondCloudConfigError = (response: Response, error: unknown): void => {
    const guard = (error as { guard?: CloudSyncKeyGuardResult }).guard;
    const message = error instanceof Error ? error.message : String(error);
    if (guard) {
      response.status(409).json({ success: false, error: message, guard });
      return;
    }
    response.status(400).json({ success: false, error: message });
  };

  /** multipart 表单里的字符串化 JSON 数组（accepted / excludeTournamentIds 都走这个） */
  const readJsonArrayField = (value: unknown): string[] => {
    if (typeof value !== 'string' || !value.trim()) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item ?? '')) : [];
    } catch {
      return [];
    }
  };

  /** 云同步状态（轮询用；只读本机状态，不产生任何云端请求） */
  app.get('/api/cloud-sync/status', (_request, response) => {
    response.json({ success: true, status: getCloudSyncStatus(paths) });
  });

  /** 红点轮询：只读云端小键（version / ack / uplink），绝不合并数据 */
  app.post('/api/cloud-sync/poll', async (request, response) => {
    try {
      readCloudRequest(request);
      const result = await pollCloudSync(paths);
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 云同步设置：房间密钥 / 角色 / Worker 地址 / 显示名 / 轮询开关 + 主控端分控码名册（改房间号见换房间守卫） */
  app.post('/api/cloud-sync/config', (request, response) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const status = saveCloudSyncConfig(paths, {
        syncKey: body.syncKey,
        syncToken: body.syncToken,
        role: body.role,
        workerUrl: body.workerUrl,
        machineLabel: body.machineLabel,
        pollEnabled: body.pollEnabled,
        pollIntervalSeconds: body.pollIntervalSeconds,
        peerCodes: body.peerCodes,
        cloudStateAction: body.cloudStateAction,
      });
      response.json({ success: true, status });
    } catch (error) {
      respondCloudConfigError(response, error);
    }
  });

  /**
   * 「检测 Worker 在线」：打 /health，不碰 KV、**不需要房间密钥**。
   * 只要求 workerUrl 已保存（本接口会先把界面上的地址存下来再测，省一步「保存设置」）。
   */
  app.post('/api/cloud-sync/test', async (request, response) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (body.workerUrl !== undefined || body.syncKey !== undefined || body.syncToken !== undefined) {
        // undefined = 界面没带该字段（保持已保存值）；空字符串 = 用户主动清空（照存）
        // 这里同样会经过换房间守卫：测试连通性顺手保存的房间号也不许静默带走旧房间状态
        saveCloudSyncConfig(paths, {
          workerUrl: body.workerUrl,
          syncKey: body.syncKey,
          syncToken: body.syncToken,
          cloudStateAction: body.cloudStateAction,
        });
      }
      const result = await testCloudConnection(paths);
      response.json({ success: result.ok, ...result });
    } catch (error) {
      respondCloudConfigError(response, error);
    }
  });

  /** 主控「同步分发」：全量包（不带头像）+ 指派规则 + 名册 → downlink + version */
  app.post('/api/cloud-sync/push', async (request, response) => {
    try {
      readCloudRequest(request);
      const result = await pushCloudSync(paths);
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 分控「同步最新」：读 downlink → 配对校验 → 与现有导入一致的预览（不写入） */
  app.post('/api/cloud-sync/pull', async (request, response) => {
    try {
      readCloudRequest(request);
      const result = await previewCloudPull(paths);
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 分控「确认合并」：用落盘待合并包 + 勾选条目走现有 applySyncImport，合并后重算待回传集 */
  app.post('/api/cloud-sync/apply', async (request, response) => {
    try {
      readCloudRequest(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await finalizeCloudPull(
        paths,
        readStringArray(body.accepted),
        body.mode === 'bundle' ? 'bundle' : 'newer',
        readStringArray(body.excludeTournamentIds),
      );
      emitMatchesUpdate(getMatchStore(paths));
      emitTournamentUpdate();
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * 分控「无需改动，标记为已处理」：预览里全是「不用改」的条目时收尾状态用。
   * 只推进本机记录的云端版本，不写入任何比赛/系列赛数据。
   */
  app.post('/api/cloud-sync/skip', async (request, response) => {
    try {
      readCloudRequest(request);
      const result = await skipCloudPull(paths);
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 分控「默认排除」管理（B1）：保存下次拉取预览默认排除的系列赛（空数组 = 清除记忆） */
  app.post('/api/cloud-sync/excluded-tournaments', (request, response) => {
    try {
      readCloudRequest(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const status = saveCloudExcludedTournaments(paths, body.tournamentIds);
      response.json({ success: true, status });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 分控「回传」：现算所有未 ack 比赛的累计集合 → uplink:{本机码} */
  app.post('/api/cloud-sync/upload', async (request, response) => {
    try {
      readCloudRequest(request);
      const result = await uploadCloudSync(paths);
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 主控「检查回传」：读各分控 uplink → 复用现有预览 + 写回影响说明（不写入） */
  app.post('/api/cloud-sync/check', async (request, response) => {
    try {
      readCloudRequest(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await checkCloudSync(paths, body.code === undefined ? null : String(body.code));
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 主控确认台：确认 = 合并被勾选赛果 + runTournamentWriteBack 推进波次 + 写回执 */
  app.post('/api/cloud-sync/confirm', async (request, response) => {
    try {
      readCloudRequest(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const code = String(body.code ?? '').trim();
      if (!code) {
        throw new Error('请指定要确认的分控端机器码');
      }
      const result = await confirmCloudSync(paths, code, readStringArray(body.accepted));
      emitMatchesUpdate(getMatchStore(paths));
      emitTournamentUpdate();
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 主控驳回：不写本地、不写回执，分控端保持待回传 */
  app.post('/api/cloud-sync/reject', async (request, response) => {
    try {
      readCloudRequest(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const code = String(body.code ?? '').trim();
      if (!code) {
        throw new Error('请指定要驳回的分控端机器码');
      }
      const result = await rejectCloudSync(paths, code);
      response.json({ success: true, ...result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** 主控指派：比赛 id -> 登记机器码（空字符串 = 主控端自己登记），随下次「同步分发」生效 */
  app.post('/api/cloud-sync/assignment', (request, response) => {
    try {
      readCloudRequest(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const status = saveCloudAssignment(paths, body.overrides ?? {});
      response.json({ success: true, status });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * 登记入口判定（分控端按指派范围置灰，未指派 = 主控端登记）：
   * 一次问一批比赛（比赛管理列表逐行渲染，不能逐行打接口）。
   * 同时下发待回传集与已确认集：前者用于「回传」按钮与列表标记，后者用于锁定分控端撤回。
   */
  app.post('/api/cloud-sync/registration-scope', (request, response) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const matchIds = readStringArray(body.matchIds);
      const scope: Record<string, { allowed: boolean; reason: string }> = {};
      matchIds.forEach((matchId) => {
        scope[matchId] = canRegisterMatch(paths, matchId);
      });
      const status = getCloudSyncStatus(paths);
      response.json({
        success: true,
        scope,
        role: status.config.role,
        pending: status.pending,
      });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });


  // === 双机数据同步：导出 / 预览 / 导入（同步包为单个 JSON 文件，导入走 multipart 上传） ===

  // 解析上传的同步包文件（multipart 字段：file + 可选 mode）
  const readSyncRequest = (request: Request): { raw: unknown; mode: SyncConflictMode } => {
    const file = request.file;
    if (!file?.buffer?.length) {
      throw new Error('未收到同步包文件');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(file.buffer.toString('utf-8'));
    } catch {
      throw new Error('同步包不是有效的 JSON 文件');
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const mode: SyncConflictMode = body.mode === 'bundle' ? 'bundle' : 'newer';
    return { raw, mode };
  };

  // 导出同步包：比赛（全部场次）+ 可选档案与头像，由前端落盘为 JSON 文件
  app.post('/api/sync/export', (request, response) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const bundle = exportSyncBundle(paths, {
        includeProfiles: body.includeProfiles !== false,
        includeAvatars: body.includeAvatars === true,
        // 定向同步（系列赛列表「定向同步」入口）：只导出指定系列赛的范围包
        tournamentIds: Array.isArray(body.tournamentIds)
          ? body.tournamentIds.map((id) => String(id ?? '').trim()).filter(Boolean)
          : undefined,
      });
      response.json({ success: true, bundle });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 导入预览：只读解析并逐条列出 新增 / 更新 / 跳过，不写入任何数据
  app.post('/api/sync/preview', syncUpload.single('file'), (request, response) => {
    try {
      const { raw, mode } = readSyncRequest(request);
      response.json({ success: true, preview: previewSyncImport(paths, raw, mode) });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 应用导入：服务端重新分类，按勾选条目合并比赛与档案、按需补缺头像，并广播刷新
  app.post('/api/sync/import', syncUpload.single('file'), async (request, response) => {
    try {
      const { raw, mode } = readSyncRequest(request);
      const body = (request.body ?? {}) as Record<string, unknown>;

      let accepted: string[] = readJsonArrayField(body.accepted);

      // 预览里被取消勾选的系列赛：整条不导入（编排不合并 + 其比赛不写入）
      const excludeTournamentIds = readJsonArrayField(body.excludeTournamentIds);

      const result = await applySyncImport(paths, raw, {
        mode,
        acceptedKeys: accepted,
        includeAvatars: String(body.includeAvatars ?? 'true') !== 'false',
        // 默认只补缺；用户勾选「覆盖已有头像」才会用包内图片覆盖本机同档案头像
        overwriteAvatars: String(body.overwriteAvatars ?? '') === 'true',
        excludeTournamentIds,
      });

      emitMatchesUpdate(result.store);
      // 系列赛有变化（新副本 / 编排机写回推进，可能已自动生成下一波比赛 → store 已取最新）：广播刷新
      if (result.tournaments.added || result.tournaments.updated || result.tournaments.advanced) {
        emitTournamentUpdate();
      }
      if (result.profiles) {
        broadcast(SOCKET_EVENTS.profilesUpdate, { profiles: result.profiles }, ROLES_FOR_PROFILES);
        // 同步导入可能补写档案头像 / 变更选手名，头像匹配结果随之变化
        emitAvatarUpdate();
      }
      response.json({ success: true, result });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // multer 中间件错误（如文件超过上限）统一转 400 JSON 提示
  app.use(['/api/sync/preview', '/api/sync/import'], (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : '同步包上传失败';
    response.status(400).json({
      success: false,
      error: /too large/i.test(message) ? '同步包超过大小上限（可关闭头像后重试）' : message,
    });
  });

  app.get('/api/avatar/left-avatar.png', (_request, response) => {
    const matchId = getMatchStore(paths).activeMatchId;
    const file = matchId ? paths.avatarFile('left', matchId) : null;
    if (!file || !fs.existsSync(file)) {
      response.status(404).end();
      return;
    }
    response.type(readAvatarMimeType(paths, 'left', matchId));
    response.sendFile(file);
  });

  app.get('/api/avatar/right-avatar.png', (_request, response) => {
    const matchId = getMatchStore(paths).activeMatchId;
    const file = matchId ? paths.avatarFile('right', matchId) : null;
    if (!file || !fs.existsSync(file)) {
      response.status(404).end();
      return;
    }
    response.type(readAvatarMimeType(paths, 'right', matchId));
    response.sendFile(file);
  });

  // 按赛事隔离的头像：/api/avatar/{matchId}/{side}-avatar.png
  app.get('/api/avatar/:matchId/:sideName', (request, response) => {
    const { matchId, sideName } = request.params;
    if (sideName !== 'left-avatar.png' && sideName !== 'right-avatar.png') {
      response.status(404).end();
      return;
    }
    const side = sideName === 'left-avatar.png' ? 'left' : 'right';
    const file = paths.avatarFile(side, matchId);
    if (!fs.existsSync(file)) {
      response.status(404).end();
      return;
    }
    response.type(readAvatarMimeType(paths, side, matchId));
    response.sendFile(file);
  });

  io.on('connection', (socket) => {
    // 客户端通过 query.role 声明身份（pageN / float / carrier / countdown / admin）；
    // 缺省或无法识别时按 admin 收全量，保证未升级的旧客户端行为不变。
    const role = normalizeSocketRole(socket.handshake.query.role);
    socket.join(roleRoom(role));
    socket.emit(SOCKET_EVENTS.snapshot, snapshotForRole(role));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port,
    server,
    io,
    async close() {
      clearWinnerStageReturnTimer();
      if (nextgameTimer) {
        clearTimeout(nextgameTimer);
        nextgameTimer = null;
      }
      if (countdownZeroTimer) {
        clearTimeout(countdownZeroTimer);
        countdownZeroTimer = null;
      }
      // io 以 http server 构造，io.close() 会断开所有客户端并关闭它；
      // 不能再对已由 io 关闭的 server 重复调 server.close()，否则必然抛
      // ERR_SERVER_NOT_RUNNING。closeIdleConnections 先断 keep-alive 连接，
      // 避免 server.close 因浏览器/长连接未断而迟迟不回调。
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => {
        io.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
