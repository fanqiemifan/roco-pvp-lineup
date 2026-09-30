/**
 * 云同步 + 系列赛回归测试（对应两个曾报「像 bug」的现象，实际是展示/筛选层）：
 *  1. 分控端拉取后，晋级图/波次卡片要能解析出选手名字（依赖选手档案一起同步）
 *     → 断言 GET /api/profiles 有全部选手、系列赛 playerIds 能全部解析
 *  2. 主控写回推进生成下一波后，分控端「比赛管理」要能看到新比赛
 *     → 断言 GET /api/matches 含新比赛，且按前端的过滤/排序逻辑它排在可见位置
 * 另外覆盖：筛选到「只看普通对局」时系列赛对局会被隐藏（所以界面必须显示筛选提示）
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { saveCloudSyncConfig } from '../../electron/services/cloud-sync-service';
import { saveRuntimeConfig } from '../../electron/services/config-service';
import { getMatchStore, recordMatchWinner, saveGameLineupForMatch, startCurrentGame } from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { getProfileStore, savePlayerProfile } from '../../electron/services/profile-service';
import { createTournament, getTournamentStore, onMatchCompleted, startTournament } from '../../electron/services/tournament-service';
import { exportSyncBundle } from '../../electron/services/sync-service';
import { buildPlayerNameMap } from '../../src/admin-antd/lib/tournament';
import type { MatchRecord } from '../../shared/types';

let root: string;
let mainPaths: AppPaths;
let subPaths: AppPaths;
let subServer: LocalServer;
let subBase: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'diag-pull-http-'));
  mainPaths = createAppPaths(join(root, 'main'), join(root, 'main'));
  subPaths = createAppPaths(join(root, 'sub'), join(root, 'sub'));
  mkdirSync(mainPaths.dataDir, { recursive: true });
  mkdirSync(subPaths.dataDir, { recursive: true });
  saveRuntimeConfig(mainPaths, { machineCode: 'AA' });
  saveRuntimeConfig(subPaths, { machineCode: 'B' });
  saveCloudSyncConfig(subPaths, { syncKey: 'k', syncToken: 't', workerUrl: 'http://127.0.0.1:1', role: 'sub' });

  subServer = await createLocalServer(subPaths, 0, '127.0.0.1');
  subBase = `http://127.0.0.1:${(subServer.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await subServer.close();
  rmSync(root, { recursive: true, force: true });
});

/** 主控：建 4 人系列赛 → 打完首波 → 推进出总决赛那一场 */
function buildAdvancedTournamentBundle() {
  const playerIds = Array.from({ length: 4 }, (_u, i) => {
    const id = `p${i}`;
    savePlayerProfile(mainPaths, { id, name: `选手${i}` });
    return id;
  });
  const created = createTournament(mainPaths, { name: '诊断杯', playerIds, seed: 7 });
  startTournament(mainPaths, created.id);

  const firstWave = getMatchStore(mainPaths).matches.map((match) => match.id);
  firstWave.forEach((matchId) => {
    for (let guard = 0; guard < 10; guard += 1) {
      const current = getMatchStore(mainPaths).matches.find((match) => match.id === matchId);
      if (!current || current.status === 'completed') {
        break;
      }
      const game = current.games.find((item) => item.status === 'pending') ?? current.games[0];
      saveGameLineupForMatch(mainPaths, matchId, game.gameNumber, {
        left: [{ sprite: '3001' }],
        right: [{ sprite: '3002' }],
      });
      startCurrentGame(mainPaths, matchId);
      recordMatchWinner(mainPaths, matchId, 'left');
    }
    onMatchCompleted(mainPaths, matchId);
  });

  return exportSyncBundle(mainPaths, { includeProfiles: true, includeAvatars: false });
}

