import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  advanceTournament,
  createTournament,
  deleteTournament,
  getLocallyRemovedTournaments,
  getTournamentRecordsIncludingTombstones,
  getTournamentStore,
  getTournamentTombstones,
  importPairings,
  lockPairings,
  onMatchCompleted,
  onMatchUndo,
  prepareTournamentWriteBack,
  previewOpeningWave,
  redrawTournament,
  removeLocalTournament,
  resolveStageStandings,
  restoreLocalTournament,
  rollbackWave,
  savePairingDraft,
  startTournament,
} from '../../electron/services/tournament-service';
import {
  createMatch,
  forfeitMatch,
  getMatchStore,
  recordMatchWinner,
  saveGameLineupForMatch,
  startCurrentGame,
  undoDeletedMatches,
  undoMatchAction,
} from '../../electron/services/match-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import type { TournamentRecord, TournamentWave } from '../../shared/types';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-tournament-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });
});

/** 建立 n 名档案选手：id=p0..p(n-1)，name=选手0.. */
function seedPlayers(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    savePlayerProfile(paths, { id: `p${i}`, name: `选手${i}` });
    ids.push(`p${i}`);
  }
  return ids;
}

/** 固定 seed 创建系列赛（默认 32 人默认模板） */
function createSeries(count: number, patch: Record<string, unknown> = {}): TournamentRecord {
  const playerIds = seedPlayers(count);
  return createTournament(paths, { name: '星空杯S1', playerIds, seed: 42, ...patch });
}

/** 打完一场对决（自动适配 BO1/BO3），每登记一小局都调用完成钩子；返回完成后的 MatchRecord */
function playMatchToEnd(matchId: string, winnerSide: 'left' | 'right'): void {
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

/** 从当前 pending 系列赛比赛里逐场打完整个系列赛（随机胜者），返回最终记录 */
function runWholeSeries(tournamentId: string): TournamentRecord {
  // setup → running（start 仅 setup 可用）
  const initial = getTournamentStore(paths).find((item) => item.id === tournamentId);
  if (initial?.status === 'setup') {
    startTournament(paths, tournamentId);
  }

  let guard = 0;
  while (true) {
    const tournament = getTournamentStore(paths).find((item) => item.id === tournamentId);
    if (!tournament) {
      throw new Error('系列赛不存在');
    }
    if (tournament.status === 'completed') {
      return tournament;
    }
    const pending = getMatchStore(paths).matches.filter(
      (match) => match.status === 'pending' && match.tournamentRef?.tournamentId === tournamentId,
    );
    if (!pending.length) {
      throw new Error('没有待开始比赛，系列赛卡死');
    }
    playMatchToEnd(pending[0].id, Math.random() < 0.5 ? 'left' : 'right');
    guard += 1;
    if (guard > 200) {
      throw new Error('系列赛无法收敛');
    }
  }
}

/** 打完某阶段全部未开始比赛（左侧胜），直到晋级推进到下一阶段，返回结束时记录 */
function playStage(tournamentId: string, stageIndex: number): TournamentRecord {
  let guard = 0;
  while (true) {
    const record = getTournamentStore(paths).find((item) => item.id === tournamentId)!;
    if (record.currentStageIndex !== stageIndex || record.status !== 'running') {
      return record;
    }
    const stageMatchIds = new Set(
      record.waves
        .filter((wave) => wave.stageIndex === stageIndex)
        .flatMap((wave) => wave.nodes.map((node) => node.matchId)),
    );
    const pending = getMatchStore(paths).matches.find(
      (match) => match.status === 'pending' && stageMatchIds.has(match.id),
    );
    if (!pending) {
      return record;
    }
    playMatchToEnd(pending.id, 'left');
    guard += 1;
    if (guard > 40) {
      throw new Error('阶段无法收敛');
    }
  }
}

describe('getTournamentStore', () => {
  it('未落盘时返回空列表', () => {
    expect(getTournamentStore(paths)).toEqual([]);
  });
});

describe('createTournament', () => {
  it('创建 setup 草稿：T前缀id、默认模板、entries 全 alive、waves 为空', () => {
    const tournament = createSeries(32);
    expect(tournament.id).toMatch(/^T\d{8}_A\d{2}$/);
    expect(tournament.status).toBe('setup');
    expect(tournament.drawVersion).toBe(0);
    expect(tournament.seed).toBe(42);
    expect(tournament.stages).toHaveLength(5);
    expect(tournament.stages[0].name).toBe('32进16');
    expect(tournament.currentStageIndex).toBe(0);
    expect(tournament.waves).toEqual([]);
    expect(tournament.entries).toHaveLength(32);
    expect(tournament.entries.every((entry) => entry.state === 'alive' && entry.stageWins === 0 && entry.stageLosses === 0)).toBe(true);
  });

  it('stages 省略时按人数给默认模板（8人=3阶段、4人=2阶段）', () => {
    expect(createSeries(8).stages.map((stage) => stage.name)).toEqual(['8进4', '4进2', '总决赛']);
    expect(createSeries(4).stages.map((stage) => stage.name)).toEqual(['4进2', '总决赛']);
    expect(createSeries(16).stages.map((stage) => stage.name)).toEqual(['16进8', '8进4', '4进2', '总决赛']);
  });

  it('显式 stages：字段被规范化（id 重排、bestOf 白名单、配对方式随赛制兼容）', () => {
    const playerIds = seedPlayers(8);
    const tournament = createTournament(paths, {
      name: '自定义杯',
      playerIds,
      seed: 1,
      stages: [
        { id: 'x', name: '八强', format: 'double-life', bestOf: 3, pairing: 'random-bucket', avoidRematch: false, requireConfirm: true },
        { name: '决赛', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
      ],
    });
    expect(tournament.stages[0].id).toBe('s0');
    expect(tournament.stages[0].requireConfirm).toBe(true);
    expect(tournament.stages[0].avoidRematch).toBe(false);
    expect(tournament.stages[1].id).toBe('s1');
  });

  it('阶段局数支持 BO1/BO3/BO5/BO7：BO5/BO7 生效，越界值回退 BO1', () => {
    const tournament = createTournament(paths, {
      name: '局数白名单',
      playerIds: seedPlayers(8),
      seed: 1,
      stages: [
        { name: '八强', format: 'double-life', bestOf: 7, pairing: 'random-bucket' },
        { name: '四强', format: 'single-elim', bestOf: 5, pairing: 'bracket-seed' },
        { name: '决赛', format: 'single-elim', bestOf: 4, pairing: 'bracket-seed' },
      ],
    });
    expect(tournament.stages.map((stage) => stage.bestOf)).toEqual([7, 5, 1]);

    // BO7 阶段建场后，比赛赛制随阶段落库
    const started = startTournament(paths, tournament.id);
    const firstMatch = getMatchStore(paths).matches.find(
      (match) => match.id === started.waves[0].nodes[0].matchId,
    );
    expect(firstMatch?.bestOf).toBe(7);
  });

  it('总决赛阶段（只剩 2 人）必须为单败：双败末阶段拒绝', () => {
    // 4 人两阶段：s0 有 4 人、s1 只剩 2 人 → s1 是总决赛，必须单败
    const twoStages = (lastFormat: 'double-life' | 'single-elim') => ({
      name: '决赛杯',
      playerIds: seedPlayers(4),
      seed: 42,
      stages: [
        { name: '4进2', format: 'single-elim' as const, bestOf: 1, pairing: 'bracket-seed' as const },
        { name: '总决赛', format: lastFormat, bestOf: 3, pairing: lastFormat === 'double-life' ? 'random-bucket' as const : 'bracket-seed' as const },
      ],
    });
    expect(() => createTournament(paths, twoStages('double-life'))).toThrow(/总决赛阶段必须为单败/);
    expect(createTournament(paths, twoStages('single-elim')).stages).toHaveLength(2);

    // 8 人只配一个双败阶段：该阶段是「最后一个」但有 8 人（不是总决赛），仍然允许
    const single = createTournament(paths, {
      name: '单阶段双败',
      playerIds: seedPlayers(8),
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'random-bucket' }],
    });
    expect(single.stages[0].format).toBe('double-life');
  });

  it('双败阶段误传单败配对方式时强制改回 random-bucket', () => {
    const playerIds = seedPlayers(4);
    const tournament = createTournament(paths, {
      name: '杯赛',
      playerIds,
      seed: 1,
      stages: [{ name: '四进二', format: 'double-life', bestOf: 1, pairing: 'bracket-seed' }],
    });
    expect(tournament.stages[0].pairing).toBe('random-bucket');
  });

  it('非法人数（非4/8/16/32）、重复选手、未知档案、空名称全部拒绝', () => {
    const ids = seedPlayers(8);
    expect(() => createTournament(paths, { name: '杯', playerIds: ids.slice(0, 3), seed: 1 })).toThrow(/人数/);
    expect(() => createTournament(paths, { name: '杯', playerIds: [ids[0], ids[0]], seed: 1 })).toThrow(/重复/);
    expect(() => createTournament(paths, { name: '杯', playerIds: [ids[0], ids[1], ids[2], 'unknown-x'], seed: 1 })).toThrow(/档案/);
    expect(() => createTournament(paths, { name: '  ', playerIds: [ids[0], ids[1]], seed: 1 })).toThrow(/名称/);
  });

  it('同日期同机器码序号递增且不重复', () => {
    const first = createSeries(4);
    const second = createSeries(4);
    expect(second.id).not.toBe(first.id);
    expect(second.id).toMatch(/^T\d{8}_A02$/);
  });
});

