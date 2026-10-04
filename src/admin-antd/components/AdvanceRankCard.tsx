import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Input, InputNumber, Modal, Segmented, Select, Space, Table, Tag, Typography } from 'antd';

import { formatStageBestOf, PAGE14_ROWS_PER_PAGE } from '../../../shared/constants';
import type { Page14State, StageStandings, TournamentRecord } from '../../../shared/types';
import { getStagePlayerCount, summarizeStageMatches } from '../lib/tournament';

const { Text } = Typography;

/** 确认保存时的请求体：系列赛 + 可播阶段 + 当前阶段 + 页码 + 标题副标题 */
export interface AdvanceRankPayload {
  tournamentId: string;
  stageIndexes: number[];
  activeStageIndex: number;
  page: number;
  title: string;
  subtitle: string;
}

interface AdvanceRankCardProps {
  /** 全部系列赛（弹窗里选一个作为榜单来源） */
  tournaments: TournamentRecord[];
  /** 服务端当前配置 */
  state: Page14State;
  /** 服务端算好的当前阶段榜单（摘要与页数提示用；系列赛缺失时为 null） */
  standings: StageStandings | null;
  saving: boolean;
  /** 保存配置（内联切换与弹窗确认共用）；抛出错误时调用方已提示 */
  onSave: (payload: AdvanceRankPayload) => Promise<void>;
}

/** 阶段表的一行 */
interface StageRow {
  index: number;
  name: string;
  formatText: string;
  /** 赛制展示文本（含双败波次覆盖，如「BO1」/「W1 BO1 / W2·W3 BO3」） */
  bestOfText: string;
  playerCount: number;
  completed: number;
  total: number;
}

/**
 * 比赛管理第四张功能卡片：晋级积分榜（推流页面14）。
 *
 * 与前三张卡片（比赛结果 / 战绩详情 / 比赛预告）复用同一套卡片与弹窗外壳，但**选择语义不同**：
 * 前三是「逐场勾选比赛」，这里是「一次性选中一个阶段」——选中即带入该阶段全部 32 / 16 人的比分，
 * 页面按系列赛赛果自动统计，无需逐场挑选。因此弹窗主体是独立的，不复用 MatchPushCard 的候选表。
 *
 * 阶段切换与翻页做成卡片上的内联快捷控制（裁判在直播中不该反复开关弹窗）。
 */
