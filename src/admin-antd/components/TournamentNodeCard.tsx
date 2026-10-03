import React from 'react';
import { Button, Dropdown, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { formatWinnerActionLabel } from '../lib/match-actions';
import type { BracketCard, BracketSlot } from '../lib/tournament';

const { Text } = Typography;

const STATUS_COLOR: Record<BracketCard['status'], string> = {
  completed: 'success',
  in_progress: 'processing',
  pending: 'default',
};

/** 登记 / 撤回闸门（云同步未指派、已确认禁撤回时给出中文原因） */
export interface CardActionGate {
  allowed: boolean;
  reason: string;
}

/** 卡片菜单的可用性：判据由父级算好（卡片只有 BracketCard，拿不到 games / activeMatchId） */
export interface TournamentNodeMenuState {
  /** 该场是否就是「当前比赛」（推流画面正在展示的那一场） */
  isCurrent: boolean;
  canStart: boolean;
  canRegister: boolean;
  canUndo: boolean;
  canRedo: boolean;
  registerGate: CardActionGate;
  undoGate: CardActionGate;
}

/**
 * 卡片菜单三件套（晋级图 / 波次列表逐层透传用）：
 * menuFor 按 matchId 算出该卡的可用性，两个回调负责打开面板与执行动作。
 */
export interface TournamentCardMenuHandlers {
  menuFor(matchId: string | null): TournamentNodeMenuState | undefined;
  onOpenPanel(matchId: string): void;
  onRunAction(matchId: string, action: 'start' | 'undo' | 'redo' | 'winner', extra?: Record<string, unknown>): void;
}

export interface TournamentNodeCardProps {
  card: BracketCard;
  onSelectMatch(matchId: string): void;
  /** 查看阵容详情（晋级图与波次列表共用入口，由父级打开弹窗；未建场时禁用） */
  onViewLineup?(matchId: string): void;
  onForfeit?(): void;
  /** 右键 / 「⋯」菜单的可用性；未传则不显示菜单入口 */
  menu?: TournamentNodeMenuState;
  /** 打开该场的 Drawer 面板 */
  onOpenPanel?(matchId: string): void;
  /** 菜单里的流程动作（headless：服务端按 matchId 工作，不必先切当前比赛） */
  onRunAction?(matchId: string, action: 'start' | 'undo' | 'redo' | 'winner', extra?: Record<string, unknown>): void;
  /** 晋级图选中态（显示该场连线时高亮卡片） */
  isActive?: boolean;
  /** 晋级图单人链路选中态：高亮对应选手槽位行（null / 未传 = 未选中单人） */
  activeSide?: 'a' | 'b' | null;
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
 *
 * 右键卡片任意位置直接打开对局面板（Drawer，连续登记多场的关键）；点右上「⋯」弹菜单，
 * 胜负项文案用选手名（小明赢了），不可用项置灰并在右侧写原因，避免点了才知道不能做。
 */
export function TournamentNodeCard({
  card,
  onSelectMatch,
  onViewLineup,
  onForfeit,
  menu,
  onOpenPanel,
  onRunAction,
  isActive,
  activeSide,
  isDimmed,
  cardRef,
  slotRef,
}: TournamentNodeCardProps): React.ReactElement {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const matchId = card.matchId;
  const winnerDisabled = (): boolean => !matchId || !menu || !menu.canRegister || !menu.registerGate.allowed;
  const registerHint = (): string | undefined => {
    if (!menu) {
      return undefined;
    }
    if (!menu.registerGate.allowed) {
      return menu.registerGate.reason;
    }
    return menu.canRegister ? undefined : '当前小局未开始';
  };
  const undoHint = (): string | undefined => {
    if (!menu) {
      return undefined;
    }
    if (!menu.undoGate.allowed) {
      return menu.undoGate.reason;
    }
    return menu.canUndo ? undefined : '没有可撤回的操作';
  };

  const menuItems: MenuProps['items'] = menu ? [
    { key: 'panel', label: '打开比赛面板' },
    { key: 'divider-1', type: 'divider' },
    {
      key: 'winner-left',
      label: formatWinnerActionLabel('left', card.playerA.name),
      disabled: winnerDisabled(),
      extra: registerHint(),
    },
    {
      key: 'winner-right',
      label: formatWinnerActionLabel('right', card.playerB.name),
      disabled: winnerDisabled(),
      extra: registerHint(),
    },
    {
      key: 'start',
      label: '开始本次对局',
      disabled: !matchId || !menu.canStart,
      extra: menu.canStart ? undefined : '双方阵容未录完',
    },
    {
      key: 'undo',
      label: '撤回上一步',
      disabled: !matchId || !menu.canUndo || !menu.undoGate.allowed,
      extra: undoHint(),
    },
    {
      key: 'redo',
      label: '取消撤回',
      disabled: !matchId || !menu.canRedo,
    },
    { key: 'divider-2', type: 'divider' },
    { key: 'lineup', label: '查看阵容', disabled: !matchId || !onViewLineup },
    ...(onForfeit && card.canForfeit
      ? [{ key: 'forfeit', label: '弃权判负', danger: true }]
      : []),
    { key: 'manage', label: '进入管理', extra: menu.isCurrent ? '已是当前比赛' : undefined },
  ] : [];

  function handleMenuClick({ key }: { key: string }): void {
    setMoreOpen(false);
    if (!matchId) {
      return;
    }
    switch (key) {
      case 'panel':
        onOpenPanel?.(matchId);
        return;
      case 'winner-left':
        onRunAction?.(matchId, 'winner', { winner: 'left' });
        return;
      case 'winner-right':
        onRunAction?.(matchId, 'winner', { winner: 'right' });
        return;
      case 'start':
        onRunAction?.(matchId, 'start');
        return;
      case 'undo':
        onRunAction?.(matchId, 'undo');
        return;
      case 'redo':
        onRunAction?.(matchId, 'redo');
        return;
      case 'lineup':
        onViewLineup?.(matchId);
        return;
      case 'forfeit':
        onForfeit?.();
        return;
      default:
        onSelectMatch(matchId);
    }
  }

  function renderSlot(slot: BracketSlot, side: 'a' | 'b'): React.ReactElement {
    // 状态类与参考实现一致：tbd 待定 / won 胜者 / lost 败者（整行置灰半透明）
    const isLost = card.status === 'completed' && Boolean(slot.playerId) && !slot.isWinner;
    const className = [
      'bracket-row',
      !slot.playerId ? 'bracket-row-tbd' : '',
      slot.isWinner ? 'bracket-row-won' : '',
      isLost ? 'bracket-row-lost' : '',
      activeSide === side ? 'bracket-row-active' : '',
    ].filter(Boolean).join(' ');
    return (
      <div
        className={className}
        key={side}
        data-side={side}
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

  const cardBody = (
    <div
      className={`tournament-node-card bracket-card bracket-card-${card.status}${isActive ? ' bracket-card-active' : ''}${isDimmed ? ' bracket-card-dimmed' : ''}`}
      ref={cardRef}
      // 新手引导锚点：讲「右键打开面板 / ⋯ 菜单 / 弃权」都指向它（每张卡片都有，Tour 取第一个即可）
      data-tour="tournament-node-card"
      // 右键卡片任意位置 = 直接打开对局面板（Drawer）；菜单走右上「⋯」按钮，不再在这里弹菜单
      onContextMenu={(event) => {
        if (menu && matchId && onOpenPanel) {
          event.preventDefault();
          onOpenPanel(matchId);
        }
      }}
    >
      <div className="bracket-card-head">
        <Tag color={STATUS_COLOR[card.status]}>{card.statusLabel}</Tag>
        {card.isCrossBucket ? <Tag color="orange">跨桶</Tag> : null}
        <Text type="secondary" className="bracket-card-id">{card.nodeId}</Text>
        {menu && matchId ? (
          <Dropdown
            menu={{ items: menuItems, onClick: handleMenuClick }}
            open={moreOpen}
            onOpenChange={setMoreOpen}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button
              size="small"
              type="text"
              className="bracket-card-more"
              // 「⋯」不应该同时触发卡片的选中态
              onClick={(event) => event.stopPropagation()}
            >
              ⋯
            </Button>
          </Dropdown>
        ) : null}
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
          进入管理
        </Button>
        <Button
          size="small"
          disabled={!card.matchId}
          onClick={() => card.matchId && onViewLineup?.(card.matchId)}
        >
          查看阵容
        </Button>
        {onForfeit && card.canForfeit ? (
          <Button size="small" danger onClick={onForfeit}>
            弃权判负
          </Button>
        ) : null}
      </Space>
    </div>
  );

  // 不包 Dropdown（右键行为见根 div onContextMenu）；cardRef 留在卡片本体上，晋级图连线量测不受影响
  return cardBody;
}

export default TournamentNodeCard;
