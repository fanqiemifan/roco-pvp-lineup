import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { saveRuntimeConfig } from '../../electron/services/config-service';
import {
  getMatchStore,
  recordMatchWinner,
  saveGameLineupForMatch,
  startCurrentGame,
} from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { applySyncImport, exportSyncBundle, previewSyncImport } from '../../electron/services/sync-service';
import {
  createTournament,
  deleteTournament,
  getLocallyRemovedTournaments,
  getTournamentRecordsIncludingTombstones,
  getTournamentStore,
  getTournamentTombstones,
  mergeTournamentRecords,
  onMatchCompleted,
  removeLocalTournament,
  restoreLocalTournament,
  rollbackWave,
  startTournament,
} from '../../electron/services/tournament-service';
import type { SyncImportPreview, TournamentRecord } from '../../shared/types';

let machineA: AppPaths;
let machineB: AppPaths;

beforeEach(() => {
  // machineA = 编排机（机器码 A），machineB = 只读副本 / 协作机（机器码 B）
  const rootA = mkdtempSync(join(tmpdir(), 'roco-sync-tourney-a-'));
  machineA = createAppPaths(rootA, rootA);
  mkdirSync(machineA.dataDir, { recursive: true });
  saveRuntimeConfig(machineA, { machineCode: 'A' });

  const rootB = mkdtempSync(join(tmpdir(), 'roco-sync-tourney-b-'));
  machineB = createAppPaths(rootB, rootB);
  mkdirSync(machineB.dataDir, { recursive: true });
  saveRuntimeConfig(machineB, { machineCode: 'B' });
});

function acceptAllKeys(preview: SyncImportPreview): string[] {
  return [...preview.matchItems, ...preview.playerItems, ...preview.teamItems]
    .filter((item) => item.action !== 'skip')
    .map((item) => item.key);
}

/** 在某台机器建立 n 名档案选手（id=p0..p(n-1)） */
function seedPlayers(paths: AppPaths, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    savePlayerProfile(paths, { id: `p${i}`, name: `选手${i}` });
    ids.push(`p${i}`);
  }
  return ids;
}

/** 创建并开赛 8 人系列赛（默认模板：8进4双败 → 4进2 → 总决赛单败），第一波 4 场 */
function createRunningSeries(paths: AppPaths): { id: string; record: TournamentRecord } {
  const playerIds = seedPlayers(paths, 8);
  const created = createTournament(paths, { name: '星际杯', playerIds, seed: 42 });
  const record = startTournament(paths, created.id);
  return { id: created.id, record };
}

/** 打完一场对局（自动适配 BO），每登记一小局都调用完成钩子（只读副本上自动跳过） */
function playMatch(paths: AppPaths, matchId: string, winnerSide: 'left' | 'right'): void {
  let match = getMatchStore(paths).matches.find((item) => item.id === matchId);
  let guard = 0;
  while (match && match.status !== 'completed') {
    const game = match.games.find((item) => item.status === 'pending');
    if (!game) {
      throw new Error('没有待开始小局');
    }
    saveGameLineupForMatch(paths, matchId, game.gameNumber, {
      left: [{ sprite: '3001' }],
      right: [{ sprite: '3002' }],
    });
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, winnerSide);
    onMatchCompleted(paths, matchId);
    match = getMatchStore(paths).matches.find((item) => item.id === matchId);
    guard += 1;
    if (guard > 10) {
      throw new Error('比赛无法收敛');
    }
  }
}

/** 系列赛第 1 波各节点的胜者（未写回 = null） */
function waveWinners(paths: AppPaths, tournamentId: string): Array<string | null> {
  const record = getTournamentStore(paths).find((item) => item.id === tournamentId);
  const wave = record?.waves.find((item) => item.stageIndex === 0 && item.waveIndex === 1);
  return wave ? wave.nodes.map((node) => node.winnerId) : [];
}

