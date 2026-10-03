/**
 * 前端构建入口（替代直接 `vite build`）。
 *
 * 为什么要这个脚本：模拟会话页需要把 socket.io 换成假连接，只能在构建期按入口分流，
 * 所以 vite.config.ts 现在是**两个构建目标**（真机后台 + 模拟会话），
 * 而 `emptyOutDir` 必须两边都关掉（否则第二个目标会要求确认清空 / 删掉第一个的产物），
 * 清空 dist 的动作挪到这里、只做一次。
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');

rmSync(distDir, { recursive: true, force: true });

const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [viteBin, 'build', ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error('[build-renderer] 启动构建失败：', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
