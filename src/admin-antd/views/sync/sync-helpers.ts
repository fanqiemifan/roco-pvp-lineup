import type {
  SyncImportCounts,
  SyncImportItem,
  SyncImportPreview,
  SyncImportTournamentGroup,
} from '../../../../shared/types';

/** 数据同步视图的纯逻辑（排序 / 默认勾选 / 分组行构建），与 React 状态无关，便于单测。 */

export const SYNC_KIND_LABELS: Record<SyncImportItem['kind'], string> = {
  match: '比赛',
  player: '选手档案',
  team: '战队档案',
};

export const SYNC_ACTION_LABELS: Record<SyncImportItem['action'], string> = {
  add: '新增',
  update: '更新',
  skip: '跳过',
};

/** 预览条目排序权重：更新 → 新增 → 跳过（同档冲突优先） */
export const SYNC_ACTION_ORDER: Record<SyncImportItem['action'], number> = {
  update: 0,
  add: 1,
  skip: 2,
};

/** 云同步「确认/退回后后台刷新收件箱」哨兵：只更新红点与清单，不再重新弹确认台 */
export const AUTO_REFRESH_INBOX = '__auto__';

/** 本机在界面上的可读名称（备注名优先，没有就显示机器码） */
export function cloudMachineText(entry: { code: string; label: string }): string {
  return entry.label ? `${entry.label}（${entry.code}）` : `${entry.code} 号机`;
}

/** 勾选条目按动作计数（与导入预览 summary 同口径：只统计被勾选且非跳过的条目） */
export function countActions(items: SyncImportItem[]): SyncImportCounts {
  const counts: SyncImportCounts = { add: 0, update: 0, skip: 0 };
  items.forEach((item) => {
    counts[item.action] += 1;
  });
  return counts;
}

/** 预览条目排序：有变化的（更新 → 新增）在前，跳过在后；同一档里冲突优先 */
export function compareSyncItems(a: SyncImportItem, b: SyncImportItem): number {
  return SYNC_ACTION_ORDER[a.action] - SYNC_ACTION_ORDER[b.action] || Number(b.conflict) - Number(a.conflict);
}

/** 行权重（含冲突优先级），用于分组整体排序 */
export function syncRowRank(item: SyncImportItem): number {
  return SYNC_ACTION_ORDER[item.action] * 2 + (item.conflict ? 0 : 1);
}

export function defaultSyncSelection(preview: SyncImportPreview): string[] {
  return [...preview.matchItems, ...preview.playerItems, ...preview.teamItems]
    .filter((item) => item.action !== 'skip')
    .map((item) => item.key);
}

/** 预览弹窗默认查看的条目：优先第一处冲突，否则列表里排最前的那条（与列表排序同口径） */
export function defaultSyncActiveKey(preview: SyncImportPreview): string | null {
  const items = [...preview.matchItems, ...preview.playerItems, ...preview.teamItems];
  const matchItems = preview.matchItems;
  const conflict = items.find((item) => item.conflict);
  if (conflict) {
    return conflict.key;
  }
  return [...matchItems].sort(compareSyncItems)[0]?.key ?? items[0]?.key ?? null;
}

export type SyncPreviewRow = SyncImportItem | (SyncImportTournamentGroup & { isGroup: true; rowKey: string });

/** 系列赛 id -> 该组（含普通对局组 id = ''） */
export function buildSyncGroupOfMatchKey(
  groups: SyncImportTournamentGroup[],
): Map<string, SyncImportTournamentGroup> {
  const map = new Map<string, SyncImportTournamentGroup>();
  groups.forEach((group) => {
    group.matchKeys.forEach((key) => map.set(key, group));
  });
  return map;
}

/** 已取消勾选系列赛名下的比赛 key（这些行置灰、不可勾选） */
export function buildSyncExcludedMatchKeys(
  groups: SyncImportTournamentGroup[],
  excludedTournamentIds: string[],
): Set<string> {
  const keys = new Set<string>();
  groups.forEach((group) => {
    if (group.id && excludedTournamentIds.includes(group.id)) {
      group.matchKeys.forEach((key) => keys.add(key));
    }
  });
  return keys;
}

/** 可勾选条目的 key 集合（排除已取消勾选系列赛名下的比赛） */
export function buildSyncAvailableKeys(
  preview: SyncImportPreview | null,
  excludedMatchKeys: Set<string>,
): Set<string> {
  return new Set(
    [...(preview?.matchItems ?? []), ...(preview?.playerItems ?? []), ...(preview?.teamItems ?? [])]
      .filter((item) => item.action !== 'skip' && !excludedMatchKeys.has(item.key))
      .map((item) => item.key),
  );
}

/**
 * 表格数据：系列赛分组标题行 + 组内比赛行（普通对局单独一组），便于一眼区分归属。
 * 分组与组内都按「更新 → 新增 → 跳过、同档冲突优先」排序；折叠的组只保留标题行；
 * 没被任何分组收录的比赛条目（异常包）平铺兜底，避免「预览里有却看不见」。
 */
export function buildSyncPreviewRows(
  preview: SyncImportPreview | null,
  collapsedGroupKeys: string[],
): SyncPreviewRow[] {
  const groups = preview?.tournamentGroups ?? [];
  const matchRows = preview?.matchItems ?? [];
  const matchItemByKey = new Map(matchRows.map((item) => [item.key, item]));

  const sortKeys = (keys: string[]) => [...keys].sort((a, b) => {
    const itemA = matchItemByKey.get(a);
    const itemB = matchItemByKey.get(b);
    return itemA && itemB ? compareSyncItems(itemA, itemB) : 0;
  });
  const groupRank = (group: SyncImportTournamentGroup) => {
    let rank = Number.MAX_SAFE_INTEGER;
    group.matchKeys.forEach((key) => {
      const item = matchItemByKey.get(key);
      if (item) {
        rank = Math.min(rank, syncRowRank(item));
      }
    });
    return rank;
  };

  const rows: SyncPreviewRow[] = [];
  [...groups]
    .sort((a, b) => groupRank(a) - groupRank(b))
    .forEach((group) => {
      rows.push({ ...group, isGroup: true, rowKey: group.key });
      if (collapsedGroupKeys.includes(group.key)) {
        return;
      }
      sortKeys(group.matchKeys).forEach((key) => {
        const item = matchItemByKey.get(key);
        if (item) {
          rows.push(item);
        }
      });
    });

  const groupedKeys = new Set(groups.flatMap((group) => group.matchKeys));
  matchRows
    .filter((item) => !groupedKeys.has(item.key))
    .sort(compareSyncItems)
    .forEach((item) => rows.push(item));

  return rows;
}
