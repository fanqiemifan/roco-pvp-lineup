import ExcelJS, { type DataValidation } from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  PROFILE_GUIDE_SHEET_NAME,
  renderProfileTemplateXlsx,
  type ProfileTemplatePlayer,
} from '../../src/admin-antd/lib/profile-template-xlsx';
import { SPRITE_LIST_SHEET_NAME } from '../../src/admin-antd/lib/sprite-dropdown-xlsx';
import { PROFILE_HEADER, PROFILE_SHEET_NAME, parseProfileSheetRows } from '../../shared/profile-sheet';
import type { SpriteRecord } from '../../shared/types';

/* ---------- 夹具 ---------- */

/** 头像字节桩：仅用于验证图片被嵌入（exceljs 不解码像素，读到锚点即可） */
const AVATAR_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).buffer;

function makeSprite(id: string, name: string, patch: Partial<SpriteRecord> = {}): SpriteRecord {
  return {
    id,
    filename: `${id}_${name}.png`,
    displayName: name,
    name,
    path: `/img/${id}_${name}.png`,
    aliases: [],
    number: null,
    attribute: '',
    attributeCodes: [],
    attributeIcon1: '',
    attributeIcon2: '',
    iconUrl: '',
    form: '',
    petForm: '',
    isFinalForm: false,
    ...patch,
  };
}

function makePlayer(patch: Partial<ProfileTemplatePlayer>): ProfileTemplatePlayer {
  return {
    id: 'p1',
    name: '小明',
    pets: '',
    rank: '',
    declaration: '',
    avatarExists: false,
    avatarMtime: null,
    ...patch,
  };
}

const sprites = [
  makeSprite('3005', '水灵', { number: 5, isFinalForm: true, attribute: '水' }),
  makeSprite('3287', '岚鸟（秋天的样子）', { number: 287, isFinalForm: true, attribute: '翼' }),
  makeSprite('3006', '火神', { number: 6 }), // 非最终形态 → 不进下拉
];

