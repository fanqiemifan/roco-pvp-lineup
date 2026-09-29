import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Checkbox, Empty, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { MatchRecord, Page6State, Page7State, Page8State } from '../../../shared/types';
import { computeScheduleTimes, normalizeHHmm } from '../../../shared/match-schedule';

const { Text } = Typography;

/** 推流页面选场类型：page6 比赛结果 / page7 对局推送 / page8 比赛预告 */
export type MatchPushKind = 'page6' | 'page7' | 'page8';

/** 确认推送时的请求体：page6/8 = matchIds + 大标题 + 场序时间；page7 = matchIds + 主标题 + 温馨提示 */
export interface MatchPushPayload {
  matchIds: string[];
  title?: string;
  startTime?: string;
  matchTimes?: Record<string, string>;
  notice?: string;
}

interface MatchPushCardProps {
  kind: MatchPushKind;
  /** 功能卡片标题，如「推送比赛结果」 */
  cardTitle: string;
  maxCount: number;
  /** 全部比赛（候选池，组件内部做搜索与资格过滤） */
  matches: MatchRecord[];
  /** 服务端当前配置（打开弹窗时作为初始值） */
  state: Page6State | Page7State | Page8State;
  pushing: boolean;
  /** 确认推送：抛出错误时弹窗保持打开 */
  onPush: (payload: MatchPushPayload) => Promise<void>;
}

const STATUS_META: Record<MatchRecord['status'], { label: string; color: string }> = {
  pending: { label: '待开始', color: 'default' },
  in_progress: { label: '进行中', color: 'processing' },
  completed: { label: '已结束', color: 'success' },
};

/** 各页面允许收录的比赛状态 */
const ELIGIBLE_STATUS: Record<MatchPushKind, ReadonlySet<MatchRecord['status']>> = {
  page6: new Set<MatchRecord['status']>(['completed']),
  page7: new Set<MatchRecord['status']>(['pending', 'in_progress', 'completed']),
  page8: new Set<MatchRecord['status']>(['pending', 'in_progress']),
};

const ELIGIBLE_HINT: Record<MatchPushKind, string> = {
  page6: '仅可选择已结束的比赛',
  page7: '可选择任意状态的比赛',
  page8: '仅可选择待开始或进行中的比赛',
};

const TITLE_LABEL: Record<MatchPushKind, string> = {
  page6: '大标题：',
  page7: '主标题：',
  page8: '大标题：',
};

const TITLE_PLACEHOLDER: Record<MatchPushKind, string> = {
  page6: '留空显示默认「比赛结果」',
  page7: '例如：S2洛克联赛，留空显示默认「对局推送」',
  page8: '留空显示默认「比赛预告」',
};

const NOTICE_PLACEHOLDER: Record<MatchPushKind, string> = {
  page6: '',
  page7: '页面底部提示文字，留空使用默认内容',
  page8: '',
};

function versusText(match: MatchRecord): string {
  return `${match.leftPlayer || '左侧'} vs ${match.rightPlayer || '右侧'}`;
}

/**
 * 比赛管理上方的推流功能卡片：展示已选摘要，点击后弹出比赛管理详情选场弹窗。
 * 弹窗内勾选（勾选顺序即卡片场序）、上移/下移调整、page6/8 可编辑标题与场序时间。
 */