describe('redrawTournament', () => {
  it('setup 状态按新 seed 重洗种子顺序，drawVersion 递增；同 seed 结果可复现', () => {
    const tournament = createSeries(8);
    const original = [...tournament.playerIds];
    const redrawn = redrawTournament(paths, tournament.id, { seed: 7 });
    expect(redrawn.playerIds.join(',')).not.toBe(original.join(','));
    expect(redrawn.drawVersion).toBe(1);
    expect(redrawn.seed).toBe(7);
    // entries 顺序与种子顺序保持一致
    expect(redrawn.entries.map((entry) => entry.playerId)).toEqual(redrawn.playerIds);

    const again = redrawTournament(paths, tournament.id, { seed: 7 });
    expect(again.playerIds).toEqual(redrawn.playerIds);
    expect(again.drawVersion).toBe(2);
  });

  it('非 setup 状态拒绝重抽', () => {
    const tournament = createSeries(8);
    startTournament(paths, tournament.id);
    expect(() => redrawTournament(paths, tournament.id, { seed: 9 })).toThrow(/setup/);
  });
});

describe('startTournament', () => {
  it('随机自动模式：锁定 W1 并批量建场（nodes/matches/ref/tags），状态转 running', () => {
    const tournament = createSeries(32);
    const started = startTournament(paths, tournament.id);
    expect(started.status).toBe('running');
    const wave = started.waves[0];
    expect(wave.pairingStatus).toBe('locked');
    expect(wave.status).toBe('running');
    expect(wave.nodes).toHaveLength(16);
    expect(wave.nodes.every((node) => node.matchId && node.playerAId && node.playerBId && !node.winnerId)).toBe(true);

    const matches = getMatchStore(paths).matches;
    expect(matches).toHaveLength(16);
    const waveMatches = matches.filter((match) => match.tournamentRef?.waveIndex === 1);
    expect(waveMatches).toHaveLength(16);
    expect(waveMatches.every((match) => match.bestOf === 1)).toBe(true);
    // 建场不再写身份标签（赛事名/阶段/波次由 tournamentRef 解析）；非跨桶普通场次无标注标签
    expect(waveMatches[0].tags).toEqual([]);
    // 节点 id 与 ref 一致
    const nodeIds = new Set(wave.nodes.map((node) => node.id));
    expect(waveMatches.every((match) => nodeIds.has(match.tournamentRef?.nodeId ?? ''))).toBe(true);
  });

  it('引擎建场时从选手档案快照排位排名（leftRank/rightRank 随档案带出）', () => {
    const playerIds = seedPlayers(4);
    // 覆盖档案排名：选手0=1、选手1=12、选手2=7、选手3=22
    const ranks = ['1', '12', '7', '22'];
    playerIds.forEach((id, index) => {
      savePlayerProfile(paths, { id, name: `选手${index}`, rank: ranks[index] });
    });
    const tournament = createTournament(paths, { name: '排名杯', playerIds, seed: 7 });
    startTournament(paths, tournament.id);

    const matches = getMatchStore(paths).matches;
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(match.leftRank).toBe(ranks[Number(match.leftPlayer.replace('选手', ''))]);
      expect(match.rightRank).toBe(ranks[Number(match.rightPlayer.replace('选手', ''))]);
    }
  });

  it('manual-bucket 或 requireConfirm：W1 仅生成 draft 草稿，matches.json 无新增', () => {
    const playerIds = seedPlayers(8);
    const manual = createTournament(paths, {
      name: '手动杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    });
    const started = startTournament(paths, manual.id);
    const wave = started.waves[0];
    expect(wave.pairingStatus).toBe('draft');
    expect(wave.status).toBe('pending');
    expect(wave.nodes).toEqual([]);
    expect(wave.pairingDraft).toHaveLength(4);
    expect(wave.pairingDraft?.every((item) => item.bucketKey === '0-0' && item.pair[0] && item.pair[1])).toBe(true);
    expect(getMatchStore(paths).matches).toHaveLength(0);
  });

  it('非 setup 状态拒绝开赛', () => {
    const tournament = createSeries(4);
    startTournament(paths, tournament.id);
    expect(() => startTournament(paths, tournament.id)).toThrow(/setup/);
  });
});

describe('previewOpeningWave（只读首波预览）', () => {
  it('不落盘、不建场，且与开赛后实际 W1 节点逐场一致', () => {
    const tournament = createSeries(32);
    const before = getTournamentStore(paths)[0];
    const preview = previewOpeningWave(paths, tournament.id);
    expect(preview.pairs).toHaveLength(16);
    expect(preview.pairs.every((item) => item.pair[0] && item.pair[1])).toBe(true);

    // 只读：记录与比赛库都没有变化
    const afterPreview = getTournamentStore(paths)[0];
    expect(afterPreview.waves).toEqual([]);
    expect(afterPreview.status).toBe('setup');
    expect(afterPreview.seed).toBe(before.seed);
    expect(getMatchStore(paths).matches).toHaveLength(0);

    // 开赛后 W1 节点顺序与预览完全一致
    const started = startTournament(paths, tournament.id);
    expect(started.waves[0].nodes.map((node) => [node.playerAId, node.playerBId])).toEqual(
      preview.pairs.map((item) => item.pair),
    );
  });

  it('重抽后预览随之变化，且与重抽后的实际 W1 一致', () => {
    const tournament = createSeries(16);
    const first = previewOpeningWave(paths, tournament.id).pairs;
    redrawTournament(paths, tournament.id, { seed: 7 });
    const second = previewOpeningWave(paths, tournament.id).pairs;
    expect(second).not.toEqual(first);

    const started = startTournament(paths, tournament.id);
    expect(started.waves[0].nodes.map((node) => [node.playerAId, node.playerBId])).toEqual(
      second.map((item) => item.pair),
    );
  });

  it('非 setup 状态与不存在的系列赛均拒绝', () => {
    const tournament = createSeries(4);
    expect(() => previewOpeningWave(paths, 'T20260929_A99')).toThrow(/不存在/);
    startTournament(paths, tournament.id);
    expect(() => previewOpeningWave(paths, tournament.id)).toThrow(/setup/);
  });
});

describe('配对确认台 draft / lock', () => {
  /** 创建 8 人手动杯并开赛至 W1 draft，返回记录 */
  function draftSeries(pairing: 'manual-bucket' | 'random-bucket' = 'manual-bucket'): TournamentRecord {
    const playerIds = seedPlayers(8);
    const created = createTournament(paths, {
      name: '手动杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing }],
    });
    return startTournament(paths, created.id);
  }

  it('savePairingDraft：编辑中间态直接暂存（漏配/重复也存），字段过白名单', () => {
    const tournament = draftSeries();
    const draft = tournament.waves[0].pairingDraft ?? [];
    // 模拟编辑：第二场只配了一边（漏配）
    const edited = [
      draft[0],
      { bucketKey: '0-0', pair: [draft[1].pair[0], null] },
      draft[2],
      draft[3],
    ];
    const saved = savePairingDraft(paths, tournament.id, 0, { pairings: edited });
    expect(saved.waves[0].pairingDraft?.[1].pair[1]).toBeNull();
    // 非本阶段选手 / 非法 bucketKey 被丢弃
    const bad = savePairingDraft(paths, tournament.id, 0, {
      pairings: [{ bucketKey: '9-9', pair: ['p0', 'hack/../x'] }],
    });
    expect(bad.waves[0].pairingDraft).toEqual([{ bucketKey: '0-0', pair: ['p0', null] }]);
  });

  it('lockPairings：草稿有效则锁定建场，节点与比赛一一对应', () => {
    const tournament = draftSeries();
    const locked = lockPairings(paths, tournament.id, 0, {});
    const wave = locked.waves[0];
    expect(wave.pairingStatus).toBe('locked');
    expect(wave.pairingDraft).toBeUndefined();
    expect(wave.nodes).toHaveLength(4);
    expect(wave.status).toBe('running');
    expect(getMatchStore(paths).matches).toHaveLength(4);
  });

  it('锁定校验：漏配、重复、自己对自己全部拒绝', () => {
    const tournament = draftSeries();
    const draft = tournament.waves[0].pairingDraft ?? [];
    const missing = draft.map((item, index) => (index === 1 ? { ...item, pair: [item.pair[0], null] } : item));
    savePairingDraft(paths, tournament.id, 0, { pairings: missing });
    expect(() => lockPairings(paths, tournament.id, 0, {})).toThrow(/漏配|未配对/);

    // 重复：两场都出现 p2
    const dup = [
      { bucketKey: '0-0', pair: ['p0', 'p2'] },
      { bucketKey: '0-0', pair: ['p1', 'p2'] },
      { bucketKey: '0-0', pair: ['p3', 'p4'] },
      { bucketKey: '0-0', pair: ['p5', 'p6'] },
    ];
    savePairingDraft(paths, tournament.id, 0, { pairings: dup });
    expect(() => lockPairings(paths, tournament.id, 0, {})).toThrow(/重复/);

    // 自己对自己
    savePairingDraft(paths, tournament.id, 0, {
      pairings: [
        { bucketKey: '0-0', pair: ['p0', 'p0'] },
        { bucketKey: '0-0', pair: ['p1', 'p2'] },
        { bucketKey: '0-0', pair: ['p3', 'p4'] },
        { bucketKey: '0-0', pair: ['p5', 'p6'] },
      ],
    });
    expect(() => lockPairings(paths, tournament.id, 0, {})).toThrow(/自己/);
  });

  it('同桶严格：跨桶配对默认拒绝；allowCrossBucket 放行并打「跨桶」标签', () => {
    // 8 人双败打到 W2：1-0 / 0-1 两桶
    const playerIds = seedPlayers(8);
    const created = createTournament(paths, {
      name: '杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    });
    let tournament = startTournament(paths, created.id);
    // 锁定 W1 并打完 4 场（按种子相邻结果：偶数场左胜 → 确定性桶分布）
    tournament = lockPairings(paths, tournament.id, 0, {});
    tournament.waves[0].nodes.forEach((node) => {
      playMatchToEnd(node.matchId ?? '', 'left');
    });
    tournament = getTournamentStore(paths).find((item) => item.id === tournament.id)!;
    expect(tournament.waves).toHaveLength(2);
    const w2Index = 1;
    const wave2 = tournament.waves[w2Index];
    expect(wave2.pairingStatus).toBe('draft');

    // 找一名 1-0 与一名 0-1 制造跨桶；同对的另一两人组成第二组跨桶，其余同桶
    const winners = wave2.pairingDraft?.filter((item) => item.bucketKey === '1-0') ?? [];
    const losers = wave2.pairingDraft?.filter((item) => item.bucketKey === '0-1') ?? [];
    const crossPairs = [
      { bucketKey: '1-0', pair: [winners[0].pair[0], losers[0].pair[0]] as [string, string] },
      { bucketKey: '1-0', pair: [winners[0].pair[1], losers[0].pair[1]] as [string, string] },
    ];
    const samePairs = [
      { bucketKey: '1-0', pair: [winners[1].pair[0], winners[1].pair[1]] as [string, string] },
      { bucketKey: '0-1', pair: [losers[1].pair[0], losers[1].pair[1]] as [string, string] },
    ];

    savePairingDraft(paths, tournament.id, w2Index, { pairings: [...crossPairs, ...samePairs] });
    expect(() => lockPairings(paths, tournament.id, w2Index, {})).toThrow(/跨桶|战绩/);
    const locked = lockPairings(paths, tournament.id, w2Index, { allowCrossBucket: true });
    const crossNode = locked.waves[w2Index].nodes.find((node) => node.playerAId === crossPairs[0].pair[0] && node.playerBId === crossPairs[0].pair[1]);
    const crossMatch = getMatchStore(paths).matches.find((match) => match.id === crossNode?.matchId);
    expect(crossMatch?.tags).toContain('跨桶');
  });

  it('非 draft 波不能锁定；不存在的波拒绝', () => {
    const tournament = draftSeries();
    lockPairings(paths, tournament.id, 0, {});
    expect(() => lockPairings(paths, tournament.id, 0, {})).toThrow(/draft/);
    expect(() => lockPairings(paths, tournament.id, 9, {})).toThrow(/波次/);
  });
});

describe('onMatchCompleted（比赛完成钩子）', () => {
  it('无 tournamentRef 的普通比赛：钩子无副作用返回 null', () => {
    createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 1 });
    expect(onMatchCompleted(paths, getMatchStore(paths).matches[0].id)).toBeNull();
  });

  it('写入节点胜者与选手战绩（1-0 / 0-1），重复调用幂等', () => {
    const tournament = createSeries(4);
    const started = startTournament(paths, tournament.id);
    const node = started.waves[0].nodes[0];
    playMatchToEnd(node.matchId ?? '', 'left');
    const updated = getTournamentStore(paths)[0];
    const updatedNode = updated.waves[0].nodes.find((item) => item.id === node.id)!;
    expect(updatedNode.winnerId).toBe(node.playerAId);
    expect(updated.entries.find((entry) => entry.playerId === node.playerAId)?.stageWins).toBe(1);
    expect(updated.entries.find((entry) => entry.playerId === node.playerBId)?.stageLosses).toBe(1);

    // 再调一次：战绩不叠加
    onMatchCompleted(paths, node.matchId ?? '');
    const again = getTournamentStore(paths)[0];
    expect(again.entries.find((entry) => entry.playerId === node.playerAId)?.stageWins).toBe(1);
  });

  it('波次凑齐：wave 标 completed 并自动生成 W2（1-0/0-1 两桶），2胜者晋级/2败者淘汰', () => {
    const tournament = createSeries(8);
    const started = startTournament(paths, tournament.id);
    started.waves[0].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));
    const afterW1 = getTournamentStore(paths)[0];
    expect(afterW1.waves[0].status).toBe('completed');
    expect(afterW1.waves[1].pairingStatus).toBe('locked');
    // W2 共 4 场：1-0 两池各 2 场
    const w2 = afterW1.waves[1];
    const byBucket = new Map<string, number>();
    w2.nodes.forEach((node) => {
      const key = bucketOf(afterW1, node);
      byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
    });
    expect(byBucket.get('1-0')).toBe(2);
    expect(byBucket.get('0-1')).toBe(2);

    // 打完 W2：1-0 胜者 2-0 promoted；0-1 负者 0-2 eliminated
    w2.nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));
    const afterW2 = getTournamentStore(paths)[0];
    expect(afterW2.waves[1].status).toBe('completed');
    const promoted = afterW2.entries.filter((entry) => entry.state === 'promoted');
    const eliminated = afterW2.entries.filter((entry) => entry.state === 'eliminated');
    expect(promoted).toHaveLength(2);
    expect(eliminated).toHaveLength(2);
    // 决胜波 W3：1-1 池 2 场（8人时 W3 为 2 场）
    expect(afterW2.waves[2].nodes).toHaveLength(2);
  });

  it('决胜波（W3）交叉配对：每场必为「胜者组掉落者 vs 败者组上扬者」，不出现同侧相遇', () => {
    const load = (id: string): TournamentRecord => getTournamentStore(paths).find((item) => item.id === id)!;
    // 该选手在 W1 是否取胜（W1 胜 = 胜者组掉下来；W1 负 = 败者组打上来）
    const wonOpening = (
      w1Nodes: TournamentRecord['waves'][number]['nodes'],
      playerId: string | null,
    ): boolean => {
      if (!playerId) {
        return false;
      }
      const node = w1Nodes.find((item) => item.playerAId === playerId || item.playerBId === playerId);
      return node?.winnerId === playerId;
    };

    [
      { size: 8, seeds: [1, 2, 3] },
      { size: 16, seeds: [1, 2, 3] },
      { size: 32, seeds: [1, 2] },
    ].forEach(({ size, seeds }) => {
      seeds.forEach((seed) => {
        const tournament = createSeries(size, { seed });
        startTournament(paths, tournament.id);
        // 左侧连胜打完 W1、W2，自动生成 W3
        load(tournament.id).waves[0].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));
        load(tournament.id).waves[1].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));

        const record = load(tournament.id);
        const w1Nodes = record.waves.find((wave) => wave.stageIndex === 0 && wave.waveIndex === 1)!.nodes;
        const w3 = record.waves.find((wave) => wave.stageIndex === 0 && wave.waveIndex === 3)!;

        expect(w3.nodes).toHaveLength(size / 4);
        w3.nodes.forEach((node) => {
          // 两侧必来自不同的来源池：一侧 W1 胜、另一侧 W1 负
          expect(wonOpening(w1Nodes, node.playerAId)).toBe(!wonOpening(w1Nodes, node.playerBId));
        });
      });
    });
  }, 60000);

  it('阶段末：promoted 凑齐半额 → entries 换批清零并生成下一阶段 W1', () => {
    const tournament = createSeries(8);
    const finalRecord = runWholeSeries(tournament.id);
    expect(finalRecord.status).toBe('completed');
    // 当前 entries 为总决赛双方（冠军 promoted / 亚军 eliminated）
    expect(finalRecord.currentStageIndex).toBe(2);
    expect(finalRecord.entries).toHaveLength(2);
    expect(finalRecord.entries.every((entry) => entry.state !== 'alive')).toBe(true);
  });

  it('总决赛完成：result 记录冠军/亚军，冠军唯一', () => {
    const tournament = createSeries(4);
    const finalRecord = runWholeSeries(tournament.id);
    const { championId, runnerUpId } = finalRecord.result!;
    expect(championId).not.toBe(runnerUpId);
    expect(finalRecord.playerIds).toContain(championId);
    expect(finalRecord.playerIds).toContain(runnerUpId);
    expect(finalRecord.entries.find((entry) => entry.playerId === championId)?.state).toBe('promoted');
  });

  it('单败阶段延续固定对阵树：相邻两场胜者相遇（不再每轮重新种子）', () => {
    const tournament = createSeries(16);
    startTournament(paths, tournament.id);
    // 打完 s0（16进8 双败）→ 生成 s1（8进4 单败）
    playStage(tournament.id, 0);
    let record = getTournamentStore(paths)[0];
    expect(record.currentStageIndex).toBe(1);
    expect(record.stages[1].name).toBe('8进4');

    const s1Wave = record.waves.find((wave) => wave.stageIndex === 1 && wave.waveIndex === 1)!;
    expect(s1Wave.nodes.map((node) => node.id)).toEqual([
      's1-w1-n00',
      's1-w1-n01',
      's1-w1-n02',
      's1-w1-n03',
    ]);
    // 全部按左侧胜 ⇒ 胜者即 playerAId
    const winnerOf = new Map(s1Wave.nodes.map((node) => [node.id, node.playerAId]));

    // 打完 s1 全部比赛 → 生成 s2（4进2 单败）
    playStage(tournament.id, 1);
    record = getTournamentStore(paths)[0];
    expect(record.currentStageIndex).toBe(2);

    const s2Wave = record.waves.find((wave) => wave.stageIndex === 2 && wave.waveIndex === 1)!;
    expect(s2Wave.nodes).toHaveLength(2);
    const pairOf = (node: (typeof s2Wave.nodes)[number]): Array<string | null> =>
      [node.playerAId, node.playerBId].sort();
    // s2-w1-n00 = 相邻的 s1-w1-n00 / n01 胜者；s2-w1-n01 = n02 / n03 胜者
    expect(pairOf(s2Wave.nodes[0])).toEqual(
      [winnerOf.get('s1-w1-n00'), winnerOf.get('s1-w1-n01')].sort(),
    );
    expect(pairOf(s2Wave.nodes[1])).toEqual(
      [winnerOf.get('s1-w1-n02'), winnerOf.get('s1-w1-n03')].sort(),
    );
  });
});

