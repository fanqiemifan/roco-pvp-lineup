import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Empty, Modal, Space, Tag, Typography } from 'antd';
import type { MatchRecord, TournamentNode, TournamentRecord } from '../../../shared/types';
import { buildBracketGraph, getStageState } from '../lib/tournament';
import type { BracketCard, BracketColumn, BracketSlot } from '../lib/tournament';
import { forfeitApi } from '../lib/tournament-api';
import { TournamentNodeCard } from './TournamentNodeCard';

const { Text } = Typography;

/** 拖动平移的启动阈值（px）：位移小于它按点击处理，避免点卡片时误触发平移 */
const PAN_DRAG_THRESHOLD = 4;

/** 阶段分组底色轮换数（与 styles.css 的 .bracket-stage-group-0..4 一一对应） */
const STAGE_TINT_COUNT = 5;

/** 阶段状态文案与配色（分组头右侧 Tag；口径与上方 Steps 的阶段进度一致） */
const STAGE_STATE_META: Record<'done' | 'current' | 'pending', { label: string; color: string }> = {
  done: { label: '已完成', color: 'success' },
  current: { label: '进行中', color: 'processing' },
  pending: { label: '未开始', color: 'default' },
};

/** 拖动平移过程状态（按住拖动 → 改滚动容器的 scrollLeft/scrollTop） */
interface PanDragState {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  /** 是否已越过阈值进入真正的拖动 */
  moved: boolean;
}

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
  /** 只读副本（系列赛由另一台机器编排）：隐藏弃权操作 */
  readOnly?: boolean;
}

/** 槽位 ref key：`${nodeId}#a` / `${nodeId}#b` */
function slotKey(nodeId: string, side: 'a' | 'b'): string {
  return `${nodeId}#${side}`;
}

/**
 * 系列赛晋级图：双败按战绩桶拆列（胜者组/败者组 R1、R2），单败一阶段一列，节点即卡片，
 * 列间按「胜者实线 / 败者虚线」画晋级连线。槽位样式参照 bracket-reference：
 * 败者 = 左侧红条 + 文字置灰 + 半透明 + 比分块红底白字（无删除线）。
 * 同一阶段的列包进一个带阶段横幅的淡色区块（相邻阶段轮换底色），
 * 仅凭「胜者组 R2」这类各阶段重名的轮次文案也能定位所属阶段。
 * 连线坐标由真实 DOM 量测（getBoundingClientRect）后绘制，布局变化自动重算。
 */
