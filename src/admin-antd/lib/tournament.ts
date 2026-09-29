import type {
  MatchRecord,
  PairingValidation,
  ProfileStoreState,
  TournamentNode,
  TournamentRecord,
  TournamentWave,
} from '../../../shared/types';

/* ==================== 纯函数：展示/校验辅助（可单测，不依赖 DOM） ==================== */

/** id → 选手名字映射（profiles 未加载时为空表，消费点需兜底显示 id） */
export function buildPlayerNameMap(profiles: ProfileStoreState | null): Map<string, string> {
  const map = new Map<string, string>();
  profiles?.players.forEach((player) => map.set(player.id, player.name));
  return map;
}

export function resolvePlayerName(names: Map<string, string>, id: string | null): string {
  if (!id) {
    return '';
  }
  return names.get(id) ?? id;
}

/** 系列赛状态文案与配色（列表/详情头部用） */
export function getTournamentStatusMeta(record: TournamentRecord): {
  label: string;
  color: string;
} {
  if (record.status === 'setup') {
    return { label: '待开赛', color: 'default' };
  }
  if (record.status === 'completed') {
    return { label: '已完赛', color: 'success' };
  }
  return { label: '进行中', color: 'processing' };
}

/** 阶段在系列赛中的状态：done 已完成 / current 正在进行 / pending 未开始 */
export function getStageState(
  record: TournamentRecord,
  stageIndex: number,
): 'done' | 'current' | 'pending' {
  if (stageIndex < record.currentStageIndex) {
    return 'done';
  }
  if (stageIndex === record.currentStageIndex) {
    return record.status === 'completed' ? 'done' : 'current';
  }
  return 'pending';
}

/** 波次全局下标（waves 是跨阶段的扁平数组）；找不到返回 -1 */
export function getWaveGlobalIndex(
  record: TournamentRecord,
  stageIndex: number,
  waveIndex: number,
): number {
  return record.waves.findIndex(
    (wave) => wave.stageIndex === stageIndex && wave.waveIndex === waveIndex,
  );
}

/** 当前位置简述：「阶段名 · 第N波」，setup 显示「抽签待开赛」 */
export function getCurrentPositionText(record: TournamentRecord): string {
  if (record.status === 'setup') {
    return '抽签待开赛';
  }
  const stage = record.stages[record.currentStageIndex];
  const stageWaves = record.waves.filter((wave) => wave.stageIndex === record.currentStageIndex);
  const lastWave = stageWaves[stageWaves.length - 1];
  if (record.status === 'completed' || !lastWave) {
    return '已结束';
  }
  return `${stage.name} · 第 ${lastWave.waveIndex} 波`;
}

/** 系列赛关联比赛中已完成的场次数（进度展示用） */
export function countCompletedMatches(
  record: TournamentRecord,
  matches: MatchRecord[],
): number {
  const nodeMatchIds = new Set<string>();
  record.waves.forEach((wave) => wave.nodes.forEach((node) => {
    if (node.matchId) {
      nodeMatchIds.add(node.matchId);
    }
  }));
  return matches.filter(
    (match) => nodeMatchIds.has(match.id) && match.status === 'completed',
  ).length;
}

/** 系列赛关联比赛的状态统计（仅计比赛库中实际存在的节点比赛），删除确认弹窗用 */
export function summarizeTournamentMatches(
  record: TournamentRecord,
  matches: MatchRecord[],
): { total: number; completed: number; inProgress: number; pending: number } {
  const summary = { total: 0, completed: 0, inProgress: 0, pending: 0 };
  const nodeMatchIds = new Set<string>();
  record.waves.forEach((wave) => wave.nodes.forEach((node) => {
    if (node.matchId) {
      nodeMatchIds.add(node.matchId);
    }
  }));
  matches.forEach((match) => {
    if (!nodeMatchIds.has(match.id)) {
      return;
    }
    summary.total += 1;
    if (match.status === 'completed') {
      summary.completed += 1;
    } else if (match.status === 'in_progress') {
      summary.inProgress += 1;
    } else {
      summary.pending += 1;
    }
  });
  return summary;
}

/** 节点对应比赛（找不到返回 undefined） */
export function findNodeMatch(
  wave: TournamentWave,
  matches: MatchRecord[],
  node: TournamentNode,
): MatchRecord | undefined {
  if (!node.matchId) {
    return undefined;
  }
  return matches.find((match) => match.id === node.matchId);
}

/** 节点（比赛）状态：completed / in_progress / pending；无关联比赛按 pending 处理 */
export function getNodeStatus(node: TournamentNode, match?: MatchRecord): MatchRecord['status'] {
  if (match) {
    return match.status;
  }
  return node.winnerId ? 'completed' : 'pending';
}

/* ---------- 配对确认台 ---------- */

