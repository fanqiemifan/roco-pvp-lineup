import type { DataValidation, Workbook, Worksheet } from 'exceljs';

import type { SpriteRecord } from '../../../shared/types';

/* ==================== xlsx 精灵下拉公共原语（系列赛阵容模板 / 选手表格 共用） ==================== */

/** 精灵下拉选项所在工作表名（隐藏）：数据校验的跨表引用目标 */
export const SPRITE_LIST_SHEET_NAME = '精灵列表';

/** 下拉选项：`pet_id_名字（形态）`，与导入侧数字前缀匹配、后台录入「只看最终形态」同口径 */
export interface SpriteOption {
  id: string;
  label: string;
  number: number | null;
  attribute: string;
}

/** 取精灵索引中的最终形态（按 id 去重，按图鉴编号排序），生成 `pet_id_名字（形态）` 选项 */
export function buildSpriteOptions(sprites: SpriteRecord[]): SpriteOption[] {
  const seen = new Set<string>();
  return sprites
    .filter((sprite) => sprite.isFinalForm && !seen.has(sprite.id) && (seen.add(sprite.id), true))
    .sort((left, right) => {
      const leftKey = left.number ?? Number(left.id);
      const rightKey = right.number ?? Number(right.id);
      return leftKey - rightKey || left.id.localeCompare(right.id, undefined, { numeric: true });
    })
    .map((sprite) => ({
      id: sprite.id,
      label: `${sprite.id}_${sprite.name}`,
      number: sprite.number,
      attribute: sprite.attribute,
    }));
}

/** 追加隐藏的「精灵列表」表（选项 + 图鉴编号 + 属性），供各模板的跨表下拉引用与人工查阅 */
export function appendSpriteListSheet(workbook: Workbook, options: SpriteOption[]): void {
  const listSheet = workbook.addWorksheet(SPRITE_LIST_SHEET_NAME);
  listSheet.addRow(['精灵选项', '图鉴编号', '属性']);
  options.forEach((option) => listSheet.addRow([option.label, option.number ?? '', option.attribute]));
  listSheet.state = 'hidden';
}

/**
 * 给指定区域挂精灵下拉（跨表引用「精灵列表」）。
 * 选项为空（精灵索引为空）时不挂校验，避免指向空区域。
 * exceljs 的 index.d.ts 未声明 worksheet.dataValidations（上游把该行注释掉了），运行时可用：窄化补类型。
 */
export function attachSpriteDropdown(sheet: Worksheet, range: string, optionsCount: number): void {
  if (optionsCount <= 0) {
    return;
  }
  const { dataValidations } = sheet as unknown as {
    dataValidations: { add(range: string, validation: DataValidation): void };
  };
  dataValidations.add(range, {
    type: 'list',
    allowBlank: true,
    formulae: [`${SPRITE_LIST_SHEET_NAME}!$A$2:$A$${optionsCount + 1}`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '精灵不合法',
    error: '请从下拉列表中选择（格式：pet_id_名字）',
    showInputMessage: true,
    promptTitle: '选择精灵',
    prompt: '从下拉列表中选择最终形态精灵',
  });
}
