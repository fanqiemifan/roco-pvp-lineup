import ExcelJS from 'exceljs';

import {
  PROFILE_AVATAR_COLUMN,
  PROFILE_SHEET_NAME,
  parseProfileSheetRows,
  type ProfileSheetRow,
} from '../../shared/profile-sheet.js';
import type { ProfileStoreState } from '../../shared/types.js';
import { saveProfilePlayerAvatar } from './image-service.js';
import type { AppPaths } from './path-service.js';
import { importPlayerProfiles, getProfileStore, type PetSuggestionReview } from './profile-service.js';

/* ==================== 选手信息表格 .xlsx：服务端解表（exceljs）+ 导入编排 ==================== */

/** 列数上限兜底：防止远列格式残留把表格撑大（模板固定 10 列） */
const MAX_COLUMNS = 64;
/** 单张头像字节上限：防 zip bomb / 超大图拖垮 sharp */
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
/** 选手档案上限（与 profile-service 的 MAX_PLAYERS 对齐，用于预览提示超限丢弃） */
const MAX_PLAYERS = 200;

export interface ProfileXlsxImage {
  /** 图片锚点所在工作表行号（1 基，来自 tl.nativeRow + 1） */
  rowNumber: number;
  /** 图片锚点所在列下标（0 基） */
  colIndex: number;
  buffer: Buffer;
  extension: string;
}

export interface ProfileXlsxTable {
  sheetName: string;
  rows: ProfileSheetRow[];
  images: ProfileXlsxImage[];
  /** 是否检测到 WPS「嵌入单元格」图片（DISPIMG 公式）——这种图片我们读不到 */
  dispImgDetected: boolean;
}

/** exceljs 单元格值 → 文本（富文本拼接、公式取结果、数字/布尔转串） */
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

/** 单元格值是否为 WPS「嵌入单元格」图片（DISPIMG 公式） */
function isDispImgValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const cell = value as Record<string, unknown>;
  const formula = typeof cell.formula === 'string' ? cell.formula : '';
  const sharedFormula = typeof cell.sharedFormula === 'string' ? cell.sharedFormula : '';
  return formula.includes('DISPIMG') || sharedFormula.includes('DISPIMG');
}

/**
 * 解析 .xlsx → 带真实行号的二维表 + 按锚点行定位的浮动图片 + DISPIMG 检测。
 * 行号必须真实（不能只存数组下标），否则头像会错行；图片锚点 `tl.nativeRow` 为 0 基。
 */
export async function extractProfileSheet(buffer: Buffer): Promise<ProfileXlsxTable> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs 的 index.d.ts 自带一个假的全局 Buffer 接口（extends ArrayBuffer），与 node Buffer 不兼容：按运行时形态窄化
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new Error('无法读取 Excel 文件，请使用导出的 .xlsx 模板填写后回传');
  }

  const sheet = workbook.getWorksheet(PROFILE_SHEET_NAME)
    ?? workbook.worksheets.find((candidate) => candidate.state === 'visible')
    ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Excel 文件中没有工作表');
  }

  const columnCount = Math.min(Math.max(sheet.columnCount, 1), MAX_COLUMNS);
  const rows: ProfileSheetRow[] = [];
  let dispImgDetected = false;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let index = 1; index <= columnCount; index += 1) {
      const value = row.getCell(index).value;
      if (isDispImgValue(value)) {
        dispImgDetected = true;
      }
      cells.push(cellValueToText(value));
    }
    rows.push({ rowNumber: row.number, cells });
  });

  const images: ProfileXlsxImage[] = [];
  for (const image of sheet.getImages()) {
    const media = workbook.getImage(Number(image.imageId));
    if (!media?.buffer) {
      continue;
    }
    const anchor = image.range?.tl;
    images.push({
      rowNumber: (anchor?.nativeRow ?? 0) + 1,
      colIndex: anchor?.nativeCol ?? 0,
      buffer: Buffer.isBuffer(media.buffer) ? media.buffer : Buffer.from(media.buffer),
      extension: media.extension ?? 'png',
    });
  }

  return { sheetName: sheet.name, rows, images, dispImgDetected };
}

/** 每行挑一张图片：优先落在「头像」列、其次列号最接近「头像」列者（同行多图不迷路） */
function pickImageByRow(images: ProfileXlsxImage[]): Map<number, ProfileXlsxImage> {
  const byRow = new Map<number, ProfileXlsxImage>();
  for (const image of images) {
    const current = byRow.get(image.rowNumber);
    if (!current) {
      byRow.set(image.rowNumber, image);
      continue;
    }
    const currentDistance = Math.abs(current.colIndex - PROFILE_AVATAR_COLUMN);
    const nextDistance = Math.abs(image.colIndex - PROFILE_AVATAR_COLUMN);
    if (nextDistance < currentDistance) {
      byRow.set(image.rowNumber, image);
    }
  }
  return byRow;
}

