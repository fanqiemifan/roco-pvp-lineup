import fs from 'node:fs';
import path from 'node:path';

import { MAX_SELECTION_COUNT, SUPPORTED_IMAGE_EXTENSIONS } from '../../shared/constants.js';
import type { QuickFillPreview, SpriteRecord } from '../../shared/types.js';
import type { AppPaths } from './path-service.js';

const SPRITE_RESOURCE_BASE = '/resources/sprites-img';
const SPRITE_ICON_RESOURCE_BASE = '/resources/sprites-icon';
const ATTRIBUTE_ICON_BASE = '/resources/attribute';

// pets.json 的 stage → 精灵形态标签（4 = 首领）
const STAGE_FORM_LABELS: Record<number, string> = {
  1: '一阶',
  2: '二阶',
  3: '三阶',
  4: '首领',
};

let cachedAttributeCodeByName: Map<string, string> | null = null;
let cachedFinalFormIds: Set<string> | null = null;
let cachedIconFilenameByPetId: Map<string, string> | null = null;

function normalizeSpriteAttributes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }

  return String(value ?? '')
    .split(/[、/,，\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeFilenameSegment(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-')
    .replace(/\s+/gu, '')
    .replace(/\.+$/gu, '')
    .trim();
}

function spriteNumberFromFilename(filename: string): number | null {
  // 兼容两种命名：`NO.001_迪莫.png`（旧）与 `3004_迪莫.png`（pets.json 新命名，前导数字为 pet_id）
  const match = /^(?:NO\.)?(\d+)_/i.exec(filename || '');
  return match ? Number(match[1]) : null;
}

function spriteNumberFromValue(value: unknown): number | null {
  const match = /(\d+)/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) : null;
}

function normalizeSearchName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

// 同名分组键：pets.json 中多形态精灵共享同一 name（displayName），按名称归组用于候选切换
function spriteNameGroup(sprite: SpriteRecord): string {
  const displayName = sprite.displayName || path.parse(sprite.filename).name;
  return normalizeSearchName(displayName);
}

function spriteNumberAliases(sprite: SpriteRecord): string[] {
  if (typeof sprite.number !== 'number') {
    return [];
  }
  return [
    String(sprite.number),
    `${sprite.number}`.padStart(3, '0'),
    `no.${`${sprite.number}`.padStart(3, '0')}`,
    `no${`${sprite.number}`.padStart(3, '0')}`,
  ];
}

function buildSpriteEntry(filename: string, paths: AppPaths): SpriteRecord {
  const stem = path.parse(filename).name;
  const displayName = stem.includes('_') ? stem.split('_', 2)[1] : stem;

  return {
    id: filename,
    filename,
    displayName,
    name: displayName,
    path: `${SPRITE_RESOURCE_BASE}/${filename}`,
    aliases: [filename, stem],
    number: spriteNumberFromFilename(filename),
    attribute: '',
    attributeCodes: [],
    attributeIcon1: '',
    attributeIcon2: '',
    iconUrl: fs.existsSync(path.join(paths.spritesIconDir, filename))
      ? `${SPRITE_ICON_RESOURCE_BASE}/${filename}`
      : '',
    form: '',
    petForm: '',
    isFinalForm: false,
  };
}

function loadAttributeCodeByName(paths: AppPaths): Map<string, string> {
  if (cachedAttributeCodeByName) {
    return cachedAttributeCodeByName;
  }

  const mappingFile = path.join(paths.dataDir, 'attribute_mapping.json');
  const lookup = new Map<string, string>();

  try {
    const payload = JSON.parse(fs.readFileSync(mappingFile, 'utf-8')) as Array<{ 编号?: string; 属性?: string }>;
    for (const item of payload) {
      const name = String(item?.属性 ?? '').trim();
      const code = String(item?.编号 ?? '').trim();
      if (name && code) {
        lookup.set(name, code);
      }
    }
  } catch {
    // Best effort only; consumers can still fall back to text attributes.
  }

  cachedAttributeCodeByName = lookup;
  return lookup;
}

function loadFinalFormIds(paths: AppPaths): Set<string> {
  if (cachedFinalFormIds) {
    return cachedFinalFormIds;
  }

  const finalFormsFile = path.join(paths.dataDir, 'final_forms.json');
  const lookup = new Set<string>();

  try {
    const payload = JSON.parse(fs.readFileSync(finalFormsFile, 'utf-8')) as Array<{ id?: string | number }>;
    for (const item of payload) {
      const id = String(item?.id ?? '').trim();
      if (id) {
        lookup.add(id);
      }
    }
  } catch {
    // Best effort only; callers can still fall back to regular form filtering.
  }

  cachedFinalFormIds = lookup;
  return lookup;
}

// 建 {pet_id → sprites-icon 实际文件名} 映射：sprites-icon 里同一 pet_id 可能存在多个历史残留文件，
// 取字典序第一个作为兜底；正常情况由 resolveIconUrl 精确命中 {pet_id}_{name}.png。
function loadIconFilenameByPetId(paths: AppPaths): Map<string, string> {
  if (cachedIconFilenameByPetId) {
    return cachedIconFilenameByPetId;
  }

  const lookup = new Map<string, string>();

  try {
    const filenames = fs.readdirSync(paths.spritesIconDir).sort();
    for (const filename of filenames) {
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
        continue;
      }
      const match = /^(\d+)_/.exec(filename);
      if (!match) {
        continue;
      }
      const petId = match[1];
      if (!lookup.has(petId)) {
        lookup.set(petId, filename);
      }
    }
  } catch {
    // Best effort only; consumers can still fall back to the sprite art (path).
  }

  cachedIconFilenameByPetId = lookup;
  return lookup;
}

