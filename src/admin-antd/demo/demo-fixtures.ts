/**
 * 「模拟会话」的初始假数据 —— 全部是构造出来的示例赛事，与真机 `runtime/cache/` 无关。
 *
 * 为什么要有这一层：新手引导要能真的点「回退上一波」「右键系列赛卡片」「登记本局胜负」，
 * 这些动作依赖一整套互相引用的数据（系列赛编排 ↔ 对局 ↔ 小局 ↔ 阵容 ↔ 玩家档案）。
 * 数据口径必须和真机一致（MatchRecord / TournamentRecord 的字段与引用关系），
 * 否则真实组件渲染出来是残缺的，引导就讲不清。
 *
 * 场景设定（写死，方便引导文案对齐）：
 * - 8 人单败「2026 秋季杯」进行中：8进4 已打完 → 半决赛 A 场进行中、B 场待开始。
 * - 4 人单败「春季热身赛」还在抽签阶段（讲"继续配置 → 重新抽签 → 确认开赛"）。
 * - 另有两场普通对局（讲"快速创建比赛 / 标签 / 单场录入阵容"）。
 */

import type {
  CountdownPayload,
  MatchRecord,
  MatchSlotSnapshot,
  MvpState,
  NextGameState,
  Page11State,
  Page14State,
  Page6State,
  Page7State,
  Page8State,
  Page9State,
  PanelState,
  PlayerProfile,
  ProfileStoreState,
  ScoreboardState,
  SpriteRecord,
  StageConfig,
  StageStandings,
  TeamProfile,
  TournamentEntry,
  TournamentNode,
  TournamentRecord,
} from '../../../shared/types';

import type { DemoStoreState } from './demo-store';
// 真精灵库：假阵容从这里取真 id / 真名字，保证图标文件名（{pet_id}_{name}.png）能对上真实图片
import petsJson from '../../../resources/data/pets.json';

/** 本机标识（模拟会话固定 A 机） */
const MACHINE_CODE = 'A';

const T1 = 'T20260928_A01';
const T2 = 'T20260928_A02';

/**
 * 假阵容用的精灵：**从真精灵库 `resources/data/pets.json` 里现场取**。
 *
 * 为什么不写死名字：图标文件名是 `{pet_id}_{name}.png`，而多形态精灵的 `name` 带形态后缀
 * （如 `3042_卡瓦重（草地附近的样子）.png`）——写死或凭印象拼名字会**静默 404、界面全变占位图**
 * （踩过：练习页里的悬浮窗因此不像阵容条）。这里按真库取值，命名规则与 `sprite-service.ts` 一致。
 *
 * 取值口径：只挑 `form` 为空的精灵（文件名就是 `{pet_id}_{name}.png`，不依赖形态后缀），
 * 且 stage ≥ 3，保证「只看最终形态」的勾选在模拟会话里也有内容。
 */
const DEMO_PET_IDS = ['5025', '3007', '5003', '5061', '3006', '5017', '5021', '5022'];

interface RawPetItem {
  pet_id?: unknown;
  name?: unknown;
  form?: unknown;
  stage?: unknown;
  handbook_no?: unknown;
  elements?: unknown;
}

const RAW_PET_ITEMS: RawPetItem[] = (() => {
  const payload = petsJson as unknown;
  if (Array.isArray(payload)) {
    return payload as RawPetItem[];
  }
  const items = (payload as { items?: unknown }).items;
  return Array.isArray(items) ? (items as RawPetItem[]) : [];
})();

function rawPetOf(petId: string): RawPetItem | null {
  return RAW_PET_ITEMS.find((item) => String(item.pet_id ?? '') === petId) ?? null;
}

/** 精灵全名（`name` + 形态后缀），与 sprite-service 的 fullName 同口径 */
function fullNameOf(item: RawPetItem, petId: string): string {
  const name = String(item.name ?? petId);
  const form = String(item.form ?? '').trim();
  return form ? `${name}（${form}）` : name;
}

/** 演示用精灵（真 id + 真名字 + 真图标路径） */
const DEMO_PETS: Array<{ id: string; name: string; fullName: string; stage: number }> = DEMO_PET_IDS.map((petId) => {
  const item = rawPetOf(petId);
  const fullName = item ? fullNameOf(item, petId) : petId;
  return {
    id: petId,
    name: String(item?.name ?? petId),
    fullName,
    stage: Number(item?.stage ?? 4),
  };
});

