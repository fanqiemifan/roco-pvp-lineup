import React, { useEffect, useRef, useState } from 'react';
import { App, Button, Card, Space, Tooltip, Typography } from 'antd';

import { PAGE8_MAX_MATCHES } from '../constants';
import {
  PREVIEW_NAV_GROUPS,
  buildPreviewUrl,
  getLocalAddressText,
  getPreviewNavLabel,
} from '../lib/preview';
import { copyText } from '../lib/request';
import type { PreviewSlotKey } from '../types';

const { Paragraph } = Typography;

/**
 * 页面预览（M3 从 App.tsx 拆出）：预览槽位、缩放壳尺寸都是本视图 UI 状态；
 * 离开视图再回来会回到默认槽位（服务端推流画面不受影响）。
 */
export function PreviewView(): React.ReactElement {
  const { message } = App.useApp();
  const [previewSlot, setPreviewSlot] = useState<PreviewSlotKey>('stage');
  const [previewScale, setPreviewScale] = useState(1);
  const [previewShellSize, setPreviewShellSize] = useState({ width: 960, height: 540 });
  const previewFrameShellRef = useRef<HTMLDivElement | null>(null);

  async function handleCopyLocalAddress() {
    try {
      await copyText(getLocalAddressText(previewSlot));
      message.success('本地地址已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  async function handleCopyPreviewLink() {
    try {
      await copyText(buildPreviewUrl(previewSlot));
      message.success('预览链接已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }

  useEffect(() => {
    const shell = previewFrameShellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updatePreviewLayout = () => {
      const rect = shell.getBoundingClientRect();
      const availableHeight = Math.max(320, Math.floor(window.innerHeight - rect.top - 24));
      const availableWidth = shell.clientWidth;

      if (!availableWidth || !availableHeight) {
        return;
      }

      const nextScale = Math.min(availableWidth / 1920, availableHeight / 1080, 1);
      const nextWidth = Math.floor(1920 * nextScale);
      const nextHeight = Math.floor(1080 * nextScale);

      setPreviewShellSize({ width: nextWidth, height: nextHeight });
      setPreviewScale(nextScale > 0 ? nextScale : 1);
    };

    updatePreviewLayout();
    const observer = new ResizeObserver(() => updatePreviewLayout());
    observer.observe(shell);
    window.addEventListener('resize', updatePreviewLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePreviewLayout);
    };
  }, [previewSlot]);

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card
        className="preview-page-card"
        title={getPreviewNavLabel(previewSlot)}
        extra={<Button type="primary" href={buildPreviewUrl(previewSlot)} target="_blank">新窗口打开</Button>}
      >
        <div className="preview-layout">
          {/* 左侧分组导航：18 个预览槽位全部列出，超高在本列内滚动，不再像原来那排 Segmented 被裁掉 */}
          <nav className="preview-nav" aria-label="预览页面选择">
            {PREVIEW_NAV_GROUPS.map((group) => (
              <div className="preview-nav-group" key={group.title}>
                <div className="preview-nav-group-title">{group.title}</div>
                {group.items.map((item) => {
                  const selected = item.slot === previewSlot;
                  return (
                    <button
                      type="button"
                      key={item.slot}
                      className={selected ? 'preview-nav-item is-active' : 'preview-nav-item'}
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => setPreviewSlot(item.slot)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="preview-main">
            {/* 地址行：原来两张 Statistic 卡各占半屏，收成一行小字 + 复制按钮，把高度让给画面 */}
            <div className="preview-address-row">
              <div className="preview-address">
                <span className="preview-address-label">预览地址</span>
                <Tooltip title={`本地：${getLocalAddressText(previewSlot)}　完整：${buildPreviewUrl(previewSlot)}`}>
                  <code className="preview-address-text">{getLocalAddressText(previewSlot)}</code>
                </Tooltip>
              </div>
              <Space size={8}>
                <Button size="small" onClick={() => void handleCopyLocalAddress()}>复制地址</Button>
                <Button size="small" onClick={() => void handleCopyPreviewLink()}>复制链接</Button>
              </Space>
            </div>
            {previewSlot === 'page6' || previewSlot === 'page7' || previewSlot === 'page8' ? (
              <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                对局选择与推送在「比赛管理」视图顶部的功能卡片中完成：点击对应卡片，在弹窗内勾选比赛、调整场序{previewSlot === 'page6' || previewSlot === 'page8' ? '与场序时间' : ''}后确认推送（最多 {PAGE8_MAX_MATCHES} 场）。
              </Paragraph>
            ) : null}
            <div className="preview-frame-shell" ref={previewFrameShellRef}>
              <div
                className="preview-frame-viewport"
                style={{ width: `${previewShellSize.width}px`, height: `${previewShellSize.height}px` }}
              >
                <div className="preview-frame-stage" style={{ transform: `scale(${previewScale})` }}>
                  <iframe title="preview" className="preview-frame" src={buildPreviewUrl(previewSlot)} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </Space>
  );
}
