import React, { type ReactNode } from 'react';

/**
 * 12px 次要说明文字（Hint）。
 *
 * 取代原先散落各处的 `Text type="secondary" style={{ fontSize: 12 }}`：
 * 那一版有 4 种灰、3 种字号，其中 #999 / #8a7a66 / #b6a692 的对比度只有 3.3 / 3.85 / 2.19。
 * 样式定义在 tokens.css 的 .roco-hint（12px / 1.6 行高 / rgba(0,0,0,.55) = 4.67:1）。
 */
export function Hint({
  children,
  block = false,
  className,
}: {
  children: ReactNode;
  block?: boolean;
  className?: string;
}) {
  const classes = ['roco-hint', block ? 'is-block' : '', className].filter(Boolean).join(' ');
  return <span className={classes}>{children}</span>;
}
