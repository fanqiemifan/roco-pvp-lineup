import React, { useMemo, useState } from 'react';
import { App, Button, Modal, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import type { MatchRecord, SpriteRecord, TournamentRecord } from '../../../shared/types';
import { buildLineupTemplateCsv, type LineupTemplateMatchRow, type LineupTemplateScope } from '../lib/lineup-sheet';

const { Text } = Typography;

type TournamentLineupExportModalProps = {
  open: boolean;
  record: TournamentRecord;
  matches: MatchRecord[];
  sprites: SpriteRecord[];
  onClose: () => void;
};

/**
 * 系列赛「导出阵容模板」弹窗：选范围过滤（整届 / 按阶段 / 仅当前波），
 * **列出将要导出的具体对局**（阶段·轮次 / 左右选手 / 对局ID / 是否已有阵容回显）供用户确认，
 * 再生成「一场两行」CSV（只含待开始比赛的第 1 局，已录阵容回显预填）。
 */
export function TournamentLineupExportModal({
  open,
  record,
  matches,
  sprites,
  onClose,
}: TournamentLineupExportModalProps): React.ReactElement {
  const { message } = App.useApp();
  const [scopeKind, setScopeKind] = useState<'all' | 'stage' | 'current-wave'>('all');
  const [stageIndex, setStageIndex] = useState<number>(() => record.currentStageIndex ?? 0);

  const { csv, count, rows } = useMemo(() => {
    const scope: LineupTemplateScope = scopeKind === 'stage'
      ? { kind: 'stage', stageIndex }
      : { kind: scopeKind };
    return buildLineupTemplateCsv({ record, matches, sprites, scope });
  }, [record, matches, sprites, scopeKind, stageIndex]);

  const scopeLabel = scopeKind === 'all'
    ? '整届'
    : scopeKind === 'stage'
      ? (record.stages[stageIndex]?.name ?? '阶段')
      : '当前波';

  function handleExport(): void {
    if (!count) {
      message.warning('当前范围内没有待开始的对局');
      return;
    }
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const stamp = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    link.download = `阵容模板_${record.name}_${scopeLabel}_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${count} 场对局的阵容模板（${count * 2} 行）`);
    onClose();
  }

  return (
    <Modal
      open={open}
      width={720}
      title={`导出阵容模板 · ${record.name}`}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="export" type="primary" disabled={!count} onClick={handleExport}>导出 CSV</Button>,
      ]}
      destroyOnHidden
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>导出范围</Text>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={scopeKind}
              onChange={(event) => setScopeKind(event.target.value as 'all' | 'stage' | 'current-wave')}
            >
              <Radio value="all">整届（全部待开始对局）</Radio>
              <Radio value="stage">按阶段</Radio>
              <Radio value="current-wave">仅当前波</Radio>
            </Radio.Group>
          </div>
          {scopeKind === 'stage' ? (
            <Select
              style={{ marginTop: 10, width: 260 }}
              value={stageIndex}
              onChange={(value) => setStageIndex(value)}
              options={record.stages.map((stage, index) => ({
                label: `${stage.name}${index === record.currentStageIndex ? '（当前阶段）' : ''}`,
                value: index,
              }))}
            />
          ) : null}
        </div>
        <Text>
          {count > 0
            ? <>将导出 <Text strong>{count}</Text> 场待开始对局（{count * 2} 行，一场两行）：</>
            : <Text type="warning">该范围内没有「比赛待开始且第 1 局尚未开赛」的对局</Text>}
        </Text>
        {rows.length ? (
          <Table<LineupTemplateMatchRow>
            size="small"
            rowKey="matchId"
            dataSource={rows}
            pagination={false}
            scroll={{ y: 260 }}
            columns={[
              {
                title: '阶段 · 轮次',
                dataIndex: 'stageLabel',
                width: 150,
                render: (value: string) => value || '—',
              },
              {
                title: '对局（左 vs 右）',
                key: 'players',
                render: (_value, row) => `${row.leftPlayer} vs ${row.rightPlayer}`,
              },
              {
                title: '对局ID',
                dataIndex: 'matchId',
                width: 160,
                render: (value: string) => <Text type="secondary" style={{ fontSize: 12 }}>{value}</Text>,
              },
              {
                title: '阵容回显',
                key: 'lineup',
                width: 84,
                render: (_value, row) => (
                  row.hasLineup ? <Tag color="green">已回显</Tag> : <Text type="secondary">—</Text>
                ),
              },
            ]}
          />
        ) : null}
        <Text type="secondary" style={{ fontSize: 12 }}>
          模板只含待开始比赛的第 1 局；已开赛 / 已完赛不再导出（阵容修改走赛事面板）。第 1 局已录阵容会回显预填。
        </Text>
      </Space>
    </Modal>
  );
}