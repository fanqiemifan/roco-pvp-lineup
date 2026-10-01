import type {
  LineupImportApplyResult,
  LineupImportPreviewRow,
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

/** 只读预览首波对阵（按当前 seed 生成，不建场）：setup 抽签面板用 */
export async function previewOpeningWaveApi(
  tournamentId: string,
): Promise<TournamentWave['pairingDraft']> {
  const data = await requestJson<{ pairs: TournamentWave['pairingDraft'] }>(
    `/api/tournaments/${tournamentId}/opening-wave`,
  );
  return data.pairs;
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

/** 卡片「进入管理」：切换为当前比赛（赛事面板跳转复用现有路由） */
export async function selectMatchApi(matchId: string): Promise<void> {
  await requestJson<{ success: boolean }>(`/api/matches/${matchId}/select`, { method: 'POST' });
}

/* ==================== 阵容表批量导入（导出模板的线下回填） ==================== */

export interface LineupImportRowPayload {
  matchId: string;
  /** 名字原文数组（预览）/ 已确认的 pet_id 数组（写入）；null = 该侧不写 */
  left?: string[] | null;
  right?: string[] | null;
}

/** 预览（dryRun）：按「对局ID + 位置」规范化后的行提交，服务端解析名字 + 场次预检，不写任何数据 */
export async function previewLineupImportApi(
  tournamentId: string,
  rows: LineupImportRowPayload[],
): Promise<LineupImportPreviewRow[]> {
  const data = await requestJson<{ rows: LineupImportPreviewRow[] }>(
    `/api/tournaments/${tournamentId}/lineup-import`,
    { method: 'POST', json: { dryRun: true, rows } },
  );
  return data.rows;
}

/** 批量写入：left/right 为预览中确认过的 pet_id 数组（null = 该侧保持原样），服务端对局级原子写入 */
export async function applyLineupImportApi(
  tournamentId: string,
  rows: LineupImportRowPayload[],
): Promise<LineupImportApplyResult[]> {
  const data = await requestJson<{ results: LineupImportApplyResult[] }>(
    `/api/tournaments/${tournamentId}/lineup-import`,
    { method: 'POST', json: { rows } },
  );
  return data.results;
}
