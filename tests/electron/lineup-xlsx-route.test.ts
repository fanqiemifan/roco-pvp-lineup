import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

/* ---------- 夹具与工具 ---------- */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let server: LocalServer;
let base: string;
let paths: AppPaths;
let tournamentId = '';

/** 用 exceljs 生成真实 .xlsx 字节（与导出模板同工具），返回可安全传入 Blob 的普通 Uint8Array */
async function buildWorkbookBuffer(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  const written = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
  const source = written instanceof Uint8Array ? written : new Uint8Array(written);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}

async function uploadXlsx(
  pathname: string,
  buffer: Uint8Array<ArrayBuffer>,
  filename = 'template.xlsx',
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: XLSX_MIME }), filename);
  const response = await fetch(`${base}${pathname}`, { method: 'POST', body: form });
  return { status: response.status, data: await response.json() };
}

/** 最小合法模板：表头 + 一行左侧 */
function fillMinimalLineupSheet(workbook: ExcelJS.Workbook, sheetName = '阵容'): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(['系列赛', '阶段', '对局ID', '位置', '选手', '精灵1', '精灵2', '精灵3', '精灵4', '精灵5', '精灵6']);
  sheet.addRow(['回填杯', '首轮', '20260928_A001', '左', '小明', '3005_水灵', '', '', '', '', '']);
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-lineup-xlsx-http-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });

  // 不传 authConfig = 鉴权关闭
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;

  for (let index = 0; index < 4; index += 1) {
    savePlayerProfile(paths, { id: `p${index}`, name: `选手${index}` });
  }
  const response = await fetch(`${base}/api/tournaments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '回填杯', playerIds: ['p0', 'p1', 'p2', 'p3'], seed: 5 }),
  });
  tournamentId = ((await response.json()) as { tournament: { id: string } }).tournament.id;
});

afterAll(async () => {
  await server.close();
});

describe('POST /api/tournaments/:id/lineup-import/parse-xlsx（服务端解表）', () => {
  it('读取「阵容」表 → 二维字符串表；数字 / 富文本 / 公式结果都归一为文本', async () => {
    const buffer = await buildWorkbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet('阵容');
      sheet.addRow(['系列赛', '阶段', '对局ID', '位置', '选手', '精灵1', '精灵2', '精灵3', '精灵4', '精灵5', '精灵6']);
      sheet.addRow(['回填杯', '首轮', '20260928_A001', '左', '小明', '3005_水灵', '', '', '', '', '']);
      sheet.addRow(['回填杯', '首轮', '20260928_A001', '右', '小红', '', '', '', '', '', '']);
      sheet.getCell('F3').value = 3287; // 数字单元格 → '3287'
      sheet.getCell('G3').value = { richText: [{ text: '岚鸟（' }, { text: '秋天的样子）' }] };
      sheet.getCell('H3').value = { formula: 'CONCATENATE("3005","_水灵")', result: '3005_水灵' };
    });

    const { status, data } = await uploadXlsx(`/api/tournaments/${tournamentId}/lineup-import/parse-xlsx`, buffer);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.sheetName).toBe('阵容');
    expect(data.table).toHaveLength(3);
    expect(data.table[0].slice(0, 6)).toEqual(['系列赛', '阶段', '对局ID', '位置', '选手', '精灵1']);
    expect(data.table[1].slice(0, 6)).toEqual(['回填杯', '首轮', '20260928_A001', '左', '小明', '3005_水灵']);
    expect(data.table[2].slice(5, 8)).toEqual(['3287', '岚鸟（秋天的样子）', '3005_水灵']);
  });

  it('无「阵容」表时退回第一个工作表；另有一张「精灵列表」在前也仍按名读取', async () => {
    const fallback = await uploadXlsx(
      `/api/tournaments/${tournamentId}/lineup-import/parse-xlsx`,
      await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Sheet1');
        sheet.addRow(['对局ID', '位置', '精灵1']);
        sheet.addRow(['20260928_A001', '左', '3005_水灵']);
      }),
    );
    expect(fallback.status).toBe(200);
    expect(fallback.data.sheetName).toBe('Sheet1');
    expect(fallback.data.table).toEqual([
      ['对局ID', '位置', '精灵1'],
      ['20260928_A001', '左', '3005_水灵'],
    ]);

    const namePriority = await uploadXlsx(
      `/api/tournaments/${tournamentId}/lineup-import/parse-xlsx`,
      await buildWorkbookBuffer((workbook) => {
        workbook.addWorksheet('精灵列表').addRow(['精灵选项']);
        fillMinimalLineupSheet(workbook);
      }),
    );
    expect(namePriority.status).toBe(200);
    expect(namePriority.data.sheetName).toBe('阵容');
    expect(namePriority.data.table[0][2]).toBe('对局ID');
  });

  it('非 xlsx / 无法读取的文件 / 缺文件 / 系列赛不存在 → 400 / 404 明确报错', async () => {
    const wrongExtension = await uploadXlsx(
      `/api/tournaments/${tournamentId}/lineup-import/parse-xlsx`,
      await buildWorkbookBuffer(fillMinimalLineupSheet),
      'template.csv',
    );
    expect(wrongExtension.status).toBe(400);
    expect(wrongExtension.data.error).toContain('.xlsx');

    const broken = await uploadXlsx(
      `/api/tournaments/${tournamentId}/lineup-import/parse-xlsx`,
      new Uint8Array(new TextEncoder().encode('not a zip')),
    );
    expect(broken.status).toBe(400);
    expect(broken.data.error).toContain('无法读取 Excel');

    const missingFile = await fetch(`${base}/api/tournaments/${tournamentId}/lineup-import/parse-xlsx`, {
      method: 'POST',
      body: new FormData(),
    });
    expect(missingFile.status).toBe(400);
    expect(((await missingFile.json()) as { error: string }).error).toContain('缺少文件');

    const notFound = await uploadXlsx(
      '/api/tournaments/20260928_Z99/lineup-import/parse-xlsx',
      await buildWorkbookBuffer(fillMinimalLineupSheet),
    );
    expect(notFound.status).toBe(404);
  });
});