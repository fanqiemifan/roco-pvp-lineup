/**
 * MVP 结算画面（推流页面4）操作引导步骤。
 * 与赛事面板「当前比赛」的 buildProgressItems（lib/match.ts）同款引导条：
 * 载入胜方 → 选择精灵 → 标记 MVP → 显示结算，current 由当前状态推导；
 * 结算画面已在显示时 current = 步骤数，四步全部呈现完成态。
 */
export interface MvpProgressInput {
  /** 已载入胜方快照（mvp.winner 存在） */
  hasWinner: boolean;
  /** 已选入结算的精灵数 */
  assignedCount: number;
  /** 已标记至少一个 MVP */
  marked: boolean;
  /** 结算画面正在推流显示 */
  visible: boolean;
}

export function buildMvpProgressItems(state: MvpProgressInput): {
  current: number;
  items: Array<{ title: string }>;
} {
  let current = 0;
  if (state.visible) {
    current = 4;
  } else if (state.marked) {
    current = 3;
  } else if (state.assignedCount > 0) {
    current = 2;
  } else if (state.hasWinner) {
    current = 1;
  }
  return {
    current,
    items: [
      { title: '载入胜方' },
      { title: '选择精灵' },
      { title: '标记 MVP' },
      { title: '显示结算' },
    ],
  };
}
