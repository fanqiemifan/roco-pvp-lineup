import type {
  LineupImportApplyResult,
  LineupImportPreviewRow,
  RollbackWavePreview,
  StageFormat,
  StageRule,
  SyncBundle,
  TournamentRecord,
  TournamentWave,
} from '../../../shared/types';
import { requestJson, uploadSingleFile } from './request';

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
  /** 季军赛局数（0 = 不安排）；省略时由服务端按「与总决赛同赛制」解析 */
  thirdPlaceBestOf?: number;
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

/** 回退上一波影响预览（只读）：逐场处置 + 连带影响，判定与执行同源，以执行一刻为准 */
export async function previewRollbackWaveApi(tournamentId: string): Promise<RollbackWavePreview> {
  const data = await requestJson<{ preview: RollbackWavePreview }>(
    `/api/tournaments/${tournamentId}/rollback-preview`,
  );
  return data.preview;
}

/**
 * 编辑赛制：只提交发生变化的阶段 / 波次。stages[].bestOf = 基础赛制（W1 与未覆盖波次）；
 * stages[].waveBestOf = 双败按波次覆盖（null = 恢复跟随基础）。阶段内已有赛况的 BO 改动须先由界面强确认、
 * 再带 confirmReopen=true 重试，服务端复核通过后执行「重开该波」（清赛况、保留阵容、后续波作废）。
 * stages[].format / pairing / avoidRematch / requireConfirm = 阶段规则：仅未开始阶段可改、直接生效
 * （服务端守卫，形态切换时配对按兼容归一，总决赛禁止双败）。
 */
export async function updateTournamentStagesApi(
  tournamentId: string,
  body: {
    stages: Array<{
      index: number;
      bestOf?: number;
      waveBestOf?: Partial<Record<2 | 3, number | null>>;
      format?: StageFormat;
      pairing?: StageRule['pairing'];
      avoidRematch?: boolean;
      requireConfirm?: boolean;
    }>;
    thirdPlaceBestOf?: number;
    confirmReopen?: boolean;
  },
): Promise<{
  tournament: TournamentRecord;
  reopenedMatchIds: string[];
  updatedMatchIds: string[];
  discardedWaveCount: number;
}> {
  return requestJson(`/api/tournaments/${tournamentId}/stages`, { method: 'PUT', json: body });
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

/** 本机已「本机移除」的系列赛（localOnly，仅本机存在）：恢复弹窗数据源 */
export async function listLocallyRemovedApi(): Promise<TournamentRecord[]> {
  const data = await requestJson<{ tournaments: TournamentRecord[] }>('/api/tournaments/local-removed');
  return data.tournaments;
}

/**
 * 本机移除：仅在本机隐藏该系列赛（不物理删除、不随同步传播、对局引用不动），幂等。
 * 只允许对「非本机编排」的系列赛操作；恢复用 localRestoreTournamentApi。
 */
export async function localRemoveTournamentApi(
  tournamentId: string,
): Promise<{ tournamentId: string; changed: boolean }> {
  return requestJson(`/api/tournaments/${tournamentId}/local-remove`, { method: 'POST' });
}

/** 恢复本机移除：记录立即重新可见，下一次同步自动补齐编排机的最新编排与赛果 */
export async function localRestoreTournamentApi(tournamentId: string): Promise<TournamentRecord> {
  const data = await requestJson<{ tournament: TournamentRecord }>(
    `/api/tournaments/${tournamentId}/local-restore`,
    { method: 'POST' },
  );
  return data.tournament;
}

/**
 * 定向同步（P1-A「导出此系列赛」）：导出只含该届的范围包（编排 + 名下全部对局 + 该届选手档案），
 * 浏览器直接落盘为 JSON；对端在「数据同步 → 导入」合并。其他系列赛 / 普通对局不进包；
 * 若该届已删除，包内随行墓碑（= 定向删除指令）。返回包内比赛数供提示。
 */
export async function exportTournamentSyncBundleApi(tournamentId: string): Promise<{ matches: number }> {
  const result = await requestJson<{ success: boolean; bundle: SyncBundle }>('/api/sync/export', {
    method: 'POST',
    json: { includeProfiles: true, includeAvatars: false, tournamentIds: [tournamentId] },
  });

  const blob = new Blob([JSON.stringify(result.bundle, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  link.href = url;
  link.download = `roco-sync-${result.bundle.machine || 'X'}-${tournamentId}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return { matches: result.bundle.matches.length };
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

/** 解析回传的 .xlsx 模板：服务端解包为二维表（不写数据），前端再按表头走与 CSV 相同的配对解析 */
export async function parseLineupXlsxApi(
  tournamentId: string,
  file: File,
): Promise<{ sheetName: string; table: string[][] }> {
  return uploadSingleFile<{ success: boolean; sheetName: string; table: string[][] }>(
    `/api/tournaments/${tournamentId}/lineup-import/parse-xlsx`,
    file,
  );
}
