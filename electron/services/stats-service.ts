import { getMatchStore } from './match-service.js';
import { spriteLookup } from './sprite-service.js';
import { getTournamentStore } from './tournament-service.js';
import type { AppPaths } from './path-service.js';
import type { Page15ReplayPayload, Page15ReplayStep } from '../../shared/types.js';

export type StatsRankingRow = {
  key: string;
  name: string;
  displayName: string;
  spritePath: string;
  /** 精灵头像 URL（resources/sprites-icon）；空串时展示端回退立绘 spritePath */
  iconPath: string;
  attributeIcon1: string;
  attributeIcon2: string;
  picks: number;
  games: number;
  wins: number;
  usagePercent: number;
  winRate: number | null;
};

function spriteDisplayName(sprite: unknown): string {
  if (!sprite || typeof sprite !== 'object') {
    return '';
  }
  const record = sprite as Record<string, unknown>;
  return String(
    record.name
    ?? record.displayName
    ?? record.filename
    ?? '',
  ).trim();
}

function spriteField(sprite: unknown, key: string): string {
  if (!sprite || typeof sprite !== 'object') {
    return '';
  }
  return String((sprite as Record<string, unknown>)[key] ?? '').trim();
}

/**
 * 按选手 + 系列赛 / 标签计算精灵使用率/胜率排行（默认 Top 10，按使用率降序），统计范围为全部历史对局。
 * - 系列赛过滤按 tournamentRef.tournamentId 精确匹配（同 id 才算同一场系列赛，不按名字），并回传系列赛名供页面5标题展示；
 * - limit：返回条数上限（默认 10，夹取 1..999；推流页面15 传大值拿全量后前端按所选字段自行排序）；
 * - 使用率 = 登场只次 ÷ 总登场只次（同名精灵同局重复携带按只次计）
 * - 胜率 = 该精灵所在一侧获胜场次 ÷ 登场场次（同局左右双方携带同名精灵只计 1 场；镜像局双方同时携带按 0.5 胜计）
 */
