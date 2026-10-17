// 从上游唯一数据仓库 fanqiemifan/roco-wiki-data 拉取 pets.json / final_forms.json 写入 resources/data/。
// 每个渠道把数据文件连同 SHA256SUMS 一起拉取，哈希校验通过才落盘（拦截 CDN 缓存滞后副本/脏数据）；
// 内容与本地字节一致时不写文件，便于 CI 用 git diff 判断是否需要提交。
// 渠道顺序 = 上游 README 的新鲜度约定：GitHub Pages（跟随默认分支，无长缓存）→ jsDelivr @main（约 12h 缓存）→ raw（备用）。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const targetDir = path.join(projectRoot, 'resources', 'data');

const UPSTREAM_REPO = 'fanqiemifan/roco-wiki-data';
// attribute_mapping.json 仍由本仓库维护，不随上游同步
const DATA_FILES = ['pets.json', 'final_forms.json'];
const CHECKSUM_FILE = 'SHA256SUMS';
const FETCH_TIMEOUT_MS = 30_000;

const SOURCES = [
  (file) => `https://fanqiemifan.github.io/${UPSTREAM_REPO}/data/${file}`,
  (file) => `https://cdn.jsdelivr.net/gh/${UPSTREAM_REPO}@main/data/${file}`,
  (file) => `https://raw.githubusercontent.com/${UPSTREAM_REPO}/main/data/${file}`,
];

async function fetchBuffer(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'roco-pvp-webui pet-data sync' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 单文件瞬时抖动重试一次，避免首选渠道因一次超时被整体跳过
async function fetchBufferWithRetry(url) {
  try {
    return await fetchBuffer(url);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return fetchBuffer(url);
  }
}

// 标准 sha256sum 格式：<哈希>  <相对 data/ 的文件名>
function parseChecksums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (match) map.set(match[2].trim(), match[1]);
  }
  return map;
}

function validateJson(name, buf) {
  const json = JSON.parse(buf.toString('utf-8'));
  if (name === 'pets.json') {
    const items = Array.isArray(json) ? json : json.items;
    if (!Array.isArray(items) || items.length === 0) throw new Error('无有效条目');
    return `（${items.length} 条，v${json.version} ${json.updatetime ?? ''}）`;
  }
  if (!Array.isArray(json)) throw new Error('非数组结构');
  return `（${json.length} 条）`;
}

async function trySource(sourceUrl) {
  const buffers = new Map();
  for (const file of [...DATA_FILES, CHECKSUM_FILE]) {
    buffers.set(file, await fetchBufferWithRetry(sourceUrl(file)));
  }
  const checksums = parseChecksums(buffers.get(CHECKSUM_FILE).toString('utf-8'));
  for (const file of DATA_FILES) {
    const expected = checksums.get(file);
    if (!expected) throw new Error(`SHA256SUMS 缺少 ${file} 条目`);
    const actual = crypto.createHash('sha256').update(buffers.get(file)).digest('hex');
    if (actual !== expected) throw new Error(`${file} 哈希不匹配（缓存滞后或内容被篡改）`);
  }
  return buffers;
}

async function main() {
  const failures = [];
  let buffers = null;
  for (const sourceUrl of SOURCES) {
    const url = sourceUrl('pets.json');
    try {
      buffers = await trySource(sourceUrl);
      console.log(`数据源：${url}`);
      // 走到兜底渠道时说明前面渠道有问题，打印原因便于排查（如 jsDelivr 缓存不一致会栽在哈希校验上）
      for (const line of failures) console.log(`  跳过 ${line}`);
      break;
    } catch (err) {
      failures.push(`${url} → ${err.message}`);
    }
  }
  if (!buffers) {
    console.error('所有上游渠道均不可用：');
    for (const line of failures) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }

  const changed = [];
  for (const file of DATA_FILES) {
    const buf = buffers.get(file);
    const target = path.join(targetDir, file);
    const before = await fs.readFile(target).catch(() => null);
    const summary = validateJson(file, buf);
    // Windows 工作区是 CRLF 检出、上游是 LF：按归一化换行比较，避免仅 EOL 差异每次都误报"已更新"
    const canonical = (b) => b.toString('utf-8').replace(/\r\n/g, '\n');
    if (before && canonical(before) === canonical(buf)) {
      console.log(`${file}：已是最新 ${summary}`);
    } else {
      await fs.writeFile(target, buf);
      changed.push(file);
      console.log(`${file}：已更新 ${summary}`);
    }
  }
  if (changed.length) {
    console.log(`本次更新：${changed.join('、')}（新增精灵图用 npm run sync:sprites 补齐）`);
  } else {
    console.log('本地已是最新，无需提交。');
  }
}

await main();
