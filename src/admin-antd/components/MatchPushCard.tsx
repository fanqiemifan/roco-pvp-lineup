import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Checkbox, Empty, Input, Modal, Popconfirm, Space, Table, Tag, TimePicker, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';

import type { MatchRecord, Page6State, Page7State, Page8State, TournamentRecord } from '../../../shared/types';
import { CHINESE_ORDINALS, computeScheduleTimes, normalizeHHmm } from '../../../shared/match-schedule';
import { countPushRows } from '../lib/history';
import { buildPushCandidateGroups, type PushCandidateGroup } from '../lib/tournament';

const { Text } = Typography;

/** 推流页面选场类型：page6 比赛结果 / page7 战绩详情 / page8 比赛预告 */
export type MatchPushKind = 'page6' | 'page7' | 'page8';

/** page7 画面一屏行数（.page7-rows 固定 4 行，多出来的整屏过渡） */
const PAGE7_ROWS_PER_SCREEN = 4;

/** 确认推送时的请求体：page6/8 = matchIds + 大标题 + 场序时间；page7 = matchIds + 主标题 + 温馨提示 */
export interface MatchPushPayload {
  matchIds: string[];
  title?: string;
  startTime?: string;
  matchTimes?: Record<string, string>;
  notice?: string;
}

/** 候选表格的一行：分组标题行 或 比赛行 */
type PushCandidateRow =
  | { rowType: 'group'; key: string; group: PushCandidateGroup }
  | { rowType: 'match'; key: string; match: MatchRecord };

/** 候选表格列数（分组标题行整行合并，其余列 colSpan 置 0） */
const CANDIDATE_COLUMN_COUNT = 5;

