/**
 * 「悬浮窗操作练习页」（/float-guide-demo.html）的伺服与鉴权契约。
 *
 * 这一页是后台新手引导里 iframe 内嵌的练习页（纯仿真，不连 socket、不写运行时数据），
 * 但它有两处**代码读不出来的约定**，改动时最容易踩：
 * 1. 路由必须注册在鉴权守卫**之前**（与 float*.html 同一段），否则 Node/Docker 模式下 iframe 会拿到 302/401；
 * 2. 路径必须在公开页面白名单里 —— 引导是登录后从后台打开的，而 iframe 的请求也走同一套守卫，
 *    漏了这一项在**开启鉴权**的部署上就是白屏（桌面模式关闭鉴权，本地跑不出来）。
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { createAppPaths } from '../../electron/services/path-service';

const DEMO_PATH = '/float-guide-demo.html';
const DEMO_PROJECT_ROOT = join(process.cwd(), 'src', 'pages');

let demoServer: LocalServer;
let guardedServer: LocalServer;
let demoBase: string;
let guardedBase: string;

beforeAll(async () => {
  // 鉴权关闭的服务器：直接打静态路由（pagesDir 指向真实项目，静态路由才能读到页面文件）
  const openRoot = mkdtempSync(join(tmpdir(), 'roco-guide-demo-'));
  const openPaths = createAppPaths(openRoot, openRoot);
  mkdirSync(openPaths.dataDir, { recursive: true });
  openPaths.pagesDir = DEMO_PROJECT_ROOT;
  demoServer = await createLocalServer(openPaths, 0, '127.0.0.1');
  demoBase = `http://127.0.0.1:${(demoServer.server.address() as AddressInfo).port}`;

  // 鉴权开启的服务器：页面目录指向真实项目（白名单行为本身与文件内容无关）
  const guardedRoot = mkdtempSync(join(tmpdir(), 'roco-guide-demo-auth-'));
  const guardedPaths = createAppPaths(guardedRoot, guardedRoot);
  mkdirSync(guardedPaths.dataDir, { recursive: true });
  guardedPaths.pagesDir = DEMO_PROJECT_ROOT;
  guardedServer = await createLocalServer(guardedPaths, 0, '127.0.0.1', {
    username: 'admin',
    password: 'admin123',
  });
  guardedBase = `http://127.0.0.1:${(guardedServer.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await demoServer.close();
  await guardedServer.close();
});

describe('GET /float-guide-demo.html（悬浮窗操作练习页）', () => {
  it('返回 HTML 页面（静态路由已注册）', async () => {
    const response = await fetch(`${demoBase}${DEMO_PATH}`);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('悬浮窗操作练习');
    // 页面自身必须显式声明"这是模拟页"，避免裁判误以为在改真实阵容
    expect(html).toContain('模拟页');
  });

  it('开启鉴权时也能直接访问（在公开页面白名单里，否则引导内嵌 iframe 会白屏）', async () => {
    const response = await fetch(`${guardedBase}${DEMO_PATH}`, { redirect: 'manual' });
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('悬浮窗操作练习');
  });

  it('页面引用的脚本与样式在项目里真实存在（改文件名不会静默 404）', () => {
    const html = readFileSync(join(DEMO_PROJECT_ROOT, 'float-guide-demo.html'), 'utf-8');
    const scriptMatch = html.match(/src="\/scripts\/([^"]+)"/);
    const styleMatch = html.match(/href="\/styles\/([^"]+)"/);
    expect(scriptMatch?.[1], '页面里应引用 /scripts/float-guide-demo.js').toBeTruthy();
    expect(styleMatch?.[1], '页面里应引用 /styles/float-guide-demo.css').toBeTruthy();

    expect(() => readFileSync(join(process.cwd(), 'src', 'scripts', scriptMatch![1]), 'utf-8')).not.toThrow();
    expect(() => readFileSync(join(process.cwd(), 'src', 'styles', styleMatch![1]), 'utf-8')).not.toThrow();
  });

  it('练习页不连 socket、不调 /api/panels（纯仿真，绝不能改真实阵容）', () => {
    const script = readFileSync(join(process.cwd(), 'src', 'scripts', 'float-guide-demo.js'), 'utf-8');
    // 先剥掉注释再断言：文件里刻意写了「不调 /api/panels」这类说明，直接字符串匹配会误报
    const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('/api/panels');
    expect(code).not.toContain('socket');
    // 练习页不参与引导进度存储（进度只由后台侧写 guide:roco-pvp:v1）
    expect(code).not.toContain('localStorage');
  });
});
