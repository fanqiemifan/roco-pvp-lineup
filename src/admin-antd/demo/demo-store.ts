/**
 * 管理后台「模拟会话」内核 —— 让后台界面跑在**假数据**上（新手引导 / 卡片帮助用）。
 *
 * 设计取舍：
 * 1. **不手搓 UI，复用真实组件**：引导要讲的是"回退上一波""右键卡片菜单""登记胜负"这类复合流程，
 *    手写 DOM 复刻等于把后台抄一遍、UI 一改就失真。这里改为把后台自己的 bundle 跑在 iframe 里，
 *    只在最外圈把**网络层**换掉 —— 真实组件 + 真实交互 + 假数据。
 * 2. **默认拒绝一切真实请求**：`fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` 全部被接管，
 *    只走内存 store；socket.io 由 Vite 插件换成假连接（见 demo-kernel 的 io 拦截）。
 *    这样即使某个新接口没在路由表里，也只会拿到通用兜底响应，**不可能把按键打到真机上**。
 * 3. 模拟会话**不写任何运行时文件**（`runtime/cache/` 一个字节都不碰），只活在这个页面的内存里，
 *    刷新即回到初始假数据；顶部横幅 + 「重置模拟数据」按钮是给使用者的唯一出口。
 */

import type { CountdownPayload, MatchRecord, MatchStoreState, MvpState, MvpWinnerInfo, NextGamePayload, Page11State, Page14State, Page6State, Page7State, Page8State, Page9State, PanelState, PlayerProfile, ProfileStoreState, ScoreboardState, StageConfig, StageStandings, TournamentRecord } from '../../../shared/types';
import { SOCKET_EVENTS } from '../../../shared/events';
import { seedDemoSprites, seedDemoState } from './demo-fixtures';

/** 模拟会话的状态包：与真机 `cache/` 里的那几份文件一一对应 */
export interface DemoStoreState {
  scoreboard: ScoreboardState;
  matches: MatchStoreState;
  panels: [PanelState, PanelState];
  tournaments: TournamentRecord[];
  locallyRemoved: TournamentRecord[];
  profiles: ProfileStoreState;
  stage: StageConfig;
  page6: Page6State;
  page7: Page7State;
  page8: Page8State;
  page9: Page9State;
  page11: Page11State;
  page14: Page14State;
  page14Standings: StageStandings | null;
  nextgame: NextGameStateLike;
  countdown: CountdownStateLike;
  mvp: MvpState;
  mvpWinnerName: string;
  machineCode: string;
}

type NextGameStateLike = NextGamePayload['state'];
type CountdownStateLike = CountdownPayload['state'];

