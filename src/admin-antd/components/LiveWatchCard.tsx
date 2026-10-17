import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Tag, Typography, Upload } from 'antd';

import {
  describeWatchApply,
  formatWatchClock,
  formatWatchDuration,
  formatWatchRelative,
  getLiveWatchBadge,
  type LiveWatchSnapshot,
} from '../lib/live';

const { Text, Title } = Typography;

export interface LiveWatchCardProps {
  /** 是否正在监听（= App 的 liveConfigEnabled） */
  enabled: boolean;
  /** 读取 / 切换文件过程中（按钮 loading） */
  busy: boolean;
  /** 当前环境是否支持持续监听（桌面版才有 readTextFile / statFile） */
  supported: boolean;
  filePath: string | null;
  fileName: string;
  snapshot: LiveWatchSnapshot;
  /** 轮询心跳：App 每次检查文件前写入，本组件每秒自读一次用于相对时间，避免整个后台每秒重渲染 */
  heartbeat: { current: number };
  /** 上次成功监听的文件路径（localStorage 记忆），未监听时提供「恢复监听」 */
  rememberedPath: string;
  onToggle: () => void;
  onPickFile: () => void;
  onRestore: () => void;
  onForget: () => void;
  onUpload: (file: File) => boolean | Promise<boolean>;
}

/**
 * 「实时控制 → 监听目标 JSON」状态卡。
 *
 * 为什么要做得这么啰嗦：以前这块只有「监听中 / 未监听」两个词 + 文件名，选完文件后
 * 到底有没有在轮询、最近一次读到 / 回写是什么时候、出错没有全看不见；而轮询本身
 * 还因为闭包过期一直是死的（见 App.tsx 的 liveWatchRef 注释）。这里把「是否在监听」
 * 拆成状态标签 + 心跳（最近检查 x 秒前）+ 读写时间 + 最近同步结果，并让心跳每秒
 * 只重渲染这张卡，不动整个后台。
 */
export function LiveWatchCard(props: LiveWatchCardProps) {
  const { enabled, heartbeat, snapshot } = props;
  const [now, setNow] = useState(() => Date.now());

  // 只在监听中起秒表：状态标签的「监听停滞」判定与相对时间都依赖 now。
  // 秒表只在卡片内部 setState，App 的状态只在读 / 写 / 出错时更新，不会每秒重渲染整个后台。
  useEffect(() => {
    if (!enabled) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const badge = getLiveWatchBadge(enabled, Boolean(snapshot.error), heartbeat.current, now);

  return (
    <Card size="small" className="subtle-card live-watch-card">
      <Space direction="vertical" size={12} className="live-watch-body">
        <div className="live-watch-head">
          <Space size={10} wrap align="center">
            <Tag color={badge.color} className="live-watch-state-tag">{badge.text}</Tag>
            <div className="live-watch-file">
              <Text type="secondary">监听目标 JSON</Text>
              <Title level={5} className="live-watch-title">{props.fileName || '尚未选择文件'}</Title>
            </div>
          </Space>
          <Space size={8} wrap>
            {enabled ? (
              <Button size="small" onClick={props.onPickFile} loading={props.busy}>
                更换文件
              </Button>
            ) : null}
            <Button
              size="small"
              type={enabled ? 'default' : 'primary'}
              danger={enabled}
              loading={props.busy}
              onClick={props.onToggle}
            >
              {enabled ? '关闭监听' : '开启实时监听'}
            </Button>
          </Space>
        </div>

        {props.filePath ? (
          <Text
            type="secondary"
            className="live-watch-path"
            copyable={{ text: props.filePath, tooltips: ['复制路径', '已复制'] }}
            ellipsis={{ tooltip: props.filePath }}
          >
            {props.filePath}
          </Text>
        ) : (
          <Text type="secondary">还没有选择监听文件：点「开启实时监听」或把 JSON 拖到下方区域。</Text>
        )}

        {enabled ? (
          <>
            <Space size={[20, 6]} wrap className="live-watch-meta">
              <span>
                已监听 <Text strong>{formatWatchDuration(snapshot.startedAt, now)}</Text>
              </span>
              <span>
                最近检查{' '}
                <Text strong type={badge.stalled ? 'danger' : undefined}>
                  {formatWatchRelative(heartbeat.current, now)}
                </Text>
              </span>
              <span>
                最近回写 <Text strong>{snapshot.lastWriteAt ? formatWatchClock(snapshot.lastWriteAt) : '--'}</Text>
              </span>
            </Space>
            <Text type="secondary" className="live-watch-sync-line">
              最近同步：{describeWatchApply(snapshot.lastAppliedCount)}
              {snapshot.lastAppliedAt ? `（${formatWatchClock(snapshot.lastAppliedAt)}）` : ''} · 每 1 秒检查一次文件
            </Text>
          </>
        ) : null}

        {snapshot.error ? (
          <Alert
            type="error"
            showIcon
            message={snapshot.error}
            description={`${formatWatchClock(snapshot.errorAt)} · 监听仍在继续并每秒重试，文件恢复可读后这条提示会自动消失。`}
          />
        ) : null}

        {!enabled && props.rememberedPath ? (
          <div className="live-watch-remembered">
            <Text type="secondary" ellipsis={{ tooltip: props.rememberedPath }}>
              上次监听：{props.rememberedPath}
            </Text>
            <Space size={8}>
              <Button size="small" type="primary" ghost onClick={props.onRestore} loading={props.busy} disabled={!props.supported}>
                恢复监听
              </Button>
              <Button size="small" type="text" onClick={props.onForget}>
                清除记录
              </Button>
            </Space>
          </div>
        ) : null}

        {!props.supported ? (
          <Alert
            type="warning"
            showIcon
            message="当前环境不支持持续监听"
            description="实时监听依赖桌面版的本地文件读写；浏览器里只能手动上传一次 JSON 应用到面板。"
          />
        ) : null}

        <Upload.Dragger
          accept=".json,application/json"
          showUploadList={false}
          className="live-watch-uploader"
          beforeUpload={(file) => props.onUpload(file)}
        >
          <p className="ant-upload-text">{enabled ? '拖入新的 JSON 可切换监听文件' : '选择或拖拽监听 JSON'}</p>
          <p className="ant-upload-hint">监听开启后每秒检查一次该文件，按精灵名匹配 HP / 能量并回写当前数值。</p>
        </Upload.Dragger>
      </Space>
    </Card>
  );
}
