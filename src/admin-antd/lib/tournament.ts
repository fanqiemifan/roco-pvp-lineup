import { TOURNAMENT_TARGET_LOSSES, TOURNAMENT_TARGET_WINS } from '../../../shared/constants';
import type {
  MatchRecord,
  PairingValidation,
  ProfileStoreState,
  StageFormat,
  StageRule,
  TournamentNode,
  TournamentRecord,
  TournamentWave,
} from '../../../shared/types';

/* ==================== 纯函数：展示/校验辅助（可单测，不依赖 DOM） ==================== */

/** id → 选手名字映射（profiles 未加载时为空表，消费点需兜底显示 id） */
export function buildPlayerNameMap(profiles: ProfileStoreState | null): Map<string, string> {
  const map = new Map<string, string>();
  profiles?.players.forEach((player) => map.set(player.id, player.name));
  return map;
}

export function resolvePlayerName(names: Map<string, string>, id: string | null): string {
  if (!id) {
    return '';
  }
  return names.get(id) ?? id;
}

/** 系列赛状态文案与配色（列表/详情头部用） */
export function getTournamentStatusMeta(record: TournamentRecord): {
  label: string;
  color: string;
} {
  if (record.status === 'setup') {
    return { label: '待开赛', color: 'default' };
  }
  if (record.status === 'completed') {
    return { label: '已完赛', color: 'success' };
  }
  return { label: '进行中', color: 'processing' };
}

/** 阶段在系列赛中的状态：done 已完成 / current 正在进行 / pending 未开始 */
export function getStageState(
  record: TournamentRecord,
  stageIndex: number,
): 'done' | 'current' | 'pending' {
  if (stageIndex < record.currentStageIndex) {
    return 'done';
  }
  if (stageIndex === record.currentStageIndex) {
    return record.status === 'completed' ? 'done' : 'current';
  }
  return 'pending';
}

/** 波次全局下标（waves 是跨阶段的扁平数组）；找不到返回 -1 */
export function getWaveGlobalIndex(
  record: TournamentRecord,
  stageIndex: number,
  waveIndex: number,
): number {
  return record.waves.findIndex(
    (wave) => wave.stageIndex === stageIndex && wave.waveIndex === waveIndex,
  );
}

/** 当前位置简述：「阶段名 · 第N波」，setup 显示「抽签待开赛」 */
export function getCurrentPositionText(record: TournamentRecord): string {
  if (record.status === 'setup') {
    return '抽签待开赛';
  }
  const stage = record.stages[record.currentStageIndex];
  const stageWaves = record.waves.filter((wave) => wave.stageIndex === record.currentStageIndex);
  const lastWave = stageWaves[stageWaves.length - 1];
  if (record.status === 'completed' || !lastWave) {
    return '已结束';
  }
  return `${stage.name} · 第 ${lastWave.waveIndex} 波`;
}

/** 系列赛关联比赛中已完成的场次数（进度展示用） */
export function countCompletedMatches(
  record: TournamentRecord,
  matches: MatchRecord[],
): number {
  const nodeMatchIds = new Set<string>();
  record.waves.forEach((wave) => wave.nodes.forEach((node) => {
    if (node.matchId) {
      nodeMatchIds.add(node.matchId);
    }
  }));
  return matches.filter(
    (match) => nodeMatchIds.has(match.id) && match.status === 'completed',
  ).length;
}

/** 系列赛关联比赛的状态统计（仅计比赛库中实际存在的节点比赛），删除确认弹窗用 */
export function summarizeTournamentMatches(
  record: TournamentRecord,
  matches: MatchRecord[],
): { total: number; completed: number; inProgress: number; pending: number } {
  const summary = { total: 0, completed: 0, inProgress: 0, pending: 0 };
  const nodeMatchIds = new Set<string>();
  record.waves.forEach((wave) => wave.nodes.forEach((node) => {
    if (node.matchId) {
      nodeMatchIds.add(node.matchId);
    }
  }));
  matches.forEach((match) => {
    if (!nodeMatchIds.has(match.id)) {
      return;
    }
    summary.total += 1;
    if (match.status === 'completed') {
      summary.completed += 1;
    } else if (match.status === 'in_progress') {
      summary.inProgress += 1;
    } else {
      summary.pending += 1;
    }
  });
  return summary;
}

