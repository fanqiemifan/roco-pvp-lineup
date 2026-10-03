import ExcelJS from 'exceljs';

import type { SpriteRecord } from '../../../shared/types';
import { buildLineupTemplateSheet, type LineupTemplatePlan } from './lineup-sheet';
import { appendSpriteListSheet, attachSpriteDropdown, buildSpriteOptions } from './sprite-dropdown-xlsx';

/* ==================== 系列赛阵容模板：xlsx 渲染（exceljs，带精灵下拉） ==================== */

/** 「阵容」工作表名：服务端解析时按名优先定位（见 electron/services/lineup-xlsx-service.ts） */
export const LINEUP_SHEET_NAME = '阵容';

/** 隔场交替底色（淡蓝）：仅视觉辅助，便于线下分辨「一场两行」的对局边界（奇数场留白） */
const MATCH_STRIPE_ARGB = 'FFE6F4FF';
/** 表格线框（浅灰细线）：框住每个单元格，便于线下分辨每个格子与对局边界 */
const MATCH_BORDER_ARGB = 'FFD9D9D9';

const LINEUP_HEADER_WIDTHS = [18, 18, 20, 8, 12, 26, 26, 26, 26, 26, 26];

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

  appendSpriteListSheet(workbook, options);

  // 跨表下拉：范围动态跟随选项数量；无选项（精灵索引为空）时不挂校验，避免指向空区域
  if (rows.length > 0) {
    attachSpriteDropdown(lineupSheet, `F2:K${rows.length + 1}`, options.length);
  }

  // 统一复制成普通 Uint8Array<ArrayBuffer>：兼容 node 端 Buffer 与浏览器端缓冲区，并满足 Blob 的类型要求
  const written = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
  const source = written instanceof Uint8Array ? written : new Uint8Array(written);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}