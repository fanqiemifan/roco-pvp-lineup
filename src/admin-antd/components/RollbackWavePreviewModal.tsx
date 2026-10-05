import React, { useEffect, useState } from 'react';
import { Alert, App, Modal, Space, Spin, Tag, Typography } from 'antd';

import type { RollbackWavePreview, RollbackWavePreviewRow, TournamentRecord } from '../../../shared/types';
import { previewRollbackWaveApi, rollbackWaveApi } from '../lib/tournament-api';

const { Text } = Typography;

/** 预览行展示上限：影响对局较多时只展示前几场，剩余按处置方式汇总成一行 */
const MAX_PREVIEW_ROWS = 8;

/** 处置方式 → Tag 配色（蓝 = 复位保阵容 / 橙 = 有代价 / 红 = 需人工处理 / 灰 = 无需处理） */
const ACTION_TAG_COLOR: Record<RollbackWavePreviewRow['action'], string> = {
  'reset-keep-lineup': 'blue',
  'delete': 'orange',
  'discard-third-place': 'orange',
  'needs-undo': 'red',
  none: 'default',
};

export interface RollbackWavePreviewModalProps {
  open: boolean;
  record: TournamentRecord;
  onClose(): void;
}

/**
 * 「回退上一波」影响预览弹窗：打开即拉取服务端同口径预览（只读），
 * 逐场列处置 Tag + 连带影响清单，红色确认后执行 rollbackWaveApi。
 * - executable=false 渲染拒绝态（原因 + 需逐场撤销的场次），不提供确认按钮；
 * - 影响对局较多时只展示前 MAX_PREVIEW_ROWS 场，剩余按处置方式汇总，避免长列表刷屏；
 * - 预览与执行之间状态可能变化：引擎侧校验照旧兜底，弹窗固定放「以执行一刻为准」提示。
 */
export function RollbackWavePreviewModal({ open, record, onClose }: RollbackWavePreviewModalProps): React.ReactElement {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<RollbackWavePreview | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 每次打开（或切换系列赛）重新拉预览：预览是执行前的快照，不能复用上一次的结果
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    previewRollbackWaveApi(record.id)
      .then((data) => {
        if (!cancelled) {
          setPreview(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          message.error(error instanceof Error ? error.message : String(error));
          onClose();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose 由调用方稳定传入；只按 open/record.id 触发
  }, [open, record.id]);

  async function handleConfirm(): Promise<void> {
    setConfirming(true);
    try {
      await rollbackWaveApi(record.id);
      message.success('已回退上一波');
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setConfirming(false);
    }
  }

  /** 超出展示上限的剩余行按处置方式汇总（如「其余 14 场：复位 · 保留第 1 局阵容 ×14」） */
  const overflowSummary = (() => {
    if (!preview || preview.rows.length <= MAX_PREVIEW_ROWS) {
      return null;
    }
    const rest = preview.rows.slice(MAX_PREVIEW_ROWS);
    const counts = new Map<string, number>();
    rest.forEach((row) => counts.set(row.actionLabel, (counts.get(row.actionLabel) ?? 0) + 1));
    const parts = Array.from(counts.entries()).map(([label, count]) => `${label} ×${count}`);
    return `……其余 ${rest.length} 场：${parts.join('，')}`;
  })();

  const visibleRows = preview?.rows.slice(0, MAX_PREVIEW_ROWS) ?? [];

  return (
    <Modal
      title={`↺ 回退上一波 · ${record.name}`}
      open={open}
      width={640}
      okText={preview?.executable ? '确认回退（此操作不可撤回）' : '我知道了'}
      okButtonProps={preview?.executable ? { danger: true, loading: confirming } : undefined}
      onOk={() => {
        if (preview?.executable) {
          void handleConfirm();
          return;
        }
        onClose();
      }}
      onCancel={onClose}
      destroyOnHidden
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin />
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">正在计算回退影响…</Text>
          </div>
        </div>
      ) : preview ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Tag color="gold">{preview.waveLabel || '无波次'}</Tag>
            <Tag>{preview.rows.length} 场受影响</Tag>
          </div>

          {!preview.executable ? (
            <Alert type="error" showIcon message={preview.reason || '当前状态无法整体回退'} />
          ) : null}

          {visibleRows.length ? (
            <div className="rollback-preview-list">
              {visibleRows.map((row) => (
                <div key={row.matchId} className="rollback-preview-row">
                  <div className="rollback-preview-main">
                    <Text strong>{row.leftPlayer || '左方'} vs {row.rightPlayer || '右方'}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <span className="rollback-preview-id">{row.matchId}</span> · BO{row.bestOf} · {row.stateLabel}
                    </Text>
                  </div>
                  <Tag color={ACTION_TAG_COLOR[row.action]} style={{ marginInlineEnd: 0 }}>{row.actionLabel}</Tag>
                </div>
              ))}
              {overflowSummary ? (
                <div className="rollback-preview-row">
                  <Text type="secondary" style={{ fontSize: 12.5 }}>{overflowSummary}</Text>
                </div>
              ) : null}
            </div>
          ) : null}

          {preview.keepLineup ? (
            <Alert
              type="success"
              showIcon
              message="保留第 1 局阵容"
              description="被复位的对局沿用同一批节点配对：第 1 局阵容保留（进行中保本局、已完赛保第 1 局），比分与胜负状态清空，回退后可直接重新登记。"
            />
          ) : null}

          {preview.impacts.length ? (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>连带影响</Text>
              <ul className="rollback-preview-impacts">
                {preview.impacts.map((impact) => (
                  <li key={impact}>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>{impact}</Text>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.executable ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              以上为当前状态下的预览，实际以执行一刻为准；编排机专属操作，多机环境回退后请「重新分发」。
            </Text>
          ) : null}
        </Space>
      ) : null}
    </Modal>
  );
}
