import ExcelJS from 'exceljs';

/* ==================== 系列赛阵容模板 .xlsx：服务端解表（exceljs） ==================== */

/** 「阵容」工作表名（导出端约定，见 src/admin-antd/lib/lineup-template-xlsx.ts）；按名优先定位，找不到退回第一个工作表 */
const LINEUP_SHEET_NAME = '阵容';
/** 列数上限兜底：防止个别工作表的远列格式残留把表格撑大（模板固定 11 列） */
const MAX_COLUMNS = 64;

export interface LineupXlsxTable {
  /** 实际读取的工作表名（回显给前端提示） */
  sheetName: string;
  /** 二维字符串表（跳过全空行，列按工作表使用范围截断）；表头解析仍在共享的纯函数里做 */
  table: string[][];
}

/** exceljs 单元格值 → 文本（富文本拼接、公式取结果、数字/布尔转串；模板本来只写字符串） */
function cellValueToText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>;
    if (Array.isArray(cell.richText)) {
      return cell.richText
        .map((part) => String((part as Record<string, unknown> | null)?.text ?? ''))
        .join('');
    }
    if ('result' in cell) {
      return cellValueToText(cell.result);
    }
    if (typeof cell.text === 'string') {
      return cell.text;
    }
    if (typeof cell.error === 'string') {
      return cell.error;
    }
  }
  return String(value);
}

/**
 * 解析回传的 .xlsx 阵容模板 → 二维字符串表。
 * 只做解包与取值（格式相关工作），「对局ID + 位置」配对与名字解析仍在共享纯函数 / 既有预览管线里完成。
 */
export async function extractLineupSheetTable(buffer: Buffer): Promise<LineupXlsxTable> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs 的 index.d.ts 自带一个假的全局 Buffer 接口（extends ArrayBuffer），与 node Buffer 互不兼容：按运行时实际形态窄化
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new Error('无法读取 Excel 文件，请使用导出的 .xlsx 模板填写后回传');
  }

  const sheet = workbook.getWorksheet(LINEUP_SHEET_NAME) ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Excel 文件中没有工作表');
  }

  const columnCount = Math.min(Math.max(sheet.columnCount, 1), MAX_COLUMNS);
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let index = 1; index <= columnCount; index += 1) {
      cells.push(cellValueToText(row.getCell(index).value));
    }
    table.push(cells);
  });

  return { sheetName: sheet.name, table };
}