/** 节点对应比赛（找不到返回 undefined） */
export function findNodeMatch(
  wave: TournamentWave,
  matches: MatchRecord[],
  node: TournamentNode,
): MatchRecord | undefined {
  if (!node.matchId) {
    return undefined;
  }
  return matches.find((match) => match.id === node.matchId);
}

/** 节点（比赛）状态：completed / in_progress / pending；无关联比赛按 pending 处理 */
export function getNodeStatus(node: TournamentNode, match?: MatchRecord): MatchRecord['status'] {
  if (match) {
    return match.status;
  }
  return node.winnerId ? 'completed' : 'pending';
}

/* ---------- 配对确认台 ---------- */

/** draft 波期望选手桶：双败按战绩桶分组（key 形如 "1-0"），单败整池（key=undefined） */
export function getDraftBucketSpecs(
  record: TournamentRecord,
  wave: TournamentWave,
): Array<{ bucketKey?: string; playerIds: string[] }> {
  const alive = record.entries.filter((entry) => entry.state === 'alive');
  const stage = record.stages[wave.stageIndex];

  if (stage.format === 'single-elim') {
    return [{ bucketKey: undefined, playerIds: alive.map((entry) => entry.playerId) }];
  }

  const pick = (wins: number, losses: number): string[] =>
    alive
      .filter((entry) => entry.stageWins === wins && entry.stageLosses === losses)
      .map((entry) => entry.playerId);

  switch (wave.waveIndex) {
    case 1:
      return [{ bucketKey: '0-0', playerIds: pick(0, 0) }];
    case 2:
      return [
        { bucketKey: '1-0', playerIds: pick(1, 0) },
        { bucketKey: '0-1', playerIds: pick(0, 1) },
      ];
    default:
      return [{ bucketKey: '1-1', playerIds: pick(1, 1) }];
  }
}

/** 本阶段已交手判定（含胜者的节点），用于已交手提醒 */
export function hasPlayedInStage(
  record: TournamentRecord,
  stageIndex: number,
  a: string,
  b: string,
): boolean {
  return record.waves
    .filter((wave) => wave.stageIndex === stageIndex)
    .some((wave) => wave.nodes.some((node) => node.winnerId
      && ((node.playerAId === a && node.playerBId === b)
        || (node.playerAId === b && node.playerBId === a))));
}

/**
 * 配对草稿客户端校验（与服务端口径一致，锁定前即时反馈）：
 * 漏配/重复/自己对自己/不在本波 → 错误；跨桶未显式允许 → 错误；已交手 → 仅提醒。
 */
