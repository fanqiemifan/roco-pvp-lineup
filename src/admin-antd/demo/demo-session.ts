/**
 * 模拟会话的「引导层」：把浏览器网络出口整块换成内存 store。
 *
 * 拦截面（四类，缺一类就有真实流量漏出去的风险）：
 * - `window.fetch`      —— REST 读写（全部 /api/*）
 * - `XMLHttpRequest`    —— 少数走 XHR 的上传/下载路径
 * - `WebSocket`         —— 兜底：socket.io 万一降级到 ws 传输，也不许连真实服务端
 * - `navigator.sendBeacon` —— 关页时的埋点类请求
 *
 * socket.io 的 `io()` 由 Vite 插件在构建期换成假连接（见 vite.config.ts 的 demoSocketMockPlugin），
 * 原因是静态 import 没法在运行期替换模块。
 *
 * 安全边界：本模块只在**模拟会话页面**加载（main.tsx 里按 URL 参数动态 import），
 * 绝不在真机后台加载；且所有未命中路由都走"通用兜底"返回假成功，不做透传。
 */

import type { DemoStore } from './demo-store';
import { createDemoStore } from './demo-store';

interface DemoWindow extends Window {
  __ROCO_DEMO__?: {
    store: DemoStore;
    reset(): void;
    describe(): { matches: number; tournaments: number };
  };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** 安装 fetch / XHR / WebSocket / beacon 拦截 */
function installNetworkGuard(store: DemoStore): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET') ?? 'GET').toUpperCase();

    const result = store.handle(method, rawUrl, init);
    if (result === null) {
      // 非 /api/* 请求（静态资源、预览 iframe 等）原样放行
      return originalFetch(input as RequestInfo, init);
    }
    // handle 返回的就是 Response 对象（见 demo-store.makeResponse），FormData 上传同样由通用兜底接住
    return result as unknown as Response;
  };

  // XMLHttpRequest：把 open/send 拦掉，直接派发假响应
  const OriginalXhr = window.XMLHttpRequest;
  class DemoXhr extends OriginalXhr {
    private demoMethod = 'GET';
    private demoUrl = '';

    open(method: string, url: string | URL, ...rest: unknown[]): void {
      this.demoMethod = method.toUpperCase();
      this.demoUrl = String(url);
      if (!this.demoUrl.startsWith('/api/')) {
        // 非 API 请求交给原生实现（预览 iframe 之类）
        (super.open as unknown as (...args: unknown[]) => void)(method, url, ...rest);
      }
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (!this.demoUrl.startsWith('/api/')) {
        super.send(body as Document | XMLHttpRequestBodyInit | null);
        return;
      }
      const result = store.handle(this.demoMethod, this.demoUrl, {
        method: this.demoMethod,
        body: typeof body === 'string' ? body : undefined,
      });
      void (async () => {
        const text = result ? await result.text() : '{}';
        Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(this, 'status', { value: 200, configurable: true });
        Object.defineProperty(this, 'responseText', { value: text, configurable: true });
        Object.defineProperty(this, 'response', { value: text, configurable: true });
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new Event('load'));
        this.dispatchEvent(new Event('loadend'));
      })();
    }
  }
  window.XMLHttpRequest = DemoXhr as unknown as typeof XMLHttpRequest;

  // WebSocket：模拟会话里不该有任何真实长连接；socket.io 已被换成假连接，
  // 这里再兜一层，防止将来某个页面直接 new WebSocket。
  const OriginalWebSocket = window.WebSocket;
  class DemoWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly url: string;
    readyState = 1;
    binaryType = 'blob';
    bufferedAmount = 0;
    extensions = '';
    protocol = '';
    onopen: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      window.setTimeout(() => {
        const event = new Event('open');
        this.dispatchEvent(event);
        this.onopen?.(event);
      }, 0);
    }

    send(): void {
      // 模拟会话不接受任何真实发送
    }

    close(): void {
      this.readyState = 3;
      const event = new Event('close') as CloseEvent;
      this.dispatchEvent(event);
      this.onclose?.(event);
    }
  }
  void OriginalWebSocket;
  window.WebSocket = DemoWebSocket as unknown as typeof WebSocket;

  if (navigator.sendBeacon) {
    navigator.sendBeacon = () => true;
  }
}

/** 挂顶部横幅（模拟会话的唯一标识 + 重置入口） */
function mountBanner(win: DemoWindow, store: DemoStore): void {
  const banner = document.createElement('div');
  banner.className = 'roco-demo-banner';
  banner.innerHTML = `
    <span class="roco-demo-banner-tag">模拟会话</span>
    <span class="roco-demo-banner-text">
      这是一套<strong>假数据</strong>：界面是真的、数据是编的，所有操作都不会写入你的电脑，
      刷新或点右侧按钮即可回到初始状态。
    </span>
    <button type="button" class="roco-demo-banner-btn">重置模拟数据</button>
  `;
  banner.querySelector('.roco-demo-banner-btn')?.addEventListener('click', () => {
    win.__ROCO_DEMO__?.reset();
  });
  document.body.prepend(banner);
}

/**
 * 引导入口：由 main.tsx 在识别到模拟会话参数时调用。
 * 必须在 React 渲染之前执行（拦截层要赶在后台首屏请求之前装好）。
 */
export async function bootstrapDemoSession(): Promise<void> {
  const win = window as DemoWindow;
  if (win.__ROCO_DEMO__) {
    return;
  }
  const store = createDemoStore();
  win.__ROCO_DEMO__ = {
    store,
    reset() {
      store.reset();
      // 重置后重新加载页面：把编辑中的弹窗/抽屉一起收掉，回到干净的初始视图
      window.location.reload();
    },
    describe: () => store.describe(),
  };
  installNetworkGuard(store);
  // 假 socket 工厂：lib/socket.ts 在模拟会话分支里取它（真机后台不会设置这个字段）。
  // 类型上用 unknown 转换：env.d.ts 里写的是宽签名（避免 import socket.io-client 造成类型循环）。
  win.__ROCO_CREATE_ADMIN_SOCKET__ = (() => store.createSocket()) as unknown as Window['__ROCO_CREATE_ADMIN_SOCKET__'];
  // 默认把「系列比赛」详情停在**进行中**的那一届（2026 秋季杯）：分步实操要讲"右键卡片登记"
  // 与"回退上一波"，只有有对局的届才演示得出来；抽签阶段的「春季热身赛」在列表里点开即可看。
  try {
    window.localStorage.setItem('roco-pvp-lineup:lastTournamentId', 'T20260928_A01');
  } catch {
    // 存储不可用就按列表第一条打开，不影响其余功能
  }
  // 横幅要等 DOM 就绪（script 在 body 里，通常已经就绪）
  if (document.body) {
    mountBanner(win, store);
  } else {
    document.addEventListener('DOMContentLoaded', () => mountBanner(win, store), { once: true });
  }
}
