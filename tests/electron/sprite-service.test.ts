import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { buildQuickFillPreview, listSprites, spriteMatchesKeyword } from '../../electron/services/sprite-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let paths: AppPaths;

/**
 * 精灵库夹具：listSprites 优先读 dataDir/pets.json 索引，且要求
 * spritesDir 里存在对应文件（{pet_id}_{name}.png）才会收录。
 * 3001 号故意不建文件，用于验证「缺图条目被过滤」。
 */
function writeSpriteLibrary(): void {
  writeFileSync(
    join(paths.dataDir, 'pets.json'),
    JSON.stringify({
      items: [
        { pet_id: '1001', name: '暮星辰', handbook_no: 1 },
        { pet_id: '1002', name: '暮星辰', form: '春天的样子', handbook_no: 1 },
        { pet_id: '2001', name: '怖哭菇', handbook_no: 2 },
        { pet_id: '3001', name: '缺图精灵', handbook_no: 3 },
      ],
    }),
    'utf-8',
  );
  for (const filename of ['1001_暮星辰.png', '1002_暮星辰.png', '2001_怖哭菇.png']) {
    writeFileSync(join(paths.spritesDir, filename), 'png');
  }
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-sprite-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.spritesDir, { recursive: true });
  writeSpriteLibrary();
});

describe('listSprites', () => {
  it('读取 pets.json 索引并过滤掉缺图条目', () => {
    const sprites = listSprites(paths);
    expect(sprites.map((sprite) => sprite.id)).toEqual(['1001', '1002', '2001']);
  });

  it('多形态变体：displayName 保持纯名称，name 带形态后缀', () => {
    const sprites = listSprites(paths);
    expect(sprites[0]).toMatchObject({ id: '1001', displayName: '暮星辰', name: '暮星辰', petForm: '' });
    expect(sprites[1]).toMatchObject({
      id: '1002',
      displayName: '暮星辰',
      name: '暮星辰（春天的样子）',
      petForm: '春天的样子',
    });
  });

  it('图鉴编号生成数字与编号别名（1 / 001 / NO.001）', () => {
    const sprite = listSprites(paths)[0];
    expect(sprite.number).toBe(1);
    for (const alias of ['1', '001', 'NO.001']) {
      expect(sprite.aliases).toContain(alias);
    }
  });
});

describe('spriteMatchesKeyword', () => {
  it('按 displayName / 完整名 / 编号别名 / pet_id 匹配', () => {
    const sprites = listSprites(paths);
    const base = sprites[0];
    const variant = sprites[1];

    expect(spriteMatchesKeyword(base, '暮星辰')).toBe(true);
    expect(spriteMatchesKeyword(variant, '暮星辰（春天的样子）')).toBe(true);
    expect(spriteMatchesKeyword(base, '001')).toBe(true);
    expect(spriteMatchesKeyword(base, 'NO.001')).toBe(true);
    expect(spriteMatchesKeyword(base, '1001')).toBe(true);
    expect(spriteMatchesKeyword(base, '怖哭菇')).toBe(false);
    expect(spriteMatchesKeyword(base, '')).toBe(true);
  });
});

describe('buildQuickFillPreview', () => {
  it('逐行匹配：命中、未命中与 unmatched 汇总', () => {
    const preview = buildQuickFillPreview(paths, '暮星辰\n怖哭菇\n不存在的精灵\n');

    expect(preview.acceptedCount).toBe(3);
    expect(preview.matchedCount).toBe(2);
    expect(preview.ignoredCount).toBe(0);
    expect(preview.unmatched).toEqual(['不存在的精灵']);

    const [star, mushroom, missing] = preview.matches;
    expect(star.slot).toBe(0);
    expect(star.matched).toBe(true);
    expect(['1001', '1002']).toContain(star.sprite?.id);
    expect(mushroom.matched).toBe(true);
    expect(mushroom.sprite?.id).toBe('2001');
    expect(missing.matched).toBe(false);
    expect(missing.sprite).toBeNull();
  });

  it('多形态家族：候选包含全部同编号同名变体', () => {
    const preview = buildQuickFillPreview(paths, '暮星辰');
    const candidates = preview.matches[0].candidates.map((sprite) => sprite.id);
    expect(candidates).toContain('1001');
    expect(candidates).toContain('1002');
  });

  it('单一精灵无多候选', () => {
    const preview = buildQuickFillPreview(paths, '怖哭菇');
    expect(preview.matches[0].candidates.map((sprite) => sprite.id)).toEqual(['2001']);
  });

  it('超过 6 行的部分忽略并计数', () => {
    const text = Array.from({ length: 7 }, (_, index) => `精灵${index}`).join('\n');
    const preview = buildQuickFillPreview(paths, text);
    expect(preview.acceptedCount).toBe(6);
    expect(preview.ignoredCount).toBe(1);
  });

  it('非字符串输入报错', () => {
    expect(() => buildQuickFillPreview(paths, 42 as unknown as string)).toThrow('text must be a string');
  });
});
