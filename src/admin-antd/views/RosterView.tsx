import React, { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Col,
  List,
  Row,
  Space,
  Tag,
  Tooltip,
} from 'antd';

import type { MatchRecord } from '../../../shared/types';
import { useAdminData } from '../data/use-admin-data';
import { filterLocallyRemovedMatches } from '../lib/history';
import { getActiveMatch, getNoticeTagColor } from '../lib/match';
import { buildPushCandidateGroups } from '../lib/tournament';
import { CurrentMatchPanelContainer } from './CurrentMatchPanelContainer';
import { RosterEditor } from './RosterEditor';
import { EmptyState } from '../ui/EmptyState';
import { MatchStatusTag } from '../ui/StatusTag';
import { Surface } from '../ui/Surface';

/** 赛事面板的懒加载步长：一次渲染 6 条，滚动到底部再加载 */
const MATCH_LIST_PAGE_SIZE = 6;

/** 比赛列表行：分组标题行 或 比赛卡片行（扁平化后供懒加载切片） */
type DashboardListRow =
  | { rowType: 'group'; key: string; title: string; count: number }
  | { rowType: 'match'; key: string; match: MatchRecord };

/**
 * 赛事面板（M4 从 App.tsx 拆出）：比赛列表（懒加载）+ 当前比赛 + 阵容编辑器。
 * 当前比赛面板与阵容编辑器各自是独立容器（系列比赛 Drawer 复用同一份实现）；
 * 开一局 / 快速创建弹窗仍挂在 App 根，这里只负责触发。
 */
