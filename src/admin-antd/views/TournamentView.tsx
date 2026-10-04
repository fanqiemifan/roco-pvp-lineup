import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  buildDefaultStages,
  formatStageBestOf,
  resolveThirdPlaceBestOf,
  resolveWaveBestOf,
  SUPPORTED_TOURNAMENT_SIZES,
  THIRD_PLACE_BEST_OF_OPTIONS,
  THIRD_PLACE_LABEL,
} from '../../../shared/constants';
import type {
  MatchRecord,
  MatchStoreState,
  ProfileStoreState,
  SpriteRecord,
  StageFormat,
  StageRule,
  TournamentNode,
  TournamentRecord,
  TournamentWave,
} from '../../../shared/types';
import {
  buildPlayerNameMap,
  buildWaveCards,
  countCompletedMatches,
  crossPairDeciderPool,
  findThirdPlaceWave,
  formatStageRoundLabel,
  getCurrentPositionText,
  getDraftBucketSpecs,
  getPairingLabel,
  getStageState,
  getStageWaveRoundLabels,
  getTournamentOwnerCode,
  getTournamentStatusMeta,
  getWaveGlobalIndex,
  getWaveRoundLabels,
  isDeciderBucket,
  isTournamentOwnedByLocal,
  resolvePlayerName,
  shuffleBucketPairs,
  summarizeTournamentMatches,
  validateDraftPairs,
} from '../lib/tournament';
import {
  createTournamentApi,
  deleteTournamentApi,
  drawTournamentApi,
  exportTournamentSyncBundleApi,
  forfeitApi,
  importPairingsApi,
  listTournamentsApi,
  localRemoveTournamentApi,
  localRestoreTournamentApi,
  lockPairingsApi,
  previewOpeningWaveApi,
  rollbackWaveApi,
  savePairingDraftApi,
  selectMatchApi,
  startTournamentApi,
} from '../lib/tournament-api';
import { deriveMatchActionAvailability } from '../lib/match-actions';
import { readLastTournamentId, writeLastTournamentId } from '../lib/last-tournament';
import { BracketBoard } from '../components/BracketBoard';
import { StageWaveBestOfRow } from '../components/StageWaveBestOfRow';
import { TournamentNodeCard } from '../components/TournamentNodeCard';
import { TournamentStageBestOfModal } from '../components/TournamentStageBestOfModal';
import type { TournamentCardMenuHandlers } from '../components/TournamentNodeCard';
import { HistoryLineupEntryModal } from './HistoryLineupEntryModal';
import { MatchLineupDetailModal } from './MatchLineupDetailModal';
import { TournamentLineupExportModal } from './TournamentLineupExportModal';
import { TournamentLineupImportModal } from './TournamentLineupImportModal';

const { Text, Paragraph } = Typography;

/** 配对草稿行类型简写 */
type DraftRow = NonNullable<TournamentWave['pairingDraft']>[number];
type DraftPairList = NonNullable<TournamentWave['pairingDraft']>;

/** 抽卡动画帧：滚动中的配对行 + 已揭晓行数（null = 未播放动画） */
interface PairingDrawFrame {
  rows: DraftPairList;
  revealed: number;
}

/** 抽卡滚动帧取值：从选手池随机换一个名字（尽量避开上一帧，滚动感更明显） */
function randomSlotValue(pool: string[], previous: string | null): string | null {
  if (!pool.length) {
    return null;
  }
  let value = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && value === previous) {
    value = pool[(pool.indexOf(value) + 1) % pool.length];
  }
  return value;
}

/** 参赛人数可选值：与后端 SUPPORTED_TOURNAMENT_SIZES 同源，避免两处硬编码走偏 */
const TOURNAMENT_SIZE_OPTIONS = Array.from(SUPPORTED_TOURNAMENT_SIZES).sort((a, b) => a - b);

/** 季军赛赛制的 Segmented 选项（0 = 不安排）：白名单来自 shared/constants，与引擎解析同源 */
const THIRD_PLACE_BEST_SEGMENTS = THIRD_PLACE_BEST_OF_OPTIONS.map((value) => ({
  label: value === 0 ? '不安排' : `BO${value}`,
  value,
}));

/* ==================== 系列赛列表 + 详情容器 ==================== */

export interface TournamentViewProps {
  tournaments: TournamentRecord[];
  profiles: ProfileStoreState | null;
  matches: MatchRecord[];
  /** 当前比赛 id（判断卡片菜单里「已是当前比赛」，以及撤回可用性回落口径） */
  activeMatchId: string | null;
  /** 撤销栈读模型（含 byMatch：非当前比赛的撤回可用性） */
  undo: MatchStoreState['undo'];
  /** 对某场执行流程动作（开始 / 登记胜负 / 撤回 / 取消撤回）：headless，不切当前比赛 */
  onMatchAction(
    matchId: string,
    action: 'start' | 'undo' | 'redo' | 'winner',
    extra?: Record<string, unknown>,
  ): void;
  /** 打开某场的 Drawer 面板 */
  onOpenMatchPanel(matchId: string): void;
  /** 云同步登记闸门（分控端未指派 → 置灰） */
  registerGate(matchId: string): { allowed: boolean; reason: string };
  /** 云同步撤回闸门（分控端已确认 → 禁撤回） */
  undoGate(matchId: string): { allowed: boolean; reason: string };
  /** 精灵索引：导出模板回显已有阵容名（与解析口径一致） */
  sprites: SpriteRecord[];
  /** 本机机器标识：判定系列赛是否归本机编排（只读副本禁用编排操作） */
  machineCode: string;
  /** 本机已「本机移除」的系列赛（仅本机视图隐藏，可在恢复弹窗中恢复） */
  locallyRemoved: TournamentRecord[];
  /** 「进入管理」：切换为当前比赛后跳转赛事面板（App 提供） */
  onJumpToRoster?: () => void;
  /** 阵容录入保存后回传最新赛事 store（App 统一应用，免等 socket 广播） */
  onMatchesStore?: (store: MatchStoreState) => void;
}

