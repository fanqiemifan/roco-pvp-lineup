import React from 'react';
import { Button, Space, Tag, Typography } from 'antd';
import type { BracketCard, BracketSlot } from '../lib/tournament';

const { Text } = Typography;

const STATUS_COLOR: Record<BracketCard['status'], string> = {
  completed: 'success',
  in_progress: 'processing',
  pending: 'default',
};

export interface TournamentNodeCardProps {
  card: BracketCard;
  onSelectMatch(matchId: string): void;
  onForfeit?(): void;
  /** 晋级图选中态（显示该场连线时高亮卡片） */
  isActive?: boolean;
  /** 晋级图压暗态（选中某场链路时，其余不相关卡片弱化） */
  isDimmed?: boolean;
  /** 卡片根元素 ref（晋级图量测连线用） */
  cardRef?: (element: HTMLDivElement | null) => void;
  /** 槽位行 ref（晋级图量测连线用） */
  slotRef?: (side: 'a' | 'b', element: HTMLDivElement | null) => void;
}

/**
 * 系列赛对局卡片：晋级图与波次列表共用，两处内容与样式保持一致。
 * 槽位样式参照 bracket-reference：整行左侧 3px 状态色条 + 名称省略 + 比分块，
 * 胜者绿条绿字、败者红条置灰半透明红底比分（无删除线）、待定名称置灰。
 */
export function TournamentNodeCard({
  card,
  onSelectMatch,
  onForfeit,
  isActive,
  isDimmed,
  cardRef,
  slotRef,
}: TournamentNodeCardProps): React.ReactElement {
  function renderSlot(slot: BracketSlot, side: 'a' | 'b'): React.ReactElement {
    // 状态类与参考实现一致：tbd 待定 / won 胜者 / lost 败者（整行置灰半透明）
    const isLost = card.status === 'completed' && Boolean(slot.playerId) && !slot.isWinner;
    const className = [
      'bracket-row',
      !slot.playerId ? 'bracket-row-tbd' : '',
      slot.isWinner ? 'bracket-row-won' : '',
      isLost ? 'bracket-row-lost' : '',
    ].filter(Boolean).join(' ');
    return (
      <div
        className={className}
        key={side}
        ref={slotRef ? (element) => slotRef(side, element) : undefined}
      >
        <span className="bracket-row-name" title={slot.name || undefined}>
          {slot.name || '—'}
        </span>
        {slot.stateText ? <span className="bracket-row-state">{slot.stateText}</span> : null}
        <span className="bracket-row-score">{slot.score}</span>
      </div>
    );
  }

  return (
    <div
      className={`tournament-node-card bracket-card bracket-card-${card.status}${isActive ? ' bracket-card-active' : ''}${isDimmed ? ' bracket-card-dimmed' : ''}`}
      ref={cardRef}
    >
      <div className="bracket-card-head">
        <Tag color={STATUS_COLOR[card.status]}>{card.statusLabel}</Tag>
        {card.isCrossBucket ? <Tag color="orange">跨桶</Tag> : null}
        <Text type="secondary" className="bracket-card-id">{card.nodeId}</Text>
      </div>
      <div className="bracket-card-slots">
        {renderSlot(card.playerA, 'a')}
        {renderSlot(card.playerB, 'b')}
      </div>
      <Space className="tournament-node-actions">
        <Button
          size="small"
          disabled={!card.matchId}
          onClick={() => card.matchId && onSelectMatch(card.matchId)}
        >
          切换为当前比赛
        </Button>
        {onForfeit && card.canForfeit ? (
          <Button size="small" danger onClick={onForfeit}>
            弃权判负
          </Button>
        ) : null}
      </Space>
    </div>
  );
}

export default TournamentNodeCard;