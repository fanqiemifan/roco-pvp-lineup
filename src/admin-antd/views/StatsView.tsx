import React from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Image,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ATTRIBUTE_ICON_BY_LABEL } from '../constants';
import { SettingField } from '../components/SettingField';
import type { MatchStoreState, SpriteRecord, TournamentRecord } from '../../../shared/types';
import { buildHistoryTournamentFilters } from '../lib/history';
import {
  buildStatsCsv,
  buildUsageStats,
  STATS_METRIC_OPTIONS,
} from '../lib/stats';
import type { SpriteUsageRow, StatsMetricKey } from '../lib/stats';

const { Text } = Typography;

/** 数据统计明细卡片顶部切换视图 */
type StatsChartMode = 'rank' | 'attribute' | 'trend';

/** 平滑曲线：Catmull-Rom 转三次贝塞尔（基础折线图的连接方式） */
function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) {
    return '';
  }
  const parts = [`M ${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    parts.push(`C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
  }
  return parts.join(' ');
}

function StatsColumnTitle({ text, tip }: { text: string; tip: string }) {
  return (
    <Tooltip
      styles={{
        root: { maxWidth: 'min(300px, 80vw)' },
        container: { whiteSpace: 'normal', wordBreak: 'break-word' },
      }}
      title={tip}
    >
      <span className="stats-column-title">
        {text}
        <span className="stats-column-hint" aria-hidden>?</span>
      </span>
    </Tooltip>
  );
}

type StatsViewProps = {
  matches: MatchStoreState['matches'];
  spriteMap: Map<string, SpriteRecord>;
  tournaments: TournamentRecord[];
  metric: StatsMetricKey;
  player: string | null;
  tag: string | null;
  tournamentId: string | null;
  search: string;
  onMetricChange: (value: StatsMetricKey) => void;
  onPlayerChange: (value: string | null) => void;
  onTagChange: (value: string | null) => void;
  onTournamentChange: (value: string | null) => void;
  onSearchChange: (value: string) => void;
  // 推流页面5 显示设置（由「直播推流」视图移入；控制推流画面内容，与统计口径相互独立）
  page5TitleDraft: string;
  page5TournamentId: string;
  page5Stage: string;
  stageSaving: boolean;
  onPage5TitleChange: (value: string) => void;
  onPage5TitleBlur: () => void;
  onPage5DisplayChange: (patch: { page5TournamentId?: string; page5Stage?: string }) => void;
  // 推流页面15（数据统计）显示设置；同样控制推流画面内容，与统计口径相互独立
  page15TournamentId: string;
  page15Stage: string;
  page15SortBy: 'picks' | 'games' | 'winRate';
  page15SortOrder: 'asc' | 'desc';
  onPage15DisplayChange: (patch: { page15TournamentId?: string; page15Stage?: string; page15SortBy?: 'picks' | 'games' | 'winRate'; page15SortOrder?: 'asc' | 'desc' }) => void;
};

