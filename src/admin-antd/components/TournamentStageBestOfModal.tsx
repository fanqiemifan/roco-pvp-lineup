import React, { useEffect, useMemo, useState } from 'react';
import { Alert, App, Modal, Segmented, Select, Switch, Tag, Typography } from 'antd';

import { isFinalStage, resolveThirdPlaceBestOf, resolveWaveBestOf } from '../../../shared/constants';
import type { MatchRecord, StageFormat, StageRule, TournamentRecord } from '../../../shared/types';
import {
  buildStageBestOfReview,
  defaultPairingForFormat,
  getCurrentStageWavePosition,
  getPairingLabel,
  getStageState,
  getStageWaveRoundLabels,
} from '../lib/tournament';
import type { StageBestOfChange, StageBestOfReviewRow } from '../lib/tournament';
import { updateTournamentStagesApi } from '../lib/tournament-api';
import { StageWaveBestOfRow } from './StageWaveBestOfRow';

const { Paragraph, Text } = Typography;

const THIRD_PLACE_OPTIONS = [0, 1, 3, 5, 7].map((value) => ({
  value,
  label: value === 0 ? '不安排' : `BO${value}`,
}));

/** 阶段规则草稿（形态类字段；仅未开始阶段可保存直改） */
interface StageRuleDraft {
  format: StageFormat;
  pairing: StageRule['pairing'];
  avoidRematch: boolean;
  requireConfirm: boolean;
}

/** 各形态可用的配对方式（值域与服务端 / 创建向导一致，文案走 getPairingLabel） */
const PAIRING_VALUES_BY_FORMAT: Record<StageFormat, Array<StageRule['pairing']>> = {
  'double-life': ['random-bucket', 'manual-bucket'],
  'single-elim': ['bracket-seed', 'random-round'],
};

function toRuleDraft(stage: StageRule): StageRuleDraft {
  return {
    format: stage.format,
    pairing: stage.pairing,
    avoidRematch: stage.avoidRematch,
    requireConfirm: stage.requireConfirm,
  };
}

