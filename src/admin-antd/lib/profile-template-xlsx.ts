import ExcelJS from 'exceljs';

import {
  PROFILE_AVATAR_COLUMN,
  PROFILE_HEADER,
  PROFILE_HEADER_WIDTHS,
  PROFILE_SHEET_NAME,
  buildProfileSheetTextRows,
  profileSpriteColumnRange,
} from '../../../shared/profile-sheet';
import type { SpriteRecord } from '../../../shared/types';
import { appendSpriteListSheet, attachSpriteDropdown, buildSpriteOptions } from './sprite-dropdown-xlsx';

/* ==================== 选手信息表格：xlsx 导出渲染（exceljs，带头像与精灵下拉） ==================== */

/** 「填写说明」工作表名（导出模板自带，帮线下填表） */
export const PROFILE_GUIDE_SHEET_NAME = '填写说明';

export interface ProfileTemplatePlayer {
  id: string;
  name: string;
  pets: string;
  rank: string;
  declaration: string;
  avatarExists: boolean;
  avatarMtime: number | null;
}

export interface RenderProfileTemplateInput {
  players: ProfileTemplatePlayer[];
  sprites: SpriteRecord[];
  /**
   * 取头像字节（供 exceljs `addImage({ buffer })` 嵌入）；返回 null 表示取不到、跳过。
   * 默认实现 fetch `/runtime/profiles/players/{id}.png?v={mtime}` 后取 ArrayBuffer；
   * 测试可注入桩函数（避免依赖网络 / FileReader）。
   */
  loadAvatarBytes?: (player: ProfileTemplatePlayer) => Promise<ArrayBuffer | null>;
}

/** 默认头像读取：档案头像在公开路径 `/runtime/profiles/players/{id}.png`（带 mtime 破缓存） */
async function defaultLoadAvatarBytes(player: ProfileTemplatePlayer): Promise<ArrayBuffer | null> {
  try {
    const suffix = player.avatarMtime ? `?v=${player.avatarMtime}` : '';
    const response = await fetch(`/runtime/profiles/players/${encodeURIComponent(player.id)}.png${suffix}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return null;
    }
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

const AVATAR_SIZE_PX = 48;
/** 数据行行高（磅）：比头像大一圈，留出余量方便线下把图片拖进来「贴合单元格」 */
const DATA_ROW_HEIGHT_PT = 54;
/**
 * 下拉校验覆盖的行数（与档案上限 MAX_PLAYERS=200 对齐）。
 * 必须固定覆盖到这么多行：空白模板没有任何数据行时也要挂上下拉，用户往下填才选得到精灵。
 */
const DROPDOWN_TOTAL_ROWS = 200;
/** 空白模板预置的可填数据行数：预置行才带有加高行高，直接放头像不用自己调行 */
const PADDED_ROWS = 60;

/**
 * 生成选手信息表格 .xlsx：
 * - 「选手信息」表：表头 + 每名选手一行（含预置空行，数据行加高方便放头像），擅长精灵拆 擅长精灵1..6 并全程挂下拉；头像以浮动图片锚定到该行「头像」列；
 * - 「精灵列表」表（隐藏）：最终形态选项，供 擅长精灵1..6 跨表下拉引用与人工查阅；
 * - 「填写说明」表：列含义与「头像用插入→图片（浮动图）、先缩小到贴合单元格」等注意事项。
 * 列序/表头与导入侧（shared/profile-sheet.ts 的 parseProfileSheetRows）同口径，保证往返一致。
 */
export async function renderProfileTemplateXlsx(
  input: RenderProfileTemplateInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const { players, sprites, loadAvatarBytes = defaultLoadAvatarBytes } = input;
  const textRows = buildProfileSheetTextRows(players, sprites);
  const options = buildSpriteOptions(sprites);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(PROFILE_SHEET_NAME);
  // 工作表默认行高：用户往后新增的行（含下拉覆盖到的 200 行）都自动是加高行，不用自己调
  sheet.properties.defaultRowHeight = DATA_ROW_HEIGHT_PT;
  const headerRow = sheet.addRow(PROFILE_HEADER);
  headerRow.font = { bold: true };
  textRows.forEach((row) => sheet.addRow(row));
  sheet.columns = PROFILE_HEADER.map((_unused, index) => ({ width: PROFILE_HEADER_WIDTHS[index] ?? 16 }));
  // 预置若干空行并给数据行显式行高（表头行不动）：空白模板也能直接往下填、直接放头像
  const paddedRowCount = Math.max(textRows.length, PADDED_ROWS);
  for (let index = 0; index < paddedRowCount; index += 1) {
    sheet.getRow(index + 2).height = DATA_ROW_HEIGHT_PT;
  }
  // 冻结表头行：长名单滚动时列名始终可见
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // 头像：仅 `avatarExists` 的选手，逐张锚定到该行「头像」列（tl 的 row/col 为 0 基；表头独占第 1 行）
  await Promise.all(
    players.map(async (player, index) => {
      if (!player.avatarExists) {
        return;
      }
      const bytes = await loadAvatarBytes(player);
      if (!bytes) {
        return;
      }
      try {
        const imageId = workbook.addImage({ buffer: bytes, extension: 'png' });
        const row = index + 1;
        sheet.addImage(imageId, {
          tl: { col: PROFILE_AVATAR_COLUMN, row },
          ext: { width: AVATAR_SIZE_PX, height: AVATAR_SIZE_PX },
        });
      } catch {
        // 单张头像嵌入失败不影响整份导出
      }
    }),
  );

  appendSpriteListSheet(workbook, options);
  // 下拉与数据行无关：始终覆盖到 DROPDOWN_TOTAL_ROWS（空白模板 textRows 为空也必须挂，否则用户填的时候没得选）
  attachSpriteDropdown(sheet, profileSpriteColumnRange(DROPDOWN_TOTAL_ROWS + 1), options.length);

  const guide = workbook.addWorksheet(PROFILE_GUIDE_SHEET_NAME);
  [
    ['列', '说明'],
    ['名字', '必填；同名视为同一位选手，导入时更新其排名 / 宣言 / 常用精灵并保留原头像'],
    ['排位排名', '仅数字；留空表示未填写'],
    ['宣言', '可选，最长 120 字'],
    ['擅长精灵1..擅长精灵6', '擅长精灵，从下拉列表中选择（格式 pet_id_名字）；最多 6 只，留空表示未填'],
    ['头像', '请把图片缩小到约一个单元格大小，再用「插入 → 图片」放到该行「头像」格、刚好贴合单元格四边；'],
    ['', '数据行已特意加高，放进去更省事；勿用 WPS「嵌入单元格」方式插入（本项目读不到），一张图对一位选手'],
  ].forEach((line) => guide.addRow(line));
  guide.columns = [{ width: 14 }, { width: 72 }];

  const written = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
  const source = written instanceof Uint8Array ? written : new Uint8Array(written);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}
