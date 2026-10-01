import React, { useMemo } from 'react';
import { Button, Card, Empty, Image, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import type { MatchRecord, SpriteRecord } from '../../../shared/types';
import {
  buildHistoryBattleEntries,
  getHistoryVisibleGames,
  getLineupEntryBlockReason,
  LINEUP_ENTRY_BLOCK_TEXT,
} from '../lib/history';
import {
  getGameResultLabel,
  getGameStatusLabel,
  getMatchStatusColor,
  getMatchStatusLabel,
  summarizeSeriesForBestOf,
} from '../lib/match';
import { buildSpriteLookup } from '../lib/sprite';

const { Text } = Typography;

export interface MatchLineupDetailPanelProps {
  /** 由父级按 matchId 从最新 matches 解析；null = 未就绪或比赛已被删除 */
  match: MatchRecord | null;
  /** 所属系列赛的「阶段 · 轮次」摘要（普通对局 / 已解绑时为 null，不展示） */
  stageRoundText?: string | null;
  sprites: SpriteRecord[];
  /** 点「录入阵容」：由父级打开既有录入弹窗（仅当前未开始小局放开，其余小局按钮置灰） */
  onEnterLineup(matchId: string, gameNumber: number): void;
  /** 嵌在容器里（如系列比赛 Drawer）时隐藏上方已单独展示的「选手 vs 比分」摘要行 */
  hideSummary?: boolean;
}

export interface MatchLineupDetailModalProps {
  open: boolean;
  match: MatchRecord | null;
  stageRoundText?: string | null;
  sprites: SpriteRecord[];
  onClose(): void;
  onEnterLineup(matchId: string, gameNumber: number): void;
}

/**
 * 「阵容详情」正文：逐局展示双方 6v6 阵容快照（只读；槽位渲染与比赛管理展开行同源，样式自然一致），
 * 仅「当前小局且待开始」放开「录入阵容」打开既有录入弹窗；其余局置灰并附锁定原因——
 * 门槛与文案完全复用比赛管理那套判定，服务端规则零改动。
 *
 * 读的是**这场比赛自己的 games 快照**（与推流面板无关），所以对任意场次都成立；
 * 「录入阵容」只写比赛记录（headless-safe，不动推流画面）。
 * 由「阵容详情」Modal 与系列比赛 Drawer 底部「双方阵容」卡共用（后者传 hideSummary 去重比分摘要）。
 */
export function MatchLineupDetailPanel({
  match,
  stageRoundText,
  sprites,
  onEnterLineup,
  hideSummary = false,
}: MatchLineupDetailPanelProps): React.ReactElement {
  const spriteMap = useMemo(() => buildSpriteLookup(sprites), [sprites]);
  const summary = match ? summarizeSeriesForBestOf(match, match.bestOf) : null;

  if (!match || !summary) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无阵容" />;
  }

  return (
    <div className="lineup-detail-body">
      <Space wrap size={8}>
        {!hideSummary ? (
          <>
            <Text strong>{match.leftPlayer || '左侧'}</Text>
            <Text type="secondary">vs</Text>
            <Text strong>{match.rightPlayer || '右侧'}</Text>
            <Tag color={getMatchStatusColor(match.status)}>{getMatchStatusLabel(match.status)}</Tag>
            <Text type="secondary">BO{match.bestOf} · 比分 {summary.leftScore}:{summary.rightScore}</Text>
            {stageRoundText ? <Tag color="purple">{stageRoundText}</Tag> : null}
          </>
        ) : null}
        <Text type="secondary">阵容顺序：左侧 1-6 · 右侧 7-12；已完赛小局的败方槽位置灰。</Text>
      </Space>

      {getHistoryVisibleGames(match).map((game) => {
        const blockReason = getLineupEntryBlockReason(match, game);
        const entries = buildHistoryBattleEntries(game, spriteMap);
        const isEmpty = entries.every((entry) => !entry);
        const leftLost = game.winner === 'right';
        const rightLost = game.winner === 'left';

        return (
          <Card key={game.gameNumber} size="small" className="subtle-card">
            <Space direction="vertical" size={12} className="control-stack">
              <Space wrap>
                <Tag color="gold">第 {game.gameNumber} 局</Tag>
                <Tag color={game.status === 'completed' ? 'success' : game.status === 'in_progress' ? 'processing' : 'default'}>
                  {getGameStatusLabel(game.status)}
                </Tag>
                <Tag color={game.winner === 'left' ? 'success' : game.winner === 'right' ? 'volcano' : 'default'}>
                  {getGameResultLabel(game)}
                </Tag>
                {/* 禁用按钮自身不派发鼠标事件，用 span 包裹才能触发 Tooltip（同系列赛详情删除按钮） */}
                <Tooltip
                  title={blockReason
                    ? LINEUP_ENTRY_BLOCK_TEXT[blockReason]
                    : `提前录入第 ${game.gameNumber} 局双方阵容，开始对局时自动生效`}
                >
                  <span style={{ display: 'inline-block' }}>
                    <Button
                      size="small"
                      type={blockReason ? 'default' : 'primary'}
                      ghost={!blockReason}
                      disabled={Boolean(blockReason)}
                      style={{ pointerEvents: blockReason ? 'none' : undefined }}
                      onClick={() => onEnterLineup(match.id, game.gameNumber)}
                    >
                      录入阵容
                    </Button>
                  </span>
                </Tooltip>
              </Space>
              {isEmpty ? (
                <Empty
                  className="lineup-detail-empty"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="尚未录入阵容"
                />
              ) : (
                <div className="history-battle-grid">
                  {entries.map((entry, index) => {
                    const isLeft = index < 6;
                    const lost = isLeft ? leftLost : rightLost;
                    return (
                      <Card
                        key={`${game.gameNumber}-${isLeft ? 'left' : 'right'}-${index}`}
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
              )}
            </Space>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * 系列赛详情「阵容详情」弹窗（晋级图 / 波次列表卡片入口）：正文见 MatchLineupDetailPanel。
 */
export function MatchLineupDetailModal({
  open,
  match,
  stageRoundText,
  sprites,
  onClose,
  onEnterLineup,
}: MatchLineupDetailModalProps): React.ReactElement {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={960}
      styles={{ body: { maxHeight: '62vh', overflowY: 'auto' } }}
      title={match ? `阵容详情 · ${match.id}` : '阵容详情'}
    >
      <MatchLineupDetailPanel
        match={match}
        stageRoundText={stageRoundText}
        sprites={sprites}
        onEnterLineup={onEnterLineup}
      />
    </Modal>
  );
}

export default MatchLineupDetailModal;