describe('诊断：分控端拉取推进后的数据', () => {
  it('合并后 /api/matches 含新比赛，/api/profiles 有选手名', async () => {
    const bundle = buildAdvancedTournamentBundle();
    const createdTournamentId = getTournamentStore(mainPaths)[0].id;
    const newMatchId = getTournamentStore(mainPaths)[0].waves[1]?.nodes[0]?.matchId;
    expect(newMatchId).toBeTruthy();

    // 模拟「从云端获取最新」：预览 → 确认合并
    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(bundle)], { type: 'application/json' }), 'bundle.json');
    form.append('mode', 'newer');
    const previewRes = await fetch(`${subBase}/api/sync/preview`, { method: 'POST', body: form });
    const preview = (await previewRes.json() as any).preview;
    const accepted = [...preview.matchItems, ...preview.playerItems, ...preview.teamItems]
      .filter((item: { action: string }) => item.action !== 'skip')
      .map((item: { key: string }) => item.key);

    const applyForm = new FormData();
    applyForm.append('file', new Blob([JSON.stringify(bundle)], { type: 'application/json' }), 'bundle.json');
    applyForm.append('mode', 'newer');
    applyForm.append('accepted', JSON.stringify(accepted));
    applyForm.append('includeAvatars', 'false');
    const applyRes = await fetch(`${subBase}/api/sync/import`, { method: 'POST', body: applyForm });
    expect(applyRes.status).toBe(200);

    // ① 分控端「比赛管理」读的接口：新推进出来的比赛必须已经在里面
    const store = await (await fetch(`${subBase}/api/matches`)).json() as { matches: MatchRecord[] };
    expect(store.matches.some((match) => match.id === newMatchId)).toBe(true);
    const tournamentMatches = store.matches.filter((match) => match.tournamentRef?.tournamentId === createdTournamentId);
    expect(tournamentMatches.some((match) => match.id === newMatchId)).toBe(true);
    // 新比赛是「待开始」，比赛管理按更新时间倒序应把它排在最前
    expect(store.matches.find((match) => match.id === newMatchId)?.status).toBe('pending');

    // ② 晋级图/波次卡片依赖的接口：选手档案要一起过来，否则只能显示 id
    const profiles = await (await fetch(`${subBase}/api/profiles`)).json() as { players: Array<{ id: string; name: string }> };
    const tournaments = await (await fetch(`${subBase}/api/tournaments`)).json() as { tournaments: Array<{ id: string; playerIds: string[] }> };
    const nameMap = new Map(profiles.players.map((player) => [player.id, player.name]));
    const unresolved = tournaments.tournaments.flatMap((record) => record.playerIds).filter((id) => !nameMap.has(id));
    expect(unresolved).toEqual([]);
    expect(profiles.players.length).toBeGreaterThanOrEqual(4);

    // ③ 复刻前端「比赛管理」的过滤 + 排序：无筛选时新比赛排第 1（默认按更新时间倒序）
    const { getEffectiveTournamentId } = await import('../../src/admin-antd/lib/history');
    const tournamentIdSet = new Set(tournaments.tournaments.map((record) => record.id));
    const byUpdatedDesc = [...store.matches].sort(
      (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0),
    );
    expect(byUpdatedDesc[0]?.id).toBe(newMatchId);
    // 筛选「只看普通对局」时系列赛对局会被隐藏 —— 正是这条规则让用户误以为「新比赛没同步过来」，
    // 所以比赛管理必须把筛选状态显式提示出来（前端 historyFilterHint）。
    const plainOnly = store.matches.filter((match) => !getEffectiveTournamentId(match, tournamentIdSet));
    expect(plainOnly.some((match) => match.id === newMatchId)).toBe(false);
  });

  it('分控端已有同名但不同 id 的档案时，导入后仍能用别名显示选手名字', async () => {
    // 这条用例要「分控端档案干净」的起点（前面的用例可能已经导入过档案）
    rmSync(subPaths.profilesFile, { force: true });
    const bundle = buildAdvancedTournamentBundle();
    const record = getTournamentStore(mainPaths)[0];
    const mainPlayerIds = record.playerIds;
    const names = new Map(getProfileStore(mainPaths).players.map((player) => [player.id, player.name]));

    // 分控端提前手工建了同名档案（id 是本机自己生成的）—— 这正是「显示出一串 id」的现场
    const localIds: string[] = [];
    mainPlayerIds.forEach((mainId) => {
      const name = names.get(mainId) ?? mainId;
      savePlayerProfile(subPaths, { id: `local_${mainId}`, name, rank: '9' });
      localIds.push(`local_${mainId}`);
    });
    const beforeNames = buildPlayerNameMap(getProfileStore(subPaths));
    expect(beforeNames.get(mainPlayerIds[0])).toBeUndefined();

    // 走一遍真实导入
    const previewRes = await fetch(`${subBase}/api/sync/preview`, {
      method: 'POST',
      body: (() => {
        const form = new FormData();
        form.append('file', new Blob([JSON.stringify(bundle)], { type: 'application/json' }), 'bundle.json');
        form.append('mode', 'newer');
        return form;
      })(),
    });
    const preview = (await previewRes.json() as any).preview;
    // 同名不同 id → 现在是「可勾选的更新」，说明里点明会保留本机 id 并登记别名
    const aliasedPlayer = preview.playerItems.find((item: { reason: string }) => item.reason.includes('保留本机 id'));
    expect(aliasedPlayer).toBeTruthy();

    const accepted = [...preview.matchItems, ...preview.playerItems, ...preview.teamItems]
      .filter((item: { action: string }) => item.action !== 'skip')
      .map((item: { key: string }) => item.key);
    const applyForm = new FormData();
    applyForm.append('file', new Blob([JSON.stringify(bundle)], { type: 'application/json' }), 'bundle.json');
    applyForm.append('mode', 'newer');
    applyForm.append('accepted', JSON.stringify(accepted));
    applyForm.append('includeAvatars', 'false');
    const applyRes = await fetch(`${subBase}/api/sync/import`, { method: 'POST', body: applyForm });
    expect(applyRes.status).toBe(200);

    // /api/profiles 带别名 → 晋级图/波次卡片能显示名字而不是一串 id
    const profiles = await (await fetch(`${subBase}/api/profiles`)).json() as {
      players: Array<{ id: string; name: string }>;
      playerAliases?: Record<string, string>;
    };
    const afterNames = buildPlayerNameMap(profiles as never);
    mainPlayerIds.forEach((mainId) => {
      expect(afterNames.get(mainId)).toBe(names.get(mainId));
    });
    // 本机 id 保持不变（比赛 / 头像目录都引用它），只新增别名
    expect(profiles.players.map((player) => player.id).sort()).toEqual([...localIds].sort());
  });
});