/** 取若干个精灵 id（循环取，保证每套阵容都是 6 只） */
function petIds(startIndex: number, count = 6): string[] {
  return Array.from({ length: count }, (_, index) => DEMO_PETS[(startIndex + index) % DEMO_PETS.length]!.id);
}

/** 由 pet_id 反查展示名 */
function nameOf(petId: string | null | undefined): string {
  return DEMO_PETS.find((pet) => pet.id === petId)?.name ?? '';
}

/** 「信息录入」的常用精灵是自由文本，这里按真实名字给一条 */
const PETS_TEXT = DEMO_PETS.slice(0, 4).map((pet) => pet.name).join('、');

function slotsOf(petIdList: string[], healthSeed = 0): MatchSlotSnapshot[] {
  return Array.from({ length: 6 }, (_, index) => ({
    slot: index,
    pet_id: petIdList[index] ?? null,
    name: nameOf(petIdList[index]),
    form: '',
    opacityEnabled: false,
    opacity: 1,
    saturation: 1,
    healthEnabled: true,
    // 让两边血量不一样：面板与推流页看起来像真的在打
    healthPercent: petIdList[index] ? ((index + healthSeed) % 3 === 0 ? 0 : 60 + ((index * 13 + healthSeed * 7) % 40)) : 100,
    energyValue: 10,
  }));
}

function games(bestOf: number, played: Array<'left' | 'right'>, inProgressGame: number | null) {
  const totalGames = Math.ceil(bestOf / 2) + 1;
  return Array.from({ length: totalGames }, (_, index) => {
    const gameNumber = index + 1;
    const winner = played[index] ?? null;
    return {
      gameNumber,
      leftLineup: petIds(index),
      rightLineup: petIds(index + 3),
      leftSlots: slotsOf(petIds(index), index),
      rightSlots: slotsOf(petIds(index + 3), index + 1),
      winner,
      status: (winner ? 'completed' : gameNumber === inProgressGame ? 'in_progress' : 'pending') as 'pending' | 'in_progress' | 'completed',
    };
  });
}

interface MatchSeed {
  id: string;
  left: string;
  right: string;
  bestOf: number;
  played: Array<'left' | 'right'>;
  inProgressGame: number | null;
  tags: string[];
  ref?: { tournamentId: string; nodeId: string; stageIndex: number; waveIndex: number };
  running?: boolean;
}

function buildMatch(seed: MatchSeed): MatchRecord {
  const list = games(seed.bestOf, seed.played, seed.inProgressGame);
  const leftScore = seed.played.filter((side) => side === 'left').length;
  const rightScore = seed.played.filter((side) => side === 'right').length;
  const need = Math.ceil(seed.bestOf / 2);
  const completed = leftScore >= need || rightScore >= need;
  const status: MatchRecord['status'] = completed ? 'completed' : (seed.running || seed.played.length > 0 ? 'in_progress' : 'pending');
  return {
    id: seed.id,
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: completed ? '2026-09-28T10:30:00.000Z' : '2026-09-28T11:00:00.000Z',
    status,
    leftPlayer: seed.left,
    rightPlayer: seed.right,
    leftRank: '12',
    rightRank: '7',
    leftTeamId: 'team-1',
    leftTeamName: '浅色战队',
    rightTeamId: 'team-2',
    rightTeamName: '深色战队',
    bestOf: seed.bestOf,
    games: list,
    leftScore,
    rightScore,
    winner: completed ? (leftScore > rightScore ? 'left' : 'right') : null,
    completedAt: completed ? '2026-09-28T10:30:00.000Z' : null,
    tags: seed.tags,
    ...(seed.ref ? { tournamentRef: seed.ref } : {}),
  };
}

/* ==================== 选手 / 战队档案 ==================== */

const PLAYER_NAMES = ['小明', '小红', '阿布', '迪莫', '洛可', '喵喵', '火神', '水灵'];