export function validateDraftPairs(
  record: TournamentRecord,
  wave: TournamentWave,
  pairs: NonNullable<TournamentWave['pairingDraft']>,
  allowCrossBucket: boolean,
): PairingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const specs = getDraftBucketSpecs(record, wave);
  // 期望选手 → 桶 key（单败 undefined）
  const expectedBucket = new Map<string, string | undefined>();
  specs.forEach((spec) => spec.playerIds.forEach((id) => expectedBucket.set(id, spec.bucketKey)));

  const seen = new Map<string, number>();

  pairs.forEach((row, rowIndex) => {
    const [a, b] = row.pair;
    if (!a || !b) {
      errors.push(`第 ${rowIndex + 1} 场存在漏配（未配对）`);
    }
    if (a && !expectedBucket.has(a)) {
      errors.push(`第 ${rowIndex + 1} 场选手不在本波名单`);
    }
    if (b && !expectedBucket.has(b)) {
      errors.push(`第 ${rowIndex + 1} 场选手不在本波名单`);
    }
    if (a) {
      seen.set(a, (seen.get(a) ?? 0) + 1);
    }
    if (b) {
      seen.set(b, (seen.get(b) ?? 0) + 1);
    }
    if (a && b && a === b) {
      errors.push(`第 ${rowIndex + 1} 场不能自己对自己`);
    }
    if (a && b) {
      const bucketA = expectedBucket.get(a);
      const bucketB = expectedBucket.get(b);
      if (bucketA !== undefined && bucketB !== undefined && bucketA !== bucketB) {
        if (!allowCrossBucket) {
          errors.push(`第 ${rowIndex + 1} 场为跨桶配对（战绩不对等），需勾选允许跨桶`);
        }
      }
      if (hasPlayedInStage(record, wave.stageIndex, a, b)) {
        warnings.push(`第 ${rowIndex + 1} 场双方本阶段已交手过`);
      }
    }
  });

  seen.forEach((count, id) => {
    if (count > 1) {
      errors.push(`选手重复出现在 ${count} 场对决中：${id}`);
    }
  });
  expectedBucket.forEach((_bucket, id) => {
    if (!seen.has(id)) {
      errors.push(`选手漏配：${id}`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

/** 决胜池（双败 W3 的 1-1 池）key */
const DECIDER_BUCKET = '1-1';

/** 是否决胜池（双败 W3 的 1-1 池） */
export function isDeciderBucket(bucketKey?: string): boolean {
  return bucketKey === DECIDER_BUCKET;
}

/** 洗牌（Fisher–Yates，RNG 注入） */
function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** 该选手在本阶段第 1 波是否取胜（与服务端口径一致） */
function wonOpeningRound(record: TournamentRecord, stageIndex: number, playerId: string): boolean {
  const wave1 = record.waves.find((wave) => wave.stageIndex === stageIndex && wave.waveIndex === 1);
  const node = wave1?.nodes.find((item) => item.playerAId === playerId || item.playerBId === playerId);
  return node?.winnerId === playerId;
}

/** 桶内随机重排：洗牌后两两配对（纯函数，RNG 注入便于测试） */
export function shuffleBucketPairs(
  playerIds: string[],
  rng: () => number,
): Array<[string, string]> {
  const ordered = shuffleInPlace([...playerIds], rng);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < ordered.length; i += 2) {
    if (ordered[i + 1] !== undefined) {
      pairs.push([ordered[i], ordered[i + 1]]);
    }
  }
  return pairs;
}

/**
 * 决胜池交叉配对：W1 取胜者（胜者组掉落者）对 W1 落败者（败者组上扬者），两类人互不相遇，
 * 与后端 generateDraftPairs 同口径；两侧各自洗牌后按序一一对应。
 */
export function crossPairDeciderPool(
  record: TournamentRecord,
  stageIndex: number,
  playerIds: string[],
  rng: () => number,
): Array<[string, string]> {
  const drops: string[] = [];
  const rises: string[] = [];
  playerIds.forEach((id) => {
    (wonOpeningRound(record, stageIndex, id) ? drops : rises).push(id);
  });
  shuffleInPlace(drops, rng);
  shuffleInPlace(rises, rng);

  const pairs: Array<[string, string]> = [];
  drops.forEach((first, index) => {
    const second = rises[index];
    if (second !== undefined) {
      pairs.push([first, second]);
    }
  });
  return pairs;
}

/* ---------- 晋级图（BracketBoard 数据源，纯函数便于单测） ---------- */

/** 晋级图槽位：一名选手在一场对决中的位置 */
export interface BracketSlot {
  playerId: string | null;
  name: string;
  /** 阶段内战绩脚注（如「1-0 已晋级」） */
  stateText: string;
  /** 胜者（已分出胜负且本选手获胜） */
  isWinner: boolean;
  /** 本场比分（未出结果时为空串 → 渲染空比分块） */
  score: string;
  /**
   * 入场连线来源：该选手上一次出战的节点（上次赢 = 胜者实线 w / 上次输 = 败者虚线 l）；
   * 首轮登场（此前无出战记录）为 null。
   */
  from: { nodeId: string; kind: 'w' | 'l' } | null;
}

/** 晋级图卡片：一个节点 = 一场对决 */
export interface BracketCard {
  nodeId: string;
  matchId: string | null;
  playerA: BracketSlot;
  playerB: BracketSlot;
  status: MatchRecord['status'];
  /** 状态文案：已结束 / 进行中 / 待开始 */
  statusLabel: string;
  /** 跨桶配对（双败两侧阶段内战绩不对等，引擎显式允许跨桶时才可能出现） */
  isCrossBucket: boolean;
  /** 未开始且已建场 → 可弃权判负 */
  canForfeit: boolean;
}

/** draft 波的只读候选配对 */
export interface BracketDraftPair {
  bucketKey?: string;
  a: string;
  b: string;
}

/** 晋级图列：双败按战绩桶拆列（胜者组 R1 / 败者组 R1 / 胜者组 R2 / 败者组 R2），单败一阶段一列 */
export interface BracketColumn {
  key: string;
  stageIndex: number;
  waveIndex: number;
  /** 战绩桶 key（双败为 0-0 / 1-0 / 0-1 / 1-1；单败为 undefined） */
  bucketKey?: string;
  stageName: string;
  /** 阶段赛制标签：双败 / 单败 */
  formatLabel: string;
  /** 列标题：双败为轮次名（阶段首列附阶段名、决胜列附「决出N强」）；单败为阶段名 */
  label: string;
  status: TournamentWave['status'];
  statusLabel: string;
  pairingStatus: TournamentWave['pairingStatus'];
  draftPairs: BracketDraftPair[];
  cards: BracketCard[];
}

export interface BracketGraph {
  columns: BracketColumn[];
  /** 节点总数（不含 draft 候选配对） */
  cardCount: number;
  /** 已结束场次数 */
  completedCount: number;
}

/** 节点序号（s0-w2-n03 → 3），解析失败排到末尾 */
function parseNodeOrder(nodeId: string): number {
  const matched = /-n(\d+)$/.exec(nodeId);
  return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
}

function getWaveStatusLabel(status: TournamentWave['status']): string {
  if (status === 'completed') {
    return '已完成';
  }
  if (status === 'running') {
    return '进行中';
  }
  return '待开始';
}

/** 双败战绩桶 → 轮次名（与引擎的桶结构一一对应：W1 全 0-0；W2 1-0 / 0-1；W3 1-1） */
const DOUBLE_LIFE_ROUND_LABELS: Record<string, string> = {
  '0-0': '胜者组 R1',
  '1-0': '胜者组 R2',
  '0-1': '败者组 R1',
  '1-1': '败者组 R2',
};

/** 列顺序：胜者组 R1 → 败者组 R1 → 胜者组 R2 → 败者组 R2（同属一波的两桶按此顺序拆列） */
const DOUBLE_LIFE_ROUND_ORDER: Record<string, number> = {
  '0-0': 0,
  '0-1': 1,
  '1-0': 2,
  '1-1': 3,
};

/** 阶段首列（带阶段名）/ 阶段决胜列（带「决出 N 强」）的桶 key */
const DOUBLE_LIFE_OPENING_BUCKET = '0-0';
const DOUBLE_LIFE_DECIDER_BUCKET = '1-1';

function getRoundOrder(bucketKey: string): number {
  return DOUBLE_LIFE_ROUND_ORDER[bucketKey] ?? Number.MAX_SAFE_INTEGER;
}

/** 列标题：双败为轮次名（首列附阶段名、决胜列附决出人数），单败直接用阶段名 */
function buildColumnLabel(
  stage: StageRule,
  waveIndex: number,
  promotedCount: number,
  bucketKey?: string,
): string {
  if (!bucketKey) {
    return stage.name;
  }
  const parts = [DOUBLE_LIFE_ROUND_LABELS[bucketKey] ?? `第 ${waveIndex} 波`];
  if (bucketKey === DOUBLE_LIFE_OPENING_BUCKET) {
    parts.push(stage.name);
  }
  if (bucketKey === DOUBLE_LIFE_DECIDER_BUCKET && promotedCount >= 2) {
    parts.push(`决出${promotedCount}强`);
  }
  return parts.join(' · ');
}

/** 桶推导兜底：节点/草稿缺 bucketKey 时按波次结构取默认桶（W1 0-0 / W2 1-0 / W3+ 1-1） */
function defaultBucketKey(waveIndex: number): string {
  if (waveIndex === 1) {
    return DOUBLE_LIFE_OPENING_BUCKET;
  }
  if (waveIndex === 2) {
    return '1-0';
  }
  return DOUBLE_LIFE_DECIDER_BUCKET;
}

/** 晋级图内部列种子：一列 = 一阶段的一波（双败再按桶细分） */
interface BracketColumnSeed {
  key: string;
  stageIndex: number;
  waveIndex: number;
  bucketKey?: string;
  wave: TournamentWave;
  nodes: TournamentNode[];
  draftPairs: BracketDraftPair[];
  /** 列内排序位：双败用轮次序，单败用波次 */
  sortIndex: number;
}

/**
 * 卡片上下文：选手入场连线时间线 + 阶段内战绩桶/跨桶推导 + 单节点 → 卡片。
 * 晋级图与波次列表共用，保证两处卡片内容与样式同源。
 */
function createBracketCardContext(
  record: TournamentRecord,
  names: Map<string, string>,
  matches: MatchRecord[],
): { bucketByNode: Map<string, string>; buildCard(wave: TournamentWave, node: TournamentNode): BracketCard } {
  // 波次按阶段/波次升序：waves 是跨阶段扁平数组，排序后即时间线
  const waves = [...record.waves].sort(
    (left, right) => left.stageIndex - right.stageIndex || left.waveIndex - right.waveIndex,
  );

  // 选手出战时间线：playerId → [{ nodeId, won }]，用于推导入场连线
  const appearances = new Map<string, Array<{ nodeId: string; won: boolean }>>();
  waves.forEach((wave) => {
    wave.nodes.forEach((node) => {
      [node.playerAId, node.playerBId].forEach((playerId) => {
        if (!playerId) {
          return;
        }
        const list = appearances.get(playerId) ?? [];
        list.push({ nodeId: node.id, won: node.winnerId === playerId });
        appearances.set(playerId, list);
      });
    });
  });

  /** 该选手在本节点之前的最后一次出战（推导入场连线） */
  function resolveFrom(playerId: string | null, nodeId: string): BracketSlot['from'] {
    if (!playerId) {
      return null;
    }
    const list = appearances.get(playerId) ?? [];
    const index = list.findIndex((item) => item.nodeId === nodeId);
    const previous = index > 0 ? list[index - 1] : undefined;
    if (!previous) {
      return null;
    }
    return { nodeId: previous.nodeId, kind: previous.won ? 'w' : 'l' };
  }

  // 节点所属战绩桶 + 跨桶标记：按波次顺序累计阶段内战绩（阶段切换清零），
  // 取该场开打前的战绩入桶，与节点 id 序号无关；两侧战绩不等即跨桶
  const bucketByNode = new Map<string, string>();
  const crossBucketNodes = new Set<string>();
  /**
   * 节点结算后各选手的阶段内战绩（key = `节点id|选手id`），脚注文案用它。
   * 不能读 record.entries：阶段推进时 entries 会被换成下一阶段的 0-0/alive，
   * 回头看已完成阶段的卡片就会显示成「0-0 存活」（已淘汰者更是查不到、脚注空白）。
   */
  const recordAfterNode = new Map<string, { wins: number; losses: number }>();
  {
    let stageIndex = -1;
    let records = new Map<string, { wins: number; losses: number }>();
    waves.forEach((wave) => {
      if (wave.stageIndex !== stageIndex) {
        stageIndex = wave.stageIndex;
        records = new Map();
      }
      const recordOf = (playerId: string | null): string | undefined => {
        if (!playerId) {
          return undefined;
        }
        const state = records.get(playerId);
        return `${state?.wins ?? 0}-${state?.losses ?? 0}`;
      };
      if (record.stages[stageIndex]?.format === 'double-life') {
        wave.nodes.forEach((node) => {
          const keyA = recordOf(node.playerAId);
          const keyB = recordOf(node.playerBId);
          const key = keyA ?? keyB;
          if (key) {
            bucketByNode.set(node.id, key);
          }
          if (keyA && keyB && keyA !== keyB) {
            crossBucketNodes.add(node.id);
          }
        });
      }
      // 本波结算：累计战绩供下一波推桶，同时记下每个节点结算后的战绩供脚注使用。
      // 每人每波至多出场一次，因此在循环中读到的仍是各自的开打前战绩。
      wave.nodes.forEach((node) => {
        const before = (playerId: string): { wins: number; losses: number } =>
          records.get(playerId) ?? { wins: 0, losses: 0 };
        const winnerId = node.winnerId;
        if (!winnerId) {
          [node.playerAId, node.playerBId].forEach((playerId) => {
            if (playerId) {
              recordAfterNode.set(`${node.id}|${playerId}`, before(playerId));
            }
          });
          return;
        }
        const loserId = node.playerAId === winnerId ? node.playerBId : node.playerAId;
        const winner = before(winnerId);
        const winnerAfter = { wins: winner.wins + 1, losses: winner.losses };
        records.set(winnerId, winnerAfter);
        recordAfterNode.set(`${node.id}|${winnerId}`, winnerAfter);
        if (loserId) {
          const loser = before(loserId);
          const loserAfter = { wins: loser.wins, losses: loser.losses + 1 };
          records.set(loserId, loserAfter);
          recordAfterNode.set(`${node.id}|${loserId}`, loserAfter);
        }
      });
    });
  }

  function buildCard(wave: TournamentWave, node: TournamentNode): BracketCard {
    const match = findNodeMatch(wave, matches, node);
    const status = getNodeStatus(node, match);
    const format = record.stages[wave.stageIndex].format;
    const buildSlot = (playerId: string | null, score: number | undefined): BracketSlot => ({
      playerId,
      name: resolvePlayerName(names, playerId),
      stateText: getPlayerStateText(
        format,
        playerId ? recordAfterNode.get(`${node.id}|${playerId}`) : undefined,
      ),
      isWinner: Boolean(playerId) && node.winnerId === playerId,
      score: status === 'pending' || score === undefined ? '' : String(score),
      from: resolveFrom(playerId, node.id),
    });
    return {
      nodeId: node.id,
      matchId: node.matchId,
      playerA: buildSlot(node.playerAId, match?.leftScore),
      playerB: buildSlot(node.playerBId, match?.rightScore),
      status,
      statusLabel: status === 'completed'
        ? '已结束'
        : status === 'in_progress'
          ? '进行中'
          : '待开始',
      isCrossBucket: crossBucketNodes.has(node.id),
      canForfeit: status === 'pending' && Boolean(node.matchId),
    };
  }

  return { bucketByNode, buildCard };
}

/** 单波卡片（波次列表用）：与晋级图同源，按节点序号排序 */
export function buildWaveCards(
  record: TournamentRecord,
  wave: TournamentWave,
  names: Map<string, string>,
  matches: MatchRecord[],
): BracketCard[] {
  const { buildCard } = createBracketCardContext(record, names, matches);
  return [...wave.nodes]
    .sort((left, right) => parseNodeOrder(left.id) - parseNodeOrder(right.id))
    .map((node) => buildCard(wave, node));
}

/**
 * 某波的轮次表述（双败按战绩桶给出「胜者组 R1 / 败者组 R1」等；单败返回空数组，直接用阶段名）。
 * 波次列表用它替代「第 N 波」，与晋级图列标题同一套术语。
 */
export function getWaveRoundLabels(record: TournamentRecord, wave: TournamentWave): string[] {
  const stage = record.stages[wave.stageIndex];
  if (!stage || stage.format !== 'double-life') {
    return [];
  }
  return getDraftBucketSpecs(record, wave)
    .map((spec) => spec.bucketKey)
    .filter((key): key is string => Boolean(key))
    .sort((left, right) => getRoundOrder(left) - getRoundOrder(right))
    .map((key) => DOUBLE_LIFE_ROUND_LABELS[key] ?? key);
}

/** 配对方式的中文表述（创建向导的同名字段：双败 随机/手动，单败 沿对阵树/每轮随机） */
export function getPairingLabel(pairing: StageRule['pairing']): string {
  switch (pairing) {
    case 'random-bucket':
      return '随机配对';
    case 'manual-bucket':
      return '手动配对';
    case 'random-round':
      return '每轮随机';
    default:
      return '沿对阵树';
  }
}

/**
 * 把系列赛记录推导成可渲染的晋级图：双败按战绩桶拆列
 * （胜者组 R1 → 败者组 R1 → 胜者组 R2 → 败者组 R2），单败一阶段一列，列内每个节点一张卡片。
 * 卡片两个槽位按「该选手上一次出战节点」推导入场连线（上次赢 = 实线，上次输 = 虚线），
 * 首轮登场无连线 —— 连线关系完全由节点数据推导，不额外持久化。
 */
export function buildBracketGraph(
  record: TournamentRecord,
  names: Map<string, string>,
  matches: MatchRecord[],
): BracketGraph {
  // 波次按阶段/波次升序：waves 是跨阶段扁平数组，排序后即时间线
  const waves = [...record.waves].sort(
    (left, right) => left.stageIndex - right.stageIndex || left.waveIndex - right.waveIndex,
  );

  // 卡片上下文（入场连线 + 战绩桶推导）与波次列表共用
  const { bucketByNode, buildCard } = createBracketCardContext(record, names, matches);

  // 列种子：单败一波一列；双败一波按桶拆列（draft 波按草稿桶 key 补出空列）
  const seeds: BracketColumnSeed[] = [];
  waves.forEach((wave) => {
    const draftPairs = (wave.pairingDraft ?? []).map((row): BracketDraftPair => ({
      bucketKey: row.bucketKey,
      a: resolvePlayerName(names, row.pair[0]),
      b: resolvePlayerName(names, row.pair[1]),
    }));

    if (record.stages[wave.stageIndex]?.format === 'double-life') {
      const groups = new Map<string, TournamentNode[]>();
      wave.nodes.forEach((node) => {
        const key = bucketByNode.get(node.id) ?? defaultBucketKey(wave.waveIndex);
        groups.set(key, [...(groups.get(key) ?? []), node]);
      });
      draftPairs.forEach((pair) => {
        const key = pair.bucketKey ?? defaultBucketKey(wave.waveIndex);
        if (!groups.has(key)) {
          groups.set(key, []);
        }
      });
      if (groups.size === 0) {
        getDraftBucketSpecs(record, wave).forEach((spec) => {
          groups.set(spec.bucketKey ?? defaultBucketKey(wave.waveIndex), []);
        });
      }
      groups.forEach((nodes, bucketKey) => {
        seeds.push({
          key: `${wave.stageIndex}-${wave.waveIndex}-${bucketKey}`,
          stageIndex: wave.stageIndex,
          waveIndex: wave.waveIndex,
          bucketKey,
          wave,
          nodes,
          draftPairs: draftPairs.filter(
            (pair) => (pair.bucketKey ?? defaultBucketKey(wave.waveIndex)) === bucketKey,
          ),
          sortIndex: getRoundOrder(bucketKey),
        });
      });
      return;
    }

    seeds.push({
      key: `${wave.stageIndex}-${wave.waveIndex}-all`,
      stageIndex: wave.stageIndex,
      waveIndex: wave.waveIndex,
      wave,
      nodes: wave.nodes,
      draftPairs,
      sortIndex: wave.waveIndex,
    });
  });

  let cardCount = 0;
  let completedCount = 0;

  const columns = seeds
    .sort(
      (left, right) => left.stageIndex - right.stageIndex
        || left.sortIndex - right.sortIndex
        || left.waveIndex - right.waveIndex,
    )
    .map((seed): BracketColumn => {
      const stage = record.stages[seed.stageIndex];
      const cards = [...seed.nodes]
        .sort((left, right) => parseNodeOrder(left.id) - parseNodeOrder(right.id))
        .map((node): BracketCard => {
          const card = buildCard(seed.wave, node);
          cardCount += 1;
          if (card.status === 'completed') {
            completedCount += 1;
          }
          return card;
        });
      // 本阶段晋级人数：参赛人数按 2 的阶段倍数收敛
      const promotedCount = Math.floor(record.playerIds.length / 2 ** (seed.stageIndex + 1));
      return {
        key: seed.key,
        stageIndex: seed.stageIndex,
        waveIndex: seed.waveIndex,
        bucketKey: seed.bucketKey,
        stageName: stage.name,
        formatLabel: stage.format === 'double-life' ? '双败' : '单败',
        label: buildColumnLabel(stage, seed.waveIndex, promotedCount, seed.bucketKey),
        status: seed.wave.status,
        statusLabel: getWaveStatusLabel(seed.wave.status),
        pairingStatus: seed.wave.pairingStatus,
        draftPairs: seed.draftPairs,
        cards,
      };
    });

  return { columns, cardCount, completedCount };
}

/**
 * 节点脚注文案：该场结算后的阶段内战绩 + 状态（已晋级/已淘汰/存活）。
 * 口径与后端 deriveState 一致（双败 2 胜晋级 / 2 负淘汰；单败一胜即晋级），
 * 数据由 buildBracketCardContext 按节点历史累计得到（不读会随阶段切换重置的 entries）。
 */
export function getPlayerStateText(
  format: StageFormat,
  state: { wins: number; losses: number } | undefined,
): string {
  if (!state) {
    return '';
  }
  const promoted = format === 'single-elim' ? state.wins >= 1 : state.wins >= TOURNAMENT_TARGET_WINS;
  const eliminated = format === 'single-elim' ? state.losses >= 1 : state.losses >= TOURNAMENT_TARGET_LOSSES;
  const label = promoted ? '已晋级' : eliminated ? '已淘汰' : '存活';
  return `${state.wins}-${state.losses} ${label}`;
}