async function loadWroteBytes(players: ProfileTemplatePlayer[]): Promise<ExcelJS.Workbook> {
  const data = await renderProfileTemplateXlsx({
    players,
    sprites,
    loadAvatarBytes: async (player) => (player.avatarExists ? AVATAR_BYTES : null),
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  return workbook;
}

/* ---------- 渲染 ---------- */

describe('renderProfileTemplateXlsx（选手表 + 隐藏精灵列表 + 跨表下拉 + 头像）', () => {
  it('工作表顺序、表头与预填：常用精灵回显 `pet_id_名字`，头像列留空', async () => {
    const workbook = await loadWroteBytes([
      makePlayer({ id: 'p1', name: '小明', rank: '100', declaration: '冲', pets: '水灵' }),
      makePlayer({ id: 'p2', name: '小红', pets: '' }),
    ]);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      PROFILE_SHEET_NAME,
      SPRITE_LIST_SHEET_NAME,
      PROFILE_GUIDE_SHEET_NAME,
    ]);
    const sheet = workbook.getWorksheet(PROFILE_SHEET_NAME);
    expect(sheet?.getCell('A1').value).toBe(PROFILE_HEADER[0]);
    expect(sheet?.getCell('J1').value).toBe('头像');
    expect(sheet?.getCell('A2').value).toBe('小明');
    expect(sheet?.getCell('B2').value).toBe('100');
    expect(sheet?.getCell('D2').value).toBe('3005_水灵');
    expect(sheet?.getCell('J2').value ?? '').toBe('');

    // 隐藏精灵列表：仅最终形态
    const listSheet = workbook.getWorksheet(SPRITE_LIST_SHEET_NAME);
    expect(listSheet?.state).toBe('hidden');
    expect(listSheet?.getCell('A2').value).toBe('3005_水灵');
    expect(listSheet?.getCell('A3').value).toBe('3287_岚鸟（秋天的样子）');
    expect(listSheet?.rowCount).toBe(3);

    // 数据行统一加高（含无头像的行），方便线下把图片拖进来贴合单元格
    expect(sheet?.getRow(2).height).toBe(54);
    expect(sheet?.getRow(3).height).toBe(54);
    // 填写说明提醒：先缩小图片、刚好贴合单元格
    const guideSheet = workbook.getWorksheet(PROFILE_GUIDE_SHEET_NAME);
    const guideText = ['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4', 'A5', 'B5', 'A6', 'B6', 'A7', 'B7']
      .map((address) => String(guideSheet?.getCell(address).value ?? ''))
      .join('\n');
    expect(guideText).toContain('缩小');
    expect(guideText).toContain('贴合单元格');
  });

  it('擅长精灵1..6 挂跨表下拉（D..I 覆盖数据行）', async () => {
    const workbook = await loadWroteBytes([
      makePlayer({ id: 'p1', name: '小明' }),
      makePlayer({ id: 'p2', name: '小红' }),
    ]);
    const { dataValidations } = workbook.getWorksheet(PROFILE_SHEET_NAME) as unknown as {
      dataValidations?: { model: Record<string, DataValidation> };
    };
    const model = dataValidations?.model ?? {};
    expect(model.D2?.type).toBe('list');
    expect(model.D2?.formulae).toEqual(['精灵列表!$A$2:$A$3']);
    expect(model.I3?.formulae).toEqual(['精灵列表!$A$2:$A$3']);
  });

  it('空白模板（无选手）也要挂下拉，并预置可填写行且加高', async () => {
    const workbook = await loadWroteBytes([]);
    const sheet = workbook.getWorksheet(PROFILE_SHEET_NAME);

    const { dataValidations } = sheet as unknown as {
      dataValidations?: { model: Record<string, DataValidation> };
    };
    const model = dataValidations?.model ?? {};
    // 下拉照挂：覆盖到 D2:I201（200 行，与档案上限一致），否则空白模板填的时候没得选
    expect(model.D2?.type).toBe('list');
    expect(model.D2?.formulae).toEqual(['精灵列表!$A$2:$A$3']);
    expect(model.I201?.formulae).toEqual(['精灵列表!$A$2:$A$3']);
    expect(model.I202).toBeUndefined();

    // 预置 60 行可填、均加高，直接放头像不用自己调行
    expect(sheet?.getRow(2).height).toBe(54);
    expect(sheet?.getRow(61).height).toBe(54);
    // 工作表默认行高也设为加高：用户往后新增/下拉覆盖到的行同样够高
    expect(sheet?.properties.defaultRowHeight).toBe(54);
  });

  it('模板与「导出信息」的数据行行高一致', async () => {
    const templateBook = await loadWroteBytes([]);
    const exportBook = await loadWroteBytes([
      makePlayer({ id: 'p1', name: '小明', pets: '水灵' }),
      makePlayer({ id: 'p2', name: '小红' }),
    ]);
    const templateSheet = templateBook.getWorksheet(PROFILE_SHEET_NAME);
    const exportSheet = exportBook.getWorksheet(PROFILE_SHEET_NAME);

    expect(templateSheet?.properties.defaultRowHeight).toBe(exportSheet?.properties.defaultRowHeight);
    [2, 3, 61].forEach((row) => {
      expect(templateSheet?.getRow(row).height).toBe(exportSheet?.getRow(row).height);
    });
  });

  it('头像按行锚定到「头像」列：仅有头像的选手行有图', async () => {
    const workbook = await loadWroteBytes([
      makePlayer({ id: 'p1', name: '小明', avatarExists: true }),
      makePlayer({ id: 'p2', name: '小红', avatarExists: false }),
      makePlayer({ id: 'p3', name: '小刚', avatarExists: true }),
    ]);
    const sheet = workbook.getWorksheet(PROFILE_SHEET_NAME);
    const images = sheet?.getImages() ?? [];
    expect(images).toHaveLength(2);
    // tl 的 nativeRow/nativeCol 为 0 基：小明在表格第 2 行 → nativeRow 1；头像列是第 10 列 → nativeCol 9
    const anchors = images
      .map((image) => ({ row: image.range.tl.nativeRow, col: image.range.tl.nativeCol }))
      .sort((left, right) => left.row - right.row);
    expect(anchors).toEqual([
      { row: 1, col: 9 },
      { row: 3, col: 9 },
    ]);
  });

  it('导出 → 解表 → 共用解析器：列契约能被还原（导入 / 导出往返一致）', async () => {
    const workbook = await loadWroteBytes([
      makePlayer({ id: 'p1', name: '小明', rank: '100', declaration: '冲', pets: '水灵' }),
    ]);
    const sheet = workbook.getWorksheet(PROFILE_SHEET_NAME);
    const rows: Array<{ rowNumber: number; cells: string[] }> = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let index = 1; index <= (sheet.columnCount ?? 0); index += 1) {
        cells.push(String(row.getCell(index).value ?? ''));
      }
      rows.push({ rowNumber: row.number, cells });
    });

    const parsed = parseProfileSheetRows(rows);
    expect(parsed.errors).toEqual([]);
    expect(parsed.players).toEqual([
      { rowNumber: 2, name: '小明', rank: '100', declaration: '冲', pets: '3005_水灵' },
    ]);
  });
});
