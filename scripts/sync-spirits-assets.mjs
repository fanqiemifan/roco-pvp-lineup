import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const sourceIndexFile = path.join(projectRoot, 'resources', 'data', 'pets.json');
const spriteImageDir = path.join(projectRoot, 'resources', 'sprites-img');
const spriteIconDir = path.join(projectRoot, 'resources', 'sprites-icon');

const shouldDownload = !process.argv.includes('--skip-download');
const shouldPrune = process.argv.includes('--prune');
const DOWNLOAD_CONCURRENCY = 8;
// --prune 白名单：pets.json 之外仍要保留的文件（手工维护）
const PRUNE_KEEP = new Set(['10000_随机精灵.png']);

function sanitizeFilenameSegment(value, fallback = '') {
  const normalized = String(value ?? '')
    .normalize('NFC')
    // 零宽字符（上游 wiki 名字曾混入）既不在 \s 内，NFC 也不会消除，须显式剔除
    .replace(/[\u200B-\u200D\u2060\uFEFF\u180E]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '')
    .replace(/\.+$/g, '')
    .trim();

  return normalized || fallback;
}

function inferExtension(imageUrl) {
  try {
    const pathname = new URL(imageUrl).pathname;
    const ext = path.extname(pathname);
    return ext ? ext.toLowerCase() : '.png';
  } catch {
    return '.png';
  }
}

// 统一命名规则：{pet_id}_{name}，展示端（sprite-service / 推流页脚本）按同样规则拼接本地路径
function buildFilename(item) {
  const idText = sanitizeFilenameSegment(item.pet_id);
  const nameText = sanitizeFilenameSegment(item.name);
  return `${idText}_${nameText}${inferExtension(item.official_small_icon || item.icon_url || '')}`;
}

async function downloadBuffer(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'roco-pvp-lineup/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function ensureDownloaded(job, failures) {
  const { urls, targetFile, label } = job;
  if (!urls.length) {
    failures.push(`${label}: missing url`);
    return;
  }

  try {
    await fs.access(targetFile);
    return; // 已存在则跳过（幂等）
  } catch {
    // fall through
  }

  let lastError = null;
  for (const url of urls) {
    try {
      const buffer = await downloadBuffer(url);
      await fs.writeFile(targetFile, buffer);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  failures.push(`${label}: ${lastError}`);
}

async function runQueue(jobs, failures) {
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      await ensureDownloaded(job, failures);
    }
  }

  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, jobs.length) }, worker));
}

async function pruneStaleFiles(dir, expectedNames, label) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const pruned = [];
  for (const entry of entries) {
    if (!entry.isFile() || expectedNames.has(entry.name) || PRUNE_KEEP.has(entry.name)) continue;
    await fs.unlink(path.join(dir, entry.name));
    pruned.push(entry.name);
  }

  if (pruned.length > 0) {
    console.log(`pruned ${label}: ${pruned.length}`);
    for (const name of pruned) {
      console.log(`  - ${name}`);
    }
  }
  return pruned.length;
}

async function main() {
  const sourceRaw = await fs.readFile(sourceIndexFile, 'utf8');
  const sourcePayload = JSON.parse(sourceRaw);
  const items = Array.isArray(sourcePayload) ? sourcePayload : sourcePayload.items;

  if (!Array.isArray(items)) {
    throw new Error('pets.json must be an array or contain an items array');
  }

  await fs.mkdir(spriteImageDir, { recursive: true });
  await fs.mkdir(spriteIconDir, { recursive: true });

  const failures = [];
  // official_small_icon → sprites-img（精灵展示图），失败降级 official_icon / image_url
  const imageJobs = [];
  // icon_url → sprites-icon（精灵头像图标），失败降级 official_icon
  const iconJobs = [];
  // 两个目录共用同一套文件名，--prune 据此判定残留文件
  const expectedNames = new Set();

  for (const item of items) {
    const filename = buildFilename(item);
    if (!filename || filename === '_.png') {
      failures.push(`skip record without pet_id/name: ${JSON.stringify(item).slice(0, 120)}`);
      continue;
    }
    expectedNames.add(filename);

    imageJobs.push({
      urls: [item.official_small_icon, item.official_icon, item.image_url]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
      targetFile: path.join(spriteImageDir, filename),
      label: `sprites-img/${filename}`,
    });
    iconJobs.push({
      urls: [item.icon_url, item.official_icon]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
      targetFile: path.join(spriteIconDir, filename),
      label: `sprites-icon/${filename}`,
    });
  }

  if (shouldDownload) {
    await runQueue(imageJobs, failures);
    await runQueue(iconJobs, failures);
  }

  if (shouldPrune) {
    await pruneStaleFiles(spriteImageDir, expectedNames, 'sprites-img');
    await pruneStaleFiles(spriteIconDir, expectedNames, 'sprites-icon');
  }

  console.log(`pets: ${items.length}`);
  console.log(`download: ${shouldDownload ? 'enabled' : 'skipped'}`);
  console.log(`prune: ${shouldPrune ? 'enabled' : 'disabled'}`);
  console.log(`images: ${path.relative(projectRoot, spriteImageDir)} (${imageJobs.length})`);
  console.log(`icons: ${path.relative(projectRoot, spriteIconDir)} (${iconJobs.length})`);

  if (failures.length > 0) {
    console.error(`failures: ${failures.length}`);
    for (const failure of failures.slice(0, 20)) {
      console.error(`  - ${failure}`);
    }
    if (failures.length > 20) {
      console.error(`  ... and ${failures.length - 20} more`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