export function AdvanceRankCard({ tournaments, state, standings, saving, onSave }: AdvanceRankCardProps) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [tournamentDraft, setTournamentDraft] = useState('');
  const [stageDraft, setStageDraft] = useState<number[]>([]);
  const [activeDraft, setActiveDraft] = useState(-1);
  const [pageDraft, setPageDraft] = useState(0);
  const [titleDraft, setTitleDraft] = useState('');
  const [subtitleDraft, setSubtitleDraft] = useState('');

  const tournamentById = useMemo(
    () => new Map(tournaments.map((record) => [record.id, record])),
    [tournaments],
  );
  const current = state.tournamentId ? tournamentById.get(state.tournamentId) ?? null : null;
  const activeStage = current && state.activeStageIndex >= 0
    ? current.stages[state.activeStageIndex] ?? null
    : null;
  const pageCount = standings?.pageCount ?? 1;

  // 每次打开弹窗以服务端状态初始化本地草稿
  useEffect(() => {
    if (!open) {
      return;
    }
    setTournamentDraft(state.tournamentId);
    setStageDraft([...state.stageIndexes]);
    setActiveDraft(state.activeStageIndex);
    setPageDraft(state.page);
    setTitleDraft(state.title);
    setSubtitleDraft(state.subtitle);
  }, [open, state]);

  const draftRecord = tournamentDraft ? tournamentById.get(tournamentDraft) ?? null : null;
  const draftStages = useMemo<StageRow[]>(() => {
    if (!draftRecord) {
      return [];
    }
    return draftRecord.stages.map((stage, index) => {
      const summary = summarizeStageMatches(draftRecord, index);
      return {
        index,
        name: stage.name,
        formatText: stage.format === 'double-life' ? '双败' : '单败',
        bestOfText: formatStageBestOf(stage),
        playerCount: getStagePlayerCount(draftRecord, index),
        completed: summary.completed,
        total: summary.total,
      };
    });
  }, [draftRecord]);

  /** 换系列赛：默认勾选该系列赛全部阶段（要少播哪几个阶段由裁判取消勾选） */
  function chooseTournament(tournamentId: string): void {
    setTournamentDraft(tournamentId);
    const record = tournamentId ? tournamentById.get(tournamentId) ?? null : null;
    const allIndexes = record ? record.stages.map((_stage, index) => index) : [];
    setStageDraft(allIndexes);
    setActiveDraft(allIndexes.length ? allIndexes[0] : -1);
    setPageDraft(0);
  }

  /** 内联快捷控制：阶段切换 / 翻页，立即保存（失败时提示由调用方负责） */
  async function applyInline(patch: Partial<AdvanceRankPayload>): Promise<void> {
    try {
      await onSave({
        tournamentId: state.tournamentId,
        stageIndexes: state.stageIndexes,
        activeStageIndex: state.activeStageIndex,
        page: state.page,
        title: state.title,
        subtitle: state.subtitle,
        ...patch,
      });
    } catch {
      // message 已由 onSave 内部给出，这里保持当前状态不变
    }
  }

  const draftPageCount = activeDraft >= 0 && draftRecord
    ? Math.max(1, Math.ceil(getStagePlayerCount(draftRecord, activeDraft) / PAGE14_ROWS_PER_PAGE))
    : 1;

  async function handleConfirm(): Promise<void> {
    if (!draftRecord) {
      message.warning('请选择系列赛');
      return;
    }
    if (!stageDraft.length) {
      message.warning('请至少勾选一个阶段');
      return;
    }
    try {
      await onSave({
        tournamentId: tournamentDraft,
        stageIndexes: stageDraft,
        activeStageIndex: stageDraft.includes(activeDraft) ? activeDraft : stageDraft[0],
        page: Math.min(pageDraft, draftPageCount - 1),
        title: titleDraft.trim(),
        subtitle: subtitleDraft.trim(),
      });
      setOpen(false);
    } catch {
      // 错误提示由调用方负责，弹窗保持打开便于调整
    }
  }

  const draftActiveStage = draftRecord && activeDraft >= 0
    ? draftRecord.stages[activeDraft] ?? null
    : null;
  const draftSubtitlePlaceholder = draftActiveStage
    ? `留空自动生成「${draftActiveStage.name} · ${draftActiveStage.format === 'double-life' ? '双败淘汰' : '单败淘汰'} · ${formatStageBestOf(draftActiveStage)}」`
    : '留空自动生成副标题';

  return (
    <>
      <Card
        size="small"
        className="subtle-card match-push-card"
        title="推送晋级积分榜"
        extra={(
          <Tag color={current ? 'purple' : 'default'}>
            {current ? `${current.name} · ${activeStage?.name ?? '未选阶段'}` : '未选择'}
          </Tag>
        )}
      >
        <Space direction="vertical" size={10} className="match-push-card-body">
          {current && activeStage ? (
            <>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {standings
                  ? `${standings.stageName} · ${standings.rows.length} 人 · 已完赛 ${standings.completedMatches}/${standings.totalMatches} 场`
                  : `${activeStage.name} · 阶段尚未开始`}
              </Text>
              {/* 阶段多的系列赛（64 人共 6 个阶段）在窄列里横向滚动，避免压扁换行 */}
              <div className="advance-rank-stages">
                <Segmented
                  size="small"
                  value={String(state.activeStageIndex)}
                  options={state.stageIndexes.map((index) => ({
                    value: String(index),
                    label: current.stages[index]?.name ?? `阶段${index + 1}`,
                  }))}
                  onChange={(value) => void applyInline({ activeStageIndex: Number(value), page: 0 })}
                />
              </div>
              <Space size={8} align="center" style={{ justifyContent: 'center', width: '100%' }}>
                <Button size="small" disabled={state.page <= 0} onClick={() => void applyInline({ page: state.page - 1 })}>
                  上一页
                </Button>
                <Text strong>第 {state.page + 1} / {pageCount} 页</Text>
                <Button
                  size="small"
                  disabled={state.page >= pageCount - 1}
                  onClick={() => void applyInline({ page: state.page + 1 })}
                >
                  下一页
                </Button>
              </Space>
            </>
          ) : (
            <Text type="secondary" className="match-push-empty-hint">
              {state.tournamentId ? '系列赛不存在或尚未同步到本机' : '尚未选择系列赛与阶段'}
            </Text>
          )}
          <Button type="primary" block onClick={() => setOpen(true)}>选择系列赛与阶段</Button>
        </Space>
      </Card>

      <Modal
        title="晋级积分榜 · 选择系列赛与阶段"
        open={open}
        width={880}
        destroyOnClose
        onCancel={() => setOpen(false)}
        footer={(
          <Space>
            <Text type="secondary">
              勾选阶段 = 一次性带入该阶段全部选手的比分 · 每页 {PAGE14_ROWS_PER_PAGE} 行，超出由后台翻页
            </Text>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void handleConfirm()}>确认推送</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} className="match-push-modal-body">
          <Space wrap size={16} align="start">
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>系列赛：</Text>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: 380 }}
                placeholder="选择要展示积分榜的系列赛"
                value={tournamentDraft || undefined}
                onChange={(value) => chooseTournament(value)}
                options={tournaments.map((record) => ({
                  value: record.id,
                  label: `${record.name}（${record.playerIds.length} 人 · ${record.status === 'completed' ? '已结束' : record.status === 'setup' ? '待开赛' : '进行中'}）`,
                }))}
              />
            </div>
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>大标题：</Text>
              <Input
                allowClear
                maxLength={40}
                style={{ width: 300 }}
                placeholder="留空显示默认「晋级积分榜」"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
              />
            </div>
          </Space>

          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>副标题：</Text>
            <Input
              allowClear
              maxLength={60}
              placeholder={draftSubtitlePlaceholder}
              value={subtitleDraft}
              onChange={(event) => setSubtitleDraft(event.target.value)}
            />
          </div>

          <Table<StageRow>
            size="small"
            rowKey="index"
            pagination={false}
            dataSource={draftStages}
            locale={{ emptyText: '请先选择系列赛' }}
            rowSelection={{
              selectedRowKeys: stageDraft,
              onChange: (keys) => {
                const next = keys.map(Number).sort((left, right) => left - right);
                setStageDraft(next);
                setActiveDraft((active) => (next.includes(active) ? active : (next[0] ?? -1)));
              },
            }}
            columns={[
              { title: '阶段', dataIndex: 'name' },
              { title: '赛制', dataIndex: 'formatText', width: 80 },
              { title: 'BO', dataIndex: 'bestOfText', width: 150 },
              {
                title: '参赛人数',
                dataIndex: 'playerCount',
                width: 100,
                render: (value: number) => `${value} 人`,
              },
              {
                title: '场次（已完赛 / 已建场）',
                key: 'matches',
                width: 180,
                render: (_value: unknown, row: StageRow) => `${row.completed} / ${row.total}`,
              },
            ]}
          />

          <Space wrap size={16} align="center">
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>当前展示阶段：</Text>
              <Segmented
                value={activeDraft >= 0 ? String(activeDraft) : ''}
                options={stageDraft.map((index) => ({
                  value: String(index),
                  label: draftRecord?.stages[index]?.name ?? `阶段${index + 1}`,
                }))}
                onChange={(value) => {
                  setActiveDraft(Number(value));
                  setPageDraft(0);
                }}
              />
            </div>
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                展示第几页（共 {draftPageCount} 页，每页 {PAGE14_ROWS_PER_PAGE} 行）：
              </Text>
              <InputNumber
                min={1}
                max={draftPageCount}
                value={Math.min(pageDraft, draftPageCount - 1) + 1}
                onChange={(value) => setPageDraft(Math.max(0, Number(value ?? 1) - 1))}
              />
            </div>
          </Space>
        </Space>
      </Modal>
    </>
  );
}