interface MatchPushCardProps {
  kind: MatchPushKind;
  /** 功能卡片标题，如「推送比赛结果」 */
  cardTitle: string;
  /**
   * 场次上限：page6/page8 画面是固定格数（9 张卡片），必须限制；
   * page7 画面是一屏 4 行 + 整屏过渡、行数只影响翻屏轮数，**不传即不设上限**
   * （按整届 / 按阶段·波次勾选，弹窗里用「已选 N 场 ≈ M 屏」提示规模）。
   */
  maxCount?: number;
  /**
   * 候选池：管理端可见的比赛（已剔除「本机移除」系列赛的对局）——组件内部做搜索与资格过滤。
   * 已选 / 摘要的解析必须走 allMatches，否则已推送的隐藏对局会「解析不到」导致索引错位。
   */
  matches: MatchRecord[];
  /**
   * 全量比赛（仅用于解析已选与摘要）：已推送过的「本机移除」对局仍要能显示、排序、
   * 编辑场序时间并保留在推送里（隐藏是视图层语义，不动已推送内容）。
   */
  allMatches: MatchRecord[];
  /** 系列赛列表（候选分组用：解析阶段名与语义轮次，与 page6 卡片标签同口径） */
  tournaments: TournamentRecord[];
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
  page7: '例如：S2洛克联赛，留空显示默认「战绩详情」',
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

/** HH:mm 文本 → TimePicker 的 dayjs 值（严格校验；空/非法返回 null，让输入框显示 placeholder） */
function hhmmToDayjs(value: string): Dayjs | null {
  const normalized = normalizeHHmm(value);
  if (!normalized) {
    return null;
  }
  const [hour, minute] = normalized.split(':').map(Number);
  return dayjs().hour(hour).minute(minute).second(0).millisecond(0);
}

/** 比赛预告（page8）第一场开始时间默认值：当前时间向上取整到半点（18:52→19:00、19:02→19:30，整点/半点保持不变） */
function roundedNowHHmm(): string {
  const now = new Date();
  const total = now.getHours() * 60 + now.getMinutes();
  const rounded = total % 30 === 0 ? total : (Math.floor(total / 30) + 1) * 30;
  const wrapped = rounded % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * 比赛管理上方的推流功能卡片：展示已选摘要，点击后弹出比赛管理详情选场弹窗。
 * 弹窗内候选按「系列赛阶段/轮次 + 普通对局」分组（组头可整组勾选），
 * 勾选（勾选顺序即卡片场序）、上移/下移调整、page6/8 可编辑标题与场序时间。
 */
export function MatchPushCard({ kind, cardTitle, maxCount, matches, allMatches, tournaments, state, pushing, onPush }: MatchPushCardProps) {
  const { modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [titleDraft, setTitleDraft] = useState('');
  const [noticeDraft, setNoticeDraft] = useState('');
  const [startTimeDraft, setStartTimeDraft] = useState('');
  const [matchTimesDraft, setMatchTimesDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const withSchedule = kind === 'page6' || kind === 'page8';
  const withNotice = kind === 'page7';

  // 每次打开弹窗时以服务端状态初始化本地草稿
  useEffect(() => {
    if (!open) {
      return;
    }
    setDraftIds(maxCount === undefined ? state.matchIds : state.matchIds.slice(0, maxCount));
    setTitleDraft('title' in state ? state.title : '');
    setNoticeDraft('notice' in state ? state.notice : '');
    const nextStart = 'startTime' in state ? state.startTime : '';
    // 比赛预告（page8）默认开始时间：
    // - 没有在推的预告（选场为空）→ 服务端 startTime 只是上次推送的残留（prune 只清 matchIds 不清 startTime），
    //   默认填当前时间向上取整到半点（19:00 / 19:30），避免带着昨天的旧时间推送新预告；
    // - 已有在推的预告 → 沿用服务端 startTime，编辑时不能把已固化的场序时间悄悄推移。
    setStartTimeDraft(kind === 'page8' && state.matchIds.length === 0 ? roundedNowHHmm() : nextStart);
    setMatchTimesDraft('matchTimes' in state ? { ...state.matchTimes } : {});
    setSearch('');
  }, [open, state, maxCount, kind]);

  // 解析池用全量 allMatches（不是候选池）：已推送的「本机移除」对局不在候选表里，
  // 但必须能解析出名称/BO 参与已选排序与手动时间——否则 draftIds 与渲染列表索引错位
  // （上移/下移移动错项、确认推送时手动时间被清掉）
  const matchById = useMemo(() => {
    const map = new Map<string, MatchRecord>();
    allMatches.forEach((match) => map.set(match.id, match));
    return map;
  }, [allMatches]);

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

  /** 场次上限：不传（page7）= 不限，用 Infinity 让下面几处守卫同一份判据 */
  const pushLimit = maxCount ?? Number.POSITIVE_INFINITY;

  /**
   * 战绩详情（page7）的规模提示：画面一屏 4 行、每行 = 该场一个已展示小局，
   * 所以「已选 N 场」看不出翻屏轮数，这里按行数折算屏数（口径见 lib/history.ts 的 countPushRows）。
   */
  const estimatedScreens = Math.max(1, Math.ceil(countPushRows(selectedMatches) / PAGE7_ROWS_PER_SCREEN));

  // 自动场序时间：开始时间 + 前场各场占用（BO1=30 分钟、BO3 及以上=BO×20 分钟）累加；手动值只替换该场显示
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

  /** 候选分组：系列赛按「阶段 + 语义轮次」、普通对局一组（搜索过滤后重建） */
  const candidateGroups = useMemo(
    () => buildPushCandidateGroups(filteredCandidates, tournaments),
    [filteredCandidates, tournaments],
  );

  /** 分组标题行 + 比赛行拍平成表格数据源（组标题行在组内比赛之前） */
  const candidateRows = useMemo<PushCandidateRow[]>(() => {
    const rows: PushCandidateRow[] = [];
    candidateGroups.forEach((group) => {
      rows.push({ rowType: 'group', key: `group:${group.key}`, group });
      group.matches.forEach((match) => {
        rows.push({ rowType: 'match', key: `match:${match.id}`, match });
      });
    });
    return rows;
  }, [candidateGroups]);

  function isEligible(match: MatchRecord): boolean {
    return ELIGIBLE_STATUS[kind].has(match.status);
  }

  function toggleMatch(match: MatchRecord, checked: boolean) {
    setDraftIds((prev) => {
      if (checked) {
        if (prev.includes(match.id) || !isEligible(match) || prev.length >= pushLimit) {
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

  /** 组头勾选：按组内顺序加入（受最大场数约束）；取消时移除该组全部已选并清理手动时间 */
  function toggleGroup(group: PushCandidateGroup, checked: boolean) {
    if (checked) {
      setDraftIds((prev) => {
        const next = [...prev];
        group.matches.forEach((match) => {
          if (next.length >= pushLimit) {
            return;
          }
          if (isEligible(match) && !next.includes(match.id)) {
            next.push(match.id);
          }
        });
        return next;
      });
      return;
    }
    const groupIds = new Set(group.matches.map((match) => match.id));
    setDraftIds((prev) => prev.filter((id) => !groupIds.has(id)));
    setMatchTimesDraft((prev) => {
      const next = { ...prev };
      groupIds.forEach((id) => delete next[id]);
      return next;
    });
  }

  /** 按开始时间整链重排：把所有时间框覆盖为自动累加结果（覆盖手改值，需 Popconfirm 确认） */
  function refillScheduleTimes() {
    setMatchTimesDraft(
      computeScheduleTimes(
        selectedMatches.map((match) => ({ id: match.id, bestOf: match.bestOf })),
        startTimeDraft,
        {},
      ),
    );
  }

  /** 组装推送请求体：page6/8 固化场序时间（按确认这一刻的场序与开始时间，手动值优先） */
  function buildPushPayload(): MatchPushPayload {
    const payload: MatchPushPayload = { matchIds: draftIds, title: titleDraft.trim() };
    if (withSchedule) {
      // 推送时固化场序时间：按确认这一刻的场序与开始时间把每场解析成独立值（手动值优先）。
      // 之后比赛完赛被移出选场、增删重排都不会再按列表位置重算（时间跟着比赛 id 走）
      payload.startTime = normalizeHHmm(startTimeDraft);
      payload.matchTimes = computeScheduleTimes(
        selectedMatches.map((match) => ({ id: match.id, bestOf: match.bestOf })),
        startTimeDraft,
        matchTimesDraft,
      );
    }
    if (withNotice) {
      payload.notice = noticeDraft.trim();
    }
    return payload;
  }

  async function pushPayload(payload: MatchPushPayload) {
    try {
      await onPush(payload);
      setOpen(false);
    } catch {
      // 错误提示由调用方负责，弹窗保持打开便于调整
    }
  }

  async function handleConfirm() {
    const payload = buildPushPayload();
    // 比赛预告（page8）推送前二次确认：亮出第一场开始时间与整条场序时间——
    // 推送即固化为每场固定时间，防止带着残留/手滑的错误时间上线
    if (kind !== 'page8') {
      await pushPayload(payload);
      return;
    }
    const start = normalizeHHmm(startTimeDraft);
    modal.confirm({
      title: '确认推送比赛预告？',
      width: 480,
      content: (
        <div style={{ marginTop: 8 }}>
          <Text>
            第一场开始时间：
            <Text strong style={{ fontSize: 16 }}>{start || '未设置'}</Text>
          </Text>
          {!start ? (
            <div style={{ marginTop: 4 }}>
              <Text type="warning">未设置开始时间，预告卡片将不显示场序时间</Text>
            </div>
          ) : null}
          {selectedMatches.length ? (
            <div style={{ marginTop: 8, display: 'grid', gap: 2 }}>
              {selectedMatches.map((match, index) => (
                <Text key={match.id} type="secondary" style={{ fontSize: 12 }}>
                  {`第${CHINESE_ORDINALS[index] ?? index + 1}场 ${versusText(match)} · ${autoTimes[match.id] || '--:--'}`}
                </Text>
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              推送后各场时间固化为固定值，改时间需重新推送。
            </Text>
          </div>
        </div>
      ),
      okText: '确认推送',
      cancelText: '再看看',
      onOk: () => pushPayload(payload),
    });
  }

  const candidateColumns: ColumnsType<PushCandidateRow> = [
    {
      title: '',
      key: 'select',
      width: 48,
      onCell: (row) => (row.rowType === 'group' ? { colSpan: CANDIDATE_COLUMN_COUNT } : {}),
      render: (_: unknown, row: PushCandidateRow) => {
        if (row.rowType === 'group') {
          const eligible = row.group.matches.filter(isEligible);
          const selectedCount = eligible.filter((match) => draftIds.includes(match.id)).length;
          return (
            <div className="match-push-group-title">
              <Checkbox
                checked={eligible.length > 0 && selectedCount === eligible.length}
                indeterminate={selectedCount > 0 && selectedCount < eligible.length}
                disabled={eligible.length === 0}
                onChange={(event) => toggleGroup(row.group, event.target.checked)}
              />
              <span className="match-push-group-name">{row.group.title}</span>
              {/* 双败阶段按波次分批：整组勾选 = 选中该波（如 32进16 胜者组 R1 16 场），提示批次与规模 */}
              <span className="match-push-group-count">
                {row.group.waveIndex === null ? '' : `第 ${row.group.waveIndex} 波 · `}
                共 {row.group.matches.length} 场
              </span>
            </div>
          );
        }
        const record = row.match;
        const checked = draftIds.includes(record.id);
        const disabled = !isEligible(record) || (draftIds.length >= pushLimit && !checked);
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
      onCell: (row) => (row.rowType === 'group' ? { colSpan: 0 } : {}),
      render: (_: unknown, row: PushCandidateRow) => {
        if (row.rowType === 'group') {
          return null;
        }
        const record = row.match;
        return (
          <Space direction="vertical" size={0}>
            <Text strong={isEligible(record)} type={isEligible(record) ? undefined : 'secondary'}>
              {versusText(record)}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{record.id}</Text>
          </Space>
        );
      },
    },
    {
      title: '比分',
      key: 'score',
      width: 90,
      onCell: (row) => (row.rowType === 'group' ? { colSpan: 0 } : {}),
      render: (_: unknown, row: PushCandidateRow) => (
        row.rowType === 'group' ? null : <Text>{row.match.leftScore} : {row.match.rightScore}</Text>
      ),
    },
    {
      title: '赛制',
      key: 'bestOf',
      width: 72,
      onCell: (row) => (row.rowType === 'group' ? { colSpan: 0 } : {}),
      render: (_: unknown, row: PushCandidateRow) => (
        row.rowType === 'group' ? null : <Tag color="gold">BO{row.match.bestOf}</Tag>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 84,
      onCell: (row) => (row.rowType === 'group' ? { colSpan: 0 } : {}),
      render: (_: unknown, row: PushCandidateRow) => {
        if (row.rowType === 'group') {
          return null;
        }
        const meta = STATUS_META[row.match.status];
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
        extra={(
          <Tag color={pushedMatches.length ? 'blue' : 'default'}>
            {maxCount === undefined ? `${state.matchIds.length} 场` : `${state.matchIds.length}/${maxCount}`}
          </Tag>
        )}
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
            <Text type="secondary">
              {ELIGIBLE_HINT[kind]} · {maxCount === undefined
                ? `不设场次上限，勾选顺序即行序（已选 ${draftIds.length} 场 ≈ ${estimatedScreens} 屏）`
                : `最多 ${maxCount} 场，勾选顺序即卡片场序`}
            </Text>
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
                  第一场开始时间（BO1 每场 +30 分钟、BO3 及以上每小局 +20 分钟自动累加，确认推送时固化为每场固定时间）：
                </Text>
                <Space size={8}>
                  <TimePicker
                    allowClear
                    format="HH:mm"
                    minuteStep={5}
                    style={{ width: 160 }}
                    placeholder="19:00"
                    value={hhmmToDayjs(startTimeDraft)}
                    onChange={(value, timeString) => setStartTimeDraft(value ? String(timeString) : '')}
                  />
                  <Popconfirm
                    title="将按「第一场开始时间」重算全部场次时间，已手动修改的时间会被覆盖"
                    okText="重新填充"
                    cancelText="取消"
                    disabled={!normalizeHHmm(startTimeDraft) || !selectedMatches.length}
                    onConfirm={refillScheduleTimes}
                  >
                    <Button size="small" disabled={!normalizeHHmm(startTimeDraft) || !selectedMatches.length}>
                      按开始时间重新填充
                    </Button>
                  </Popconfirm>
                </Space>
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
              <Table<PushCandidateRow>
                size="small"
                rowKey="key"
                columns={candidateColumns}
                dataSource={candidateRows}
                pagination={false}
                scroll={{ y: 430 }}
                rowClassName={(row) => (row.rowType === 'group' ? 'match-push-group-row' : '')}
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
                          <TimePicker
                            size="small"
                            className="match-push-time-input"
                            format="HH:mm"
                            minuteStep={5}
                            placeholder={autoTime || 'HH:mm'}
                            value={hhmmToDayjs(manualTime)}
                            onChange={(value, timeString) => {
                              setMatchTimesDraft((prev) => {
                                const next = { ...prev };
                                if (value) {
                                  next[match.id] = String(timeString);
                                } else {
                                  delete next[match.id];
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