describe('同步包携带系列赛', () => {
  it('导出包含本机系列赛（id 带本机机器码）', () => {
    const { id } = createRunningSeries(machineA);

    const bundle = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });

    expect(bundle.tournaments).toHaveLength(1);
    expect(bundle.tournaments[0].id).toBe(id);
    expect(bundle.tournaments[0].id).toMatch(/^T\d{8}_A\d+$/);
  });

  it('旧包（无 tournaments 字段）导入兼容：不报错、系列赛统计全 0', async () => {
    const legacy = {
      app: 'roco-pvp-lineup',
      schema: 1,
      machine: 'B',
      exportedAt: new Date().toISOString(),
      matches: [],
    };

    const preview = previewSyncImport(machineA, legacy, 'newer');
    const result = await applySyncImport(machineA, legacy, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(preview),
      includeAvatars: false,
    });

    expect(result.tournaments).toEqual({ added: 0, updated: 0, skipped: 0, rejected: 0, advanced: false });
    expect(result.warnings).toEqual([]);
  });

  it('本机未设置机器标识时导入系列赛给出警告', async () => {
    const root = mkdtempSync(join(tmpdir(), 'roco-sync-nocode-'));
    const bare = createAppPaths(root, root);
    mkdirSync(bare.dataDir, { recursive: true });

    createRunningSeries(machineA);
    const bundle = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const preview = previewSyncImport(bare, bundle, 'newer');
    const result = await applySyncImport(bare, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(preview),
      includeAvatars: false,
    });

    expect(result.warnings.some((warning) => warning.includes('未设置机器标识'))).toBe(true);
  });
});

describe('mergeTournamentRecords（合并规则）', () => {
  it('首次新增 → 同内容幂等跳过 → 较新覆盖 → 更旧保持本机 → 以包为准强制覆盖', () => {
    const { id } = createRunningSeries(machineA);
    const base = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false }).tournaments[0];

    const first = mergeTournamentRecords(machineB, [base], 'newer');
    expect(first.added).toEqual([id]);
    expect(getTournamentStore(machineB)).toHaveLength(1);

    const second = mergeTournamentRecords(machineB, [base], 'newer');
    expect(second.skipped.map((item) => item.id)).toEqual([id]);

    const newer = JSON.parse(JSON.stringify(base)) as TournamentRecord;
    newer.name = '星际杯·改名';
    newer.updatedAt = new Date(Date.now() + 60_000).toISOString();
    const applied = mergeTournamentRecords(machineB, [newer], 'newer');
    expect(applied.updated).toEqual([id]);
    expect(getTournamentStore(machineB)[0].name).toBe('星际杯·改名');

    const older = JSON.parse(JSON.stringify(base)) as TournamentRecord;
    older.name = '旧版本';
    older.updatedAt = new Date(Date.now() - 60_000).toISOString();
    const kept = mergeTournamentRecords(machineB, [older], 'newer');
    expect(kept.skipped.map((item) => item.id)).toEqual([id]);
    expect(getTournamentStore(machineB)[0].name).toBe('星际杯·改名');

    const forced = mergeTournamentRecords(machineB, [older], 'bundle');
    expect(forced.updated).toEqual([id]);
    expect(getTournamentStore(machineB)[0].name).toBe('旧版本');
  });

  it('结构不合法的条目被忽略并计数', () => {
    const report = mergeTournamentRecords(machineB, [{ id: 'not-a-tournament' }, null, 42], 'newer');

    expect(report.rejected).toBe(3);
    expect(getTournamentStore(machineB)).toHaveLength(0);
  });
});

describe('编排机所有权闸门（只读副本）', () => {
  it('B 机拿到 A 的系列赛后：编排操作被拒；登记赛果只更新比赛、不写回对阵图', async () => {
    const { id } = createRunningSeries(machineA);
    const bundle = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const preview = previewSyncImport(machineB, bundle, 'newer');
    await applySyncImport(machineB, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(preview),
      includeAvatars: false,
    });

    // 只读副本可见（对阵图 / 标签 / 筛选都能解析）
    expect(getTournamentStore(machineB)).toHaveLength(1);

    // 一切编排变更被拒
    expect(() => rollbackWave(machineB, id)).toThrow(/由机器 A 编排/);
    expect(() => deleteTournament(machineB, id)).toThrow(/由机器 A 编排/);
    expect(() => startTournament(machineB, id)).toThrow(/由机器 A 编排/);

    // B 登记赛果：比赛正常完成，但对阵图节点保持未写回
    const matchId = getMatchStore(machineB).matches[0].id;
    playMatch(machineB, matchId, 'left');
    expect(getMatchStore(machineB).matches[0].status).toBe('completed');
    expect(onMatchCompleted(machineB, matchId)).toBeNull();
    expect(waveWinners(machineB, id).every((winner) => winner === null)).toBe(true);

    // 编排机侧同理无变化（B 未回传前 A 不知道这场结果）
    expect(waveWinners(machineA, id).every((winner) => winner === null)).toBe(true);
  });
});

