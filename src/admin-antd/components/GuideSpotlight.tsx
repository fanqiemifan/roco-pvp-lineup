/*
This project uses Ant Design (https://ant.design), licensed under the MIT License.
*/
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tour } from 'antd';
import type { TourProps } from 'antd';

import { buildViewTourSteps } from '../lib/guide';
import type { GuidePlacement, GuideStep } from '../lib/guide';
import type { ViewKey } from '../types';

/**
 * 在界面上「指出来」的引导层（antd `Tour`）：高亮框 + 箭头（指示线）指向具体元素。
 *
 * 两种来源（都只由用户点击触发，**不首访自动弹、不主动打断**）：
 * - **假数据版（主推）**：模拟会话页里跑分步实操（如系列比赛整条流程），带步骤进度与"上次走到哪"；
 *   真数据版只在当前视图指几处，用来"看一眼在哪"。
 * - 步骤文案都来自 `lib/guide`，改一处两处生效。
 *
 * 三个实现约束：
 * 1. **锚点用选择器**（`data-tour` / `data-demo-tour`），不依赖 antd 内部 class。
 * 2. **"指不到"就别硬指**：锚点不存在、或者目标是一整张大卡片（宽/高超过视口 85%）时，
 *    退回居中卡片并说明原因 —— 画一个把整页圈进去的大框比不指更糟。
 * 3. **箭头/指示线用 antd Tour 自带的**，不要自己画 SVG。
 */

export interface GuideSpotlightProps {
  /** 要指点的视图；null = 关闭 */
  view: ViewKey | null;
  /** 从第几步开始 */
  startStep: number;
  /** 步骤来源：不传 = 该视图在真机界面上的说明；传了 = 模拟会话里的分步实操 */
  steps?: readonly GuideStep[];
  /** 步骤推进时回调（模拟会话用它记住"走到哪了"） */
  onStepChange?: (step: number) => void;
  onClose: () => void;
}

/** 正文统一样式：像素级样式只在本文件出现一次 */
const DESCRIPTION_STYLE: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.7,
  maxWidth: 380,
};

/** 指不到时的兜底说明，避免用户以为引导坏了 */
const CANNOT_POINT_HINT = '（这一步要指的位置当前不在页面上，或者它是一整张大卡片、指了也看不出重点，所以居中显示）';

/** 等一帧再定位：抽屉关闭 / 视图切换后布局稳定了再量位置 */
const ANCHOR_SETTLE_MS = 220;

/**
 * 目标"太大"的判据：宽或高超过视口的这个比例时视为整页级卡片，不指。
 * 阈值放到 1.3（略超一屏也算"能指"）：详情卡这类 1200×1100 的目标指出来仍然有重点
 * （用户能看到"就是这张卡"），而真正整页级的（多屏高）才退回居中卡片。
 */
const OVERSIZED_TARGET_RATIO = 1.3;

export function GuideSpotlight({ view, startStep, steps: injectedSteps, onStepChange, onClose }: GuideSpotlightProps): React.ReactElement {
  const [current, setCurrent] = useState(startStep);
  const [settled, setSettled] = useState(false);
  const settleTimerRef = useRef<number | null>(null);

  const steps = useMemo<readonly GuideStep[]>(
    () => injectedSteps ?? (view ? buildViewTourSteps(view) : []),
    [injectedSteps, view],
  );

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
  }, [view, startStep, steps]);

  /**
   * 能不能真的"指"到：锚点存在，且目标不是整页那么大的卡片。
   * 指不到返回 null → Tour 把卡片居中显示，并附一行原因。
   */
  function resolveTarget(index: number): HTMLElement | null {
    const anchor = steps[index]?.target;
    if (!anchor || typeof document === 'undefined') {
      return null;
    }
    const element = document.querySelector<HTMLElement>(anchor);
    if (!element) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const tooWide = rect.width > window.innerWidth * OVERSIZED_TARGET_RATIO;
    const tooTall = rect.height > window.innerHeight * OVERSIZED_TARGET_RATIO;
    return tooWide || tooTall ? null : element;
  }

  const tourSteps: TourProps['steps'] = steps.map((step, index) => {
    const isLast = index === steps.length - 1;
    // settled 之后才量：抽屉收起 / 布局稳定前的尺寸不可信
    const measured = settled && current === index;
    const target = measured ? resolveTarget(index) : null;
    const cannotPoint = measured && step.target !== null && target === null;
    return {
      title: step.title,
      description: (
        <div style={DESCRIPTION_STYLE}>
          <div>{step.body}</div>
          {cannotPoint ? (
            <div style={{ marginTop: 6, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{CANNOT_POINT_HINT}</div>
          ) : null}
        </div>
      ),
      // 类型断言：Tour 的 target 只接受「元素 | 返回元素的函数 | 返回 null 的函数」，
      // 这里的函数可能返回 null（指不到就居中显示），TS 认不出，故断言一次（运行期行为不变）
      target: step.target === null ? undefined : (() => resolveTarget(index)) as unknown as () => HTMLElement,
      placement: (cannotPoint ? 'center' : step.placement) as GuidePlacement,
      nextButtonProps: { children: isLast ? '完成' : '下一步' },
      prevButtonProps: index === 0 ? { style: { display: 'none' } } : undefined,
    };
  });

  return (
    <Tour
      open={Boolean(view) && steps.length > 0}
      current={current}
      steps={tourSteps}
      onChange={(next) => {
        setCurrent(next);
        setSettled(false);
        if (settleTimerRef.current !== null) {
          window.clearTimeout(settleTimerRef.current);
        }
        // 换步后重新等布局稳定（新目标可能触发滚动/展开），避免箭头贴旧坐标
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          setSettled(true);
        }, ANCHOR_SETTLE_MS);
        onStepChange?.(next);
      }}
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
