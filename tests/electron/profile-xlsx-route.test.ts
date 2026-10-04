import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import sharp from 'sharp';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { PROFILE_HEADER } from '../../shared/profile-sheet';

/* ---------- 夹具与工具 ---------- */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** 头像图片 dataURL（在 beforeAll 里用 sharp 现做一张合法 PNG，确保能过魔数校验 + sharp 处理） */
let pngDataUrl = '';

let server: LocalServer;
let base: string;
let paths: AppPaths;

/** 精灵库夹具：pets.json 索引 + spritesDir 对应文件（缺图条目不收录） */
function writeSpriteLibrary(): void {
  writeFileSync(
    join(paths.dataDir, 'pets.json'),
    JSON.stringify({ items: [{ pet_id: '1001', name: '暮星辰', handbook_no: 1 }] }),
    'utf-8',
  );
  writeFileSync(join(paths.spritesDir, '1001_暮星辰.png'), 'png');
}

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
  filename = 'players.xlsx',
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: XLSX_MIME }), filename);
  const response = await fetch(`${base}${pathname}`, { method: 'POST', body: form });
  return { status: response.status, data: await response.json() };
}

/** 模板：表头 + 小明（带浮动头像，锚定到「头像」列第 2 行）+ 小红（无头像） */
function buildPlayersSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet('选手信息');
  sheet.addRow(PROFILE_HEADER);
  sheet.addRow(['小明', 100, '冲', '1001_暮星辰', '', '', '', '', '', '']);
  sheet.addRow(['小红', '', '', '', '', '', '', '', '', '']);
  const imageId = workbook.addImage({ base64: pngDataUrl, extension: 'png' });
  // tl 的 col/row 为 0 基：第 2 行 → row 1；头像列（第 10 列）→ col 9
  sheet.addImage(imageId, { tl: { col: 9, row: 1 }, ext: { width: 48, height: 48 } });
}

beforeAll(async () => {
  const pngBuffer = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 60, b: 60, alpha: 1 } },
  }).png().toBuffer();
  pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

  const root = mkdtempSync(join(tmpdir(), 'roco-profile-xlsx-http-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.spritesDir, { recursive: true });
  writeSpriteLibrary();
  saveRuntimeConfig(paths, { machineCode: 'A' });

  // 不传 authConfig = 鉴权关闭
  server = await createLocalServer(paths, 0, '127.0.0.1');
  const port = (server.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe('POST /api/profiles/players/import/parse-xlsx（解表预览）', () => {
  it('返回按列映射的选手行 + 头像有无', async () => {
    const buffer = await buildWorkbookBuffer(buildPlayersSheet);
    const { status, data } = await uploadXlsx('/api/profiles/players/import/parse-xlsx', buffer);
    expect(status).toBe(200);
    expect(data.players).toEqual([
      expect.objectContaining({ rowNumber: 2, name: '小明', rank: '100', pets: '1001_暮星辰', hasAvatar: true }),
      expect.objectContaining({ rowNumber: 3, name: '小红', hasAvatar: false }),
    ]);
    expect(data.errors).toEqual([]);
  });

  it('非 .xlsx / 损坏文件 → 400', async () => {
    const buffer = await buildWorkbookBuffer(buildPlayersSheet);
    const wrongName = await uploadXlsx('/api/profiles/players/import/parse-xlsx', buffer, 'players.csv');
    expect(wrongName.status).toBe(400);

    const broken = await uploadXlsx('/api/profiles/players/import/parse-xlsx', new Uint8Array([1, 2, 3, 4]));
    expect(broken.status).toBe(400);
    expect(String(broken.data.error)).toContain('无法读取 Excel');
  });
});

describe('POST /api/profiles/players/import-xlsx（正式导入 + 落头像）', () => {
  it('写入选手信息、常用精灵命中 pets.json、浮动头像按行落到对应选手', async () => {
    const buffer = await buildWorkbookBuffer(buildPlayersSheet);
    const { status, data } = await uploadXlsx('/api/profiles/players/import-xlsx', buffer);
    expect(status).toBe(200);

    const ming = data.profiles.players.find((player: { name: string }) => player.name === '小明');
    expect(ming).toBeTruthy();
    expect(ming.pets).toBe('暮星辰');
    expect(ming.rank).toBe('100');
    expect(data.avatars).toEqual({ matched: 1, unmatched: [], failed: [] });
    expect(ming.avatarExists).toBe(true);

    // 头像真正落盘（魔数校验 + sharp 压缩后的 PNG）
    const avatarPath = paths.profilePlayerAvatarFile(ming.id);
    expect(existsSync(avatarPath)).toBe(true);
    expect(readFileSync(avatarPath).length).toBeGreaterThan(0);

    // 小红无头像
    const hong = data.profiles.players.find((player: { name: string }) => player.name === '小红');
    expect(hong.avatarExists).toBe(false);
  });

  it('有图但该行没有名字 → 忽略并给出提示', async () => {
    const buffer = await buildWorkbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet('选手信息');
      sheet.addRow(PROFILE_HEADER);
      // 该行有内容（宣言列）但名字为空：会被判为「缺少名字」跳过，头像也随之忽略
      sheet.addRow(['', '', '备注', '', '', '', '', '', '', '']);
      const imageId = workbook.addImage({ base64: pngDataUrl, extension: 'png' });
      sheet.addImage(imageId, { tl: { col: 9, row: 1 }, ext: { width: 48, height: 48 } });
    });
    const { status, data } = await uploadXlsx('/api/profiles/players/import-xlsx', buffer);
    // 所有数据行都缺名字 → 无可导入选手，直接 400
    expect(status).toBe(400);
    expect(String(data.error)).toContain('没有可导入的选手');
  });
});
