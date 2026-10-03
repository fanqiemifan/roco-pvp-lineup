import React from 'react';
import { Button, Card, Drawer, Space, Tag, Typography } from 'antd';
import type { ViewKey } from '../types';

import { VIEW_GUIDES, viewGuideDemoView, viewGuideSteps, viewGuideTitle } from '../lib/guide';
import type { GuideStep } from '../lib/guide';

const { Paragraph, Text } = Typography;

export interface CardGuidePanelProps {
  /** 要展示说明的视图 */
  view: ViewKey;
  /** 「在界面上指出来」：从第几步开始在界面上高亮指点 */
  onStartTour: (view: ViewKey, stepIndex: number) => void;
  /** 打开「模拟会话」（假数据 · 可随便点） */
  onOpenDemo: (view: ViewKey) => void;
  /** 打开「悬浮窗操作练习」（独立仿真页；只有把悬浮窗写进说明的视图才显示入口） */
  onOpenFloatPractice: () => void;
  /** 是否已处于模拟会话页（模拟会话里不再提供"打开模拟会话"，避免套娃） */
  inDemoSession: boolean;
}

/** 说明里提到悬浮窗的视图：给一个「悬浮窗操作练习」入口（页面里没有再单独放入口） */
const FLOAT_PRACTICE_VIEWS: ViewKey[] = ['roster', 'stage', 'live'];

/** 步骤类型 → 展示用标签（语义与颜色只在这里定义） */
const KIND_META: Record<GuideStep['kind'], { label: string; color: string }> = {
  step: { label: '界面说明', color: 'default' },
  flow: { label: '操作流程', color: 'orange' },
};

/**
 * 「本页怎么用」正文：当前视图的步骤清单 + 三个动作（界面上指出来 / 开模拟会话 / 悬浮窗练习）。
 *
 * 内容全部来自 `lib/guide` 的视图步骤注册表——文案只此一份，
 * 抽屉渲染它、`GuideSpotlight` 也拿同一份翻成 antd Tour 的步骤。
 */
export function CardGuidePanel({
  view,
  onStartTour,
  onOpenDemo,
  onOpenFloatPractice,
  inDemoSession,
}: CardGuidePanelProps): React.ReactElement {
  const guide = VIEW_GUIDES[view];
  const steps = viewGuideSteps(view);
  const demoView = viewGuideDemoView(view);
  const hasFlowStep = steps.some((step) => step.kind === 'flow');
  const showFloatPractice = FLOAT_PRACTICE_VIEWS.includes(view);

  return (
    <Space direction="vertical" size={14} className="page-stack" style={{ width: '100%' }}>
      <div>
        <Paragraph strong style={{ marginBottom: 4 }}>{guide?.title ?? '使用说明'}</Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>{guide?.summary ?? ''}</Paragraph>
      </div>

      <Button type="primary" block onClick={() => onStartTour(view, 0)}>
        在界面上指出来（带高亮与箭头）
      </Button>
      {demoView && !inDemoSession ? (
        <Button block onClick={() => onOpenDemo(demoView)}>
          开模拟会话（假数据，可以随便点）
        </Button>
      ) : null}
      {showFloatPractice ? (
        <Button block onClick={onOpenFloatPractice}>
          悬浮窗操作练习（模拟窗口，随便点）
        </Button>
      ) : null}

      {steps.map((step, index) => {
        const meta = KIND_META[step.kind];
        return (
          <Card key={`${step.title}-${index}`} size="small" className="guide-step-card">
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Space size={8} wrap>
                <Text strong>{`${index + 1}. ${step.title}`}</Text>
                <Tag color={meta.color} bordered={false}>{meta.label}</Tag>
              </Space>
              <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.7 }}>{step.body}</Text>
              <Button
                size="small"
                type="link"
                style={{ padding: 0 }}
                disabled={!step.target}
                onClick={() => onStartTour(view, index)}
              >
                {step.target ? '指向这一步' : '这一步没有可指的位置'}
              </Button>
            </Space>
          </Card>
        );
      })}

      {hasFlowStep ? (
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          标「操作流程」的是串起来的动作：想照着点一遍就开上面的模拟会话——
          那里的数据是编出来的，随便点都不会动到你的赛事，刷新即恢复。
        </Paragraph>
      ) : null}
    </Space>
  );
}

export interface CardGuideDrawerProps extends CardGuidePanelProps {
  /** 是否打开（父级常驻挂载、只切 open） */
  open: boolean;
  onClose: () => void;
}

/**
 * 「本页怎么用」抽屉外壳：统一 zIndex / 不压暗 / 宽度策略，避免每个调用点各写一套。
 *
 * - `mask={false}`：看说明时通常要对照界面，不能拦截点击；
 * - `zIndex` 低于弹窗基值（1000）：从抽屉里打开的弹窗（选场、录入阵容）必须压在上面；
 *   而"在界面上指出来"的 Tour 用 1080，压在抽屉之上（它指的就是抽屉旁边那个元素）；
 * - `destroyOnHidden`：每次打开都从顶部开始，不留上次的滚动位置。
 */
export function CardGuideDrawer({ open, onClose, view, ...panelProps }: CardGuideDrawerProps): React.ReactElement {
  return (
    <Drawer
      title={`本页怎么用 · ${viewGuideTitle(view)}`}
      placement="right"
      width="min(440px, 92vw)"
      open={open}
      onClose={onClose}
      mask={false}
      zIndex={900}
      destroyOnHidden
    >
      {open ? <CardGuidePanel key={view} view={view} {...panelProps} /> : null}
    </Drawer>
  );
}

export default CardGuideDrawer;
