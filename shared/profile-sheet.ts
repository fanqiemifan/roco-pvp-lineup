import type { PlayerProfile, SpriteRecord } from './types.js';

/* ==================== 选手信息表格：导入/导出共用的列契约与纯函数 ==================== */

/**
 * 「选手信息」工作表名：导出与导入都按它定位（导不出来、导不进去基本都是这里对不上）。
 * 前端导出（profile-template-xlsx.ts）与后端解表（profile-xlsx-service.ts）共用本文件的常量与纯函数，
 * 保证两侧口径永远一致 —— 别再各写一份表头。
 */
export const PROFILE_SHEET_NAME = '选手信息';

/** 「常用精灵」拆成的编号列数量：与系列赛阵容模板同构（多列才能各自挂下拉，单格多值没法用下拉） */
export const PROFILE_SPRITE_COLUMN_COUNT = 6;

/** 表头（列序即导出/导入口径） */
export const PROFILE_HEADER = [
  '名字',
  '排位排名',
  '宣言',
  '精灵1',
  '精灵2',
  '精灵3',
  '精灵4',
  '精灵5',
  '精灵6',
  '头像',
];

/** 列宽（仅导出时的视觉辅助） */
export const PROFILE_HEADER_WIDTHS = [16, 12, 28, 22, 22, 22, 22, 22, 22, 12];

/** 「头像」列下标（0 基）：图片锚点落在此列的行；导入时优先取这一列上的图片 */
export const PROFILE_AVATAR_COLUMN = PROFILE_HEADER.length - 1;

/** 头像图片锚点容差说明：图片按 `tl.nativeRow + 1` 对到工作表行号，同行多图取最接近「头像」列者 */

export interface ProfileSheetRow {
  /** 工作表真实行号（1 基）：图片锚点对行要靠它，不能只存数组下标 */
  rowNumber: number;
  /** 该行单元格文本（已去首尾空白后的原始值） */
  cells: string[];
}

export interface ProfileSheetPlayer {
  /** 来源行号（用于把该行的头像图片配回来） */
  rowNumber: number;
  name: string;
  rank: string;
  declaration: string;
  /** 常用精灵：多个名字以「、」连接（与 PlayerProfile.pets 同口径） */
  pets: string;
}

export interface ProfileSheetParseResult {
  players: ProfileSheetPlayer[];
  /** 命中的表头行号（1 基），未命中为 null */
  headerRowNumber: number | null;
  errors: string[];
  warnings: string[];
}

interface ProfileColumnMap {
  name: number;
  rank: number;
  declaration: number;
  /** 精灵1..6 的列下标（缺列为 undefined） */
  slots: Array<number | undefined>;
  /** 单列「常用精灵」兜底列下标（-1 = 无） */
  singlePets: number;
  avatar: number;
}

/* ---------- 文本工具 ---------- */

