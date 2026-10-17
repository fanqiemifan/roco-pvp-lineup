import React, { type ReactNode } from 'react';
import { Typography } from 'antd';

const { Paragraph, Text } = Typography;

/**
 * variant:
 * - default: 标签在控件上方（原有样式，倒计时 / 下一场预告等弹窗沿用）
 * - row: 名称+说明在左、窄控件右对齐（画面设置行式布局）
 * - stack: 名称+说明在上方、宽控件独占一行（画面设置宽控件布局）
 */
export function SettingField({
  label,
  hint,
  children,
  variant = 'default',
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  variant?: 'default' | 'row' | 'stack';
}) {
  if (variant === 'default') {
    return (
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>{label}</Text>
        {hint ? (
          <Paragraph type="secondary" style={{ marginBottom: 6, fontSize: 12 }}>{hint}</Paragraph>
        ) : null}
        {children}
      </div>
    );
  }
  const info = (
    <div className="setting-row-info">
      <div className="setting-row-name">{label}</div>
      {hint ? <div className="setting-row-hint">{hint}</div> : null}
    </div>
  );
  if (variant === 'row') {
    return (
      <div className="setting-row">
        {info}
        <div className="setting-row-ctrl">{children}</div>
      </div>
    );
  }
  return (
    <div className="setting-col">
      {info}
      <div className="setting-col-ctrl">{children}</div>
    </div>
  );
}
