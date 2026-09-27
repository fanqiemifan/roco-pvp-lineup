import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { listSprites, spriteLookup } from '../../electron/services/sprite-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let paths: AppPaths;

function writePets(items: Array<{ pet_id: string; name: string }>): void {
  writeFileSync(join(paths.dataDir, 'pets.json'), JSON.stringify({ items }), 'utf-8');
}

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-sprite-cache-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.spritesDir, { recursive: true });
  mkdirSync(paths.spritesIconDir, { recursive: true });
  writePets([{ pet_id: '1001', name: '暮星辰' }]);
  writeFileSync(join(paths.spritesDir, '1001_暮星辰.png'), 'png');
});

describe('精灵索引进程级缓存', () => {
  it('同一 paths 重复读取返回一致结果（走缓存）', () => {
    const first = listSprites(paths);
    const second = listSprites(paths);
    expect(second).toEqual(first);
    expect(second.map((sprite) => sprite.id)).toEqual(['1001']);
  });

  it('pets.json 与立绘目录变化后按 mtime 自动失效，无需重启', async () => {
    expect(listSprites(paths).map((sprite) => sprite.id)).toEqual(['1001']);

    // 模拟 sync:sprites 新增精灵：pets.json 与立绘目录 mtime 都变化
    writePets([
      { pet_id: '1001', name: '暮星辰' },
      { pet_id: '2001', name: '怖哭菇' },
    ]);
    writeFileSync(join(paths.spritesDir, '2001_怖哭菇.png'), 'png');
    // 确保文件 mtime 可分辨
    await new Promise((resolve) => setTimeout(resolve, 20));

    const sprites = listSprites(paths);
    expect(sprites.map((sprite) => sprite.id)).toEqual(['1001', '2001']);
    expect(spriteLookup(paths).get('2001')?.displayName).toBe('怖哭菇');
  });
});
