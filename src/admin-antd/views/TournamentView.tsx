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
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { buildDefaultStages, SUPPORTED_TOURNAMENT_SIZES } from '../../../shared/constants';
import type {
  MatchRecord,
  ProfileStoreState,
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
  getCurrentPositionText,
  getDraftBucketSpecs,
  getPairingLabel,
  getStageState,
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
  forfeitApi,
  importPairingsApi,
  listTournamentsApi,
  lockPairingsApi,
  previewOpeningWaveApi,
  rollbackWaveApi,
  savePairingDraftApi,
  selectMatchApi,
  startTournamentApi,
} from '../lib/tournament-api';
import { BracketBoard } from '../components/BracketBoard';
import { TournamentNodeCard } from '../components/TournamentNodeCard';

const { Text, Paragraph } = Typography;

/** 配对草稿行类型简写 */
type DraftRow = NonNullable<TournamentWave['pairingDraft']>[number];
type DraftPairList = NonNullable<TournamentWave['pairingDraft']>;

/** 参赛人数可选值：与后端 SUPPORTED_TOURNAMENT_SIZES 同源，避免两处硬编码走偏 */
const TOURNAMENT_SIZE_OPTIONS = Array.from(SUPPORTED_TOURNAMENT_SIZES).sort((a, b) => a - b);

/* ==================== 系列赛列表 + 详情容器 ==================== */

export interface TournamentViewProps {
  tournaments: TournamentRecord[];
  profiles: ProfileStoreState | null;
  matches: MatchRecord[];
  /** 本机机器标识：判定系列赛是否归本机编排（只读副本禁用编排操作） */
  machineCode: string;
  /** 切换为当前比赛后跳转赛事面板（App 提供） */
  onJumpToRoster?: () => void;
}

