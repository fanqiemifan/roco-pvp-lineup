import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppPaths } from '../../electron/services/path-service';
import { createLocalServer, type LocalServer } from '../../electron/socket-server';

/**
 * 推流页面15（数据统计）静态资源伺服：页面文件缺失会导致推流载体切到该页时白屏。
 * page15 无独立数据接口（复用公开的 /api/stats/ranking），因此只验证三件套与 socket 角色。
 */

describe('推流页面15（数据统计）静态资源伺服', () => {
  let staticServer: LocalServer;
  let staticBase: string;

  beforeAll(async () => {
    // 项目根 = 仓库（页面/脚本/样式走真实文件），运行时数据仍落在临时目录
    const projectPaths = createAppPaths(process.cwd(), mkdtempSync(join(tmpdir(), 'roco-page15-static-')));
    mkdirSync(projectPaths.dataDir, { recursive: true });
    staticServer = await createLocalServer(projectPaths, 0, '127.0.0.1');
    staticBase = `http://127.0.0.1:${(staticServer.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await staticServer.close();
  });

  it('页面 / 脚本 / 样式文件都存在（页面文件缺失会导致空白画面）', () => {
    const repoPaths = createAppPaths(process.cwd(), process.cwd());
    expect(existsSync(join(repoPaths.pagesDir, 'roco-pvp-page15.html'))).toBe(true);
    expect(existsSync(join(repoPaths.scriptsDir, 'page15-display.js'))).toBe(true);
    expect(existsSync(join(repoPaths.stylesDir, 'roco-pvp-page15.css'))).toBe(true);
  });

  it('页面 / 脚本 / 样式均能取到，且页面引用了脚本与样式', async () => {
    const page = await fetch(`${staticBase}/roco-pvp-page15.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('/scripts/page15-display.js');
    expect(html).toContain('/styles/roco-pvp-page15.css');
    // 数据统计页无标题，不引用 scoreboard 标题
    expect(html).not.toContain('page15Title');

    const script = await fetch(`${staticBase}/scripts/page15-display.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("query: { role: 'page15' }");

    const style = await fetch(`${staticBase}/styles/roco-pvp-page15.css`);
    expect(style.status).toBe(200);
    expect(await style.text()).toContain('.page15-avatar');
  });
});