export function RosterView({
  onOpenCreateMatch,
  onOpenQuickCreate,
  onSelectMatch,
}: {
  onOpenCreateMatch: () => void;
  onOpenQuickCreate: () => void;
  onSelectMatch: (matchId: string) => void;
}): React.ReactElement {
  const { matchStore, tournaments, locallyRemoved, recycleBin, rosterNotice, setRosterNotice } = useAdminData();
  const [visibleMatchCount, setVisibleMatchCount] = useState(MATCH_LIST_PAGE_SIZE);

  const activeMatch = getActiveMatch(matchStore);
  const locallyRemovedIdSet = useMemo(
    () => new Set(locallyRemoved.map((tournament) => tournament.id)),
    [locallyRemoved],
  );
  const recycleBinIdSet = useMemo(
    () => new Set(recycleBin.map((tournament) => tournament.id)),
    [recycleBin],
  );
  const adminVisibleMatches = useMemo(
    () => filterLocallyRemovedMatches(matchStore.matches, locallyRemovedIdSet)
      .filter((match) => {
        const tournamentId = match.tournamentRef?.tournamentId;
        return !tournamentId || !recycleBinIdSet.has(tournamentId);
      }),
    [matchStore.matches, locallyRemovedIdSet, recycleBinIdSet],
  );

  // 赛事面板比赛列表：当前比赛置顶高亮（不参与懒加载计数），其余按「赛事 · 阶段 · 轮次」分组
  const dashboardActiveMatch = activeMatch || null;
  const dashboardNonActiveMatches = adminVisibleMatches.filter((match) => match.id !== dashboardActiveMatch?.id);
  const dashboardMatchGroups = buildPushCandidateGroups(dashboardNonActiveMatches, tournaments);
  const dashboardListRows = ((): DashboardListRow[] => {
    const rows: DashboardListRow[] = [];
    dashboardMatchGroups.forEach((group) => {
      rows.push({
        rowType: 'group',
        key: `group:${group.key}`,
        title: group.title,
        count: group.matches.length,
      });
      group.matches.forEach((match) => {
        rows.push({ rowType: 'match', key: match.id, match });
      });
    });
    return rows;
  })();
  const visibleDashboardRows = dashboardListRows.slice(0, visibleMatchCount);
  const hasMoreMatches = dashboardListRows.length > visibleMatchCount;

  /** 比赛列表滚动到底部（余量 32px）时追加一页卡片 */
  function handleMatchListScroll(event: React.UIEvent<HTMLDivElement>) {
    if (!hasMoreMatches) {
      return;
    }
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32) {
      setVisibleMatchCount((count) => Math.min(count + MATCH_LIST_PAGE_SIZE, dashboardListRows.length));
    }
  }

  /**
   * 比赛列表卡片行（分组列表内使用）。
   * 两行布局：第一行 = 状态点 + 选手名（单行截断，悬停看全名）；第二行 = 赛制/状态/比分胶囊 +「选择」按钮。
   */
  function renderDashboardMatchItem(match: MatchRecord) {
    const title = `${match.leftPlayer || '左侧'} vs ${match.rightPlayer || '右侧'}`;
    return (
      <List.Item className="match-list-item">
        <div className="match-list-item-main">
          <Badge status={match.status === 'completed' ? 'success' : match.status === 'in_progress' ? 'processing' : 'default'} />
          <Tooltip title={title}>
            <span className="match-list-item-name">{title}</span>
          </Tooltip>
        </div>
        <div className="match-list-item-foot">
          <Space size={6} wrap>
            <Tag color="gold">BO{match.bestOf}</Tag>
            <MatchStatusTag status={match.status} />
            <Tag bordered={false} className="match-list-score-tag">{match.leftScore} : {match.rightScore}</Tag>
          </Space>
          <Button size="small" onClick={() => onSelectMatch(match.id)}>选择</Button>
        </div>
      </List.Item>
    );
  }

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Row gutter={[18, 18]} className="roster-overview-row">
        <Col xs={24} xl={7} className="roster-overview-col">
          <Card
            className="roster-overview-card roster-match-list-card"
            title="比赛列表"
            extra={
              <Space size={8}>
                <Button onClick={onOpenQuickCreate}>快速创建比赛</Button>
                <Button type="primary" onClick={onOpenCreateMatch}>开一局</Button>
              </Space>
            }
          >
            <div className="match-list-scroll" onScroll={handleMatchListScroll}>
              {dashboardActiveMatch ? (
                <div className="match-list-current">
                  <div className="match-list-group-title">当前比赛</div>
                  {/* 独立 markup：List.Item 的 actions 是 ul，脱离 List 上下文会丢样式 */}
                  <Surface tone="highlight" className="match-list-current-card">
                    <Badge status={dashboardActiveMatch.status === 'completed' ? 'success' : dashboardActiveMatch.status === 'in_progress' ? 'processing' : 'default'} />
                    <span className="match-list-current-players">
                      {dashboardActiveMatch.leftPlayer || '左侧'} vs {dashboardActiveMatch.rightPlayer || '右侧'}
                    </span>
                    <Space size={6} wrap>
                      <Tag color="gold">BO{dashboardActiveMatch.bestOf}</Tag>
                      <MatchStatusTag status={dashboardActiveMatch.status} />
                      <Tag bordered={false} className="match-list-score-tag">{dashboardActiveMatch.leftScore} : {dashboardActiveMatch.rightScore}</Tag>
                    </Space>
                  </Surface>
                </div>
              ) : null}
              <List
                dataSource={visibleDashboardRows}
                className="match-list"
                locale={{ emptyText: dashboardActiveMatch ? '没有其他比赛了。' : '暂无赛事，先创建一场比赛吧。' }}
                renderItem={(row) => (row.rowType === 'group' ? (
                  <div className="match-list-group-title">{row.title}（{row.count} 场）</div>
                ) : renderDashboardMatchItem(row.match))}
              />
              {hasMoreMatches ? (
                <div className="match-list-more">
                  下滑加载更多（已显示 {visibleDashboardRows.filter((row) => row.rowType === 'match').length}/{dashboardNonActiveMatches.length}）
                </div>
              ) : null}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={17} className="roster-overview-col">
          <Card
            className="roster-overview-card roster-current-card"
            title="当前比赛"
            extra={(
              <Space wrap size={8} className="roster-card-head-extra">
                {rosterNotice ? (
                  <Tag
                    closable
                    bordered={false}
                    color={getNoticeTagColor(rosterNotice.tone)}
                    className="roster-notice-tag"
                    onClose={() => setRosterNotice(null)}
                  >
                    {rosterNotice.text}
                  </Tag>
                ) : null}
                <MatchStatusTag status={activeMatch?.status} fallback="未创建" />
              </Space>
            )}
          >
            {activeMatch ? (
              <CurrentMatchPanelContainer match={activeMatch} variant="inline" />
            ) : (
              <EmptyState title="先创建或选择一场赛事" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[18, 18]}>
        <Col span={24}>
          <RosterEditor match={activeMatch} />
        </Col>
      </Row>
    </Space>
  );
}