describe('双机 8/8 登记全链路', () => {
  it('A 编排 + 各登记一半 → B 回传 A 推进 → 回传 B 同步对阵图', async () => {
    // 1) A 开赛建场（第一波 4 场），导出基线
    const { id } = createRunningSeries(machineA);
    const baselineMatches = getMatchStore(machineA).matches;
    expect(baselineMatches).toHaveLength(4);

    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const baselinePreview = previewSyncImport(machineB, baseline, 'newer');
    await applySyncImport(machineB, baseline, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(baselinePreview),
      includeAvatars: false,
    });

    // B 拿到只读对阵图与全部 4 场比赛，节点全部待写回
    expect(getTournamentStore(machineB)).toHaveLength(1);
    expect(getMatchStore(machineB).matches).toHaveLength(4);
    expect(waveWinners(machineB, id).every((winner) => winner === null)).toBe(true);

    // 2) 各登记一半：A 打前 2 场，B 打后 2 场
    const ids = baselineMatches.map((match) => match.id);
    playMatch(machineA, ids[0], 'left');
    playMatch(machineA, ids[1], 'right');
    playMatch(machineB, ids[2], 'left');
    playMatch(machineB, ids[3], 'right');

    // A 侧写回 2 个节点；B 侧只更新比赛，对阵图不动（只读副本）
    expect(waveWinners(machineA, id).filter(Boolean)).toHaveLength(2);
    expect(waveWinners(machineB, id).every((winner) => winner === null)).toBe(true);
    expect(getMatchStore(machineB).matches.filter((match) => match.status === 'completed')).toHaveLength(2);

    // 3) B 导出回传 → A 导入：合并赛果 + 写回补跑 → 第一波打齐自动推进
    const fromB = exportSyncBundle(machineB, { includeProfiles: false, includeAvatars: false });
    const fromBPreview = previewSyncImport(machineA, fromB, 'newer');
    const appliedOnA = await applySyncImport(machineA, fromB, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(fromBPreview),
      includeAvatars: false,
    });

    expect(appliedOnA.applied.match.update).toBe(2); // B 登记的 2 场覆盖到 A
    expect(appliedOnA.tournaments.updated).toBe(0); // B 的副本更旧，不覆盖编排机
    expect(appliedOnA.tournaments.advanced).toBe(true); // 写回补齐 → 自动推进

    expect(waveWinners(machineA, id).filter(Boolean)).toHaveLength(4);
    expect(getMatchStore(machineA).matches).toHaveLength(8); // 第一波 4 场 + 第二波（1-0 / 0-1 两桶各 2 场）
    const wave1OnA = getTournamentStore(machineA)
      .find((item) => item.id === id)!
      .waves.find((wave) => wave.stageIndex === 0 && wave.waveIndex === 1);
    expect(wave1OnA?.status).toBe('completed');

    // 4) A 导出新包 → B 导入：对阵图更新、下一波比赛到齐
    const advanced = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const advancedPreview = previewSyncImport(machineB, advanced, 'newer');
    const appliedOnB = await applySyncImport(machineB, advanced, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(advancedPreview),
      includeAvatars: false,
    });

    expect(appliedOnB.tournaments.updated).toBe(1);
    expect(appliedOnB.tournaments.advanced).toBe(false); // 只读副本上写回自动跳过
    expect(waveWinners(machineB, id).filter(Boolean)).toHaveLength(4);
    expect(getMatchStore(machineB).matches).toHaveLength(8);
  });

  it('赛果与已写回节点不一致（协作机重登）时导入给出 warning 提示人工处理', async () => {
    const { id } = createRunningSeries(machineA);
    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });

    // B 先拿基线（比赛均待开始）
    const previewB = previewSyncImport(machineB, baseline, 'newer');
    await applySyncImport(machineB, baseline, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewB),
      includeAvatars: false,
    });

    // A 把第一场登记为左侧胜（节点写回）；B 把同一场独立重登为右侧胜（模拟撤回重登）
    const matchId = getMatchStore(machineA).matches[0].id;
    playMatch(machineA, matchId, 'left');
    playMatch(machineB, matchId, 'right');
    expect(waveWinners(machineB, id).every((winner) => winner === null)).toBe(true);

    // B 回传 → A 导入：比赛记录被覆盖为新赛果，但节点已按旧赛果写回 → warning
    const fromB = exportSyncBundle(machineB, { includeProfiles: false, includeAvatars: false });
    const previewA = previewSyncImport(machineA, fromB, 'newer');
    const applied = await applySyncImport(machineA, fromB, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewA),
      includeAvatars: false,
    });

    expect(applied.warnings.some((warning) => warning.includes('与系列赛记录不一致'))).toBe(true);
  });
});