// 精灵头像 URL：优先精确匹配 {pet_id}_{name}.png，否则退回该 pet_id 的任一图标文件，都没有则返回空串（展示端回退立绘）
function resolveIconUrl(petId: string, name: string, paths: AppPaths): string {
  const exact = `${sanitizeFilenameSegment(petId)}_${sanitizeFilenameSegment(name)}.png`;
  if (fs.existsSync(path.join(paths.spritesIconDir, exact))) {
    return `${SPRITE_ICON_RESOURCE_BASE}/${exact}`;
  }

  const fallback = loadIconFilenameByPetId(paths).get(sanitizeFilenameSegment(petId));
  return fallback ? `${SPRITE_ICON_RESOURCE_BASE}/${fallback}` : '';
}

// pets.json 单条记录 → SpriteRecord
// 字段对应：精灵编号=handbook_no、精灵名称=name、精灵属性=elements、精灵形态=stage（4=首领）
function normalizePetRecord(record: unknown, paths: AppPaths): SpriteRecord | null {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const item = record as Record<string, unknown>;
  const petId = String(item.pet_id ?? '').trim();
  const name = String(item.name ?? '').trim();
  if (!petId || !name) {
    return null;
  }

  const filename = `${sanitizeFilenameSegment(petId)}_${sanitizeFilenameSegment(name)}.png`;
  const formText = String(item.form ?? '').trim();
  const stage = Number(item.stage);
  const form = STAGE_FORM_LABELS[stage] ?? (Number.isFinite(stage) && stage > 0 ? String(stage) : '');
  // 多形态变体（如 卡瓦重-草地附近的样子）：原始名称带形态后缀，便于悬浮窗切换与统计区分；
  // displayName 保持纯名称，用于阵容快照（pet_id）与名称查找
  const fullName = formText ? `${name}（${formText}）` : name;

  const attributes = normalizeSpriteAttributes(item.elements);
  const attributeLookup = loadAttributeCodeByName(paths);
  const attributeCodes = attributes
    .map((attributeName) => attributeLookup.get(attributeName) ?? '')
    .filter(Boolean)
    .slice(0, 2);

  const finalFormIds = loadFinalFormIds(paths);
  const number = spriteNumberFromValue(item.handbook_no);

  const aliases: string[] = [];
  for (const alias of [
    name,
    formText ? `${name}（${formText}）` : '',
    petId,
    filename,
    path.parse(filename).name,
  ]) {
    if (typeof alias === 'string' && alias.trim() && !aliases.includes(alias.trim())) {
      aliases.push(alias.trim());
    }
  }
  if (typeof number === 'number') {
    for (const alias of [String(number), `${number}`.padStart(3, '0'), `NO.${`${number}`.padStart(3, '0')}`]) {
      if (!aliases.includes(alias)) {
        aliases.push(alias);
      }
    }
  }

  return {
    id: petId,
    filename,
    displayName: name,
    name: fullName,
    path: `${SPRITE_RESOURCE_BASE}/${filename}`,
    aliases,
    number,
    attribute: attributes.join('、'),
    attributeCodes,
    attributeIcon1: attributeCodes[0] ? `${ATTRIBUTE_ICON_BASE}/${attributeCodes[0]}.png` : '',
    attributeIcon2: attributeCodes[1] ? `${ATTRIBUTE_ICON_BASE}/${attributeCodes[1]}.png` : '',
    iconUrl: resolveIconUrl(petId, name, paths),
    form,
    petForm: formText,
    isFinalForm: finalFormIds.has(petId),
  };
}

