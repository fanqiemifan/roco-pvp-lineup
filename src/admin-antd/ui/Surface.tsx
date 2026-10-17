import React, { type CSSProperties, type ReactNode } from 'react';

/**
 * 带边的容器（卡片面）。
 *
 * 原先 27 个类各自写 border + border-radius + background，圆角落在 8/10/12/14/16 上，
 * 想统一调一次都做不到。这里只保留四种语义：
 * - card      带标题/内容的卡片（白底、描边、浮起）
 * - inset     卡片内部的浅色分区（无描边、淡底）
 * - dashed    提示条/空槽位（虚线描边、透明底）
 * - highlight 当前比赛等需要强调的一行（品牌浅底 + 品牌描边）
 *
 * 尺寸与布局（padding/grid/flex）仍由调用方的 className 负责，Surface 只管「面」。
 */
export type SurfaceTone = 'card' | 'inset' | 'dashed' | 'highlight';

export function Surface({
  tone = 'card',
  className,
  style,
  children,
}: {
  tone?: SurfaceTone;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const classes = ['roco-surface', `roco-surface--${tone}`, className].filter(Boolean).join(' ');
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}
