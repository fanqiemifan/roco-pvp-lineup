import React, { useEffect, useMemo, useState } from 'react';
import { Alert, App, Modal, Select, Tag, Typography } from 'antd';

import { resolveThirdPlaceBestOf, resolveWaveBestOf } from '../../../shared/constants';
import type { MatchRecord, TournamentRecord } from '../../../shared/types';
import { buildStageBestOfReview } from '../lib/tournament';
import type { StageBestOfChange, StageBestOfReviewRow } from '../lib/tournament';
import { updateTournamentStagesApi } from '../lib/tournament-api';

const { Paragraph, Text } = Typography;

const STAGE_BEST_OF_OPTIONS = [1, 3, 5, 7].map((value) => ({ value, label: `BO${value}` }));
const THIRD_PLACE_OPTIONS = [0, 1, 3, 5, 7].map((value) => ({
  value,
  label: value === 0 ? '不安排' : `BO${value}`,
}));

/** 影响预览单行文案（弹窗与确认框共用） */
function describeRow(row: StageBestOfReviewRow): string {
  const parts = [`${row.stageName} · W${row.waveIndex}：BO${row.fromBestOf} → BO${row.toBestOf}`];
  if (row.completed) {
    parts.push(`${row.completed} 场已完赛将清除赛果（保第 1 局阵容）`);
  }
  if (row.inProgress) {
    parts.push(`${row.inProgress} 场进行中将清除比分（保本局阵容）`);
  }
  if (row.pending) {
    parts.push(`${row.pending} 场未开打直接更新`);
  }
  if (!row.completed && !row.inProgress && !row.pending) {
    parts.push('尚无已建对局，规则直接生效');
  }
  return parts.join('，');
}

export interface TournamentStageBestOfModalProps {
  open: boolean;
  record: TournamentRecord;
  matches: MatchRecord[];
  onClose(): void;
}

/**
 * 编辑赛制弹窗（编排机）：逐阶段改基础 BO（W1）+ 双败 W2/W3 按波次覆盖 + 季军赛独立赛制。
 * - 波内全未开打：保存即更新规则与已建对局的赛制（更早的波不动）；
 * - 波内已有进行中 / 已完赛：保存走「重开该波」——强确认列清代价后，清赛况（保留阵容）、
 *   换新赛制，配对依赖旧结果的后续波作废重建；
 * - 判定以服务端为准，这里的影响预览与服务端同口径（供确认用）。
 */