/** draft 波期望选手桶：双败按战绩桶分组（key 形如 "1-0"），单败整池（key=undefined） */
export function getDraftBucketSpecs(
  record: TournamentRecord,
  wave: TournamentWave,
): Array<{ bucketKey?: string; playerIds: string[] }> {
  const alive = record.entries.filter((entry) => entry.state === 'alive');
  const stage = record.stages[wave.stageIndex];

  if (stage.format === 'single-elim') {
    return [{ bucketKey: undefined, playerIds: alive.map((entry) => entry.playerId) }];
  }

  const pick = (wins: number, losses: number): string[] =>
    alive
      .filter((entry) => entry.stageWins === wins && entry.stageLosses === losses)
      .map((entry) => entry.playerId);

  switch (wave.waveIndex) {
    case 1:
      return [{ bucketKey: '0-0', playerIds: pick(0, 0) }];
    case 2:
      return [
        { bucketKey: '1-0', playerIds: pick(1, 0) },
        { bucketKey: '0-1', playerIds: pick(0, 1) },
      ];
    default:
      return [{ bucketKey: '1-1', playerIds: pick(1, 1) }];
  }
}

/** 本阶段已交手判定（含胜者的节点），用于已交手提醒 */
export function hasPlayedInStage(
  record: TournamentRecord,
  stageIndex: number,
  a: string,
  b: string,
): boolean {
  return record.waves
    .filter((wave) => wave.stageIndex === stageIndex)
    .some((wave) => wave.nodes.some((node) => node.winnerId
      && ((node.playerAId === a && node.playerBId === b)
        || (node.playerAId === b && node.playerBId === a))));
}

/**
 * 配对草稿客户端校验（与服务端口径一致，锁定前即时反馈）：
 * 漏配/重复/自己对自己/不在本波 → 错误；跨桶未显式允许 → 错误；已交手 → 仅提醒。
 */
export function validateDraftPairs(
  record: TournamentRecord,
  wave: TournamentWave,
  pairs: NonNullable<TournamentWave['pairingDraft']>,
  allowCrossBucket: boolean,
): PairingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const specs = getDraftBucketSpecs(record, wave);
  // 期望选手 → 桶 key（单败 undefined）
  const expectedBucket = new Map<string, string | undefined>();
  specs.forEach((spec) => spec.playerIds.forEach((id) => expectedBucket.set(id, spec.bucketKey)));

  const seen = new Map<string, number>();

  pairs.forEach((row, rowIndex) => {
    const [a, b] = row.pair;
    if (!a || !b) {
      errors.push(`第 ${rowIndex + 1} 场存在漏配（未配对）`);
    }
    if (a && !expectedBucket.has(a)) {
      errors.push(`第 ${rowIndex + 1} 场选手不在本波名单`);
    }
    if (b && !expectedBucket.has(b)) {
      errors.push(`第 ${rowIndex + 1} 场选手不在本波名单`);
    }
    if (a) {
      seen.set(a, (seen.get(a) ?? 0) + 1);
    }
    if (b) {
      seen.set(b, (seen.get(b) ?? 0) + 1);
    }
    if (a && b && a === b) {
      errors.push(`第 ${rowIndex + 1} 场不能自己对自己`);
    }
    if (a && b) {
      const bucketA = expectedBucket.get(a);
      const bucketB = expectedBucket.get(b);
      if (bucketA !== undefined && bucketB !== undefined && bucketA !== bucketB) {
        if (!allowCrossBucket) {
          errors.push(`第 ${rowIndex + 1} 场为跨桶配对（战绩不对等），需勾选允许跨桶`);
        }
      }
      if (hasPlayedInStage(record, wave.stageIndex, a, b)) {
        warnings.push(`第 ${rowIndex + 1} 场双方本阶段已交手过`);
      }
    }
  });

  seen.forEach((count, id) => {
    if (count > 1) {
      errors.push(`选手重复出现在 ${count} 场对决中：${id}`);
    }
  });
  expectedBucket.forEach((_bucket, id) => {
    if (!seen.has(id)) {
      errors.push(`选手漏配：${id}`);
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}

/** 桶内随机重排：洗牌后两两配对（纯函数，RNG 注入便于测试） */
export function shuffleBucketPairs(
  playerIds: string[],
  rng: () => number,
): Array<[string, string]> {
  const ordered = [...playerIds];
  for (let i = ordered.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < ordered.length; i += 2) {
    if (ordered[i + 1] !== undefined) {
      pairs.push([ordered[i], ordered[i + 1]]);
    }
  }
  return pairs;
}

/** 选手当前状态文案（节点脚注：已晋级/已淘汰/存活） */
export function getPlayerStateText(
  record: TournamentRecord,
  playerId: string | null,
): string {
  if (!playerId) {
    return '';
  }
  const entry = record.entries.find((item) => item.playerId === playerId);
  if (!entry) {
    return '';
  }
  if (entry.state === 'promoted') {
    return `${entry.stageWins}-${entry.stageLosses} 已晋级`;
  }
  if (entry.state === 'eliminated') {
    return `${entry.stageWins}-${entry.stageLosses} 已淘汰`;
  }
  return `${entry.stageWins}-${entry.stageLosses} 存活`;
}
