import { useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';

import { SYNC_BUNDLE_MAX_BYTES } from '../../../../shared/constants';
import type {
  CloudSyncAckSource,
  CloudSyncKeyGuardResult,
  CloudSyncRole,
  CloudSyncStatus,
  CloudSyncVersion,
  MachineCodeGuardResult,
  SyncBundle,
  SyncConflictMode,
  SyncImportItem,
  SyncImportPreview,
  SyncImportResult,
  SyncImportTournamentGroup,
} from '../../../../shared/types';
import { useAdminData } from '../../data/use-admin-data';
import { formatDateTime } from '../../lib/format';
import { requestJson } from '../../lib/request';
import { formatStageRoundLabel, resolveMatchSemanticRound } from '../../lib/tournament';
import {
  AUTO_REFRESH_INBOX,
  SYNC_ACTION_LABELS,
  SYNC_KIND_LABELS,
  buildSyncAvailableKeys,
  buildSyncExcludedMatchKeys,
  buildSyncGroupOfMatchKey,
  buildSyncPreviewRows,
  cloudMachineText,
  compareSyncItems,
  countActions,
  defaultSyncActiveKey,
  defaultSyncSelection,
} from './sync-helpers';
import type { SyncPreviewRow } from './sync-helpers';

type CloudBusyKind = 'push' | 'pull' | 'upload' | 'check' | 'apply' | 'assignment' | 'poll' | '';

function initialPeerDraft(status: CloudSyncStatus | null): string {
  if (!status || status.config.role !== 'main') {
    return '';
  }
  return status.roster
    .filter((entry) => entry.code !== status.config.machineCode)
    .map((entry) => entry.code)
    .join(', ');
}

/**
 * 数据同步视图的本地状态与动作（M2 从 Dashboard 搬入）。
 *
 * 只有真正跨视图的数据走 `useAdminData()`（比赛 / 系列赛 / 云状态 / 应用服务端状态），
 * 其余（同步包草稿、云同步设置草稿、预览勾选、确认台、指派工作台、弹窗开关）都是本视图状态。
 */
export function useSyncController() {
  const { message, modal } = App.useApp();
  const {
    applyServerState,
    loadInitialData,
    cloudStatus,
    applyCloudStatus,
    postCloud,
    pollCloudStatus: pollCloudStatusApi,
    machineCode,
    setMachineCode,
    setHistoryNotice,
    matchStore,
    tournaments,
  } = useAdminData();

  const [machineCodeInput, setMachineCodeInput] = useState(machineCode);
  const [machineCodeSaving, setMachineCodeSaving] = useState(false);
  const [syncExportInclProfiles, setSyncExportInclProfiles] = useState(true);
  const [syncExportInclAvatars, setSyncExportInclAvatars] = useState(true);
  const [syncExporting, setSyncExporting] = useState(false);
  // 选中的同步包文件与解析出的预览；确认导入前不写入任何数据
  const [syncFile, setSyncFile] = useState<File | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncImportPreview | null>(null);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncConflictMode>('newer');
  const [syncSelectedKeys, setSyncSelectedKeys] = useState<string[]>([]);
  // 预览弹窗右侧差异面板当前查看的条目 key
  const [syncActiveKey, setSyncActiveKey] = useState<string | null>(null);
  const [syncIncludeAvatars, setSyncIncludeAvatars] = useState(true);
  // 覆盖已有头像：默认只补缺（本机已有头像保持不动），勾选后用包内图片覆盖同档案头像
  const [syncOverwriteAvatars, setSyncOverwriteAvatars] = useState(false);
  const [syncImporting, setSyncImporting] = useState(false);
  // 云同步设置区草稿（本地编辑，点「保存设置」才落 config.json）
  const [cloudKeyDraft, setCloudKeyDraft] = useState(cloudStatus?.config.syncKey ?? '');
  const [cloudTokenDraft, setCloudTokenDraft] = useState(cloudStatus?.config.syncToken ?? '');
  const [cloudRoleDraft, setCloudRoleDraft] = useState<CloudSyncRole>(cloudStatus?.config.role ?? 'main');
  const [cloudWorkerUrlDraft, setCloudWorkerUrlDraft] = useState(cloudStatus?.config.workerUrl ?? '');
  const [cloudLabelDraft, setCloudLabelDraft] = useState(cloudStatus?.config.machineLabel ?? '');
  const [cloudPeerDraft, setCloudPeerDraft] = useState(() => initialPeerDraft(cloudStatus));
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudTesting, setCloudTesting] = useState(false);
  // 换房间守卫：改「房间号」时服务端回 409 + guard，弹窗让用户选「重置旧状态 / 原样保留」再重试（缺省拒绝保存）
  const [cloudRoomGuard, setCloudRoomGuard] = useState<{ action: 'save' | 'test'; guard: CloudSyncKeyGuardResult } | null>(null);
  const [cloudBusy, setCloudBusy] = useState<CloudBusyKind>('');
  // 云端数据走与「导入同步包」同一套预览：flow 区分「拉取待合并」与「主控确认台」
  const [cloudPreviewFlow, setCloudPreviewFlow] = useState<'pull' | 'incoming' | null>(null);
  const [cloudAckSource, setCloudAckSource] = useState<CloudSyncAckSource | null>(null);
  const [cloudAckSources, setCloudAckSources] = useState<CloudSyncAckSource[]>([]);
  const [cloudAckCode, setCloudAckCode] = useState('');
  const [cloudDistInfo, setCloudDistInfo] = useState('');
  // 指派工作台（按比赛勾选 / 按波次批量）
  const [cloudAssignOpen, setCloudAssignOpen] = useState(false);
  const [cloudAssignDraft, setCloudAssignDraft] = useState<Record<string, string>>({});
  // 预览里被取消勾选的系列赛 id（随导入一起提交：整条不导入，含它名下的比赛）
  const [syncExcludedTournamentIds, setSyncExcludedTournamentIds] = useState<string[]>([]);
  const [syncCollapsedGroupKeys, setSyncCollapsedGroupKeys] = useState<string[]>([]);

  const tournamentNameMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament.name])),
    [tournaments],
  );
  // 比赛管理标签列派生「阶段 · 轮次」只读 Tag 用：id → 完整系列赛记录
  const tournamentRecordMap = useMemo(
    () => new Map(tournaments.map((tournament) => [tournament.id, tournament])),
    [tournaments],
  );

  /** 与旧 applyCloudStatus 同口径：只填空草稿；保存 / 测试后 force 覆盖全部 */
  function hydrateCloudDrafts(next: CloudSyncStatus, force: boolean) {
    setCloudKeyDraft((prev) => (force || !prev ? next.config.syncKey : prev));
    setCloudTokenDraft((prev) => (force || !prev ? next.config.syncToken : prev));
    setCloudWorkerUrlDraft((prev) => (force || !prev ? next.config.workerUrl : prev));
    setCloudLabelDraft((prev) => (force || !prev ? next.config.machineLabel : prev));
    setCloudPeerDraft((prev) => {
      if (!force && prev) {
        return prev;
      }
      return next.config.role === 'main'
        ? next.roster.filter((entry) => entry.code !== next.config.machineCode).map((entry) => entry.code).join(', ')
        : '';
    });
    setCloudRoleDraft(next.config.role);
  }

  // 配置首次到达 / 变更时回填草稿；轮询只更新状态对象、配置签名不变，不会覆盖正在编辑的草稿
  const cloudConfigSignature = cloudStatus
    ? [
      cloudStatus.config.syncKey,
      cloudStatus.config.syncToken,
      cloudStatus.config.workerUrl,
      cloudStatus.config.machineLabel,
      cloudStatus.config.role,
      cloudStatus.config.machineCode,
    ].join('\u0000')
    : '';
  const hydratedConfigRef = useRef('');
  useEffect(() => {
    if (!cloudStatus || hydratedConfigRef.current === cloudConfigSignature) {
      return;
    }
    hydratedConfigRef.current = cloudConfigSignature;
    hydrateCloudDrafts(cloudStatus, false);
  }, [cloudConfigSignature]);

  // 本机标识由数据层持有（初始加载 / 保存后）：同步到输入框
  useEffect(() => {
    setMachineCodeInput(machineCode);
  }, [machineCode]);

  async function saveMachineCode(confirmChange = false) {
    setMachineCodeSaving(true);
    try {
      const result = await requestJson<{
        success: boolean;
        config: { port: number; machineCode: string };
        syncConfig?: CloudSyncStatus;
      }>('/api/runtime-config', {
        method: 'POST',
        json: { machineCode: machineCodeInput, confirmMachineCodeChange: confirmChange },
      });
      setMachineCode(result.config.machineCode);
      setMachineCodeInput(result.config.machineCode);
      if (result.syncConfig) {
        applyCloudStatus(result.syncConfig);
        hydrateCloudDrafts(result.syncConfig, true);
      }
      message.success(
        result.config.machineCode
          ? `本机标识已设为 ${result.config.machineCode}，新比赛编号将带该前缀`
          : '已清空本机标识：新比赛沿用旧编号格式（两机同跑请分别设置 A / B）',
      );
    } catch (error) {
      const guard = (error as { guard?: MachineCodeGuardResult }).guard;
      if (guard?.requireConfirm && !confirmChange) {
        // 改码丢所有权（坑 1）：本地还有内嵌旧码的系列赛，必须人工二次确认
        setMachineCodeSaving(false);
        modal.confirm({
          title: '确认修改机器码？',
          content: guard.message,
          okText: '确认修改',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => saveMachineCode(true),
        });
        return;
      }
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setMachineCodeSaving(false);
    }
  }

  async function exportSyncBundle() {
    setSyncExporting(true);
    try {
      const result = await requestJson<{ success: boolean; bundle: SyncBundle }>('/api/sync/export', {
        method: 'POST',
        json: {
          includeProfiles: syncExportInclProfiles,
          includeAvatars: syncExportInclProfiles && syncExportInclAvatars,
        },
      });

      const blob = new Blob([JSON.stringify(result.bundle, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      link.href = url;
      link.download = `roco-sync-${result.bundle.machine || 'X'}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`;
      link.click();
      URL.revokeObjectURL(url);
      message.success(`已导出同步包（${result.bundle.matches.length} 场比赛）`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncExporting(false);
    }
  }

  /** 冲突批量处理：accept = true 全部用包内覆盖（勾选），false 全部保留本机（取消勾选） */
  function resolveSyncConflicts(accept: boolean) {
    if (!syncPreview) {
      return;
    }
    const conflictKeys = syncPreview.matchItems.filter((item) => item.conflict).map((item) => item.key);
    setSyncSelectedKeys((prev) => (accept
      ? Array.from(new Set([...prev, ...conflictKeys]))
      : prev.filter((key) => !conflictKeys.includes(key))));
  }

  async function loadSyncPreview(file: File, mode: SyncConflictMode) {
    setSyncPreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);
      const result = await requestJson<{ success: boolean; preview: SyncImportPreview }>('/api/sync/preview', {
        method: 'POST',
        body: formData,
      });
      setSyncPreview(result.preview);
      setSyncSelectedKeys(defaultSyncSelection(result.preview));
      setSyncActiveKey(defaultSyncActiveKey(result.preview));
      setSyncIncludeAvatars(true);
      setSyncOverwriteAvatars(false);
    } catch (error) {
      setSyncPreview(null);
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncPreviewLoading(false);
    }
  }

  function handleSyncFile(file: File) {
    if (file.size > SYNC_BUNDLE_MAX_BYTES) {
      message.error('同步包超过大小上限（64MB），请在导出时关闭「包含头像与 logo」后重试');
      return;
    }
    setSyncFile(file);
    void loadSyncPreview(file, syncMode);
  }

  function closeSyncPreview() {
    setSyncPreview(null);
    setSyncFile(null);
    setSyncSelectedKeys([]);
    setSyncActiveKey(null);
    setSyncExcludedTournamentIds([]);
    setSyncCollapsedGroupKeys([]);
  }

  async function applySyncPreview() {
    if (!syncFile) {
      return;
    }
    setSyncImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', syncFile);
      formData.append('mode', syncMode);
      formData.append('accepted', JSON.stringify(syncSelectedKeys));
      formData.append('includeAvatars', syncIncludeAvatars ? 'true' : 'false');
      formData.append('overwriteAvatars', syncOverwriteAvatars ? 'true' : 'false');
      formData.append('excludeTournamentIds', JSON.stringify(syncExcludedTournamentIds));

      const result = await requestJson<{ success: boolean; result: SyncImportResult }>('/api/sync/import', {
        method: 'POST',
        body: formData,
      });

      if (result.result.profiles) {
        applyServerState({ store: result.result.store, profiles: result.result.profiles });
      } else {
        applyServerState({ store: result.result.store });
      }

      const applied = result.result.applied;
      const avatarCount = result.result.avatarsWritten.players + result.result.avatarsWritten.teams;
      const tournamentInfo = result.result.tournaments;
      // 系列赛编排自动合并（不参与勾选）：有变化时在摘要里带上；写回推进额外标注
      const tournamentSegment = tournamentInfo.added + tournamentInfo.updated + tournamentInfo.skipped > 0
        ? `；系列赛 新增 ${tournamentInfo.added} / 更新 ${tournamentInfo.updated} / 跳过 ${tournamentInfo.skipped}`
          + (tournamentInfo.advanced ? '（已补写回推进）' : '')
        : '';
      const summary = `比赛 新增 ${applied.match.add} / 更新 ${applied.match.update} / 跳过 ${applied.match.skip}；`
        + `档案 新增 ${applied.player.add + applied.team.add} / 更新 ${applied.player.update + applied.team.update}；`
        + `${syncOverwriteAvatars ? '头像写入' : '头像补缺'} ${avatarCount} 张${tournamentSegment}`;
      setHistoryNotice({ tone: 'success', text: `同步包导入完成：${summary}` });
      message.success('同步包导入完成');
      result.result.warnings.forEach((warning) => message.warning(warning));
      closeSyncPreview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncImporting(false);
    }
  }

  /* ==================== 云同步（点击式：主控分发/确认台，分控同步/回传） ==================== */

  /**
   * 保存云同步设置。改「房间号」时服务端会先拦一次（409 + guard）：本机旧房间的同步状态
   * （版本水位 / 已确认集 / 回传水位 / 名册 / 指派）不带房间标识，必须由用户选「重置」还是「保留」。
   */
  async function saveCloudSettings(cloudStateAction?: 'reset' | 'keep') {
    setCloudSaving(true);
    try {
      const result = await requestJson<{ success: boolean; status: CloudSyncStatus }>('/api/cloud-sync/config', {
        method: 'POST',
        json: {
          syncKey: cloudKeyDraft,
          syncToken: cloudTokenDraft,
          role: cloudRoleDraft,
          workerUrl: cloudWorkerUrlDraft,
          machineLabel: cloudLabelDraft,
          cloudStateAction,
          peerCodes: cloudRoleDraft === 'main'
            ? cloudPeerDraft.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean)
            : undefined,
        },
      });
      applyCloudStatus(result.status);
      hydrateCloudDrafts(result.status, true);
      message.success(cloudStateAction === 'reset'
        ? '云同步设置已保存，本机旧房间的同步状态已清空'
        : '云同步设置已保存');
    } catch (error) {
      const guard = (error as { guard?: CloudSyncKeyGuardResult }).guard;
      if (guard?.requireConfirm && !cloudStateAction) {
        setCloudRoomGuard({ action: 'save', guard });
        return;
      }
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudSaving(false);
    }
  }

  async function testCloudWorker(cloudStateAction?: 'reset' | 'keep') {
    if (!cloudWorkerUrlDraft.trim()) {
      message.warning('请先填 Worker 地址（形如 https://roco-sync.xxx.workers.dev）');
      return;
    }
    setCloudTesting(true);
    try {
      // 检测在线会先把地址/密钥/令牌按当前草稿存下来（/health 本身不需要它们），省一步「保存设置」；
      // 因此这里同样可能被换房间守卫拦下（房间号变了 + 本机还留着旧房间状态）
      const result = await requestJson<{ success: boolean; ok: boolean; message: string; status: CloudSyncStatus }>(
        '/api/cloud-sync/test',
        {
          method: 'POST',
          json: {
            workerUrl: cloudWorkerUrlDraft,
            syncKey: cloudKeyDraft,
            syncToken: cloudTokenDraft,
            cloudStateAction,
          },
        },
      );
      if (result.status) {
        applyCloudStatus(result.status);
        hydrateCloudDrafts(result.status, true);
      }
      if (result.ok) {
        message.success(result.message);
      } else {
        // 失败原因明确指出是网络还是地址，不要只说「不可达」
        message.error({ content: result.message, duration: 8 });
      }
    } catch (error) {
      const guard = (error as { guard?: CloudSyncKeyGuardResult }).guard;
      if (guard?.requireConfirm && !cloudStateAction) {
        setCloudRoomGuard({ action: 'test', guard });
        return;
      }
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudTesting(false);
    }
  }

  /** 换房间守卫的选择：带选择把刚才被拦下的动作（保存 / 测试连通）重跑一次 */
  function resolveCloudRoomGuard(cloudStateAction: 'reset' | 'keep') {
    const pending = cloudRoomGuard;
    setCloudRoomGuard(null);
    if (!pending) {
      return;
    }
    if (pending.action === 'test') {
      void testCloudWorker(cloudStateAction);
      return;
    }
    void saveCloudSettings(cloudStateAction);
  }

  /** 主控「上传给其他电脑」：把本机赛事资料整体发到云端 */
  async function pushCloudBundle() {
    setCloudBusy('push');
    try {
      const result = await postCloud<{ data: { bytes: number; matchCount: number; tournamentCount: number }; version: CloudSyncVersion }>(
        '/api/cloud-sync/push',
      );
      const info = `已上传第 ${result.version.v} 版 · ${formatDateTime(result.version.at)} · ${Math.max(1, Math.round(result.data.bytes / 1024))} KB · 含 ${result.data.matchCount} 场比赛 / ${result.data.tournamentCount} 个系列赛`;
      setCloudDistInfo(info);
      message.success('已上传，请让其他电脑等半分钟后点「从云端获取最新」');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 分控「从云端获取最新」：拉取 + 预览（确认后才合并，与「导入同步包」同一套界面） */
  async function pullCloudBundle() {
    setCloudBusy('pull');
    try {
      const result = await postCloud<{ preview: SyncImportPreview; data: { dist: string } }>('/api/cloud-sync/pull');
      setCloudPreviewFlow('pull');
      // B1「记住上次排除」：上次确认合并时排除的系列赛，本次预览默认继续排除（墓碑永不入列——删除指令不可取消）
      const remembered = new Set(result.status.excludedTournamentIds ?? []);
      const defaultExcludedGroups = (result.preview.tournamentGroups ?? [])
        .filter((group) => group.id && remembered.has(group.id) && !group.tombstone);
      const defaultExcludedIds = defaultExcludedGroups.map((group) => group.id);
      const defaultExcludedKeys = new Set(defaultExcludedGroups.flatMap((group) => group.matchKeys));
      setSyncExcludedTournamentIds(defaultExcludedIds);
      setSyncCollapsedGroupKeys([]);
      setSyncPreview(result.preview);
      setSyncSelectedKeys(defaultSyncSelection(result.preview).filter((key) => !defaultExcludedKeys.has(key)));
      setSyncActiveKey(defaultSyncActiveKey(result.preview));
      setCloudDistInfo(`内容来自 ${result.data.dist} 号机`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** B1：清除「默认排除」记忆（本机持久化），并把本次预览的排除全部恢复导入 */
  async function clearRememberedExclusions(): Promise<void> {
    try {
      await postCloud('/api/cloud-sync/excluded-tournaments', { tournamentIds: [] });
      setSyncExcludedTournamentIds([]);
      setSyncSelectedKeys((prev) => Array.from(new Set([
        ...prev,
        ...syncTournamentGroups.flatMap((group) => group.matchKeys),
      ])));
      message.success('已清除默认排除记忆，本次预览已全部恢复导入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 分控「交回赛果」：把本机已登记、还没被确认的赛果一起交回去 */
  async function uploadCloudResults() {
    setCloudBusy('upload');
    try {
      const result = await postCloud<{ data: { seq: number; count: number }; submittedAt: string }>(
        '/api/cloud-sync/upload',
      );
      message.success(`已交回 ${result.data.count} 场赛果，等主控电脑确认`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 主控「查看其他电脑交回的赛果」：与导入预览同一套差异面板 */
  async function checkCloudInbox(code?: string) {
    setCloudBusy('check');
    try {
      const result = await postCloud<{ data: { sources: CloudSyncAckSource[]; source: CloudSyncAckSource | null } }>(
        '/api/cloud-sync/check',
        code ? { code } : {},
      );
      const sources = result.data.sources;
      if (!sources.length) {
        if (code !== AUTO_REFRESH_INBOX) {
          message.info('暂时没有待确认的赛果：其他电脑还没交回，或都已经确认过了');
        }
        return;
      }
      // 后台自动刷新（确认/退回之后）只更新红点与待确认清单，不重新弹窗打断用户
      if (code === AUTO_REFRESH_INBOX) {
        setCloudAckSources(sources);
        return;
      }
      const source = result.data.source ?? sources[0];
      setCloudAckSources(sources);
      setCloudAckSource(source);
      setCloudAckCode(source.code);
      const preview: SyncImportPreview = {
        meta: { app: '', schema: 1, machine: source.code, exportedAt: source.submittedAt },
        sameMachine: false,
        mode: 'bundle',
        matchItems: source.items.map((entry) => entry.item),
        playerItems: [],
        teamItems: [],
        summary: {
          match: countActions(source.items.map((entry) => entry.item)),
          player: { add: 0, update: 0, skip: 0 },
          team: { add: 0, update: 0, skip: 0 },
        },
        avatars: {
          players: { fill: 0, existing: 0, unmatched: 0 },
          teams: { fill: 0, existing: 0, unmatched: 0 },
        },
      };
      setCloudPreviewFlow('incoming');
      setSyncExcludedTournamentIds([]);
      setSyncCollapsedGroupKeys([]);
      setSyncPreview(preview);
      setSyncSelectedKeys(source.selectableKeys);
      setSyncActiveKey(defaultSyncActiveKey(preview));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 确认台切换分控端 */
  async function switchCloudAckSource(code: string) {
    const source = cloudAckSources.find((item) => item.code === code);
    if (!source) {
      return;
    }
    setCloudAckSource(source);
    setCloudAckCode(code);
    const preview: SyncImportPreview | null = syncPreview
      ? {
        ...syncPreview,
        meta: { ...syncPreview.meta, machine: source.code, exportedAt: source.submittedAt },
        matchItems: source.items.map((entry) => entry.item),
        summary: {
          ...syncPreview.summary,
          match: countActions(source.items.map((entry) => entry.item)),
        },
      }
      : null;
    if (preview) {
      setSyncPreview(preview);
      setSyncSelectedKeys(source.selectableKeys);
      setSyncActiveKey(defaultSyncActiveKey(preview));
    }
  }

  /** 云同步确认（拉取合并 / 确认台确认）——都用同一套勾选结果 */
  async function applyCloudPreview() {
    if (!cloudPreviewFlow) {
      return;
    }
    setCloudBusy('apply');
    try {
      if (cloudPreviewFlow === 'pull') {
        const result = await postCloud<{ data: { applied: SyncImportPreview['summary']; warnings: string[] } }>(
          '/api/cloud-sync/apply',
          { accepted: syncSelectedKeys, mode: syncMode, excludeTournamentIds: syncExcludedTournamentIds },
        );
        const applied = result.data.applied;
        message.success(`已更新本机数据：新增 ${applied.match.add} 场 / 更新 ${applied.match.update} 场 / 无变化 ${applied.match.skip} 场`);
        result.data.warnings.forEach((warning) => message.warning(warning));
        // 拉取下的数据可能带来新比赛/新系列赛，重新拉一次全量状态
        void loadInitialData();
      } else {
        const result = await postCloud<{ data: { acked: string[]; warnings: string[] }; result: SyncImportResult }>(
          '/api/cloud-sync/confirm',
          { code: cloudAckCode, accepted: syncSelectedKeys },
        );
        applyServerState(result.result.profiles
          ? { store: result.result.store, profiles: result.result.profiles }
          : { store: result.result.store });
        const updated = result.data.acked.length - result.result.applied.match.skip;
        if (updated > 0) {
          message.success(`已确认 ${result.data.acked.length} 场赛果（其中 ${updated} 场写入了本机），并自动推进了下一轮`);
        } else {
          message.success(`已确认 ${result.data.acked.length} 场赛果：本机内容本来就一致，只给对方回了「收到了」`);
        }
        result.data.warnings.forEach((warning) => message.warning(warning));
        // 确认完先把弹窗关掉（曾漏掉这一步：确认后弹窗不关，还停在原条目上）
        closeCloudPreview();
        // 可能还有别的电脑交了赛果：后台刷新确认台状态，刷新结果只影响红点/列表，不重新弹窗
        void checkCloudInbox(AUTO_REFRESH_INBOX);
        return;
      }
      closeCloudPreview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 主控驳回：不写本地、不通知对方，让对方改完再交一次 */
  async function rejectCloudInbox() {
    if (!cloudAckCode) {
      return;
    }
    setCloudBusy('apply');
    try {
      await postCloud('/api/cloud-sync/reject', { code: cloudAckCode });
      message.info(`已退回 ${cloudAckCode} 号机交回的赛果：本机数据没有任何改动，请对方改正后重新「交回赛果」`);
      // 与确认一致：先关弹窗，再后台刷新收件箱（刷新不再重新弹窗）
      closeCloudPreview();
      void checkCloudInbox(AUTO_REFRESH_INBOX);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 分控「无需改动，标记为已处理」：预览里没有可写入内容时收尾状态，避免「有新内容」一直挂着 */
  async function markCloudPullReviewed() {
    setCloudBusy('apply');
    try {
      const result = await postCloud<{ data: { appliedVersion: number } }>('/api/cloud-sync/skip');
      message.success(`已把这版云端内容标记为已处理（本机无需改动，当前第 ${result.data.appliedVersion} 版）`);
      closeCloudPreview();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  function closeCloudPreview() {
    setCloudPreviewFlow(null);
    setCloudAckSource(null);
    setCloudAckCode('');
    closeSyncPreview();
  }

  /** 指派工作台：打开时以当前指派规则为草稿 */
  function openCloudAssign() {
    setCloudAssignDraft({ ...(cloudStatus?.assignment ?? {}) });
    setCloudAssignOpen(true);
  }

  async function saveCloudAssignDraft() {
    setCloudBusy('assignment');
    try {
      const result = await postCloud<{ status: CloudSyncStatus }>('/api/cloud-sync/assignment', {
        overrides: cloudAssignDraft,
      });
      applyCloudStatus(result.status);
      hydrateCloudDrafts(result.status, false);
      setCloudAssignOpen(false);
      message.success('已保存。记得点一次「上传给其他电脑」，对方才会收到最新的登记安排');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudBusy('');
    }
  }

  /** 手动刷新同步状态：loading 属于本视图，轮询函数只负责请求与提示 */
  async function refreshCloudStatus() {
    setCloudBusy('poll');
    try {
      await pollCloudStatusApi(false);
    } finally {
      setCloudBusy('');
    }
  }

  // === 云同步派生展示（红点 / 版本对比 / 最后通信时间） ===
  const cloudInboxCount = cloudStatus?.inbox.reduce((sum, entry) => sum + entry.pending.length, 0) ?? 0;
  const cloudLiveBadge = (() => {
    const status = cloudStatus;
    if (!status?.configured) {
      return '';
    }
    if (status.config.role === 'main') {
      return cloudInboxCount ? `有 ${cloudInboxCount} 场待确认` : '';
    }
    const hasNew = Boolean(status.version) && status.version!.v > status.appliedVersion;
    const pending = status.pending.count;
    if (hasNew) {
      return '云端有新内容';
    }
    // 「已交回等确认」不是「新内容」：不要用同一句话，否则用户会以为红点清不掉
    if (pending > 0) {
      const unconfirmed = status.pending.unconfirmedCount;
      return unconfirmed > 0 ? `${unconfirmed} 场已交回，等主控确认` : `${pending} 场待交回`;
    }
    return '';
  })();
  const cloudVersionText = (() => {
    const status = cloudStatus;
    if (!status) {
      return '';
    }
    const version = status.version;
    if (!version) {
      return '云端还没有内容：等主控电脑上传后，点「从云端获取最新」';
    }
    const synced = version.v === status.appliedVersion ? '本机已是最新' : '本机还没更新，请点「从云端获取最新」';
    const main = status.roster.find((entry) => entry.code === version.from);
    return `云端第 ${version.v} 版 · ${formatDateTime(version.at)} · ${synced}`
      + (main ? ` · 来自主控电脑 ${cloudMachineText(main)}` : '')
      + (status.lastContact.pulledAt ? ` · 上次获取 ${formatDateTime(status.lastContact.pulledAt)}` : '');
  })();

  // === 云同步状态卡的展示数据（版本对比 / 待办 / 本机动作时间线） ===
  /** 本机相对「云端最新版本」的同步状态：分控端用已处理版本判断，主控端本身没有可拉取的副本 */
  const cloudSyncState = (() => {
    const status = cloudStatus;
    if (!status) {
      return { tone: 'idle' as const, label: '未配置', hint: '' };
    }
    if (status.config.role === 'main') {
      return {
        tone: 'main' as const,
        label: '主控电脑',
        hint: '负责上传数据与确认其他电脑交回的赛果',
      };
    }
    if (!status.version) {
      return { tone: 'idle' as const, label: '云端暂无内容', hint: '等主控电脑上传后再获取' };
    }
    if (status.version.v > status.appliedVersion) {
      return {
        tone: 'warn' as const,
        label: '本机不是最新',
        hint: `本机已处理到第 ${status.appliedVersion} 版，点「从云端获取最新」`,
      };
    }
    return {
      tone: 'ok' as const,
      label: '本机已是最新',
      hint: status.appliedVersion ? `已处理第 ${status.appliedVersion} 版` : '',
    };
  })();
  /** 本机待办（分控＝待交回/等确认，主控＝待确认其他电脑的赛果） */
  const cloudTodo = (() => {
    const status = cloudStatus;
    if (!status?.configured) {
      return { count: 0, label: '未启用', hint: '填好设置即可使用' };
    }
    if (status.config.role === 'main') {
      return cloudInboxCount
        ? { count: cloudInboxCount, label: `${cloudInboxCount} 场待确认`, hint: '点「查看其他电脑交回的赛果」' }
        : { count: 0, label: '没有待确认', hint: '其他电脑交回赛果后会出现在这里' };
    }
    const pending = status.pending.count;
    if (pending > 0) {
      const unconfirmed = status.pending.unconfirmedCount;
      return unconfirmed > 0
        ? {
          count: pending,
          label: `${unconfirmed} 场已交回，等主控确认`,
          hint: pending > unconfirmed ? `另有 ${pending - unconfirmed} 场待交回` : '等主控电脑确认后会自动清除',
        }
        : { count: pending, label: `${pending} 场待交回`, hint: '点「交回赛果」把登记结果发给主控' };
    }
    return { count: 0, label: '没有待办', hint: '本机登记并交回后会自动出现在这里' };
  })();
  /** 本机动作时间线（按时间倒序，只保留有记录的项） */
  const cloudTimeline = (() => {
    const status = cloudStatus;
    if (!status?.configured) {
      return [] as Array<{ key: string; label: string; at: string }>;
    }
    const items: Array<{ key: string; label: string; at: string }> = [];
    if (status.lastContact.pushedAt) {
      items.push({ key: 'push', label: '上传给其他电脑', at: status.lastContact.pushedAt });
    }
    if (status.lastContact.uploadedAt) {
      items.push({ key: 'upload', label: '交回赛果', at: status.lastContact.uploadedAt });
    }
    if (status.lastContact.pulledAt) {
      items.push({ key: 'pull', label: '从云端获取最新', at: status.lastContact.pulledAt });
    }
    if (status.lastContact.ackedAt) {
      items.push({ key: 'ack', label: '确认对方的赛果', at: status.lastContact.ackedAt });
    }
    return items.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 4);
  })();
  // 指派工作台：只列出未结束的比赛（已完赛的指派没有意义），分控端码取自名册
  const cloudAssignPeers = (cloudStatus?.roster ?? []).filter((entry) => entry.code !== cloudStatus?.config.machineCode);
  const cloudAssignMatches = cloudStatus?.configured
    ? matchStore.matches.filter((match) => match.status !== 'completed')
    : [];
  // 整轮安排分组：按「赛事 · 阶段 · 语义轮次」归组（W2 按选手首轮战绩拆胜者组/败者组），
  // 编排缺失的孤儿引用兜底为「第 N 波」
  const cloudAssignWaveGroups = (() => {
    const groups = new Map<string, { key: string; label: string; matchIds: string[] }>();
    cloudAssignMatches.forEach((match) => {
      const ref = match.tournamentRef;
      let key = 'plain';
      let label = '普通对局';
      if (ref) {
        const name = tournamentNameMap.get(ref.tournamentId) ?? ref.tournamentId;
        const tournament = tournamentRecordMap.get(ref.tournamentId);
        const stageRound = tournament ? formatStageRoundLabel(tournament, ref) : null;
        // 分组键用语义轮次 key：双败 W2 按选手首轮战绩拆胜者组/败者组两个批次
        const roundKey = tournament
          ? resolveMatchSemanticRound(tournament, ref).key
          : `w${ref.waveIndex}`;
        key = `${ref.tournamentId}|${ref.stageIndex}|${roundKey}`;
        label = stageRound ? `${name} · ${stageRound}` : `${name} · 第 ${ref.waveIndex + 1} 波`;
      }
      const group = groups.get(key) ?? { key, label, matchIds: [] };
      group.matchIds.push(match.id);
      groups.set(key, group);
    });
    return Array.from(groups.values()).filter((group) => group.key !== 'plain');
  })();

  // === 预览弹窗里的系列赛分组：让「这条系列赛包含哪些比赛」一眼可见，并可整条选择导不导入 ===
  const syncTournamentGroups = syncPreview?.tournamentGroups ?? [];
  const syncMatchRows = syncPreview?.matchItems ?? [];
  const syncGroupOfMatchKey = buildSyncGroupOfMatchKey(syncTournamentGroups);
  const syncExcludedMatchKeys = buildSyncExcludedMatchKeys(syncTournamentGroups, syncExcludedTournamentIds);
  const syncAvailableKeys = buildSyncAvailableKeys(syncPreview, syncExcludedMatchKeys);
  /** 分控「从云端获取最新」但勾选后没有任何需要写入的条目（点过确认合并 / 云端与本机一致） */
  const cloudPullNothingToMerge = cloudPreviewFlow === 'pull' && Boolean(syncPreview)
    && syncSelectedKeys.every((key) => !syncAvailableKeys.has(key));

  /** 取消/恢复整条系列赛：勾掉时不写入它的编排，也不写入它名下的比赛 */
  function toggleSyncTournamentGroup(group: SyncImportTournamentGroup) {
    if (group.tombstone) {
      // 删除指令不可取消：墓碑必须随导入应用，否则被取消勾选的旧副本永远清不掉
      return;
    }
    const excluded = syncExcludedTournamentIds.includes(group.id);
    if (excluded) {
      setSyncExcludedTournamentIds((prev) => prev.filter((id) => id !== group.id));
      setSyncSelectedKeys((prev) => Array.from(new Set([...prev, ...group.matchKeys])));
      return;
    }
    setSyncExcludedTournamentIds((prev) => [...prev, group.id]);
    setSyncSelectedKeys((prev) => prev.filter((key) => !group.matchKeys.includes(key)));
  }

  const syncPreviewItems = syncPreview
    ? [...syncPreview.matchItems, ...syncPreview.playerItems, ...syncPreview.teamItems].sort(compareSyncItems)
    : [];
  const syncActiveItem = syncPreviewItems.find((item) => item.key === syncActiveKey) ?? null;
  const syncConflictCount = syncPreview ? syncPreview.matchItems.filter((item) => item.conflict).length : 0;

  /** 表格数据：系列赛分组标题行 + 组内比赛行（普通对局单独一组），便于一眼区分归属 */
  const syncPreviewRows: SyncPreviewRow[] = buildSyncPreviewRows(syncPreview, syncCollapsedGroupKeys);
  // 顶部速览：本次有哪些内容要处理（比赛行与档案项分开数，口径与列表一致）
  const syncMatchActionCounts = syncMatchRows.reduce(
    (acc, item) => { acc[item.action] += 1; return acc; },
    { add: 0, update: 0, skip: 0 } as Record<SyncImportItem['action'], number>,
  );
  const syncProfileItems = [...(syncPreview?.playerItems ?? []), ...(syncPreview?.teamItems ?? [])];
  const syncProfileActionCounts = syncProfileItems.reduce(
    (acc, item) => { acc[item.action] += 1; return acc; },
    { add: 0, update: 0, skip: 0 } as Record<SyncImportItem['action'], number>,
  );
  /**
   * 顶部说明行：原来这里是七八条 Alert 平铺，能把表格顶出可视区。
   * 压缩成一行小灰字——只留「排序口径 / 系列赛与墓碑规则 / 头像统计 / 上次排除」，
   * 需要用户点按钮的（冲突批量、空状态、同机器码）仍单独用 Alert。
   */
  const syncPreviewNotes: string[] = [];
  if (cloudPreviewFlow === 'incoming') {
    syncPreviewNotes.push('列表按「更新 → 新增 → 跳过」排序；勾选后点确认：内容不同的写入本机并推进系列赛，与本机已一致的只回一条「收到了」，没勾的对方仍显示待交回');
  } else {
    syncPreviewNotes.push('列表按「更新 → 新增 → 跳过」排序，要处理的排在最上面');
    if (cloudPreviewFlow === 'pull' && cloudDistInfo) {
      syncPreviewNotes.push(`${cloudDistInfo}：默认只覆盖比本机旧的内容，本机较新的登记不会被冲掉`);
    }
    if (syncTournamentGroups.some((group) => group.id)) {
      syncPreviewNotes.push('🏆 系列赛的编排随比赛自动合并、不用单独勾，勾掉整组就不导入它（编排与名下比赛都不写入）');
    }
    if (syncTournamentGroups.some((group) => group.tombstone)) {
      syncPreviewNotes.push('含已删除系列赛（墓碑）的项会清理本机副本与名单内对局，不可取消');
    }
    if (cloudPreviewFlow === 'pull' && syncExcludedTournamentIds.length > 0) {
      syncPreviewNotes.push(`已按上次选择默认排除 ${syncExcludedTournamentIds.length} 届系列赛（记在本机，下次预览继续生效）`);
    }
    if (syncProfileItems.length) {
      syncPreviewNotes.push(`档案 ${syncProfileItems.length} 项（更新 ${syncProfileActionCounts.update} / 新增 ${syncProfileActionCounts.add} / 跳过 ${syncProfileActionCounts.skip}）`);
    }
  }

  return {
    applyCloudPreview,
    applySyncPreview,
    checkCloudInbox,
    clearRememberedExclusions,
    closeCloudPreview,
    closeSyncPreview,
    cloudAckCode,
    cloudAckSource,
    cloudAckSources,
    cloudAssignDraft,
    cloudAssignMatches,
    cloudAssignOpen,
    cloudAssignPeers,
    cloudAssignWaveGroups,
    cloudBusy,
    cloudDistInfo,
    cloudInboxCount,
    cloudKeyDraft,
    cloudLabelDraft,
    cloudLiveBadge,
    cloudMachineText,
    cloudPeerDraft,
    cloudPreviewFlow,
    cloudPullNothingToMerge,
    cloudRoleDraft,
    cloudRoomGuard,
    cloudSaving,
    cloudStatus,
    cloudSyncState,
    cloudTesting,
    cloudTimeline,
    cloudTodo,
    cloudTokenDraft,
    cloudVersionText,
    cloudWorkerUrlDraft,
    exportSyncBundle,
    handleSyncFile,
    loadSyncPreview,
    machineCodeInput,
    machineCodeSaving,
    markCloudPullReviewed,
    openCloudAssign,
    pollCloudStatus: refreshCloudStatus,
    pullCloudBundle,
    pushCloudBundle,
    rejectCloudInbox,
    resolveCloudRoomGuard,
    resolveSyncConflicts,
    saveCloudAssignDraft,
    saveCloudSettings,
    saveMachineCode,
    setCloudAssignDraft,
    setCloudAssignOpen,
    setCloudKeyDraft,
    setCloudLabelDraft,
    setCloudPeerDraft,
    setCloudRoleDraft,
    setCloudRoomGuard,
    setCloudTokenDraft,
    setCloudWorkerUrlDraft,
    setMachineCodeInput,
    setSyncActiveKey,
    setSyncCollapsedGroupKeys,
    setSyncExportInclAvatars,
    setSyncExportInclProfiles,
    setSyncIncludeAvatars,
    setSyncMode,
    setSyncOverwriteAvatars,
    setSyncSelectedKeys,
    switchCloudAckSource,
    SYNC_ACTION_LABELS,
    SYNC_KIND_LABELS,
    syncActiveItem,
    syncActiveKey,
    syncCollapsedGroupKeys,
    syncConflictCount,
    syncExcludedMatchKeys,
    syncExcludedTournamentIds,
    syncExportInclAvatars,
    syncExportInclProfiles,
    syncExporting,
    syncFile,
    syncGroupOfMatchKey,
    syncImporting,
    syncIncludeAvatars,
    syncMatchActionCounts,
    syncMatchRows,
    syncMode,
    syncOverwriteAvatars,
    syncPreview,
    syncPreviewLoading,
    syncPreviewNotes,
    syncPreviewRows,
    syncSelectedKeys,
    testCloudWorker,
    toggleSyncTournamentGroup,
    tournamentNameMap,
    tournamentRecordMap,
    uploadCloudResults,
  };
}
