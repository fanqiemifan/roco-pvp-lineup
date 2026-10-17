import type { MatchRecord, TournamentRecord } from '../../../shared/types';

/**
 * 状态 → 文案 / 颜色 的**唯一**映射表。
 *
 * 原先同一个「进行中」在四处各写一份：
 * - lib/match.ts getMatchStatusColor / getMatchStatusLabel
 * - components/TournamentNodeCard.tsx 的 STATUS_COLOR
 * - lib/tournament.ts getTournamentStatusMeta（含文案）
 * - 若干 JSX 里的三元表达式
 * 现在全部从这里取，新增状态只改这一处。
 */
export interface StatusMeta {
  label: string;
  color: string;
}

export type MatchStatus = MatchRecord['status'];
export type TournamentStatus = TournamentRecord['status'];

export const MATCH_STATUS_META: Record<MatchStatus, StatusMeta> = {
  pending: { label: '待开始', color: 'default' },
  in_progress: { label: '进行中', color: 'processing' },
  completed: { label: '已完成', color: 'success' },
};

export const TOURNAMENT_STATUS_META: Record<TournamentStatus, StatusMeta> = {
  setup: { label: '待开赛', color: 'default' },
  running: { label: '进行中', color: 'processing' },
  completed: { label: '已完赛', color: 'success' },
};

/** 晋级图节点卡片的状态色（与上面同一套语义，只是类型来自 BracketCard） */
export const BRACKET_STATUS_COLOR: Record<'pending' | 'in_progress' | 'completed', string> = {
  pending: MATCH_STATUS_META.pending.color,
  in_progress: MATCH_STATUS_META.in_progress.color,
  completed: MATCH_STATUS_META.completed.color,
};

export function getMatchStatusMeta(status: MatchStatus): StatusMeta {
  return MATCH_STATUS_META[status] ?? MATCH_STATUS_META.pending;
}

export function getTournamentStatusMeta(status: TournamentStatus): StatusMeta {
  return TOURNAMENT_STATUS_META[status] ?? TOURNAMENT_STATUS_META.setup;
}
