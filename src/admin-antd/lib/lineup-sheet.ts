import type {
  GameRecord,
  MatchRecord,
  MatchSlotSnapshot,
  SpriteRecord,
  TournamentRecord,
} from '../../../shared/types';
import { formatStageRoundLabel } from './tournament';

/* ==================== 系列赛阵容表：模板 CSV 生成 + 回填解析（纯函数，可测） ==================== */

/** 导入的一次规范化对局：matchId + 左右两侧原始填写（null = 该侧未填写，保持原样不写） */
export interface LineupSheetEntry {
  matchId: string;
  left: string[] | null;
  right: string[] | null;
}

export interface LineupSheetParseResult {
  entries: LineupSheetEntry[];
  /** 阻断问题（整份不可导入） */
  errors: string[];
  /** 非阻断提示（重复行、忽略行等） */
  warnings: string[];
}

/* ---------- 模板 CSV 生成（导出） ---------- */

export type LineupTemplateScope =
  /** 整届：全部待开始比赛 */
  | { kind: 'all' }
  /** 按阶段：仅某个阶段（stageIndex）内的待开始比赛 */
  | { kind: 'stage'; stageIndex: number }
  /** 仅当前波：最新一波（最大阶段 + 最大波次）内的待开始比赛 */
  | { kind: 'current-wave' };

export interface LineupTemplateOptions {
  record: TournamentRecord;
  matches: MatchRecord[];
  sprites: SpriteRecord[];
  scope: LineupTemplateScope;
}

/** 模板将导出的一场对局（导出弹窗的确认列表行；与实际导出的 xlsx 内容同源） */
export interface LineupTemplateMatchRow {
  matchId: string;
  /** 阶段 · 轮次标签（单败仅阶段名；双败带胜者组/败者组等，与 CSV 的「阶段」列同口径） */
  stageLabel: string;
  /** 左侧选手名（空则「左侧」） */
  leftPlayer: string;
  rightPlayer: string;
  /** 第 1 局是否已有阵容（导出时按 `pet_id_名字（形态）` 回显预填） */
  hasLineup: boolean;
}

/** 收集模板要导出的对局（只收「已建场 + 比赛待开始 + 第 1 局尚未开赛」；行序 = 阶段 → 波次 → 节点） */
function collectLineupTemplateTargets(options: LineupTemplateOptions): LineupTemplateTarget[] {
  const { record, matches, scope } = options;
  const matchById = new Map(matches.map((match) => [match.id, match]));

  const orderedWaves = [...record.waves].sort(
    (left, right) => left.stageIndex - right.stageIndex || left.waveIndex - right.waveIndex,
  );
  const latestWave = orderedWaves[orderedWaves.length - 1];
  const latestWaveKey = latestWave ? `${latestWave.stageIndex}:${latestWave.waveIndex}` : '';

  const targets: LineupTemplateTarget[] = [];
  const seenMatchIds = new Set<string>();

  orderedWaves.forEach((wave) => {
    if (scope.kind === 'stage' && wave.stageIndex !== scope.stageIndex) {
      return;
    }
    if (scope.kind === 'current-wave' && `${wave.stageIndex}:${wave.waveIndex}` !== latestWaveKey) {
      return;
    }
    wave.nodes.forEach((node) => {
      if (!node.matchId || seenMatchIds.has(node.matchId)) {
        return;
      }
      seenMatchIds.add(node.matchId);
      const match = matchById.get(node.matchId);
      if (!match || match.status !== 'pending') {
        return;
      }
      const firstGame = match.games.find((game) => game.gameNumber === 1);
      if (!firstGame || firstGame.status !== 'pending') {
        return;
      }
      const stageLabel = match.tournamentRef
        ? (formatStageRoundLabel(record, match.tournamentRef) ?? '')
        : '';
      targets.push({ match, firstGame, stageLabel });
    });
  });
  return targets;
}

/** 模板导出的内部目标（含第 1 局快照）：确认列表与实际导出内容都由它生成，保证两处同源 */
export interface LineupTemplateTarget {
  match: MatchRecord;
  firstGame: GameRecord;
  stageLabel: string;
}

export interface LineupTemplatePlan {
  count: number;
  /** 导出确认列表（弹窗里展示：具体是哪几场、各自阶段与阵容回显状态） */
  rows: LineupTemplateMatchRow[];
  /** 实际导出数据源（xlsx 渲染用，含第 1 局快照以回显预填） */
  targets: LineupTemplateTarget[];
}

/**
 * 生成阵容模板计划（导出弹窗的确认列表 + xlsx 渲染共用同一份筛选结果）。
 * 只收「已建场 + 比赛待开始 + 第 1 局尚未开赛」的对局；行序 = 阶段 → 波次 → 节点顺序。
 */
