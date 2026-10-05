/**
 * 比赛预告 / 比赛结果卡片的场序时间排期纯函数（electron 下发与后台选场弹窗共用）。
 *
 * 规则：第一场 = 用户填写的开始时间；之后每场累加「该场的占用时长」——
 * BO1 每场 +30 分钟（含开场缓冲），BO3 及以上按每小局 20 分钟（BO3 +60、BO5 +100、BO7 +140）。
 * 每场可手动输入时间覆盖，手动值只替换该场的显示结果，不影响后续场次的自动累加链。
 */

/** BO1 每场占用时长（分钟，含开场缓冲） */
export const MATCH_SLOT_MINUTES_BO1 = 30;

/** BO3 及以上每一小局占用时长（分钟）：BO3=+60、BO5=+100、BO7=+140 */
export const MATCH_SLOT_MINUTES_PER_BO = 20;

/** 每一场的自动累加时长（分钟）：BO1 = 30；BO3 及以上 = BO 数 × 20 */
export function matchSlotMinutes(bestOf: number): number {
  const bo = Math.max(0, Number(bestOf) || 0);
  return bo <= 1 ? MATCH_SLOT_MINUTES_BO1 : bo * MATCH_SLOT_MINUTES_PER_BO;
}

/** 卡片场序中文序数（上限 9 场） */
export const CHINESE_ORDINALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 严格校验 HH:mm（00-23:00-59），非法值返回空字符串 */
export function normalizeHHmm(value: unknown): string {
  const text = String(value ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) {
    return '';
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return '';
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 在 HH:mm 上累加分钟数，按 24 小时制回绕，返回 HH:mm；输入非法返回空串 */
export function addMinutesToHHmm(time: string, deltaMinutes: number): string {
  const normalized = normalizeHHmm(time);
  if (!normalized) {
    return '';
  }
  const [hour, minute] = normalized.split(':').map(Number);
  const total = (((hour * 60 + minute + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 计算每场比赛的展示时间。
 * @param items 按展示顺序排列的比赛（id + bestOf）
 * @param startTime 用户填写的开始时间 HH:mm（空 = 未配置自动累加链）
 * @param overrides 按比赛 id 记录的手动时间覆盖（仅替换该场，不影响后续自动累加；
 *                  未配置开始时间时手动值仍独立生效）
 * @returns 按比赛 id 索引的 HH:mm 映射（无开始时间且无手动覆盖时为 {}）
 */
export function computeScheduleTimes(
  items: ReadonlyArray<{ id: string; bestOf: number }>,
  startTime: unknown,
  overrides: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, string> {
  const start = normalizeHHmm(startTime);
  const result: Record<string, string> = {};
  let elapsedMinutes = 0;
  items.forEach((item) => {
    const automatic = start ? addMinutesToHHmm(start, elapsedMinutes) : '';
    const manual = normalizeHHmm(overrides?.[item.id]);
    const resolved = manual || automatic;
    if (resolved) {
      result[item.id] = resolved;
    }
    // 累加链始终基于自动值：手动覆盖不影响后续场次
    elapsedMinutes += matchSlotMinutes(item.bestOf);
  });
  return result;
}

/**
 * 生成卡片上方的场序信息文案，如「第一场 19:00」；未配置时间时只返回「第一场」。
 * @param index 从 0 开始的场序下标
 * @param time HH:mm（空字符串 = 未配置）
 */
export function formatScheduleLabel(index: number, time: unknown): string {
  const ordinal = CHINESE_ORDINALS[index] ?? String(index + 1);
  const normalizedTime = normalizeHHmm(time);
  return normalizedTime ? `第${ordinal}场 ${normalizedTime}` : `第${ordinal}场`;
}
