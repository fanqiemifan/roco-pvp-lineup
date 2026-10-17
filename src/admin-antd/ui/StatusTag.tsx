import React from 'react';
import { Tag } from 'antd';

import type { MatchRecord } from '../../../shared/types';
import { getMatchStatusMeta } from '../lib/status';

/**
 * 比赛状态 Tag：文案与颜色都取自 lib/status.ts 的唯一映射。
 *
 * 取代 `<Tag color={getMatchStatusColor(x)}>{getMatchStatusLabel(x)}</Tag>` 这种重复写法——
 * 以前每个视图各拼一次，改一个状态要满仓库搜。
 */
export function MatchStatusTag({
  status,
  fallback = '—',
}: {
  status: MatchRecord['status'] | null | undefined;
  fallback?: string;
}) {
  if (!status) {
    return <Tag color="default">{fallback}</Tag>;
  }
  const meta = getMatchStatusMeta(status);
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
