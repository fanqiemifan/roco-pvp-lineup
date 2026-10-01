/**
 * 云同步信箱 Worker 一键部署（运营者一次性操作）
 *
 * 做的事：wrangler kv namespace create SYNC_KV → 把打印出的 id 回填进 cloudflare/wrangler.toml
 *        → wrangler deploy → 配置访问令牌 secret（SYNC_TOKEN，缺了就生成随机串）→ 打印 workerUrl + 令牌。
 *
 * 用法（仓库根目录）：npm run cloud:deploy
 * 前置：Node 18+（自带 npx）、已 `npx wrangler login` 授权过浏览器。
 * 说明：wrangler 不写进 package.json 依赖（只部署一次，避免给每个使用者都装一份几十 MB 的 CLI），
 *      这里用 npx 现取现用。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(import.meta.dirname, '..');
const cloudflareDir = path.join(rootDir, 'cloudflare');
const wranglerToml = path.join(cloudflareDir, 'wrangler.toml');
const PLACEHOLDER = 'REPLACE_WITH_KV_NAMESPACE_ID';

function runWrangler(args, { capture = false, input = null } = {}) {
  // Windows 上不能直接 spawnSync('npx.cmd')（Node 20+ 对 .cmd/.bat 抛 EINVAL，shell:true 也有注入风险）；
  // 改为用当前 Node 执行 npx-cli.js（npx 与 node 同装在一个 nodejs 目录下），全平台一致。
  const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const result = spawnSync(process.execPath, [npxCli, '--yes', 'wrangler', ...args], {
    cwd: cloudflareDir,
    encoding: 'utf-8',
    // input 用于把 secret 值从 stdin 灌给 wrangler（不走命令行参数，避免进 shell 历史）
    stdio: input === null ? (capture ? ['ignore', 'pipe', 'pipe'] : 'inherit') : ['pipe', 'pipe', 'pipe'],
    input: input ?? undefined,
    shell: false,
  });
  if (result.error) {
    throw new Error(`无法启动 wrangler（${result.error.message}）：请确认已安装 Node 18+ 且网络可达 npm`);
  }
  if (result.status !== 0) {
    const detail = capture || input !== null ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
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
  // 只认「非空且不是占位符」的 id：留空时也必须重新创建，否则会把空 id 当成已配置
  const existingId = (/id\s*=\s*"([^"]*)"/.exec(toml)?.[1] ?? '').trim();
  let namespaceId = existingId && existingId !== PLACEHOLDER ? existingId : '';

  if (!namespaceId) {
    console.log('① 创建 KV 空间 SYNC_KV …');
    const output = runWrangler(['kv', 'namespace', 'create', 'SYNC_KV'], { capture: true });
    namespaceId = extractNamespaceId(output);
    if (!namespaceId) {
      console.error(output);
      throw new Error('未能从 wrangler 输出解析出 KV namespace id，请手动执行 npx wrangler kv namespace create SYNC_KV 并把 id 填进 cloudflare/wrangler.toml');
    }
    // 空 id / 占位符都替换成真 id（两种写法都要认，否则第二次部署时找不到替换目标）
    const replaced = /id\s*=\s*"[^"]*"/.test(toml)
      ? toml.replace(/id\s*=\s*"[^"]*"/, `id = "${namespaceId}"`)
      : toml;
    writeFileSync(wranglerToml, replaced, 'utf-8');
    console.log(`   KV 空间已创建，id = ${namespaceId}（已回填 cloudflare/wrangler.toml）`);
  } else {
    console.log(`① KV 空间已配置（id = ${namespaceId}），跳过创建`);
  }

  console.log('② 部署 Worker …');
  const deployOutput = runWrangler(['deploy'], { capture: true });
  console.log(deployOutput.trim());

  const workerUrl = /https:\/\/[^\s]+\.workers\.dev/.exec(deployOutput)?.[0] ?? '';

  // ③ 访问令牌（Worker 侧 SYNC_TOKEN）：没有它 /room 一律 503（fail closed）。
  // 密钥不进代码、不进仓库：用 wrangler secret put 从 stdin 写入。
  console.log('\n③ 配置访问令牌（SYNC_TOKEN）…');
  const secretList = runWrangler(['secret', 'list'], { capture: true });
  const token = process.env.ROCO_SYNC_TOKEN?.trim() || crypto.randomBytes(24).toString('base64url');
  const alreadySet = /SYNC_TOKEN/.test(secretList);
  if (alreadySet && !process.env.ROCO_SYNC_TOKEN) {
    console.log('   Worker 已配置过 SYNC_TOKEN：保留原值（不知道原值就重设一次，并同步更新两台机器的「访问令牌」）');
    console.log('   需要重设：$env:ROCO_SYNC_TOKEN="你的令牌"; npm run cloud:deploy');
  } else {
    runWrangler(['secret', 'put', 'SYNC_TOKEN'], { input: `${token}\n` });
    console.log('   SYNC_TOKEN 已写入 Worker');
  }

  console.log('\n完成。两台机器的「数据同步 → 云同步」都填：');
  console.log(`  workerUrl = ${workerUrl || '（未从输出解析到地址，请复制上面的 URL）'}`);
  if (!alreadySet || process.env.ROCO_SYNC_TOKEN) {
    console.log(`  访问令牌  = ${token}`);
    console.log('  ↑ 只显示这一次，请自己保存好（两端必须填同一个；重设请用 ROCO_SYNC_TOKEN 环境变量重跑本脚本）');
  }
  console.log('  syncKey   = 自定一个随机串（两端一致即可，仅用于键空间隔离）');
  console.log('  另：两台机器的「本机标识」必须互不相同（A / B），角色分别选主控端 / 分控端');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
