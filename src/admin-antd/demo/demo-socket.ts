/**
 * 模拟会话的假 socket：形状与 `socket.io-client` 的 `Socket` 子集一致，
 * 只做「记录事件处理器 + 允许回放」——真机的 `snapshot` / `matches:update` 等事件
 * 由 demo-store 在状态变化时回放给所有已注册的处理器。
 *
 * 它在 `lib/socket.ts` 里按 `import.meta.env.DEMO` 被选中，**只有模拟会话页面会加载**；
 * 真机产物里这个模块会被 Rollup 摇掉（见该文件的注释）。
 */

interface DemoHandler {
  (payload?: unknown): void;
}

export interface DemoAdminSocket {
  connected: boolean;
  disconnected: boolean;
  id: string;
  on(event: string, handler: DemoHandler): DemoAdminSocket;
  once(event: string, handler: DemoHandler): DemoAdminSocket;
  off(event: string, handler?: DemoHandler): DemoAdminSocket;
  emit(event: string, payload?: unknown): DemoAdminSocket;
  removeAllListeners(event?: string): DemoAdminSocket;
  disconnect(): DemoAdminSocket;
  connect(): DemoAdminSocket;
  close(): DemoAdminSocket;
}

/** 所有假 socket（横幅/调试用；也证明"一个真实长连接都没建"） */
const registry: DemoAdminSocket[] = [];

export function createDemoSocket(): DemoAdminSocket {
  const listeners = new Map<string, Set<DemoHandler>>();
  const socket: DemoAdminSocket = {
    connected: true,
    disconnected: false,
    id: `demo-socket-${Math.random().toString(36).slice(2, 8)}`,
    on(event, handler) {
      const set = listeners.get(event) ?? new Set<DemoHandler>();
      set.add(handler);
      listeners.set(event, set);
      return socket;
    },
    once(event, handler) {
      const wrapped: DemoHandler = (payload) => {
        socket.off(event, wrapped);
        handler(payload);
      };
      return socket.on(event, wrapped);
    },
    off(event, handler) {
      if (handler) {
        listeners.get(event)?.delete(handler);
      } else {
        listeners.delete(event);
      }
      return socket;
    },
    emit(event, payload) {
      // 客户端 → 服务端的 emit：模拟会话里只回显，不产生真实请求
      listeners.get(event)?.forEach((handler) => handler(payload));
      return socket;
    },
    removeAllListeners(event) {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
      return socket;
    },
    disconnect() {
      socket.connected = false;
      socket.disconnected = true;
      return socket;
    },
    connect() {
      socket.connected = true;
      socket.disconnected = false;
      return socket;
    },
    close() {
      socket.connected = false;
      socket.disconnected = true;
      return socket;
    },
  };
  registry.push(socket);
  return socket;
}

/** 注册表（供横幅/自检使用） */
export function listDemoSockets(): DemoAdminSocket[] {
  return registry;
}
