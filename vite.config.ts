import path from 'node:path';

import { defineConfig } from 'vite';

/**
 * 前端构建配置（真机后台 + 登录页 + 模拟会话页，三个入口一次构建）。
 *
 * 关于「模拟会话」：它与后台共用同一份源码，只是运行期（`?demo` / `?view=`）会加载
 * `demo/demo-session`，把 fetch / XHR / WebSocket 整块换成内存假数据。
 * socket.io 的连接由 `lib/socket.ts` 在**模块内部**按 `import.meta.env.DEMO` 选择实现，
 * 「模拟会话」构建出来的是假连接、真机构建出来的是真 socket.io（Rollup 会摇掉另一支）。
 *
 * ⚠ 别把这里改成"按入口给 alias"：Vite 的 alias / define 是整次构建全局生效的，
 * 那样会把真机后台的 socket 一起换掉。
 */
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // 清空 dist 的动作在 scripts/build-renderer.mjs 里先做一次（此处再清会与 dev 的增量冲突）
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'antd-assets',
    rollupOptions: {
      input: {
        'admin-antd': path.resolve(__dirname, 'src/pages/admin-antd.html'),
        'admin-guide-demo': path.resolve(__dirname, 'src/pages/admin-guide-demo.html'),
        login: path.resolve(__dirname, 'src/pages/login.html'),
      },
    },
  },
});
