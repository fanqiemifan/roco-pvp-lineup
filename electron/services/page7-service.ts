import fs from 'node:fs';

import type { Page7State } from '../../shared/types.js';
import { ensureRuntimeDirs } from './image-service.js';
import { getMatchStore } from './match-service.js';
import type { AppPaths } from './path-service.js';

export const PAGE7_DEFAULT_TITLE = '对局推送';

export const PAGE7_DEFAULT_NOTICE = '温馨提示：排名选自选手历史最高非实时';

/**
 * 对局推送页（page7）选场数量上限。
 *
 * 原来是 9（画面靠"整列表滚动"展示，9 场是那个结构的容量上限）；现在画面改成"一屏 4 行 + 整屏
 * 过渡"，行数只影响翻屏轮数、不影响 DOM 规模，所以按「整届 / 按阶段·波次勾选」放开：一条系列赛
 * 最多 156 场（64 人模板），取 200 当兜底，正常选场永远不会被截断——这里保留上限只为挡住异常大的
 * 手写 payload（KV/落盘体积），不是产品限制。
 */
export const PAGE7_MAX_MATCHES = 200;

function defaultPage7State(): Page7State {
  return {
    matchIds: [],
    title: '',
    notice: '',
    mtime: null,
  };
}

function normalizeMatchIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    const id = String(item ?? '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length >= PAGE7_MAX_MATCHES) {
      break;
    }
  }
  return ids;
}

function normalizeTitle(value: unknown): string {
  return String(value ?? '').trim().slice(0, 40);
}

function normalizeNotice(value: unknown): string {
  return String(value ?? '').trim().slice(0, 60);
}

export function getPage7State(paths: AppPaths): Page7State {
  if (!fs.existsSync(paths.page7File)) {
    return defaultPage7State();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.page7File, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.page7File);
    // 兼容旧版单选结构 matchId: string | null
    const legacyMatchIds = normalizeMatchIds([metadata.matchId]);
    return {
      matchIds: metadata.matchIds === undefined ? legacyMatchIds : normalizeMatchIds(metadata.matchIds),
      title: normalizeTitle(metadata.title),
      notice: normalizeNotice(metadata.notice),
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultPage7State();
  }
}

/**
 * 保存 page7 配置。matchIds 只保留比赛列表中真实存在的比赛（避免悬空引用），
 * 顺序即页面展示顺序。
 */
export function savePage7State(paths: AppPaths, payload: unknown): Page7State {
  if (!payload || typeof payload !== 'object') {
    throw new Error('page7 payload must be an object');
  }

  ensureRuntimeDirs(paths);

  const raw = payload as Record<string, unknown>;
  const previous = getPage7State(paths);
  const matchIds = raw.matchIds === undefined ? previous.matchIds : normalizeMatchIds(raw.matchIds);
  const title = raw.title === undefined ? previous.title : normalizeTitle(raw.title);
  const notice = raw.notice === undefined ? previous.notice : normalizeNotice(raw.notice);

  const knownIds = new Set(getMatchStore(paths).matches.map((match) => match.id));
  const effectiveMatchIds = matchIds.filter((id) => knownIds.has(id));

  const metadata = { matchIds: effectiveMatchIds, title, notice };
  fs.writeFileSync(paths.page7File, JSON.stringify(metadata, null, 2), 'utf-8');
  return getPage7State(paths);
}

/**
 * 清理选场清单中已不存在的比赛引用（对局推送不限状态，只处理删除）。
 * 比赛删除后由广播出口调用：有变化时落盘并返回新状态，无变化返回 null。
 */
export function prunePage7State(paths: AppPaths): Page7State | null {
  const current = getPage7State(paths);
  const knownIds = new Set(getMatchStore(paths).matches.map((match) => match.id));
  const matchIds = current.matchIds.filter((id) => knownIds.has(id));
  if (matchIds.length === current.matchIds.length) {
    return null;
  }
  return savePage7State(paths, { matchIds });
}
