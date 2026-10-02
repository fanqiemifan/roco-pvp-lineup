import ExcelJS, { type DataValidation } from 'exceljs';
import { describe, expect, it } from 'vitest';

import { parseLineupSheetTable, type LineupTemplatePlan } from '../../src/admin-antd/lib/lineup-sheet';
import {
  LINEUP_SHEET_NAME,
  SPRITE_LIST_SHEET_NAME,
  buildSpriteOptions,
  renderLineupTemplateXlsx,
} from '../../src/admin-antd/lib/lineup-template-xlsx';
import type { GameRecord, MatchRecord, MatchSlotSnapshot, SpriteRecord } from '../../shared/types';

/* ---------- 夹具 ---------- */

function makeSlot(slot: number, petId: string | null): MatchSlotSnapshot {
  return {
    slot,
    pet_id: petId,
    name: '',
    form: '',
    opacityEnabled: false,
    opacity: 0.5,
    saturation: 1,
    healthEnabled: true,
    healthPercent: 100,
    energyValue: 10,
  };
}

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

/** 单场计划：左方第 1 格已录 3005（回显预填），右方留空 */
function makePlan(): LineupTemplatePlan {
  const game: GameRecord = {
    gameNumber: 1,
    leftLineup: ['3005'],
    rightLineup: [],
    leftSlots: Array.from({ length: 6 }, (_unused, index) => makeSlot(index, index === 0 ? '3005' : null)),
    rightSlots: Array.from({ length: 6 }, (_unused, index) => makeSlot(index, null)),
    winner: null,
    status: 'pending',
  };
  const match: MatchRecord = {
    id: '20260928_A001',
    createdAt: '',
    updatedAt: '',
    status: 'pending',
    leftPlayer: '小明',
    rightPlayer: '小红',
    leftRank: '',
    rightRank: '',
    leftTeamId: '',
    leftTeamName: '',
    rightTeamId: '',
    rightTeamName: '',
    bestOf: 1,
    games: [game],
    leftScore: 0,
    rightScore: 0,
    winner: null,
    completedAt: null,
    tags: [],
  };
  return { count: 1, rows: [], targets: [{ match, firstGame: game, stageLabel: '4进2' }] };
}

/* ---------- 下拉选项 ---------- */

describe('buildSpriteOptions（下拉选项：最终形态 → `pet_id_名字（形态）`）', () => {
  it('只收最终形态、按 id 去重、按图鉴编号排序', () => {
    const options = buildSpriteOptions([
      makeSprite('3287', '岚鸟（秋天的样子）', { number: 287, isFinalForm: true }),
      makeSprite('3005', '水灵', { number: 5, isFinalForm: true }),
      makeSprite('3006', '火神', { number: 6 }), // 非最终形态 → 排除
      makeSprite('3005', '水灵', { number: 5, isFinalForm: true }), // 重复 id → 去重
    ]);
    expect(options.map((option) => option.label)).toEqual(['3005_水灵', '3287_岚鸟（秋天的样子）']);
  });
});

/* ---------- xlsx 渲染 ---------- */

