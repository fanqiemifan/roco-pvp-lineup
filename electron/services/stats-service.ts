import { getMatchStore } from './match-service.js';
import { spriteLookup } from './sprite-service.js';
import type { AppPaths } from './path-service.js';

export type StatsRankingRow = {
  key: string;
  name: string;
  displayName: string;
  spritePath: string;
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
 * 按选手 + 赛事标签计算精灵使用率/胜率排行（Top 10，按使用率降序），统计范围为全部历史对局。
 * - 使用率 = 登场只次 ÷ 总登场只次（同名精灵同局重复携带按只次计）
 * - 胜率 = 该精灵所在一侧获胜场次 ÷ 登场场次（同局左右双方携带同名精灵只计 1 场；镜像局双方同时携带按 0.5 胜计）
 */
export function getSpriteRanking(
  paths: AppPaths,
  options: { player: string | null; tag: string | null },
): { player: string | null; tag: string | null; totalPicks: number; rows: StatsRankingRow[] } {
  const lookup = spriteLookup(paths);
  const store = getMatchStore(paths);
  const player = typeof options.player === 'string' && options.player.trim() ? options.player.trim() : null;
  const tag = typeof options.tag === 'string' && options.tag.trim() ? options.tag.trim() : null;

  const acc = new Map<string, { picks: number; games: number; wins: number }>();
  let totalPicks = 0;

  const matches = store.matches.filter((match) => {
    if (player && match.leftPlayer !== player && match.rightPlayer !== player) {
      return false;
    }
    if (tag && !(match.tags ?? []).includes(tag)) {
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

  return { player, tag, totalPicks, rows: rows.slice(0, 10) };
}
