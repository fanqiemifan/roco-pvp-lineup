import React from 'react';
import { Button, Space } from 'antd';
import { FINAL_FORM_FILTER_LABEL } from '../constants';

type FormFilterChipsProps = {
  /** 「最终形态」是否选中（选中时其余形态按钮禁用） */
  finalActive: boolean;
  onToggleFinal: () => void;
  /** 形态选项（如 首领/一阶/二阶/三阶） */
  options: string[];
  selected: string[];
  onToggleForm: (form: string) => void;
};

/**
 * 精灵形态筛选 chips：样式对齐精灵属性 chips（.attribute-filter-chip，26px 高 / 10px 圆角 / 11px 字号），无图标。
 * 赛事面板阵容编辑器与比赛历史「录入阵容」弹窗共用本组件，改样式需同时兼顾两处。
 */
export function FormFilterChips({ finalActive, onToggleFinal, options, selected, onToggleForm }: FormFilterChipsProps) {
  return (
    <Space wrap size={[8, 8]} className="form-filter-row">
      <Button
        type={finalActive ? 'primary' : 'default'}
        className="form-filter-chip"
        onClick={onToggleFinal}
      >
        {FINAL_FORM_FILTER_LABEL}
      </Button>
      {options.map((form) => (
        <Button
          key={form}
          type={selected.includes(form) ? 'primary' : 'default'}
          className="form-filter-chip"
          disabled={finalActive}
          onClick={() => onToggleForm(form)}
        >
          {form}
        </Button>
      ))}
    </Space>
  );
}
