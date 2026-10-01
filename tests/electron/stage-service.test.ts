import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { getStageState, saveStageState } from '../../electron/services/stage-service';

/**
 * 舞台配置「阵容镜像反转」（mirrorSides）：仅展示层开关（页面1-3 左右互换）。
 * 需要保证落盘往返、默认关闭、脏数据归一——否则重启后推流画面会错侧或静默丢失开关。
 */

function createIsolatedPaths(): AppPaths {
  const root = mkdtempSync(join(tmpdir(), 'roco-stage-'));
  const paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  return paths;
}

describe('stage-service：阵容镜像反转（mirrorSides）', () => {
  it('空目录默认关闭', () => {
    expect(getStageState(createIsolatedPaths()).mirrorSides).toBe(false);
  });

  it('开启后落盘持久化，且保存其他字段不会重置开关', () => {
    const paths = createIsolatedPaths();
    const saved = saveStageState(paths, { mirrorSides: true, page: 'page2' });
    expect(saved.mirrorSides).toBe(true);
    expect(saved.page).toBe('page2');

    const reloaded = getStageState(paths);
    expect(reloaded.mirrorSides).toBe(true);

    saveStageState(paths, { page3RankVisible: true });
    expect(getStageState(paths).mirrorSides).toBe(true);
  });

  it('可再次关闭，非法值按 false 归一', () => {
    const paths = createIsolatedPaths();
    saveStageState(paths, { mirrorSides: true });
    saveStageState(paths, { mirrorSides: false });
    expect(getStageState(paths).mirrorSides).toBe(false);

    saveStageState(paths, { mirrorSides: 'yes' });
    expect(getStageState(paths).mirrorSides).toBe(false);
  });
});