export function loadSpriteIndex(paths: AppPaths): SpriteRecord[] {
  const indexFile = path.join(paths.dataDir, 'pets.json');
  if (!fs.existsSync(indexFile)) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(indexFile, 'utf-8')) as
      | { items?: unknown[] }
      | unknown[];
    const pets = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
    const normalized = pets
      .map((item) => normalizePetRecord(item, paths))
      .filter((item): item is SpriteRecord => Boolean(item))
      .filter((item) => fs.existsSync(path.join(paths.spritesDir, item.filename)));

    normalized.sort((left, right) => {
      const leftNumber = left.number ?? Number.MAX_SAFE_INTEGER;
      const rightNumber = right.number ?? Number.MAX_SAFE_INTEGER;
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
      return left.filename.localeCompare(right.filename);
    });

    return normalized;
  } catch {
    return [];
  }
}

export function listSprites(paths: AppPaths): SpriteRecord[] {
  const indexed = loadSpriteIndex(paths);
  if (indexed.length > 0) {
    return indexed;
  }

  if (!fs.existsSync(paths.spritesDir)) {
    return [];
  }

  const sprites = fs
    .readdirSync(paths.spritesDir)
    .filter((filename) => SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase()))
    .map((filename) => buildSpriteEntry(filename, paths));

  sprites.sort((left, right) => {
    const leftNumber = left.number ?? Number.MAX_SAFE_INTEGER;
    const rightNumber = right.number ?? Number.MAX_SAFE_INTEGER;
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    return left.filename.localeCompare(right.filename);
  });

  return sprites;
}

export function spriteLookup(paths: AppPaths): Map<string, SpriteRecord> {
  const lookup = new Map<string, SpriteRecord>();
  for (const sprite of listSprites(paths)) {
    for (const key of [sprite.id, sprite.filename, ...sprite.aliases]) {
      lookup.set(path.basename(key), sprite);
    }
  }
  return lookup;
}

function collectSpriteMatches(query: string, sprites: SpriteRecord[]): Array<{
  sprite: SpriteRecord;
  rank: [number, ...number[], string];
  matchType: string;
}> {
  const normalizedQuery = normalizeSearchName(query);
  if (!normalizedQuery) {
    return [];
  }

  const matches: Array<{
    sprite: SpriteRecord;
    rank: [number, ...number[], string];
    matchType: string;
  }> = [];

  for (const sprite of sprites) {
    const displayName = normalizeSearchName(sprite.displayName);
    const rawName = normalizeSearchName(sprite.name);
    const filename = normalizeSearchName(sprite.filename);
    const pathName = normalizeSearchName(path.basename(sprite.path));
    const stemName = normalizeSearchName(path.parse(sprite.path).name);
    const numberNames = spriteNumberAliases(sprite).map((alias) => normalizeSearchName(alias));
    const aliasNames = sprite.aliases.map((alias) => normalizeSearchName(alias));
    const exactNames = [displayName, rawName, filename, pathName, stemName].filter(Boolean);

    let rank: [number, ...number[], string] | null = null;
    let matchType = '';

    if (exactNames.includes(normalizedQuery)) {
      rank = [0, displayName.length, sprite.path];
      matchType = 'exact-name';
    } else if (numberNames.includes(normalizedQuery)) {
      rank = [1, sprite.path];
      matchType = 'exact-number';
    } else if (aliasNames.includes(normalizedQuery)) {
      rank = [2, normalizedQuery.length, sprite.path];
      matchType = 'exact-alias';
    } else if (pathName.includes(normalizedQuery)) {
      rank = [3, sprite.isFinalForm ? 0 : 1, pathName.length, sprite.path];
      matchType = 'contains-path';
    } else if (displayName.startsWith(normalizedQuery)) {
      rank = [4, sprite.isFinalForm ? 0 : 1, displayName.length, sprite.path];
      matchType = 'prefix-display-name';
    } else if (displayName.includes(normalizedQuery)) {
      rank = [
        5,
        sprite.isFinalForm ? 0 : 1,
        displayName.indexOf(normalizedQuery),
        displayName.length,
        sprite.path,
      ];
      matchType = 'contains-display-name';
    } else {
      const aliasHit = aliasNames.find((alias) => alias.includes(normalizedQuery));
      if (aliasHit) {
        rank = [
          6,
          sprite.isFinalForm ? 0 : 1,
          aliasHit.indexOf(normalizedQuery),
          aliasHit.length,
          sprite.path,
        ];
        matchType = 'contains-alias';
      }
    }

    if (rank) {
      matches.push({ sprite, rank, matchType });
    }
  }

  matches.sort((left, right) => {
    const leftRank = left.rank;
    const rightRank = right.rank;
    const length = Math.max(leftRank.length, rightRank.length);
    for (let index = 0; index < length; index += 1) {
      const leftValue = leftRank[index];
      const rightValue = rightRank[index];
      if (leftValue === rightValue) continue;
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return leftValue - rightValue;
      }
      return String(leftValue).localeCompare(String(rightValue));
    }
    return 0;
  });

  return matches;
}