describe('删除墓碑的跨机传播', () => {
  it('删除写墓碑：对外不可见、导出包含墓碑、默认删除时对局解绑保留', () => {
    const { id } = createRunningSeries(machineA);
    const result = deleteTournament(machineA, id);
    expect(result.matchesDeleted).toBe(false);

    // 对外读取（getTournamentStore）不可见；含墓碑访问器能看到
    expect(getTournamentStore(machineA)).toEqual([]);
    const raw = getTournamentRecordsIncludingTombstones(machineA);
    expect(raw).toHaveLength(1);
    expect(raw[0].deletedAt).toBeTruthy();
    expect(raw[0].deletedMatchIds).toEqual(result.matchIds);

    // 导出包含墓碑；默认删除的对局已解绑、仍随包流转
    const bundle = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    expect(bundle.tournaments).toHaveLength(1);
    expect(bundle.tournaments[0].deletedAt).toBeTruthy();
    expect(bundle.matches).toHaveLength(result.matchIds.length);
    expect(bundle.matches.every((match) => match.tournamentRef === undefined)).toBe(true);
  });

  it('墓碑下传：接收端清副本并留存墓碑；旧包导入不复活、引用被再次解绑', async () => {
    const { id } = createRunningSeries(machineA);
    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const previewB = previewSyncImport(machineB, baseline, 'newer');
    await applySyncImport(machineB, baseline, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewB),
      includeAvatars: false,
    });
    expect(getTournamentStore(machineB)).toHaveLength(1);
    const matchCount = getMatchStore(machineB).matches.length;

    // A 删除并分发 → B 副本清除、墓碑留存、对局解绑保留为普通对局
    deleteTournament(machineA, id);
    const tombstoned = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const previewTomb = previewSyncImport(machineB, tombstoned, 'newer');
    await applySyncImport(machineB, tombstoned, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewTomb),
      includeAvatars: false,
    });

    expect(getTournamentStore(machineB)).toEqual([]);
    expect(getTournamentTombstones(machineB).map((record) => record.id)).toEqual([id]);
    expect(getMatchStore(machineB).matches).toHaveLength(matchCount);
    expect(getMatchStore(machineB).matches.every((match) => match.tournamentRef === undefined)).toBe(true);

    // 旧包（删除前的存活副本）再导入：墓碑优先（不受 bundle 覆盖模式影响），不复活；
    // 旧包把 tournamentRef 带回来 → 解绑不变量把它再解一次
    const revivePreview = previewSyncImport(machineB, baseline, 'bundle');
    const revived = await applySyncImport(machineB, baseline, {
      mode: 'bundle',
      acceptedKeys: acceptAllKeys(revivePreview),
      includeAvatars: false,
    });
    expect(revived.tournaments.added).toBe(0);
    expect(revived.tournaments.updated).toBe(0);
    expect(getTournamentStore(machineB)).toEqual([]);
    expect(getMatchStore(machineB).matches.every((match) => match.tournamentRef === undefined)).toBe(true);
  });

  it('墓碑鉴权：包作者与 id 内嵌码不符的墓碑被忽略，相符才应用', () => {
    const { id } = createRunningSeries(machineA);
    deleteTournament(machineA, id);
    const tombstone = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false }).tournaments[0];

    const rejected = mergeTournamentRecords(machineB, [tombstone], 'bundle', { authoredBy: 'B' });
    expect(rejected.added).toEqual([]);
    expect(rejected.updated).toEqual([]);
    expect(getTournamentTombstones(machineB)).toEqual([]);

    const accepted = mergeTournamentRecords(machineB, [tombstone], 'bundle', { authoredBy: 'A' });
    expect(accepted.added).toEqual([id]);
    expect(getTournamentTombstones(machineB).map((record) => record.id)).toEqual([id]);
  });

  it('墓碑对墓碑：保留最早 deletedAt 的一条（时钟无关）', () => {
    const { id } = createRunningSeries(machineA);
    deleteTournament(machineA, id);
    const later = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false })
      .tournaments[0] as TournamentRecord;
    const earlier = JSON.parse(JSON.stringify(later)) as TournamentRecord;
    earlier.deletedAt = new Date(Date.parse(String(later.deletedAt)) - 60_000).toISOString();

    mergeTournamentRecords(machineB, [later], 'bundle', { authoredBy: 'A' });
    const report = mergeTournamentRecords(machineB, [earlier], 'bundle', { authoredBy: 'A' });
    expect(report.updated).toEqual([id]);
    expect(getTournamentTombstones(machineB)[0].deletedAt).toBe(earlier.deletedAt);

    const again = mergeTournamentRecords(machineB, [later], 'bundle', { authoredBy: 'A' });
    expect(again.updated).toEqual([]);
    expect(getTournamentTombstones(machineB)[0].deletedAt).toBe(earlier.deletedAt);
  });

  it('连同对局删除：接收端按名单清掉本地副本；旧包携带的同名对局被名单拦截', async () => {
    const { id } = createRunningSeries(machineA);
    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const previewB = previewSyncImport(machineB, baseline, 'newer');
    await applySyncImport(machineB, baseline, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewB),
      includeAvatars: false,
    });
    expect(getMatchStore(machineB).matches.length).toBeGreaterThan(0);

    deleteTournament(machineA, id, { deleteMatches: true });
    const tombstoned = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    expect(tombstoned.matches).toEqual([]); // 名单对局不再进包

    const previewTomb = previewSyncImport(machineB, tombstoned, 'newer');
    const applied = await applySyncImport(machineB, tombstoned, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewTomb),
      includeAvatars: false,
    });
    expect(applied.warnings.some((warning) => warning.includes('墓碑'))).toBe(true);
    expect(getMatchStore(machineB).matches).toEqual([]); // 本机副本一并清掉

    // 旧包把已删对局带回来 → 名单拦截，不复活
    const revivePreview = previewSyncImport(machineB, baseline, 'bundle');
    await applySyncImport(machineB, baseline, {
      mode: 'bundle',
      acceptedKeys: acceptAllKeys(revivePreview),
      includeAvatars: false,
    });
    expect(getMatchStore(machineB).matches).toEqual([]);
    expect(getTournamentStore(machineB)).toEqual([]);
  });

  it('预览把「已删对局名单」拦截计入：名单内比赛标为跳过/拦截，不再显示为新增（与应用同口径）', async () => {
    const { id } = createRunningSeries(machineA);
    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const previewB = previewSyncImport(machineB, baseline, 'newer');
    await applySyncImport(machineB, baseline, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewB),
      includeAvatars: false,
    });
    expect(getMatchStore(machineB).matches.length).toBeGreaterThan(0);

    // A 连同对局删除并分发 → B 清副本、留存墓碑名单
    deleteTournament(machineA, id, { deleteMatches: true });
    const tombstoned = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const previewTomb = previewSyncImport(machineB, tombstoned, 'newer');
    await applySyncImport(machineB, tombstoned, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewTomb),
      includeAvatars: false,
    });
    expect(getMatchStore(machineB).matches).toEqual([]);

    // 旧包再次预览：名单内比赛必须提前标为「已删名单拦截」，不再算「新增」
    const revivePreview = previewSyncImport(machineB, baseline, 'bundle');
    const blocked = revivePreview.matchItems.filter((item) => item.blocked);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((item) => item.action === 'skip' && item.reason.includes('拦截'))).toBe(true);
    expect(revivePreview.summary.match.add).toBe(0);

    const group = revivePreview.tournamentGroups?.find((item) => item.id === id);
    expect(group?.localTombstone).toBe(true);
    expect(group?.selectableCount ?? 0).toBe(0);

    // 合并侧照旧拦下（落盘无变化），与预览标注一致
    await applySyncImport(machineB, baseline, {
      mode: 'bundle',
      acceptedKeys: acceptAllKeys(revivePreview),
      includeAvatars: false,
    });
    expect(getMatchStore(machineB).matches).toEqual([]);
  });
});

