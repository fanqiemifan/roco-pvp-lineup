import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';

import { SOCKET_EVENTS } from '../shared/events.js';
import type { AvatarCollectionState, CountdownState, SnapshotPayload, StagePageKey } from '../shared/types.js';
import { buildQuickFillPreview, listSprites, spriteMatchesKeyword } from './services/sprite-service.js';
import { getSpriteRanking } from './services/stats-service.js';
import {
  ensureRuntimeDirs,
  getAvatarStates,
  saveAvatar,
  savePage8Wallpaper,
  saveProfilePlayerAvatar,
  saveProfileTeamLogo,
  deleteAvatar,
  readAvatarMimeType,
} from './services/image-service.js';
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
import {
  getStageState,
  saveStageState,
} from './services/stage-service.js';
import {
  getPage6State,
  savePage6State,
} from './services/page6-service.js';
import {
  getPage7State,
  savePage7State,
} from './services/page7-service.js';
import {
  getPage8State,
  savePage8State,
} from './services/page8-service.js';
import {
  getPage9State,
  savePage9State,
} from './services/page9-service.js';
import {
  getPage11State,
  savePage11State,
} from './services/page11-service.js';
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
  clearPage4State,
  getPage4State,
  savePage4SlotState,
  savePage4State,
} from './services/page4-service.js';
import {
  createMatch,
  deleteMatch,
  deleteMatches,
  getMatchStore,
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

function snapshotPayload(paths: AppPaths): SnapshotPayload {
  const activeMatchId = getMatchStore(paths).activeMatchId;
  return {
    panels: [getPanelState(paths, 'left'), getPanelState(paths, 'right')],
    page4: getPage4State(paths),
    scoreboard: getScoreboardState(paths),
    avatars: getAvatarStates(paths, activeMatchId),
    store: getMatchStore(paths),
    stage: getStageState(paths),
    page6: getPage6State(paths),
    page7: getPage7State(paths),
    page8: getPage8State(paths),
    page9: getPage9State(paths),
    page11: getPage11State(paths),
    nextgame: getNextGamePayload(paths),
    profiles: getProfileStore(paths),
    countdown: getCountdownState(paths),
  };
}

function sendPage(paths: AppPaths, response: Response, pageFile: string): void {
  response.sendFile(path.join(paths.pagesDir, pageFile));
}

function sendAdminAntdPage(paths: AppPaths, response: Response): void {
  const builtPage = path.join(paths.rendererDistDir, 'src', 'pages', 'admin-antd.html');
  if (fs.existsSync(builtPage)) {
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
    io.emit(SOCKET_EVENTS.stageUpdate, { stage });

    const durationMs = stage.page10Duration * (stage.page10DurationUnit === 'minutes' ? 60 : 1) * 1000;
    clearWinnerStageReturnTimer();
    winnerStageReturnPage = stageBefore.page;
    winnerStageReturnTimer = setTimeout(() => {
      winnerStageReturnTimer = null;
      const current = getStageState(paths);
      // 仍停留在胜者结算画面才自动切回（期间被手动切走则不再处理）
      if (current.page === 'page10') {
        const restored = saveStageState(paths, { ...current, page: winnerStageReturnPage ?? 'page3' });
        io.emit(SOCKET_EVENTS.stageUpdate, { stage: restored });
      }
      winnerStageReturnPage = null;
    }, durationMs);
  }

  // 广播当前赛事对应的头像（活跃赛事变化时推流页等需要同步）
  const emitAvatarUpdate = (): void => {
    const matchId = getMatchStore(paths).activeMatchId;
    io.emit(SOCKET_EVENTS.avatarUpdate, { matchId, avatars: getAvatarStates(paths, matchId) });
  };

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Session & cookie middleware for auth
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
  app.use('/scripts', express.static(paths.scriptsDir));
  app.use('/styles', express.static(paths.stylesDir));
  app.use('/assets', express.static(paths.assetsDir));
  app.use('/antd-assets', express.static(path.join(paths.rendererDistDir, 'antd-assets')));
  app.use('/resources', express.static(paths.resourcesDir));
  app.use('/runtime', express.static(paths.cacheDir));

  app.use('/img', express.static(paths.spritesDir));
  app.use('/json', express.static(paths.dataDir));
  app.use('/image', express.static(path.join(paths.assetsDir, 'ui')));
  app.use('/font', express.static(path.join(paths.assetsDir, 'fonts')));

  // === Public routes (no auth required) ===
  app.get('/', (_request, response) => sendPage(paths, response, 'index.html'));
  app.get('/login.html', (_request, response) => sendLoginPage(paths, response));
  app.get('/roco-pvp-page2.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page2.html'));
  app.get('/roco-pvp-page3.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page3.html'));
  app.get('/page4.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page4.html'));
  app.get('/roco-pvp-page4.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page4.html'));
  app.get('/roco-pvp-page5.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page5.html'));
  app.get('/roco-pvp-page6.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page6.html'));
  app.get('/roco-pvp-page7.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page7.html'));
  app.get('/roco-pvp-page8.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page8.html'));
  app.get('/roco-pvp-page9.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page9.html'));
  app.get('/roco-pvp-page10.html', (_request, response) => sendPage(paths, response, 'roco-pvp-page10.html'));
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
      // bcrypt compare failed — fall through to error
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
      const isPublicPage = ['/', '/login.html', '/roco-pvp-page1.html', '/roco-pvp-page2.html', '/roco-pvp-page3.html', '/page4.html', '/roco-pvp-page4.html', '/roco-pvp-page5.html', '/roco-pvp-page6.html', '/roco-pvp-page7.html', '/roco-pvp-page8.html', '/roco-pvp-page9.html', '/roco-pvp-page10.html', '/roco-pvp-page11.html', '/float.html', '/float-menu.html', '/float-nextgame.html'].includes(req.path);
      // 推流页面仅用于展示，所需的数据 GET 接口公开（含选手头像/录入信息/仅显阵容），写操作仍受保护
      const isPublicPage5Api = req.method === 'GET' && ['/api/stage', '/api/scoreboard', '/api/stats/ranking', '/api/page4', '/api/page6', '/api/page7', '/api/page8', '/api/page9', '/api/page10', '/api/page11', '/api/panels', '/api/matches', '/api/sprites', '/api/nextgame', '/api/profiles', '/api/avatars', '/api/countdown'].includes(req.path);
      // 头像图片公开访问（含按赛事隔离的 /api/avatar/{matchId}/{side}-avatar.png），推流页无需登录
      const isPublicAvatarImage = req.method === 'GET' && req.path.startsWith('/api/avatar/');
      const isAuthApi = req.path.startsWith('/api/auth/');
      const isFavicon = req.path === '/favicon.ico';

      if (isPublicStatic || isPublicPage || isPublicPage5Api || isPublicAvatarImage || isAuthApi || isFavicon) return next();
      // Verify both authenticated flag AND single-session ID match
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
    response.json(getAvatarStates(paths, getMatchStore(paths).activeMatchId));
  });

  app.get('/api/scoreboard', (_request, response) => {
    response.json(getScoreboardState(paths));
  });

  app.get('/api/page4', (_request, response) => {
    response.json(getPage4State(paths));
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
      io.emit(SOCKET_EVENTS.stageUpdate, { stage });
      response.json({ success: true, stage });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 胜者结算画面（page10）：返回当前活跃比赛与双方头像，页面自行解析最近一个已分胜负的小局胜者
  app.get('/api/page10', (_request, response) => {
    const store = getMatchStore(paths);
    const match = store.activeMatchId
      ? store.matches.find((item) => item.id === store.activeMatchId) ?? null
      : null;
    const avatars = getAvatarStates(paths, store.activeMatchId);
    response.json({ match, avatars });
  });

  app.get('/api/page6', (_request, response) => {
    const state = getPage6State(paths);
    const matchStore = getMatchStore(paths);
    const matches = state.matchIds
      .map((id) => matchStore.matches.find((match) => match.id === id))
      .filter((match) => match && match.status === 'completed');
    response.json({ state, matches });
  });

  app.post('/api/page6', (request, response) => {
    try {
      const state = savePage6State(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.page6Update, { state });
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 对局推送（page7）：返回所选多场比赛完整数据（含每个小局阵容）与按赛事隔离的选手头像
  app.get('/api/page7', (_request, response) => {
    const state = getPage7State(paths);
    const matchStore = getMatchStore(paths);
    const matches = state.matchIds
      .map((id) => matchStore.matches.find((item) => item.id === id))
      .filter((match): match is NonNullable<typeof match> => Boolean(match));
    // 头像按赛事隔离：{ [matchId]: { left, right } }
    const avatars: Record<string, AvatarCollectionState> = {};
    for (const match of matches) {
      avatars[match.id] = getAvatarStates(paths, match.id);
    }
    response.json({ state, matches, avatars });
  });

  app.post('/api/page7', (request, response) => {
    try {
      const state = savePage7State(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.page7Update, { state });
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 比赛预告（page8）：返回所选比赛完整数据与按赛事隔离的选手头像
  app.get('/api/page8', (_request, response) => {
    const state = getPage8State(paths);
    const matchStore = getMatchStore(paths);
    const matches = state.matchIds
      .map((id) => matchStore.matches.find((match) => match.id === id))
      .filter((match): match is NonNullable<typeof match> => match != null && (match.status === 'pending' || match.status === 'in_progress'));
    // 头像按赛事隔离：{ [matchId]: { left, right } }
    const avatars: Record<string, AvatarCollectionState> = {};
    for (const match of matches) {
      avatars[match.id] = getAvatarStates(paths, match.id);
    }
    response.json({ state, matches, avatars });
  });

  app.post('/api/page8', (request, response) => {
    try {
      const state = savePage8State(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.page8Update, { state });
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 比赛预告（page8）自定义壁纸上传：魔数校验 + 1920x1080 压缩落盘
  app.post('/api/page8/wallpaper', upload.single('file'), async (request, response) => {
    if (!request.file?.buffer) {
      response.status(400).json({ success: false, error: 'No file data' });
      return;
    }
    try {
      await savePage8Wallpaper(paths, request.file.buffer);
      const state = savePage8State(paths, { background: 'custom', wallpaperUrl: '/runtime/page8-wallpaper.jpg' });
      io.emit(SOCKET_EVENTS.page8Update, { state });
      response.json({ success: true, state, wallpaperUrl: '/runtime/page8-wallpaper.jpg' });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 删除自定义壁纸：回退到内置背景图
  app.delete('/api/page8/wallpaper', (request, response) => {
    try {
      if (fs.existsSync(paths.page8WallpaperFile)) {
        fs.unlinkSync(paths.page8WallpaperFile);
      }
      const state = savePage8State(paths, { background: 'image', wallpaperUrl: '' });
      io.emit(SOCKET_EVENTS.page8Update, { state });
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
      io.emit(SOCKET_EVENTS.page9Update, { state });
      response.json({ success: true, state });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // === 选手介绍（page11-13） ===
  // 返回配置 + 信息录入 + 当前赛事（含头像）+ 实时阵容面板，页面按 mode 自行解析两侧选手
  app.get('/api/page11', (_request, response) => {
    const store = getMatchStore(paths);
    const match = store.activeMatchId
      ? store.matches.find((item) => item.id === store.activeMatchId) ?? null
      : null;
    response.json({
      state: getPage11State(paths),
      profiles: getProfileStore(paths),
      match,
      avatars: getAvatarStates(paths, store.activeMatchId),
      panels: [getPanelState(paths, 'left'), getPanelState(paths, 'right')],
      stage: getStageState(paths),
    });
  });

  app.post('/api/page11', (request, response) => {
    try {
      const state = savePage11State(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.page11Update, { state });
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
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles });
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
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles: result.profiles });
      response.json({ success: true, profiles: result.profiles, review: result.review });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/profiles/players/:playerId', (request, response) => {
    try {
      const profiles = deletePlayerProfile(paths, request.params.playerId ?? '');
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles });
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/profiles/teams', (request, response) => {
    try {
      const profiles = saveTeamProfile(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles });
      response.json({ success: true, profiles });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/profiles/teams/:teamId', (request, response) => {
    try {
      const profiles = deleteTeamProfile(paths, request.params.teamId ?? '');
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles });
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
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles });
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
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles: result.profiles });
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
      io.emit(SOCKET_EVENTS.profilesUpdate, { profiles });
      response.json({ success: true, profiles });
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
      io.emit(SOCKET_EVENTS.nextgameUpdate, next);
      return;
    }
    nextgameTimer = setTimeout(() => {
      const next = hideNextGame(paths);
      io.emit(SOCKET_EVENTS.nextgameUpdate, next);
    }, remaining);
  }
  scheduleNextGameAutoHide();

  app.post('/api/nextgame', (request, response) => {
    try {
      const payload = saveNextGameState(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.nextgameUpdate, payload);
      scheduleNextGameAutoHide();
      response.json({ success: true, ...payload });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/nextgame/show', (request, response) => {
    try {
      const payload = showNextGame(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.nextgameUpdate, payload);
      scheduleNextGameAutoHide();
      response.json({ success: true, ...payload });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/nextgame/hide', (_request, response) => {
    try {
      const payload = hideNextGame(paths);
      io.emit(SOCKET_EVENTS.nextgameUpdate, payload);
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
      io.emit(SOCKET_EVENTS.countdownUpdate, { state: next, serverNow: Date.now() });
      return;
    }
    countdownZeroTimer = setTimeout(() => {
      const next = getCountdownState(paths);
      io.emit(SOCKET_EVENTS.countdownUpdate, { state: next, serverNow: Date.now() });
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
      io.emit(SOCKET_EVENTS.countdownUpdate, { state, serverNow: Date.now() });
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
      io.emit(SOCKET_EVENTS.countdownUpdate, { state, serverNow: Date.now() });
      scheduleCountdownZero();
      response.json({ success: true, state, serverNow: Date.now() });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches', (request, response) => {
    try {
      const matches = createMatch(paths, request.body ?? {});
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      emitAvatarUpdate();
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch('/api/matches/:matchId', (request, response) => {
    try {
      const matches = updateMatch(paths, request.params.matchId, request.body ?? {});
      const scoreboard = getScoreboardState(paths);
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      response.json({ success: true, store: matches, scoreboard });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch('/api/matches/:matchId/tags', (request, response) => {
    try {
      const matches = updateMatchTags(paths, request.params.matchId, request.body ?? {});
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      response.json({ success: true, store: matches });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/batch-tags', (request, response) => {
    try {
      const body = (request.body ?? {}) as { matchIds?: unknown; tags?: unknown };
      const matches = updateMatchesTags(paths, body.matchIds, { tags: body.tags });
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      response.json({ success: true, store: matches });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/matches/:matchId', (_request, response) => {
    try {
      const matches = deleteMatch(paths, _request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      emitAvatarUpdate();
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/batch-delete', (request, response) => {
    try {
      const matches = deleteMatches(paths, request.body?.matchIds ?? []);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      emitAvatarUpdate();
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/undo-delete', (_request, response) => {
    try {
      const matches = undoDeletedMatches(paths);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      emitAvatarUpdate();
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
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
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      emitAvatarUpdate();
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/:matchId/winner', (request, response) => {
    try {
      const winner = request.body?.winner;
      if (winner !== 'left' && winner !== 'right') {
        throw new Error('winner must be left or right');
      }
      const matches = recordMatchWinner(paths, request.params.matchId, winner);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
      // 登记本局胜负：当前画面是推流页面1-3 时自动切入胜者结算画面（page10）
      triggerWinnerStage();
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/:matchId/start', (request, response) => {
    try {
      const matches = startCurrentGame(paths, request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 比赛历史「录入阵容」：只写指定赛事当前小局（待开始）的双方阵容记录，一次写入
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
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      response.json({ success: true, store: matches });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/matches/:matchId/undo', (_request, response) => {
    try {
      const matches = undoMatchAction(paths, _request.params.matchId);
      const scoreboard = getScoreboardState(paths);
      const panels = [getPanelState(paths, 'left'), getPanelState(paths, 'right')];
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      emitAvatarUpdate();
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
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
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
      emitAvatarUpdate();
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      panels.forEach((panel) => io.emit(SOCKET_EVENTS.panelUpdate, { panel }));
      response.json({ success: true, store: matches, scoreboard, panels });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/scoreboard', (request, response) => {
    try {
      const scoreboard = saveScoreboardState(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      response.json({ success: true, scoreboard });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/scoreboard/best-of', (request, response) => {
    try {
      const scoreboard = saveScoreboardBestOf(paths, request.body ?? {});
      io.emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard });
      response.json({ success: true, scoreboard });
    } catch (error) {
      response.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/page4/:position', (request, response) => {
    const position = request.params.position;
    if (position !== 'left' && position !== 'right') {
      response.status(404).json({ success: false, error: 'Invalid position' });
      return;
    }

    try {
      savePage4State(paths, position, request.body?.selected ?? []);
      const page4 = getPage4State(paths);
      io.emit(SOCKET_EVENTS.page4Update, { page4 });
      response.json({ success: true, page4 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(message.startsWith('Sprite not found') ? 404 : 400).json({ success: false, error: message });
    }
  });

  app.patch('/api/page4/:position/slots/:slot', (request, response) => {
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
      savePage4SlotState(paths, position, slotIndex, request.body?.slot ?? null);
      const page4 = getPage4State(paths);
      io.emit(SOCKET_EVENTS.page4Update, { page4 });
      response.json({ success: true, page4 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(message.startsWith('Sprite not found') ? 404 : 400).json({ success: false, error: message });
    }
  });

  app.delete('/api/page4/:position', (request, response) => {
    const position = request.params.position;
    if (position !== 'left' && position !== 'right') {
      response.status(404).json({ success: false, error: 'Invalid position' });
      return;
    }

    try {
      clearPage4State(paths, position);
      const page4 = getPage4State(paths);
      io.emit(SOCKET_EVENTS.page4Update, { page4 });
      response.json({ success: true, page4 });
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
    response.json(getSpriteRanking(paths, { player: player || null, tag: tag || null }));
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
        io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
        response.json({ success: true, store: matches });
        return;
      }

      if (activeMatch && activeGame?.status === 'in_progress') {
        const panel = savePanelState(paths, position, request.body?.selected ?? []);
        const matches = saveDraftPanelStateForActiveMatch(paths, position, request.body?.selected ?? []);
        io.emit(SOCKET_EVENTS.panelUpdate, { panel });
        io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
        response.json({ success: true, panel, matches });
        return;
      }

      const panel = savePanelState(paths, position, request.body?.selected ?? []);
      const matches = syncActiveMatchLineupsFromPanels(paths);
      io.emit(SOCKET_EVENTS.panelUpdate, { panel });
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
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
        io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
        response.json({ success: true, store: matches });
        return;
      }

      if (activeMatch && activeGame?.status === 'in_progress') {
        const panel = savePanelSlotState(paths, position, slotIndex, request.body?.slot ?? null);
        const matches = saveDraftPanelSlotStateForActiveMatch(paths, position, slotIndex, request.body?.slot ?? null);
        io.emit(SOCKET_EVENTS.panelUpdate, { panel });
        io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
        response.json({ success: true, panel, matches });
        return;
      }

      const panel = savePanelSlotState(paths, position, slotIndex, request.body?.slot ?? null);
      const matches = syncActiveMatchLineupsFromPanels(paths);
      io.emit(SOCKET_EVENTS.panelUpdate, { panel });
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
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
        io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
        response.json({ success: true, position, matches });
        return;
      }

      if (activeMatch && activeGame?.status === 'in_progress') {
        clearPanelState(paths, position);
        const panel = getPanelState(paths, position);
        const matches = saveDraftPanelStateForActiveMatch(paths, position, []);
        io.emit(SOCKET_EVENTS.panelUpdate, { panel });
        io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
        response.json({ success: true, position, panel, matches });
        return;
      }

      clearPanelState(paths, position);
      const panel = getPanelState(paths, position);
      const matches = syncActiveMatchLineupsFromPanels(paths);
      io.emit(SOCKET_EVENTS.panelUpdate, { panel });
      io.emit(SOCKET_EVENTS.matchesUpdate, { store: matches });
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
      io.emit(SOCKET_EVENTS.avatarUpdate, { matchId, avatar, avatars: getAvatarStates(paths, matchId) });
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
    io.emit(SOCKET_EVENTS.avatarUpdate, { matchId, side, avatar, avatars: getAvatarStates(paths, matchId) });
    response.json({ success: true, side, matchId, avatar });
  });

  app.get('/api/runtime-config', (_request, response) => {
    response.json(loadRuntimeConfig(paths));
  });

  app.post('/api/runtime-config', (request, response) => {
    const config = saveRuntimeConfig(paths, {
      port: Number(request.body?.port),
    });
    response.json({ success: true, config });
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
    socket.emit(SOCKET_EVENTS.snapshot, snapshotPayload(paths));
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
      if (nextgameTimer) {
        clearTimeout(nextgameTimer);
        nextgameTimer = null;
      }
      if (countdownZeroTimer) {
        clearTimeout(countdownZeroTimer);
        countdownZeroTimer = null;
      }
      await new Promise<void>((resolve, reject) => {
        io.close(() => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}
