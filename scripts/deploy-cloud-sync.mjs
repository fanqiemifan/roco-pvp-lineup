/**
 * 云同步信箱 Worker 一键部署（运营者一次性操作）
 *
 * 做的事：wrangler kv namespace create SYNC_KV → 把打印出的 id 回填进 cloudflare/wrangler.toml
 *        → wrangler deploy → 打印 workerUrl。
 *
 * 用法（仓库根目录）：npm run cloud:deploy
 * 前置：Node 18+（自带 npx）、已 `npx wrangler login` 授权过浏览器。
 * 说明：wrangler 不写进 package.json 依赖（只部署一次，避免给每个使用者都装一份几十 MB 的 CLI），
 *      这里用 npx 现取现用。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(import.meta.dirname, '..');
const cloudflareDir = path.join(rootDir, 'cloudflare');
const wranglerToml = path.join(cloudflareDir, 'wrangler.toml');
const PLACEHOLDER = 'REPLACE_WITH_KV_NAMESPACE_ID';

function runWrangler(args, { capture = false } = {}) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, ['--yes', 'wrangler', ...args], {
    cwd: cloudflareDir,
    encoding: 'utf-8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
  });
  if (result.error) {
    throw new Error(`无法启动 wrangler（${result.error.message}）：请确认已安装 Node 18+ 且网络可达 npm`);
  }
  if (result.status !== 0) {
    const detail = capture ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
    throw new Error(`wrangler ${args.join(' ')} 执行失败${detail ? `：\n${detail}` : ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/** 从 wrangler 输出里捞出 KV namespace id（形如 `id = "abc123..."`） */
function extractNamespaceId(output) {
  const matched = /id\s*=\s*"([^"]+)"/.exec(output);
  return matched ? matched[1] : '';
}

function main() {
  const toml = readFileSync(wranglerToml, 'utf-8');
  const existingId = /id\s*=\s*"([^"]*)"/.exec(toml)?.[1] ?? '';
  let namespaceId = existingId && existingId !== PLACEHOLDER ? existingId : '';

  if (!namespaceId) {
    console.log('① 创建 KV 空间 SYNC_KV …');
    const output = runWrangler(['kv', 'namespace', 'create', 'SYNC_KV'], { capture: true });
    namespaceId = extractNamespaceId(output);
    if (!namespaceId) {
      console.error(output);
      throw new Error('未能从 wrangler 输出解析出 KV namespace id，请手动执行 npx wrangler kv namespace create SYNC_KV 并把 id 填进 cloudflare/wrangler.toml');
    }
    writeFileSync(wranglerToml, toml.replace(PLACEHOLDER, namespaceId), 'utf-8');
    console.log(`   KV 空间已创建，id = ${namespaceId}（已回填 cloudflare/wrangler.toml）`);
  } else {
    console.log(`① KV 空间已配置（id = ${namespaceId}），跳过创建`);
  }

  console.log('② 部署 Worker …');
  const deployOutput = runWrangler(['deploy'], { capture: true });
  console.log(deployOutput.trim());

  const workerUrl = /https:\/\/[^\s]+\.workers\.dev/.exec(deployOutput)?.[0] ?? '';
  console.log('\n完成。把下面的 workerUrl 填进两台机器的「数据同步 → 云同步设置区」：');
  console.log(workerUrl || '（未从输出解析到地址，请复制上面打印的 URL）');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