export function getSpriteRanking(
  paths: AppPaths,
  options: { player: string | null; tag: string | null; tournamentId: string | null; stageIndex?: number | null; limit?: number },
): {
  player: string | null;
  tag: string | null;
  tournamentId: string | null;
  stageIndex: number | null;
  tournamentName: string;
  totalPicks: number;
  rows: StatsRankingRow[];
} {
  const lookup = spriteLookup(paths);
  const store = getMatchStore(paths);
  const player = typeof options.player === 'string' && options.player.trim() ? options.player.trim() : null;
  const tag = typeof options.tag === 'string' && options.tag.trim() ? options.tag.trim() : null;
  const tournamentId = typeof options.tournamentId === 'string' && options.tournamentId.trim()
    ? options.tournamentId.trim()
    : null;
  // 阶段过滤：仅命中带 tournamentRef 且 stageIndex 相同的对局（无 ref 的普通对局在过滤时一律排除）
  const stageIndex = Number.isFinite(options.stageIndex) ? Math.trunc(Number(options.stageIndex)) : null;
  const tournamentName = tournamentId
    ? getTournamentStore(paths).find((record) => record.id === tournamentId)?.name ?? ''
    : '';

  const acc = new Map<string, { picks: number; games: number; wins: number }>();
  let totalPicks = 0;

  const matches = store.matches.filter((match) => {
    if (player && match.leftPlayer !== player && match.rightPlayer !== player) {
      return false;
    }
    if (tag && !(match.tags ?? []).includes(tag)) {
      return false;
    }
    if (tournamentId && match.tournamentRef?.tournamentId !== tournamentId) {
      return false;
    }
    if (stageIndex !== null && match.tournamentRef?.stageIndex !== stageIndex) {
      return false;
    }
    return true;
  });

  for (const match of matches) {
    for (const game of match.games) {
      // 排行只统计已登记胜负的小局：未结束（无胜者）的局整局不计
      if (game.status !== 'completed' || (game.winner !== 'left' && game.winner !== 'right')) {
        continue;
      }
      const sides: Array<{ lineup: string[]; side: 'left' | 'right' }> = [
        { lineup: game.leftLineup, side: 'left' },
        { lineup: game.rightLineup, side: 'right' },
      ];
      if (!sides.some(({ lineup }) => lineup.length > 0)) {
        continue;
      }

      const appearances = new Map<string, { onLeft: boolean; onRight: boolean }>();
      for (const { lineup, side } of sides) {
        for (const petId of lineup) {
          const sprite = lookup.get(petId) ?? null;
          const key = sprite ? sprite.id : petId;
          let entry = acc.get(key);
          if (!entry) {
            entry = { picks: 0, games: 0, wins: 0 };
            acc.set(key, entry);
          }
          entry.picks += 1;
          totalPicks += 1;
          let appearance = appearances.get(key);
          if (!appearance) {
            appearance = { onLeft: false, onRight: false };
            appearances.set(key, appearance);
          }
          if (side === 'left') {
            appearance.onLeft = true;
          } else {
            appearance.onRight = true;
          }
        }
      }

      for (const [key, appearance] of appearances) {
        const entry = acc.get(key);
        if (!entry) {
          continue;
        }
        entry.games += 1;
        if (appearance.onLeft && appearance.onRight) {
          entry.wins += 0.5;
        } else if (
          (appearance.onLeft && game.winner === 'left') ||
          (appearance.onRight && game.winner === 'right')
        ) {
          entry.wins += 1;
        }
      }
    }
  }

  const rows: StatsRankingRow[] = [];
  for (const [key, entry] of acc) {
    const sprite = lookup.get(key) ?? null;
    rows.push({
      key,
      name: sprite ? spriteDisplayName(sprite) : key,
      displayName: sprite ? spriteField(sprite, 'displayName') : '',
      spritePath: sprite ? sprite.path : '',
      iconPath: sprite ? spriteField(sprite, 'iconUrl') : '',
      attributeIcon1: sprite ? spriteField(sprite, 'attributeIcon1') : '',
      attributeIcon2: sprite ? spriteField(sprite, 'attributeIcon2') : '',
      picks: entry.picks,
      games: entry.games,
      wins: entry.wins,
      usagePercent: totalPicks > 0 ? Math.round((entry.picks / totalPicks) * 1000) / 10 : 0,
      winRate: entry.games > 0 ? entry.wins / entry.games : null,
    });
  }

  rows.sort((a, b) => b.usagePercent - a.usagePercent || b.picks - a.picks);

  // limit 默认 10（页面5 口径不变）；非法值归一默认，上限 999 防误传超大值
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(999, Math.max(1, Math.round(rawLimit))) : 10;

  return { player, tag, tournamentId, stageIndex, tournamentName, totalPicks, rows: rows.slice(0, limit) };
}

export type Page15ReplaySpeed = 'slow' | 'normal' | 'fast';

/**
 * 构建「推流页面15 数据回放」载荷：把某系列赛 [fromStage, toStage] 阶段范围内的对局按场序
 * 排列，逐步下发该场对榜单的增量贡献，展示端从空榜开始逐场累加播出演化过程。
 * 统计口径与 getSpriteRanking 完全一致（只统计已登记胜负的小局；镜像局 wins 记 0.5），
 * 保证回放终态 = 实时排行终态。非法输入直接抛错（路由层转 400）。
 */
