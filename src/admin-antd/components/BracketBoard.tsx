import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Empty, Modal, Space, Tag, Typography } from 'antd';
import type { MatchRecord, TournamentNode, TournamentRecord } from '../../../shared/types';
import { buildBracketGraph } from '../lib/tournament';
import type { BracketCard, BracketColumn, BracketSlot } from '../lib/tournament';
import { forfeitApi } from '../lib/tournament-api';
import { TournamentNodeCard } from './TournamentNodeCard';

const { Text } = Typography;

/** 一根入场连线（从来源节点的对应槽位指向目标节点的对应槽位） */
interface BracketWire {
  key: string;
  /** w = 胜者实线；l = 败者虚线 */
  kind: 'w' | 'l';
  /** SVG 正交折线路径 */
  d: string;
}

export interface BracketBoardProps {
  record: TournamentRecord;
  names: Map<string, string>;
  matches: MatchRecord[];
  onSelectMatch(matchId: string): Promise<void>;
}

/** 槽位 ref key：`${nodeId}#a` / `${nodeId}#b` */
function slotKey(nodeId: string, side: 'a' | 'b'): string {
  return `${nodeId}#${side}`;
}

/**
 * 系列赛晋级图：双败按战绩桶拆列（胜者组/败者组 R1、R2），单败一阶段一列，节点即卡片，
 * 列间按「胜者实线 / 败者虚线」画晋级连线。槽位样式参照 bracket-reference：
 * 败者 = 左侧红条 + 文字置灰 + 半透明 + 比分块红底白字（无删除线）。
 * 连线坐标由真实 DOM 量测（getBoundingClientRect）后绘制，布局变化自动重算。
 */