/** 按选手当前战绩给节点归类桶 key（用于 W2 断言） */
function bucketOf(tournament: TournamentRecord, node: { playerAId: string | null }): string {
  const entry = tournament.entries.find((item) => item.playerId === node.playerAId);
  return `${entry?.stageWins ?? 0}-${entry?.stageLosses ?? 0}`;
}

describe('onMatchUndo（撤回小局反向钩子）', () => {
  it('清除节点胜者、回退战绩，wave completed → running', () => {
    const tournament = createSeries(8);
    const started = startTournament(paths, tournament.id);
    const firstNode = started.waves[0].nodes[0];
    playMatchToEnd(firstNode.matchId ?? '', 'left');
    // 撤回该场（现有 undo：match 回到进行前；再调反向钩子）
    undoMatchAction(paths, firstNode.matchId ?? '');
    const undone = onMatchUndo(paths, firstNode.matchId ?? '');
    const node = undone!.waves[0].nodes.find((item) => item.id === firstNode.id)!;
    expect(node.winnerId).toBeNull();
    expect(undone!.entries.find((entry) => entry.playerId === firstNode.playerAId)?.stageWins).toBe(0);
  });

  /** BO1 单败两阶段系列赛：打完 s0 两场即自动生成 s1（总决赛） */
  function createUndoSeries(): TournamentRecord {
    return createTournament(paths, {
      name: '撤回级联杯',
      playerIds: seedPlayers(4),
      seed: 42,
      stages: [
        { name: '4进2', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
        { name: '总决赛', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
      ],
    });
  }

  it('该波已推进但后续波一场未打：撤回时一并丢弃后续波，回到结果待定', () => {
    const started = startTournament(paths, createUndoSeries().id);
    started.waves[0].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));

    const record = getTournamentStore(paths)[0];
    expect(record.currentStageIndex).toBe(1);
    // 4 人阶段打完 ⇒ 季军赛（附加波次）排在总决赛首波之前
    expect(record.waves).toHaveLength(3);

    const node = record.waves[0].nodes[0];
    const matchId = node.matchId!;
    const winnerId = node.playerAId!;
    const loserId = node.playerBId!;

    undoMatchAction(paths, matchId);
    const undone = onMatchUndo(paths, matchId)!;
    // 后续波（季军赛 + 总决赛首波）一并丢弃、阶段回落、该节点胜者清空、战绩回到「未打」
    expect(undone.waves).toHaveLength(1);
    expect(undone.currentStageIndex).toBe(0);
    expect(undone.status).toBe('running');
    expect(undone.waves[0].status).toBe('running');
    expect(undone.waves[0].nodes[0].winnerId).toBeNull();
    expect(undone.entries.find((entry) => entry.playerId === winnerId)?.stageWins).toBe(0);
    expect(undone.entries.find((entry) => entry.playerId === loserId)?.stageLosses).toBe(0);

    // 重新登记改成对手获胜：节点能被新结果覆盖（不再被「已有胜者」幂等吞掉），季军赛随之重建
    recordMatchWinner(paths, matchId, 'right');
    onMatchCompleted(paths, matchId);
    const again = getTournamentStore(paths)[0];
    expect(again.waves[0].nodes[0].winnerId).toBe(loserId);
    expect(again.currentStageIndex).toBe(1);
    expect(again.waves).toHaveLength(3);
    expect(again.waves.some((wave) => wave.kind === 'third-place')).toBe(true);
  });

  it('该波已推进且后续波已有赛果：拒绝撤回，提示用回退上一波', () => {
    const started = startTournament(paths, createUndoSeries().id);
    started.waves[0].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));
    // 打完总决赛 → 系列赛完赛：后续波已有赛果，不能再自动丢弃
    const finalWave = getTournamentStore(paths)[0].waves.find((wave) => wave.stageIndex === 1)!;
    playMatchToEnd(finalWave.nodes[0].matchId ?? '', 'left');

    const s0MatchId = started.waves[0].nodes[0].matchId ?? '';
    expect(() => onMatchUndo(paths, s0MatchId)).toThrow(/回退上一波/);
    expect(getTournamentStore(paths)[0].status).toBe('completed');
  });

  it('后续波是人工草稿（draft）不自动丢弃：拒绝撤回', () => {
    const created = createTournament(paths, {
      name: '草稿阶段杯',
      playerIds: seedPlayers(4),
      seed: 42,
      stages: [
        { name: '4进2', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed' },
        { name: '总决赛', format: 'single-elim', bestOf: 1, pairing: 'bracket-seed', requireConfirm: true },
      ],
    });
    const started = startTournament(paths, created.id);
    started.waves[0].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));
    // 季军赛也已建场（附加波次），但「需确认」的是总决赛首波 —— 按阶段取，别按数组下标
    const finalWave = getTournamentStore(paths)[0].waves.find((wave) => wave.stageIndex === 1)!;
    expect(finalWave.pairingStatus).toBe('draft');
    expect(() => onMatchUndo(paths, started.waves[0].nodes[0].matchId ?? '')).toThrow(/回退上一波/);
  });

  it('节点本无胜者（撤回的是非决胜小局）：不产生系列赛变更', () => {
    const started = startTournament(paths, createSeries(4).id);
    const node = started.waves[0].nodes[0];
    expect(onMatchUndo(paths, node.matchId ?? '')).toBeNull();
    expect(
      getTournamentStore(paths)[0].waves[0].nodes.find((item) => item.id === node.id)?.winnerId,
    ).toBeNull();
  });
});

