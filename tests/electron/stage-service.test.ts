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

describe('stage-service：战绩详情切屏间隔（page7SwitchSeconds）', () => {
  it('空目录默认 10 秒', () => {
    expect(getStageState(createIsolatedPaths()).page7SwitchSeconds).toBe(10);
  });

  it('保存后落盘持久化，且保存其他字段不会重置它', () => {
    const paths = createIsolatedPaths();
    expect(saveStageState(paths, { page7SwitchSeconds: 30, page: 'page7' }).page7SwitchSeconds).toBe(30);
    expect(getStageState(paths).page7SwitchSeconds).toBe(30);

    saveStageState(paths, { page3RankVisible: true });
    expect(getStageState(paths).page7SwitchSeconds).toBe(30);
  });

  it('非法值回默认 10，超范围夹到 [2, 600]', () => {
    const paths = createIsolatedPaths();
    saveStageState(paths, { page7SwitchSeconds: 'abc' });
    expect(getStageState(paths).page7SwitchSeconds).toBe(10);

    saveStageState(paths, { page7SwitchSeconds: 0 });
    expect(getStageState(paths).page7SwitchSeconds).toBe(2);

    saveStageState(paths, { page7SwitchSeconds: 9999 });
    expect(getStageState(paths).page7SwitchSeconds).toBe(600);
  });
});

describe('stage-service：数据统计页设置（page15 过滤与排序）', () => {
  it('空目录默认全部系列赛/全部阶段/按使用次数降序排序', () => {
    const state = getStageState(createIsolatedPaths());
    expect(state.page15TournamentId).toBe('');
    expect(state.page15Stage).toBe('');
    expect(state.page15SortBy).toBe('picks');
    expect(state.page15SortOrder).toBe('desc');
  });

  it('保存后落盘持久化，且保存其他字段不会重置', () => {
    const paths = createIsolatedPaths();
    const saved = saveStageState(paths, {
      page15TournamentId: 'T20260928_A01',
      page15Stage: '1',
      page15SortBy: 'winRate',
      page15SortOrder: 'asc',
      page: 'page15',
    });
    expect(saved.page15TournamentId).toBe('T20260928_A01');
    expect(saved.page15Stage).toBe('1');
    expect(saved.page15SortBy).toBe('winRate');
    expect(saved.page15SortOrder).toBe('asc');
    expect(saved.page).toBe('page15');

    saveStageState(paths, { page3RankVisible: true });
    const reloaded = getStageState(paths);
    expect(reloaded.page15TournamentId).toBe('T20260928_A01');
    expect(reloaded.page15Stage).toBe('1');
    expect(reloaded.page15SortBy).toBe('winRate');
    expect(reloaded.page15SortOrder).toBe('asc');
  });

  it('脏数据归一：非法系列赛 id 置空、非法排序回 picks、非法阶段置空、前导零归一、非法排序方向回降序', () => {
    const paths = createIsolatedPaths();
    saveStageState(paths, {
      page15Stage: '02',
      page15TournamentId: '../evil',
      page15SortBy: 'hack',
      page15SortOrder: 'hack',
    });
    const state = getStageState(paths);
    expect(state.page15Stage).toBe('2');
    expect(state.page15TournamentId).toBe('');
    expect(state.page15SortBy).toBe('picks');
    expect(state.page15SortOrder).toBe('desc');

    saveStageState(paths, { page5Stage: 'abc' });
    expect(getStageState(paths).page5Stage).toBe('');
  });
});