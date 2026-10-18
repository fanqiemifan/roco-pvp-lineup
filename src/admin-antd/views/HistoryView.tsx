import React from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Image,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { MatchRecord } from '../../../shared/types';
import { DEFAULT_TAGS, PAGE6_MAX_MATCHES, PAGE8_MAX_MATCHES } from '../constants';
import { AdvanceRankCard } from '../components/AdvanceRankCard';
import { MatchPushCard } from '../components/MatchPushCard';
import { formatDateTime } from '../lib/format';
import {
  buildHistoryBattleEntries,
  getHistoryVisibleGames,
  getLineupEntryBlockReason,
  LINEUP_ENTRY_BLOCK_TEXT,
  PLAIN_HISTORY_MATCH_FILTER,
} from '../lib/history';
import { getCurrentGame, getGameResultLabel, getGameStatusLabel } from '../lib/match';
import { formatStageRoundLabel } from '../lib/tournament';
import { MatchStatusTag } from '../ui/StatusTag';
import { MODAL_WIDTH } from '../ui/modal';
import { UNCATEGORIZED_HISTORY_TAG, useHistoryController } from './history/use-history-controller';
import type { HistorySortKey } from './history/use-history-controller';

const { Text } = Typography;

function HistorySortHeader({ text, sortKey, activeOrder, onSort }: {
  text: string;
  sortKey: HistorySortKey;
  activeOrder: 'asc' | 'desc' | null;
  onSort: (key: HistorySortKey) => void;
}) {
  return (
    <span
      className="history-sort-header"
      role="button"
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSort(sortKey);
        }
      }}
    >
      {text}
      <span className={`history-sort-triangle${activeOrder ? ` is-${activeOrder}` : ''}`}>
        {activeOrder === 'asc' ? '▲' : activeOrder === 'desc' ? '▼' : ''}
      </span>
    </span>
  );
}

interface HistoryViewProps {
  /** 打开「录入阵容」弹窗（弹窗挂在 App 根，与系列比赛 Drawer 共用同一份状态） */
  onEnterLineup: (matchId: string, gameNumber: number) => void;
  /** 「进入管理」：切换当前比赛并跳转赛事面板（selectMatch 归 App 壳） */
  onSelectMatch: (matchId: string) => void;
}

/**
 * 比赛管理视图（M6）：列表 / 筛选 / 排序 / 批量删除与标签 / 比赛回收站 /
 * 三张推流选场卡 + 晋级积分榜卡。视图本地状态与动作都在 useHistoryController，
 * 共享数据经 useAdminData()，只接两个 App 壳回调（录入阵容 / 进入管理）。
 */