export function BracketBoard({
  record,
  names,
  matches,
  onSelectMatch,
}: BracketBoardProps): React.ReactElement {
  const { message } = App.useApp();
  const graph = useMemo(
    () => buildBracketGraph(record, names, matches),
    [record, names, matches],
  );
  const cardIndex = useMemo(() => {
    const map = new Map<string, BracketCard>();
    graph.columns.forEach((column) => column.cards.forEach((card) => map.set(card.nodeId, card)));
    return map;
  }, [graph]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const [wires, setWires] = useState<BracketWire[]>([]);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [forfeitNode, setForfeitNode] = useState<TournamentNode | null>(null);
  /** 当前选中的卡片：仅显示与它相关的连线，避免整图连线交叉杂乱（null = 不显示任何连线） */
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const registerCard = useCallback((key: string, element: HTMLDivElement | null) => {
    if (element) {
      cardRefs.current.set(key, element);
    } else {
      cardRefs.current.delete(key);
    }
  }, []);

  const registerSlot = useCallback((key: string, element: HTMLDivElement | null) => {
    if (element) {
      slotRefs.current.set(key, element);
    } else {
      slotRefs.current.delete(key);
    }
  }, []);

  /**
   * 选中卡片时高亮的连线：上游链路（沿 slot.from 递归全部祖先）+ 从它出发的下游连线。
   * 连线 key 形如 `${来源nodeId}->${目标nodeId}#${来源槽位}`，这里按 `${来源}->${目标}` 去重匹配。
   */
  const activeEdges = useMemo(() => {
    if (!activeNodeId) {
      return null;
    }
    const edges = new Set<string>();
    const seen = new Set<string>();
    const walkUpstream = (nodeId: string): void => {
      if (seen.has(nodeId)) {
        return;
      }
      seen.add(nodeId);
      const card = cardIndex.get(nodeId);
      if (!card) {
        return;
      }
      [card.playerA, card.playerB].forEach((slot) => {
        if (!slot.from) {
          return;
        }
        edges.add(`${slot.from.nodeId}->${nodeId}`);
        walkUpstream(slot.from.nodeId);
      });
    };
    walkUpstream(activeNodeId);
    wires.forEach((wire) => {
      if (wire.key.startsWith(`${activeNodeId}->`)) {
        edges.add(wire.key.slice(0, wire.key.indexOf('#')));
      }
    });
    return edges;
  }, [activeNodeId, cardIndex, wires]);

  /** 量测各节点/槽位真实位置，重算连线与画布尺寸 */
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const base = scroller.getBoundingClientRect();
    const next: BracketWire[] = [];

    graph.columns.forEach((column) => {
      column.cards.forEach((card) => {
        const slots: Array<{ slot: BracketSlot; side: 'a' | 'b' }> = [
          { slot: card.playerA, side: 'a' },
          { slot: card.playerB, side: 'b' },
        ];
        slots.forEach(({ slot, side }) => {
          if (!slot.from) {
            return;
          }
          const toCard = cardRefs.current.get(card.nodeId);
          const toSlot = slotRefs.current.get(slotKey(card.nodeId, side));
          if (!toCard || !toSlot) {
            return;
          }
          // 来源：上游节点卡片右边缘 + 该选手所在槽位的垂直中点
          const fromCard = cardRefs.current.get(slot.from.nodeId);
          const fromCardData = cardIndex.get(slot.from.nodeId);
          const fromSide: 'a' | 'b' = fromCardData?.playerA.playerId === slot.playerId ? 'a' : 'b';
          const fromSlot = slotRefs.current.get(slotKey(slot.from.nodeId, fromSide));
          if (!fromCard || !fromSlot) {
            return;
          }

          const fromCardRect = fromCard.getBoundingClientRect();
          const fromSlotRect = fromSlot.getBoundingClientRect();
          const toCardRect = toCard.getBoundingClientRect();
          const toSlotRect = toSlot.getBoundingClientRect();

          const x1 = Math.round(fromCardRect.right - base.left);
          const y1 = Math.round(fromSlotRect.top + fromSlotRect.height / 2 - base.top);
          const x2 = Math.round(toCardRect.left - base.left);
          const y2 = Math.round(toSlotRect.top + toSlotRect.height / 2 - base.top);
          const midX = Math.round((x1 + x2) / 2);

          next.push({
            key: `${slot.from.nodeId}->${card.nodeId}#${fromSide}`,
            kind: slot.from.kind,
            d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
          });
        });
      });
    });

    setWires(next);
    setCanvas({ width: scroller.scrollWidth, height: scroller.scrollHeight });
  }, [cardIndex, graph]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const columns = columnsRef.current;
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => measure());
    if (scroller) {
      observer.observe(scroller);
    }
    if (columns) {
      observer.observe(columns);
    }
    return () => observer.disconnect();
  }, [measure]);

  async function handleForfeit(node: TournamentNode, loserSide: 'left' | 'right'): Promise<void> {
    if (!node.matchId) {
      return;
    }
    try {
      await forfeitApi(record.id, node.matchId, loserSide);
      message.success('已按弃权判负');
      setForfeitNode(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  /** 从记录里取回节点原对象（弃权接口需要 matchId 与选手信息） */
  function resolveNode(column: BracketColumn, nodeId: string): TournamentNode | null {
    const wave = record.waves.find(
      (item) => item.stageIndex === column.stageIndex && item.waveIndex === column.waveIndex,
    );
    return wave?.nodes.find((node) => node.id === nodeId) ?? null;
  }

  function renderCard(card: BracketCard, column: BracketColumn): React.ReactElement {
    return (
      <div
        className="bracket-card-hitbox"
        key={card.nodeId}
        onClick={(event) => {
          // 卡片内按钮（切换为当前比赛 / 弃权判负）不触发选中
          if ((event.target as HTMLElement).closest('button')) {
            return;
          }
          setActiveNodeId((current) => (current === card.nodeId ? null : card.nodeId));
        }}
      >
        <TournamentNodeCard
          card={card}
          isActive={activeNodeId === card.nodeId}
          cardRef={(element) => registerCard(card.nodeId, element)}
          slotRef={(side, element) => registerSlot(slotKey(card.nodeId, side), element)}
          onSelectMatch={(matchId) => void onSelectMatch(matchId)}
          onForfeit={() => setForfeitNode(resolveNode(column, card.nodeId))}
        />
      </div>
    );
  }

  if (graph.columns.length === 0) {
    return <Empty className="bracket-board-empty" description="尚未产生对阵（开赛后生成首波）" />;
  }

  return (
    <div
      className="bracket-board"
      onClick={(event) => {
        // 点击卡片以外区域取消选中（隐藏全部连线）
        if ((event.target as HTMLElement).closest('.bracket-card-hitbox')) {
          return;
        }
        setActiveNodeId(null);
      }}
    >
      <div className="bracket-board-legend">
        <Text type="secondary">
          <i className="bracket-wire-sample bracket-wire-sample-winner" />
          胜者晋级
          <i className="bracket-wire-sample bracket-wire-sample-loser" />
          败者下沉
          <span className="bracket-legend-hint">（点击卡片查看该场的晋级连线）</span>
        </Text>
        <Text type="secondary">
          已结束 {graph.completedCount} / 共 {graph.cardCount} 场
        </Text>
      </div>

      <div className="bracket-board-scroller" ref={scrollerRef}>
        <svg
          className="bracket-board-wires"
          width={canvas.width}
          height={canvas.height}
          aria-hidden="true"
        >
          {wires
            .filter((wire) => activeEdges?.has(wire.key.slice(0, wire.key.indexOf('#'))))
            .map((wire) => (
              <path
                key={wire.key}
                d={wire.d}
                fill="none"
                stroke={wire.kind === 'w' ? '#2d7a58' : '#c24635'}
                strokeWidth={wire.kind === 'w' ? 2.4 : 2}
                strokeDasharray={wire.kind === 'w' ? undefined : '5 4'}
              />
            ))}
        </svg>

        <div className="bracket-board-columns" ref={columnsRef}>
          {graph.columns.map((column) => (
            <div className="bracket-column" key={column.key}>
              <div className="bracket-column-head">
                <div className="bracket-column-title">
                  {column.label}
                  <Text type="secondary" className="bracket-column-wave">
                    {column.formatLabel}
                  </Text>
                </div>
                <Space size={4} wrap>
                  <Tag color={
                    column.status === 'completed'
                      ? 'success'
                      : column.status === 'running'
                        ? 'processing'
                        : 'default'
                  }>
                    {column.statusLabel}
                  </Tag>
                </Space>
              </div>

              <div className="bracket-column-body">
                {column.pairingStatus === 'draft' ? (
                  <div className="bracket-draft">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      配对草稿（未建场），请到「波次列表」完成配对确认
                    </Text>
                    {column.draftPairs.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>暂无候选配对</Text>
                    ) : column.draftPairs.map((pair, index) => (
                      <div className="bracket-draft-row" key={`${pair.a}-${pair.b}-${index}`}>
                        <span>{pair.a || '待定'}</span>
                        <Text type="secondary">vs</Text>
                        <span>{pair.b || '待定'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  column.cards.map((card) => renderCard(card, column))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal
        title="弃权判负"
        open={forfeitNode !== null}
        onCancel={() => setForfeitNode(null)}
        footer={null}
      >
        {forfeitNode ? (
          <Space orientation="vertical">
            <Text>选择弃权（判负）方：</Text>
            <Space wrap>
              <Button
                danger
                onClick={() => forfeitNode && void handleForfeit(forfeitNode, 'left')}
              >
                左侧弃权
              </Button>
              <Button
                danger
                onClick={() => forfeitNode && void handleForfeit(forfeitNode, 'right')}
              >
                右侧弃权
              </Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              仅未开始的比赛可弃权；系统按决胜局数补比分并标注「弃权」。
            </Text>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}

export default BracketBoard;