export function TournamentView({
  tournaments,
  profiles,
  matches,
  machineCode,
  onJumpToRoster,
}: TournamentViewProps): React.ReactElement {
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 删除系列赛确认弹窗：deleteWithMatches=连同关联对局一起删（可在比赛管理撤回）
  const [deleteTarget, setDeleteTarget] = useState<TournamentRecord | null>(null);
  const [deleteWithMatches, setDeleteWithMatches] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);

  async function handleDeleteTournament(): Promise<void> {
    if (!deleteTarget) {
      return;
    }
    setDeleteSaving(true);
    try {
      const result = await deleteTournamentApi(deleteTarget.id, deleteWithMatches);
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

  // 当前选中记录（被删除时自动回退到第一条；无数据则 null）
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
        <Button type="link" style={{ padding: 0 }} onClick={() => setSelectedId(record.id)}>
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
      width: 176,
      render: (_value, record) => (
        <Space size={4}>
          <Button type="link" style={{ padding: 0 }} onClick={() => setSelectedId(record.id)}>
            {record.status === 'setup' ? '继续配置 →' : '打开详情 →'}
          </Button>
          <Button
            type="link"
            danger
            style={{ padding: 0 }}
            disabled={!isTournamentOwnedByLocal(record.id, machineCode)}
            onClick={() => {
              setDeleteWithMatches(false);
              setDeleteTarget(record);
            }}
          >
            删除
          </Button>
        </Space>
      ),
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
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            ＋ 创建系列赛
          </Button>
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
          machineCode={machineCode}
          onSelectMatch={handleSelectMatch}
          onDelete={() => {
            setDeleteWithMatches(false);
            setDeleteTarget(selected);
          }}
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

      <CreateTournamentModal
        open={createOpen}
        profiles={profiles}
        names={names}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          setSelectedId(id);
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
  machineCode: string;
  onSelectMatch(matchId: string): Promise<void>;
  onDelete(): void;
}

function TournamentDetail({
  record,
  names,
  matches,
  machineCode,
  onSelectMatch,
  onDelete,
}: DetailProps): React.ReactElement {
  const { message, modal } = App.useApp();
  // 只读副本（系列赛由另一台机器编排）：可查看与登记对局，编排/推进由服务端拒绝
  const ownerCode = getTournamentOwnerCode(record.id);
  const readOnly = !isTournamentOwnedByLocal(record.id, machineCode);
  // 详情视图：晋级图（默认）/ 波次列表；setup 阶段固定走抽签面板
  const [detailView, setDetailView] = useState<'bracket' | 'waves'>('bracket');

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
        </Space>
      )}
    >
      {readOnly ? (
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          只读副本：该系列赛由{ownerCode ? `机器 ${ownerCode}` : '另一台机器'}编排 —— 本机可查看对阵图、可登记对局赛果；推进与编排请在编排机执行，回传后本机对阵图自动更新。
        </Paragraph>
      ) : null}

      {record.result ? (
        <Paragraph>
          <Tag color="gold">🏆 冠军：{resolvePlayerName(names, record.result.championId)}</Tag>
          <Tag color="default">亚军：{resolvePlayerName(names, record.result.runnerUpId)}</Tag>
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
                  {stage.format === 'double-life' ? '双败' : '单败'} · BO{stage.bestOf}
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
          readOnly={readOnly}
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
              readOnly={readOnly}
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
  readOnly: boolean;
}

function WavePanel({
  record,
  wave,
  names,
  matches,
  onSelectMatch,
  readOnly,
}: WavePanelProps): React.ReactElement {
  const stage = record.stages[wave.stageIndex];
  // 轮次表述与晋级图同一套术语：双败给「败者组 R1 / 胜者组 R2」，单败直接用阶段名
  const rounds = getWaveRoundLabels(record, wave);

  return (
    <Card
      type="inner"
      style={{ marginTop: 12 }}
      title={(
        <Space size={8} wrap>
          <b>第 {wave.waveIndex} 波</b>
          {/* 轮次名作追加标注（双败才有），阶段名 + 赛制、配对方式 + 配对状态各用一个 Tag */}
          {rounds.length ? <Text type="secondary">{rounds.join(' / ')}</Text> : null}
          <Tag>{stage.name} · {stage.format === 'double-life' ? '双败' : '单败'}</Tag>
          <Tag color={wave.pairingStatus === 'draft' ? 'warning' : 'default'}>
            {getPairingLabel(stage.pairing)} · {wave.pairingStatus === 'draft' ? '配对草稿' : '已锁定'}
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
          readOnly={readOnly}
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

  const [allowCrossBucket, setAllowCrossBucket] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);

  // 编辑即存（防抖 500ms）
  const saveTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
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

  /** 🎲 桶内随机重排：每个桶独立洗牌；决胜池（W3 的 1-1 池）走经典双败交叉配对 */
  function handleShuffle(): void {
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
    setPairs(next);
    scheduleSave(next);
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
  const groups = useMemo(
    () => specs.map((spec) => ({
      bucketKey: spec.bucketKey,
      rows: pairs
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.bucketKey === spec.bucketKey),
    })),
    [specs, pairs],
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
        <Button onClick={handleShuffle} disabled={readOnly}>🎲 桶内随机重排</Button>
        <Button onClick={() => setImportOpen(true)} disabled={readOnly}>📋 导入对阵表</Button>
        <Button onClick={addRow} disabled={readOnly}>＋ 添加一行</Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {readOnly ? '只读副本：配对草稿由编排机编辑' : saving ? '保存中…' : '草稿自动暂存（锁定前赛事面板看不到比赛）'}
        </Text>
      </Space>

      <Row gutter={[12, 12]}>
        {groups.map((group) => (
          <Col xs={24} xl={groups.length > 1 ? 12 : 24} key={group.bucketKey ?? '__single'}>
            <div className="tournament-bucket-box">
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
                  <div className="tournament-pair-row" key={flatIndex}>
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
                      disabled={readOnly}
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
                      disabled={readOnly}
                      onChange={(value) => updateSlot(flatIndex, 1, value)}
                    />
                    <Button type="text" danger disabled={readOnly} onClick={() => removeRow(flatIndex)}>
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
        <Checkbox
          checked={allowCrossBucket}
          onChange={(event) => setAllowCrossBucket(event.target.checked)}
        >
          允许跨桶配对（战绩不对等，锁定需二次确认）
        </Checkbox>
        <span style={{ flex: 1 }} />
        <Button
          type="primary"
          size="large"
          loading={locking}
          disabled={readOnly || liveValidation.errors.length > 0}
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
  readOnly = false,
}: {
  record: TournamentRecord;
  wave: TournamentWave;
  names: Map<string, string>;
  matches: MatchRecord[];
  onSelectMatch(matchId: string): Promise<void>;
  /** 只读副本：隐藏弃权操作（服务端也会拒绝） */
  readOnly?: boolean;
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
              onSelectMatch={(matchId) => void onSelectMatch(matchId)}
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
        // 赛制变化：配对方式复位为该赛制默认
        if (patch.format && patch.format !== stage.format) {
          next.pairing = patch.format === 'double-life' ? 'random-bucket' : 'bracket-seed';
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
              placeholder="如：星空杯 S1"
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

/** 阶段表占位辅助已移除（人数变化以 stagesBaseCount 判断） */

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