/** 影响预览单行文案（弹窗与确认框共用），带语义轮次（如「W2（败者组 R1 / 胜者组 R2）」） */
function describeRow(row: StageBestOfReviewRow): string {
  const round = row.roundLabels.length ? `（${row.roundLabels.join(' / ')}）` : '';
  const parts = [`${row.stageName} · W${row.waveIndex}${round}：BO${row.fromBestOf} → BO${row.toBestOf}`];
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
 * 编辑赛制弹窗（编排机）：逐阶段改基础 BO（W1）+ 双败 W2/W3 按波次覆盖 + 季军赛独立赛制；
 * 未开始阶段（setup 全部 + currentStageIndex 之后）另可直改阶段规则（晋级赛制 / 配对方式 / 避重复 / 需确认）。
 * - 波内全未开打：保存即更新规则与已建对局的赛制（更早的波不动）；
 * - 波内已有进行中 / 已完赛：保存走「重开该波」——强确认列清代价后，清赛况（保留阵容）、
 *   换新赛制，配对依赖旧结果的后续波作废重建；
 * - 阶段规则只放开未开始阶段：直接生效（该阶段尚无波次与对局），进行中 / 已结束阶段置灰并给原因；
 *   形态切换时配对按兼容归一（双败 = 随机 / 手动，单败 = 沿树 / 每轮随机），总决赛禁止双败；
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
  /** 阶段规则草稿（形态类字段；仅未开始阶段可保存） */
  const [ruleDrafts, setRuleDrafts] = useState<Record<number, StageRuleDraft>>({});
  const [thirdDraft, setThirdDraft] = useState<number>(3);
  const [saving, setSaving] = useState(false);

  // 打开（或切换系列赛）时用当前记录初始化；弹窗打开期间的 socket 更新不覆盖用户已改的草稿
  useEffect(() => {
    if (!open) {
      return;
    }
    const nextStage: Record<number, number> = {};
    const nextWave: Record<number, Partial<Record<2 | 3, number>>> = {};
    const nextRules: Record<number, StageRuleDraft> = {};
    record.stages.forEach((stage, index) => {
      nextStage[index] = stage.bestOf;
      nextWave[index] = { ...(stage.waveBestOf ?? {}) };
      nextRules[index] = toRuleDraft(stage);
    });
    setStageDrafts(nextStage);
    setWaveOverrides(nextWave);
    setRuleDrafts(nextRules);
    setThirdDraft(resolveThirdPlaceBestOf(record));
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record 随 socket 更新换引用，只在打开时初始化
  }, [open, record.id]);

  /** 阶段规则草稿更新（形态切换时配对由调用方一并复位为该形态默认） */
  function updateRuleDraft(stageIndex: number, patch: Partial<StageRuleDraft>): void {
    setRuleDrafts((prev) => ({
      ...prev,
      [stageIndex]: {
        ...(prev[stageIndex] ?? toRuleDraft(record.stages[stageIndex])),
        ...patch,
      },
    }));
  }

  const changes = useMemo<StageBestOfChange[]>(() => {
    const list: StageBestOfChange[] = [];
    record.stages.forEach((stage, index) => {
      const nextBase = stageDrafts[index] ?? stage.bestOf;
      const rule = ruleDrafts[index] ?? toRuleDraft(stage);
      const change: StageBestOfChange = { index };
      if (nextBase !== stage.bestOf) {
        change.bestOf = nextBase;
      }
      // 波次行按「草稿形态」判断：单败 → 双败的切换也要能预置 W2/W3 覆盖
      if (rule.format === 'double-life') {
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
      if (rule.format !== stage.format) {
        change.format = rule.format;
      }
      if (rule.pairing !== stage.pairing) {
        change.pairing = rule.pairing;
      }
      if (rule.avoidRematch !== stage.avoidRematch) {
        change.avoidRematch = rule.avoidRematch;
      }
      if (rule.requireConfirm !== stage.requireConfirm) {
        change.requireConfirm = rule.requireConfirm;
      }
      if (
        change.bestOf !== undefined || change.waveBestOf !== undefined
        || change.format !== undefined || change.pairing !== undefined
        || change.avoidRematch !== undefined || change.requireConfirm !== undefined
      ) {
        list.push(change);
      }
    });
    return list;
  }, [record, stageDrafts, waveOverrides, ruleDrafts]);

  const thirdChanged = thirdDraft !== resolveThirdPlaceBestOf(record);
  const review = useMemo(
    () => buildStageBestOfReview(record, matches, changes, thirdChanged ? thirdDraft : undefined),
    [record, matches, changes, thirdDraft, thirdChanged],
  );
  // 当前进行到的阶段与主赛波次（顶部进度提示 + 阶段卡片 / 波次行高亮）
  const currentPosition = useMemo(() => getCurrentStageWavePosition(record), [record]);

  async function submit(confirmReopen: boolean): Promise<void> {
    setSaving(true);
    try {
      const result = await updateTournamentStagesApi(record.id, {
        stages: changes.map((change) => ({
          index: change.index,
          ...(change.bestOf !== undefined ? { bestOf: change.bestOf } : {}),
          ...(change.waveBestOf ? { waveBestOf: change.waveBestOf } : {}),
          ...(change.format !== undefined ? { format: change.format } : {}),
          ...(change.pairing !== undefined ? { pairing: change.pairing } : {}),
          ...(change.avoidRematch !== undefined ? { avoidRematch: change.avoidRematch } : {}),
          ...(change.requireConfirm !== undefined ? { requireConfirm: change.requireConfirm } : {}),
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
      const ruleStageCount = changes.filter((change) => (
        change.format !== undefined || change.pairing !== undefined
        || change.avoidRematch !== undefined || change.requireConfirm !== undefined
      )).length;
      if (ruleStageCount) {
        parts.push(`${ruleStageCount} 个阶段规则直接生效`);
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
              {review.ruleRows.length ? (
                <li>
                  同时直接更新阶段规则（重开不影响它）：
                  {review.ruleRows.map((row) => `「${row.stageName}」${row.description}`).join('；')}
                </li>
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
      {review.ruleRows.map((row) => (
        <div key={`rule-${row.stageIndex}`}>
          「{row.stageName}」{row.description}（未开始阶段，直接生效）
          {row.hint ? <div>提示：{row.hint}</div> : null}
        </div>
      ))}
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
      {currentPosition ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            currentPosition.waveIndex
              ? `当前进行：${currentPosition.stageName} · W${currentPosition.waveIndex}${
                  currentPosition.roundLabels.length
                    ? `（${currentPosition.roundLabels.join(' / ')}）`
                    : ''
                }`
              : `当前进行：${currentPosition.stageName}（尚未建出首波对阵）`
          }
        />
      ) : null}

      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        基础（W1）局数作用于未覆盖的波次；双败阶段的 W2/W3 可单独覆盖，等于基础值时自动跟随基础。
        改动只影响所选波次及其之后——该波已有进行中 / 已完赛时会「重开该波」（清除赛况、保留阵容），
        配对依赖旧结果的后续波作废重建；更早的波不动。未开始阶段（含抽签前）还可直改晋级赛制 /
        配对方式 / 避重复 / 需确认，保存即生效；进行中与已结束阶段仅局数可改（进行中）或全锁定。
      </Paragraph>

      {record.stages.map((stage, index) => {
        const state = getStageState(record, index);
        // setup 阶段尚未开赛：不标「当前阶段」（getStageState 在 setup 下会把阶段 0 视为 current）
        const isCurrent = record.status !== 'setup' && state === 'current';
        const stageDone = state === 'done';
        // 阶段规则只放开未开始阶段（setup 全部 + 当前阶段之后）；进行中 / 已结束置灰并给原因
        const ruleEditable = record.status === 'setup' || index > record.currentStageIndex;
        // 任一字段有草稿差异（波次或阶段规则）→ 卡片头部标「未保存改动」，与底部预览 diff 呼应
        const stageChanged = changes.some((change) => change.index === index);
        const isFinal = isFinalStage(record.playerIds.length, index);
        const ruleDraft = ruleDrafts[index] ?? toRuleDraft(stage);
        const isDoubleLife = ruleDraft.format === 'double-life';
        const baseValue = stageDrafts[index] ?? stage.bestOf;
        const waveIndexes: Array<1 | 2 | 3> = isDoubleLife ? [1, 2, 3] : [1];
        return (
          <div key={stage.id} className={`bestof-stage-card${isCurrent ? ' is-current' : ''}`}>
            <div className="bestof-stage-head">
              <span className="bestof-stage-name">{stage.name}</span>
              <Tag style={{ marginInlineEnd: 0 }}>{isDoubleLife ? '双败' : '单败'}</Tag>
              {isCurrent ? (
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  当前阶段{currentPosition?.waveIndex ? ` · W${currentPosition.waveIndex}` : ''}
                </Tag>
              ) : null}
              {stageDone ? <Tag style={{ marginInlineEnd: 0 }}>已结束 · 不可改</Tag> : null}
              {stageChanged ? <Tag color="orange" style={{ marginInlineEnd: 0 }}>未保存改动</Tag> : null}
            </div>
            {waveIndexes.map((waveIndex) => {
              const explicit = waveIndex === 1 ? undefined : waveOverrides[index]?.[waveIndex];
              const follows = waveIndex > 1 && (explicit === undefined || explicit === baseValue);
              return (
                <StageWaveBestOfRow
                  key={waveIndex}
                  waveIndex={waveIndex}
                  roundLabels={getStageWaveRoundLabels(ruleDraft, waveIndex)}
                  value={waveIndex === 1 ? baseValue : explicit ?? baseValue}
                  disabled={stageDone}
                  isCurrent={isCurrent && currentPosition?.waveIndex === waveIndex}
                  hint={waveIndex === 1 ? '基础' : follows ? '跟随基础' : '独立覆盖'}
                  onChange={(next) => {
                    if (waveIndex === 1) {
                      setStageDrafts((prev) => ({ ...prev, [index]: next }));
                      return;
                    }
                    setWaveOverrides((prev) => ({
                      ...prev,
                      [index]: { ...(prev[index] ?? {}), [waveIndex]: next },
                    }));
                  }}
                />
              );
            })}
            <div className={`bestof-rule-row${ruleEditable ? '' : ' is-locked'}`}>
              <span className="bestof-rule-label">阶段规则</span>
              <Segmented
                size="small"
                disabled={!ruleEditable}
                value={ruleDraft.format}
                options={[
                  { label: '双败', value: 'double-life', disabled: isFinal },
                  { label: '单败', value: 'single-elim' },
                ]}
                onChange={(value) => updateRuleDraft(index, {
                  format: value as StageFormat,
                  pairing: defaultPairingForFormat(value as StageFormat),
                })}
              />
              <Segmented
                size="small"
                disabled={!ruleEditable}
                value={ruleDraft.pairing}
                options={PAIRING_VALUES_BY_FORMAT[ruleDraft.format].map((pairing) => ({
                  label: getPairingLabel(pairing),
                  value: pairing,
                }))}
                onChange={(value) => updateRuleDraft(index, { pairing: value as StageRule['pairing'] })}
              />
              <span className="bestof-rule-switch">
                <Switch
                  size="small"
                  disabled={!ruleEditable}
                  checked={ruleDraft.avoidRematch}
                  onChange={(checked) => updateRuleDraft(index, { avoidRematch: checked })}
                />
                避重复
              </span>
              <span className="bestof-rule-switch">
                <Switch
                  size="small"
                  disabled={!ruleEditable}
                  checked={ruleDraft.requireConfirm}
                  onChange={(checked) => updateRuleDraft(index, { requireConfirm: checked })}
                />
                需确认
              </span>
              {!ruleEditable && state === 'current' ? (
                <Text type="secondary" className="bestof-rule-note">
                  进行中：BO 可改（有赛况将重开该波）；晋级方式不可改
                </Text>
              ) : null}
            </div>
          </div>
        );
      })}

      <div className="bestof-stage-card">
        <div className="bestof-stage-head">
          <span className="bestof-stage-name">季军赛</span>
          <Tag style={{ marginInlineEnd: 0 }}>单败 · 附加赛</Tag>
        </div>
        <div className="bestof-wave-row">
          <span className="bestof-wave-label">4 进 2 结束后用两名落败者建场；独立赛制，不随总决赛联动</span>
          <Select
            size="small"
            style={{ width: 88 }}
            value={thirdDraft}
            options={THIRD_PLACE_OPTIONS}
            onChange={(value) => setThirdDraft(value)}
          />
        </div>
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
            message={review.rows.length ? '所选波次全部未开打：保存仅更新赛制' : '未开始阶段：阶段规则直接生效'}
            description={previewRows}
          />
        )
      ) : null}
    </Modal>
  );
}