/** 假 socket 的最小形状（socket.io-client 的 `Socket` 子集，够后台用） */
interface DemoSocket {
  on(event: string, handler: (payload?: unknown) => void): DemoSocket;
  off(event: string, handler?: (payload?: unknown) => void): DemoSocket;
  emit(event: string, payload?: unknown): DemoSocket;
  disconnect(): DemoSocket;
  connect(): DemoSocket;
  close(): DemoSocket;
  connected: boolean;
  id: string;
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** 极小的 CORS 头：模拟会话与真机后台同源，但显式带上更接近真实响应 */
const JSON_HEADERS = { 'content-type': 'application/json' };

/** 深拷贝（structuredClone 在旧内核/分页里可能缺失，退到 JSON） */
function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // 含不可克隆对象时退回 JSON
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 记分牌跟随比赛：真机由服务端的 syncScoreboardFromMatch 收口，
 * 模拟会话只做界面可见的那部分（名字 / 比分 / 赛制 / 排名），阵容与开关保持不动。
 */
function scoreboardFromMatch(scoreboard: ScoreboardState, match: MatchRecord | null | undefined): ScoreboardState {
  if (!match) {
    return scoreboard;
  }
  return {
    ...scoreboard,
    leftName: match.leftPlayer || scoreboard.leftName,
    rightName: match.rightPlayer || scoreboard.rightName,
    leftScore: String(match.leftScore),
    rightScore: String(match.rightScore),
    leftRank: match.leftRank || scoreboard.leftRank,
    rightRank: match.rightRank || scoreboard.rightRank,
    bestOf: match.bestOf,
    mtime: Date.now(),
  };
}

/**
 * 创建模拟 store：所有读接口返回这里的快照，所有写接口只改这里。
 * 返回的 `routes` 供 fetch / XHR 拦截层按「方法 + 路径」查表。
 */
export function createDemoStore() {
  const initial = seedDemoState();
  let state: DemoStoreState = clone(initial);
  const socketHandlers = new Set<(event: string, payload?: unknown) => void>();

  /** 每次状态变化后广播（模拟服务端 emit），保证界面与"服务端"一致 */
  function emitAll(): void {
    socketHandlers.forEach((handler) => {
      handler(SOCKET_EVENTS.matchesUpdate, { store: clone(state.matches), scoreboard: clone(state.scoreboard) });
      handler(SOCKET_EVENTS.panelUpdate, { panel: clone(state.panels[0]) });
      handler(SOCKET_EVENTS.panelUpdate, { panel: clone(state.panels[1]) });
    });
  }

  function emit(event: string, payload?: unknown): void {
    socketHandlers.forEach((handler) => handler(event, payload));
  }

  function findMatch(matchId: string): MatchRecord | undefined {
    return state.matches.matches.find((match) => match.id === matchId);
  }

  function findTournament(tournamentId: string): TournamentRecord | undefined {
    return state.tournaments.find((record) => record.id === tournamentId);
  }

  /** 当前比赛的小局状态/比分/记分牌三者保持一致（与真机写后的收口同口径） */
  function afterMatchWrite(match: MatchRecord): void {
    state.scoreboard = scoreboardFromMatch(state.scoreboard, match);
    if (state.matches.activeMatchId === match.id) {
      // 当前比赛的小局面板跟随（简化：只同步姓名/比分，阵容由面板接口维护）
      state.panels = syncPanelsFromMatch(state.panels);
    }
    state.matches.mtime = Date.now();
    emitAll();
  }

  /** 面板里的槽位快照跟着比赛当前小局走（真机在 select/开局时也会重算） */
  function syncPanelsFromMatch(panels: [PanelState, PanelState]): [PanelState, PanelState] {
    const active = state.matches.matches.find((match) => match.id === state.matches.activeMatchId);
    if (!active) {
      return panels;
    }
    const game = active.games.find((item) => item.gameNumber === Math.min(active.games.length, Math.max(1, active.leftScore + active.rightScore + 1)))
      ?? active.games[0];
    if (!game) {
      return panels;
    }
    return [
      { ...panels[0], selected: game.leftSlots.map((slot) => ({ ...slot, sprite: null, effectiveOpacity: 1 })) },
      { ...panels[1], selected: game.rightSlots.map((slot) => ({ ...slot, sprite: null, effectiveOpacity: 1 })) },
    ] as [PanelState, PanelState];
  }

  /** 重置到初始假数据（横幅上的「重置模拟数据」按钮） */
  function reset(): void {
    state = clone(initial);
    emitAll();
  }

  /* ==================== 假 socket ==================== */

  function createSocket(): DemoSocket {
    const listeners = new Map<string, Set<(payload?: unknown) => void>>();
    const socket: DemoSocket = {
      connected: true,
      id: `demo-${Math.random().toString(36).slice(2, 10)}`,
      on(event, handler) {
        const set = listeners.get(event) ?? new Set();
        set.add(handler);
        listeners.set(event, set);
        return socket;
      },
      off(event, handler) {
        if (handler) {
          listeners.get(event)?.delete(handler);
        } else {
          listeners.delete(event);
        }
        return socket;
      },
      emit(event, payload) {
        // 客户端 → 服务端的 emit：模拟会话里只回显，不做任何处理（后台不靠它拉数据）
        if (event === 'join' || event === 'leave') {
          return socket;
        }
        listeners.get(event)?.forEach((handler) => handler(payload));
        return socket;
      },
      disconnect() {
        socket.connected = false;
        return socket;
      },
      connect() {
        socket.connected = true;
        return socket;
      },
      close() {
        socket.connected = false;
        return socket;
      },
    };

    // 注册到全局广播表：store 一变，所有假 socket 都收到（等价于服务端 emit）
    socketHandlers.add((event, payload) => {
      listeners.get(event)?.forEach((handler) => handler(payload));
    });

    // 连接后补一次快照（与真机 io 连接后服务端推 snapshot 的行为一致）
    window.setTimeout(() => {
      listeners.get(SOCKET_EVENTS.snapshot)?.forEach((handler) => handler(buildSnapshot()));
    }, 0);

    return socket;
  }

  /** 快照载荷：字段口径与真机 socket-server 推的 snapshot 一致 */
  function buildSnapshot() {
    const active = state.matches.matches.find((match) => match.id === state.matches.activeMatchId) ?? null;
    return {
      scoreboard: clone(state.scoreboard),
      store: clone(state.matches),
      avatars: { left: { side: 'left', exists: false }, right: { side: 'right', exists: false } },
      panels: clone(state.panels),
      stage: clone(state.stage),
      page6: clone(state.page6),
      page7: clone(state.page7),
      page8: clone(state.page8),
      page9: clone(state.page9),
      page11: clone(state.page11),
      page14: clone(state.page14),
      nextgame: { state: clone(state.nextgame), match: clone(active), avatars: { left: { side: 'left', exists: false }, right: { side: 'right', exists: false } } },
      profiles: clone(state.profiles),
      tournaments: clone(state.tournaments),
      locallyRemoved: clone(state.locallyRemoved),
      countdown: { state: clone(state.countdown), serverNow: Date.now() },
      mvp: clone(state.mvp),
    };
  }

  /* ==================== 路由 ==================== */
  // 路由表只覆盖"引导里会点到的动作"；其余一律走通用兜底（返回 success + 当前快照），
  // 绝不穿透到真实网络。

  function jsonBody(init?: RequestInit): Record<string, unknown> {
    if (!init?.body || typeof init.body !== 'string') {
      return {};
    }
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  function ok(payload: Record<string, unknown> = {}): FetchLikeResponse {
    return makeResponse(200, { success: true, ...payload });
  }

  function makeResponse(status: number, payload: unknown): FetchLikeResponse {
    // 真的 Response 对象：调用方（fetch 拦截层 / XHR 拦截层）都能直接拿到 json()/text()
    return new Response(JSON.stringify(payload), {
      status,
      headers: JSON_HEADERS,
    }) as unknown as FetchLikeResponse;
  }

  /** 处理一次模拟请求；返回 null 表示"不是 API 请求"（调用方按原样放行，用于静态资源） */
  function handle(method: string, rawUrl: string, init?: RequestInit): FetchLikeResponse | null {
    const url = new URL(rawUrl, window.location.origin);
    const path = url.pathname;
    if (!path.startsWith('/api/')) {
      return null;
    }
    const body = jsonBody(init);
    const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);
    const [first, second, third, fourth, fifth] = segments;

    // ---- 鉴权 / 运行时 ----
    if (path === '/api/auth/check') {
      return ok({ authenticated: true });
    }
    if (path === '/api/runtime-config') {
      return makeResponse(200, {
        port: 9988,
        machineCode: state.machineCode,
        // 不返回 syncConfig：模拟会话里不展示云同步状态卡（避免误导成"真连上了云端"）
      });
    }

    // ---- 只读快照 ----
    if (method === 'GET' && path === '/api/scoreboard') {
      return makeResponse(200, clone(state.scoreboard));
    }
    if (method === 'GET' && path === '/api/matches') {
      return makeResponse(200, clone(state.matches));
    }
    if (method === 'GET' && path === '/api/panels') {
      return makeResponse(200, { panels: clone(state.panels) });
    }
    if (method === 'GET' && path === '/api/stage') {
      return makeResponse(200, clone(state.stage));
    }
    if (method === 'GET' && path === '/api/tournaments') {
      return makeResponse(200, { tournaments: clone(state.tournaments) });
    }
    if (method === 'GET' && path === '/api/tournaments/local-removed') {
      return makeResponse(200, { tournaments: clone(state.locallyRemoved) });
    }
    if (method === 'GET' && path === '/api/profiles') {
      return makeResponse(200, clone(state.profiles));
    }
    if (method === 'GET' && path === '/api/avatars') {
      return makeResponse(200, { left: { side: 'left', exists: false }, right: { side: 'right', exists: false } });
    }
    if (method === 'GET' && path === '/api/page6') {
      return makeResponse(200, { state: clone(state.page6) });
    }
    if (method === 'GET' && path === '/api/page7') {
      return makeResponse(200, { state: clone(state.page7) });
    }
    if (method === 'GET' && path === '/api/page8') {
      return makeResponse(200, { state: clone(state.page8) });
    }
    if (method === 'GET' && path === '/api/page9') {
      return makeResponse(200, { state: clone(state.page9) });
    }
    if (method === 'GET' && path === '/api/page11') {
      return makeResponse(200, { state: clone(state.page11) });
    }
    if (method === 'GET' && path === '/api/page14') {
      return makeResponse(200, { state: clone(state.page14), standings: clone(state.page14Standings) });
    }
    if (method === 'GET' && path === '/api/mvp') {
      return makeResponse(200, { state: clone(state.mvp), winner: demoWinnerInfo() });
    }
    if (method === 'GET' && path === '/api/nextgame') {
      return makeResponse(200, {
        state: clone(state.nextgame),
        match: clone(state.matches.matches.find((match) => match.id === state.nextgame.matchId) ?? null),
        avatars: { left: { side: 'left', exists: false }, right: { side: 'right', exists: false } },
      });
    }
    if (method === 'GET' && path === '/api/countdown') {
      return makeResponse(200, { state: clone(state.countdown), serverNow: Date.now() });
    }
    if (method === 'GET' && path === '/api/sprites') {
      // 精灵库：给引导里会出现的那几只（名字 / 图标地址够用）
      return makeResponse(200, { sprites: seedDemoSprites() });
    }

    // ---- 比赛写入 ----
    if (first === 'matches' && second === 'batch-delete' && method === 'POST') {
      const ids = new Set((body.matchIds as string[]) ?? []);
      state.matches.matches = state.matches.matches.filter((match) => !ids.has(match.id));
      state.matches.undo.canUndoDelete = true;
      state.matches.undo.deleteUndoCount += ids.size;
      emitAll();
      return ok({ store: clone(state.matches) });
    }
    if (first === 'matches' && second === 'undo-delete') {
      state.matches.undo.canUndoDelete = false;
      state.matches.undo.deleteUndoCount = 0;
      emitAll();
      return ok({ store: clone(state.matches) });
    }
    if (first === 'matches' && second === 'batch-tags') {
      const ids = new Set((body.matchIds as string[]) ?? []);
      const tags = (body.tags as string[]) ?? [];
      state.matches.matches = state.matches.matches.map((match) => (ids.has(match.id) ? { ...match, tags, updatedAt: nowIso() } : match));
      emitAll();
      return ok({ store: clone(state.matches) });
    }
    if (first === 'matches' && method === 'POST' && !second) {
      // 新建比赛（开一局 / 快速创建）：分配 demo id，写进 store
      const id = `20260928_A${String(state.matches.matches.length + 1).padStart(3, '0')}`;
      const bestOf = Number(body.bestOf) || 3;
      const match: MatchRecord = {
        id,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: 'pending',
        leftPlayer: String(body.leftPlayer ?? '左侧选手'),
        rightPlayer: String(body.rightPlayer ?? '右侧选手'),
        leftRank: String(body.leftRank ?? ''),
        rightRank: String(body.rightRank ?? ''),
        leftTeamId: '', leftTeamName: '', rightTeamId: '', rightTeamName: '',
        bestOf,
        games: Array.from({ length: Math.ceil(bestOf / 2) + 1 }, (_, index) => ({
          gameNumber: index + 1,
          leftLineup: [], rightLineup: [], leftSlots: emptySlots(), rightSlots: emptySlots(),
          winner: null as 'left' | 'right' | null,
          status: 'pending' as const,
        })),
        leftScore: 0, rightScore: 0, winner: null, completedAt: null,
        tags: (body.tags as string[]) ?? [],
      };
      state.matches.matches.unshift(match);
      emitAll();
      return ok({ store: clone(state.matches), scoreboard: clone(state.scoreboard) });
    }
    if (first === 'matches' && second && third === 'select') {
      state.matches.activeMatchId = second;
      state.scoreboard = scoreboardFromMatch(state.scoreboard, findMatch(second));
      state.panels = syncPanelsFromMatch(state.panels);
      emitAll();
      return ok({ store: clone(state.matches), scoreboard: clone(state.scoreboard), panels: clone(state.panels) });
    }
    if (first === 'matches' && second && third === 'tags' && method === 'PATCH') {
      const match = findMatch(second);
      if (match) {
        match.tags = (body.tags as string[]) ?? [];
        match.updatedAt = nowIso();
      }
      emitAll();
      return ok({ store: clone(state.matches) });
    }
    if (first === 'matches' && second && third === 'start') {
      const match = findMatch(second);
      if (match) {
        match.status = 'in_progress';
        const game = match.games[Math.max(0, match.leftScore + match.rightScore)];
        if (game) {
          game.status = 'in_progress';
        }
        match.updatedAt = nowIso();
      }
      if (match) {
        afterMatchWrite(match);
      }
      return ok({ store: clone(state.matches), scoreboard: clone(state.scoreboard), panels: clone(state.panels) });
    }
    if (first === 'matches' && second && (third === 'games') && fifth === 'lineup' && method === 'POST') {
      // 录入阵容：/api/matches/:id/games/:n/lineup
      const match = findMatch(second);
      const gameNumber = Number(fourth);
      const game = match?.games.find((item) => item.gameNumber === gameNumber);
      if (match && game) {
        const left = (body.left as string[]) ?? [];
        const right = (body.right as string[]) ?? [];
        game.leftLineup = left;
        game.rightLineup = right;
        game.leftSlots = left.map((petId, index) => slotSnapshot(index, petId));
        game.rightSlots = right.map((petId, index) => slotSnapshot(index, petId));
        match.updatedAt = nowIso();
      }
      emitAll();
      return ok({ store: clone(state.matches) });
    }
    if (first === 'matches' && second && third === 'undo' && method === 'POST') {
      // 撤回上一步：把最后一个小局的胜负回退（模拟会话里够用）
      const match = findMatch(second);
      if (match) {
        const played = [...match.games].reverse().find((game) => game.winner !== null);
        if (played) {
          if (played.winner === 'left') {
            match.leftScore = Math.max(0, match.leftScore - 1);
          } else if (played.winner === 'right') {
            match.rightScore = Math.max(0, match.rightScore - 1);
          }
          played.winner = null;
          played.status = 'pending';
          match.status = match.leftScore + match.rightScore === 0 ? 'pending' : 'in_progress';
          match.winner = null;
          match.completedAt = null;
          match.updatedAt = nowIso();
          state.matches.undo.canRedo = true;
          state.matches.undo.canUndo = false;
        }
      }
      if (match) {
        afterMatchWrite(match);
      }
      return ok({ store: clone(state.matches), scoreboard: clone(state.scoreboard) });
    }
    if (first === 'matches' && second && third === 'redo' && method === 'POST') {
      state.matches.undo.canRedo = false;
      emitAll();
      return ok({ store: clone(state.matches) });
    }
    if (first === 'matches' && second && (third === 'winner' || third === 'games') && method === 'POST' && path.endsWith('/winner')) {
      // 登记本局胜负（headless 登记也走这里）。
      // 注意：UI 点「左侧赢了」时**不带 gameNumber**，所以要落到"当前进行中 / 第一个未打"的小局，
      // 不能默认第 1 局——否则 BO3 打到第 2 局时会把已经打完的第 1 局再登记一次、比分不动（踩过）。
      const match = findMatch(second);
      const winner = body.winner === 'right' ? 'right' : 'left';
      const requestedGame = Number(body.gameNumber ?? body.games);
      const game = match?.games.find((item) => item.gameNumber === requestedGame)
        ?? match?.games.find((item) => item.status === 'in_progress')
        ?? match?.games.find((item) => item.winner === null);
      const gameNumber = game?.gameNumber ?? 1;
      if (match && game) {
        if (game.winner === null || game.winner !== winner) {
          game.winner = winner;
          game.status = 'completed';
          if (winner === 'left') {
            match.leftScore += 1;
          } else {
            match.rightScore += 1;
          }
        }
        const need = Math.ceil(match.bestOf / 2);
        if (match.leftScore >= need || match.rightScore >= need) {
          match.status = 'completed';
          match.winner = match.leftScore > match.rightScore ? 'left' : 'right';
          match.completedAt = nowIso();
        } else {
          match.status = 'in_progress';
          const nextGame = match.games.find((item) => item.winner === null);
          if (nextGame) {
            nextGame.status = 'in_progress';
          }
        }
        match.updatedAt = nowIso();
        state.matches.undo.canUndo = true;
        // 系列赛写回：节点胜者 + 波次完成（真机走 tournament-service，这里只做界面可见的等价效果）
        applyTournamentWriteBack(match, winner);
      }
      if (match) {
        afterMatchWrite(match);
      }
      return ok({ store: clone(state.matches), scoreboard: clone(state.scoreboard) });
    }
    if (first === 'matches' && second && method === 'PATCH') {
      const match = findMatch(second);
      if (match) {
        Object.assign(match, {
          leftPlayer: body.leftPlayer ?? match.leftPlayer,
          rightPlayer: body.rightPlayer ?? match.rightPlayer,
          leftRank: body.leftRank ?? match.leftRank,
          rightRank: body.rightRank ?? match.rightRank,
          leftTeamName: body.leftTeamName ?? match.leftTeamName,
          rightTeamName: body.rightTeamName ?? match.rightTeamName,
          bestOf: body.bestOf ? Number(body.bestOf) : match.bestOf,
          updatedAt: nowIso(),
        });
      }
      if (match) {
        afterMatchWrite(match);
      }
      return ok({ store: clone(state.matches), scoreboard: clone(state.scoreboard) });
    }
    if (first === 'matches' && second && method === 'DELETE') {
      state.matches.matches = state.matches.matches.filter((match) => match.id !== second);
      state.matches.undo.canUndoDelete = true;
      state.matches.undo.deleteUndoCount += 1;
      emitAll();
      return ok({ store: clone(state.matches) });
    }

    // ---- 系列赛：回退上一波 / 抽签 / 开赛 ----
    if (first === 'tournaments' && second && third === 'rollback-wave' && method === 'POST') {
      const record = findTournament(second);
      if (record && record.waves.length > 0) {
        const removed = record.waves.pop();
        const removedMatchIds = new Set((removed?.nodes ?? []).map((node) => node.matchId).filter(Boolean) as string[]);
        state.matches.matches = state.matches.matches.filter((match) => !removedMatchIds.has(match.id));
        record.updatedAt = nowIso();
        emit(/* 编排变更 */ SOCKET_EVENTS.tournamentUpdate, { tournaments: clone(state.tournaments) });
        emitAll();
      }
      return ok({ tournaments: clone(state.tournaments), store: clone(state.matches) });
    }
    if (first === 'tournaments' && second && (third === 'draw' || third === 'start') && method === 'POST') {
      const record = findTournament(second);
      if (record) {
        record.drawVersion += 1;
        record.updatedAt = nowIso();
        emit(SOCKET_EVENTS.tournamentUpdate, { tournaments: clone(state.tournaments) });
      }
      return ok({ tournaments: clone(state.tournaments) });
    }
    if (first === 'tournaments' && second && third === 'local-remove' && method === 'POST') {
      const index = state.tournaments.findIndex((record) => record.id === second);
      if (index >= 0) {
        const [record] = state.tournaments.splice(index, 1);
        if (record) {
          state.locallyRemoved.push({ ...record, localOnly: true });
        }
      }
      emit(SOCKET_EVENTS.tournamentUpdate, { tournaments: clone(state.tournaments) });
      return ok({ tournaments: clone(state.tournaments) });
    }
    if (first === 'tournaments' && second && third === 'local-restore' && method === 'POST') {
      const index = state.locallyRemoved.findIndex((record) => record.id === second);
      if (index >= 0) {
        const [record] = state.locallyRemoved.splice(index, 1);
        if (record) {
          delete record.localOnly;
          state.tournaments.push(record);
        }
      }
      emit(SOCKET_EVENTS.tournamentUpdate, { tournaments: clone(state.tournaments) });
      return ok({ tournaments: clone(state.tournaments) });
    }
    if (first === 'tournaments' && second && method === 'DELETE') {
      state.tournaments = state.tournaments.filter((record) => record.id !== second);
      emit(SOCKET_EVENTS.tournamentUpdate, { tournaments: clone(state.tournaments) });
      return ok({ tournaments: clone(state.tournaments) });
    }

    // ---- 面板（阵容编辑自动保存） ----
    if (first === 'panels' && (second === 'left' || second === 'right') && method === 'POST') {
      const position = second === 'left' ? 0 : 1;
      const selected = (body.selected as PanelState['selected']) ?? state.panels[position].selected;
      state.panels[position] = { ...state.panels[position], selected: clone(selected), mtime: Date.now() };
      emit(SOCKET_EVENTS.panelUpdate, { panel: clone(state.panels[position]) });
      return ok({ panel: clone(state.panels[position]), store: clone(state.matches) });
    }
    if (first === 'panels' && (second === 'left' || second === 'right') && third === 'slots' && method === 'PATCH') {
      const position = second === 'left' ? 0 : 1;
      const slotIndex = Number(fourth);
      const panel = state.panels[position];
      const slot = panel.selected[slotIndex];
      if (slot) {
        Object.assign(slot, body.slot ?? {});
        panel.mtime = Date.now();
      }
      emit(SOCKET_EVENTS.panelUpdate, { panel: clone(panel) });
      return ok({ panel: clone(panel) });
    }

    // ---- 档案 ----
    if (first === 'profiles' && method === 'POST') {
      // 选手档案：pets 是自由文本（与真机 PlayerProfile 同口径），头像一律不存在
      const player: PlayerProfile = {
        id: String(body.id ?? `p${Math.random().toString(36).slice(2, 8)}`),
        name: String(body.name ?? '新选手'),
        pets: String(body.pets ?? ''),
        rank: String(body.rank ?? ''),
        declaration: String(body.declaration ?? ''),
        avatarExists: false,
        avatarMtime: null,
      };
      state.profiles = { ...state.profiles, players: [...state.profiles.players, player] };
      return ok({ profiles: clone(state.profiles) });
    }
    if (first === 'profiles' && method === 'PATCH') {
      return ok({ profiles: clone(state.profiles) });
    }
    if (first === 'profiles' && method === 'DELETE') {
      const parts = segments.slice(1);
      const kind = parts[0];
      const id = parts[1];
      if (kind === 'players' && id) {
        state.profiles = { ...state.profiles, players: state.profiles.players.filter((item) => item.id !== id) };
      } else if (kind === 'teams' && id) {
        state.profiles = { ...state.profiles, teams: state.profiles.teams.filter((item) => item.id !== id) };
      }
      return ok({ profiles: clone(state.profiles) });
    }

    // ---- 记分牌 / 阶段 / 各页面状态：写接口只回显入参（界面即时生效） ----
    if (path === '/api/scoreboard' && method === 'POST') {
      state.scoreboard = { ...state.scoreboard, ...(body as Partial<ScoreboardState>) };
      emit(SOCKET_EVENTS.scoreboardUpdate, { scoreboard: clone(state.scoreboard) });
      return ok({ scoreboard: clone(state.scoreboard) });
    }
    if (path === '/api/stage' && method === 'POST') {
      state.stage = { ...state.stage, ...(body as Partial<StageConfig>) };
      emit(SOCKET_EVENTS.stageUpdate, { stage: clone(state.stage) });
      return ok({ stage: clone(state.stage) });
    }
    if (/^\/api\/page(6|7|8|9|11|14)$/.test(path) && method === 'POST') {
      const key = path.replace('/api/', '') as 'page6' | 'page7' | 'page8' | 'page9' | 'page11' | 'page14';
      state[key] = { ...(state[key] as object), ...(body as object) } as never;
      emit(SOCKET_EVENTS.page6Update, { state: clone(state.page6) });
      return ok({ state: clone(state[key]), standings: clone(state.page14Standings) });
    }
    if (path === '/api/mvp/show' || path === '/api/mvp/hide') {
      state.stage = { ...state.stage, page: path.endsWith('show') ? 'page4' : state.stage.page };
      emit(SOCKET_EVENTS.stageUpdate, { stage: clone(state.stage) });
      return ok({ state: clone(state.mvp), stage: clone(state.stage) });
    }
    if (path === '/api/mvp' && method === 'POST') {
      state.mvp = { ...state.mvp, ...(body as Partial<MvpState>) };
      emit(SOCKET_EVENTS.mvpUpdate, { state: clone(state.mvp), winner: demoWinnerInfo() });
      return ok({ state: clone(state.mvp) });
    }
    if (path === '/api/countdown' || path.startsWith('/api/countdown/')) {
      state.countdown = { ...state.countdown, ...(body as Partial<CountdownStateLike>) };
      emit(SOCKET_EVENTS.countdownUpdate, { state: clone(state.countdown), serverNow: Date.now() });
      return ok({ state: clone(state.countdown), serverNow: Date.now() });
    }
    if (path.startsWith('/api/nextgame')) {
      state.nextgame = { ...state.nextgame, ...(body as Partial<NextGameStateLike>) };
      emit(SOCKET_EVENTS.nextgameUpdate, {
        state: clone(state.nextgame),
        match: clone(state.matches.matches.find((match) => match.id === state.nextgame.matchId) ?? null),
        avatars: { left: { side: 'left', exists: false }, right: { side: 'right', exists: false } },
      });
      return ok({
        state: clone(state.nextgame),
        match: clone(state.matches.matches.find((match) => match.id === state.nextgame.matchId) ?? null),
        avatars: { left: { side: 'left', exists: false }, right: { side: 'right', exists: false } },
      });
    }

    // ---- 通用兜底：不穿透网络，返回成功 + 当前快照 ----
    return ok({ store: clone(state.matches), scoreboard: clone(state.scoreboard), tournaments: clone(state.tournaments), profiles: clone(state.profiles) });
  }

  /** 结算画面胜方信息（按快照 matchId + side 解析；模拟会话没有头像文件，固定 exists:false 走占位图） */
  function demoWinnerInfo(): MvpWinnerInfo {
    const winner = state.mvp.winner;
    return {
      side: winner?.side ?? null,
      playerName: winner?.playerName ?? '',
      avatarExists: false,
      avatarPath: '',
      avatarMtime: null,
    };
  }

  /** 登记胜负后的系列赛写回（节点胜者 + 波次完成 + 阶段推进的界面可见部分） */
  function applyTournamentWriteBack(match: MatchRecord, winner: 'left' | 'right'): void {
    const ref = match.tournamentRef;
    if (!ref) {
      return;
    }
    const record = findTournament(ref.tournamentId);
    if (!record) {
      return;
    }
    const wave = record.waves.find((item) => item.waveIndex === ref.waveIndex && item.stageIndex === ref.stageIndex);
    const node = wave?.nodes.find((item) => item.id === ref.nodeId);
    if (!wave || !node) {
      return;
    }
    node.winnerId = winner === 'left' ? node.playerAId : node.playerBId;
    const allDone = wave.nodes.every((item) => item.winnerId !== null);
    wave.status = allDone ? 'completed' : 'running';
    if (allDone) {
      record.entries = record.entries.map((entry) => {
        const isWinner = entry.playerId === node.winnerId;
        return entry.playerId === node.playerAId || entry.playerId === node.playerBId
          ? { ...entry, stageWins: entry.stageWins + (isWinner ? 1 : 0), stageLosses: entry.stageLosses + (isWinner ? 0 : 1) }
          : entry;
      });
    }
    record.updatedAt = nowIso();
    emit(SOCKET_EVENTS.tournamentUpdate, { tournaments: clone(state.tournaments) });
  }

  return {
    handle,
    createSocket,
    reset,
    getState: () => clone(state),
    /** 供横幅展示：当前模拟数据里有多少场比赛 / 系列赛 */
    describe: () => ({ matches: state.matches.matches.length, tournaments: state.tournaments.length }),
  };
}

function emptySlots() {
  return Array.from({ length: 6 }, (_, index) => slotSnapshot(index, null));
}

function slotSnapshot(slot: number, petId: string | null) {
  return {
    slot,
    pet_id: petId,
    name: '',
    form: '',
    opacityEnabled: false,
    opacity: 1,
    saturation: 1,
    healthEnabled: true,
    healthPercent: 100,
    energyValue: 10,
  };
}

/** 精灵库记录：引导里只需要名字与头像地址 */
export type DemoStore = ReturnType<typeof createDemoStore>;

export { clone as cloneDemoValue };