function buildProfiles(): ProfileStoreState {
  const players: PlayerProfile[] = PLAYER_NAMES.map((name, index) => ({
    id: `player-${index + 1}`,
    name,
    pets: PETS_TEXT,
    declaration: `${name}的参赛宣言：一场一场打。`,
    rank: String(3 + index * 2),
    // 模拟会话没有头像文件：一律 false，界面走占位图
    avatarExists: false,
    avatarMtime: null,
  }));
  const teams: TeamProfile[] = [
    { id: 'team-1', name: '浅色战队', captain: '小明', declaration: '浅色战队 · 稳扎稳打', logoExists: false, logoMtime: null },
    { id: 'team-2', name: '深色战队', captain: '小红', declaration: '深色战队 · 后发制人', logoExists: false, logoMtime: null },
  ];
  return { players, teams, mtime: Date.now() };
}

/* ==================== 对局 ==================== */

function buildMatches(): MatchRecord[] {
  return [
    // 当前比赛：系列赛半决赛 A 场（第二波），第 1 局已打完、第 2 局进行中
    buildMatch({
      id: '20260928_A001',
      left: '小明',
      right: '小红',
      bestOf: 3,
      played: ['left'],
      inProgressGame: 2,
      tags: ['秋季杯'],
      ref: { tournamentId: T1, nodeId: 's0-w1-n01', stageIndex: 0, waveIndex: 1 },
      running: true,
    }),
    // 系列赛半决赛 B 场：待开始（讲"开始本次对局"）
    buildMatch({
      id: '20260928_A002',
      left: '阿布',
      right: '迪莫',
      bestOf: 3,
      played: [],
      inProgressGame: null,
      tags: ['秋季杯'],
      ref: { tournamentId: T1, nodeId: 's0-w1-n02', stageIndex: 0, waveIndex: 1 },
    }),
    // 8进4 的四场已完赛（讲"赛果写回 / 波次推进 / 回退上一波"）
    buildMatch({ id: '20260928_A003', left: '小明', right: '洛可', bestOf: 3, played: ['left', 'left'], inProgressGame: null, tags: ['秋季杯'], ref: { tournamentId: T1, nodeId: 's0-w0-n01', stageIndex: 0, waveIndex: 0 } }),
    buildMatch({ id: '20260928_A004', left: '小红', right: '喵喵', bestOf: 3, played: ['left', 'right', 'left'], inProgressGame: null, tags: ['秋季杯'], ref: { tournamentId: T1, nodeId: 's0-w0-n02', stageIndex: 0, waveIndex: 0 } }),
    buildMatch({ id: '20260928_A005', left: '阿布', right: '火神', bestOf: 3, played: ['right', 'left', 'left'], inProgressGame: null, tags: ['秋季杯'], ref: { tournamentId: T1, nodeId: 's0-w0-n03', stageIndex: 0, waveIndex: 0 } }),
    buildMatch({ id: '20260928_A006', left: '迪莫', right: '水灵', bestOf: 3, played: ['left', 'left'], inProgressGame: null, tags: ['秋季杯'], ref: { tournamentId: T1, nodeId: 's0-w0-n04', stageIndex: 0, waveIndex: 0 } }),
    // 普通对局两场（讲"快速创建比赛 / 标签 / 单场录入阵容"）
    buildMatch({ id: '20260928_A007', left: '洛可', right: '喵喵', bestOf: 1, played: ['left'], inProgressGame: null, tags: ['表演赛'] }),
    buildMatch({ id: '20260928_A008', left: '火神', right: '水灵', bestOf: 3, played: [], inProgressGame: null, tags: [] }),
  ];
}

/* ==================== 系列赛编排 ==================== */

function node(
  id: string,
  matchId: string | null,
  playerAId: string | null,
  playerBId: string | null,
  winnerId: string | null,
  next?: TournamentNode['next'],
): TournamentNode {
  return { id, matchId, playerAId, playerBId, winnerId, isBye: false, ...(next ? { next } : {}) };
}

function entry(playerId: string, stageWins = 0, stageLosses = 0, state: TournamentEntry['state'] = 'alive'): TournamentEntry {
  return { playerId, stageWins, stageLosses, state };
}

