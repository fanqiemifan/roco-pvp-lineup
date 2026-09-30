import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { createAvatarResolver, resolveMatchAvatars } from '../../electron/services/avatar-resolver';
import { createMatch } from '../../electron/services/match-service';
import { savePlayerProfile } from '../../electron/services/profile-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import type { MatchRecord } from '../../shared/types';

let paths: AppPaths;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'roco-avatar-resolver-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
});

function newMatch(leftPlayer: string, rightPlayer: string): MatchRecord {
  return createMatch(paths, { leftPlayer, rightPlayer, bestOf: 3 }).matches[0];
}

function writeMatchAvatar(matchId: string, side: 'left' | 'right'): void {
  mkdirSync(paths.avatarDir(matchId), { recursive: true });
  writeFileSync(paths.avatarFile(side, matchId), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

function addProfile(id: string, name: string, withAvatar: boolean): void {
  savePlayerProfile(paths, { id, name, pets: '', declaration: '', rank: '' });
  if (withAvatar) {
    const file = paths.profilePlayerAvatarFile(id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
}

describe('resolveMatchAvatars（统一解析：赛事覆盖 > 档案头像 > 占位）', () => {
  it('两侧都没有赛事头像、也没有档案头像时回退占位（exists=false）', () => {
    const match = newMatch('甲', '乙');
    expect(resolveMatchAvatars(paths, match)).toEqual({
      left: { side: 'left', exists: false },
      right: { side: 'right', exists: false },
    });
  });

  it('无档案头像时命中赛事头像（保留手动覆盖路径）', () => {
    const match = newMatch('甲', '乙');
    writeMatchAvatar(match.id, 'left');

    const avatars = resolveMatchAvatars(paths, match);
    expect(avatars.left.exists).toBe(true);
    expect(avatars.left.path).toBe(`/api/avatar/${encodeURIComponent(match.id)}/left-avatar.png`);
    expect(avatars.right.exists).toBe(false);
  });

  it('没有赛事头像时按选手名回退档案头像（信息录入改头像即可生效）', () => {
    addProfile('p_alpha', '甲', true);
    const match = newMatch('甲', '乙');

    const avatars = resolveMatchAvatars(paths, match);
    expect(avatars.left.exists).toBe(true);
    expect(avatars.left.path).toBe('/runtime/profiles/players/p_alpha.png');
    expect(typeof avatars.left.mtime).toBe('number');
    // 乙 未建档案 → 占位
    expect(avatars.right.exists).toBe(false);
  });

  it('档案存在但未上传头像时仍回退占位', () => {
    addProfile('p_beta', '乙', false);
    const match = newMatch('甲', '乙');
    expect(resolveMatchAvatars(paths, match).right.exists).toBe(false);
  });

  it('赛事覆盖优先于档案头像', () => {
    addProfile('p_alpha', '甲', true);
    const match = newMatch('甲', '乙');
    writeMatchAvatar(match.id, 'left');

    const avatars = resolveMatchAvatars(paths, match);
    expect(avatars.left.path).toBe(`/api/avatar/${encodeURIComponent(match.id)}/left-avatar.png`);
  });

  it('未匹配到档案的选手名不影响另一侧解析', () => {
    addProfile('p_beta', '乙', true);
    const match = newMatch('查无此人', '乙');

    const avatars = resolveMatchAvatars(paths, match);
    expect(avatars.left.exists).toBe(false);
    expect(avatars.right.path).toBe('/runtime/profiles/players/p_beta.png');
  });

  it('createAvatarResolver 一次建索引、可连续解析多场', () => {
    addProfile('p_alpha', '甲', true);
    addProfile('p_beta', '乙', true);
    const first = newMatch('甲', '乙');
    const second = newMatch('甲', '丙');

    const resolver = createAvatarResolver(paths);
    expect(resolver.forMatch(first).left.path).toBe('/runtime/profiles/players/p_alpha.png');
    expect(resolver.forMatch(second).right.exists).toBe(false);
  });

  it('match 为 null 时（未创建比赛）不抛错，返回占位', () => {
    expect(resolveMatchAvatars(paths, null)).toEqual({
      left: { side: 'left', exists: false },
      right: { side: 'right', exists: false },
    });
  });
});