export interface ProfileXlsxPreviewPlayer {
  rowNumber: number;
  name: string;
  rank: string;
  declaration: string;
  pets: string;
  hasAvatar: boolean;
}

export interface ProfileXlsxPreview {
  sheetName: string;
  players: ProfileXlsxPreviewPlayer[];
  warnings: string[];
  errors: string[];
}

export interface ProfileXlsxAvatarReport {
  matched: number;
  unmatched: string[];
  failed: Array<{ name: string; reason: string }>;
}

export interface ProfileXlsxImportResult {
  profiles: ProfileStoreState;
  review: PetSuggestionReview[];
  avatars: ProfileXlsxAvatarReport;
  warnings: string[];
}

const DISPIMG_HINT =
  '检测到头像以 WPS「嵌入单元格」方式插入，暂不支持读取；请在 WPS 里改用「插入 → 图片」（浮动图片）后重试。';

/** 解表 + 解析 + 组装提示（预览与导入共用，保证两处口径一致） */
function analyzeProfileSheet(paths: AppPaths, table: ProfileXlsxTable) {
  const parsed = parseProfileSheetRows(table.rows);
  const warnings = [...parsed.warnings];
  const errors = [...parsed.errors];
  const imageByRow = pickImageByRow(table.images);

  const parsedRowNumbers = new Set(parsed.players.map((player) => player.rowNumber));
  const orphanImageRows = [...imageByRow.keys()].filter((rowNumber) => !parsedRowNumbers.has(rowNumber));
  if (orphanImageRows.length > 0) {
    warnings.push(`第 ${orphanImageRows.join('、')} 行有头像但该行没有可识别的选手名字，头像已忽略`);
  }
  if (table.dispImgDetected && table.images.length === 0) {
    warnings.push(DISPIMG_HINT);
  }

  // 超上限提示：importPlayerProfiles 超限会静默丢弃，这里提前算清楚
  const existingNames = new Set(getProfileStore(paths).players.map((player) => player.name));
  const newNames = new Set(parsed.players.filter((player) => !existingNames.has(player.name)).map((player) => player.name));
  if (existingNames.size + newNames.size > MAX_PLAYERS) {
    warnings.push(`本机已有 ${existingNames.size} 名选手，本次新增 ${newNames.size} 名，超出上限 ${MAX_PLAYERS}，超出部分将被忽略`);
  }

  const players: ProfileXlsxPreviewPlayer[] = parsed.players.map((player) => ({
    ...player,
    hasAvatar: imageByRow.has(player.rowNumber),
  }));

  return { parsed, players, imageByRow, warnings, errors };
}

/** 预览（只读，不落盘）：返回按列映射好的选手行 + 头像有无 + 提示 */
export async function previewProfileXlsx(paths: AppPaths, buffer: Buffer): Promise<ProfileXlsxPreview> {
  const table = await extractProfileSheet(buffer);
  const { players, warnings, errors } = analyzeProfileSheet(paths, table);
  return { sheetName: table.sheetName, players, warnings, errors };
}

/**
 * 导入选手（含头像）：先 `importPlayerProfiles`（白名单 + 同名更新 + 精灵 review），
 * 落盘后再按行名字匹配选手 id 存头像 —— 顺序不能反，新增选手 id 只有落盘后才存在。
 * 头像来源为浮动图片锚点行；单张失败只记账不 500。
 */
export async function importProfileXlsx(paths: AppPaths, buffer: Buffer): Promise<ProfileXlsxImportResult> {
  const table = await extractProfileSheet(buffer);
  const { parsed, imageByRow, warnings, errors } = analyzeProfileSheet(paths, table);
  if (errors.length > 0) {
    throw new Error(errors[0]);
  }

  const imported = importPlayerProfiles(
    paths,
    parsed.players.map((player) => ({
      name: player.name,
      rank: player.rank,
      declaration: player.declaration,
      pets: player.pets,
    })),
  );

  // 以落盘结果重建 name→id（同名可能是旧 id、超限可能没落盘），同名取首个，与 importPlayerAvatarFiles 口径一致
  const idByName = new Map<string, string>();
  for (const entry of imported.profiles.players) {
    if (!idByName.has(entry.name)) {
      idByName.set(entry.name, entry.id);
    }
  }

  let matched = 0;
  const unmatched: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const player of parsed.players) {
    const image = imageByRow.get(player.rowNumber);
    if (!image) {
      continue;
    }
    const playerId = idByName.get(player.name);
    if (!playerId) {
      unmatched.push(player.name);
      continue;
    }
    if (image.buffer.length > MAX_AVATAR_BYTES) {
      failed.push({ name: player.name, reason: '头像文件超过大小上限（8MB）' });
      continue;
    }
    try {
      await saveProfilePlayerAvatar(paths, playerId, image.buffer);
      matched += 1;
    } catch (error) {
      failed.push({ name: player.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    profiles: getProfileStore(paths),
    review: imported.review,
    avatars: { matched, unmatched, failed },
    warnings,
  };
}