function buildTournaments(matches: MatchRecord[]): TournamentRecord[] {
  const matchIdOf = (nodeId: string) => matches.find((match) => match.tournamentRef?.nodeId === nodeId)?.id ?? null;

  // 2026 秋季杯：8 人单败，8进4 已完赛（波完成）、半决赛进行中
  const autumn: TournamentRecord = {
    id: T1,
    name: '2026 秋季杯',
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-28T11:00:00.000Z',
    status: 'running',
    seed: 20260928,
    drawVersion: 1,
    playerIds: ['player-1', 'player-2', 'player-3', 'player-4', 'player-5', 'player-6', 'player-7', 'player-8'],
    stages: [
      { id: 's0', name: '8进4', format: 'single-elim', bestOf: 3, pairing: 'bracket-seed', avoidRematch: true, requireConfirm: false },
      { id: 's1', name: '总决赛', format: 'single-elim', bestOf: 5, pairing: 'bracket-seed', avoidRematch: false, requireConfirm: false },
    ],
    currentStageIndex: 0,
    entries: [
      entry('player-1', 1, 0, 'promoted'),
      entry('player-2', 1, 0, 'promoted'),
      entry('player-3', 1, 0, 'promoted'),
      entry('player-4', 1, 0, 'promoted'),
      entry('player-5', 0, 1, 'eliminated'),
      entry('player-6', 0, 1, 'eliminated'),
      entry('player-7', 0, 1, 'eliminated'),
      entry('player-8', 0, 1, 'eliminated'),
    ],
    waves: [
      // draft 波放在最前：新手引导要能演示「配对确认台」（按桶填选手 / 桶内随机重排 / 锁定并建场）
      {
        stageIndex: 1,
        waveIndex: 0,
        status: 'pending',
        pairingStatus: 'draft',
        pairingDraft: [
          { bucketKey: 'initial', pair: ['player-1', 'player-3'] },
          { bucketKey: 'initial', pair: ['player-2', 'player-4'] },
        ],
        nodes: [],
      },
      {
        stageIndex: 0,
        waveIndex: 0,
        status: 'completed',
        pairingStatus: 'locked',
        nodes: [
          node('s0-w0-n01', matchIdOf('s0-w0-n01'), 'player-1', 'player-5', 'player-1', { nodeId: 's0-w1-n01', slot: 'a' }),
          node('s0-w0-n02', matchIdOf('s0-w0-n02'), 'player-2', 'player-6', 'player-2', { nodeId: 's0-w1-n01', slot: 'b' }),
          node('s0-w0-n03', matchIdOf('s0-w0-n03'), 'player-3', 'player-7', 'player-3', { nodeId: 's0-w1-n02', slot: 'a' }),
          node('s0-w0-n04', matchIdOf('s0-w0-n04'), 'player-4', 'player-8', 'player-4', { nodeId: 's0-w1-n02', slot: 'b' }),
        ],
      },
      {
        stageIndex: 0,
        waveIndex: 1,
        status: 'running',
        pairingStatus: 'locked',
        nodes: [
          node('s0-w1-n01', matchIdOf('s0-w1-n01'), 'player-1', 'player-2', null),
          node('s0-w1-n02', matchIdOf('s0-w1-n02'), 'player-3', 'player-4', null),
        ],
      },
    ],
  };

  // 春季热身赛：4 人，还在抽签阶段（讲"继续配置 → 重新抽签 → 确认开赛"）
  // 它在列表里排第二位，但**模拟会话默认打开它**（对局数据那块会 `writeDemoTourStep`/置顶），
  // 因为"抽签 + 配对确认台 + 首波建场"这条前段流程只有它能演。
  const spring: TournamentRecord = {
    id: T2,
    name: '春季热身赛',
    createdAt: '2026-09-27T09:00:00.000Z',
    updatedAt: '2026-09-27T09:30:00.000Z',
    status: 'setup',
    seed: 771102,
    drawVersion: 0,
    playerIds: ['player-1', 'player-2', 'player-3', 'player-4'],
    stages: [
      { id: 's0', name: '半决赛', format: 'single-elim', bestOf: 3, pairing: 'bracket-seed', avoidRematch: true, requireConfirm: false },
      { id: 's1', name: '总决赛', format: 'single-elim', bestOf: 5, pairing: 'bracket-seed', avoidRematch: false, requireConfirm: false },
    ],
    currentStageIndex: 0,
    entries: ['player-1', 'player-2', 'player-3', 'player-4'].map((playerId) => entry(playerId)),
    waves: [],
  };

  return [autumn, spring];
}

/* ==================== 面板 / 记分牌 / 各页面状态 ==================== */