export function spriteMatchesKeyword(sprite: SpriteRecord, keyword: string): boolean {
  const normalizedKeyword = normalizeSearchName(keyword);
  if (!normalizedKeyword) {
    return true;
  }
  return collectSpriteMatches(normalizedKeyword, [sprite]).length > 0;
}

function buildQuickFillCandidates(
  query: string,
  bestMatch: SpriteRecord,
  sprites: SpriteRecord[],
  rankedMatches: ReturnType<typeof collectSpriteMatches>,
): SpriteRecord[] {
  const nameGroup = spriteNameGroup(bestMatch);
  if (!nameGroup) {
    return [bestMatch];
  }

  const family = sprites.filter((sprite) => spriteNameGroup(sprite) === nameGroup);
  if (family.length <= 1) {
    return [bestMatch];
  }

  const rankedLookup = new Map(rankedMatches.map((item) => [item.sprite.path, item.rank]));
  const normalizedQuery = normalizeSearchName(query);

  return [...family].sort((left, right) => {
    const leftRank = rankedLookup.get(left.path);
    const rightRank = rankedLookup.get(right.path);
    if (left.path === bestMatch.path) return -1;
    if (right.path === bestMatch.path) return 1;
    if (leftRank && rightRank) return String(leftRank).localeCompare(String(rightRank));
    if (leftRank) return -1;
    if (rightRank) return 1;

    const leftRelated = [left.displayName, left.filename, nameGroup].some((value) =>
      normalizeSearchName(value).includes(normalizedQuery),
    );
    const rightRelated = [right.displayName, right.filename, nameGroup].some((value) =>
      normalizeSearchName(value).includes(normalizedQuery),
    );
    if (leftRelated !== rightRelated) return leftRelated ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
}

export function buildQuickFillPreview(paths: AppPaths, text: string): QuickFillPreview {
  if (typeof text !== 'string') {
    throw new Error('text must be a string');
  }

  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const acceptedLines = lines.slice(0, MAX_SELECTION_COUNT);
  const ignoredCount = Math.max(0, lines.length - MAX_SELECTION_COUNT);
  const sprites = listSprites(paths);

  const matches = acceptedLines.map((input, index) => {
    const rankedMatches = collectSpriteMatches(input, sprites);
    const matched = rankedMatches[0];

    return {
      slot: index,
      input,
      matched: Boolean(matched),
      matchType: matched?.matchType ?? null,
      sprite: matched?.sprite ?? null,
      candidates: matched ? buildQuickFillCandidates(input, matched.sprite, sprites, rankedMatches) : [],
    };
  });

  return {
    matches,
    acceptedCount: acceptedLines.length,
    matchedCount: matches.filter((item) => item.matched).length,
    ignoredCount,
    unmatched: matches.filter((item) => !item.matched).map((item) => item.input),
  };
}

/**
 * 单个常用精灵输入 → 判定是否命中 pets.json。
 * 「命中」指按名字 / 编号 / 别名精确匹配；未命中时返回最多 limit 个兜底候选（模糊匹配，默认 5 个）。
 * 供「信息录入」JSON 导入：命中的记为常用精灵，未命中的交由前端展示候选供用户选择。
 */
export function matchSpriteToken(
  input: string,
  sprites: SpriteRecord[],
  limit = 5,
): { matched: string | null; candidates: SpriteRecord[] } {
  const query = normalizeSearchName(input);
  if (!query) {
    return { matched: null, candidates: [] };
  }
  const matches = collectSpriteMatches(query, sprites);
  const top = matches[0];
  const exact = Boolean(top && typeof top.rank[0] === 'number' && top.rank[0] <= 2);
  return {
    matched: exact ? top.sprite.displayName : null,
    candidates: matches.slice(0, limit).map((item) => item.sprite),
  };
}