export function BracketBoard({
  record,
  names,
  matches,
  onSelectMatch,
  readOnly = false,
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

  /**
   * 按阶段把列分组：列已按阶段升序排列，同一阶段的相邻列（双败按桶拆出的
   * 胜者组 R1 → 败者组 R1 → 胜者组 R2 → 败者组 R2）合成一个区块，单败一阶段一组。
   */
  const stageGroups = useMemo(() => {
    const groups: Array<{ stageIndex: number; columns: BracketColumn[] }> = [];
    graph.columns.forEach((column) => {
      const last = groups[groups.length - 1];
      if (last && last.stageIndex === column.stageIndex) {
        last.columns.push(column);
      } else {
        groups.push({ stageIndex: column.stageIndex, columns: [column] });
      }
    });
    return groups;
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
  /** 拖动平移状态（用于切换 grab/grabbing 光标与拖动中禁选文本） */
  const [panning, setPanning] = useState(false);
  const panDragRef = useRef<PanDragState | null>(null);
  /** 刚结束一次拖动 → 抑制紧随其后的 click，避免拖动被当成卡片点击 */
  const suppressClickRef = useRef(false);

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

  /**
   * 选中卡片时保持正常亮度的节点集合（选中卡片 + 全部祖先 + 其下游一场），其余卡片压暗。
   * 直接由 activeEdges 的 `上游->下游` 两端推导，与连线高亮范围完全一致。
   */
  const relatedNodeIds = useMemo(() => {
    if (!activeNodeId || !activeEdges) {
      return null;
    }
    const ids = new Set<string>([activeNodeId]);
    activeEdges.forEach((edge) => {
      const separator = edge.indexOf('->');
      if (separator === -1) {
        return;
      }
      ids.add(edge.slice(0, separator));
      ids.add(edge.slice(separator + 2));
    });
    return ids;
  }, [activeEdges, activeNodeId]);

  /** 量测各节点/槽位真实位置，重算连线与画布尺寸 */
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const base = scroller.getBoundingClientRect();
    // 连线 SVG 绝对定位在滚动容器内、随内容一起滚动，因此要量到「内容坐标系」：
    // 必须补上 scrollLeft/scrollTop，否则在横向滚动状态下重算（窗口 resize、数据更新、
    // 点击卡片等）会让所有连线整体偏移一个 scrollLeft。
    const offsetX = scroller.scrollLeft;
    const offsetY = scroller.scrollTop;
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

          const x1 = Math.round(fromCardRect.right - base.left + offsetX);
          const y1 = Math.round(fromSlotRect.top + fromSlotRect.height / 2 - base.top + offsetY);
          const x2 = Math.round(toCardRect.left - base.left + offsetX);
          const y2 = Math.round(toSlotRect.top + toSlotRect.height / 2 - base.top + offsetY);
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

  // 兜底重算：卡片里的 Tag / 文本换行、字体加载会让高度在首帧之后才稳定，
  // 而 ResizeObserver 只在「尺寸变化」时触发（仅位置偏移不触发）。这里在首帧后
  // 再补两帧、并在字体就绪后再各量一次，避免首帧量到中间态导致连线错位或缺失。
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const remeasure = (): void => {
      if (!cancelled) {
        measure();
      }
    };
    // 首帧后再连续补两帧
    const remeasureAcrossFrames = (): void => {
      remeasure();
      raf = window.requestAnimationFrame(remeasure);
    };
    raf = window.requestAnimationFrame(remeasureAcrossFrames);
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(remeasure);
    }
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [measure]);

  /* ---------- 拖动平移（按住鼠标拖动移动晋级图位置） ---------- */

  function handleScrollerPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    // 新一轮交互开始：清掉上一次拖动遗留的点击抑制标记
    suppressClickRef.current = false;
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scroller.scrollLeft,
      startScrollTop: scroller.scrollTop,
      moved: false,
    };
  }

  function handleScrollerPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = panDragRef.current;
    const scroller = scrollerRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < PAN_DRAG_THRESHOLD) {
        return;
      }
      drag.moved = true;
      setPanning(true);
      // 越过阈值后才捕获指针：普通点击不被捕获（捕获会把随后的 click 重定向到容器，卡片就选不中了）
      event.currentTarget.setPointerCapture(event.pointerId);
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    scroller.scrollLeft = drag.startScrollLeft - dx;
    scroller.scrollTop = drag.startScrollTop - dy;
  }

  function handleScrollerPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    panDragRef.current = null;
    if (!drag.moved) {
      return;
    }
    suppressClickRef.current = true;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /** 拖动刚结束时的 click 直接吞掉（拖动手势不应改变卡片选中态） */
  function consumeSuppressedClick(): boolean {
    if (!suppressClickRef.current) {
      return false;
    }
    suppressClickRef.current = false;
    return true;
  }

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
          // 拖动平移后的 click 不改变选中态
          if (consumeSuppressedClick()) {
            return;
          }
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
          isDimmed={relatedNodeIds !== null && !relatedNodeIds.has(card.nodeId)}
          cardRef={(element) => registerCard(card.nodeId, element)}
          slotRef={(side, element) => registerSlot(slotKey(card.nodeId, side), element)}
          onSelectMatch={(matchId) => void onSelectMatch(matchId)}
          onForfeit={readOnly ? undefined : () => setForfeitNode(resolveNode(column, card.nodeId))}
        />
      </div>
    );
  }

  /** 一列 = 一波（双败再按桶细分）；列头只留轮次名与波状态，阶段信息统一由分组头承载 */
  function renderColumn(column: BracketColumn): React.ReactElement {
    return (
      <div className="bracket-column" key={column.key}>
        <div className="bracket-column-head">
          {column.label ? <div className="bracket-column-title">{column.label}</div> : null}
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
    );
  }

  if (graph.columns.length === 0) {
    return <Empty className="bracket-board-empty" description="尚未产生对阵（开赛后生成首波）" />;
  }

  return (
    <div
      className="bracket-board"
      onClick={(event) => {
        // 拖动平移后的 click 不改变选中态
        if (consumeSuppressedClick()) {
          return;
        }
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
          <span className="bracket-legend-hint">（点击卡片查看该场的晋级连线；按住拖动可平移视图）</span>
        </Text>
        <Text type="secondary">
          已结束 {graph.completedCount} / 共 {graph.cardCount} 场
        </Text>
      </div>

      <div
        className={`bracket-board-scroller${panning ? ' is-dragging' : ''}`}
        ref={scrollerRef}
        onPointerDown={handleScrollerPointerDown}
        onPointerMove={handleScrollerPointerMove}
        onPointerUp={handleScrollerPointerUp}
        onPointerCancel={handleScrollerPointerUp}
      >
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
          {stageGroups.map((group) => {
            const stage = record.stages[group.stageIndex];
            const stageState = STAGE_STATE_META[getStageState(record, group.stageIndex)];
            return (
              <section
                className={`bracket-stage-group bracket-stage-group-${group.stageIndex % STAGE_TINT_COUNT}`}
                key={`stage-${group.stageIndex}`}
              >
                <div className="bracket-stage-head">
                  <span className="bracket-stage-index">{group.stageIndex + 1}</span>
                  <span className="bracket-stage-title">{group.columns[0].stageName}</span>
                  <Text type="secondary" className="bracket-stage-meta">
                    {group.columns[0].formatLabel}
                    {stage ? ` · BO${stage.bestOf}` : ''}
                  </Text>
                  <Tag className="bracket-stage-status" color={stageState.color}>
                    {stageState.label}
                  </Tag>
                </div>
                <div className="bracket-stage-columns">
                  {group.columns.map((column) => renderColumn(column))}
                </div>
              </section>
            );
          })}
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