function buildPanels(active: MatchRecord | null): [PanelState, PanelState] {
  const game = active?.games.find((item) => item.status === 'in_progress') ?? active?.games[0];
  const toSlots = (slots: MatchSlotSnapshot[] | undefined) => (slots ?? []).map((slot) => ({
    slot: slot.slot,
    sprite: spriteRecord(slot.pet_id),
    opacityEnabled: slot.opacityEnabled,
    opacity: slot.opacity,
    effectiveOpacity: slot.opacity,
    saturation: slot.saturation,
    healthEnabled: slot.healthEnabled,
    healthPercent: slot.healthPercent,
    energyValue: slot.energyValue,
  }));
  return [
    { position: 'left', count: 6, selected: toSlots(game?.leftSlots) as PanelState['selected'], mtime: Date.now() },
    { position: 'right', count: 6, selected: toSlots(game?.rightSlots) as PanelState['selected'], mtime: Date.now() },
  ];
}

/**
 * 精灵记录：口径与 `sprite-service.ts` 的 normalizePetRecord 一致
 * （`name` = 全称含形态后缀、`displayName` = 纯名、`filename` = `{pet_id}_{全称}.png`），
 * 这样后台各处的头像/立绘地址、形态标签、最终形态筛选在模拟会话里都对得上。
 */
export function spriteRecord(petId: string | null): SpriteRecord | null {
  if (!petId) {
    return null;
  }
  const pet = DEMO_PETS.find((item) => item.id === petId);
  const raw = rawPetOf(petId);
  const fullName = pet?.fullName ?? (nameOf(petId) || petId);
  const displayName = pet?.name ?? petId;
  const filename = `${petId}_${fullName}.png`;
  const stage = pet?.stage ?? 4;
  const formText = String(raw?.form ?? '').trim();
  const elements = Array.isArray(raw?.elements) ? (raw?.elements as string[]) : [];
  return {
    id: petId,
    filename,
    displayName,
    name: fullName,
    // 立绘与头像同命名（/resources/sprites-img 与 /resources/sprites-icon）
    path: `/resources/sprites-img/${filename}`,
    aliases: [displayName, fullName, petId],
    number: null,
    attribute: elements.join('、'),
    attributeCodes: [],
    attributeIcon1: '',
    attributeIcon2: '',
    iconUrl: `/resources/sprites-icon/${filename}`,
    form: stage === 1 ? '一阶' : stage === 2 ? '二阶' : stage === 3 ? '三阶' : '首领',
    petForm: formText,
    isFinalForm: stage >= 3,
  } as unknown as SpriteRecord;
}

function buildScoreboard(active: MatchRecord | null): ScoreboardState {
  return {
    leftName: active?.leftPlayer ?? '小明',
    leftScore: String(active?.leftScore ?? 0),
    leftRank: active?.leftRank ?? '12',
    rightName: active?.rightPlayer ?? '小红',
    rightScore: String(active?.rightScore ?? 0),
    rightRank: active?.rightRank ?? '7',
    bestOf: active?.bestOf ?? 3,
    scoreboardEnabled: true,
    eventTitle: '2026 秋季杯 · 半决赛',
    eventTitleEnabled: true,
    page2LineupDisplayMode: 'default',
    page5Title: '精灵出场 / 胜率排行',
    page6Title: '比赛结果',
    nameFontSize: 36,
    scoreFontSize: 72,
    mtime: Date.now(),
  };
}

function buildStageConfig(): StageConfig {
  return {
    page: 'page3',
    transition: 'blinds',
    mirrorSides: false,
    page3SpriteSource: 'sprite',
    page3RankVisible: true,
    page3TeamVisible: true,
    page3RedLightMode: 'auto',
    page3RedLightInstant: false,
    page11RankVisible: true,
    page5Player: '',
    page5TournamentId: '',
    page7SwitchSeconds: 10,
    page10Duration: 8,
    page10DurationUnit: 'seconds',
    mtime: Date.now(),
  };
}

