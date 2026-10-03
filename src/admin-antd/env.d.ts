declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

/** 模拟会话的全局句柄（横幅上的「重置模拟数据」按钮用它） */
interface Window {
  __ROCO_DEMO__?: {
    reset(): void;
    describe(): { matches: number; tournaments: number };
  };
  /**
   * 模拟会话（demo/demo-session）在渲染前装好的假 socket 工厂。
   * 真机后台不会设置它；`lib/socket.ts` 只在 `import.meta.env.DEMO` 分支里取用。
   * 类型写成宽签名，避免这里 import socket.io-client 造成类型循环。
   */
  __ROCO_CREATE_ADMIN_SOCKET__?: () => {
    on: (...args: unknown[]) => unknown;
    off: (...args: unknown[]) => unknown;
    emit: (...args: unknown[]) => unknown;
    close: () => void;
  };
}
