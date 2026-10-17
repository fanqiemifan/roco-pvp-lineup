import React from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Image,
  Row,
  Slider,
  Space,
  Typography,
} from 'antd';

import { useAdminData } from '../data/use-admin-data';
import { LiveWatchCard } from '../components/LiveWatchCard';
import { getEnergyLevel, getHealthLevel, getLiveConfigFileName } from '../lib/live';
import type { PanelSide } from '../types';
import { Surface } from '../ui/Surface';

const { Text } = Typography;

/**
 * 实时控制（M5 从 App.tsx 拆出）：左右各 6 个槽位的 HP / 能量滑块 + 监听状态卡。
 *
 * 监听会话（轮询 / 回写定时器 / ref 心跳）不在本视图：它挂在常驻数据层 `useLiveControl()`，
 * 否则切到别的视图视图卸载时监听会被一起清掉，导航上的「监听中」呼吸点也读不到状态。
 */
export function LiveView(): React.ReactElement {
  const { panels, live, loadInitialData } = useAdminData();

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card
        title="面板实时预览"
        extra={(
          <Space wrap>
            <Button onClick={() => void loadInitialData(true)}>重新加载</Button>
            <Button onClick={() => void live.handleExportLiveConfig()}>配置导出</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={16} className="page-stack">
          {live.liveNotice ? (
            <Alert
              showIcon
              closable
              type={live.liveNotice.tone}
              message={live.liveNotice.text}
              onClose={() => live.setLiveNotice(null)}
            />
          ) : null}
          <Row gutter={[18, 18]}>
            {(['left', 'right'] as PanelSide[]).map((side) => (
              <Col key={side} xs={24} xl={12}>
                <Card title={side === 'left' ? '左侧实时面板' : '右侧实时面板'}>
                  <div className="live-grid">
                    {panels[side].selected.map((slot, index) => (
                      <Surface tone="card" key={`live-${side}-${index}`} className="live-slot-card">
                        <div className="live-slot-preview">
                          <span className="live-slot-index">{index + 1}</span>
                          {slot.sprite?.path ? (
                            <Image preview={false} src={slot.sprite.path} alt={slot.sprite.displayName} className="live-slot-image" fallback="/assets/ui/back.png" />
                          ) : (
                            <div className="live-slot-empty">空槽位</div>
                          )}
                          <Text ellipsis className="live-slot-name">{slot.sprite?.displayName ?? '未选择精灵'}</Text>
                        </div>
                        <div className="live-slot-controls">
                          <div className="live-input-row">
                            <Text strong className="live-input-label">HP</Text>
                            <Slider
                              key={`live-health-${side}-${index}-${slot.sprite?.id ?? 'empty'}-${slot.healthEnabled ? 'on' : 'off'}-${getHealthLevel(slot)}`}
                              min={0}
                              max={100}
                              defaultValue={getHealthLevel(slot)}
                              onChangeComplete={(value) => void live.saveLiveField(side, index, 'healthPercent', Number(value))}
                              className="live-input-slider"
                              tooltip={{ formatter: (value) => `${value ?? 0}%` }}
                            />
                          </div>
                          <div className="live-input-row">
                            <Text strong className="live-input-label">能量</Text>
                            <Slider
                              key={`live-energy-${side}-${index}-${slot.sprite?.id ?? 'empty'}-${getEnergyLevel(slot)}`}
                              min={0}
                              max={10}
                              step={1}
                              defaultValue={getEnergyLevel(slot)}
                              onChangeComplete={(value) => void live.saveLiveField(side, index, 'energyValue', Number(value))}
                              className="live-input-slider"
                            />
                          </div>
                        </div>
                      </Surface>
                    ))}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24}>
              <LiveWatchCard
                enabled={live.liveConfigEnabled}
                busy={live.liveWatchBusy}
                supported={live.liveDesktopSupported}
                filePath={live.liveFilePath}
                fileName={live.liveFilePath ? getLiveConfigFileName(live.liveFilePath) : ''}
                snapshot={live.liveWatch}
                heartbeat={live.liveHeartbeatRef}
                rememberedPath={live.liveRememberedPath}
                onToggle={live.handleLiveConfigWatchToggle}
                onPickFile={() => { void live.startLiveConfigWatch(); }}
                onRestore={() => { void live.restoreLiveConfigWatch(); }}
                onForget={live.forgetLiveWatchPath}
                onUpload={live.handleLiveConfigUpload}
              />
            </Col>
          </Row>
        </Space>
      </Card>
    </Space>
  );
}