describe('定向同步 · 范围导出（P1-A）', () => {
  it('只含指定系列赛：编排 + 名下全部比赛 + 该届选手档案，其他系列赛不进包', () => {
    const { id } = createRunningSeries(machineA);
    const other = createRunningSeries(machineA);

    const scoped = exportSyncBundle(machineA, { includeProfiles: true, includeAvatars: false, tournamentIds: [id] });
    expect(scoped.tournaments.map((record) => record.id)).toEqual([id]);
    expect(scoped.matches.length).toBeGreaterThan(0);
    expect(scoped.matches.every((match) => match.tournamentRef?.tournamentId === id)).toBe(true);
    // 另一届的比赛与编排都不在包里
    expect(scoped.matches.some((match) => match.tournamentRef?.tournamentId === other.id)).toBe(false);
    expect(scoped.tournaments.some((record) => record.id === other.id)).toBe(false);
    // 档案只带该届选手（对端缺档案时晋级图会只显示一串 id）
    const playerIds = new Set(scoped.tournaments[0].playerIds);
    expect(scoped.profiles?.players.length).toBe(playerIds.size);
    expect(scoped.profiles?.players.every((player) => playerIds.has(player.id))).toBe(true);
    // 全量导出不受影响（仍含两届）
    const full = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    expect(full.tournaments.map((record) => record.id).sort()).toEqual([id, other.id].sort());
  });

  it('已删除的届：范围包只带墓碑与对局名单（定向删除指令），比赛不再进包', () => {
    const { id } = createRunningSeries(machineA);
    const alive = createRunningSeries(machineA);
    deleteTournament(machineA, id, { deleteMatches: true });

    const scoped = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false, tournamentIds: [id] });
    expect(scoped.tournaments).toHaveLength(1);
    expect(scoped.tournaments[0].id).toBe(id);
    expect(scoped.tournaments[0].deletedAt).toBeTruthy();
    expect(scoped.tournaments[0].deletedMatches).toBe(true);
    expect(scoped.tournaments[0].deletedMatchIds?.length ?? 0).toBeGreaterThan(0);
    expect(scoped.matches).toEqual([]);
    // 作用域严格等于所选的届：其他届（含存活副本与它们的墓碑）都不进包
    const full = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    expect(full.tournaments.some((record) => record.id === alive.id)).toBe(true);
  });
});