export function buildPage15Replay(
  paths: AppPaths,
  options: { tournamentId: string; fromStage: number; toStage: number; speed?: Page15ReplaySpeed; play?: boolean },
): Page15ReplayPayload {
  const tournamentId = typeof options.tournamentId === 'string' ? options.tournamentId.trim() : '';
  const tournament = getTournamentStore(paths).find((record) => record.id === tournamentId);
  if (!tournament) {
    throw new Error('系列赛不存在，请重新选择');
  }
  const stageCount = tournament.stages.length;
  const fromStage = Number.isFinite(options.fromStage) ? Math.trunc(Number(options.fromStage)) : Number.NaN;
  const toStage = Number.isFinite(options.toStage) ? Math.trunc(Number(options.toStage)) : Number.NaN;
  if (!Number.isInteger(fromStage) || !Number.isInteger(toStage)
    || fromStage < 0 || toStage >= stageCount || fromStage > toStage) {
    throw new Error('阶段范围无效：需满足 0 ≤ 起始阶段 ≤ 结束阶段，且在系列赛阶段范围内');
  }
  const speed: Page15ReplaySpeed = options.speed === 'slow' || options.speed === 'fast' ? options.speed : 'normal';

  const lookup = spriteLookup(paths);
  const stageName = (index: number): string => tournament.stages[index]?.name ?? `阶段${index + 1}`;

  const matches = getMatchStore(paths).matches
    .filter((match) => match.tournamentRef?.tournamentId === tournamentId
      && match.tournamentRef.stageIndex !== undefined
      && match.tournamentRef.stageIndex >= fromStage
      && match.tournamentRef.stageIndex <= toStage)
    // 场序：阶段升序 → 波次升序 → 创建时间 → id（同波内保持创建顺序）
    .sort((a, b) => (a.tournamentRef!.stageIndex! - b.tournamentRef!.stageIndex!)
      || ((a.tournamentRef!.waveIndex ?? 0) - (b.tournamentRef!.waveIndex ?? 0))
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));

  // 累计容器同时充当「出场精灵集合」：回放结束后各 key 的终态 = 实时排行终态
  const acc = new Map<string, { picks: number; games: number; wins: number }>();
  const stepSprites = new Set<string>();
  const steps: Page15ReplayStep[] = [];

  for (const match of matches) {
    const stepDelta = new Map<string, { picks: number; games: number; wins: number }>();
    let leftGameWins = 0;
    let rightGameWins = 0;
    for (const game of match.games) {
      if (game.status !== 'completed' || (game.winner !== 'left' && game.winner !== 'right')) {
        continue;
      }
      if (game.winner === 'left') {
        leftGameWins += 1;
      } else {
        rightGameWins += 1;
      }
      const sides: Array<{ lineup: string[]; side: 'left' | 'right' }> = [
        { lineup: game.leftLineup, side: 'left' },
        { lineup: game.rightLineup, side: 'right' },
      ];
      if (!sides.some(({ lineup }) => lineup.length > 0)) {
        continue;
      }
      const appearances = new Map<string, { onLeft: boolean; onRight: boolean }>();
      for (const { lineup, side } of sides) {
        for (const petId of lineup) {
          const sprite = lookup.get(petId) ?? null;
          const key = sprite ? sprite.id : petId;
          let entry = stepDelta.get(key);
          if (!entry) {
            entry = { picks: 0, games: 0, wins: 0 };
            stepDelta.set(key, entry);
          }
          entry.picks += 1;
          let appearance = appearances.get(key);
          if (!appearance) {
            appearance = { onLeft: false, onRight: false };
            appearances.set(key, appearance);
          }
          if (side === 'left') {
            appearance.onLeft = true;
          } else {
            appearance.onRight = true;
          }
        }
      }
      for (const [key, appearance] of appearances) {
        const entry = stepDelta.get(key);
        if (!entry) {
          continue;
        }
        entry.games += 1;
        if (appearance.onLeft && appearance.onRight) {
          entry.wins += 0.5;
        } else if (
          (appearance.onLeft && game.winner === 'left') ||
          (appearance.onRight && game.winner === 'right')
        ) {
          entry.wins += 1;
        }
      }
    }
    if (!stepDelta.size) {
      // 该场没有任何已完赛小局（未开始/进行中且无完赛局），不产生回放步
      continue;
    }
    const deltas: Page15ReplayStep['deltas'] = [];
    for (const [key, entry] of stepDelta) {
      const accEntry = acc.get(key) ?? { picks: 0, games: 0, wins: 0 };
      accEntry.picks += entry.picks;
      accEntry.games += entry.games;
      accEntry.wins += entry.wins;
      acc.set(key, accEntry);
      stepSprites.add(key);
      deltas.push({ key, picks: entry.picks, games: entry.games, wins: entry.wins });
    }
    steps.push({
      matchId: match.id,
      stageIndex: match.tournamentRef!.stageIndex!,
      stageName: stageName(match.tournamentRef!.stageIndex!),
      leftPlayer: match.leftPlayer,
      rightPlayer: match.rightPlayer,
      score: `${leftGameWins}:${rightGameWins}`,
      deltas,
    });
  }

  const sprites: Page15ReplayPayload['sprites'] = {};
  for (const key of stepSprites) {
    const sprite = lookup.get(key) ?? null;
    sprites[key] = {
      name: sprite ? spriteDisplayName(sprite) : key,
      displayName: sprite ? spriteField(sprite, 'displayName') : '',
      iconPath: sprite ? spriteField(sprite, 'iconUrl') : '',
      spritePath: sprite ? sprite.path : '',
    };
  }

  return {
    tournamentId,
    tournamentName: tournament.name,
    fromStage,
    toStage,
    speed,
    play: options.play === true,
    sprites,
    steps,
  };
}
