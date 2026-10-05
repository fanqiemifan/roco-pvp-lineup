import React from 'react';
import { Select, Tag } from 'antd';

/** W1/W2/W3 可选局数（编辑赛制弹窗与创建向导「高级设置」共用的同一份） */
const STAGE_BEST_OF_OPTIONS = [1, 3, 5, 7].map((value) => ({ value, label: `BO${value}` }));

export interface StageWaveBestOfRowProps {
  /** 波次号（单败阶段只有 1） */
  waveIndex: 1 | 2 | 3;
  /** 该波语义轮次（getStageWaveRoundLabels 产出）；空数组 = 单败无轮次细分 */
  roundLabels: string[];
  value: number;
  /** 行尾提示：基础 / 跟随基础 / 独立覆盖 */
  hint: string;
  disabled?: boolean;
  /** 该行是当前进行到的波次（高亮 + Tag） */
  isCurrent?: boolean;
  onChange(value: number): void;
}

/**
 * 「编辑赛制」弹窗与创建向导「高级设置」共用的波次行：
 * W几 + 语义轮次（如「败者组 R1 / 胜者组 R2」）+ 局数选择 + 基础/跟随/覆盖提示。
 * 语义文案与展示口径集中在这里，避免两个弹窗各写一套导致口径漂移。
 */
export function StageWaveBestOfRow({
  waveIndex,
  roundLabels,
  value,
  hint,
  disabled,
  isCurrent,
  onChange,
}: StageWaveBestOfRowProps): React.ReactElement {
  return (
    <div className={`bestof-wave-row${isCurrent ? ' is-current' : ''}`}>
      <span className="bestof-wave-no">W{waveIndex}</span>
      <span className="bestof-wave-label">
        {roundLabels.length ? roundLabels.join(' / ') : '单败唯一一波'}
      </span>
      {isCurrent ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>当前波次</Tag> : null}
      <Select
        size="small"
        style={{ width: 88 }}
        value={value}
        disabled={disabled}
        options={STAGE_BEST_OF_OPTIONS}
        onChange={onChange}
      />
      <span className="bestof-wave-hint">{hint}</span>
    </div>
  );
}