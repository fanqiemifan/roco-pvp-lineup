import ExcelJS, { type DataValidation } from 'exceljs';

import type { SpriteRecord } from '../../../shared/types';
import { buildLineupTemplateSheet, type LineupTemplatePlan } from './lineup-sheet';

/* ==================== 系列赛阵容模板：xlsx 渲染（exceljs，带精灵下拉） ==================== */

/** 「阵容」工作表名：服务端解析时按名优先定位（见 electron/services/lineup-xlsx-service.ts） */
export const LINEUP_SHEET_NAME = '阵容';
/** 精灵下拉选项所在工作表名（隐藏）：数据校验的跨表引用目标 */
export const SPRITE_LIST_SHEET_NAME = '精灵列表';

/** 隔场交替底色（淡蓝）：仅视觉辅助，便于线下分辨「一场两行」的对局边界（奇数场留白） */
const MATCH_STRIPE_ARGB = 'FFE6F4FF';
/** 表格线框（浅灰细线）：框住每个单元格，便于线下分辨每个格子与对局边界 */
const MATCH_BORDER_ARGB = 'FFD9D9D9';

const LINEUP_HEADER_WIDTHS = [18, 18, 20, 8, 12, 26, 26, 26, 26, 26, 26];

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

export interface RenderLineupTemplateInput {
  recordName: string;
  plan: LineupTemplatePlan;
  sprites: SpriteRecord[];
}

/**
 * 生成阵容填写模板 .xlsx：
 * - 「阵容」表：与解析口径一致的一场两行表格，精灵1..6 列挂跨表下拉（强校验，粘贴可绕过属软约束）；
 * - 「精灵列表」表（隐藏）：255 个最终形态选项，供下拉引用与人工查阅。
 */
export async function renderLineupTemplateXlsx(input: RenderLineupTemplateInput): Promise<Uint8Array<ArrayBuffer>> {
  const { recordName, plan, sprites } = input;
  const { header, rows } = buildLineupTemplateSheet(plan.targets, recordName, sprites);
  const options = buildSpriteOptions(sprites);

  const workbook = new ExcelJS.Workbook();
  const lineupSheet = workbook.addWorksheet(LINEUP_SHEET_NAME);
  lineupSheet.addRow(header);
  rows.forEach((row) => lineupSheet.addRow(row));

  // 统一整表样式（仅视觉辅助）：表头与数据一起套浅灰细线框；数据行再以「一场两行」为单位隔场交替填充淡蓝底色
  const lastLineupRow = rows.length + 1;
  for (let rowIndex = 1; rowIndex <= lastLineupRow; rowIndex += 1) {
    const excelRow = lineupSheet.getRow(rowIndex);
    // 第 1 场（第 2、3 行）有底色、第 2 场（第 4、5 行）留白，依次交替
    const striped = rowIndex >= 2 && Math.floor((rowIndex - 2) / 2) % 2 === 0;
    for (let column = 1; column <= header.length; column += 1) {
      const cell = excelRow.getCell(column);
      cell.border = {
        top: { style: 'thin', color: { argb: MATCH_BORDER_ARGB } },
        left: { style: 'thin', color: { argb: MATCH_BORDER_ARGB } },
        bottom: { style: 'thin', color: { argb: MATCH_BORDER_ARGB } },
        right: { style: 'thin', color: { argb: MATCH_BORDER_ARGB } },
      };
      if (striped) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: MATCH_STRIPE_ARGB },
        };
      }
    }
  }
  lineupSheet.columns = header.map((_unused, index) => ({ width: LINEUP_HEADER_WIDTHS[index] ?? 16 }));
  // 冻结表头行：长表格滚动时列名（对局ID / 位置）始终可见
  lineupSheet.views = [{ state: 'frozen', ySplit: 1 }];

  const listSheet = workbook.addWorksheet(SPRITE_LIST_SHEET_NAME);
  listSheet.addRow(['精灵选项', '图鉴编号', '属性']);
  options.forEach((option) => listSheet.addRow([option.label, option.number ?? '', option.attribute]));
  listSheet.state = 'hidden';

  // 跨表下拉：范围动态跟随选项数量；无选项（精灵索引为空）时不挂校验，避免指向空区域。
  // exceljs 的 index.d.ts 未声明 worksheet.dataValidations（上游把该行注释掉了），运行时可用：窄化补类型
  if (options.length > 0 && rows.length > 0) {
    const { dataValidations } = lineupSheet as unknown as {
      dataValidations: { add(range: string, validation: DataValidation): void };
    };
    dataValidations.add(`F2:K${rows.length + 1}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`${SPRITE_LIST_SHEET_NAME}!$A$2:$A$${options.length + 1}`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: '精灵不合法',
      error: '请从下拉列表中选择（格式：pet_id_名字）',
      showInputMessage: true,
      promptTitle: '选择精灵',
      prompt: '从下拉列表中选择最终形态精灵',
    });
  }

  // 统一复制成普通 Uint8Array<ArrayBuffer>：兼容 node 端 Buffer 与浏览器端缓冲区，并满足 Blob 的类型要求
  const written = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
  const source = written instanceof Uint8Array ? written : new Uint8Array(written);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}