export function buildLineupTemplate(options: LineupTemplateOptions): LineupTemplatePlan {
  const targets = collectLineupTemplateTargets(options);
  const rows: LineupTemplateMatchRow[] = targets.map(({ match, firstGame, stageLabel }) => ({
    matchId: match.id,
    stageLabel,
    leftPlayer: match.leftPlayer || '左侧',
    rightPlayer: match.rightPlayer || '右侧',
    hasLineup: firstGame.leftSlots.some((slot) => Boolean(slot.pet_id))
      || firstGame.rightSlots.some((slot) => Boolean(slot.pet_id)),
  }));
  return { count: targets.length, rows, targets };
}

/**
 * xlsx「阵容」表内容（表头 + 一场两行）：列序与解析的列定位口径一致；
 * 第 1 局已录阵容按 `pet_id_名字（形态）`（SpriteRecord.name 全称）回显，与精灵下拉选项同格式。
 */
export function buildLineupTemplateSheet(
  targets: LineupTemplateTarget[],
  recordName: string,
  sprites: SpriteRecord[],
): { header: string[]; rows: string[][] } {
  const spriteByPetId = new Map(sprites.map((sprite) => [sprite.id, sprite]));
  const prefillLabels = (slots: MatchSlotSnapshot[]): string[] =>
    slots
      .map((slot) => {
        if (!slot.pet_id) {
          return '';
        }
        const sprite = spriteByPetId.get(slot.pet_id);
        return sprite ? `${sprite.id}_${sprite.name}` : slot.pet_id;
      })
      .filter(Boolean)
      .slice(0, 6);

  const header = ['系列赛', '阶段', '对局ID', '位置', '选手', '精灵1', '精灵2', '精灵3', '精灵4', '精灵5', '精灵6'];
  const rows: string[][] = [];
  targets.forEach(({ match, firstGame, stageLabel }) => {
    const sides = [
      { side: '左', player: match.leftPlayer || '左侧', slots: firstGame.leftSlots },
      { side: '右', player: match.rightPlayer || '右侧', slots: firstGame.rightSlots },
    ];
    sides.forEach(({ side, player, slots }) => {
      const labels = prefillLabels(slots);
      rows.push([
        recordName,
        stageLabel,
        match.id,
        side,
        player,
        ...Array.from({ length: 6 }, (_, index) => labels[index] ?? ''),
      ]);
    });
  });
  return { header, rows };
}

/* ---------- 回填解析（CSV / TSV / JSON / xlsx 解表） ---------- */

/** 表格粘贴 / CSV 文本 → 规范化对局列表（内部拆分为二维表后走 parseLineupSheetTable） */
export function parseLineupSheetText(text: string): LineupSheetParseResult {
  const trimmed = text.trim();
  return parseLineupSheetTable(splitDelimitedRows(trimmed, trimmed.includes('\t') ? '\t' : ','));
}

/**
 * 已拆分的二维表格 → 规范化对局列表（「对局ID + 位置」配对合并，缺一侧 = 单侧写入）。
 * CSV / TSV 文本与 .xlsx（服务端解表后回传）共用同一套表头定位与配对口径。
 */
export function parseLineupSheetTable(sourceRows: string[][]): LineupSheetParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = sourceRows.filter((cells) => cells.some((item) => String(item ?? '').trim() !== ''));
  if (rows.length < 2) {
    return { entries: [], errors: ['没有识别到数据行（需要表头 + 至少一行对局）'], warnings };
  }

  const header = rows[0].map((cell) => cell.trim());
  const columns = locateColumns(header);
  if (!columns) {
    return {
      entries: [],
      errors: ['表头缺少可识别列（需要「对局ID」「位置」与「精灵1..精灵6」）'],
      warnings,
    };
  }

  const grouped = new Map<string, { left?: string[]; right?: string[] }>();
  rows.slice(1).forEach((cells, rowIndex) => {
    const lineNo = rowIndex + 2;
    const matchId = (cells[columns.matchId] ?? '').trim();
    if (!matchId) {
      return;
    }
    const side = normalizeSideToken(cells[columns.side] ?? '');
    if (!side) {
      warnings.push(`第 ${lineNo} 行「位置」列无法识别（"${(cells[columns.side] ?? '').trim()}"），已忽略该行`);
      return;
    }
    const tokens: string[] = [];
    columns.slots.forEach((slotIndex) => {
      if (slotIndex === undefined) {
        return;
      }
      tokens.push(...splitTokens(cells[slotIndex] ?? ''));
    });
    const bucket = grouped.get(matchId) ?? {};
    if (bucket[side] !== undefined) {
      warnings.push(`对局 ${matchId} 的${side === 'left' ? '左' : '右'}侧出现多行，仅采用最后一行`);
    }
    bucket[side] = tokens.slice(0, 6);
    grouped.set(matchId, bucket);
  });

  const entries: LineupSheetEntry[] = [];
  grouped.forEach((bucket, matchId) => {
    const left = bucket.left?.length ? bucket.left : null;
    const right = bucket.right?.length ? bucket.right : null;
    if (!left && !right) {
      return;
    }
    entries.push({ matchId, left, right });
  });

  if (!entries.length) {
    errors.push('没有可导入的阵容（所有行均为空或已被忽略）');
  }
  return { entries, errors, warnings };
}

