import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Dropdown,
  Input,
  Modal,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type {
  LineupImportApplyResult,
  LineupImportPreviewRow,
  MatchRecord,
  QuickFillMatch,
  TournamentRecord,
} from '../../../shared/types';
import { parseLineupJsonText, parseLineupSheetText, type LineupSheetEntry } from '../lib/lineup-sheet';
import { formatStageRoundLabel } from '../lib/tournament';
import { applyLineupImportApi, previewLineupImportApi } from '../lib/tournament-api';

const { Text, Paragraph } = Typography;

/** 消歧覆盖键：matchId|side|slot */
function overrideKey(matchId: string, side: 'left' | 'right', slot: number): string {
  return `${matchId}|${side}|${slot}`;
}

type ImportStage = 'input' | 'preview';

type TournamentLineupImportModalProps = {
  open: boolean;
  record: TournamentRecord;
  matches: MatchRecord[];
  onClose: () => void;
};

/**
 * 系列赛「导入阵容」弹窗：上传 CSV / JSON 或粘贴表格文本 → 解析预览（按对局聚合、可逐格消歧）→ 批量写入
 * 第 1 局阵容。门槛与单场「录入阵容」一致（比赛待开始 + 第 1 局尚未开赛），不影响推流画面。
 */
export function TournamentLineupImportModal({
  open,
  record,
  matches,
  onClose,
}: TournamentLineupImportModalProps): React.ReactElement {
  const { message } = App.useApp();
  const [stage, setStage] = useState<ImportStage>('input');
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');
  const [fileName, setFileName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewRows, setPreviewRows] = useState<LineupImportPreviewRow[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<LineupImportApplyResult[] | null>(null);

  const matchById = useMemo(
    () => new Map(matches.map((match) => [match.id, match])),
    [matches],
  );

  const readyRows = previewRows?.filter((row) => row.ok) ?? [];
  const skippedRows = previewRows?.filter((row) => !row.ok) ?? [];
  const appliedCount = applyResults?.filter((item) => item.ok).length ?? 0;

  function resetToInput(): void {
    setStage('input');
    setPreviewRows(null);
    setOverrides({});
    setApplyResults(null);
    setParseErrors([]);
    setParseWarnings([]);
  }

  // 每次重新打开：重置到输入阶段并清掉上次的预览 / 结果（保留已粘贴的文本与文件名，方便修正后重跑）。
  // 本弹窗由父级常驻挂载（只切换 open），不重置的话上次导入成功后 stage/applyResults 会残留，
  // 再次打开只显示「已导入 N 场」的结果页，无法进行第二次导入。
  useEffect(() => {
    if (open) {
      resetToInput();
      setPreviewing(false);
      setApplying(false);
    }
  }, [open]);

  /** 解析文本 → 规范化对局 → 请求服务端预览（名字解析 + 场次预检，不写数据） */
  async function runPreview(sourceText: string): Promise<void> {
    const text = sourceText.trim();
    if (!text) {
      message.warning('请先上传文件或粘贴表格内容');
      return;
    }
    const looksLikeJson = text.startsWith('{') || text.startsWith('[');
    const parsed = looksLikeJson
      ? parseLineupJsonText(text, record.id)
      : parseLineupSheetText(text);
    setParseErrors(parsed.errors);
    setParseWarnings(parsed.warnings);
    setApplyResults(null);
    if (parsed.errors.length || !parsed.entries.length) {
      return;
    }

    setPreviewing(true);
    try {
      const rows = await previewLineupImportApi(
        record.id,
        parsed.entries.map((entry: LineupSheetEntry) => ({
          matchId: entry.matchId,
          left: entry.left,
          right: entry.right,
        })),
      );
      setPreviewRows(rows);
      setOverrides({});
      setStage('preview');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '预览失败');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      setFileName(file.name);
      setPasteText(text);
      setInputMode('text');
      await runPreview(text);
    } catch {
      message.error('文件读取失败');
    }
  }

  /** 构造写入行：只提交可导入的场次；候选消歧的覆盖值直接采用（未覆盖用系统推荐） */
  function buildApplyRows(): Array<{ matchId: string; left: string[] | null; right: string[] | null }> {
    const buildSide = (
      matchId: string,
      side: 'left' | 'right',
      cells: QuickFillMatch[],
    ): string[] | null => {
      const petIds = cells
        .map((cell) => {
          if (!cell.input) {
            return null;
          }
          return overrides[overrideKey(matchId, side, cell.slot)] ?? cell.sprite?.id ?? null;
        })
        .filter((petId): petId is string => Boolean(petId));
      return petIds.length ? petIds : null;
    };

    return readyRows.map((row) => ({
      matchId: row.matchId,
      left: buildSide(row.matchId, 'left', row.left),
      right: buildSide(row.matchId, 'right', row.right),
    }));
  }

  async function handleApply(): Promise<void> {
    const rows = buildApplyRows();
    if (!rows.length) {
      return;
    }
    setApplying(true);
    try {
      const results = await applyLineupImportApi(record.id, rows);
      setApplyResults(results);
      const okCount = results.filter((item) => item.ok).length;
      if (okCount > 0) {
        message.success(`已导入 ${okCount} 场阵容`);
      } else {
        message.warning('没有写入任何阵容（全部被跳过）');
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      setApplying(false);
    }
  }

  function renderChip(matchId: string, side: 'left' | 'right', cell: QuickFillMatch): React.ReactNode {
    if (!cell.input) {
      return null;
    }
    if (!cell.matched || !cell.sprite) {
      return (
        <span key={`${side}-${cell.slot}`} className="lineup-import-chip is-miss" title="未匹配到精灵，请修正原文">
          {cell.input} 未匹配
        </span>
      );
    }
    const override = overrides[overrideKey(matchId, side, cell.slot)];
    const active = override
      ? (cell.candidates.find((candidate) => candidate.id === override) ?? cell.sprite)
      : cell.sprite;
    const hasCandidates = cell.candidates.length > 1;
    const chip = (
      <span className={`lineup-import-chip${hasCandidates && !override ? ' is-amb' : ''}`}>
        {active.displayName}
        {hasCandidates ? <span className="origin">候选 {cell.candidates.length} ▾</span> : null}
      </span>
    );
    if (!hasCandidates) {
      return <span key={`${side}-${cell.slot}`}>{chip}</span>;
    }
    return (
      <Dropdown
        key={`${side}-${cell.slot}`}
        trigger={['click']}
        menu={{
          items: cell.candidates.map((candidate) => ({
            key: candidate.id,
            label: `${candidate.displayName} · ${candidate.id}`,
          })),
          selectedKeys: override ? [override] : [],
          onClick: ({ key }) => {
            setOverrides((prev) => ({
              ...prev,
              [overrideKey(matchId, side, cell.slot)]: key,
            }));
          },
        }}
      >
        {chip}
      </Dropdown>
    );
  }

  function renderSide(matchId: string, side: 'left' | 'right', cells: QuickFillMatch[]): React.ReactNode {
    const filled = cells.filter((cell) => cell.input);
    if (!filled.length) {
      return <span className="lineup-import-empty">整行留空 → 保持原样不写</span>;
    }
    return filled.map((cell) => renderChip(matchId, side, cell));
  }

  function renderPreviewRow(row: LineupImportPreviewRow): React.ReactNode {
    const match = matchById.get(row.matchId);
    const stageLabel = match?.tournamentRef
      ? formatStageRoundLabel(record, match.tournamentRef)
      : null;
    return (
      <div key={row.matchId} className={`lineup-import-row${row.ok ? '' : ' is-skip'}`}>
        <div className="lineup-import-meta">
          <div>
            <Text strong>{match?.leftPlayer || '左侧'}</Text>
            <Text type="secondary"> vs </Text>
            <Text strong>{match?.rightPlayer || '右侧'}</Text>
          </div>
          <div className="lineup-import-id">
            {row.matchId}
            {stageLabel ? ` · ${stageLabel}` : ''}
          </div>
          <div>
            {row.ok
              ? <Tag color="success" bordered={false}>可导入</Tag>
              : <Tag color="error" bordered={false}>跳过</Tag>}
            {!row.ok && row.reason ? <Text type="danger" style={{ fontSize: 12 }}>{row.reason}</Text> : null}
          </div>
        </div>
        <div className="lineup-import-side">
          <span className="lineup-import-side-title">左</span>
          <div className="lineup-import-chips">{renderSide(row.matchId, 'left', row.left)}</div>
        </div>
        <div className="lineup-import-side">
          <span className="lineup-import-side-title">右</span>
          <div className="lineup-import-chips">{renderSide(row.matchId, 'right', row.right)}</div>
        </div>
      </div>
    );
  }

  const footer = applyResults
    ? [
      <Button key="close" type="primary" onClick={onClose}>关闭</Button>,
    ]
    : stage === 'input'
      ? [
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="preview" type="primary" loading={previewing} onClick={() => void runPreview(pasteText)}>
          解析预览
        </Button>,
      ]
      : [
        <Button key="back" onClick={resetToInput}>返回修改</Button>,
        <Button
          key="apply"
          type="primary"
          loading={applying}
          disabled={!readyRows.length}
          onClick={() => void handleApply()}
        >
          {`确认导入 ${readyRows.length} 场`}
        </Button>,
      ];

  return (
    <Modal
      open={open}
      width={780}
      title={`导入阵容 · ${record.name}`}
      onCancel={onClose}
      mask={{ closable: !previewing && !applying }}
      footer={footer}
      destroyOnHidden
    >
      {stage === 'input' ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="支持三种输入：导出模板回填后的 CSV 文件、从表格直接复制粘贴（含表头），或对局分组式 JSON。"
            description="只导入「待开始比赛的第 1 局」阵容；已开赛 / 已完赛的比赛与未匹配的精灵会被跳过。"
          />
          <Segmented
            value={inputMode}
            onChange={(value) => setInputMode(value as 'file' | 'text')}
            options={[
              { label: '上传文件', value: 'file' },
              { label: '粘贴文本', value: 'text' },
            ]}
          />
          {inputMode === 'file' ? (
            <Upload
              accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleFile(file as File);
                return false;
              }}
            >
              <Button>选择 CSV / JSON 文件（选中后自动解析）</Button>
            </Upload>
          ) : (
            <Input.TextArea
              rows={8}
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={'粘贴表格（含表头行）或 JSON：\n\n系列赛,阶段,对局ID,位置,选手,精灵1,精灵2,…\n2026 秋季杯,32进16 · 首轮,20260928_A001,左,小明,迪莫,3004 圣光迪莫,…'}
            />
          )}
          {fileName && inputMode === 'text' ? (
            <Text type="secondary">已读取文件：{fileName}</Text>
          ) : null}
          {parseErrors.length ? (
            <Alert type="error" showIcon message="解析失败" description={parseErrors.join('；')} />
          ) : null}
          {parseWarnings.length ? (
            <Alert type="warning" showIcon message={parseWarnings.join('；')} />
          ) : null}
        </Space>
      ) : (
        <Spin spinning={previewing}>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {parseWarnings.length ? (
              <Alert type="warning" showIcon message={parseWarnings.join('；')} />
            ) : null}
            {applyResults ? (
              <Alert
                type={appliedCount > 0 ? 'success' : 'warning'}
                showIcon
                message={`已导入 ${appliedCount} 场；跳过 ${applyResults.length - appliedCount} 场`}
                description={(
                  <div className="lineup-import-result-list">
                    {applyResults.filter((item) => !item.ok).map((item) => (
                      <div key={item.matchId}>
                        <Text code>{item.matchId}</Text>
                        <Text type="secondary"> · {item.reason ?? '已跳过'}</Text>
                      </div>
                    ))}
                  </div>
                )}
              />
            ) : (
              <>
                <div className="lineup-import-summary">
                  <Text>
                    共 {previewRows?.length ?? 0} 场 · 可导入 <Text strong style={{ color: '#1f7a4c' }}>{readyRows.length}</Text> 场
                    {skippedRows.length ? <> · 跳过 <Text strong type="danger">{skippedRows.length}</Text> 场</> : null}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    黄标 = 同名多候选，点击可切换；红标 = 未匹配（请返回修改原文）
                  </Text>
                </div>
                <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                  预览按对局聚合展示（表格两行 / JSON 一条 = 一场，左右两组格子并排）。
                </Paragraph>
                <div className="lineup-import-list">
                  {(previewRows ?? []).map((row) => renderPreviewRow(row))}
                </div>
              </>
            )}
          </Space>
        </Spin>
      )}
    </Modal>
  );
}