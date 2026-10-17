import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createAppPaths } from '../../electron/services/path-service';
import { savePanelState } from '../../electron/services/state-service';
import { createLocalServer, type LocalServer } from '../../electron/socket-server';

/**
 * 推流页面17（阵容展示5）静态资源伺服与 socket 角色：
 * 页面文件缺失会导致推流载体切到该页时白屏；petscard2 组件是页面的阵容卡片来源，一并验证。
 * page17 无独立数据接口（复用公开的 /api/panels、/api/scoreboard、/api/avatars）。
 */

describe('推流页面17（阵容展示5）静态资源伺服', () => {
  let staticServer: LocalServer;
  let staticBase: string;

  beforeAll(async () => {
    // 项目根 = 仓库（页面/脚本/样式走真实文件），运行时数据仍落在临时目录
    const projectPaths = createAppPaths(process.cwd(), mkdtempSync(join(tmpdir(), 'roco-page17-static-')));
    mkdirSync(projectPaths.dataDir, { recursive: true });
    staticServer = await createLocalServer(projectPaths, 0, '127.0.0.1');
    staticBase = `http://127.0.0.1:${(staticServer.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await staticServer.close();
  });

  it('页面 / 脚本 / 样式 / petscard2 组件文件都存在（缺失会导致空白画面）', () => {
    const repoPaths = createAppPaths(process.cwd(), process.cwd());
    expect(existsSync(join(repoPaths.pagesDir, 'roco-pvp-page17.html'))).toBe(true);
    expect(existsSync(join(repoPaths.scriptsDir, 'page17-display.js'))).toBe(true);
    expect(existsSync(join(repoPaths.stylesDir, 'roco-pvp-page17.css'))).toBe(true);
    expect(existsSync(join(repoPaths.scriptsDir, 'petscard2.js'))).toBe(true);
    expect(existsSync(join(repoPaths.stylesDir, 'petscard2.css'))).toBe(true);
    // petscard2 复用 petscard 的属性映射，两份脚本都要在
    expect(existsSync(join(repoPaths.scriptsDir, 'petscard.js'))).toBe(true);
  });

  it('页面 / 脚本 / 样式均能取到，且页面引用了组件与脚本', async () => {
    const page = await fetch(`${staticBase}/roco-pvp-page17.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('/scripts/page17-display.js');
    expect(html).toContain('/scripts/petscard2.js');
    expect(html).toContain('/styles/roco-pvp-page17.css');
    expect(html).toContain('/styles/petscard2.css');

    const script = await fetch(`${staticBase}/scripts/page17-display.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("query: { role: 'page17' }");

    const style = await fetch(`${staticBase}/styles/roco-pvp-page17.css`);
    expect(style.status).toBe(200);
    expect(await style.text()).toContain('.page17-scoreboard');
  });
});

describe('page17 socket 角色：接收阵容面板广播', () => {
  let server: LocalServer;
  let base: string;
  let serverPaths: ReturnType<typeof createAppPaths>;

  function connectPage17(): Promise<Socket> {
    const client = ioClient(base, { transports: ['websocket'], query: { role: 'page17' } });
    return new Promise((resolve, reject) => {
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'roco-page17-socket-'));
    serverPaths = createAppPaths(root, root);
    mkdirSync(serverPaths.dataDir, { recursive: true });
    server = await createLocalServer(serverPaths, 0, '127.0.0.1');
    base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('page17 角色能收到 panel:update 广播（ROLES_FOR_PANEL 含 page17）', async () => {
    const client = await connectPage17();
    const panels: any[] = [];
    client.on('panel:update', (payload) => panels.push(payload));
    try {
      await vi.waitFor(() => expect(client.connected).toBe(true));
      // 直接落盘 + 经 socket-server 的保存路由触发广播
      const response = await fetch(`${base}/api/panels/left`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selected: [] }),
      });
      expect(response.ok).toBe(true);

      await vi.waitFor(() => expect(panels.length).toBeGreaterThan(0), { timeout: 2000 });
      expect(panels[0].panel?.position).toBe('left');
    } finally {
      client.close();
    }
  });

  it('savePanelState 落盘后 GET /api/panels 返回左侧面板', async () => {
    savePanelState(serverPaths, 'left', [
      { sprite: null },
      { sprite: null },
      { sprite: null },
      { sprite: null },
      { sprite: null },
      { sprite: null },
    ]);
    const response = await fetch(`${base}/api/panels`);
    expect(response.ok).toBe(true);
    const data = (await response.json()) as { panels: Array<{ position: string }> };
    expect(data.panels.some((panel) => panel.position === 'left')).toBe(true);
  });
});