/** JSON 文本 → 规范化对局列表（对局分组式：rows[].left / right 数组，数组顺序 = 槽位顺序） */
export function parseLineupJsonText(
  text: string,
  expectedTournamentId?: string,
): LineupSheetParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { entries: [], errors: ['JSON 解析失败：格式不正确'], warnings };
  }

  const root = payload as Record<string, unknown> | unknown[] | null;
  if (expectedTournamentId && root && !Array.isArray(root) && typeof root === 'object') {
    const declared = (root as Record<string, unknown>).tournamentId;
    if (typeof declared === 'string' && declared.trim() && declared.trim() !== expectedTournamentId) {
      return {
        entries: [],
        errors: [`文件内 tournamentId（${declared.trim()}）与目标系列赛不一致，已拒绝导入`],
        warnings,
      };
    }
  }

  const rawRows = Array.isArray(root)
    ? root
    : (root && typeof root === 'object' ? (root as Record<string, unknown>).rows : null);
  if (!Array.isArray(rawRows)) {
    return { entries: [], errors: ['JSON 缺少 rows 数组'], warnings };
  }

  const normalizeSide = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) {
      return null;
    }
    const tokens = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 6);
    return tokens.length ? tokens : null;
  };

  const entries: LineupSheetEntry[] = [];
  rawRows.forEach((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const matchId = typeof row.matchId === 'string' ? row.matchId.trim() : '';
    if (!matchId) {
      warnings.push(`第 ${index + 1} 条缺少 matchId，已忽略`);
      return;
    }
    const left = normalizeSide(row.left);
    const right = normalizeSide(row.right);
    if (!left && !right) {
      return;
    }
    entries.push({ matchId, left, right });
  });

  if (!entries.length) {
    errors.push('JSON 中没有可导入的阵容（rows 为空或两侧均无内容）');
  }
  return { entries, errors, warnings };
}

/* ---------- 内部工具 ---------- */

/**
 * RFC4180 风格的分隔文本拆分：支持引号包裹与 "" 转义（Excel 导出的 CSV 可直接解析）。
 * 引号仅在「字段开头」开启包裹；字段中间游离的引号按字面保留，
 * 避免手滑多打一个引号就把后续整段文本吞进同一个单元格。
 */
function splitDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\r') {
      continue;
    }
    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

interface SheetColumnMap {
  matchId: number;
  side: number;
  /** 精灵列索引（按槽位顺序；单列「精灵」模式经 slot 展开兜底） */
  slots: Array<number | undefined>;
}

/** 表头定位：对局ID / 位置 必填；精灵列支持「精灵1..6」或单个「精灵」列（格内多值展开） */
function locateColumns(header: string[]): SheetColumnMap | null {
  const normalized = header.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, ''));
  const matchId = normalized.findIndex(
    (cell) => cell.includes('对局id') || cell === 'matchid' || cell === 'match_id',
  );
  const side = normalized.findIndex((cell) => cell.includes('位置') || cell === 'side');
  const slots: Array<number | undefined> = [];
  let singleSlot = -1;
  normalized.forEach((cell, index) => {
    const numbered = /^(精灵|slot|fill)([1-6])$/.exec(cell);
    if (numbered) {
      slots[Number(numbered[2]) - 1] = index;
      return;
    }
    if ((cell.includes('精灵') || cell.includes('阵容')) && singleSlot === -1) {
      singleSlot = index;
    }
  });
  if (matchId === -1 || side === -1) {
    return null;
  }
  const hasNumbered = slots.some((value) => value !== undefined);
  if (!hasNumbered && singleSlot === -1) {
    return null;
  }
  return { matchId, side, slots: hasNumbered ? slots : [singleSlot] };
}

/** 位置列归一化：左 / 左侧 / left → left；右 / 右侧 / right → right */
function normalizeSideToken(value: string): 'left' | 'right' | null {
  const token = value.trim().toLowerCase();
  if (!token) {
    return null;
  }
  if (token.includes('左') || token === 'left' || token === 'l') {
    return 'left';
  }
  if (token.includes('右') || token === 'right' || token === 'r') {
    return 'right';
  }
  return null;
}

/**
 * 单元格 → 名字 token 列表：
 * 先按明确分隔符（逗号 / 顿号 / 斜杠 / 分号 / 管道）拆段；
 * 段内若有空格分隔的多个名字则进一步拆分，但「数字 + 空格 + 名字」（pet_id / 编号写法）保持完整。
 */
function splitTokens(cell: string): string[] {
  const segments = cell
    .split(/[，,、/／;；|]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.flatMap((segment) => {
    if (/^#?\d{3,4}\s/.test(segment)) {
      return [segment];
    }
    const parts = segment.split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts : [segment];
  });
}