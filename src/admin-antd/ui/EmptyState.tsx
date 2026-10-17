import React, { type ReactNode } from 'react';
import { Empty } from 'antd';

import { Hint } from './Hint';

/**
 * 空态。
 *
 * 原先 14 处 `<Empty description="...">` 各写各的：插图有大有小、文案没有层级、也没有出路。
 * 这里固定成「图标 / 标题 / 说明 / 可选动作」四段，视觉统一，动作由调用方决定。
 */
export function EmptyState({
  title,
  hint,
  action,
  image = 'simple',
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  /** simple = 小图标（默认，列表/面板内通用）；default = antd 大插图（整页空态） */
  image?: 'simple' | 'default';
  className?: string;
}) {
  const classes = ['roco-empty', className].filter(Boolean).join(' ');
  return (
    <Empty
      className={classes}
      image={image === 'simple' ? Empty.PRESENTED_IMAGE_SIMPLE : undefined}
      description={
        <div className="roco-empty-body">
          <div className="roco-empty-title">{title}</div>
          {hint ? <Hint>{hint}</Hint> : null}
          {action ? <div className="roco-empty-action">{action}</div> : null}
        </div>
      }
    />
  );
}
