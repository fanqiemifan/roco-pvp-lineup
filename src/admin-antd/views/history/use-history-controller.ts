import { useMemo, useState } from 'react';
import type { Key } from 'react';
import { App } from 'antd';

import type {
  MatchRecord,
  MatchStoreState,
  Page6State,
  Page7State,
  Page8State,
  Page14State,
  PanelState,
  ScoreboardState,
  StageStandings,
} from '../../../../shared/types';
import type { AdvanceRankPayload } from '../../components/AdvanceRankCard';
import type { MatchPushKind, MatchPushPayload } from '../../components/MatchPushCard';
import {
  buildHistoryCsv,
  buildHistoryTags,
  buildHistoryTournamentFilters,
  getAdminVisibleMatches,
  getEffectiveTournamentId,
  PLAIN_HISTORY_MATCH_FILTER,
} from '../../lib/history';
import { requestJson } from '../../lib/request';
import { buildSpriteLookup } from '../../lib/sprite';
import { useAdminData } from '../../data/use-admin-data';

export type HistorySortKey = 'updatedAt' | 'score' | 'bestOf' | 'status';

export type HistorySortState = {
  key: HistorySortKey | null;
  order: 'asc' | 'desc' | null;
};

/** 「无标签」筛选特殊值（与真实标签区隔） */
export const UNCATEGORIZED_HISTORY_TAG = '__uncategorized__';

/** 状态排序的稳定序：进行中 → 待开始 → 已结束 */
const HISTORY_STATUS_RANK: Record<MatchRecord['status'], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

/** 比赛回收站的一行（GET /api/matches/recycle-bin 的 entries） */
export interface RecycleBinMatchRow {
  matchId: string;
  leftPlayer: string;
  rightPlayer: string;
  bestOf: number;
  status: 'pending' | 'in_progress' | 'completed';
  deletedAt: string;
}

/**
 * 比赛管理（history）视图的本地控制器（M6 从 Dashboard 搬入）。
 *
 * 只有真正跨视图的数据走 `useAdminData()`（比赛 store / 系列赛 / 精灵 / 各推流页 / 云状态 /
 * 操作提示），其余（筛选、勾选、展开、标签行内编辑、比赛回收站、推送 loading 等）都是本视图状态，
 * 离开视图即重置。纯派生值（可见对局、筛选结果、提示条）在这里一次算齐。
 */