describe('本机移除（localOnly）不传播 / 不复活', () => {
  /** 机器 B 导入一份包（返回预览与合并报告） */
  async function importToB(bundle: ReturnType<typeof exportSyncBundle>, mode: 'newer' | 'bundle' = 'newer') {
    const preview = previewSyncImport(machineB, bundle, mode);
    const result = await applySyncImport(machineB, bundle, {
      mode,
      acceptedKeys: acceptAllKeys(preview),
      includeAvatars: false,
    });
    return { preview, result };
  }

  it('分控端移除后：导出包剔除该记录；编排机存活副本再导入不复活、对局引用保持不动；主控端不受影响', async () => {
    const { id } = createRunningSeries(machineA);
    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    await importToB(baseline);
    expect(getTournamentStore(machineB)).toHaveLength(1);
    const matchCountB = getMatchStore(machineB).matches.length;

    // B（只读副本）本机移除：立即隐藏、进本机移除清单
    const result = removeLocalTournament(machineB, id);
    expect(result.changed).toBe(true);
    expect(getTournamentStore(machineB)).toEqual([]);
    expect(getLocallyRemovedTournaments(machineB).map((record) => record.id)).toEqual([id]);

    // 出站包剔除 localOnly（文件导出 / 云分发同源）：绝不外传，接收端不会误判成删除指令
    const fromB = exportSyncBundle(machineB, { includeProfiles: false, includeAvatars: false });
    expect(fromB.tournaments).toEqual([]);

    // 编排机存活副本以 bundle（强制覆盖）再导入：不复活（本机墓碑优先）
    const revived = await importToB(baseline, 'bundle');
    expect(revived.result.tournaments.added).toBe(0);
    expect(revived.result.tournaments.updated).toBe(0);
    expect(getTournamentStore(machineB)).toEqual([]);
    expect(getLocallyRemovedTournaments(machineB)).toHaveLength(1);
    // 对局引用保留不动（与真墓碑不同：本机移除不解绑、不删对局）
    expect(getMatchStore(machineB).matches).toHaveLength(matchCountB);
    expect(getMatchStore(machineB).matches.every((match) => match.tournamentRef?.tournamentId === id)).toBe(true);

    // B 的导出包被编排机导入：主控端不受影响（该系列赛照常存在）
    const previewA = previewSyncImport(machineA, fromB, 'newer');
    await applySyncImport(machineA, fromB, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(previewA),
      includeAvatars: false,
    });
    expect(getTournamentStore(machineA).map((record) => record.id)).toEqual([id]);
  });

  it('同步预览标记 localRemoved：再次导入后仍保持隐藏（不显示为「本机已有 / 将新建」）', async () => {
    const { id } = createRunningSeries(machineA);
    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    await importToB(baseline);
    removeLocalTournament(machineB, id);

    const preview = previewSyncImport(machineB, baseline, 'newer');
    const group = preview.tournamentGroups?.find((item) => item.id === id);
    expect(group?.localRemoved).toBe(true);
    // 本机移除的记录不进 getTournamentStore：不再显示为「本机已有」
    expect(group?.existsLocally).toBe(false);

    await importToB(baseline);
    expect(getTournamentStore(machineB).some((record) => record.id === id)).toBe(false);
    expect(getLocallyRemovedTournaments(machineB).some((record) => record.id === id)).toBe(true);
  });

  it('真墓碑到达替换本机移除记录；恢复后下次同步自动补齐编排机最新内容', async () => {
    const { id } = createRunningSeries(machineA);
    const baseline = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    await importToB(baseline);
    const beforeHidden = getTournamentStore(machineB)[0];
    removeLocalTournament(machineB, id);
    const hidden = getLocallyRemovedTournaments(machineB)[0];
    expect(hidden.updatedAt).toBe(beforeHidden.updatedAt);

    // 编排机继续推进（打完首波一场 → 系列赛记录更新）
    const pendingMatch = getMatchStore(machineA).matches.find(
      (match) => match.status === 'pending' && match.tournamentRef?.tournamentId === id,
    );
    expect(pendingMatch).toBeTruthy();
    playMatch(machineA, pendingMatch!.id, 'left');
    const advanced = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const advancedRecord = advanced.tournaments.find((record) => record.id === id) as TournamentRecord;
    expect(advancedRecord.updatedAt).not.toBe(hidden.updatedAt);

    // 「同步最新」：仍保持隐藏；隐藏副本内容不被更新（恢复时以编排机最新为准）
    await importToB(advanced);
    expect(getTournamentStore(machineB).some((record) => record.id === id)).toBe(false);
    expect(getLocallyRemovedTournaments(machineB)[0].updatedAt).toBe(hidden.updatedAt);

    // 恢复 → 立即可见（旧内容）；下一次同步自动补齐到编排机最新版本
    restoreLocalTournament(machineB, id);
    expect(getTournamentStore(machineB).some((record) => record.id === id)).toBe(true);
    await importToB(advanced);
    expect(getTournamentStore(machineB).find((record) => record.id === id)?.updatedAt).toBe(advancedRecord.updatedAt);

    // 编排机实删（连同对局）到达：localOnly 被真墓碑替换、恢复列表不再可见、名单对局清理
    removeLocalTournament(machineB, id);
    deleteTournament(machineA, id, { deleteMatches: true });
    const tombstoned = exportSyncBundle(machineA, { includeProfiles: false, includeAvatars: false });
    const applied = await importToB(tombstoned);
    expect(getLocallyRemovedTournaments(machineB)).toEqual([]);
    expect(getTournamentTombstones(machineB).map((record) => record.id)).toEqual([id]);
    expect(getMatchStore(machineB).matches.filter((match) => match.tournamentRef?.tournamentId === id)).toEqual([]);
    expect(applied.result.warnings.some((warning) => warning.includes('墓碑'))).toBe(true);
  });
});