export function TournamentStageBestOfModal({
  open,
  record,
  matches,
  onClose,
}: TournamentStageBestOfModalProps): React.ReactElement {
  const { message, modal } = App.useApp();
  // 基础赛制草稿（= W1 与未覆盖波次）；按波次覆盖草稿（仅双败 W2/W3，等于基础值时服务端归一为跟随）
  const [stageDrafts, setStageDrafts] = useState<Record<number, number>>({});
  const [waveOverrides, setWaveOverrides] = useState<Record<number, Partial<Record<2 | 3, number>>>>({});
  const [thirdDraft, setThirdDraft] = useState<number>(3);
  const [saving, setSaving] = useState(false);

  // 打开（或切换系列赛）时用当前记录初始化；弹窗打开期间的 socket 更新不覆盖用户已改的草稿
  useEffect(() => {
    if (!open) {
      return;
    }
    const nextStage: Record<number, number> = {};
    const nextWave: Record<number, Partial<Record<2 | 3, number>>> = {};
    record.stages.forEach((stage, index) => {
      nextStage[index] = stage.bestOf;
      nextWave[index] = { ...(stage.waveBestOf ?? {}) };
    });
    setStageDrafts(nextStage);
    setWaveOverrides(nextWave);
    setThirdDraft(resolveThirdPlaceBestOf(record));
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record 随 socket 更新换引用，只在打开时初始化
  }, [open, record.id]);

  const changes = useMemo<StageBestOfChange[]>(() => {
    const list: StageBestOfChange[] = [];
    record.stages.forEach((stage, index) => {
      const nextBase = stageDrafts[index] ?? stage.bestOf;
      const change: StageBestOfChange = { index };
      if (nextBase !== stage.bestOf) {
        change.bestOf = nextBase;
      }
      if (stage.format === 'double-life') {
        const waveChange: Partial<Record<2 | 3, number>> = {};
        ([2, 3] as const).forEach((waveIndex) => {
          const explicit = waveOverrides[index]?.[waveIndex];
          const nextValue = explicit ?? nextBase;
          const currentValue = resolveWaveBestOf(stage, waveIndex);
          // 只在「显式覆盖发生变化」时下发；等于基础值的情况由服务端归一为跟随基础
          if (explicit !== undefined && nextValue !== currentValue) {
            waveChange[waveIndex] = nextValue;
          }
        });
        if (Object.keys(waveChange).length) {
          change.waveBestOf = waveChange;
        }
      }
      if (change.bestOf !== undefined || change.waveBestOf !== undefined) {
        list.push(change);
      }
    });
    return list;
  }, [record, stageDrafts, waveOverrides]);

  const thirdChanged = thirdDraft !== resolveThirdPlaceBestOf(record);
  const review = useMemo(
    () => buildStageBestOfReview(record, matches, changes, thirdChanged ? thirdDraft : undefined),
    [record, matches, changes, thirdDraft, thirdChanged],
  );

  async function submit(confirmReopen: boolean): Promise<void> {
    setSaving(true);
    try {
      const result = await updateTournamentStagesApi(record.id, {
        stages: changes.map((change) => ({
          index: change.index,
          ...(change.bestOf !== undefined ? { bestOf: change.bestOf } : {}),
          ...(change.waveBestOf ? { waveBestOf: change.waveBestOf } : {}),
        })),
        ...(thirdChanged ? { thirdPlaceBestOf: thirdDraft } : {}),
        ...(confirmReopen ? { confirmReopen: true } : {}),
      });
      const parts: string[] = [];
      if (result.reopenedMatchIds.length) {
        parts.push(`重开 ${result.reopenedMatchIds.length} 场（阵容保留）`);
      }
      if (result.updatedMatchIds.length) {
        parts.push(`更新 ${result.updatedMatchIds.length} 场赛制`);
      }
      if (result.discardedWaveCount) {
        parts.push(`作废 ${result.discardedWaveCount} 个后续波`);
      }
      message.success(`已保存：${parts.join('，') || '赛制已更新'}`);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!changes.length && !thirdChanged) {
      message.info('没有需要保存的赛制改动');
      return;
    }
    if (review.blockers.length) {
      message.error(review.blockers[0]);
      return;
    }
    if (review.destructive) {
      modal.confirm({
        title: '确认重开所选波次并修改赛制',
        width: 480,
        okText: '确认重开并修改',
        okButtonProps: { danger: true },
        cancelText: '取消',
        content: (
          <div>
            <Paragraph style={{ marginTop: 0 }}>此操作不可撤回，请核对代价：</Paragraph>
            <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
              {review.rows
                .filter((row) => row.completed + row.inProgress > 0)
                .map((row) => (
                  <li key={`${row.stageIndex}-${row.waveIndex}`}>{describeRow(row)}</li>
                ))}
              {review.discardWaveLabels.length ? (
                <li>后续波作废重建：{review.discardWaveLabels.join('、')}（软删，可在「撤回最近删除」恢复）</li>
              ) : null}
              {thirdChanged ? <li>季军赛赛制同步更新（已建未开打的对局一并换赛制）</li> : null}
              <li>被重开波的节点胜者清空、阶段战绩重算；对局若正在推流，建议先切走画面</li>
            </ul>
          </div>
        ),
        onOk: () => submit(true),
      });
      return;
    }
    await submit(false);
  }

  const previewRows = (
    <div>
      {review.rows.map((row) => (
        <div key={`${row.stageIndex}-${row.waveIndex}`}>{describeRow(row)}</div>
      ))}
      {review.discardWaveLabels.length ? (
        <div>后续波作废重建：{review.discardWaveLabels.join('、')}</div>
      ) : null}
    </div>
  );

  return (
    <Modal
      title={`编辑赛制 · ${record.name}`}
      width={600}
      open={open}
      okText="保存更改"
      cancelText="取消"
      okButtonProps={{ loading: saving }}
      onOk={() => void handleSave()}
      onCancel={onClose}
    >
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        基础赛制作用于 W1 与未覆盖的波次；双败阶段的 W2/W3 可单独覆盖。改动只影响所选波次及其之后——
        该波已有进行中 / 已完赛时会「重开该波」（清除赛况、保留阵容），配对依赖旧结果的后续波作废重建；
        更早的波不动。
      </Paragraph>

      {record.stages.map((stage, index) => {
        const stageDone = record.status !== 'setup' && index < record.currentStageIndex;
        const isCurrent = record.status !== 'setup' && index === record.currentStageIndex;
        const isDoubleLife = stage.format === 'double-life';
        const baseValue = stageDrafts[index] ?? stage.bestOf;
        return (
          <div key={stage.id} style={{ borderBottom: '1px dashed #f0f0f0', paddingBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0 2px' }}>
              <span style={{ width: 76, fontWeight: 600 }}>{stage.name}</span>
              <Text type="secondary" style={{ width: 40 }}>
                {isDoubleLife ? '双败' : '单败'}
              </Text>
              {isDoubleLife ? <Text type="secondary" style={{ fontSize: 12 }}>W1</Text> : null}
              <Select
                size="small"
                style={{ width: 92 }}
                value={baseValue}
                disabled={stageDone}
                options={STAGE_BEST_OF_OPTIONS}
                onChange={(value) => setStageDrafts((prev) => ({ ...prev, [index]: value }))}
              />
              {stageDone ? <Tag>已结束 · 不可改</Tag> : null}
              {isCurrent ? <Tag color="blue">当前阶段</Tag> : null}
            </div>
            {isDoubleLife ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 6px 86px' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>按波次</Text>
                {([2, 3] as const).map((waveIndex) => (
                  <span key={waveIndex} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>W{waveIndex}</Text>
                    <Select
                      size="small"
                      style={{ width: 92 }}
                      disabled={stageDone}
                      value={waveOverrides[index]?.[waveIndex] ?? baseValue}
                      options={STAGE_BEST_OF_OPTIONS}
                      onChange={(value) => setWaveOverrides((prev) => ({
                        ...prev,
                        [index]: { ...(prev[index] ?? {}), [waveIndex]: value },
                      }))}
                    />
                  </span>
                ))}
                <Text type="secondary" style={{ fontSize: 12 }}>等于基础值时自动跟随基础</Text>
              </div>
            ) : null}
          </div>
        );
      })}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 0',
        }}
      >
        <span style={{ width: 76, fontWeight: 600 }}>季军赛</span>
        <Text type="secondary" style={{ width: 40 }}>单败</Text>
        <Select
          size="small"
          style={{ width: 92 }}
          value={thirdDraft}
          options={THIRD_PLACE_OPTIONS}
          onChange={(value) => setThirdDraft(value)}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>独立赛制，不随总决赛联动</Text>
      </div>

      {changes.length || thirdChanged ? (
        review.blockers.length ? (
          <Alert type="error" showIcon style={{ marginTop: 12 }} message={review.blockers[0]} />
        ) : review.destructive ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="所选波次已有赛况：保存将「重开该波」"
            description={previewRows}
          />
        ) : (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 12 }}
            message="所选波次全部未开打：保存仅更新赛制"
            description={previewRows}
          />
        )
      ) : null}
    </Modal>
  );
}