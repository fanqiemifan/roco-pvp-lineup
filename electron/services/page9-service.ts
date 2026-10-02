import fs from 'node:fs';

import type { Page9State, Page9TeamEntry } from '../../shared/types.js';
import { ensureRuntimeDirs } from './image-service.js';
import type { AppPaths } from './path-service.js';

export const PAGE9_MAX_TEAMS = 4;

/** 单项积分最大位数（0-999） */
const SCORE_MAX_LENGTH = 3;

function defaultPage9State(): Page9State {
  return {
    title: '',
    teams: [],
    mtime: null,
  };
}

function normalizeTitle(value: unknown): string {
  return String(value ?? '').trim().slice(0, 40);
}

function normalizeTeamName(value: unknown): string {
  return String(value ?? '').trim().slice(0, 40);
}

/** 积分：仅保留数字（空字符串 = 未输入，页面显示「-」） */
function normalizeScore(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, SCORE_MAX_LENGTH);
}

function normalizeTeams(value: unknown): Page9TeamEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const teams: Page9TeamEntry[] = [];
  for (const item of value) {
    if (teams.length >= PAGE9_MAX_TEAMS) {
      break;
    }
    const raw = (item ?? {}) as Record<string, unknown>;
    teams.push({
      name: normalizeTeamName(raw.name),
      r1: normalizeScore(raw.r1),
      r2: normalizeScore(raw.r2),
      r3: normalizeScore(raw.r3),
    });
  }
  return teams;
}

export function getPage9State(paths: AppPaths): Page9State {
  if (!fs.existsSync(paths.page9File)) {
    return defaultPage9State();
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(paths.page9File, 'utf-8')) as Record<string, unknown>;
    const stat = fs.statSync(paths.page9File);
    return {
      title: normalizeTitle(metadata.title),
      teams: normalizeTeams(metadata.teams),
      mtime: stat.mtimeMs,
    };
  } catch {
    return defaultPage9State();
  }
}

/**
 * 保存 page9 配置：标题 + 最多 PAGE9_MAX_TEAMS 支战队的名称与三轮积分。
 * 排名与总积分不落盘，由推流页按总积分降序自动计算。
 */
export function savePage9State(paths: AppPaths, payload: unknown): Page9State {
  if (!payload || typeof payload !== 'object') {
    throw new Error('page9 payload must be an object');
  }

  ensureRuntimeDirs(paths);

  const current = getPage9State(paths);
  const raw = payload as Record<string, unknown>;

  const metadata = {
    title: raw.title === undefined ? current.title : normalizeTitle(raw.title),
    teams: raw.teams === undefined ? current.teams : normalizeTeams(raw.teams),
  };
  fs.writeFileSync(paths.page9File, JSON.stringify(metadata, null, 2), 'utf-8');
  return getPage9State(paths);
}