describe('renderLineupTemplateXlsx（阵容表 + 隐藏精灵列表 + 跨表下拉）', () => {
  const sprites = [
    makeSprite('3005', '水灵', { number: 5, isFinalForm: true, attribute: '水' }),
    makeSprite('3287', '岚鸟（秋天的样子）', { number: 287, isFinalForm: true, attribute: '翼' }),
    makeSprite('3006', '火神', { number: 6 }), // 非最终形态不进下拉
  ];

  it('预填与下拉同格式；选项表隐藏且只含最终形态；校验范围跟随选项数', async () => {
    const data = await renderLineupTemplateXlsx({ recordName: '秋杯', plan: makePlan(), sprites });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as unknown as ArrayBuffer);

    // 工作表：阵容在前、精灵列表隐藏
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([LINEUP_SHEET_NAME, SPRITE_LIST_SHEET_NAME]);
    const lineupSheet = workbook.getWorksheet(LINEUP_SHEET_NAME);
    const listSheet = workbook.getWorksheet(SPRITE_LIST_SHEET_NAME);
    expect(listSheet?.state).toBe('hidden');

    // 阵容表：表头 + 一场两行；左行第 1 格回显 `pet_id_名字（形态）`，右行留空
    expect(lineupSheet?.getCell('A1').value).toBe('系列赛');
    expect(lineupSheet?.getCell('C2').value).toBe('20260928_A001');
    expect(lineupSheet?.getCell('D2').value).toBe('左');
    expect(lineupSheet?.getCell('F2').value).toBe('3005_水灵');
    expect(lineupSheet?.getCell('D3').value).toBe('右');
    expect(lineupSheet?.getCell('F3').value ?? '').toBe('');

    // 精灵列表：仅最终形态（含形态后缀），非最终形态不出现
    expect(listSheet?.getCell('A2').value).toBe('3005_水灵');
    expect(listSheet?.getCell('A3').value).toBe('3287_岚鸟（秋天的样子）');
    expect(listSheet?.getCell('B3').value).toBe(287);
    expect(listSheet?.getCell('C3').value).toBe('翼');
    expect(listSheet?.rowCount).toBe(3);

    // 跨表下拉：精灵1..6 覆盖全部数据行，公式指向精灵列表 A 列选项区
    const { dataValidations } = lineupSheet as unknown as {
      dataValidations?: { model: Record<string, DataValidation> };
    };
    const model = dataValidations?.model ?? {};
    expect(model.F2?.type).toBe('list');
    expect(model.F2?.formulae).toEqual(['精灵列表!$A$2:$A$3']);
    expect(model.K3?.formulae).toEqual(['精灵列表!$A$2:$A$3']);
  });

  it('无最终形态选项时不挂下拉（避免指向空区域）', async () => {
    const data = await renderLineupTemplateXlsx({
      recordName: '秋杯',
      plan: makePlan(),
      sprites: [makeSprite('3006', '火神', { number: 6 })],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
    const { dataValidations } = workbook.getWorksheet(LINEUP_SHEET_NAME) as unknown as {
      dataValidations?: { model: Record<string, DataValidation> };
    };
    expect(Object.keys(dataValidations?.model ?? {})).toHaveLength(0);
  });

  it('导出 → 解表 → 共用解析器：模板能被还原成规范化对局（导出 / 导入格式契约）', async () => {
    const data = await renderLineupTemplateXlsx({ recordName: '秋杯', plan: makePlan(), sprites });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet(LINEUP_SHEET_NAME);
    // 模拟服务端解表（lineup-xlsx-service 的通用形态）：逐格转字符串的二维表
    const table: string[][] = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let index = 1; index <= (sheet.columnCount ?? 0); index += 1) {
        cells.push(String(row.getCell(index).value ?? ''));
      }
      table.push(cells);
    });

    const parsed = parseLineupSheetTable(table);
    expect(parsed.errors).toEqual([]);
    // 预填 `pet_id_名字（形态）` 原样进入 token，导入侧按数字前缀精确命中 pet_id；右侧留空 = 保持原样
    expect(parsed.entries).toEqual([{ matchId: '20260928_A001', left: ['3005_水灵'], right: null }]);
  });

  it('整表浅灰细线框 + 隔场交替淡蓝底色：第 1 场整行有、第 2 场留白', async () => {
    const [first] = makePlan().targets;
    const second = { ...first, match: { ...first.match, id: '20260928_A002' } };
    const data = await renderLineupTemplateXlsx({
      recordName: '秋杯',
      plan: { count: 2, rows: [], targets: [first, second] },
      sprites,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet(LINEUP_SHEET_NAME);
    const fillArgb = (address: string): string | null => {
      const fill = sheet?.getCell(address).fill as { type?: string; fgColor?: { argb?: string } } | undefined;
      return fill?.type === 'pattern' ? (fill.fgColor?.argb ?? null) : null;
    };
    const borderStyle = (address: string, side: 'top' | 'left' | 'right' | 'bottom'): string | undefined => {
      const border = sheet?.getCell(address).border as Record<string, { style?: string } | undefined> | undefined;
      return border?.[side]?.style;
    };

    // 第 1 场 = 第 2、3 行（整行淡蓝）；第 2 场 = 第 4、5 行（留白）
    expect(fillArgb('A2')).toBe('FFE6F4FF');
    expect(fillArgb('K3')).toBe('FFE6F4FF');
    expect(fillArgb('A4')).toBeNull();
    expect(fillArgb('K5')).toBeNull();

    // 整表细线框：表头与数据格四周都有
    expect(borderStyle('A1', 'top')).toBe('thin');
    expect(borderStyle('A2', 'left')).toBe('thin');
    expect(borderStyle('K5', 'right')).toBe('thin');
    expect(borderStyle('K5', 'bottom')).toBe('thin');
  });
});