export function MatchPushCard({ kind, cardTitle, maxCount, matches, state, pushing, onPush }: MatchPushCardProps) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [titleDraft, setTitleDraft] = useState('');
  const [noticeDraft, setNoticeDraft] = useState('');
  const [startTimeDraft, setStartTimeDraft] = useState('');
  const [matchTimesDraft, setMatchTimesDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  /** page6/8 = 大标题 + 场序时间；page7 = 主标题 + 温馨提示 */
  const withSchedule = kind === 'page6' || kind === 'page8';
  const withNotice = kind === 'page7';

  // 每次打开弹窗时以服务端状态初始化本地草稿
  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftIds(state.matchIds.slice(0, maxCount));
    setTitleDraft('title' in state ? state.title : '');
    setNoticeDraft('notice' in state ? state.notice : '');
    setStartTimeDraft('startTime' in state ? state.startTime : '');
    setMatchTimesDraft('matchTimes' in state ? { ...state.matchTimes } : {});
    setSearch('');
  }, [open, state, maxCount]);

  const matchById = useMemo(() => {
    const map = new Map<string, MatchRecord>();
    matches.forEach((match) => map.set(match.id, match));
    return map;
  }, [matches]);

  /** 弹窗内已选（本地草稿，仅打开弹窗时从服务端初始化） */
  const selectedMatches = useMemo(
    () => draftIds.map((id) => matchById.get(id)).filter((match): match is MatchRecord => Boolean(match)),
    [draftIds, matchById],
  );

  /**
   * 卡片摘要展示的已推送比赛：取自服务端 state.matchIds。
   * 不能用 draftIds —— 它只在弹窗打开时才初始化，否则卡片会一直显示「尚未选择比赛」，
   * 要点进弹窗再退出来才正常。
   */
  const pushedMatches = useMemo(
    () => state.matchIds.map((id) => matchById.get(id)).filter((match): match is MatchRecord => Boolean(match)),
    [state.matchIds, matchById],
  );

  // 自动场序时间：开始时间 + 前场各场 BO×30 分钟累加；手动值只替换该场显示
  const autoTimes = useMemo(
    () => computeScheduleTimes(
      selectedMatches.map((match) => ({ id: match.id, bestOf: match.bestOf })),
      startTimeDraft,
      {},
    ),
    [selectedMatches, startTimeDraft],
  );

  const filteredCandidates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return matches;
    }
    return matches.filter((match) => {
      return match.id.toLowerCase().includes(keyword)
        || match.leftPlayer.toLowerCase().includes(keyword)
        || match.rightPlayer.toLowerCase().includes(keyword);
    });
  }, [matches, search]);

  function isEligible(match: MatchRecord): boolean {
    return ELIGIBLE_STATUS[kind].has(match.status);
  }

  function toggleMatch(match: MatchRecord, checked: boolean) {
    setDraftIds((prev) => {
      if (checked) {
        if (prev.includes(match.id) || !isEligible(match) || prev.length >= maxCount) {
          return prev;
        }
        return [...prev, match.id];
      }
      return prev.filter((id) => id !== match.id);
    });
    if (!checked) {
      setMatchTimesDraft((prev) => {
        if (!prev[match.id]) {
          return prev;
        }
        const next = { ...prev };
        delete next[match.id];
        return next;
      });
    }
  }

  function moveSelection(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= draftIds.length) {
      return;
    }
    setDraftIds((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeSelection(matchId: string) {
    setDraftIds((prev) => prev.filter((id) => id !== matchId));
    setMatchTimesDraft((prev) => {
      if (!prev[matchId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
  }

  async function handleConfirm() {
    // 手动时间必须为 HH:mm，非法时提示具体场次而不是静默丢弃
    if (withSchedule) {
      const invalidIndex = selectedMatches.findIndex((match) => {
        const raw = matchTimesDraft[match.id];
        return raw !== undefined && raw.trim() !== '' && !normalizeHHmm(raw);
      });
      if (invalidIndex >= 0) {
        message.warning(`第 ${invalidIndex + 1} 场时间格式不正确，请填写 HH:mm（如 19:00）或清空使用自动时间`);
        return;
      }
      if (startTimeDraft.trim() !== '' && !normalizeHHmm(startTimeDraft)) {
        message.warning('开始时间格式不正确，请填写 HH:mm（如 19:00）或留空');
        return;
      }
    }

    const matchTimes: Record<string, string> = {};
    if (withSchedule) {
      for (const match of selectedMatches) {
        const time = normalizeHHmm(matchTimesDraft[match.id]);
        if (time) {
          matchTimes[match.id] = time;
        }
      }
    }

    const payload: MatchPushPayload = { matchIds: draftIds, title: titleDraft.trim() };
    if (withSchedule) {
      payload.startTime = normalizeHHmm(startTimeDraft);
      payload.matchTimes = matchTimes;
    }
    if (withNotice) {
      payload.notice = noticeDraft.trim();
    }

    try {
      await onPush(payload);
      setOpen(false);
    } catch {
      // 错误提示由调用方负责，弹窗保持打开便于调整
    }
  }

  const candidateColumns: ColumnsType<MatchRecord> = [
    {
      title: '',
      key: 'select',
      width: 48,
      render: (_: unknown, record: MatchRecord) => {
        const checked = draftIds.includes(record.id);
        const disabled = !isEligible(record) || (draftIds.length >= maxCount && !checked);
        return (
          <Checkbox
            checked={checked}
            disabled={disabled}
            onChange={(event) => toggleMatch(record, event.target.checked)}
          />
        );
      },
    },
    {
      title: '对阵',
      key: 'versus',
      render: (_: unknown, record: MatchRecord) => (
        <Space direction="vertical" size={0}>
          <Text strong={isEligible(record)} type={isEligible(record) ? undefined : 'secondary'}>
            {versusText(record)}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.id}</Text>
        </Space>
      ),
    },
    {
      title: '比分',
      key: 'score',
      width: 90,
      render: (_: unknown, record: MatchRecord) => <Text>{record.leftScore} : {record.rightScore}</Text>,
    },
    {
      title: '赛制',
      dataIndex: 'bestOf',
      key: 'bestOf',
      width: 72,
      render: (value: number) => <Tag color="gold">BO{value}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      width: 84,
      render: (_: unknown, record: MatchRecord) => {
        const meta = STATUS_META[record.status];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
  ];

  return (
    <>
      <Card
        size="small"
        className="subtle-card match-push-card"
        title={cardTitle}
        extra={<Tag color={pushedMatches.length ? 'blue' : 'default'}>{state.matchIds.length}/{maxCount}</Tag>}
      >
        <Space direction="vertical" size={10} className="match-push-card-body">
          {pushedMatches.length ? (
            <div className="match-push-summary">
              {pushedMatches.slice(0, 2).map((match) => (
                <Tag key={match.id} className="match-push-summary-tag">{versusText(match)}</Tag>
              ))}
              {pushedMatches.length > 2 ? <Tag>+{pushedMatches.length - 2}</Tag> : null}
            </div>
          ) : (
            <Text type="secondary" className="match-push-empty-hint">尚未选择比赛</Text>
          )}
          <Button type="primary" block onClick={() => setOpen(true)}>选择比赛</Button>
        </Space>
      </Card>

      <Modal
        title={`${cardTitle} · 选择比赛`}
        open={open}
        width={1080}
        destroyOnClose
        onCancel={() => setOpen(false)}
        footer={(
          <Space>
            <Text type="secondary">{ELIGIBLE_HINT[kind]} · 最多 {maxCount} 场，勾选顺序即卡片场序</Text>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={pushing} onClick={() => void handleConfirm()}>确认推送</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={12} className="match-push-modal-body">
          <Space wrap size={16} align="start">
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>{TITLE_LABEL[kind]}</Text>
              <Input
                allowClear
                maxLength={40}
                style={{ width: 300 }}
                placeholder={TITLE_PLACEHOLDER[kind]}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
              />
            </div>
            {withNotice ? (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>温馨提示：</Text>
                <Input
                  allowClear
                  maxLength={60}
                  style={{ width: 420 }}
                  placeholder={NOTICE_PLACEHOLDER[kind]}
                  value={noticeDraft}
                  onChange={(event) => setNoticeDraft(event.target.value)}
                />
              </div>
            ) : null}
            {withSchedule ? (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                  第一场开始时间（之后每场按 BO×30 分钟自动累加）：
                </Text>
                <Input
                  allowClear
                  maxLength={5}
                  style={{ width: 160 }}
                  placeholder="19:00"
                  value={startTimeDraft}
                  onChange={(event) => setStartTimeDraft(event.target.value)}
                />
              </div>
            ) : null}
          </Space>

          <Row2>
            <div className="match-push-candidates">
              <Input.Search
                allowClear
                placeholder="搜索选手名或赛事 ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{ marginBottom: 8 }}
              />
              <Table<MatchRecord>
                size="small"
                rowKey="id"
                columns={candidateColumns}
                dataSource={filteredCandidates}
                pagination={false}
                scroll={{ y: 430 }}
              />
            </div>

            <div className="match-push-selected">
              <Space style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                <Text strong>已选（{draftIds.length}/{maxCount}）</Text>
                {draftIds.length > 1 ? <Text type="secondary" style={{ fontSize: 12 }}>可上下调整场序</Text> : null}
              </Space>
              {selectedMatches.length ? (
                <Space direction="vertical" size={8} className="match-push-selected-list">
                  {selectedMatches.map((match, index) => {
                    const autoTime = autoTimes[match.id] || '';
                    const manualTime = matchTimesDraft[match.id] ?? '';
                    return (
                      <div key={match.id} className="match-push-selected-item">
                        <Tag color="blue" className="match-push-index-tag">{index + 1}</Tag>
                        <div className="match-push-selected-main">
                          <Text ellipsis style={{ maxWidth: withSchedule ? 170 : 230 }}>{versusText(match)}</Text>
                          <Tag color="gold" style={{ margin: 0 }}>BO{match.bestOf}</Tag>
                        </div>
                        {withSchedule ? (
                          <Input
                            size="small"
                            className="match-push-time-input"
                            placeholder={autoTime || 'HH:mm'}
                            value={manualTime}
                            maxLength={5}
                            onChange={(event) => {
                              const value = event.target.value;
                              setMatchTimesDraft((prev) => {
                                const next = { ...prev };
                                if (value.trim() === '') {
                                  delete next[match.id];
                                } else {
                                  next[match.id] = value;
                                }
                                return next;
                              });
                            }}
                          />
                        ) : null}
                        <Space size={2}>
                          <Button size="small" type="text" disabled={index === 0} onClick={() => moveSelection(index, -1)}>↑</Button>
                          <Button
                            size="small"
                            type="text"
                            disabled={index === draftIds.length - 1}
                            onClick={() => moveSelection(index, 1)}
                          >
                            ↓
                          </Button>
                          <Button size="small" type="text" danger onClick={() => removeSelection(match.id)}>移除</Button>
                        </Space>
                      </div>
                    );
                  })}
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择比赛" />
              )}
            </div>
          </Row2>
        </Space>
      </Modal>
    </>
  );
}

/** 弹窗内左右两栏布局（避免在本文件重复引入 Row/Col 的栅密林） */
function Row2({ children }: { children: React.ReactNode }) {
  return <div className="match-push-row">{children}</div>;
}