export function useHistoryController() {
  const { message } = App.useApp();
  const {
    matchStore,
    tournaments,
    sprites,
    page6,
    page7,
    page8,
    page14,
    page14Standings,
    locallyRemoved,
    recycleBin,
    cloudStatus,
    cloudAckedMatchIds,
    historyNotice,
    setHistoryNotice,
    applyServerState,
    setPage14,
    setPage14Standings,
  } = useAdminData();

  // === 视图本地状态 ===
  const [selectedHistoryKeys, setSelectedHistoryKeys] = useState<Key[]>([]);
  const [expandedHistoryKeys, setExpandedHistoryKeys] = useState<Key[]>([]);
  const [historyTagFilter, setHistoryTagFilter] = useState<string | null>(null);
  // 系列赛维度筛选（独立于标签）：PLAIN_HISTORY_MATCH_FILTER=普通对局，或具体系列赛 id
  const [historyTournamentFilter, setHistoryTournamentFilter] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState<HistorySortState>({ key: 'updatedAt', order: 'desc' });
  const [batchTagOpen, setBatchTagOpen] = useState(false);
  const [batchTagValue, setBatchTagValue] = useState<string | null>(null);
  const [batchTagSaving, setBatchTagSaving] = useState(false);
  const [editingHistoryTagMatchId, setEditingHistoryTagMatchId] = useState<string | null>(null);
  const [editingHistoryTagValues, setEditingHistoryTagValues] = useState<string[]>([]);
  const [savingHistoryTagMatchId, setSavingHistoryTagMatchId] = useState<string | null>(null);
  // === 比赛回收站（普通删除 7 天内逐条恢复） ===
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [recycleBinRows, setRecycleBinRows] = useState<RecycleBinMatchRow[]>([]);
  const [recycleSelectedKeys, setRecycleSelectedKeys] = useState<string[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleRestoring, setRecycleRestoring] = useState(false);
  // 三个推流选场弹窗的推送中状态（key: page6/page7/page8）
  const [matchPushLoading, setMatchPushLoading] = useState<Record<string, boolean>>({});
  const [page14Saving, setPage14Saving] = useState(false);

  // === 派生数据 ===
  const spriteMap = buildSpriteLookup(sprites);
  const allHistoryTags = buildHistoryTags(matchStore.matches);
  const tournamentNameMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament.name])),
    [tournaments],
  );
  // 标签列派生「阶段 · 轮次」只读 Tag 用：id → 完整系列赛记录
  const tournamentRecordMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament])),
    [tournaments],
  );
  const tournamentIdSet = useMemo(() => new Set(tournamentNameMap.keys()), [tournamentNameMap]);
  const locallyRemovedIdSet = useMemo(
    () => new Set(locallyRemoved.map((tournament) => tournament.id)),
    [locallyRemoved],
  );
  // 回收站系列赛（grace 墓碑）：对局仍在 matches.json，管理面视图层一并隐藏（与本机移除同款）
  const recycleBinIdSet = useMemo(
    () => new Set(recycleBin.map((tournament) => tournament.id)),
    [recycleBin],
  );
  const adminVisibleMatches = useMemo(
    () => getAdminVisibleMatches(matchStore.matches, locallyRemovedIdSet, recycleBinIdSet),
    [matchStore.matches, locallyRemovedIdSet, recycleBinIdSet],
  );
  const historyTournamentFilters = useMemo(
    () => buildHistoryTournamentFilters(matchStore.matches, tournaments),
    [matchStore.matches, tournaments],
  );
  const normalizedHistorySearch = historySearch.trim().toLowerCase();
  const filteredMatches = adminVisibleMatches.filter((match) => {
    if (historyTagFilter === UNCATEGORIZED_HISTORY_TAG) {
      if ((match.tags ?? []).length > 0) {
        return false;
      }
    } else if (historyTagFilter && !(match.tags ?? []).includes(historyTagFilter)) {
      return false;
    }
    // 系列赛维度与标签维度 AND 叠加：普通对局=无有效归属；否则按系列赛 id 精确过滤
    if (historyTournamentFilter) {
      const effectiveTournamentId = getEffectiveTournamentId(match, tournamentIdSet);
      if (historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER) {
        if (effectiveTournamentId) {
          return false;
        }
      } else if (effectiveTournamentId !== historyTournamentFilter) {
        return false;
      }
    }
    if (!normalizedHistorySearch) {
      return true;
    }
    return [
      String(match.leftPlayer || ''),
      String(match.rightPlayer || ''),
      String(match.id || ''),
    ].some((value) => value.toLowerCase().includes(normalizedHistorySearch));
  });
  const sortedMatches = [...filteredMatches].sort(compareHistoryMatches);
  /** 筛选状态提示：被筛掉多少场、当前按什么筛（避免「同步来的比赛看不见」被误判成丢数据） */
  const historyFilterSummary = (() => {
    const parts: string[] = [];
    if (historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER) {
      parts.push('只看普通对局');
    } else if (historyTournamentFilter) {
      parts.push(`只看系列赛「${tournamentNameMap.get(historyTournamentFilter) ?? historyTournamentFilter}」`);
    }
    if (historyTagFilter) {
      parts.push(historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? '只看无标签' : `只看标签「${historyTagFilter}」`);
    }
    if (normalizedHistorySearch) {
      parts.push(`搜索「${historySearch.trim()}」`);
    }
    if (!parts.length) {
      return '';
    }
    const hidden = adminVisibleMatches.length - filteredMatches.length;
    return `当前${parts.join(' + ')}：显示 ${filteredMatches.length} / 共 ${adminVisibleMatches.length} 场`
      + (hidden > 0 ? `（有 ${hidden} 场被筛选条件隐藏，刚同步来的比赛可能在其中）` : '');
  })();
  const cloudPendingIdSet = new Set(cloudStatus?.pending.matches.map((item) => item.matchId) ?? []);
  const cloudAckedSet = new Set(cloudAckedMatchIds);

  // === 排序 ===
  function compareHistoryMatches(a: MatchRecord, b: MatchRecord): number {
    if (!historySort.key || !historySort.order) {
      return 0;
    }
    let value = 0;
    switch (historySort.key) {
      case 'updatedAt': {
        const ta = new Date(a.updatedAt).getTime() || 0;
        const tb = new Date(b.updatedAt).getTime() || 0;
        value = ta - tb;
        break;
      }
      case 'score': {
        const da = Math.abs((a.leftScore ?? 0) - (a.rightScore ?? 0));
        const db = Math.abs((b.leftScore ?? 0) - (b.rightScore ?? 0));
        value = da - db;
        break;
      }
      case 'bestOf': {
        value = (a.bestOf ?? 0) - (b.bestOf ?? 0);
        break;
      }
      case 'status': {
        value = HISTORY_STATUS_RANK[a.status] - HISTORY_STATUS_RANK[b.status];
        break;
      }
    }
    return historySort.order === 'asc' ? value : -value;
  }

  function cycleHistorySort(key: HistorySortKey) {
    setHistorySort((prev) => {
      if (prev.key !== key) {
        return { key, order: 'asc' };
      }
      if (prev.order === 'asc') {
        return { key, order: 'desc' };
      }
      return { key: null, order: null };
    });
  }

  // === 删除 / 批量操作 ===
  async function deleteHistoryMatches(matchIds: string[]) {
    if (!matchIds.length) {
      return;
    }

    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; scoreboard?: ScoreboardState; panels?: PanelState[] }>('/api/matches/batch-delete', {
        method: 'POST',
        json: { matchIds },
      });
      applyServerState({
        store: data.store,
        scoreboard: data.scoreboard,
        panels: data.panels,
      });
      setSelectedHistoryKeys([]);
      setHistoryNotice({ tone: 'success', text: `已删除 ${matchIds.length} 场赛事` });
      message.success(`已删除 ${matchIds.length} 场赛事`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleBatchTag() {
    const ids = selectedHistoryKeys.map(String);
    const selected = matchStore.matches.filter((match) => ids.includes(match.id));
    if (!selected.length) {
      return;
    }
    setBatchTagValue(null);
    setBatchTagOpen(true);
  }

  async function submitBatchTag() {
    const ids = selectedHistoryKeys.map(String);
    if (!ids.length || !batchTagValue) {
      return;
    }
    setBatchTagSaving(true);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState }>('/api/matches/batch-tags', {
        method: 'POST',
        json: { matchIds: ids, tags: [batchTagValue] },
      });
      applyServerState({ store: data.store });
      const added = batchTagValue;
      setSelectedHistoryKeys([]);
      setBatchTagOpen(false);
      setBatchTagValue(null);
      setHistoryNotice({ tone: 'success', text: `已为 ${ids.length} 场赛事添加标签「${added}」` });
      message.success(`已为 ${ids.length} 场赛事添加标签「${added}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchTagSaving(false);
    }
  }

  // === 标签行内编辑 ===
  async function saveMatchTags(matchId: string, tags: string[]) {
    const nextTags = Array.from(new Set(tags.map((item) => item.trim()).filter(Boolean))).slice(0, 10);

    setSavingHistoryTagMatchId(matchId);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState }>(`/api/matches/${encodeURIComponent(matchId)}/tags`, {
        method: 'PATCH',
        json: { tags: nextTags },
      });
      applyServerState({ store: data.store });
      setEditingHistoryTagMatchId(null);
      setEditingHistoryTagValues([]);
      setHistoryNotice({ tone: 'success', text: '标签已更新' });
      message.success('标签已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingHistoryTagMatchId(null);
    }
  }

  function beginInlineTagEdit(match: MatchRecord) {
    setEditingHistoryTagMatchId(match.id);
    setEditingHistoryTagValues(match.tags ?? []);
  }

  async function commitInlineTagEdit(matchId: string) {
    if (savingHistoryTagMatchId === matchId) {
      return;
    }

    await saveMatchTags(matchId, editingHistoryTagValues);
  }

  // === 比赛回收站 ===
  async function openMatchRecycleBin(): Promise<void> {
    setRecycleBinOpen(true);
    setRecycleLoading(true);
    try {
      const data = await requestJson<{ entries: RecycleBinMatchRow[] }>('/api/matches/recycle-bin');
      setRecycleBinRows(data.entries);
      setRecycleSelectedKeys([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRecycleLoading(false);
    }
  }

  async function restoreRecycleMatches(): Promise<void> {
    if (!recycleSelectedKeys.length) {
      return;
    }
    setRecycleRestoring(true);
    try {
      const data = await requestJson<{ success: boolean; store?: MatchStoreState; pagePush?: { page6?: Page6State; page7?: Page7State; page8?: Page8State } }>('/api/matches/restore-deleted', {
        method: 'POST',
        json: { matchIds: recycleSelectedKeys },
      });
      applyServerState({
        store: data.store,
        ...(data.pagePush ?? {}),
      });
      message.success(`已恢复 ${recycleSelectedKeys.length} 场赛事`);
      // 刷新回收站清单（被恢复的条目已移出）
      await openMatchRecycleBin();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRecycleRestoring(false);
    }
  }

  // === 推流选场 / 晋级积分榜 ===
  // 三个功能卡片的统一推送：选场弹窗确认后调用，失败时抛错以保持弹窗打开
  async function pushMatchesForPage(kind: MatchPushKind, payload: MatchPushPayload): Promise<void> {
    setMatchPushLoading((prev) => ({ ...prev, [kind]: true }));
    let nextText = '';
    try {
      if (kind === 'page6') {
        const data = await requestJson<{ success: boolean; state: Page6State }>('/api/page6', {
          method: 'POST',
          json: payload,
        });
        applyServerState({ page6: data.state });
        nextText = data.state.matchIds.length
          ? `已推送 ${data.state.matchIds.length} 场比赛结果到推流页面6`
          : '已清空推流页面6 的比赛结果';
      } else if (kind === 'page8') {
        const data = await requestJson<{ success: boolean; state: Page8State }>('/api/page8', {
          method: 'POST',
          json: payload,
        });
        applyServerState({ page8: data.state });
        nextText = data.state.matchIds.length
          ? `已推送 ${data.state.matchIds.length} 场对局预告到推流页面8`
          : '已清空推流页面8 的对局预告';
      } else {
        const data = await requestJson<{ success: boolean; state: Page7State }>('/api/page7', {
          method: 'POST',
          json: payload,
        });
        applyServerState({ page7: data.state });
        nextText = data.state.matchIds.length
          ? `已推送 ${data.state.matchIds.length} 场对局到推流页面7（战绩详情）`
          : '已清空推流页面7 的战绩详情';
      }
      setHistoryNotice({ tone: 'success', text: nextText });
      message.success(nextText);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setMatchPushLoading((prev) => ({ ...prev, [kind]: false }));
    }
  }

  /**
   * 保存晋级积分榜配置（卡片内联的阶段切换/翻页与弹窗确认共用）。
   * 失败时抛错给调用方（弹窗据此保持打开），此处负责提示与 saving 标记。
   */
  async function savePage14Settings(payload: AdvanceRankPayload): Promise<void> {
    setPage14Saving(true);
    try {
      const data = await requestJson<{ success: boolean; state: Page14State; standings: StageStandings | null }>('/api/page14', {
        method: 'POST',
        json: payload,
      });
      setPage14(data.state);
      setPage14Standings(data.standings);
      message.success('晋级积分榜已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPage14Saving(false);
    }
  }

  // === 导出 ===
  function exportHistoryCsv() {
    const csv = buildHistoryCsv(sortedMatches, spriteMap, tournaments);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '比赛管理.csv';
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${sortedMatches.length} 场赛事历史`);
  }

  return {
    // 数据层透出（渲染与卡片消费）
    matchStore,
    tournaments,
    sprites,
    spriteMap,
    page6,
    page7,
    page8,
    page14,
    page14Standings,
    cloudStatus,
    historyNotice,
    setHistoryNotice,
    // 派生
    allHistoryTags,
    tournamentNameMap,
    tournamentRecordMap,
    adminVisibleMatches,
    historyTournamentFilters,
    filteredMatches,
    sortedMatches,
    historyFilterSummary,
    cloudPendingIdSet,
    cloudAckedSet,
    // 筛选 / 排序
    historyTagFilter,
    setHistoryTagFilter,
    historyTournamentFilter,
    setHistoryTournamentFilter,
    historySearch,
    setHistorySearch,
    historySort,
    cycleHistorySort,
    // 勾选 / 展开
    selectedHistoryKeys,
    setSelectedHistoryKeys,
    expandedHistoryKeys,
    setExpandedHistoryKeys,
    // 批量标签
    batchTagOpen,
    setBatchTagOpen,
    batchTagValue,
    setBatchTagValue,
    batchTagSaving,
    handleBatchTag,
    submitBatchTag,
    // 行内标签编辑
    editingHistoryTagMatchId,
    editingHistoryTagValues,
    setEditingHistoryTagValues,
    savingHistoryTagMatchId,
    beginInlineTagEdit,
    commitInlineTagEdit,
    saveMatchTags,
    // 回收站
    recycleBinOpen,
    setRecycleBinOpen,
    recycleBinRows,
    recycleSelectedKeys,
    setRecycleSelectedKeys,
    recycleLoading,
    recycleRestoring,
    openMatchRecycleBin,
    restoreRecycleMatches,
    // 删除 / 推送 / 导出
    deleteHistoryMatches,
    pushMatchesForPage,
    savePage14Settings,
    exportHistoryCsv,
    matchPushLoading,
    page14Saving,
  };
}

export type HistoryController = ReturnType<typeof useHistoryController>;
