import type { MatchRecord, MatchStoreState, SpriteRecord, TournamentRecord } from '../../../shared/types';
import { resolveSpriteStatsName, splitSpriteAttributes } from './sprite';
import { resolveMatchSemanticRound, resolveMatchStageTitle } from './tournament';

export type StatsMetricKey = 'pickRate' | 'gameRate';

export const STATS_METRIC_OPTIONS: Array<{ value: StatsMetricKey; label: string }> = [
  { value: 'pickRate', label: '使用率' },
  { value: 'gameRate', label: '上场率' },
];

export type StatsWindow = {
  player: string | null;
  tag: string | null;
  tournamentId: string | null;
};

/** 趋势轴上的一个阶段桶：key 用于取数，label 用于刻度显示 */
export type StatsStageBucket = { key: string; label: string };

export type SpriteUsageAccumulator = {
  picks: number;
  games: number;
  wins: number;
  deaths: number;
};

export type SpriteUsageRow = {
  key: string;
  name: string;
  spritePath: string;
  attributes: string[];
  picks: number;
  games: number;
  wins: number;
  deaths: number;
  winRate: number | null;
  usageRate: number;
  usagePercent: number;
  /** 系列赛趋势：所选系列赛下该精灵使用率 − 全量使用率（百分点）；未选择系列赛为 null */
  tournamentTrendDelta: number | null;
};

export type UsageStatsResult = {
  totalGames: number;
  totalPicks: number;
  distinctSprites: number;
  playerCount: number;
  attributeRows: Array<{ attribute: string; count: number; percent: number }>;
  stageAxis: StatsStageBucket[];
  spriteStageRate: Map<string, Map<string, number>>;
  rows: SpriteUsageRow[];
  spriteAcc: Map<string, SpriteUsageAccumulator>;
  spriteMeta: Map<string, { path: string; attributes: string[] }>;
};

