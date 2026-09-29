import type {
  StageRule,
  TournamentRecord,
  TournamentWave,
} from '../../../shared/types';
import { requestJson } from './request';

/* ==================== 系列赛 API 层：全部写/读操作经这里 ==================== */

export async function listTournamentsApi(): Promise<TournamentRecord[]> {
  const data = await requestJson<{ tournaments: TournamentRecord[] }>('/api/tournaments');
  return data.tournaments;
}

export async function createTournamentApi(body: {
  name: string;
  playerIds: string[];
  stages?: StageRule[];
  seed?: number;
}): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>('/api/tournaments', {
    method: 'POST',
    json: body,
  });
  return data.tournament;
}

/** （重）抽签：seed 省略时服务端随机生成 */
export async function drawTournamentApi(
  tournamentId: string,
  seed?: number,
): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>(
    `/api/tournaments/${tournamentId}/draw`,
    { method: 'POST', json: seed === undefined ? {} : { seed } },
  );
  return data.tournament;
}

export async function startTournamentApi(tournamentId: string): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>(
    `/api/tournaments/${tournamentId}/start`,
    { method: 'POST' },
  );
  return data.tournament;
}

export async function savePairingDraftApi(
  tournamentId: string,
  waveGlobalIndex: number,
  pairings: TournamentWave['pairingDraft'],
): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>(
    `/api/tournaments/${tournamentId}/waves/${waveGlobalIndex}/pairings`,
    { method: 'PUT', json: { pairings } },
  );
  return data.tournament;
}

export async function lockPairingsApi(
  tournamentId: string,
  waveGlobalIndex: number,
  allowCrossBucket: boolean,
): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>(
    `/api/tournaments/${tournamentId}/waves/${waveGlobalIndex}/pairings/lock`,
    { method: 'POST', json: { allowCrossBucket } },
  );
  return data.tournament;
}

export async function importPairingsApi(
  tournamentId: string,
  waveGlobalIndex: number,
  body: { text?: string; pairs?: string[][] },
): Promise<{ tournament: TournamentRecord; unmatched: Array<{ line: number; text: string }> }> {
  return requestJson(
    `/api/tournaments/${tournamentId}/waves/${waveGlobalIndex}/pairings/import`,
    { method: 'POST', json: body },
  );
}

export async function rollbackWaveApi(tournamentId: string): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>(
    `/api/tournaments/${tournamentId}/rollback-wave`,
    { method: 'POST' },
  );
  return data.tournament;
}

export async function forfeitApi(
  tournamentId: string,
  matchId: string,
  loserSide: 'left' | 'right',
): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>(
    `/api/tournaments/${tournamentId}/forfeit`,
    { method: 'POST', json: { matchId, loserSide } },
  );
  return data.tournament;
}

/**
 * 删除系列赛：默认仅解除对局关联（对局保留为普通比赛）；
 * deleteRelatedMatches=true 时连同关联对局一并删除（比赛管理可「撤回最近删除」）。
 */
export async function deleteTournamentApi(
  tournamentId: string,
  deleteRelatedMatches: boolean,
): Promise<{ matchIds: string[]; matchesDeleted: boolean }> {
  return requestJson(`/api/tournaments/${tournamentId}`, {
    method: 'DELETE',
    json: { deleteMatches: deleteRelatedMatches },
  });
}

/** 切换为当前比赛（赛事面板跳转复用现有路由） */
export async function selectMatchApi(matchId: string): Promise<void> {
  await requestJson<{ success: boolean }>(`/api/matches/${matchId}/select`, { method: 'POST' });
}