export function HistoryView({ onEnterLineup, onSelectMatch }: HistoryViewProps) {
  const { modal } = App.useApp();
  const {
    matchStore,
    tournaments,
    spriteMap,
    page6,
    page7,
    page8,
    page14,
    page14Standings,
    cloudStatus,
    historyNotice,
    setHistoryNotice,
    allHistoryTags,
    tournamentNameMap,
    tournamentRecordMap,
    adminVisibleMatches,
    historyTournamentFilters,
    filteredMatches,
    sortedMatches,
    historyFilterSummary,
    cloudPendingIdSet,
    cloudAckedSet,
    historyTagFilter,
    setHistoryTagFilter,
    historyTournamentFilter,
    setHistoryTournamentFilter,
    historySearch,
    setHistorySearch,
    historySort,
    cycleHistorySort,
    selectedHistoryKeys,
    setSelectedHistoryKeys,
    expandedHistoryKeys,
    setExpandedHistoryKeys,
    batchTagOpen,
    setBatchTagOpen,
    batchTagValue,
    setBatchTagValue,
    batchTagSaving,
    handleBatchTag,
    submitBatchTag,
    editingHistoryTagMatchId,
    editingHistoryTagValues,
    setEditingHistoryTagValues,
    savingHistoryTagMatchId,
    beginInlineTagEdit,
    commitInlineTagEdit,
    recycleBinOpen,
    setRecycleBinOpen,
    recycleBinRows,
    recycleSelectedKeys,
    setRecycleSelectedKeys,
    recycleLoading,
    recycleRestoring,
    openMatchRecycleBin,
    restoreRecycleMatches,
    deleteHistoryMatches,
    pushMatchesForPage,
    savePage14Settings,
    exportHistoryCsv,
    matchPushLoading,
    page14Saving,
  } = useHistoryController();

  const historyColumns: ColumnsType<MatchRecord> = [
    {
      title: '左侧选手',
      dataIndex: 'leftPlayer',
      key: 'leftPlayer',
      render: (value: MatchRecord['leftPlayer']) => <Text strong>{value || '左侧'}</Text>,
    },
    {
      title: (
        <HistorySortHeader
          text="比分"
          sortKey="score"
          activeOrder={historySort.key === 'score' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      key: 'score',
      render: (_: unknown, record: MatchRecord) => (
        <Text strong>{record.leftScore} : {record.rightScore}</Text>
      ),
    },
    {
      title: '右侧选手',
      dataIndex: 'rightPlayer',
      key: 'rightPlayer',
      render: (value: MatchRecord['rightPlayer']) => <Text strong>{value || '右侧'}</Text>,
    },
    {
      title: (
        <HistorySortHeader
          text="赛制"
          sortKey="bestOf"
          activeOrder={historySort.key === 'bestOf' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      dataIndex: 'bestOf',
      key: 'bestOf',
      render: (value: MatchRecord['bestOf']) => <Tag color="gold">BO{value}</Tag>,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[], record: MatchRecord) => (
        editingHistoryTagMatchId === record.id ? (
          <Select
            mode="multiple"
            autoFocus
            value={editingHistoryTagValues}
            options={allHistoryTags.map((tag) => ({ value: tag, label: tag }))}
            placeholder="选择标签"
            className="history-tag-select"
            open
            loading={savingHistoryTagMatchId === record.id}
            onChange={(values) => setEditingHistoryTagValues(values)}
            onBlur={() => void commitInlineTagEdit(record.id)}
            onDropdownVisibleChange={(open) => {
              if (!open) {
                void commitInlineTagEdit(record.id);
              }
            }}
          />
        ) : (
          <div className="history-tag-cell" onClick={() => beginInlineTagEdit(record)} role="button" tabIndex={0} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              beginInlineTagEdit(record);
            }
          }}>
            <Space wrap>
              {record.tournamentRef && tournamentNameMap.has(record.tournamentRef.tournamentId) ? (
                <Tag
                  color="purple"
                  onClick={(event) => {
                    event.stopPropagation();
                    setHistoryTournamentFilter(record.tournamentRef?.tournamentId ?? null);
                  }}
                >
                  🏆 {tournamentNameMap.get(record.tournamentRef.tournamentId)}
                </Tag>
              ) : null}
              {/* 派生「阶段 · 轮次」只读 Tag：由 tournamentRef + 编排实时计算，不落 tags、不参与筛选 */}
              {(() => {
                const ref = record.tournamentRef;
                const tournament = ref ? tournamentRecordMap.get(ref.tournamentId) : undefined;
                const stageRound = ref && tournament ? formatStageRoundLabel(tournament, ref) : null;
                if (!stageRound) {
                  return null;
                }
                return (
                  <Tag
                    color="geekblue"
                    style={{ cursor: 'default' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {stageRound}
                  </Tag>
                );
              })()}
              {tags?.length ? tags.map((tag) => (
                <Tag
                  key={`${record.id}-${tag}`}
                  color={historyTagFilter === tag ? 'processing' : DEFAULT_TAGS.includes(tag) ? 'gold' : 'default'}
                  onClick={(event) => {
                    event.stopPropagation();
                    setHistoryTagFilter(tag);
                  }}
                >
                  {tag}
                </Tag>
              )) : <Text type="secondary">点击选择标签</Text>}
            </Space>
          </div>
        )
      ),
    },
    {
      title: (
        <HistorySortHeader
          text="状态"
          sortKey="status"
          activeOrder={historySort.key === 'status' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      dataIndex: 'status',
      key: 'status',
      render: (status: MatchRecord['status'], record: MatchRecord) => (
        <Space size={4} wrap>
          <MatchStatusTag status={status} />
          {cloudPendingIdSet.has(record.id) ? <Tag color="purple">待交回</Tag> : null}
          {cloudAckedSet.has(record.id) && cloudStatus?.config.role === 'sub' ? <Tag color="green">已确认</Tag> : null}
        </Space>
      ),
    },
    {
      title: (
        <HistorySortHeader
          text="更新时间"
          sortKey="updatedAt"
          activeOrder={historySort.key === 'updatedAt' ? historySort.order : null}
          onSort={cycleHistorySort}
        />
      ),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (value: MatchRecord['updatedAt']) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: MatchRecord) => {
        // 行内直接录入：自动定位到该场比赛的当前小局，免展开操作
        const entryGame = getCurrentGame(record);
        const entryReason = entryGame
          ? getLineupEntryBlockReason(record, entryGame)
          : 'match-completed';
        return (
          <Space wrap>
            <Tooltip
              title={entryReason
                ? LINEUP_ENTRY_BLOCK_TEXT[entryReason]
                : `提前录入第 ${entryGame?.gameNumber ?? 1} 局双方阵容，开始对局时自动生效`}
            >
              <span>
                <Button
                  size="small"
                  type={entryReason ? 'default' : 'primary'}
                  ghost={!entryReason}
                  disabled={Boolean(entryReason)}
                  onClick={() => onEnterLineup(record.id, entryGame?.gameNumber ?? 1)}
                >
                  录入阵容
                </Button>
              </span>
            </Tooltip>
            <Button size="small" onClick={() => onSelectMatch(record.id)}>进入管理</Button>
            <Button
              size="small"
              danger
              onClick={() => {
                modal.confirm({
                  title: '删除这场赛事？',
                  content: `${record.leftPlayer || '左侧'} vs ${record.rightPlayer || '右侧'}`,
                  onOk: () => deleteHistoryMatches([record.id]),
                });
              }}
            >
              删除
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={18} className="page-stack">
      {/* 四张推流功能卡片单独一行（不再内嵌进比赛管理卡片）；四卡等高，见 styles.css .match-push-card-row */}
      <Row gutter={[16, 16]} className="match-push-card-row">
        {page6 ? (
          <Col xs={24} md={6}>
            <MatchPushCard
              kind="page6"
              cardTitle="推送比赛结果"
              maxCount={PAGE6_MAX_MATCHES}
              matches={adminVisibleMatches}
              allMatches={matchStore.matches}
              tournaments={tournaments}
              state={page6}
              pushing={Boolean(matchPushLoading.page6)}
              onPush={(payload) => pushMatchesForPage('page6', payload)}
            />
          </Col>
        ) : null}
        {page7 ? (
          <Col xs={24} md={6}>
            <MatchPushCard
              kind="page7"
              cardTitle="推送战绩详情"
              matches={adminVisibleMatches}
              allMatches={matchStore.matches}
              tournaments={tournaments}
              state={page7}
              pushing={Boolean(matchPushLoading.page7)}
              onPush={(payload) => pushMatchesForPage('page7', payload)}
            />
          </Col>
        ) : null}
        {page8 ? (
          <Col xs={24} md={6}>
            <MatchPushCard
              kind="page8"
              cardTitle="推送比赛预告"
              maxCount={PAGE8_MAX_MATCHES}
              matches={adminVisibleMatches}
              allMatches={matchStore.matches}
              tournaments={tournaments}
              state={page8}
              pushing={Boolean(matchPushLoading.page8)}
              onPush={(payload) => pushMatchesForPage('page8', payload)}
            />
          </Col>
        ) : null}
        {page14 ? (
          <Col xs={24} md={6}>
            <AdvanceRankCard
              tournaments={tournaments}
              state={page14}
              standings={page14Standings}
              saving={page14Saving}
              onSave={savePage14Settings}
            />
          </Col>
        ) : null}
      </Row>

      {/* 比赛回收站：普通删除 7 天内逐条恢复（purged 批次——回退上一波等不可恢复删除——不在列） */}
      <Modal
        title="♻ 比赛回收站"
        open={recycleBinOpen}
        width={MODAL_WIDTH.sm}
        okText={`恢复选中（${recycleSelectedKeys.length}）`}
        okButtonProps={{ disabled: !recycleSelectedKeys.length, loading: recycleRestoring }}
        onOk={() => void restoreRecycleMatches()}
        onCancel={() => setRecycleBinOpen(false)}
      >
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {recycleLoading ? (
            <Text type="secondary">加载中…</Text>
          ) : recycleBinRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recycleBinRows.map((row) => (
                <div
                  key={row.matchId}
                  style={{
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: '6px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Text strong>{row.leftPlayer} vs {row.rightPlayer}</Text>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                      {row.matchId} · BO{row.bestOf} · 删除于 {row.deletedAt.slice(0, 16).replace('T', ' ')}
                    </Text>
                  </div>
                  <Checkbox
                    checked={recycleSelectedKeys.includes(row.matchId)}
                    onChange={(event) => {
                      setRecycleSelectedKeys((prev) => (
                        event.target.checked
                          ? [...prev, row.matchId]
                          : prev.filter((id) => id !== row.matchId)
                      ));
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary">回收站是空的（普通删除的比赛保留 7 天，过期自动清理）</Text>
          )}
        </div>
      </Modal>

      <Card
        title="比赛管理"
        extra={(
          <Space wrap>
            <Button onClick={exportHistoryCsv} disabled={!filteredMatches.length}>导出 CSV</Button>
            {selectedHistoryKeys.length > 1 ? (
              <Button onClick={() => void handleBatchTag()}>批量添加标签</Button>
            ) : null}
            <Button danger disabled={!selectedHistoryKeys.length} onClick={() => void deleteHistoryMatches(selectedHistoryKeys.map(String))}>
              删除选中赛事
            </Button>
            <Button onClick={() => void openMatchRecycleBin()} disabled={matchStore.undo.deleteUndoCount === 0}>
              ♻ 回收站 ({matchStore.undo.deleteUndoCount})
            </Button>
          </Space>
        )}
      >
        {historyNotice ? (
          <Alert
            showIcon
            closable
            type={historyNotice.tone}
            message={historyNotice.text}
            className="history-notice"
            onClose={() => setHistoryNotice(null)}
          />
        ) : null}
        <Space wrap className="history-filter-row">
          <Input.Search
            placeholder="搜索选手名或赛事ID"
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
            allowClear
            className="history-search-input"
          />
          <Text type="secondary" className="history-filter-group-label">系列赛</Text>
          <Tag
            color={historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER ? 'purple' : 'default'}
            onClick={() => setHistoryTournamentFilter(
              historyTournamentFilter === PLAIN_HISTORY_MATCH_FILTER ? null : PLAIN_HISTORY_MATCH_FILTER,
            )}
          >
            普通对局
          </Tag>
          {historyTournamentFilters.map((item) => (
            <Tag
              key={item.id}
              color={historyTournamentFilter === item.id ? 'purple' : 'default'}
              onClick={() => setHistoryTournamentFilter(historyTournamentFilter === item.id ? null : item.id)}
            >
              🏆 {item.name}（{item.count}）
            </Tag>
          ))}
          <Divider type="vertical" className="history-filter-divider" />
          <Text type="secondary" className="history-filter-group-label">标签</Text>
          <Tag
            color={historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? 'processing' : 'default'}
            onClick={() => setHistoryTagFilter(historyTagFilter === UNCATEGORIZED_HISTORY_TAG ? null : UNCATEGORIZED_HISTORY_TAG)}
          >
            无标签
          </Tag>
          <Tag color={!historyTagFilter ? 'processing' : 'default'} onClick={() => setHistoryTagFilter(null)}>全部</Tag>
          {allHistoryTags.map((tag) => (
            <Tag key={tag} color={historyTagFilter === tag ? 'processing' : 'default'} onClick={() => setHistoryTagFilter(historyTagFilter === tag ? null : tag)}>
              {tag}
            </Tag>
          ))}
        </Space>
        {/* 筛选状态要让用户看见：否则「刚同步过来的比赛没出现在列表里」会被当成丢失 */}
        {historyFilterSummary ? (
          <Alert
            type="info"
            showIcon
            className="history-filter-hint"
            message={historyFilterSummary}
            action={(
              <Button
                size="small"
                onClick={() => {
                  setHistoryTournamentFilter(null);
                  setHistoryTagFilter(null);
                  setHistorySearch('');
                }}
              >
                清除筛选
              </Button>
            )}
          />
        ) : null}
        <Table
          rowKey={(record) => record.id}
          columns={historyColumns}
          dataSource={sortedMatches}
          pagination={{
            defaultPageSize: 10,
            pageSizeOptions: ['10', '20', '50', '100'],
            showSizeChanger: {
              // 下拉挂到 body：表格在卡片底部，触发器父链上的层叠上下文/包含块会让下拉算错位置或被裁掉
              getPopupContainer: () => document.body,
              // 下拉宽度按选项内容自适应：跟随「10 条/页」这个很窄的触发器会把选项文字裁没
              popupMatchSelectWidth: false,
            },
            showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`,
          }}
          rowSelection={{
            selectedRowKeys: selectedHistoryKeys,
            onChange: (keys) => setSelectedHistoryKeys(keys),
          }}
          expandable={{
            expandedRowRender: (record) => (
              <Space direction="vertical" size={16} className="history-detail">
                <Text type="secondary">
                  {record.id} · BO{record.bestOf} · 已记录 {record.games.filter((game) => game.status === 'completed').length} 局
                  {record.completedAt ? ` · 完成于 ${formatDateTime(record.completedAt)}` : ''}
                </Text>
                {getHistoryVisibleGames(record).map((game) => {
                  const battleEntries = buildHistoryBattleEntries(game, spriteMap);
                  const leftLost = game.winner === 'right';
                  const rightLost = game.winner === 'left';
                  const lineupBlockReason = getLineupEntryBlockReason(record, game);

                  return (
                  <Card key={`${record.id}-${game.gameNumber}`} size="small" className="subtle-card">
                    <Space direction="vertical" size={12} className="control-stack">
                      <Space wrap>
                        <Tag color="gold">第 {game.gameNumber} 局</Tag>
                        <Tag color={game.status === 'completed' ? 'success' : game.status === 'in_progress' ? 'processing' : 'default'}>
                          {getGameStatusLabel(game.status)}
                        </Tag>
                        <Tag color={game.winner === 'left' ? 'success' : game.winner === 'right' ? 'volcano' : 'default'}>
                          {getGameResultLabel(game)}
                        </Tag>
                        <Text type="secondary">左侧 1-6 · 右侧 7-12</Text>
                        <Tooltip
                          title={lineupBlockReason
                            ? LINEUP_ENTRY_BLOCK_TEXT[lineupBlockReason]
                            : `提前录入第 ${game.gameNumber} 局双方阵容，开始对局时自动生效`}
                        >
                          <Button
                            size="small"
                            type={lineupBlockReason ? 'default' : 'primary'}
                            ghost={!lineupBlockReason}
                            disabled={Boolean(lineupBlockReason)}
                            onClick={() => onEnterLineup(record.id, game.gameNumber)}
                          >
                            录入阵容
                          </Button>
                        </Tooltip>
                      </Space>
                      <div className="history-battle-grid">
                        {battleEntries.map((entry, index) => {
                          const isLeft = index < 6;
                          const lost = isLeft ? leftLost : rightLost;

                          return (
                            <Card
                              key={`${record.id}-${game.gameNumber}-${isLeft ? 'left' : 'right'}-${index}`}
                              size="small"
                              className={`history-slot-card history-slot-card-${isLeft ? 'left' : 'right'}${lost ? ' is-lost' : ''}${!entry ? ' is-empty' : ''}`}
                            >
                              <Space direction="vertical" size={6} className="history-slot-stack">
                                {entry?.path ? (
                                  <Image
                                    preview={false}
                                    src={entry.path}
                                    alt={entry.name}
                                    className="history-slot-image"
                                    fallback="/assets/ui/back.png"
                                  />
                                ) : (
                                  <div className="history-slot-fallback">{index + 1}</div>
                                )}
                                <Text ellipsis className="history-slot-name">{entry?.name ?? `空位 ${index + 1}`}</Text>
                              </Space>
                            </Card>
                          );
                        })}
                      </div>
                    </Space>
                  </Card>
                  );
                })}
              </Space>
            ),
            expandedRowKeys: expandedHistoryKeys,
            // 不显示左侧 + 号展开列，改为点击整行展开（见 Table onRow）
            showExpandColumn: false,
          }}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: (event: React.MouseEvent<HTMLElement>) => {
              // 点行内交互控件（勾选框 / 标签 / 按钮 / 行内编辑等）时不触发展开
              if ((event.target as HTMLElement).closest(
                'button, a, input, label, .ant-select, .ant-tag, .history-tag-cell',
              )) {
                return;
              }
              setExpandedHistoryKeys((prev) => (prev.includes(record.id) ? [] : [record.id]));
            },
          })}
          locale={{ emptyText: '暂无历史赛事' }}
        />
      </Card>

      <Modal
        title="批量添加标签"
        open={batchTagOpen}
        onCancel={() => setBatchTagOpen(false)}
        onOk={() => void submitBatchTag()}
        okButtonProps={{ disabled: !batchTagValue }}
        confirmLoading={batchTagSaving}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text>已选中 {selectedHistoryKeys.length} 场赛事，选择要添加的标签（仅可选择一个）：</Text>
          <Select
            showSearch
            autoFocus
            value={batchTagValue ?? undefined}
            placeholder="选择标签"
            options={allHistoryTags.map((tag) => ({ value: tag, label: tag }))}
            onChange={setBatchTagValue}
            className="history-tag-select"
            optionFilterProp="label"
          />
        </Space>
      </Modal>
    </Space>
  );
}