function collectUsageStats(
  matches: MatchStoreState['matches'],
  spriteMap: Map<string, SpriteRecord>,
  window: StatsWindow,
): UsageStatsResult {
  const spriteAcc = new Map<string, SpriteUsageAccumulator>();
  const spriteMeta = new Map<string, { path: string; attributes: string[] }>();
  const attributeAcc = new Map<string, number>();
  const players = new Set<string>();
  let totalGames = 0;
  let totalPicks = 0;
  let attributeTotal = 0;

  matches.forEach((match) => {
    if (window.player && match.leftPlayer !== window.player && match.rightPlayer !== window.player) {
      return;
    }
    if (window.tag && !(match.tags ?? []).includes(window.tag)) {
      return;
    }
    // 系列赛维度：按 tournamentRef 精确匹配（同 id 才算同一场系列赛，不按名字）
    if (window.tournamentId && match.tournamentRef?.tournamentId !== window.tournamentId) {
      return;
    }
    if (match.leftPlayer) {
      players.add(match.leftPlayer);
    }
    if (match.rightPlayer) {
      players.add(match.rightPlayer);
    }

    match.games.forEach((game) => {
      // 数据统计只统计已登记胜负的小局：未结束（无胜者）的局整局不计
      if (game.status !== 'completed' || (game.winner !== 'left' && game.winner !== 'right')) {
        return;
      }
      const sides: Array<{ lineup: string[]; side: 'left' | 'right' }> = [
        { lineup: game.leftLineup, side: 'left' },
        { lineup: game.rightLineup, side: 'right' },
      ];
      if (!sides.some(({ lineup }) => lineup.length > 0)) {
        return;
      }

      let gameCounted = false;
      const appearances = new Map<string, { onLeft: boolean; onRight: boolean }>();
      sides.forEach(({ lineup, side }) => {
        lineup.forEach((petId) => {
          const sprite = spriteMap.get(petId);
          const name = resolveSpriteStatsName(sprite, petId);
          let acc = spriteAcc.get(name);
          if (!acc) {
            acc = { picks: 0, games: 0, wins: 0, deaths: 0 };
            spriteAcc.set(name, acc);
          }
          if (!spriteMeta.has(name)) {
            spriteMeta.set(name, {
              path: sprite?.path ?? '',
              attributes: sprite ? splitSpriteAttributes(sprite.attribute) : [],
            });
          }

          acc.picks += 1;
          totalPicks += 1;
          let appearance = appearances.get(name);
          if (!appearance) {
            appearance = { onLeft: false, onRight: false };
            appearances.set(name, appearance);
          }
          if (side === 'left') {
            appearance.onLeft = true;
          } else {
            appearance.onRight = true;
          }
          (spriteMeta.get(name)?.attributes ?? []).forEach((attribute) => {
            attributeAcc.set(attribute, (attributeAcc.get(attribute) ?? 0) + 1);
            attributeTotal += 1;
          });
          gameCounted = true;
        });
      });

      if (gameCounted) {
        totalGames += 1;
        for (const [name, appearance] of appearances) {
          const acc = spriteAcc.get(name);
          if (!acc) {
            continue;
          }
          acc.games += 1;
          if (appearance.onLeft && appearance.onRight) {
            acc.wins += 0.5;
          } else if (
            (appearance.onLeft && game.winner === 'left') ||
            (appearance.onRight && game.winner === 'right')
          ) {
            acc.wins += 1;
          }
        }
      }

      if (game.status === 'completed') {
        for (const slots of [game.leftSlots, game.rightSlots]) {
          for (const slot of slots) {
            if (!slot.pet_id || slot.healthEnabled === false || slot.healthPercent !== 0) {
              continue;
            }
            const name = resolveSpriteStatsName(spriteMap.get(slot.pet_id), slot.pet_id);
            let acc = spriteAcc.get(name);
            if (!acc) {
              acc = { picks: 0, games: 0, wins: 0, deaths: 0 };
              spriteAcc.set(name, acc);
            }
            acc.deaths += 1;
          }
        }
      }
    });
  });

  return {
    totalGames,
    totalPicks,
    distinctSprites: spriteAcc.size,
    playerCount: players.size,
    attributeRows: Array.from(attributeAcc.entries())
      .map(([attribute, count]) => ({
        attribute,
        count,
        percent: attributeTotal > 0 ? (count / attributeTotal) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count),
    stageAxis: [],
    spriteStageRate: new Map(),
    rows: [],
    spriteAcc,
    spriteMeta,
  };
}

/**
 * 比赛 → 统计阶段桶（趋势轴用）。非系列赛对局或孤儿引用返回 null（不进趋势轴）：
 * - 选定系列赛：桶 = 该系列赛的「阶段 · 语义轮次」（双败按 首轮/胜者组/败者组/决胜轮 拆分）；
 * - 未选系列赛：沿用按阶段名聚合（已知限制：同名阶段跨系列赛合并，界面提示先选系列赛）。
 */
function resolveMatchStageBucket(
  match: MatchRecord,
  recordById: Map<string, TournamentRecord>,
  tournamentId: string | null,
): { key: string; label: string; sort: string } | null {
  const ref = match.tournamentRef;
  const record = ref ? recordById.get(ref.tournamentId) : undefined;
  // 标题口径与比赛管理标签一致：季军赛报「季军赛」，不并入它挂靠的半决赛阶段
  const title = ref && record ? resolveMatchStageTitle(record, ref) : null;
  if (!ref || !record || !title) {
    return null;
  }
  if (tournamentId && record.id !== tournamentId) {
    return null;
  }
  if (!tournamentId) {
    return { key: `stage:${title}`, label: title, sort: match.createdAt || '' };
  }
  const round = resolveMatchSemanticRound(record, ref);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return {
    key: `${record.id}:${ref.stageIndex}:${round.key}`,
    label: round.label ? `${title} · ${round.label}` : title,
    sort: `${record.createdAt}|${pad(ref.stageIndex)}|${pad(ref.waveIndex)}|${pad(round.order)}`,
  };
}

/** 趋势轴：按时间锚排序的阶段桶序列（未选系列赛时聚合桶取最早一场比赛为锚点） */
export function buildStatsStageAxis(
  matches: MatchStoreState['matches'],
  tournaments: TournamentRecord[],
  tournamentId: string | null,
): StatsStageBucket[] {
  const recordById = new Map(tournaments.map((record) => [record.id, record]));
  const buckets = new Map<string, { bucket: StatsStageBucket; sort: string }>();
  matches.forEach((match) => {
    const resolved = resolveMatchStageBucket(match, recordById, tournamentId);
    if (!resolved) {
      return;
    }
    const existing = buckets.get(resolved.key);
    if (!existing) {
      buckets.set(resolved.key, { bucket: { key: resolved.key, label: resolved.label }, sort: resolved.sort });
    } else if (resolved.sort && (!existing.sort || resolved.sort < existing.sort)) {
      existing.sort = resolved.sort;
    }
  });
  return Array.from(buckets.values())
    .sort((left, right) => (left.sort < right.sort ? -1 : left.sort > right.sort ? 1 : 0))
    .map((entry) => entry.bucket);
}

export function buildUsageStats(
  matches: MatchStoreState['matches'],
  spriteMap: Map<string, SpriteRecord>,
  tournaments: TournamentRecord[],
  options: { player: string | null; tag: string | null; tournamentId: string | null; metric: StatsMetricKey },
): UsageStatsResult {
  const { player, tag, tournamentId, metric } = options;

  const current = collectUsageStats(matches, spriteMap, { player, tag, tournamentId });
  const all = collectUsageStats(matches, spriteMap, { player: null, tag: null, tournamentId: null });
  const seriesOnly = tournamentId
    ? collectUsageStats(matches, spriteMap, { player: null, tag: null, tournamentId })
    : null;

  const rateOf = (result: UsageStatsResult, name: string): number => {
    const acc = result.spriteAcc.get(name);
    if (!acc) {
      return 0;
    }
    const denominator = metric === 'pickRate' ? result.totalPicks : result.totalGames;
    if (!denominator) {
      return 0;
    }
    return (metric === 'pickRate' ? acc.picks : acc.games) / denominator;
  };

  // 趋势轴与逐桶使用率：桶内取数不受选手/标签筛选影响（与旧的逐标签口径一致）
  const stageAxis = buildStatsStageAxis(matches, tournaments, tournamentId);
  const recordById = new Map(tournaments.map((record) => [record.id, record]));
  const matchesByBucket = new Map<string, MatchStoreState['matches']>();
  matches.forEach((match) => {
    const resolved = resolveMatchStageBucket(match, recordById, tournamentId);
    if (!resolved) {
      return;
    }
    const list = matchesByBucket.get(resolved.key);
    if (list) {
      list.push(match);
    } else {
      matchesByBucket.set(resolved.key, [match]);
    }
  });

  const spriteStageRate = new Map<string, Map<string, number>>();
  stageAxis.forEach((bucket) => {
    const bucketStats = collectUsageStats(matchesByBucket.get(bucket.key) ?? [], spriteMap, {
      player: null,
      tag: null,
      tournamentId: null,
    });
    for (const [name, acc] of bucketStats.spriteAcc) {
      const denominator = metric === 'pickRate' ? bucketStats.totalPicks : bucketStats.totalGames;
      const rate = denominator > 0 ? (metric === 'pickRate' ? acc.picks : acc.games) / denominator : 0;
      let rates = spriteStageRate.get(name);
      if (!rates) {
        rates = new Map();
        spriteStageRate.set(name, rates);
      }
      rates.set(bucket.key, rate);
    }
  });

  const denominator = metric === 'pickRate' ? current.totalPicks || 1 : current.totalGames || 1;
  const rows: SpriteUsageRow[] = Array.from(current.spriteAcc.entries()).map(([name, acc]) => {
    const usageRate = (metric === 'pickRate' ? acc.picks : acc.games) / denominator;
    const tournamentTrendDelta = seriesOnly
      ? Math.round((rateOf(seriesOnly, name) - rateOf(all, name)) * 1000) / 10
      : null;
    const meta = current.spriteMeta.get(name);
    return {
      key: name,
      name,
      spritePath: meta?.path ?? '',
      attributes: meta?.attributes ?? [],
      picks: acc.picks,
      games: acc.games,
      wins: acc.wins,
      deaths: acc.deaths,
      winRate: acc.games > 0 ? acc.wins / acc.games : null,
      usageRate,
      usagePercent: Math.round(usageRate * 1000) / 10,
      tournamentTrendDelta,
    };
  });

  rows.sort((a, b) => b.usageRate - a.usageRate || b.picks - a.picks || a.name.localeCompare(b.name, 'zh-CN'));

  return { ...current, rows, stageAxis, spriteStageRate };
}

export function buildStatsCsv(rows: SpriteUsageRow[], metric: StatsMetricKey): string {
  const header = ['排名', '精灵', '属性', metric === 'pickRate' ? '使用率(%)' : '上场率(%)', '登场只次', '登场场次', '获胜场次', '胜率(%)', '阵亡次数'];
  const lines = rows.map((row, index) => [
    String(index + 1),
    row.name,
    row.attributes.join('/'),
    row.usagePercent.toFixed(1),
    String(row.picks),
    String(row.games),
    String(row.wins),
    row.winRate === null ? '' : (row.winRate * 100).toFixed(1),
    String(row.deaths),
  ]);
  return [header, ...lines].map((cells) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}