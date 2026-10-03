/**
 * socket 连接工厂：真机后台用真 socket.io，「模拟会话」用假连接。
 *
 * 分流为什么在运行期判、不用构建期标志：模拟会话页与后台**共用同一份 bundle**
 * （实测 dist 里两个 html 指向同一个 main-*.js），所以 `import.meta.env.DEMO` 这类
 * 构建期常量是整次构建全局的，按入口分不开。改成看运行期标记：
 * 模拟会话在渲染前（`demo/demo-session.ts` 的 bootstrapDemoSession）把假 socket 工厂
 * 挂到 `window.__ROCO_CREATE_ADMIN_SOCKET__`，这里只要它存在就用假的。
 *
 * 为此**必须**保证 demo-session 在 React 渲染之前执行（`main.tsx` 里是 `await import` 后渲染）。
 */

import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';

/**
 * 建立后台与推流服务端的连接。
 * - 模拟会话：用 demo-session 装好的假连接（一个真实长连接都不建）
 * - 真机：`io({ role: 'admin' })`
 */
export function createAdminSocket(): Socket {
  const demoFactory = window.__ROCO_CREATE_ADMIN_SOCKET__;
  if (demoFactory) {
    return demoFactory() as unknown as Socket;
  }
  return io({
    transports: ['websocket', 'polling'],
    query: { role: 'admin' },
  });
}
