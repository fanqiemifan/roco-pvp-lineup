import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 绝大多数用例是纯函数 / 服务层（node 环境）；组件层用例在自己的文件顶部用
    // `// @vitest-environment jsdom` 局部切换，不在这里全局改环境（会影响现有 node 用例）。
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
