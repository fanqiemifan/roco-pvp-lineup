import React from 'react';
import { Button } from 'antd';
import { ATTRIBUTE_OPTIONS } from '../constants';

type AttributeFilterChipsProps = {
  /** 已选中的属性名（最多 2 个，上限逻辑由 onToggle 实现方维护） */
  selected: string[];
  onToggle: (label: string) => void;
};

/**
 * 精灵属性筛选 chips：图标 + 属性文案，赛事面板阵容编辑器与比赛历史「录入阵容」弹窗共用，
 * 改动需同时兼顾两处。chip 宽度不足以容纳文案时（container query）自动退化为纯图标，
 * 此时仍保留 title/aria-label 的悬浮提示与无障碍语义。
 */
export function AttributeFilterChips({ selected, onToggle }: AttributeFilterChipsProps) {
  return (
    <div className="attribute-filter-grid">
      {ATTRIBUTE_OPTIONS.map((option) => {
        const active = selected.includes(option.label);
        return (
          <Button
            key={option.label}
            type={active ? 'primary' : 'default'}
            className="attribute-filter-chip"
            title={option.label}
            aria-label={option.label}
            onClick={() => onToggle(option.label)}
          >
            <span className="attribute-filter-chip-inner">
              <img src={option.iconPath} alt="" className="attribute-filter-icon" />
              <span className="attribute-filter-text">{option.label}</span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