export function StatsView({
  matches,
  spriteMap,
  tournaments,
  metric,
  player,
  tag,
  tournamentId,
  search,
  onMetricChange,
  onPlayerChange,
  onTagChange,
  onTournamentChange,
  onSearchChange,
  page5TitleDraft,
  page5TournamentId,
  page5Stage,
  stageSaving,
  onPage5TitleChange,
  onPage5TitleBlur,
  onPage5DisplayChange,
  page15TournamentId,
  page15Stage,
  page15SortBy,
  page15SortOrder,
  onPage15DisplayChange,
}: StatsViewProps) {
  const { message } = App.useApp();
  const [chartMode, setChartMode] = React.useState<StatsChartMode>('rank');
  const stats = buildUsageStats(matches, spriteMap, tournaments, {
    player,
    tag,
    tournamentId,
    metric,
  });
  const keyword = search.trim().toLowerCase();
  const visibleRows = keyword
    ? stats.rows.filter((row) => row.name.toLowerCase().includes(keyword))
    : stats.rows;
  const maxUsagePercent = stats.rows[0]?.usagePercent ?? 0;
  const maxAttributePercent = stats.attributeRows[0]?.percent ?? 0;
  const playerOptions = Array.from(new Set(matches.flatMap((match) => [
    match.leftPlayer,
    match.rightPlayer,
  ]).filter(Boolean)));
  const tagOptions = Array.from(new Set(matches.flatMap((match) => match.tags ?? [])));
  const tournamentOptions = buildHistoryTournamentFilters(matches, tournaments);
  // 推流页面5/15 的阶段过滤选项：来自所选系列赛的阶段配置（阶段依托具体系列赛，未选系列赛时仅「全部」）
  const buildStageFilterOptions = (selectedTournamentId: string) => {
    const selected = tournaments.find((item) => item.id === selectedTournamentId);
    if (!selected) {
      return [{ value: '', label: '全部' }];
    }
    return [
      { value: '', label: '全部' },
      ...selected.stages.map((stage, index) => ({ value: String(index), label: stage.name })),
    ];
  };
  const selectedTournamentName = tournamentOptions.find((item) => item.id === tournamentId)?.name ?? '';
  const trendColors = ['#d38b2d', '#4f8cff', '#c24635', '#2d7a58', '#8a5fd0'];
  const topTrendRows = stats.rows.slice(0, 5);
  const stageAxis = stats.stageAxis;
  const topUsageForTrend = Math.max(
    1,
    ...topTrendRows.flatMap((row) => stageAxis.map((bucket) => (stats.spriteStageRate.get(row.name)?.get(bucket.key) ?? 0) * 100)),
  );

  // 基础折线图的数据点：x/y 为百分比坐标（相对绘图区），y 留出上下边距避免贴边
  function trendPoint(rowName: string, bucketKey: string, index: number) {
    const rate = (stats.spriteStageRate.get(rowName)?.get(bucketKey) ?? 0) * 100;
    const x = stageAxis.length > 1 ? (index / (stageAxis.length - 1)) * 100 : 0;
    const y = 100 - (rate / topUsageForTrend) * 100;
    return { x, y: Math.max(3, Math.min(97, y)) };
  }
  const trendTickStep = (() => {
    const raw = topUsageForTrend / 4;
    for (const nice of [1, 2, 5, 10, 20, 25, 50, 100]) {
      if (raw <= nice) return nice;
    }
    return Math.ceil(raw / 100) * 100;
  })();
  const trendTicks: number[] = [];
  let lastTrendTick = 0;
  for (let v = 0; v < topUsageForTrend; v += trendTickStep) {
    lastTrendTick = Math.round(v * 10) / 10;
    trendTicks.push(lastTrendTick);
  }
  // 末尾刻度处理：当最大值与最后一个循环刻度相隔不足半步长时
  // （如 top=41、step=20 → 40 与 41 在顶部几乎重叠，观感上像多出一个 ytick），
  // 直接用最大值替换末端刻度；否则正常追加最大值刻度。
  if (!trendTicks.length) {
    trendTicks.push(topUsageForTrend);
  } else if (topUsageForTrend - lastTrendTick > trendTickStep / 2) {
    trendTicks.push(topUsageForTrend);
  } else {
    trendTicks[trendTicks.length - 1] = topUsageForTrend;
  }

  const statsColumns: ColumnsType<SpriteUsageRow> = [
    {
      title: '#',
      key: 'rank',
      width: 56,
      render: (_: unknown, __: SpriteUsageRow, index: number) => {
        if (keyword) {
          return <Text type="secondary">{index + 1}</Text>;
        }
        const rankCls = index < 3 ? `stats-rank-${index + 1}` : 'stats-rank-plain';
        return <span className={`stats-rank ${rankCls}`}>{index + 1}</span>;
      },
    },
    {
      title: '精灵',
      dataIndex: 'name',
      key: 'name',
      render: (_: unknown, record: SpriteUsageRow) => (
        <Space>
          {record.spritePath ? (
            <Image
              preview={false}
              src={record.spritePath}
              alt={record.name}
              width={44}
              height={44}
              className="stats-row-image"
              fallback="/assets/ui/back.png"
            />
          ) : (
            <div className="stats-row-image stats-row-image-fallback">{record.name.slice(0, 1)}</div>
          )}
          <Space direction="vertical" size={2}>
            <Text strong>{record.name}</Text>
            {record.attributes.length ? (
              <Text type="secondary" className="stats-row-attrs">{record.attributes.join(' / ')}</Text>
            ) : (
              <Text type="secondary" className="stats-row-attrs">未知属性</Text>
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: (
        <StatsColumnTitle
          text={metric === 'pickRate' ? '使用率' : '上场率'}
          tip={metric === 'pickRate'
            ? '使用率 = 登场只次 ÷ 总登场只次（同局重复携带按只次计）'
            : '上场率 = 登场场次 ÷ 总场次（同局左右双方携带同名精灵只计 1 次）'}
        />
      ),
      key: 'usage',
      showSorterTooltip: false,
      render: (_: unknown, record: SpriteUsageRow) => (
        <div className="stats-usage-cell">
          <Progress
            percent={maxUsagePercent > 0 ? Math.max(2, (record.usagePercent / maxUsagePercent) * 100) : 0}
            showInfo={false}
            size="small"
            className="stats-usage-bar"
          />
          <Text className="stats-usage-value">{record.usagePercent.toFixed(1)}%</Text>
        </div>
      ),
      sorter: (a, b) => a.usageRate - b.usageRate,
    },
    {
      title: <StatsColumnTitle text="登场只次" tip="登场只次 = 精灵在局内阵容中出现的次数（同名精灵同局重复携带按只次逐只计）" />,
      dataIndex: 'picks',
      key: 'picks',
      width: 136,
      align: 'right',
      showSorterTooltip: false,
      sorter: (a, b) => a.picks - b.picks,
    },
    {
      title: <StatsColumnTitle text="登场场次" tip="登场场次 = 精灵登场的场次数（同局左右双方携带同名精灵只计 1 次）" />,
      dataIndex: 'games',
      key: 'games',
      width: 136,
      align: 'right',
      showSorterTooltip: false,
      sorter: (a, b) => a.games - b.games,
    },
    {
      title: '胜场',
      dataIndex: 'wins',
      key: 'wins',
      width: 96,
      align: 'right',
      sorter: (a, b) => a.wins - b.wins,
    },
    {
      title: '胜率',
      key: 'winRate',
      width: 112,
      align: 'right',
      sorter: (a, b) => (a.winRate ?? -1) - (b.winRate ?? -1),
      render: (_: unknown, record: SpriteUsageRow) => (
        record.winRate === null ? (
          <Text type="secondary">-</Text>
        ) : (
          <Text type={record.winRate >= 0.5 ? 'success' : 'danger'} className="stats-winrate">
            {(record.winRate * 100).toFixed(1)}%
          </Text>
        )
      ),
    },
    {
      title: (
        <StatsColumnTitle
          text="阵亡次数"
          tip="阵亡次数 = 已结束小局中该精灵 HP=0 的登场只数（重复携带的多只各计 1 次；同局双方同时阵亡各计 1 次）"
        />
      ),
      dataIndex: 'deaths',
      key: 'deaths',
      width: 108,
      align: 'right',
      sorter: (a, b) => a.deaths - b.deaths,
    },
    {
      title: (
        <StatsColumnTitle
          text="系列赛趋势"
          tip={`系列赛趋势 = 当前所选系列赛下该精灵${metric === 'pickRate' ? '使用率' : '上场率'} − 全量${metric === 'pickRate' ? '使用率' : '上场率'}（百分点）；未选择系列赛时不显示`}
        />
      ),
      key: 'tagTrend',
      width: 112,
      align: 'center',
      render: (_: unknown, record: SpriteUsageRow) => (
        record.tournamentTrendDelta === null ? (
          <Text type="secondary">—</Text>
        ) : record.tournamentTrendDelta > 0 ? (
          <Text type="success">▲{record.tournamentTrendDelta.toFixed(1)}</Text>
        ) : record.tournamentTrendDelta < 0 ? (
          <Text type="danger">▼{Math.abs(record.tournamentTrendDelta).toFixed(1)}</Text>
        ) : (
          <Text type="secondary">0.0</Text>
        )
      ),
    },
  ];

  function exportStatsCsv() {
    const csv = buildStatsCsv(stats.rows, metric);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `精灵${metric === 'pickRate' ? '使用率' : '上场率'}统计.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`已导出 ${stats.rows.length} 条精灵统计`);
  }

  return (
    <Space direction="vertical" size={18} className="page-stack">
      {/* 推流页面5/15 显示设置：一行两列置顶（控制推流画面）；统计口径卡在其下——它控制的是下方视图 */}
      <Row gutter={[18, 18]}>
        <Col xs={24} lg={12}>
          <Card title="推流页面5 显示设置">
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              以下设置控制「推流页面5」的画面内容（标题、统计范围），与下方统计口径相互独立；修改即时保存生效。
            </Text>
            <Row gutter={[16, 16]}>
              <Col xs={24}>
                <SettingField label="页面5标题：">
                  <Input
                    maxLength={40}
                    placeholder="例如：洛克比赛（自动拼上系列赛名与精灵出场胜率）"
                    value={page5TitleDraft}
                    onChange={(event) => onPage5TitleChange(event.target.value)}
                    onBlur={onPage5TitleBlur}
                  />
                </SettingField>
              </Col>
              <Col xs={24} md={12}>
                <SettingField label="系列赛：">
                  <Select
                    style={{ width: '100%' }}
                    value={page5TournamentId || undefined}
                    disabled={stageSaving}
                    options={[
                      { value: '', label: '全部' },
                      ...tournamentOptions.map((item) => ({ value: item.id, label: `🏆 ${item.name}（${item.count}）` })),
                    ]}
                    onChange={(value) => onPage5DisplayChange({ page5TournamentId: value ?? '', page5Stage: '' })}
                  />
                </SettingField>
              </Col>
              <Col xs={24} md={12}>
                <SettingField label="阶段：">
                  <Select
                    style={{ width: '100%' }}
                    value={page5Stage || undefined}
                    disabled={stageSaving || !page5TournamentId}
                    options={buildStageFilterOptions(page5TournamentId)}
                    onChange={(value) => onPage5DisplayChange({ page5Stage: value ?? '' })}
                  />
                </SettingField>
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="推流页面15 显示设置">
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              以下设置控制「推流页面15（数据统计）」的画面内容（统计范围与排序），与下方统计口径相互独立；修改即时保存生效。
            </Text>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <SettingField label="系列赛：">
                  <Select
                    style={{ width: '100%' }}
                    value={page15TournamentId || undefined}
                    disabled={stageSaving}
                    options={[
                      { value: '', label: '全部' },
                      ...tournamentOptions.map((item) => ({ value: item.id, label: `🏆 ${item.name}（${item.count}）` })),
                    ]}
                    onChange={(value) => onPage15DisplayChange({ page15TournamentId: value ?? '', page15Stage: '' })}
                  />
                </SettingField>
              </Col>
              <Col xs={24} md={12}>
                <SettingField label="阶段：">
                  <Select
                    style={{ width: '100%' }}
                    value={page15Stage || undefined}
                    disabled={stageSaving || !page15TournamentId}
                    options={buildStageFilterOptions(page15TournamentId)}
                    onChange={(value) => onPage15DisplayChange({ page15Stage: value ?? '' })}
                  />
                </SettingField>
              </Col>
              <Col xs={24}>
                <SettingField label="排序方式：">
                  <Space size={8} wrap>
                    <Segmented
                      value={page15SortBy}
                      disabled={stageSaving}
                      options={[
                        { value: 'picks', label: '使用次数' },
                        { value: 'games', label: '登场场次' },
                        { value: 'winRate', label: '胜率' },
                      ]}
                      onChange={(value) => onPage15DisplayChange({ page15SortBy: value as 'picks' | 'games' | 'winRate' })}
                    />
                    <Segmented
                      value={page15SortOrder}
                      disabled={stageSaving}
                      options={[
                        { value: 'desc', label: '降序' },
                        { value: 'asc', label: '升序' },
                      ]}
                      onChange={(value) => onPage15DisplayChange({ page15SortOrder: value as 'asc' | 'desc' })}
                    />
                  </Space>
                </SettingField>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card title="统计口径">
        <Space wrap size={12}>
          <Segmented
            value={metric}
            options={STATS_METRIC_OPTIONS}
            onChange={(value) => onMetricChange(value as StatsMetricKey)}
          />
          <Select
            showSearch
            allowClear
            placeholder="搜索选择选手"
            value={player ?? undefined}
            options={playerOptions.map((playerName) => ({ value: playerName, label: playerName }))}
            onChange={(value) => onPlayerChange(value ?? null)}
            className="stats-filter-select"
            optionFilterProp="label"
          />
          <Select
            showSearch
            allowClear
            placeholder="选择系列赛"
            value={tournamentId ?? undefined}
            options={tournamentOptions.map((item) => ({ value: item.id, label: `🏆 ${item.name}（${item.count}）` }))}
            onChange={(value) => onTournamentChange(value ?? null)}
            className="stats-filter-select"
            optionFilterProp="label"
          />
          <Select
            showSearch
            allowClear
            placeholder="搜索选择标签"
            value={tag ?? undefined}
            options={tagOptions.map((tagName) => ({ value: tagName, label: tagName }))}
            onChange={(value) => onTagChange(value ?? null)}
            className="stats-filter-select"
            optionFilterProp="label"
          />
        </Space>
      </Card>

      <Row gutter={[18, 18]}>
        <Col xs={12} xl={6}>
          <Card size="small" className="subtle-card">
            <Statistic title="统计场次" value={stats.totalGames} suffix="局" />
            <Text type="secondary">有阵容记录的对局</Text>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" className="subtle-card">
            <Statistic title="登场精灵总数" value={stats.totalPicks} suffix="只次" />
            <Text type="secondary">场均 {(stats.totalGames > 0 ? stats.totalPicks / stats.totalGames : 0).toFixed(1)} 只</Text>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" className="subtle-card">
            <Statistic title="不同精灵数" value={stats.distinctSprites} suffix="种" />
            <Text type="secondary">筛选范围内出现过</Text>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card size="small" className="subtle-card">
            <Statistic
              title="热门属性"
              value={stats.attributeRows[0]?.attribute ?? '-'}
              styles={{ content: { fontSize: 22 } }}
            />
            <Text type="secondary">{stats.attributeRows[0] ? `占比 ${stats.attributeRows[0].percent.toFixed(1)}%` : '暂无数据'}</Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[18, 18]}>
        <Col xs={24}>
          <Card
            title={
              chartMode === 'rank'
                ? (metric === 'pickRate' ? '精灵使用率排行' : '精灵上场率排行')
                : chartMode === 'attribute'
                  ? '属性分布'
                  : (metric === 'pickRate' ? 'TOP5各赛事阶段精灵使用率' : 'TOP5各赛事阶段精灵上场率')
            }
            extra={(
              <Segmented
                value={chartMode}
                options={[
                  { value: 'rank', label: metric === 'pickRate' ? '使用率排行' : '上场率排行' },
                  { value: 'attribute', label: '属性分布' },
                  { value: 'trend', label: '各赛事阶段' },
                ]}
                onChange={(value) => setChartMode(value as StatsChartMode)}
              />
            )}
          >
            {chartMode === 'rank' ? (
              <Space direction="vertical" size={12} className="page-stack" style={{ width: '100%' }}>
                <Space wrap>
                  <Input.Search
                    placeholder="搜索精灵名称"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    className="stats-search"
                    allowClear
                  />
                  <Button onClick={exportStatsCsv} disabled={!stats.rows.length}>导出 CSV</Button>
                </Space>
                <Table
                  rowKey={(record) => record.key}
                  columns={statsColumns}
                  dataSource={visibleRows}
                  size="middle"
                  pagination={{ pageSize: 15, showSizeChanger: false, hideOnSinglePage: true }}
                  locale={{ emptyText: '当前筛选范围内暂无登场记录' }}
                />
                <Text type="secondary" className="stats-footnote">
                  {metric === 'pickRate'
                    ? '使用率 = 登场只次 ÷ 总登场只次（同局重复携带按只次计）'
                    : '上场率 = 登场场次 ÷ 总场次（同局左右双方携带同名精灵只计 1 次）'}
                  {' · 胜率 = 该精灵所在一侧获胜场次 ÷ 登场场次（镜像局双方同携按 0.5 胜计）'}
                  {' · 阵亡次数 = 已结束小局中 HP=0 的登场只数'}
                </Text>
              </Space>
            ) : chartMode === 'attribute' ? (
              <div className="stats-attribute-panel">
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>按登场只次</Text>
                {stats.attributeRows.length ? (
                  <div className="stats-attribute-grid">
                    {stats.attributeRows.slice(0, 18).map((row) => {
                      const iconPath = ATTRIBUTE_ICON_BY_LABEL.get(row.attribute);
                      return (
                        <div key={row.attribute} className="stats-attribute-row">
                          <span className="stats-attribute-pill">
                            {iconPath && (
                              <img
                                src={iconPath}
                                alt={row.attribute}
                                width={16}
                                height={16}
                              />
                            )}
                            <span className="stats-attribute-pill-text">{row.attribute}</span>
                          </span>
                          <Progress
                            percent={maxAttributePercent > 0 ? (row.percent / maxAttributePercent) * 100 : 0}
                            showInfo={false}
                            size="small"
                            className="stats-usage-bar"
                          />
                          <Text className="stats-usage-value">{row.percent.toFixed(1)}%</Text>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="stats-card-empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
                  </div>
                )}
              </div>
            ) : (
              <div className="stats-trend-panel">
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  {tournamentId
                    ? `按系列赛阶段（${selectedTournamentName || tournamentId}）`
                    : '按系列赛阶段 · 未选择系列赛时按阶段名跨系列赛聚合，建议配合上方「系列赛」筛选查看'}
                </Text>
                {topTrendRows.length && stageAxis.length > 1 ? (
                  <Space direction="vertical" size={10} className="page-stack">
                    <div className="stats-trend-chart">
                      <div className="stats-trend-y" aria-hidden>
                        {trendTicks.map((tick) => (
                          <span
                            key={tick}
                            className="stats-trend-ytick"
                            style={{ top: `${100 - (tick / topUsageForTrend) * 100}%` }}
                          >
                            {Number.isInteger(tick) ? tick.toFixed(0) : tick.toFixed(1)}%
                          </span>
                        ))}
                      </div>
                      <div className="stats-trend-plot">
                        <svg viewBox="0 0 100 100" className="stats-trend-svg" preserveAspectRatio="none">
                          {trendTicks.filter((tick) => tick > 0).map((tick) => {
                            const y = 100 - (tick / topUsageForTrend) * 100;
                            return <line key={tick} x1="0" x2="100" y1={y} y2={y} className="stats-trend-grid" />;
                          })}
                          {topTrendRows.map((row, rowIndex) => {
                            const points = stageAxis.map((bucket, index) => trendPoint(row.name, bucket.key, index));
                            return (
                              <path
                                key={row.key}
                                d={buildSmoothPath(points)}
                                fill="none"
                                stroke={trendColors[rowIndex]}
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                              />
                            );
                          })}
                        </svg>
                        {topTrendRows.flatMap((row, rowIndex) => (
                          stageAxis.map((bucket, index) => {
                            const point = trendPoint(row.name, bucket.key, index);
                            return (
                              <span
                                key={`${row.key}-${bucket.key}`}
                                className="stats-trend-point"
                                style={{ left: `${point.x}%`, top: `${point.y}%`, background: trendColors[rowIndex] }}
                              />
                            );
                          })
                        ))}
                      </div>
                      <div className="stats-trend-x">
                        {stageAxis.map((bucket, index) => {
                          const pct = stageAxis.length > 1 ? (index / (stageAxis.length - 1)) * 100 : 0;
                          return (
                            <span
                              key={bucket.key}
                              className="stats-trend-xtick"
                              style={{
                                left: `${pct}%`,
                                transform: `translateX(${index === 0 ? '0%' : index === stageAxis.length - 1 ? '-100%' : '-50%'})`,
                              }}
                            >
                              {bucket.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <Space wrap size={14}>
                      {topTrendRows.map((row, rowIndex) => (
                        <Text key={row.key} type="secondary">
                          <span className="stats-trend-dot" style={{ background: trendColors[rowIndex] }} />
                          {row.name}
                        </Text>
                      ))}
                    </Space>
                  </Space>
                ) : (
                  <div className="stats-card-empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="需要至少两个阶段（或轮次）的登场数据" />
                  </div>
                )}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