function buildSeed(): DemoStoreState {
  const matches = buildMatches();
  const tournaments = buildTournaments(matches);
  const profiles = buildProfiles();
  const active = matches.find((match) => match.id === '20260928_A001') ?? null;

  const page6: Page6State = { matchIds: ['20260928_A003', '20260928_A004'], title: '8进4 赛果', startTime: '19:30', matchTimes: {}, mtime: Date.now() };
  const page7: Page7State = { matchIds: ['20260928_A003', '20260928_A004'], title: '今日战绩', notice: '温馨提示：排名选自选手历史最高非实时', mtime: Date.now() };
  const page8: Page8State = { matchIds: ['20260928_A001', '20260928_A002'], title: '即将开始', startTime: '20:00', matchTimes: {}, mtime: Date.now() };
  const page9: Page9State = {
    title: '团队积分榜',
    teams: [
      { name: '浅色战队', r1: '18', r2: '21', r3: '0' },
      { name: '深色战队', r1: '15', r2: '24', r3: '0' },
      { name: '夕阳战队', r1: '12', r2: '9', r3: '0' },
      { name: '晨光战队', r1: '9', r2: '12', r3: '0' },
    ],
    mtime: Date.now(),
  };
  const page11: Page11State = {
    left: { source: 'match', name: '', rank: '', declaration: '', pets: '' },
    right: { source: 'match', name: '', rank: '', declaration: '', pets: '' },
    mtime: Date.now(),
  };
  const page14: Page14State = {
    tournamentId: T1,
    stageIndexes: [0],
    activeStageIndex: 0,
    page: 0,
    title: '晋级积分榜',
    subtitle: '',
    mtime: Date.now(),
  };
  const page14Standings: StageStandings = {
    stageIndex: 0,
    stageName: '8进4',
    format: 'single-elim',
    bestOf: 3,
    total: 8,
    pageSize: 32,
    pageCount: 1,
    completedMatches: 4,
    totalMatches: 6,
    rows: ['player-1', 'player-2', 'player-3', 'player-4', 'player-5', 'player-6', 'player-7', 'player-8'].map((playerId, index) => ({
      playerId,
      name: profiles.players.find((player) => player.id === playerId)?.name ?? playerId,
      rank: index + 1,
      wins: index < 4 ? 1 : 0,
      losses: index < 4 ? 0 : 1,
      score: index < 4 ? 10 : -1,
      state: (index < 4 ? 'promoted' : 'eliminated') as 'promoted' | 'eliminated',
    })),
  };
  const nextgameState: NextGameState = { matchId: '20260928_A002', visible: false, duration: 1, durationUnit: 'minutes', shownAt: null, mtime: Date.now() };
  const countdown: CountdownPayload['state'] = { visible: false, running: false, duration: 5, remainingSeconds: 300, endAt: null, theme: 'dark', mtime: Date.now() };
  const mvp: MvpState = {
    slots: [
      { petId: '3042', tag: '主力', isMvp: true },
      { petId: '3006', tag: '收割', isMvp: false },
      { petId: '', tag: '', isMvp: false },
      { petId: '', tag: '', isMvp: false },
      { petId: '', tag: '', isMvp: false },
      { petId: '', tag: '', isMvp: false },
    ],
    returnPage: 'page3',
    winner: { matchId: '20260928_A001', side: 'left', playerName: '小明' },
    mtime: Date.now(),
  };

  return {
    scoreboard: buildScoreboard(active),
    matches: {
      activeMatchId: active?.id ?? null,
      matches,
      undo: {
        canUndo: true,
        canRedo: false,
        canUndoDelete: false,
        deleteUndoCount: 0,
        byMatch: { '20260928_A001': { canUndo: true, canRedo: false } },
      },
      mtime: Date.now(),
    },
    panels: buildPanels(active),
    tournaments,
    locallyRemoved: [],
    profiles,
    stage: buildStageConfig(),
    page6,
    page7,
    page8,
    page9,
    page11,
    page14,
    page14Standings,
    nextgame: nextgameState,
    countdown,
    mvp,
    mvpWinnerName: '小明',
    machineCode: MACHINE_CODE,
  };
}

/** 初始状态工厂（每次都新建一份，保证「重置」是真重置） */
export function seedDemoState(): DemoStoreState {
  return buildSeed();
}

/** 精灵库（GET /api/sprites 用）：只给引导里会出现的几只 */
export function seedDemoSprites(): SpriteRecord[] {
  return DEMO_PETS.map((pet) => spriteRecord(pet.id)).filter((item): item is SpriteRecord => item !== null);
}