describe('rollbackWave（波次回退）', () => {
  it('locked 且比赛均未进行：删除比赛与波、前一波重开、战绩复位', () => {
    const tournament = createSeries(8);
    let record = startTournament(paths, tournament.id);
    // 打完 W1 → W2 已锁定
    record.waves[0].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));
    record = getTournamentStore(paths)[0];
    expect(record.waves).toHaveLength(2);

    const rolled = rollbackWave(paths, tournament.id);
    expect(rolled.waves).toHaveLength(1);
    expect(rolled.waves[0].status).toBe('running');
    expect(rolled.waves[0].nodes.every((node) => !node.winnerId)).toBe(true);
    expect(rolled.entries.every((entry) => entry.state === 'alive' && entry.stageWins === 0 && entry.stageLosses === 0)).toBe(true);
    expect(getMatchStore(paths).matches).toHaveLength(4);
  });

  it('draft 波直接删除，回到上一波进行中状态', () => {
    const playerIds = seedPlayers(8);
    const created = createTournament(paths, {
      name: '手动杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    });
    let record = startTournament(paths, created.id);
    // 锁定 W1 打完（手动模式 W2 仍是 draft）
    record = lockPairings(paths, record.id, 0, {});
    record.waves[0].nodes.forEach((node) => playMatchToEnd(node.matchId ?? '', 'left'));
    record = getTournamentStore(paths)[0];
    expect(record.waves[1].pairingStatus).toBe('draft');

    const rolled = rollbackWave(paths, record.id);
    expect(rolled.waves).toHaveLength(1);
    expect(rolled.waves[0].status).toBe('running');
    expect(getMatchStore(paths).matches).toHaveLength(4);
  });

  it('波内比赛部分进行（有完成有未打）：拒绝整体回退并提示逐场撤销', () => {
    const tournament = createSeries(8);
    const started = startTournament(paths, tournament.id);
    playMatchToEnd(started.waves[0].nodes[0].matchId ?? '', 'left');
    expect(() => rollbackWave(paths, tournament.id)).toThrow(/进行中|逐场/);
  });

  it('总决赛整波打完（系列赛已完赛）：回退复位决赛而非拒绝——比赛 pending、冠军撤销、波与系列赛重开', () => {
    // 关掉季军赛：本用例只验总决赛波的回退语义（季军赛与回退的交互另有用例覆盖）
    const tournament = createSeries(4, { thirdPlaceBestOf: 0 });
    const finalRecord = runWholeSeries(tournament.id);
    expect(finalRecord.status).toBe('completed');
    expect(finalRecord.result?.championId).toBeTruthy();

    // 第一次回退：总决赛波复位（波保留）
    let rolled = rollbackWave(paths, tournament.id);
    const lastWave = rolled.waves[rolled.waves.length - 1];
    expect(rolled.status).toBe('running');
    expect(rolled.result).toBeUndefined();
    expect(lastWave.status).toBe('running');
    expect(lastWave.pairingStatus).toBe('locked');
    expect(lastWave.nodes.every((node) => !node.winnerId)).toBe(true);
    expect(rolled.currentStageIndex).toBe(1);
    // entries = 决赛双方 alive 0-0
    expect(rolled.entries).toHaveLength(2);
    expect(rolled.entries.every((entry) =>
      entry.state === 'alive' && entry.stageWins === 0 && entry.stageLosses === 0)).toBe(true);
    // 决赛比赛已复位 pending
    const finalMatchIds = new Set(lastWave.nodes.map((node) => node.matchId));
    const finalMatches = getMatchStore(paths).matches.filter((match) => finalMatchIds.has(match.id));
    expect(finalMatches).toHaveLength(1);
    expect(finalMatches[0].status).toBe('pending');

    // 第二次回退：pending 决赛波按原语义删除 → 跨阶段重开 4进2
    rolled = rollbackWave(paths, rolled.id);
    expect(rolled.currentStageIndex).toBe(0);
    expect(rolled.waves).toHaveLength(1);
    expect(rolled.waves[0].status).toBe('running');
  });

  it('跨阶段回退：新阶段 W1 撤销后 currentStageIndex 回落，entries 恢复上一阶段', () => {
    const tournament = createSeries(8);
    let record = startTournament(paths, tournament.id);
    // 打完双败 stage0 全部 10 场（确定性左胜）→ 阶段切换，stage1 W1 已锁定但未打
    while (record.currentStageIndex === 0) {
      const pending = getMatchStore(paths).matches.filter(
        (match) => match.status === 'pending' && match.tournamentRef?.tournamentId === tournament.id,
      );
      pending.forEach((match) => playMatchToEnd(match.id, 'left'));
      record = getTournamentStore(paths).find((item) => item.id === tournament.id)!;
    }
    expect(record.currentStageIndex).toBe(1);
    expect(record.waves).toHaveLength(4);

    // 回退 stage1 未打 W1 → 回到 stage0，W3 重开
    let rolled = rollbackWave(paths, tournament.id);
    expect(rolled.currentStageIndex).toBe(0);
    expect(rolled.waves).toHaveLength(3);
    expect(rolled.waves[2].status).toBe('running');
    expect(rolled.entries.some((entry) => entry.state === 'alive')).toBe(true);
    expect(rolled.result).toBeUndefined();

    // 再回退 W3（已复位未打）→ W2 重开
    rolled = rollbackWave(paths, rolled.id);
    expect(rolled.waves).toHaveLength(2);
    expect(rolled.waves[1].status).toBe('running');
  });

  it('无波可回退时报错', () => {
    const tournament = createSeries(4);
    expect(() => rollbackWave(paths, tournament.id)).toThrow(/波次/);
  });
});

