import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createMatch } from '../../electron/services/match-service';
import { PAGE7_MAX_MATCHES, getPage7State, savePage7State } from '../../electron/services/page7-service';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-page7-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });
});

function seedMatches(count: number): string[] {
  return Array.from({ length: count }, (_value, index) => {
    const store = createMatch(paths, {
      leftPlayer: `左${index}`,
      rightPlayer: `右${index}`,
      bestOf: 1,
    });
    return store.activeMatchId!;
  });
}

describe('page7-service 选场状态', () => {
  it('不再按 9 场截断：按阶段·波次整组勾选多少就存多少', () => {
    // 32进16 首轮 = 16 场（原上限 9 会把整组勾选静默截成 9 场）
    const ids = seedMatches(16);
    const saved = savePage7State(paths, { matchIds: ids });
    expect(saved.matchIds).toEqual(ids);
    expect(getPage7State(paths).matchIds).toHaveLength(16);
  });

  it('去重 + 剔除不存在的比赛（悬空引用不落盘）', () => {
    const ids = seedMatches(3);
    const saved = savePage7State(paths, {
      matchIds: [ids[0], ids[0], '20260101_A999', ids[1], ''],
    });
    expect(saved.matchIds).toEqual([ids[0], ids[1]]);
  });

  it('选场上限为 20 场（产品限制），超出部分静默截断', () => {
    const ids = seedMatches(PAGE7_MAX_MATCHES + 5);
    const saved = savePage7State(paths, { matchIds: ids });
    expect(saved.matchIds).toHaveLength(PAGE7_MAX_MATCHES);
    expect(saved.matchIds).toEqual(ids.slice(0, PAGE7_MAX_MATCHES));
  });

  it('只更新部分字段时保留其余字段（标题 / 温馨提示）', () => {
    const ids = seedMatches(2);
    savePage7State(paths, { matchIds: ids, title: 'S2 联赛', notice: '自定义提示' });
    const updated = savePage7State(paths, { matchIds: [ids[1]] });
    expect(updated.title).toBe('S2 联赛');
    expect(updated.notice).toBe('自定义提示');
    expect(updated.matchIds).toEqual([ids[1]]);
  });
});