export function TournamentView({
  tournaments,
  profiles,
  matches,
  activeMatchId,
  undo,
  onMatchAction,
  onOpenMatchPanel,
  registerGate,
  undoGate,
  sprites,
  machineCode,
  locallyRemoved,
  onJumpToRoster,
  onMatchesStore,
}: TournamentViewProps): React.ReactElement {
  const { message } = App.useApp();
  /**
   * 卡片右键 / 「⋯」菜单三件套：可用性在这里一次算好（卡片本身只有 BracketCard，
   * 拿不到 games / activeMatchId / 撤销栈），再逐层透传给晋级图与波次列表。
   */
  const cardMenu = useMemo<TournamentCardMenuHandlers>(() => ({
    menuFor: (matchId) => {
      const match = matchId ? matches.find((item) => item.id === matchId) ?? null : null;
      if (!match) {
        return undefined;
      }
      const availability = deriveMatchActionAvailability(match, activeMatchId, undo);
      return {
        isCurrent: availability.isCurrent,
        canStart: availability.canStart,
        canRegister: availability.canRegister,
        canUndo: availability.canUndo,
        canRedo: availability.canRedo,
        registerGate: registerGate(match.id),
        undoGate: undoGate(match.id),
      };
    },
    onOpenPanel: onOpenMatchPanel,
    onRunAction: onMatchAction,
  }), [matches, activeMatchId, undo, registerGate, undoGate, onOpenMatchPanel, onMatchAction]);
  const [createOpen, setCreateOpen] = useState(false);
  // 详情默认打开「上次操作的系列赛」（本地记忆，见 lib/last-tournament）；无记忆/记录已失效时回退列表第一条
  const [selectedId, setSelectedId] = useState<string | null>(() => readLastTournamentId());
  // 删除系列赛确认弹窗：deleteWithMatches=连同关联对局一起删（可在比赛管理撤回）
  const [deleteTarget, setDeleteTarget] = useState<TournamentRecord | null>(null);
  const [deleteWithMatches, setDeleteWithMatches] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  // 本机移除：恢复弹窗（已移除清单）+ 单条恢复的进行态
  const [localRemovedOpen, setLocalRemovedOpen] = useState(false);
  const [restoreSavingId, setRestoreSavingId] = useState<string | null>(null);
  // 定向同步（P1-A）：导出只含该届的范围包（弹窗目标 + 导出中状态）
  const [syncTarget, setSyncTarget] = useState<TournamentRecord | null>(null);
  const [syncExporting, setSyncExporting] = useState(false);

  /** 打开某个系列赛详情：同时写入本地记忆，下次进入本视图自动打开它 */
  function openTournament(tournamentId: string): void {
    setSelectedId(tournamentId);
    writeLastTournamentId(tournamentId);
  }

  async function handleDeleteTournament(): Promise<void> {
    if (!deleteTarget) {
      return;
    }
    setDeleteSaving(true);
    try {
      const result = await deleteTournamentApi(deleteTarget.id, deleteWithMatches);
      // 删掉的正是记忆里的那个：一并清除，否则下次进来会拿着已失效的 id 空转
      if (readLastTournamentId() === deleteTarget.id) {
        writeLastTournamentId(null);
      }
      message.success(
        result.matchesDeleted
          ? `已删除系列赛及其 ${result.matchIds.length} 场对局（可在比赛管理撤回）`
          : result.matchIds.length > 0
            ? `已删除系列赛，${result.matchIds.length} 场对局已转为普通对局`
            : '已删除系列赛',
      );
      setDeleteTarget(null);
      setDeleteWithMatches(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteSaving(false);
    }
  }

  /** 本机移除：仅本机视图隐藏（不影响编排机、不删数据），列表 / 恢复弹窗状态由广播刷新 */
  async function handleLocalRemove(record: TournamentRecord): Promise<void> {
    try {
      await localRemoveTournamentApi(record.id);
      message.success(`已在本机移除「${record.name || record.id}」，可在「已本机移除」中恢复`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 恢复本机移除：记录立即重新可见，下次同步自动补齐 */
  async function handleLocalRestore(record: TournamentRecord): Promise<void> {
    setRestoreSavingId(record.id);
    try {
      await localRestoreTournamentApi(record.id);
      message.success(`已恢复系列赛「${record.name || record.id}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoreSavingId(null);
    }
  }

  /** 定向同步（P1-A）：导出只含该届的同步包（编排 + 名下对局 + 该届选手档案），对端导入即合并 */
  async function handleExportScopedBundle(): Promise<void> {
    if (!syncTarget) {
      return;
    }
    setSyncExporting(true);
    try {
      const result = await exportTournamentSyncBundleApi(syncTarget.id);
      message.success(`已导出「${syncTarget.name || syncTarget.id}」定向同步包（${result.matches} 场对局），发给对端在「数据同步」中导入即可`);
      setSyncTarget(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncExporting(false);
    }
  }

  // 当前选中记录（记忆失效或记录被删除时回退到第一条；无数据则 null）
  const selected = useMemo(() => {
    if (tournaments.length === 0) {
      return null;
    }
    const found = tournaments.find((record) => record.id === selectedId);
    return found ?? tournaments[0];
  }, [tournaments, selectedId]);

  const names = useMemo(() => buildPlayerNameMap(profiles), [profiles]);

  const columns: ColumnsType<TournamentRecord> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (_value, record) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => openTournament(record.id)}>
          <b>{record.name}</b>
        </Button>
      ),
    },
    { title: '人数', dataIndex: 'playerIds', width: 70, render: (ids: string[]) => ids.length },
    {
      title: '当前阶段',
      width: 180,
      render: (_value, record) => getCurrentPositionText(record),
    },
    {
      title: '进度',
      width: 170,
      render: (_value, record) => {
        const completed = countCompletedMatches(record, matches);
        const total = record.waves.reduce(
          (sum, wave) => sum + wave.nodes.length,
          0,
        );
        if (record.status === 'completed') {
          return '已全部完成';
        }
        if (total === 0) {
          return '0 场已建';
        }
        return `已完成 ${completed} / ${total} 场`;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (_value, record) => {
        const meta = getTournamentStatusMeta(record);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '操作',
      width: 300,
      render: (_value, record) => {
        const owned = isTournamentOwnedByLocal(record.id, machineCode);
        const ownerCode = getTournamentOwnerCode(record.id);
        return (
          <Space size={4}>
            <Button type="link" style={{ padding: 0 }} onClick={() => openTournament(record.id)}>
              {record.status === 'setup' ? '继续配置 →' : '打开详情 →'}
            </Button>
            {/* 只读副本删除被禁用：用 Tooltip 说明原因（禁用按钮自身不派发鼠标事件，需 span 包裹） */}
            <Tooltip
              title={owned ? null : `该系列赛由${ownerCode ? `机器 ${ownerCode}` : '另一台机器'}编排，请在编排机上删除`}
            >
              <span style={{ display: 'inline-block' }}>
                <Button
                  type="link"
                  danger
                  style={{ padding: 0, pointerEvents: owned ? undefined : 'none' }}
                  disabled={!owned}
                  onClick={() => {
                    setDeleteWithMatches(false);
                    setDeleteTarget(record);
                  }}
                >
                  删除
                </Button>
              </span>
            </Tooltip>
            {/* 非本机编排：提供「本机移除」（仅本机视图隐藏、不传播、可恢复）；真删除仍请在编排机执行 */}
            {owned ? null : (
              <Popconfirm
                title="本机移除"
                description="仅在本机隐藏该系列赛及其对局，不影响编排机；可随时在「已本机移除」中恢复。"
                okText="移除"
                cancelText="取消"
                onConfirm={() => void handleLocalRemove(record)}
              >
                <Button type="link" style={{ padding: 0 }}>本机移除</Button>
              </Popconfirm>
            )}
            {/* 定向同步（P1-A）：导出只含该届的范围包，发给对端导入；不涉及其他系列赛与普通对局 */}
            <Button type="link" style={{ padding: 0 }} onClick={() => setSyncTarget(record)}>定向同步</Button>
          </Space>
        );
      },
    },
  ];

  async function handleSelectMatch(matchId: string): Promise<void> {
    try {
      await selectMatchApi(matchId);
      message.success('已切换为当前比赛');
      onJumpToRoster?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card
        title="系列赛列表"
        extra={(
          <Space>
            <Button onClick={() => setLocalRemovedOpen(true)}>
              已本机移除 ({locallyRemoved.length})
            </Button>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              ＋ 创建系列赛
            </Button>
          </Space>
        )}
      >
        <Table
          columns={columns}
          dataSource={tournaments}
          rowKey="id"
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description="暂无系列赛，点「创建系列赛」开始" /> }}
        />
      </Card>

      {selected ? (
        <TournamentDetail
          key={selected.id}
          record={selected}
          names={names}
          matches={matches}
          sprites={sprites}
          machineCode={machineCode}
          cardMenu={cardMenu}
          onSelectMatch={handleSelectMatch}
          onMatchesStore={onMatchesStore}
          onDelete={() => {
            setDeleteWithMatches(false);
            setDeleteTarget(selected);
          }}
          onLocalRemove={() => void handleLocalRemove(selected)}
          onSync={() => setSyncTarget(selected)}
        />
      ) : null}

      <Modal
        title="删除系列赛"
        open={Boolean(deleteTarget)}
        okText="删除"
        okButtonProps={{ danger: true, loading: deleteSaving }}
        cancelText="取消"
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteWithMatches(false);
        }}
        onOk={() => void handleDeleteTournament()}
      >
        {deleteTarget ? (
          (() => {
            const summary = summarizeTournamentMatches(deleteTarget, matches);
            return (
              <Space direction="vertical" size={12} style={{ marginTop: 8 }}>
                <Paragraph style={{ marginBottom: 0 }}>
                  确定删除系列赛「<b>{deleteTarget.name}</b>」？编排记录（阶段、波次、对阵树）将被删除且不可恢复。
                  删除会随同步下发到分控端：分控端的副本（与名单内的关联对局）会在下次同步时自动清理。
                </Paragraph>
                {summary.total > 0 ? (
                  <>
                    <Text type="secondary">
                      关联对局共 {summary.total} 场：已完成 {summary.completed} · 进行中 {summary.inProgress} · 未开始 {summary.pending}
                    </Text>
                    <Checkbox
                      checked={deleteWithMatches}
                      onChange={(event) => setDeleteWithMatches(event.target.checked)}
                    >
                      同时删除这 {summary.total} 场对局（之后仍可在比赛管理「撤回最近删除」恢复）
                    </Checkbox>
                    {!deleteWithMatches ? (
                      <Text type="secondary">
                        不勾选时对局全部保留，解除系列赛关联后转为普通对局，已有标签与战绩不受影响。
                      </Text>
                    ) : (
                      <Text type="warning">
                        对局删除后若不及时撤回，将与普通删除一样受七天清理期限限制。
                      </Text>
                    )}
                  </>
                ) : (
                  <Text type="secondary">该系列赛尚未创建任何对局，将仅删除编排记录。</Text>
                )}
              </Space>
            );
          })()
        ) : null}
      </Modal>

      {/* 已本机移除：仅本机视图隐藏的记录（编排机无感知），这里可单条恢复 */}
      <Modal
        title="已本机移除的系列赛"
        open={localRemovedOpen}
        footer={null}
        onCancel={() => setLocalRemovedOpen(false)}
      >
        <Table
          size="small"
          rowKey="id"
          dataSource={locallyRemoved}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无本机移除的系列赛" /> }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              render: (name: string, record) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{name || record.id}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{record.id}</Text>
                </Space>
              ),
            },
            {
              title: '编排机',
              width: 90,
              render: (_value, record) => getTournamentOwnerCode(record.id) ?? '—',
            },
            {
              title: '移除时间',
              width: 160,
              render: (_value, record) => (record.deletedAt ? new Date(record.deletedAt).toLocaleString() : '—'),
            },
            {
              title: '操作',
              width: 80,
              render: (_value, record) => (
                <Button
                  type="link"
                  style={{ padding: 0 }}
                  loading={restoreSavingId === record.id}
                  onClick={() => void handleLocalRestore(record)}
                >
                  恢复
                </Button>
              ),
            },
          ]}
        />
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          本机移除只隐藏本机视图（不影响编排机）；恢复后立即重新可见，下一次同步会自动补齐编排机的最新编排与赛果。
        </Paragraph>
      </Modal>

      {/* 定向同步（P1-A）：导出只含该届的范围包；对端导入即合并，不涉及其他系列赛与普通对局 */}
      <Modal
        title={`定向同步 · ${syncTarget?.name ?? ''}`}
        open={Boolean(syncTarget)}
        okText="导出同步包"
        okButtonProps={{ loading: syncExporting }}
        cancelText="取消"
        onCancel={() => setSyncTarget(null)}
        onOk={() => void handleExportScopedBundle()}
      >
        {syncTarget ? (
          <Space direction="vertical" size={10} style={{ marginTop: 8 }}>
            <Paragraph style={{ marginBottom: 0 }}>
              导出一个<b>只包含这一届</b>的同步包（系列赛编排 + 名下全部对局 + 该届选手档案），
              发给对端在「数据同步 → 导入」合并。包里不含其他系列赛与普通对局。
            </Paragraph>
            <Text type="secondary">
              {syncTarget.status === 'completed'
                ? '已结束的届：用于把最终对阵与赛果同步给对方存档。'
                : '进行中的届：对端导入后即可看到最新对阵与赛果，继续协作推进。'}
            </Text>
          </Space>
        ) : null}
      </Modal>

      <CreateTournamentModal
        open={createOpen}
        profiles={profiles}
        names={names}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          openTournament(id);
        }}
      />
    </Space>
  );
}

/* ==================== 系列赛详情 ==================== */

interface DetailProps {
  record: TournamentRecord;
  names: Map<string, string>;
  matches: MatchRecord[];
  sprites: SpriteRecord[];
  machineCode: string;
  /** 卡片右键 / 「⋯」菜单三件套（可用性 + 打开面板 + 执行动作） */
  cardMenu: TournamentCardMenuHandlers;
  onSelectMatch(matchId: string): Promise<void>;
  /** 阵容录入保存后回传最新赛事 store（App 统一应用） */
  onMatchesStore?: (store: MatchStoreState) => void;
  onDelete(): void;
  /** 本机移除（仅只读副本可用：仅本机视图隐藏、可恢复） */
  onLocalRemove(): void;
  /** 定向同步：导出只含该届的范围包（父组件弹窗） */
  onSync(): void;
}

function TournamentDetail({
  record,
  names,
  matches,
  sprites,
  machineCode,
  cardMenu,
  onSelectMatch,
  onMatchesStore,
  onDelete,
  onLocalRemove,
  onSync,
}: DetailProps): React.ReactElement {
  const { message, modal } = App.useApp();
  // 只读副本（系列赛由另一台机器编排）：可查看与登记对局，编排/推进由服务端拒绝
  const ownerCode = getTournamentOwnerCode(record.id);
  const readOnly = !isTournamentOwnedByLocal(record.id, machineCode);
  // 详情视图：晋级图（默认）/ 波次列表；setup 阶段固定走抽签面板
  const [detailView, setDetailView] = useState<'bracket' | 'waves'>('bracket');
  // 阵容表批量导出 / 导入（比赛记录写入，只读副本也可用；门槛与单场录入一致）
  const [lineupExportOpen, setLineupExportOpen] = useState(false);
  const [lineupImportOpen, setLineupImportOpen] = useState(false);
  // 「阵容详情」弹窗：按 matchId 从最新 matches 解析（socket 更新自动跟随，比赛被删时自动关闭）
  const [lineupDetailMatchId, setLineupDetailMatchId] = useState<string | null>(null);
  // 「录入阵容」弹窗上下文（与比赛管理同口径：仅当前小局 + 待开始可录入）
  const [lineupEntry, setLineupEntry] = useState<{ matchId: string; gameNumber: number } | null>(null);
  // 「编辑赛制」弹窗：编排机专属；阶段内已有赛况时走「重开本阶段」（强确认）
  const [stageEditOpen, setStageEditOpen] = useState(false);

  async function handleRollback(): Promise<void> {
    try {
      await rollbackWaveApi(record.id);
      message.success('已回退上一波');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  // 波次最新在前（裁判只需操作当前波）
  const reversedWaves = [...record.waves].reverse();

  // 季军赛节点（未安排 / 还没打出来时为 null）：名次横幅与波次列表标题都用它
  const thirdPlaceNode = findThirdPlaceWave(record)?.nodes[0] ?? null;

  const lineupDetailMatch = lineupDetailMatchId
    ? matches.find((match) => match.id === lineupDetailMatchId) ?? null
    : null;
  // 「阶段 · 轮次」摘要：仅当比赛仍归属当前系列赛时展示（解绑/删除系列赛后自动消失）
  const lineupDetailStageRound = lineupDetailMatch?.tournamentRef
    && lineupDetailMatch.tournamentRef.tournamentId === record.id
    ? formatStageRoundLabel(record, lineupDetailMatch.tournamentRef)
    : null;
  const lineupEntryMatch = lineupEntry ? matches.find((match) => match.id === lineupEntry.matchId) ?? null : null;
  const lineupEntryGame = lineupEntryMatch && lineupEntry
    ? lineupEntryMatch.games.find((game) => game.gameNumber === lineupEntry.gameNumber) ?? null
    : null;

  return (
    <Card
      title={`系列赛详情 · ${record.name}`}
      extra={(
        <Space>
          {readOnly ? (
            <Tag color="blue">只读副本{ownerCode ? ` · 机器 ${ownerCode} 编排` : ''}</Tag>
          ) : null}
          <Tag color={getTournamentStatusMeta(record).color}>
            {getTournamentStatusMeta(record).label}
          </Tag>
          {!readOnly && record.status !== 'completed' ? (
            <Button onClick={() => setStageEditOpen(true)}>编辑赛制</Button>
          ) : null}
          <Button onClick={() => setLineupExportOpen(true)}>导出阵容模板</Button>
          <Button onClick={() => setLineupImportOpen(true)}>导入阵容</Button>
          <Button onClick={onSync}>定向同步</Button>
          <Popconfirm
            title="回退上一波"
            description="将删除最后波未开始的比赛并复位战绩，确定？"
            okText="回退"
            cancelText="取消"
            onConfirm={() => void handleRollback()}
          >
            <Button disabled={record.waves.length === 0 || readOnly}>↺ 回退上一波</Button>
          </Popconfirm>
          <Button danger disabled={readOnly} onClick={onDelete}>删除系列赛</Button>
          {readOnly ? (
            <Popconfirm
              title="本机移除"
              description="仅在本机隐藏该系列赛及其对局，不影响编排机；可随时在「已本机移除」中恢复。"
              okText="移除"
              cancelText="取消"
              onConfirm={onLocalRemove}
            >
              <Button>本机移除</Button>
            </Popconfirm>
          ) : null}
        </Space>
      )}
    >
      {readOnly ? (
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          只读副本：该系列赛由{ownerCode ? `机器 ${ownerCode}` : '另一台机器'}编排 —— 本机可查看对阵图、可登记对局赛果；推进、编排与删除请在编排机执行。不想继续管理时可「本机移除」——仅在本机隐藏该系列赛及其对局、不影响编排机，可随时在「已本机移除」中恢复；编排机删除后，本机副本会随下一次同步自动清除，回传后本机对阵图自动更新。
        </Paragraph>
      ) : null}

      {record.result || thirdPlaceNode?.winnerId ? (
        <Paragraph>
          {record.result ? (
            <>
              <Tag color="gold">🏆 冠军：{resolvePlayerName(names, record.result.championId)}</Tag>
              <Tag color="default">亚军：{resolvePlayerName(names, record.result.runnerUpId)}</Tag>
            </>
          ) : null}
          {/* 季军赛可能早于总决赛打完，所以名次直接读节点胜者，不等 record.result */}
          {thirdPlaceNode?.winnerId ? (
            <Tag color="orange">🥉 季军：{resolvePlayerName(names, thirdPlaceNode.winnerId)}</Tag>
          ) : null}
        </Paragraph>
      ) : null}

      <Steps
        size="small"
        className="tournament-stage-steps"
        current={record.status === 'completed' ? record.stages.length : record.currentStageIndex}
        status={record.status === 'completed' ? 'finish' : 'process'}
        items={record.stages.map((stage, stageIndex) => {
          const state = getStageState(record, stageIndex);
          return {
            title: stage.name,
            status: state === 'done' ? 'finish' : state === 'current' ? 'process' : 'wait',
            description: (
              <Space size={4} wrap>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {stage.format === 'double-life' ? '双败' : '单败'} · {formatStageBestOf(stage)}
                </Text>
              </Space>
            ),
          };
        })}
      />

      {record.status === 'setup' ? (
        <SetupDraftPanel record={record} names={names} readOnly={readOnly} />
      ) : (
        <Segmented
          className="tournament-view-switch"
          value={detailView}
          onChange={(value) => setDetailView(value as 'bracket' | 'waves')}
          options={[
            { label: '晋级图', value: 'bracket' },
            { label: '波次列表', value: 'waves' },
          ]}
        />
      )}

      {record.status !== 'setup' && detailView === 'bracket' ? (
        <BracketBoard
          record={record}
          names={names}
          matches={matches}
          onSelectMatch={onSelectMatch}
          onViewLineup={setLineupDetailMatchId}
          readOnly={readOnly}
          cardMenu={cardMenu}
        />
      ) : (
        <div className="tournament-waves">
          {reversedWaves.map((wave) => (
            <WavePanel
              key={`${wave.stageIndex}-${wave.waveIndex}`}
              record={record}
              wave={wave}
              names={names}
              matches={matches}
              onSelectMatch={onSelectMatch}
              onViewLineup={setLineupDetailMatchId}
              readOnly={readOnly}
              cardMenu={cardMenu}
            />
          ))}
        </div>
      )}

      {record.status !== 'setup' ? (
        <Space size={18} wrap style={{ marginTop: 12 }}>
          <Text type="secondary">
            <i className="tournament-legend-dot tournament-dot-promoted" />
            已晋级
          </Text>
          <Text type="secondary">
            <i className="tournament-legend-dot tournament-dot-alive" />
            存活
          </Text>
          <Text type="secondary">
            <i className="tournament-legend-dot tournament-dot-eliminated" />
            已淘汰
          </Text>
          <Text type="secondary">
            比赛标签自动写入（赛事名 / 阶段名 / W波次），可在比赛管理筛选
          </Text>
        </Space>
      ) : null}

      <TournamentLineupExportModal
        open={lineupExportOpen}
        record={record}
        matches={matches}
        sprites={sprites}
        onClose={() => setLineupExportOpen(false)}
      />
      <TournamentLineupImportModal
        open={lineupImportOpen}
        record={record}
        matches={matches}
        onClose={() => setLineupImportOpen(false)}
      />
      <MatchLineupDetailModal
        open={Boolean(lineupDetailMatch)}
        match={lineupDetailMatch}
        stageRoundText={lineupDetailStageRound}
        sprites={sprites}
        onClose={() => setLineupDetailMatchId(null)}
        onEnterLineup={(matchId, gameNumber) => setLineupEntry({ matchId, gameNumber })}
      />
      <HistoryLineupEntryModal
        open={Boolean(lineupEntry && lineupEntryMatch && lineupEntryGame)}
        match={lineupEntryMatch}
        game={lineupEntryGame}
        sprites={sprites}
        onClose={() => setLineupEntry(null)}
        onSaved={(store) => onMatchesStore?.(store)}
      />
      <TournamentStageBestOfModal
        open={stageEditOpen}
        record={record}
        matches={matches}
        onClose={() => setStageEditOpen(false)}
      />
    </Card>
  );
}

/* ==================== setup 抽签面板（向导第4步/详情共用内容） ==================== */

function SetupDraftPanel({
  record,
  names,
  onChanged,
  readOnly = false,
}: {
  record: TournamentRecord;
  names: Map<string, string>;
  /** 抽签/开赛后通知父组件重新取数（详情页走 socket 可不传） */
  onChanged?: () => void;
  /** 只读副本：禁用抽签与开赛（服务端也会拒绝） */
  readOnly?: boolean;
}): React.ReactElement {
  const { message } = App.useApp();
  const [drawing, setDrawing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<TournamentWave['pairingDraft']>();
  const [previewLoading, setPreviewLoading] = useState(true);

  // 首波对阵预览：按当前 seed 只读生成（重抽会改 seed/drawVersion，effect 随之刷新）
  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    previewOpeningWaveApi(record.id)
      .then((pairs) => {
        if (!cancelled) {
          setPreview(pairs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(undefined);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [record.id, record.seed, record.drawVersion]);

  async function handleDraw(): Promise<void> {
    setDrawing(true);
    try {
      await drawTournamentApi(record.id);
      message.success('已重新抽签');
      onChanged?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDrawing(false);
    }
  }

  async function handleStart(): Promise<void> {
    setStarting(true);
    try {
      await startTournamentApi(record.id);
      message.success('已开赛');
      onChanged?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card
      type="inner"
      title="抽签与首波对阵（确认后开赛）"
      style={{ margin: '16px 0' }}
      extra={(
        <Space>
          <Button loading={drawing} disabled={readOnly} onClick={() => void handleDraw()}>
            🎲 重新抽签
          </Button>
          <Button type="primary" loading={starting} disabled={readOnly} onClick={() => void handleStart()}>
            确认开赛
          </Button>
        </Space>
      )}
    >
      <Text type="secondary">
        抽签 seed：{record.seed}（重抽第 {record.drawVersion} 次）；seed 是全部自动配对的随机数来源，重抽即整体换一套
      </Text>
      <div className="tournament-seed-order">
        {record.playerIds.map((id, index) => (
          <Tag key={id}>
            {index + 1}. {resolvePlayerName(names, id)}
          </Tag>
        ))}
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        以上顺序为配对基准顺序，随机生成、不含强弱种子
      </Text>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
        首波对阵预览（按当前 seed 只读生成，确认开赛后才会建场）
      </Text>
      <div className="tournament-opening-preview">
        {preview?.length ? (
          preview.map((row, index) => (
            <div className="tournament-opening-row" key={`${row.pair[0] ?? '?'}-${row.pair[1] ?? '?'}-${index}`}>
              <Text>{resolvePlayerName(names, row.pair[0])}</Text>
              <Text type="secondary">vs</Text>
              <Text>{resolvePlayerName(names, row.pair[1])}</Text>
            </div>
          ))
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {previewLoading ? '预览生成中…' : '预览不可用'}
          </Text>
        )}
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        开赛后系统生成第 1 波全部比赛；手动配对/需确认的阶段会先进入配对确认台。
      </Text>
    </Card>
  );
}

/* ==================== 波次面板 ==================== */

interface WavePanelProps {
  record: TournamentRecord;
  wave: TournamentWave;
  names: Map<string, string>;
  matches: MatchRecord[];
  onSelectMatch(matchId: string): Promise<void>;
  onViewLineup(matchId: string): void;
  readOnly: boolean;
  /** 卡片右键 / 「⋯」菜单三件套（透传给波次卡片） */
  cardMenu: TournamentCardMenuHandlers;
}

function WavePanel({
  record,
  wave,
  names,
  matches,
  onSelectMatch,
  onViewLineup,
  readOnly,
  cardMenu,
}: WavePanelProps): React.ReactElement {
  const stage = record.stages[wave.stageIndex];
  // 轮次表述与晋级图同一套术语：双败给「败者组 R1 / 胜者组 R2」，单败直接用阶段名
  const rounds = getWaveRoundLabels(record, wave);
  // 季军赛是附加波次：它的波次序号排在阶段主赛之后，标题与赛制都用「季军赛 + 自己的 BO」
  const isThirdPlace = wave.kind === 'third-place';

  return (
    <Card
      type="inner"
      style={{ marginTop: 12 }}
      title={(
        <Space size={8} wrap>
          <b>{isThirdPlace ? THIRD_PLACE_LABEL : `第 ${wave.waveIndex} 波`}</b>
          {/* 轮次名作追加标注（双败才有），阶段名 + 赛制、配对方式 + 配对状态各用一个 Tag */}
          {rounds.length ? <Text type="secondary">{rounds.join(' / ')}</Text> : null}
          <Tag>
            {isThirdPlace
              ? `单败 · BO${resolveThirdPlaceBestOf(record)}`
              : `${stage.name} · ${stage.format === 'double-life' ? '双败' : '单败'} · BO${resolveWaveBestOf(stage, wave.waveIndex)}`}
          </Tag>
          <Tag color={wave.pairingStatus === 'draft' ? 'warning' : 'default'}>
            {isThirdPlace ? '自动建场' : getPairingLabel(stage.pairing)} · {wave.pairingStatus === 'draft' ? '配对草稿' : '已锁定'}
          </Tag>
          <Tag color={wave.status === 'completed' ? 'success' : 'processing'}>
            {wave.status === 'completed' ? '已完成' : wave.status === 'running' ? '进行中' : '待开始'}
          </Tag>
        </Space>
      )}
    >
      {wave.pairingStatus === 'draft' ? (
        <PairingConsole record={record} wave={wave} names={names} readOnly={readOnly} />
      ) : (
        <NodeGrid
          record={record}
          wave={wave}
          names={names}
          matches={matches}
          onSelectMatch={onSelectMatch}
          onViewLineup={onViewLineup}
          readOnly={readOnly}
          cardMenu={cardMenu}
        />
      )}
    </Card>
  );
}

/* ==================== 配对确认台 ==================== */

function PairingConsole({
  record,
  wave,
  names,
  readOnly = false,
}: {
  record: TournamentRecord;
  wave: TournamentWave;
  names: Map<string, string>;
  /** 只读副本：禁用草稿编辑与锁定（服务端也会拒绝） */
  readOnly?: boolean;
}): React.ReactElement {
  const { message, modal } = App.useApp();
  const globalIndex = getWaveGlobalIndex(record, wave.stageIndex, wave.waveIndex);
  const specs = useMemo(() => getDraftBucketSpecs(record, wave), [record, wave]);

  // 本地草稿：服务端草稿变化（导入/外部更新）时整体替换；记录其签名
  const serverKey = JSON.stringify(wave.pairingDraft ?? []);
  const [pairs, setPairs] = useState<DraftPairList>(() => wave.pairingDraft ?? []);
  const serverKeyRef = useRef(serverKey);
  if (serverKeyRef.current !== serverKey) {
    serverKeyRef.current = serverKey;
    setPairs(wave.pairingDraft ?? []);
  }

  // 跨桶配对 = 休眠选项：常规双败流程用不到（W2 自动按 1-0 / 0-1 桶配对，即胜者组/败者组）。
  // 仅当手动配对或导入非常规对阵表确实需要跨战绩对阵时，裁判显式勾选才放开；
  // 锁定前二次确认，建场后比赛标注「跨桶」（page6 标签只显示阶段名）
  const [allowCrossBucket, setAllowCrossBucket] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  // 抽卡动画（桶内随机重排）：滚动中的帧；揭晓完成后才写入草稿
  const [drawFrame, setDrawFrame] = useState<PairingDrawFrame | null>(null);
  const drawIntervalRef = useRef<number | null>(null);
  const drawTimersRef = useRef<number[]>([]);

  // 编辑即存（防抖 500ms）
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    if (drawIntervalRef.current !== null) {
      window.clearInterval(drawIntervalRef.current);
    }
    drawTimersRef.current.forEach((id) => window.clearTimeout(id));
  }, []);

  function scheduleSave(nextPairs: DraftPairList): void {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persist(nextPairs);
    }, 500);
  }

  async function persist(nextPairs: DraftPairList): Promise<void> {
    setSaving(true);
    try {
      await savePairingDraftApi(record.id, globalIndex, nextPairs);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function updateSlot(rowLocalIndex: number, slot: 0 | 1, value: string): void {
    const next = pairs.map((row, index) => {
      if (index !== rowLocalIndex) {
        return row;
      }
      const pair: [string | null, string | null] = [...row.pair] as [
        string | null,
        string | null,
      ];
      pair[slot] = value || null;
      return { ...row, pair };
    });
    setPairs(next);
    scheduleSave(next);
  }

  /**
   * 🎲 桶内随机重排：每个桶独立洗牌；决胜池（W3 的 1-1 池）走经典双败交叉配对。
   * 结果先藏住，等抽卡动画逐行揭晓后才落到草稿（动画期间锁定其他编辑）。
   */
  function handleShuffle(): void {
    if (drawFrame) {
      return;
    }
    const rng = Math.random;
    const next: DraftPairList = [];
    specs.forEach((spec) => {
      const bucketPairs = isDeciderBucket(spec.bucketKey)
        ? crossPairDeciderPool(record, wave.stageIndex, spec.playerIds, rng)
        : shuffleBucketPairs(spec.playerIds, rng);
      bucketPairs.forEach((pair) => {
        next.push({ bucketKey: spec.bucketKey, pair });
      });
    });
    startDrawAnimation(next);
  }

  /** 滚动帧的候选名字池：跨桶模式给全波选手，否则只给本桶 */
  function drawPool(bucketKey?: string): string[] {
    if (allowCrossBucket) {
      return specs.flatMap((spec) => spec.playerIds);
    }
    return specs.find((spec) => spec.bucketKey === bucketKey)?.playerIds ?? [];
  }

  /** 抽卡动画：所有行先快速滚动（换名字），随后自首行起逐行定格，全部揭晓后提交草稿并暂存 */
  function startDrawAnimation(finalRows: DraftPairList): void {
    const rolled = (row: DraftRow): DraftRow => {
      const pool = drawPool(row.bucketKey);
      return {
        bucketKey: row.bucketKey,
        pair: [
          randomSlotValue(pool, row.pair[0]),
          randomSlotValue(pool, row.pair[1]),
        ],
      };
    };

    setDrawFrame({ rows: finalRows.map(rolled), revealed: 0 });

    // 滚动：每 90ms 给未揭晓的行换一批随机名字（已揭晓的行保持定格结果）
    const interval = window.setInterval(() => {
      setDrawFrame((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          rows: prev.rows.map((row, index) => (index < prev.revealed ? row : rolled(row))),
        };
      });
    }, 90);
    drawIntervalRef.current = interval;

    // 逐行揭晓：基础滚动后按错峰节奏自首行起定格（行多时压缩间隔，总时长约 1~2.5s）
    const baseDuration = 900;
    const stagger = finalRows.length > 1
      ? Math.min(150, Math.max(70, Math.round(1200 / (finalRows.length - 1))))
      : 0;
    finalRows.forEach((finalRow, index) => {
      const timer = window.setTimeout(() => {
        setDrawFrame((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            revealed: index + 1,
            rows: prev.rows.map((row, rowIndex) => (rowIndex === index ? finalRow : row)),
          };
        });
      }, baseDuration + stagger * index);
      drawTimersRef.current.push(timer);
    });

    // 静置一拍后收尾：写入草稿 + 触发暂存
    const finishTimer = window.setTimeout(() => {
      window.clearInterval(interval);
      drawIntervalRef.current = null;
      drawTimersRef.current = [];
      setDrawFrame(null);
      setPairs(finalRows);
      scheduleSave(finalRows);
    }, baseDuration + stagger * Math.max(finalRows.length - 1, 0) + 650);
    drawTimersRef.current.push(finishTimer);
  }

  /** 添加一行空配对（默认归第一个桶；跨桶通过在选择框选其他桶选手实现） */
  function addRow(): void {
    const firstKey = specs[0]?.bucketKey;
    const next: DraftPairList = [
      ...pairs,
      { bucketKey: firstKey, pair: [null, null] },
    ];
    setPairs(next);
    scheduleSave(next);
  }

  function removeRow(rowIndex: number): void {
    const next = pairs.filter((_row, index) => index !== rowIndex);
    setPairs(next);
    scheduleSave(next);
  }

  /** 导入对阵表 */
  async function handleImport(): Promise<void> {
    if (!importText.trim()) {
      return;
    }
    try {
      const result = await importPairingsApi(record.id, globalIndex, { text: importText });
      setImportOpen(false);
      setImportText('');
      if (result.unmatched.length) {
        modal.warning({
          title: `${result.unmatched.length} 行未能匹配`,
          content: (
            <List
              size="small"
              dataSource={result.unmatched}
              renderItem={(item) => <List.Item>第 {item.line} 行：{item.text}</List.Item>}
            />
          ),
        });
      } else {
        message.success('对阵表已导入草稿');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function hasCrossPair(): boolean {
    return pairs.some((row) => {
      const [a, b] = row.pair;
      if (!a || !b) {
        return false;
      }
      const bucketA = specs.find((spec) => spec.playerIds.includes(a))?.bucketKey;
      const bucketB = specs.find((spec) => spec.playerIds.includes(b))?.bucketKey;
      return bucketA !== bucketB;
    });
  }

  /** 锁定：先校验，跨桶给二次确认 */
  async function handleLock(): Promise<void> {
    const validation = validateDraftPairs(record, wave, pairs, allowCrossBucket);
    if (!validation.valid) {
      message.error(validation.errors[0]);
      return;
    }

    const doLock = async (): Promise<void> => {
      setLocking(true);
      try {
        await lockPairingsApi(record.id, globalIndex, allowCrossBucket);
        message.success('配对已锁定，比赛已创建');
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error) );
      } finally {
        setLocking(false);
      }
    };

    if (allowCrossBucket && hasCrossPair()) {
      modal.confirm({
        title: '存在跨桶配对',
        content: '配对双方战绩不对等，影响公平与晋级数学；锁定后比赛将标注「跨桶」。确认锁定？',
        okText: '确认锁定',
        cancelText: '取消',
        onOk: () => void doLock(),
      });
      return;
    }
    await doLock();
  }

  // 桶结构固定按 specs 渲染（空桶也显示；行按 bucketKey 归入，跨桶行归首个槽所在桶）
  // 抽卡动画期间展示滚动帧，动画结束后回到真实草稿（两帧形状一致，切换无跳变）
  const drawing = drawFrame !== null;
  const visiblePairs = drawFrame?.rows ?? pairs;
  const groups = useMemo(
    () => specs.map((spec) => ({
      bucketKey: spec.bucketKey,
      rows: visiblePairs
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.bucketKey === spec.bucketKey),
    })),
    [specs, visiblePairs],
  );
  const liveValidation = useMemo(
    () => validateDraftPairs(record, wave, pairs, allowCrossBucket),
    [record, wave, pairs, allowCrossBucket],
  );

  // 选择框选项：允许跨桶时列出本波全部选手（带桶后缀），否则仅本桶
  const optionLabel = (id: string, bucketKey?: string): string => {
    const name = resolvePlayerName(names, id);
    return bucketKey ? `${name}（${bucketKey}）` : name;
  };

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button
          className={`tournament-shuffle-btn${drawing ? ' is-drawing' : ''}`}
          onClick={handleShuffle}
          disabled={readOnly || drawing}
        >
          <span className="tournament-shuffle-dice">🎲</span> 桶内随机重排
        </Button>
        <Button onClick={() => setImportOpen(true)} disabled={readOnly || drawing}>📋 导入对阵表</Button>
        <Button onClick={addRow} disabled={readOnly || drawing}>＋ 添加一行</Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {readOnly
            ? '只读副本：配对草稿由编排机编辑'
            : drawing
              ? '抽签中…揭晓完成后自动暂存'
              : saving ? '保存中…' : '草稿自动暂存（锁定前赛事面板看不到比赛）'}
        </Text>
      </Space>

      <Row gutter={[12, 12]}>
        {groups.map((group) => (
          <Col xs={24} xl={groups.length > 1 ? 12 : 24} key={group.bucketKey ?? '__single'}>
            <div className={`tournament-bucket-box${drawing && group.rows.length > 0 ? ' is-drawing' : ''}`}>
              <div className="tournament-bucket-title">
                {group.bucketKey === undefined
                  ? `本波选手（${specs[0]?.playerIds.length ?? 0} 人）`
                  : `${bucketTitle(group.bucketKey)}（${group.bucketKey}）· ${
                      specs.find((spec) => spec.bucketKey === group.bucketKey)?.playerIds.length ?? 0
                    } 人`}
              </div>
              {group.rows.map(({ row, index: flatIndex }) => {
                const options = allowCrossBucket
                  ? specs.flatMap((spec) =>
                      spec.playerIds.map((id) => ({
                        value: id,
                        label: optionLabel(id, spec.bucketKey),
                      })),
                    )
                  : (specs.find((spec) => spec.bucketKey === group.bucketKey)?.playerIds ?? []).map(
                      (id) => ({ value: id, label: optionLabel(id) }),
                    );
                return (
                  <div
                    className={`tournament-pair-row${drawFrame && flatIndex < drawFrame.revealed ? ' is-revealed' : ''}`}
                    key={flatIndex}
                  >
                    <Text strong className="tournament-pair-index">
                      {flatIndex + 1}
                    </Text>
                    <Select
                      style={{ flex: 1 }}
                      value={row.pair[0] ?? undefined}
                      placeholder="选择选手"
                      options={options}
                      showSearch
                      optionFilterProp="label"
                      disabled={readOnly || drawing}
                      onChange={(value) => updateSlot(flatIndex, 0, value)}
                    />
                    <Text type="secondary">vs</Text>
                    <Select
                      style={{ flex: 1 }}
                      value={row.pair[1] ?? undefined}
                      placeholder="选择选手"
                      options={options}
                      showSearch
                      optionFilterProp="label"
                      disabled={readOnly || drawing}
                      onChange={(value) => updateSlot(flatIndex, 1, value)}
                    />
                    <Button
                      type="text"
                      danger
                      disabled={readOnly || drawing}
                      onClick={() => removeRow(flatIndex)}
                    >
                      删除
                    </Button>
                  </div>
                );
              })}
              {group.rows.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  （暂无配对，点上方「🎲 桶内随机重排」或「＋ 添加一行」）
                </Text>
              ) : null}
            </div>
          </Col>
        ))}
      </Row>

      {liveValidation.errors.length ? (
        <div className="tournament-validation-box tournament-validation-errors">
          {liveValidation.errors.map((text) => (
            <div key={text}>✗ {text}</div>
          ))}
        </div>
      ) : null}
      {liveValidation.warnings.length ? (
        <div className="tournament-validation-box tournament-validation-warnings">
          {liveValidation.warnings.map((text) => (
            <div key={text}>⚠ {text}（仅提醒，不阻断）</div>
          ))}
        </div>
      ) : null}

      <Space style={{ marginTop: 12 }} wrap>
        <Tooltip title="休眠选项：标准双败流程按战绩桶自动配对（胜者组打胜者组、败者组打败者组），常规赛程无需勾选。仅当需要人为安排跨战绩对阵（如外部给了非常规对阵表）时才使用——锁定后比赛会标注「跨桶」，轮次标签只显示阶段名">
          <Checkbox
            checked={allowCrossBucket}
            disabled={drawing}
            onChange={(event) => setAllowCrossBucket(event.target.checked)}
          >
            允许跨桶配对（休眠选项 · 战绩不对等，锁定需二次确认）
          </Checkbox>
        </Tooltip>
        <span style={{ flex: 1 }} />
        <Button
          type="primary"
          size="large"
          loading={locking}
          disabled={readOnly || drawing || liveValidation.errors.length > 0}
          onClick={() => void handleLock()}
        >
          🔒 校验通过 · 锁定并创建 {expectedPairCount(specs)} 场比赛
        </Button>
      </Space>

      <Modal
        title="导入对阵表（每行一对：A vs B）"
        open={importOpen}
        onOk={() => void handleImport()}
        onCancel={() => setImportOpen(false)}
        okText="导入"
        cancelText="取消"
      >
        <Input.TextArea
          rows={8}
          placeholder={'选手0 vs 选手1\n选手2 VS 选手3'}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          名字按档案精确/子串模糊匹配（仅限本波选手）；匹配不上的行会列出供人工处理。
        </Text>
      </Modal>
    </div>
  );
}

/** 期望配对总数（各桶人数之和 / 2） */
function expectedPairCount(
  specs: ReturnType<typeof getDraftBucketSpecs>,
): number {
  return specs.reduce((sum, spec) => sum + spec.playerIds.length, 0) / 2;
}

/**
 * 是否总决赛阶段：引擎每阶段晋级半额，人数逐阶段减半，只剩 2 人的那个阶段即总决赛。
 * 与后端 createTournament 的校验同一判据（该阶段必须单败）。
 */
function isFinalStage(playerCount: number, stageIndex: number): boolean {
  return playerCount / 2 ** stageIndex === 2;
}

/** 桶 key → 中文池名 */
function bucketTitle(bucketKey: string): string {
  switch (bucketKey) {
    case '0-0':
      return '初始池';
    case '1-0':
      return '胜者池';
    case '0-1':
      return '败者池';
    case '1-1':
      return '决胜池';
    default:
      return '战绩池';
  }
}

/* ==================== 已锁定波：节点网格 ==================== */

function NodeGrid({
  record,
  wave,
  names,
  matches,
  onSelectMatch,
  onViewLineup,
  readOnly = false,
  cardMenu,
}: {
  record: TournamentRecord;
  wave: TournamentWave;
  names: Map<string, string>;
  matches: MatchRecord[];
  onSelectMatch(matchId: string): Promise<void>;
  onViewLineup(matchId: string): void;
  /** 只读副本：隐藏弃权操作（服务端也会拒绝） */
  readOnly?: boolean;
  /** 卡片右键 / 「⋯」菜单三件套（波次列表与晋级图共用一份判据） */
  cardMenu: TournamentCardMenuHandlers;
}): React.ReactElement {
  const { message } = App.useApp();
  const [forfeitNode, setForfeitNode] = useState<TournamentNode | null>(null);
  // 卡片与晋级图同源（buildWaveCards），两处内容、色调与状态样式一致
  const cards = useMemo(
    () => buildWaveCards(record, wave, names, matches),
    [record, wave, names, matches],
  );

  async function handleForfeit(
    node: TournamentNode,
    loserSide: 'left' | 'right',
  ): Promise<void> {
    if (!node.matchId) {
      return;
    }
    try {
      await forfeitApi(record.id, node.matchId, loserSide);
      message.success('已按弃权判负');
      setForfeitNode(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div>
      <Row gutter={[12, 12]}>
        {cards.map((card) => (
          <Col xs={24} md={12} xl={8} key={card.nodeId}>
            <TournamentNodeCard
              card={card}
              menu={cardMenu.menuFor(card.matchId)}
              onOpenPanel={cardMenu.onOpenPanel}
              onRunAction={cardMenu.onRunAction}
              onSelectMatch={(matchId) => void onSelectMatch(matchId)}
              onViewLineup={onViewLineup}
              onForfeit={readOnly ? undefined : () => setForfeitNode(
                wave.nodes.find((node) => node.id === card.nodeId) ?? null,
              )}
            />
          </Col>
        ))}
      </Row>

      <Modal
        title="弃权判负"
        open={forfeitNode !== null}
        onCancel={() => setForfeitNode(null)}
        footer={null}
      >
        {forfeitNode ? (
          <Space direction="vertical">
            <Text>选择弃权（判负）方：</Text>
            <Space wrap>
              <Button
                danger
                onClick={() => void handleForfeit(forfeitNode, 'left')}
              >
                左侧弃权
              </Button>
              <Button
                danger
                onClick={() => void handleForfeit(forfeitNode, 'right')}
              >
                右侧弃权
              </Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              仅未开始的比赛可弃权；系统按决胜局数补比分并标注「弃权」。
            </Text>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}

/* ==================== 创建系列赛向导 ==================== */

interface CreateModalProps {
  open: boolean;
  profiles: ProfileStoreState | null;
  /** id → 选手名字映射（向导第 4 步展示用） */
  names: Map<string, string>;
  onClose(): void;
  onCreated(tournamentId: string): void;
}

function CreateTournamentModal({
  open,
  profiles,
  names,
  onClose,
  onCreated,
}: CreateModalProps): React.ReactElement {
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [stages, setStages] = useState<StageRule[]>([]);
  /** stages 所对应的人数：人数变化时重填默认模板 */
  const [stagesBaseCount, setStagesBaseCount] = useState(0);
  /** 季军赛局数（0 = 不安排）：半决赛打完后自动用两名落败者建场，赛制在这里选定 */
  const [thirdPlaceBestOf, setThirdPlaceBestOf] = useState<number>(3);
  /** 高级设置：按波次设置局数（双败阶段的 W2/W3 覆盖）；关闭时保持基础表格面板、覆盖一并清掉 */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const createdIdRef = useRef<string | null>(null);

  // 每次重新打开：重置向导
  useEffect(() => {
    if (open) {
      setStep(0);
      setName('');
      setPlayerIds([]);
      setStages([]);
      setStagesBaseCount(0);
      setThirdPlaceBestOf(3);
      setAdvancedOpen(false);
      setPlayerSearch('');
      setSaving(false);
      createdIdRef.current = null;
    }
  }, [open]);

  const playerCountValid = TOURNAMENT_SIZE_OPTIONS.includes(playerIds.length);

  // 选手列表（搜索过滤，按录入顺序）
  const playerList = useMemo(() => {
    const keyword = playerSearch.trim().toLowerCase();
    const list = profiles?.players ?? [];
    return keyword
      ? list.filter((player) => player.name.toLowerCase().includes(keyword))
      : list;
  }, [profiles, playerSearch]);

  // 高级设置面板：只列双败阶段（单败只有一波，按波次设置无从谈起）
  const doubleLifeStageEntries = useMemo(
    () => stages
      .map((stage, index) => ({ stage, index }))
      .filter((entry) => entry.stage.format === 'double-life'),
    [stages],
  );

  function togglePlayer(id: string): void {
    setPlayerIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  /** 从选手步进入阶段步：人数变化时按人数重填默认模板，已自定义的阶段保留 */
  function enterStageStep(): void {
    if (stagesBaseCount !== playerIds.length) {
      setStages(buildDefaultStages(playerIds.length));
      setStagesBaseCount(playerIds.length);
    }
    setStep(2);
  }

  function updateStage(stageIndex: number, patch: Partial<StageRule>): void {
    setStages((current) =>
      current.map((stage, index) => {
        if (index !== stageIndex) {
          return stage;
        }
        const next = { ...stage, ...patch };
        // 赛制变化：配对方式复位为该赛制默认；单败没有按波次覆盖，一并清掉
        if (patch.format && patch.format !== stage.format) {
          next.pairing = patch.format === 'double-life' ? 'random-bucket' : 'bracket-seed';
          if (patch.format === 'single-elim') {
            delete next.waveBestOf;
          }
        }
        // 基础局数变化：覆盖值等于新基础 = 跟随基础，删掉覆盖（与编辑赛制 / 服务端归一同一口径）
        if (patch.bestOf !== undefined && next.waveBestOf) {
          const pruned: Partial<Record<2 | 3, StageRule['bestOf']>> = { ...next.waveBestOf };
          ([2, 3] as const).forEach((waveIndex) => {
            if (pruned[waveIndex] === patch.bestOf) {
              delete pruned[waveIndex];
            }
          });
          if (Object.keys(pruned).length) {
            next.waveBestOf = pruned;
          } else {
            delete next.waveBestOf;
          }
        }
        return next;
      }),
    );
  }

  /** 高级设置：双败 W2/W3 的波次覆盖；等于基础值 = 跟随基础（不落覆盖，与服务端归一一致） */
  function setWaveOverride(stageIndex: number, waveIndex: 2 | 3, value: StageRule['bestOf']): void {
    setStages((current) =>
      current.map((stage, index) => {
        if (index !== stageIndex) {
          return stage;
        }
        const overrides: Partial<Record<2 | 3, StageRule['bestOf']>> = { ...(stage.waveBestOf ?? {}) };
        if (value === stage.bestOf) {
          delete overrides[waveIndex];
        } else {
          overrides[waveIndex] = value;
        }
        const next = { ...stage };
        if (Object.keys(overrides).length) {
          next.waveBestOf = overrides;
        } else {
          delete next.waveBestOf;
        }
        return next;
      }),
    );
  }

  /** 创建草稿 → 进入第 4 步抽签 */
  async function handleCreate(): Promise<void> {
    setSaving(true);
    try {
      const record = await createTournamentApi({
        name: name.trim(),
        playerIds,
        stages,
        thirdPlaceBestOf,
      });
      createdIdRef.current = record.id;
      setStep(3);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const stepItems = [
    { title: '系列赛信息' },
    { title: '参赛选手' },
    { title: '阶段规则' },
    { title: '首波抽签' },
  ];

  return (
    <Modal
      title="创建系列赛"
      open={open}
      width={860}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Steps current={step} items={stepItems} style={{ marginBottom: 20 }} />

      {step === 0 ? (
        <Form layout="vertical">
          <Form.Item
            label="系列赛名称"
            required
            validateStatus={name.trim() ? 'success' : 'error'}
            help={name.trim() ? undefined : '请输入名称'}
          >
            <Input
              placeholder="如：夏季杯 S1"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </Form.Item>
        </Form>
      ) : null}

      {step === 1 ? (
        <div>
          <Input.Search
            placeholder="搜索选手名字"
            allowClear
            style={{ marginBottom: 10 }}
            onChange={(event) => setPlayerSearch(event.target.value)}
          />
          <div className="tournament-player-pick">
            <List
              size="small"
              dataSource={playerList}
              renderItem={(player) => (
                <List.Item>
                  <Checkbox
                    checked={playerIds.includes(player.id)}
                    onChange={() => togglePlayer(player.id)}
                  >
                    {player.name}
                  </Checkbox>
                </List.Item>
              )}
            />
          </div>
          <Text>
            已选 <b style={{ color: playerCountValid ? '#389e0d' : '#cf1322' }}>{playerIds.length}</b> / 必须为 {TOURNAMENT_SIZE_OPTIONS.join(' / ')} 人
          </Text>
        </div>
      ) : null}

      {step === 2 ? (
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={stages}
          columns={[
            {
              title: '阶段名',
              render: (_value, _row, index) => (
                <Input
                  value={stages[index].name}
                  onChange={(event) => updateStage(index, { name: event.target.value })}
                />
              ),
            },
            {
              title: '晋级赛制',
              width: 170,
              render: (_value, _row, index) => (
                <Segmented
                  size="small"
                  value={stages[index].format}
                  options={[
                    // 只剩 2 人的阶段（总决赛）双败打不出冠军，且 2 人双败配不出 W2，故禁用
                    { label: '双败', value: 'double-life', disabled: isFinalStage(playerIds.length, index) },
                    { label: '单败', value: 'single-elim' },
                  ]}
                  onChange={(value) => updateStage(index, { format: value as StageFormat })}
                />
              ),
            },
            {
              title: '局数',
              width: 180,
              render: (_value, _row, index) => (
                <Segmented
                  size="small"
                  value={stages[index].bestOf}
                  options={[
                    { label: 'BO1', value: 1 },
                    { label: 'BO3', value: 3 },
                    { label: 'BO5', value: 5 },
                    { label: 'BO7', value: 7 },
                  ]}
                  onChange={(value) => updateStage(index, { bestOf: value as StageRule['bestOf'] })}
                />
              ),
            },
            {
              title: '配对',
              width: 170,
              render: (_value, _row, index) => {
                const stage = stages[index];
                if (stage.format === 'double-life') {
                  return (
                    <Segmented
                      size="small"
                      value={stage.pairing}
                      options={[
                        { label: '随机', value: 'random-bucket' },
                        { label: '手动', value: 'manual-bucket' },
                      ]}
                      onChange={(value) => updateStage(index, { pairing: value as StageRule['pairing'] })}
                    />
                  );
                }
                return (
                  <Segmented
                    size="small"
                    value={stage.pairing}
                    options={[
                      { label: '沿对阵树', value: 'bracket-seed' },
                      { label: '每轮随机', value: 'random-round' },
                    ]}
                    onChange={(value) => updateStage(index, { pairing: value as StageRule['pairing'] })}
                  />
                );
              },
            },
            {
              title: '避重复',
              width: 70,
              render: (_value, _row, order) => (
                <Switch
                  size="small"
                  checked={stages[order].avoidRematch}
                  onChange={(checked) => updateStage(order, { avoidRematch: checked })}
                />
              ),
            },
            {
              title: '需确认',
              width: 70,
              render: (_value, _row, order) => (
                <Switch
                  size="small"
                  checked={stages[order].requireConfirm}
                  onChange={(checked) => updateStage(order, { requireConfirm: checked })}
                />
              ),
            },
          ]}
          footer={() => (
            <Text type="secondary" style={{ fontSize: 12 }}>
              只剩 2 人的阶段（总决赛）固定为单败：该阶段双败既产出不了冠军，也配不出下一波
            </Text>
          )}
        />
      ) : null}

      {step === 2 ? (
        <div className="tournament-third-place" style={{ marginTop: 12 }}>
          <Space size={12} wrap>
            <Text strong>{THIRD_PLACE_LABEL}</Text>
            <Segmented
              value={thirdPlaceBestOf}
              options={THIRD_PLACE_BEST_SEGMENTS}
              onChange={(value) => setThirdPlaceBestOf(value as number)}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              4 进 2 打完后，用两名落败者自动建一场季军赛（附加赛，不影响晋级与积分榜）；
              选「不安排」则不建场
            </Text>
          </Space>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="tournament-advanced-block">
          <Space size={10} wrap>
            <Text strong>高级设置</Text>
            <Switch
              size="small"
              checked={advancedOpen}
              onChange={(checked) => {
                setAdvancedOpen(checked);
                // 关闭 = 回到「全阶段统一基础局数」：按波次覆盖一并清掉
                if (!checked) {
                  setStages((current) => current.map((stage) => {
                    if (!stage.waveBestOf) {
                      return stage;
                    }
                    const next = { ...stage };
                    delete next.waveBestOf;
                    return next;
                  }));
                }
              }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              按波次设置局数：双败阶段的 W2 / W3 可单独用不同 BO，默认跟随基础局数（W1）
            </Text>
          </Space>
          {advancedOpen ? (
            doubleLifeStageEntries.length ? (
              <div>
                {doubleLifeStageEntries.map(({ stage, index }) => (
                  <div key={stage.id} className="tournament-advanced-stage">
                    <Space size={8}>
                      <Text strong style={{ fontSize: 12 }}>{stage.name}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        双败 · {formatStageBestOf(stage)}
                      </Text>
                    </Space>
                    {([1, 2, 3] as const).map((waveIndex) => {
                      const explicit = waveIndex === 1 ? undefined : stage.waveBestOf?.[waveIndex];
                      const follows = waveIndex > 1 && (explicit === undefined || explicit === stage.bestOf);
                      return (
                        <StageWaveBestOfRow
                          key={waveIndex}
                          waveIndex={waveIndex}
                          roundLabels={getStageWaveRoundLabels(stage, waveIndex)}
                          value={waveIndex === 1 ? stage.bestOf : explicit ?? stage.bestOf}
                          hint={waveIndex === 1 ? '基础' : follows ? '跟随基础' : '独立覆盖'}
                          onChange={(next) => {
                            if (waveIndex === 1) {
                              updateStage(index, { bestOf: next as StageRule['bestOf'] });
                              return;
                            }
                            setWaveOverride(index, waveIndex, next as StageRule['bestOf']);
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                当前阶段配置中没有双败阶段（单败只有一波），无需按波次设置
              </Text>
            )
          ) : null}
        </div>
      ) : null}

      {step === 3 && createdIdRef.current ? (
        <CreatedStep
          tournamentId={createdIdRef.current}
          names={names}
          onFinish={() => onCreated(createdIdRef.current!)}
        />
      ) : null}

      <div className="tournament-wizard-actions">
        {step > 0 && step < 3 ? (
          <Button onClick={() => setStep(step - 1)}>上一步</Button>
        ) : null}
        <span style={{ flex: 1 }} />
        {step === 0 ? (
          <Button type="primary" disabled={!name.trim()} onClick={() => setStep(1)}>
            下一步：选择选手
          </Button>
        ) : null}
        {step === 1 ? (
          <Button type="primary" disabled={!playerCountValid} onClick={enterStageStep}>
            下一步：阶段规则
          </Button>
        ) : null}
        {step === 2 ? (
          <Button type="primary" loading={saving} onClick={() => void handleCreate()}>
            创建草稿
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * 向导第 4 步：本地拉取系列赛记录，复用 SetupDraftPanel；
 * 抽签/开赛后经 onChanged 重新拉取（未离开向导时可看到结果）。
 */
function CreatedStep({
  tournamentId,
  names,
  onFinish,
}: {
  tournamentId: string;
  names: Map<string, string>;
  onFinish(): void;
}): React.ReactElement {
  const { message } = App.useApp();
  const [record, setRecord] = useState<TournamentRecord | null>(null);

  async function reload(): Promise<void> {
    try {
      const list = await listTournamentsApi();
      setRecord(list.find((item) => item.id === tournamentId) ?? null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  if (!record) {
    return <Text type="secondary">加载中…</Text>;
  }

  // 已开赛：不再显示抽签面板（详情页可见已生成的波次）
  if (record.status !== 'setup') {
    return (
      <div>
        <Text>✅ 系列赛已开赛，第 1 波比赛已生成。</Text>
        <div style={{ marginTop: 12 }}>
          <Button type="primary" onClick={onFinish}>打开详情</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SetupDraftPanel
        record={record}
        names={names}
        onChanged={() => void reload()}
        key={`${record.drawVersion}-${record.status}`}
      />
      <Space style={{ marginTop: 12 }}>
        <Text type="secondary">也可以先关闭，稍后在列表中「继续配置」</Text>
        <Button type="primary" onClick={onFinish}>完成，打开详情</Button>
      </Space>
    </div>
  );
}
