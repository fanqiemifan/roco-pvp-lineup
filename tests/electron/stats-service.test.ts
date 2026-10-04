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
import { getSpriteRanking } from '../../electron/services/stats-service';
import { createTournament, startTournament } from '../../electron/services/tournament-service';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-stats-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  saveRuntimeConfig(paths, { machineCode: 'A' });
});

/** 建档 4 名选手并开一场同名系列赛（默认模板自动建场，返回其中一个对局 id） */
function startSameNameSeries(name: string, playerOffset: number): { id: string; matchId: string } {
  const playerIds = Array.from({ length: 4 }, (_unused, index) => {
    const id = `p${playerOffset + index}`;
    savePlayerProfile(paths, { id, name: `选手${playerOffset + index}` });
    return id;
  });
  const record = createTournament(paths, { name, playerIds, seed: 42 });
  startTournament(paths, record.id);
  const match = getMatchStore(paths).matches.find(
    (item) => item.tournamentRef?.tournamentId === record.id,
  );
  if (!match) {
    throw new Error('系列赛未自动建场');
  }
  return { id: record.id, matchId: match.id };
}

/** 打完一小局（写阵容并登记左侧获胜），用于制造排行榜数据 */
function playFirstGame(matchId: string, left: string[], right: string[]): void {
  saveGameLineupForMatch(paths, matchId, 1, {
    left: left.map((sprite) => ({ sprite })),
    right: right.map((sprite) => ({ sprite })),
  });
  startCurrentGame(paths, matchId);
  recordMatchWinner(paths, matchId, 'left');
}

describe('getSpriteRanking（系列赛维度）', () => {
  it('按 tournamentId 精确过滤：同名系列赛不合并统计，并回传系列赛名', () => {
    const first = startSameNameSeries('夏季杯S1', 0);
    const second = startSameNameSeries('夏季杯S1', 10);
    playFirstGame(first.matchId, ['pet-a', 'pet-b'], ['pet-c']);
    playFirstGame(second.matchId, ['pet-d'], ['pet-e']);

    const all = getSpriteRanking(paths, { player: null, tag: null, tournamentId: null });
    expect(all.tournamentId).toBeNull();
    expect(all.tournamentName).toBe('');
    expect(new Set(all.rows.map((row) => row.key))).toEqual(
      new Set(['pet-a', 'pet-b', 'pet-c', 'pet-d', 'pet-e']),
    );

    // 两场系列赛同名：按 id 过滤只应拿到 first 的阵容（不按名字合并）
    const scoped = getSpriteRanking(paths, { player: null, tag: null, tournamentId: first.id });
    expect(scoped.tournamentId).toBe(first.id);
    expect(scoped.tournamentName).toBe('夏季杯S1');
    expect(new Set(scoped.rows.map((row) => row.key))).toEqual(new Set(['pet-a', 'pet-b', 'pet-c']));
    expect(scoped.totalPicks).toBe(3);
  });

  it('未知/已删除系列赛 id：返回空榜单与空名字，不报错', () => {
    const first = startSameNameSeries('夏季杯S1', 0);
    playFirstGame(first.matchId, ['pet-a'], ['pet-b']);

    const scoped = getSpriteRanking(paths, { player: null, tag: null, tournamentId: 'T19990101_A99' });
    expect(scoped.rows).toEqual([]);
    expect(scoped.totalPicks).toBe(0);
    expect(scoped.tournamentName).toBe('');
  });
});