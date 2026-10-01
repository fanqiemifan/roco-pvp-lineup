import type { MatchRecord, MatchStoreState } from '../../../shared/types';
import { getCurrentGame } from './match';

/** 对局卡片上可直达的动作（右键菜单与 Drawer 面板共用一份判据） */
export type MatchCardAction = 'start' | 'winner-left' | 'winner-right' | 'undo' | 'redo';

export interface MatchActionAvailability {
  /** 该场是否就是「当前比赛」（推流画面正在展示的那一场；headless 动作不要求） */
  isCurrent: boolean;
  /** 可开始本次对局：未完赛 + 当前小局待开始 + 双方阵容已录 */
  canStart: boolean;
  /** 可登记胜负：当前小局进行中 */
  canRegister: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * 撤销栈可用性：优先按比赛查 `undo.byMatch`（服务端只透布尔，覆盖非当前比赛），
 * 缺失时回落到当前比赛的 `canUndo/canRedo`（与赛事面板原口径一致）。
 */
export function resolveUndoState(
  matchId: string | null | undefined,
  activeMatchId: string | null,
  undo: MatchStoreState['undo'] | null | undefined,
): { canUndo: boolean; canRedo: boolean } {
  if (!matchId || !undo) {
    return { canUndo: false, canRedo: false };
  }
  const perMatch = undo.byMatch?.[matchId];
  if (perMatch) {
    return { canUndo: perMatch.canUndo, canRedo: perMatch.canRedo };
  }
  return matchId === activeMatchId
    ? { canUndo: undo.canUndo, canRedo: undo.canRedo }
    : { canUndo: false, canRedo: false };
}

/**
 * 一场对局的动作可用性（菜单项置灰、Drawer 按钮禁用共用同一口径）。
 * 判据与赛事面板原实现保持一致：开始 = 当前小局 pending 且双方阵容非空；登记 = 当前小局 in_progress。
 */
export function deriveMatchActionAvailability(
  match: MatchRecord | null,
  activeMatchId: string | null,
  undo: MatchStoreState['undo'] | null | undefined,
): MatchActionAvailability {
  if (!match) {
    return { isCurrent: false, canStart: false, canRegister: false, canUndo: false, canRedo: false };
  }
  const currentGame = getCurrentGame(match);
  const completed = match.status === 'completed';
  return {
    isCurrent: match.id === activeMatchId,
    canStart: Boolean(
      !completed
      && currentGame
      && currentGame.status === 'pending'
      && currentGame.leftLineup.length > 0
      && currentGame.rightLineup.length > 0,
    ),
    canRegister: Boolean(!completed && currentGame && currentGame.status === 'in_progress'),
    ...resolveUndoState(match.id, activeMatchId, undo),
  };
}

/**
 * 菜单里的胜负项用选手名代替「左侧/右侧」（左边是小明 → 「小明赢了」）；
 * 名字为空时回落到原文案，避免出现「赢了」这种没有主语的菜单项。
 */
export function formatWinnerActionLabel(side: 'left' | 'right', playerName: string | null | undefined): string {
  const name = String(playerName ?? '').trim();
  if (name) {
    return `${name}赢了`;
  }
  return side === 'left' ? '左侧赢了' : '右侧赢了';
}