describe('advanceTournament（requireConfirm 手动确认）', () => {
  it('draft 随机波：随机重排并直接锁定建场', () => {
    const playerIds = seedPlayers(8);
    const created = createTournament(paths, {
      name: '确认杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'random-bucket', requireConfirm: true }],
    });
    const draft = startTournament(paths, created.id);
    expect(draft.waves[0].pairingStatus).toBe('draft');
    const advanced = advanceTournament(paths, created.id);
    expect(advanced.waves[0].pairingStatus).toBe('locked');
    expect(getMatchStore(paths).matches).toHaveLength(4);
  });

  it('手动配对 draft / 已锁定波：advance 拒绝', () => {
    const playerIds = seedPlayers(8);
    const created = createTournament(paths, {
      name: '手动杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    });
    const draft = startTournament(paths, created.id);
    expect(() => advanceTournament(paths, created.id)).toThrow(/手动/);

    lockPairings(paths, created.id, 0, {});
    expect(() => advanceTournament(paths, created.id)).toThrow(/draft/);
  });
});

describe('importPairings（外部对阵表导入）', () => {
  it('文本 A vs B 按档案名匹配回填 draft，不支持的行进 unmatched', () => {
    const playerIds = seedPlayers(8);
    const created = createTournament(paths, {
      name: '外部杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    });
    const draft = startTournament(paths, created.id);
    const result = importPairings(paths, created.id, 0, {
      text: '选手0 vs 选手1\n选手2 VS 选手3\n选手4—选手5\n不存在的人 vs 选手6',
    });
    expect(result.unmatched).toHaveLength(2);
    expect(result.tournament.waves[0].pairingDraft).toHaveLength(2);
    expect(result.tournament.waves[0].pairingDraft?.[0].pair).toEqual(['p0', 'p1']);
    expect(draft.id).toBe(created.id);
  });

  it('JSON pairs 名字数组：模糊子串唯一命中即可匹配', () => {
    const playerIds = seedPlayers(8);
    savePlayerProfile(paths, { id: 'p99', name: '阿炽' });
    const created = createTournament(paths, {
      name: '杯',
      playerIds,
      seed: 42,
      stages: [{ name: '8进4', format: 'double-life', bestOf: 1, pairing: 'manual-bucket' }],
    });
    startTournament(paths, created.id);
    // 匹配池仅限本波选手（p0..p7），p99 不在池内
    const result = importPairings(paths, created.id, 0, {
      pairs: [['选手0', '选手1'], ['手2', '选手3'], ['选手4', '选手5'], ['选手6', '选手7']],
    });
    expect(result.unmatched).toEqual([]);
    expect(result.tournament.waves[0].pairingDraft).toHaveLength(4);
  });
});

describe('弃权判负（forfeitMatch + 完成钩子）', () => {
  it('pending 比赛弃权：补决胜小局、加弃权标签、completed 并写回节点', () => {
    const tournament = createSeries(4);
    const started = startTournament(paths, tournament.id);
    const node = started.waves[0].nodes[0];
    forfeitMatch(paths, node.matchId ?? '', 'right');
    onMatchCompleted(paths, node.matchId ?? '');
    const match = getMatchStore(paths).matches.find((item) => item.id === node.matchId);
    expect(match?.status).toBe('completed');
    // 4人默认 stage0 = 单败 BO3：弃权比分 2:0
    expect(match?.leftScore).toBe(2);
    expect(match?.rightScore).toBe(0);
    expect(match?.tags).toContain('弃权');
    const updated = getTournamentStore(paths)[0];
    expect(updated.waves[0].nodes.find((item) => item.id === node.id)?.winnerId).toBe(node.playerAId);
  });
});

describe('deleteTournament（删除系列赛）', () => {
  it('setup 无对局：仅删除编排记录，matchIds 为空', () => {
    const tournament = createSeries(4);
    const result = deleteTournament(paths, tournament.id);
    expect(result.matchIds).toEqual([]);
    expect(result.matchesDeleted).toBe(false);
    expect(getTournamentStore(paths)).toEqual([]);
  });

  it('默认：已建对局全部保留并解除关联（标签保留），系列赛记录删除', () => {
    const tournament = createSeries(4);
    startTournament(paths, tournament.id);
    const related = getMatchStore(paths).matches.filter(
      (match) => match.tournamentRef?.tournamentId === tournament.id,
    );
    expect(related.length).toBeGreaterThan(0);
    const tagsSnapshot = related.map((match) => [...(match.tags ?? [])]);

    const result = deleteTournament(paths, tournament.id);
    expect(getTournamentStore(paths)).toEqual([]);
    expect(result.matchIds).toHaveLength(related.length);
    expect(result.matchesDeleted).toBe(false);

    const store = getMatchStore(paths);
    expect(store.matches).toHaveLength(related.length);
    expect(store.matches.every((match) => match.tournamentRef === undefined)).toBe(true);
    expect(store.matches.map((match) => match.tags)).toEqual(tagsSnapshot);
  });

  it('deleteMatches=true：对局一并删除；撤回恢复后为无关联普通对局', () => {
    const tournament = createSeries(4);
    startTournament(paths, tournament.id);
    const relatedIds = getMatchStore(paths).matches
      .filter((match) => match.tournamentRef?.tournamentId === tournament.id)
      .map((match) => match.id);

    const result = deleteTournament(paths, tournament.id, { deleteMatches: true });
    expect(result.matchesDeleted).toBe(true);
    expect(result.matchIds).toHaveLength(relatedIds.length);
    expect(getMatchStore(paths).matches).toEqual([]);

    undoDeletedMatches(paths);
    const restored = getMatchStore(paths).matches;
    expect(restored).toHaveLength(relatedIds.length);
    expect(restored.every((match) => match.tournamentRef === undefined)).toBe(true);
  });

  it('系列赛不存在：抛错且不动比赛库', () => {
    createSeries(4);
    expect(() => deleteTournament(paths, 'T20260928_A99')).toThrow('系列赛不存在');
    expect(getTournamentStore(paths)).toHaveLength(1);
  });

  it('孤儿引用（系列赛已删除）：完成/撤回钩子返回 null，不阻断比分登记', () => {
    seedPlayers(2);
    const created = createMatch(paths, {
      leftPlayer: '选手0',
      rightPlayer: '选手1',
      bestOf: 1,
      tournamentRef: {
        tournamentId: 'T20260928_A01',
        nodeId: 's0-w1-n00',
        stageIndex: 0,
        waveIndex: 1,
      },
    });
    const matchId = created.activeMatchId!;
    saveGameLineupForMatch(paths, matchId, 1, {
      left: [{ sprite: '3001' }],
      right: [{ sprite: '3002' }],
    });
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, 'left');
    expect(onMatchCompleted(paths, matchId)).toBeNull();
    expect(getMatchStore(paths).matches[0].status).toBe('completed');

    expect(onMatchUndo(paths, matchId)).toBeNull();
  });
});

describe('删除墓碑（写路径与读路径分层）', () => {
  it('删除写墓碑：对外不可见、变更按不存在拒绝、同日再建不复用 id', () => {
    const first = createSeries(4);
    const result = deleteTournament(paths, first.id);
    expect(result.matchesDeleted).toBe(false);

    // 对外读（getTournamentStore）不可见；含墓碑访问器能看到
    expect(getTournamentStore(paths)).toEqual([]);
    const raw = getTournamentRecordsIncludingTombstones(paths);
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe(first.id);
    expect(raw[0].deletedAt).toBeTruthy();

    // 一切变更按"不存在"拒绝（防陈旧比赛把内容写进墓碑）
    expect(() => startTournament(paths, first.id)).toThrow('系列赛不存在');
    expect(() => rollbackWave(paths, first.id)).toThrow('系列赛不存在');
    expect(() => deleteTournament(paths, first.id)).toThrow('系列赛不存在');

    // id 分配看得见墓碑（读路径分层）：同日再建不会复用已删 id
    const second = createSeries(4, { name: '星空杯S1·二届' });
    expect(second.id).not.toBe(first.id);
    expect(getTournamentStore(paths).map((record) => record.id)).toEqual([second.id]);
  });

  it('墓碑 + 陈旧引用：完成/撤回钩子按已删除静默跳过，不写进墓碑', () => {
    const tournament = createSeries(4);
    deleteTournament(paths, tournament.id);

    // 模拟旧包 / 回传把带 tournamentRef 的陈旧比赛带回本机
    const created = createMatch(paths, {
      leftPlayer: '选手0',
      rightPlayer: '选手1',
      bestOf: 1,
      tournamentRef: {
        tournamentId: tournament.id,
        nodeId: 's0-w1-n00',
        stageIndex: 0,
        waveIndex: 1,
      },
    });
    const matchId = created.activeMatchId!;
    saveGameLineupForMatch(paths, matchId, 1, {
      left: [{ sprite: '3001' }],
      right: [{ sprite: '3002' }],
    });
    startCurrentGame(paths, matchId);
    recordMatchWinner(paths, matchId, 'left');

    expect(onMatchCompleted(paths, matchId)).toBeNull();
    expect(onMatchUndo(paths, matchId)).toBeNull();

    // 墓碑未被写入任何内容（waves 保持删除时的原样）
    const raw = getTournamentRecordsIncludingTombstones(paths)[0];
    expect(raw.deletedAt).toBeTruthy();
    expect(raw.waves).toEqual([]);
  });
});

/* ==================== 季军赛（4 人阶段落败者附加赛） ==================== */

describe('季军赛（半决赛落败者附加赛）', () => {
  /** 打到指定阶段结束（该阶段最后一波打完、推进到下一阶段）为止；季军赛不在本阶段主赛内 */
  function playStageToCompletion(tournamentId: string, stageIndex: number): TournamentRecord {
    let guard = 0;
    while (true) {
      const record = getTournamentStore(paths).find((item) => item.id === tournamentId)!;
      if (record.currentStageIndex > stageIndex || record.status === 'completed') {
        return record;
      }
      const stageMatchIds = new Set(
        record.waves
          .filter((wave) => wave.stageIndex === stageIndex && wave.kind !== 'third-place')
          .flatMap((wave) => wave.nodes.map((node) => node.matchId)),
      );
      const pending = getMatchStore(paths).matches.find(
        (match) => match.status === 'pending' && stageMatchIds.has(match.id),
      );
      if (!pending) {
        throw new Error('阶段卡死：无待开始比赛');
      }
      playMatchToEnd(pending.id, 'left');
      guard += 1;
      if (guard > 60) {
        throw new Error('阶段无法收敛');
      }
    }
  }

  function thirdPlaceWaveOf(record: TournamentRecord): TournamentWave {
    const wave = record.waves.find((item) => item.kind === 'third-place');
    if (!wave) {
      throw new Error('没有季军赛波次');
    }
    return wave;
  }

  function startSeries(count: number, patch: Record<string, unknown> = {}): string {
    const created = createSeries(count, patch);
    startTournament(paths, created.id);
    return created.id;
  }

  it('8 人默认模板：4进2 打完自动用两名落败者建场，赛制随总决赛', () => {
    const id = startSeries(8);
    playStageToCompletion(id, 0);
    const record = playStageToCompletion(id, 1);

    // 4进2 是本阶段（单败）唯一一波，季军赛接在它后面
    expect(record.stages[1].name).toBe('4进2');
    const wave = thirdPlaceWaveOf(record);
    expect(wave.stageIndex).toBe(1);
    expect(wave.waveIndex).toBe(2);
    expect(wave.pairingStatus).toBe('locked');
    expect(wave.nodes).toHaveLength(1);

    const node = wave.nodes[0];
    const semifinalLosers = record.waves
      .filter((item) => item.stageIndex === 1 && item.kind !== 'third-place')
      .flatMap((item) => item.nodes)
      .map((item) => (item.winnerId === item.playerAId ? item.playerBId : item.playerAId));
    expect([node.playerAId, node.playerBId].sort()).toEqual(semifinalLosers.sort());
    expect(node.playerAId).not.toBe(node.playerBId);

    // 建的是真对局：待开始、赛制与总决赛（BO3）一致、ref 指向该节点
    const match = getMatchStore(paths).matches.find((item) => item.id === node.matchId)!;
    expect(match.status).toBe('pending');
    expect(match.bestOf).toBe(record.stages[2].bestOf);
    expect(match.tournamentRef).toEqual({
      tournamentId: id,
      nodeId: node.id,
      stageIndex: 1,
      waveIndex: 2,
    });

    // 顺序即时间线：季军赛排在总决赛首波之前（「回退上一波」才不会误伤季军赛）
    const thirdPlaceIndex = record.waves.findIndex((item) => item.kind === 'third-place');
    const finalIndex = record.waves.findIndex((item) => item.stageIndex === 2);
    expect(thirdPlaceIndex).toBeGreaterThan(-1);
    expect(thirdPlaceIndex).toBeLessThan(finalIndex);

    // 晋级链不受影响：entries 仍是总决赛双方，季军赛不写入战绩
    expect(record.entries).toHaveLength(2);
    expect(record.entries.every((entry) => entry.state === 'alive')).toBe(true);
  });

  it('季军赛打完：只记节点胜者，不动 entries / 冠军结果', () => {
    const id = startSeries(4);
    playStageToCompletion(id, 0);
    const withThird = getTournamentStore(paths).find((item) => item.id === id)!;
    const wave = thirdPlaceWaveOf(withThird);
    const node = wave.nodes[0];

    playMatchToEnd(node.matchId!, 'left');
    const afterThird = getTournamentStore(paths).find((item) => item.id === id)!;
    const playedNode = afterThird.waves.find((item) => item.kind === 'third-place')!.nodes[0];
    expect(playedNode.winnerId).toBe(playedNode.playerAId);
    // 4 人阶段早已换批清零：季军赛胜者不能被算成「阶段内多一胜」
    expect(afterThird.entries.find((entry) => entry.playerId === playedNode.winnerId)).toBeUndefined();

    // 打完总决赛：冠军/亚军照常产生，季军赛结果保留
    const pending = getMatchStore(paths).matches.find(
      (match) => match.status === 'pending' && match.tournamentRef?.tournamentId === id,
    )!;
    playMatchToEnd(pending.id, 'left');
    const finished = getTournamentStore(paths).find((item) => item.id === id)!;
    expect(finished.status).toBe('completed');
    expect(finished.result?.championId).toBeTruthy();
    expect(finished.waves.find((item) => item.kind === 'third-place')!.nodes[0].winnerId)
      .toBe(playedNode.winnerId);
  });

  it('季军赛赛制可在创建时指定；传 0 = 不安排', () => {
    const custom = startSeries(4, { thirdPlaceBestOf: 1 });
    playStageToCompletion(custom, 0);
    const withWave = getTournamentStore(paths).find((item) => item.id === custom)!;
    const node = thirdPlaceWaveOf(withWave).nodes[0];
    expect(getMatchStore(paths).matches.find((item) => item.id === node.matchId)!.bestOf).toBe(1);

    const disabled = startSeries(4, { thirdPlaceBestOf: 0 });
    playStageToCompletion(disabled, 0);
    const without = getTournamentStore(paths).find((item) => item.id === disabled)!;
    expect(without.waves.some((wave) => wave.kind === 'third-place')).toBe(false);
  });

  it('双败 4 人阶段（自定义模板）：两名落败者分别来自败者组与决胜轮', () => {
    const stages = [
      { name: '8进4', format: 'double-life', bestOf: 1, pairing: 'random-bucket' },
      { name: '4进2', format: 'double-life', bestOf: 3, pairing: 'random-bucket' },
      { name: '总决赛', format: 'single-elim', bestOf: 3, pairing: 'bracket-seed' },
    ];
    const id = startSeries(8, { stages });
    playStageToCompletion(id, 0);
    const record = playStageToCompletion(id, 1);

    // 双败阶段 3 波（首轮 → 胜/败者组 → 决胜轮），季军赛接在第 4
    expect(record.waves.filter((wave) => wave.stageIndex === 1 && wave.kind !== 'third-place')).toHaveLength(3);
    const wave = thirdPlaceWaveOf(record);
    expect(wave.waveIndex).toBe(4);
    const node = wave.nodes[0];
    // 落败者 = 阶段末 state = eliminated 的两人：决胜轮负者（1-2）与败者组被淘汰者（0-2）
    expect(node.playerAId).not.toBe(node.playerBId);
    expect(record.entries).toHaveLength(2);
  });

  it('赛制读盘口径：显式 0 不会被重新打开，旧数据缺省按总决赛回填', () => {
    const id = startSeries(4, { thirdPlaceBestOf: 0 });
    // 「不安排」写盘后再次读盘仍是 0（否则下次读取会把它悄悄打开）
    expect(getTournamentStore(paths).find((item) => item.id === id)!.thirdPlaceBestOf).toBe(0);

    // 旧数据（库文件里没有这个字段）：按「与总决赛同赛制」回填
    const raw = JSON.parse(readFileSync(paths.tournamentsFile, 'utf-8')) as {
      tournaments: Array<Record<string, unknown>>;
    };
    delete raw.tournaments[0].thirdPlaceBestOf;
    writeFileSync(paths.tournamentsFile, JSON.stringify(raw), 'utf-8');
    const reloaded = getTournamentStore(paths)[0];
    expect(reloaded.thirdPlaceBestOf).toBe(3);
    expect(reloaded.stages[reloaded.stages.length - 1].bestOf).toBe(3);
  });

  it('撤回季军赛赛果：只清该节点，冠军结果与阶段推进不受影响', () => {
    const id = startSeries(4);
    playStageToCompletion(id, 0);
    const thirdNode = thirdPlaceWaveOf(getTournamentStore(paths).find((item) => item.id === id)!).nodes[0];
    playMatchToEnd(thirdNode.matchId!, 'left');
    const finalMatch = getMatchStore(paths).matches.find(
      (match) => match.status === 'pending' && match.tournamentRef?.tournamentId === id,
    )!;
    playMatchToEnd(finalMatch.id, 'left');
    expect(getTournamentStore(paths).find((item) => item.id === id)!.status).toBe('completed');

    undoMatchAction(paths, thirdNode.matchId!);
    const undone = onMatchUndo(paths, thirdNode.matchId!)!;
    expect(undone.status).toBe('completed');
    expect(undone.result?.championId).toBeTruthy();
    expect(undone.waves.find((item) => item.kind === 'third-place')!.nodes[0].winnerId).toBeNull();
    expect(undone.waves.find((item) => item.kind === 'third-place')!.status).toBe('running');
  });

  it('回退总决赛波次时，重开的是半决赛主赛波而不是季军赛', () => {
    const id = startSeries(8);
    playStageToCompletion(id, 0);
    playStageToCompletion(id, 1);
    const before = getTournamentStore(paths).find((item) => item.id === id)!;
    const thirdPlaceMatchId = thirdPlaceWaveOf(before).nodes[0].matchId!;

    const rolled = rollbackWave(paths, id);
    // 总决赛首波被删；半决赛（单败）唯一一波重新变成待定，季军赛原样保留
    expect(rolled.waves.some((wave) => wave.stageIndex === 2)).toBe(false);
    const semifinalWave = rolled.waves.find((wave) => wave.stageIndex === 1 && wave.kind !== 'third-place')!;
    expect(semifinalWave.nodes.every((node) => node.winnerId === null)).toBe(true);
    expect(
      getMatchStore(paths).matches.find((match) => match.id === semifinalWave.nodes[0].matchId)!.status,
    ).toBe('pending');
    const thirdPlaceWave = thirdPlaceWaveOf(rolled);
    expect(thirdPlaceWave.nodes[0].winnerId).toBeNull();
    expect(thirdPlaceWave.nodes[0].matchId).toBe(thirdPlaceMatchId);
  });

  it('季军赛比分登记：写回前置校验放行，标签为「季军赛」', () => {
    const id = startSeries(4);
    playStageToCompletion(id, 0);
    const record = getTournamentStore(paths).find((item) => item.id === id)!;
    const node = thirdPlaceWaveOf(record).nodes[0];
    // 与主赛完全同一条写回路径：能登记、能推进（此处只验节点胜者落地）
    const gate = prepareTournamentWriteBack(paths, node.matchId!);
    expect(gate.allowed).toBe(true);
    playMatchToEnd(node.matchId!, 'right');
    const after = getTournamentStore(paths).find((item) => item.id === id)!;
    expect(after.waves.find((item) => item.kind === 'third-place')!.nodes[0].winnerId).toBe(node.playerBId);
  });

  it('晋级积分榜（page14 口径）不计入季军赛', () => {
    const id = startSeries(4);
    playStageToCompletion(id, 0);
    const before = resolveStageStandings(paths, id, 0)!;
    const node = thirdPlaceWaveOf(getTournamentStore(paths).find((item) => item.id === id)!).nodes[0];
    playMatchToEnd(node.matchId!, 'left');
    const after = resolveStageStandings(paths, id, 0)!;

    // 4 人单败阶段 = 2 场；季军赛不增加总场次，也不给任何人加胜负
    expect(after.totalMatches).toBe(2);
    expect(after.completedMatches).toBe(before.completedMatches);
    expect(after.rows.map((row) => row.wins)).toEqual(before.rows.map((row) => row.wins));
    expect(after.rows.map((row) => row.losses)).toEqual(before.rows.map((row) => row.losses));
  });
});

/* ==================== 随机全赛程模拟（§10 测试策略） ==================== */

/** 随机种子（模拟用） */
function simSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** 独立隔离环境（每届模拟一个，避免 matches 堆积拖慢扫描） */
function freshPaths(): AppPaths {
  const root = mkdtempSync(join(tmpdir(), 'roco-tournament-sim-'));
  const nextPaths = createAppPaths(root, root);
  mkdirSync(nextPaths.dataDir, { recursive: true });
  saveRuntimeConfig(nextPaths, { machineCode: 'A' });
  return nextPaths;
}

function playMatchOn(
  targetPaths: AppPaths,
  matchId: string,
  winnerSide: 'left' | 'right',
): void {
  let match = getMatchStore(targetPaths).matches.find((item) => item.id === matchId);
  let guard = 0;
  while (match && match.status !== 'completed') {
    const game = match.games.find((item) => item.status === 'pending');
    if (!game) {
      throw new Error('没有待开始小局');
    }
    saveGameLineupForMatch(targetPaths, matchId, game.gameNumber, {
      left: [{ sprite: '3001' }],
      right: [{ sprite: '3002' }],
    });
    startCurrentGame(targetPaths, matchId);
    recordMatchWinner(targetPaths, matchId, winnerSide);
    onMatchCompleted(targetPaths, matchId);
    match = getMatchStore(targetPaths).matches.find((item) => item.id === matchId);
    guard += 1;
    if (guard > 10) {
      throw new Error('比赛无法收敛');
    }
  }
}

/** 打完一整届随机胜者系列赛 */
function simulateWhole(size: number): TournamentRecord {
  const targetPaths = freshPaths();
  const playerIds: string[] = [];
  for (let i = 0; i < size; i += 1) {
    savePlayerProfile(targetPaths, { id: `p${i}`, name: `选手${i}` });
    playerIds.push(`p${i}`);
  }
  const created = createTournament(targetPaths, {
    name: '模拟杯',
    playerIds,
    seed: simSeed(),
  });
  startTournament(targetPaths, created.id);

  let guard = 0;
  while (true) {
    const tournament = getTournamentStore(targetPaths).find((item) => item.id === created.id)!;
    if (tournament.status === 'completed') {
      return tournament;
    }
    const pending = getMatchStore(targetPaths).matches.filter(
      (match) => match.status === 'pending' && match.tournamentRef?.tournamentId === created.id,
    );
    if (!pending.length) {
      throw new Error('模拟卡死：无待开始比赛');
    }
    playMatchOn(targetPaths, pending[0].id, Math.random() < 0.5 ? 'left' : 'right');
    guard += 1;
    if (guard > 200) {
      throw new Error('模拟无法收敛');
    }
  }
}

/** 结构断言：冠军唯一、各阶段晋级精确半额、双败每人 ≤3 场、单败每人 1 场、终局无 alive */
function expectSoundTournament(record: TournamentRecord): void {
  expect(record.status).toBe('completed');
  const { championId, runnerUpId } = record.result!;
  expect(championId).not.toBe(runnerUpId);
  expect(record.playerIds).toContain(championId);
  expect(record.playerIds).toContain(runnerUpId);
  expect(record.entries.every((entry) => entry.state !== 'alive')).toBe(true);

  // 季军赛不属于任何阶段的晋级口径：单独校验，不参与下面的阶段聚合
  const thirdPlaceWaves = record.waves.filter((wave) => wave.kind === 'third-place');
  expect(thirdPlaceWaves.length).toBeLessThanOrEqual(1);
  if (thirdPlaceWaves.length) {
    const [node] = thirdPlaceWaves[0].nodes;
    expect(thirdPlaceWaves[0].nodes).toHaveLength(1);
    expect(node.playerAId).toBeTruthy();
    expect(node.playerBId).toBeTruthy();
    expect(node.playerAId).not.toBe(node.playerBId);
    // 参赛者是被淘汰的半决赛落败者，不可能是冠亚军
    expect([node.playerAId, node.playerBId]).not.toContain(championId);
    expect([node.playerAId, node.playerBId]).not.toContain(runnerUpId);
  }

  record.stages.forEach((stage, stageIndex) => {
    const stageWaves = record.waves.filter(
      (wave) => wave.stageIndex === stageIndex && wave.kind !== 'third-place',
    );
    const players = new Set<string>();
    if (stageIndex === 0) {
      record.playerIds.forEach((id) => players.add(id));
    } else {
      stageWaves[0]?.nodes.forEach((node) => {
        if (node.playerAId) {
          players.add(node.playerAId);
        }
        if (node.playerBId) {
          players.add(node.playerBId);
        }
      });
    }

    const appearances = new Map<string, number>();
    const wins = new Map<string, number>();
    stageWaves.forEach((wave) => wave.nodes.forEach((node) => {
      [node.playerAId, node.playerBId].forEach((id) => {
        if (id) {
          appearances.set(id, (appearances.get(id) ?? 0) + 1);
        }
      });
      if (node.winnerId) {
        wins.set(node.winnerId, (wins.get(node.winnerId) ?? 0) + 1);
      }
    }));

    expect(appearances.size).toBe(players.size);
    if (stage.format === 'double-life') {
      appearances.forEach((count) => {
        expect(count).toBeLessThanOrEqual(3);
      });
      const promotedCount = Array.from(wins.values()).filter((count) => count >= 2).length;
      expect(promotedCount).toBe(players.size / 2);
    } else {
      appearances.forEach((count) => {
        expect(count).toBe(1);
      });
      expect(wins.size).toBe(players.size / 2);
    }
  });
}

describe('随机全赛程模拟（多届属性检查）', () => {
  // 文档建议每规模 1000 次；文件型引擎每届含大量真实文件 IO，
  // V1 按下列轮次取得规模性覆盖（合计 53 届），超时按规模放宽
  const table: Array<{ size: number; rounds: number; timeout: number }> = [
    { size: 4, rounds: 30, timeout: 15000 },
    { size: 8, rounds: 15, timeout: 30000 },
    { size: 16, rounds: 5, timeout: 20000 },
    { size: 32, rounds: 2, timeout: 20000 },
    // 64 人：双败桶与人数无关，扩人数后跑一届整程验证（64进32 → … → 总决赛，共 6 个阶段）
    { size: 64, rounds: 1, timeout: 60000 },
  ];

  table.forEach(({ size, rounds, timeout }) => {
    it(
      `${size} 人随机模拟 ${rounds} 届：晋级精确、冠军唯一、双败每人 ≤3 场`,
      () => {
        for (let round = 0; round < rounds; round += 1) {
          expectSoundTournament(simulateWhole(size));
        }
      },
      timeout,
    );
  });
});

describe('本机移除 / 恢复（localOnly 墓碑，仅本机视图层）', () => {
  it('分控端移除 A 编排的系列赛：立即隐藏、对局引用保留、updatedAt 不变、真实墓碑访问器不含它', () => {
    const record = createSeries(8);
    // 本机（A）编排：拒绝本机移除，提示走「删除系列赛」（真删除，跨机传播）
    expect(() => removeLocalTournament(paths, record.id)).toThrow(/本机编排/);

    // 开赛后切成「非本机编排」视角（机器码改为 B，模拟分控端）
    startTournament(paths, record.id);
    const before = getTournamentStore(paths).find((item) => item.id === record.id);
    expect(before).toBeTruthy();
    saveRuntimeConfig(paths, { machineCode: 'B' });
    const matchesBefore = getMatchStore(paths).matches;
    expect(matchesBefore.length).toBeGreaterThan(0);

    const result = removeLocalTournament(paths, record.id);
    expect(result.changed).toBe(true);

    // 对外不可见；本机移除清单可见；真实墓碑访问器不含它（收口解绑不会误伤）
    expect(getTournamentStore(paths).find((item) => item.id === record.id)).toBeUndefined();
    const removed = getLocallyRemovedTournaments(paths);
    expect(removed.map((item) => item.id)).toEqual([record.id]);
    expect(removed[0].localOnly).toBe(true);
    expect(removed[0].deletedAt).toBeTruthy();
    expect(removed[0].deletedMatchIds).toEqual([]);
    expect(removed[0].deletedMatches).toBe(false);
    expect(removed[0].updatedAt).toBe(before!.updatedAt);
    expect(getTournamentTombstones(paths)).toEqual([]);

    // 对局引用保留不动（与真删除不同：不解绑、不删对局）
    const matchesAfter = getMatchStore(paths).matches;
    expect(matchesAfter).toHaveLength(matchesBefore.length);
    expect(matchesAfter.every((match) => match.tournamentRef?.tournamentId === record.id)).toBe(true);

    // 幂等：重复移除不重复写、不报错
    expect(removeLocalTournament(paths, record.id).changed).toBe(false);
    expect(getLocallyRemovedTournaments(paths)).toHaveLength(1);
  });

  it('恢复：清除标记立即重新可见，updatedAt 保持原值（下次同步按「较新覆盖」接受编排机更新）', () => {
    const record = createSeries(8);
    saveRuntimeConfig(paths, { machineCode: 'B' });
    const before = getTournamentStore(paths).find((item) => item.id === record.id);
    expect(before).toBeTruthy();

    removeLocalTournament(paths, record.id);
    const restored = restoreLocalTournament(paths, record.id);
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.localOnly).toBeUndefined();
    expect(restored.updatedAt).toBe(before!.updatedAt);
    expect(getLocallyRemovedTournaments(paths)).toEqual([]);
    expect(getTournamentStore(paths).find((item) => item.id === record.id)?.id).toBe(record.id);
  });

  it('真实墓碑与本机移除正交：真删后不可移除 / 不可恢复；存活记录不可恢复', () => {
    const deleted = createSeries(8, { name: '真删杯' });
    deleteTournament(paths, deleted.id);
    expect(() => removeLocalTournament(paths, deleted.id)).toThrow('系列赛不存在');
    expect(() => restoreLocalTournament(paths, deleted.id)).toThrow('该系列赛不是本机移除的记录');

    const alive = createSeries(8, { name: '存活杯' });
    expect(() => restoreLocalTournament(paths, alive.id)).toThrow('该系列赛不是本机移除的记录');
    expect(() => restoreLocalTournament(paths, 'T19700101_A99')).toThrow('系列赛不存在');
  });
});

describe('系列赛数据文件损坏保护', () => {
  it('解析失败：备份 .corrupt 并抛错；写路径一律中止，不覆盖损坏文件', () => {
    createSeries(4);
    writeFileSync(paths.tournamentsFile, '{ 损坏的 JSON', 'utf-8');

    expect(() => getTournamentStore(paths)).toThrow(/系列赛数据文件损坏/);
    expect(existsSync(`${paths.tournamentsFile}.corrupt`)).toBe(true);
    // 备份保留现场（内容与损坏文件一致）
    expect(readFileSync(`${paths.tournamentsFile}.corrupt`, 'utf-8')).toBe('{ 损坏的 JSON');

    // 写路径同样中止（旧版会把库覆盖成「只剩新系列赛」），原始损坏文件保持原样等人工修复
    expect(() => createSeries(4, { name: '新杯' })).toThrow(/系列赛数据文件损坏/);
    expect(readFileSync(paths.tournamentsFile, 'utf-8')).toBe('{ 损坏的 JSON');
  });

  it('结构不对（tournaments 不是数组）同样按损坏处理', () => {
    createSeries(4);
    writeFileSync(paths.tournamentsFile, JSON.stringify({ tournaments: { bad: true } }), 'utf-8');
    expect(() => getTournamentStore(paths)).toThrow(/系列赛数据文件损坏/);
    expect(existsSync(`${paths.tournamentsFile}.corrupt`)).toBe(true);
  });
});
