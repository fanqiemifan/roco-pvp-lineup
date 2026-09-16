import type { GameRecord, MatchRecord, MatchStoreState, SpriteRecord } from '../../../shared/types';
import { DEFAULT_TAGS } from '../constants';
import type { PanelSide } from '../types';
import { formatDateTime } from './format';
import { getGameResultLabel, getGameStatusLabel, getCurrentGame } from './match';
import { resolveSpriteStatsName } from './sprite';

export function buildHistoryLineupEntries(
  game: GameRecord,
  side: PanelSide,
  spriteMap: Map<string, SpriteRecord>,
): Array<{ id: string; name: string; path: string } | null> {
  const slotSource = side === 'left' ? game.leftSlots : game.rightSlots;
  const lineupSource = side === 'left' ? game.leftLineup : game.rightLineup;
  const slotEntries = slotSource
    .filter((slot) => slot?.pet_id)
    .map((slot) => slot.pet_id as string);
  const source = slotEntries.length ? slotEntries : lineupSource;
  const entries: Array<{ id: string; name: string; path: string } | null> = source.slice(0, 6).map((petId) => {
    const sprite = spriteMap.get(petId);
    return {
      id: petId,
      name: sprite?.displayName ?? petId,
      path: sprite?.path ?? '',
    };
  });

  while (entries.length < 6) {
    entries.push(null);
  }

  return entries;
}

export function buildHistoryBattleEntries(
  game: GameRecord,
  spriteMap: Map<string, SpriteRecord>,
): Array<{ id: string; name: string; path: string; side: PanelSide } | null> {
  return [
    ...buildHistoryLineupEntries(game, 'left', spriteMap).map((entry) => (entry ? { ...entry, side: 'left' as const } : null)),
    ...buildHistoryLineupEntries(game, 'right', spriteMap).map((entry) => (entry ? { ...entry, side: 'right' as const } : null)),
  ];
}

export function getVisibleGames(record: MatchRecord) {
  return record.games.filter((game) => (
    game.status !== 'pending'
    || game.leftLineup.length > 0
    || game.rightLineup.length > 0
  ));
}

/**
 * 比赛历史展开行的小局可见性：在 getVisibleGames 基础上，额外显示
 * 「未开赛场次的当前小局」（待开始且还没有任何阵容）——否则新比赛在历史里
 * 连第一局的卡片都不出现，无法通过历史录入阵容（必须先去赛事面板录一只精灵）。
 * 还没轮到的空小局仍然隐藏。
 */
export function getHistoryVisibleGames(record: MatchRecord) {
  if (record.status === 'completed') {
    return getVisibleGames(record);
  }
  const currentGame = getCurrentGame(record);
  return record.games.filter((game) => (
    game.status !== 'pending'
    || game.leftLineup.length > 0
    || game.rightLineup.length > 0
    || (currentGame != null && currentGame.gameNumber === game.gameNumber)
  ));
}

/** 比赛历史「录入阵容」被锁定的原因；null = 可录入（当前小局且待开始） */
export type LineupEntryBlockReason = 'match-completed' | 'game-not-current' | 'game-started' | 'game-completed';

export const LINEUP_ENTRY_BLOCK_TEXT: Record<LineupEntryBlockReason, string> = {
  'match-completed': '比赛已完赛，不能录入阵容',
  'game-not-current': '还没轮到这一局，只能录入当前小局的阵容',
  'game-started': '该局已开始，请在赛事面板中修改阵容',
  'game-completed': '该局已结束，不能录入阵容',
};

/**
 * 仅「当前小局」且「待开始」可从比赛历史录入阵容（提前录入，不影响推流）：
 * 进行中的局走赛事面板（改了会推流，是有意为之），已结束的局锁定保护战绩。
 */
export function getLineupEntryBlockReason(match: MatchRecord, game: GameRecord): LineupEntryBlockReason | null {
  if (match.status === 'completed') {
    return 'match-completed';
  }
  const currentGame = getCurrentGame(match);
  if (!currentGame || currentGame.gameNumber !== game.gameNumber) {
    return 'game-not-current';
  }
  if (game.status === 'in_progress') {
    return 'game-started';
  }
  if (game.status === 'completed') {
    return 'game-completed';
  }
  return null;
}

export function buildHistoryTags(matches: MatchStoreState['matches']): string[] {
  const tagSet = new Set<string>();
  for (const tag of DEFAULT_TAGS) {
    tagSet.add(tag);
  }
  matches.forEach((match) => {
    (match.tags ?? []).forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet);
}

export function buildHistoryCsv(matches: MatchRecord[], spriteMap: Map<string, SpriteRecord>): string {
  const header = ['赛事ID', '完成时间', '左侧选手', '右侧选手', '比分', '赛制', '标签', '局数', '该局胜方', '该局状态', '左侧阵容', '右侧阵容'];
  const lines: string[][] = [];

  matches.forEach((match) => {
    const base = [
      match.id,
      match.completedAt ? formatDateTime(match.completedAt) : '',
      match.leftPlayer || '左侧',
      match.rightPlayer || '右侧',
      `${match.leftScore} : ${match.rightScore}`,
      `BO${match.bestOf}`,
      (match.tags ?? []).join('/'),
    ];
    const visibleGames = getVisibleGames(match);
    if (!visibleGames.length) {
      lines.push([...base, '', '', '', '', '']);
      return;
    }
    visibleGames.forEach((game) => {
      const leftNames = buildHistoryLineupEntries(game, 'left', spriteMap)
        .filter((entry): entry is { id: string; name: string; path: string } => Boolean(entry))
        .map((entry) => resolveSpriteStatsName(spriteMap.get(entry.id), entry.name))
        .join('/');
      const rightNames = buildHistoryLineupEntries(game, 'right', spriteMap)
        .filter((entry): entry is { id: string; name: string; path: string } => Boolean(entry))
        .map((entry) => resolveSpriteStatsName(spriteMap.get(entry.id), entry.name))
        .join('/');
      lines.push([
        ...base,
        String(game.gameNumber),
        getGameResultLabel(game),
        getGameStatusLabel(game.status),
        leftNames,
        rightNames,
      ]);
    });
  });

  return [header, ...lines].map((cells) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}
