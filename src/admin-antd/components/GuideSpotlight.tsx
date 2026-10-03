/*
This project uses Ant Design (https://ant.design), licensed under the MIT License.
*/
import React, { useEffect, useRef, useState } from 'react';
import { Tour } from 'antd';
import type { TourProps } from 'antd';

import { buildViewTourSteps } from '../lib/guide';
import type { ViewKey } from '../types';

/**
 * 「本页怎么用」的在界面上指点（antd `Tour`）—— 就是"引导线/高亮框"那一层。
 *
 * 与说明抽屉的分工：抽屉负责"按步骤讲文字"，本组件负责"把话指到具体元素上"——
 * 点某一步 → 高亮框 + 箭头（指示线）指向该元素，并且可以一步步走下去。
 * **只由用户点击触发**：不首访自动弹、不主动打断，关掉就结束。
 *
 * 三个实现约束：
 * 1. **锚点用 `data-tour="xxx"` 选择器**，不依赖 antd 内部 class（升级/换肤不会打散）。
 * 2. **目标必须已渲染**：这些步骤都属于当前视图；万一找不到（某卡片当前条件不渲染），
 *    Tour 会把卡片居中显示并附一行兜底说明，不会报错。
 * 3. **箭头/指示线来自 antd Tour 本身**，不要自己画 SVG —— 高亮框与箭头会跟随目标定位。
 */

export interface GuideSpotlightProps {
  /** 要指点的视图；null = 关闭 */
  view: ViewKey | null;
  /** 从第几步开始（抽屉里点具体某一步时传入） */
  startStep: number;
  onClose: () => void;
}

/** 正文统一样式：像素级样式只在本文件出现一次 */
const DESCRIPTION_STYLE: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.7,
  maxWidth: 360,
};

/** 锚点缺失时的兜底提示，避免用户以为引导坏了 */
const MISSING_ANCHOR_HINT = '（这一步的目标当前不在页面上，先把上一步做出来再看）';

/** 等一帧再定位：抽屉关闭 / 视图切换后布局稳定了再量位置 */
const ANCHOR_SETTLE_MS = 220;

export function GuideSpotlight({ view, startStep, onClose }: GuideSpotlightProps): React.ReactElement {
  const [current, setCurrent] = useState(startStep);
  const [settled, setSettled] = useState(false);
  const settleTimerRef = useRef<number | null>(null);

  const steps = view ? buildViewTourSteps(view) : [];

  useEffect(() => {
    if (!view) {
      setSettled(false);
      return undefined;
    }
    setCurrent(startStep);
    setSettled(false);
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      setSettled(true);
    }, ANCHOR_SETTLE_MS);
    return () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [view, startStep]);

  /** 该步骤的目标元素是否真的在页面上（找不到时给一行兜底说明） */
  function hasAnchor(stepIndex: number): boolean {
    const anchor = steps[stepIndex]?.target;
    if (!anchor) {
      return true;
    }
    return typeof document !== 'undefined' && document.querySelector(anchor) !== null;
  }

  /**
   * 把 `data-tour="xxx"` 选择器变成 Tour 的 target。
   * 用函数形式而不是字符串：① 类型上 Tour 只接受元素或返回元素的函数（字符串是运行期扩展，TS 不认）；
   * ② 每次定位都重新查一次 DOM，抽屉关闭/重新打开后能立刻选中。
   * 查不到时返回 null → Tour 自动把卡片居中显示（配合上面的兜底提示文案）。
   */
  function resolveAnchor(anchor: string | null): (() => HTMLElement) | undefined {
    if (!anchor) {
      return undefined;
    }
    return (() => document.querySelector<HTMLElement>(anchor) ?? null) as unknown as () => HTMLElement;
  }

  const tourSteps: TourProps['steps'] = steps.map((step, index) => {
    const isLast = index === steps.length - 1;
    const missing = settled && current === index && !hasAnchor(index);
    return {
      title: step.title,
      description: (
        <div style={DESCRIPTION_STYLE}>
          <div>{step.body}</div>
          {missing ? (
            <div style={{ marginTop: 6, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{MISSING_ANCHOR_HINT}</div>
          ) : null}
        </div>
      ),
      target: resolveAnchor(step.target),
      placement: step.placement,
      nextButtonProps: { children: isLast ? '完成' : '下一步' },
      prevButtonProps: index === 0 ? { style: { display: 'none' } } : undefined,
    };
  });

  return (
    <Tour
      open={Boolean(view)}
      current={current}
      steps={tourSteps}
      onChange={(next) => setCurrent(next)}
      onClose={onClose}
      onFinish={onClose}
      // 压在说明抽屉（zIndex 900）之上：抽屉可能还开着，指引用的是它讲的那个元素
      zIndex={1080}
      // 用 auto（不要 smooth）：平滑滚动还没结束就量位置会让卡片与箭头贴到旧坐标上
      scrollIntoViewOptions={{ block: 'center', behavior: 'auto' }}
      indicatorsRender={(stepIndex, total) => (
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{stepIndex + 1} / {total}</span>
      )}
    />
  );
}

export default GuideSpotlight;