/** 全角 → 半角（表头匹配前先归一，兼容 WPS 输入法全角） */
function toHalfWidth(value: string): string {
  return value.replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

function normalizeHeaderToken(value: string): string {
  return toHalfWidth(String(value ?? '')).trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 排名只保留数字（与 profile-service 的 normalizeRank 同口径，预览与落盘一致）。
 * 纯小数（如 Excel 数值单元格出来的 `100.0`）取整数部分，避免被当成 `1000`。
 */
function normalizeRank(value: string): string {
  const text = String(value ?? '').trim();
  const decimal = /^(\d+)\.\d+$/.exec(text);
  const digits = decimal ? decimal[1] : text.replace(/\D/g, '');
  return digits.slice(0, 10);
}

/**
 * 单元格 → 精灵名字 token 列表：
 * 先按明确分隔符（顿号 / 逗号 / 斜杠 / 分号 / 管道）拆段；
 * 段内若为「#?数字 空格 名字」（pet_id / 图鉴编号写法）保持为一段，否则再按空白拆。
 */
export function splitProfilePetTokens(cell: string): string[] {
  const segments = String(cell ?? '')
    .split(/[，,、/／;；|]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.flatMap((segment) => {
    if (/^#?\d{2,4}[_\s]/.test(segment)) {
      return [segment];
    }
    const parts = segment.split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts : [segment];
  });
}

/* ---------- 表头定位与列映射 ---------- */

function locateProfileColumns(header: string[]): ProfileColumnMap | null {
  const tokens = header.map(normalizeHeaderToken);
  const name = tokens.findIndex(
    (cell) => cell === 'name' || cell.includes('名字') || cell.includes('姓名') || cell.includes('选手'),
  );
  if (name === -1) {
    return null;
  }
  const rank = tokens.findIndex((cell) => cell === 'rank' || cell.includes('排位') || cell.includes('排名'));
  const declaration = tokens.findIndex(
    (cell) => cell === 'declaration' || cell.includes('宣言') || cell.includes('签名') || cell.includes('口号'),
  );
  const slots: Array<number | undefined> = [];
  let singlePets = -1;
  let avatar = -1;
  tokens.forEach((cell, index) => {
    const numbered = /^(精灵|slot|fill)([1-6])$/.exec(cell);
    if (numbered) {
      slots[Number(numbered[2]) - 1] = index;
      return;
    }
    if (cell === 'avatar' || cell.includes('头像') || cell.includes('照片') || cell.includes('图片')) {
      if (avatar === -1) {
        avatar = index;
      }
      return;
    }
    if (singlePets === -1 && (cell.includes('精灵') || cell.includes('常用'))) {
      singlePets = index;
    }
  });
  return { name, rank, declaration, slots, singlePets, avatar };
}

/**
 * 二维表（带真实行号）→ 选手条目。
 * 表头在前 5 个非空行内定位（需含「名字」列）；精灵支持 `精灵1..6` 编号列或单个「常用精灵」列。
 * 空名字行跳过并给出行号提示；同名重复给 warning（导入时后者覆盖前者）。
 */
export function parseProfileSheetRows(rows: ProfileSheetRow[]): ProfileSheetParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nonEmpty = rows.filter((row) => row.cells.some((cell) => String(cell ?? '').trim() !== ''));
  if (nonEmpty.length < 2) {
    return { players: [], headerRowNumber: null, errors: ['没有识别到数据行（需要表头 + 至少一名选手）'], warnings };
  }

  // 表头判据：既有「名字」列、又有常用精灵列 —— 只认名字列会把标题/备注行（如「选手信息登记表」）误当表头
  const isHeaderRow = (cells: string[]): boolean => {
    const columns = locateProfileColumns(cells);
    return columns !== null && (columns.slots.some((value) => value !== undefined) || columns.singlePets !== -1);
  };
  const headerIndex = nonEmpty.slice(0, 5).findIndex((row) => isHeaderRow(row.cells));
  if (headerIndex === -1) {
    const hasNameColumn = nonEmpty.slice(0, 5).some((row) => locateProfileColumns(row.cells) !== null);
    return {
      players: [],
      headerRowNumber: null,
      errors: [
        hasNameColumn
          ? '表头缺少常用精灵列（需要「精灵1..精灵6」或单个「常用精灵」列）'
          : '表头缺少可识别的「名字」列（支持 名字 / 选手 / 姓名 / name）',
      ],
      warnings,
    };
  }
  const headerRow = nonEmpty[headerIndex];
  const columns = locateProfileColumns(headerRow.cells) as ProfileColumnMap;
  const hasSlots = columns.slots.some((value) => value !== undefined);

  const players: ProfileSheetPlayer[] = [];
  const seenNames = new Set<string>();
  nonEmpty.slice(headerIndex + 1).forEach((row) => {
    const name = String(row.cells[columns.name] ?? '').trim().slice(0, 32);
    const hasContent = row.cells.some((cell) => String(cell ?? '').trim() !== '');
    if (!name) {
      if (hasContent) {
        warnings.push(`第 ${row.rowNumber} 行缺少名字，已跳过`);
      }
      return;
    }
    const tokens: string[] = [];
    if (hasSlots) {
      columns.slots.forEach((slotIndex) => {
        if (slotIndex === undefined) {
          return;
        }
        tokens.push(...splitProfilePetTokens(String(row.cells[slotIndex] ?? '')));
      });
    } else {
      tokens.push(...splitProfilePetTokens(String(row.cells[columns.singlePets] ?? '')));
    }
    const pets = Array.from(new Set(tokens)).slice(0, PROFILE_SPRITE_COLUMN_COUNT).join('、');
    const rank = columns.rank === -1 ? '' : normalizeRank(String(row.cells[columns.rank] ?? ''));
    const declaration = columns.declaration === -1 ? '' : String(row.cells[columns.declaration] ?? '').trim().slice(0, 120);
    if (seenNames.has(name)) {
      warnings.push(`第 ${row.rowNumber} 行「${name}」在表内重复，导入时以最后一行为准`);
    }
    seenNames.add(name);
    players.push({ rowNumber: row.rowNumber, name, rank, declaration, pets });
  });

  if (players.length === 0) {
    errors.push('没有可导入的选手（所有数据行都缺少名字）');
  }
  return { players, headerRowNumber: headerRow.rowNumber, errors, warnings };
}

/* ---------- 导出预填 ---------- */

/** displayName → 精灵：优先最终形态（同一短名多形态时，导出回显用最终形态的 `pet_id_名字（形态）`） */
function buildDisplayNameIndex(sprites: SpriteRecord[]): Map<string, SpriteRecord> {
  const index = new Map<string, SpriteRecord>();
  for (const sprite of sprites) {
    const key = sprite.displayName?.trim();
    if (!key) {
      continue;
    }
    const existing = index.get(key);
    if (!existing || (!existing.isFinalForm && sprite.isFinalForm)) {
      index.set(key, sprite);
    }
  }
  return index;
}

/**
 * 导出数据行：`名字 / 排位排名 / 宣言 / 精灵1..6 / 头像(留空)`。
 * 常用精灵按 displayName 反查精灵，回显成下拉同格式的 `pet_id_名字（形态）`；查不到则原样保留。
 */
export function buildProfileSheetTextRows(players: PlayerProfile[], sprites: SpriteRecord[]): string[][] {
  const spriteByName = buildDisplayNameIndex(sprites);
  return players.map((player) => {
    const tokens = splitProfilePetTokens(player.pets ?? '');
    const labels = tokens.slice(0, PROFILE_SPRITE_COLUMN_COUNT).map((token) => {
      const sprite = spriteByName.get(token);
      return sprite ? `${sprite.id}_${sprite.name}` : token;
    });
    return [
      player.name,
      player.rank ?? '',
      player.declaration ?? '',
      ...Array.from({ length: PROFILE_SPRITE_COLUMN_COUNT }, (_unused, index) => labels[index] ?? ''),
      '',
    ];
  });
}

/** 精灵编号列区域（Excel 列号字符串，如 D..I）：挂下拉校验用 */
export function profileSpriteColumnRange(lastRow: number): string {
  const startColumn = 3; // 0 基：第 4 列（精灵1）
  const toLetters = (index: number): string => String.fromCharCode(65 + index);
  return `${toLetters(startColumn)}2:${toLetters(startColumn + PROFILE_SPRITE_COLUMN_COUNT - 1)}${lastRow}`;
}
