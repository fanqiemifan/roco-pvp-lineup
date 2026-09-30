import type { AvatarCollectionState, AvatarState, MatchRecord, PlayerProfile } from '../../shared/types.js';
import { getAvatarState } from './image-service.js';
import { getProfileStore } from './profile-service.js';
import type { AppPaths } from './path-service.js';

type AvatarSide = 'left' | 'right';

/**
 * 统一头像解析：赛事覆盖 > 档案头像（按选手名匹配） > 占位。
 *
 * 背景：项目里同时存在两套头像——「赛事头像」按 matchId 存于 cache/avatars/**，
 * 「档案头像」按 playerId 存于 cache/profiles/players/**。此前各页面只读赛事头像，
 * 导致「信息录入」里改头像不会反映到已建比赛，且同人多页不一致。
 * 这里把两者收敛为一个解析口径，前端仍只消费 { exists, path, mtime }。
 *
 * 复用方式：一次请求内用 createAvatarResolver 建一次档案索引，避免逐场重复读 profiles.json。
 */
export interface AvatarResolver {
  forMatch(match: MatchRecord | null): AvatarCollectionState;
}

/** 选手名 → 档案索引（同名时后者覆盖，与 withProfileRankFallback 口径一致） */
function buildPlayerIndex(paths: AppPaths): Map<string, PlayerProfile> {
  const index = new Map<string, PlayerProfile>();
  for (const player of getProfileStore(paths).players) {
    index.set(player.name, player);
  }
  return index;
}

/** 档案头像的 AvatarState（无头像文件时返回 null，交由调用方回退占位） */
function profileAvatarState(side: AvatarSide, profile: PlayerProfile): AvatarState | null {
  if (!profile.avatarExists) {
    return null;
  }
  return {
    side,
    exists: true,
    path: `/runtime/profiles/players/${encodeURIComponent(profile.id)}.png`,
    mtime: typeof profile.avatarMtime === 'number' ? profile.avatarMtime : undefined,
  };
}

function resolveSide(
  paths: AppPaths,
  match: MatchRecord | null,
  side: AvatarSide,
  playerIndex: Map<string, PlayerProfile>,
): AvatarState {
  const override = getAvatarState(paths, side, match ? match.id : null);
  if (override.exists) {
    return override;
  }

  if (match) {
    const name = side === 'left' ? match.leftPlayer : match.rightPlayer;
    const profile = name ? playerIndex.get(name) : undefined;
    const fromProfile = profile ? profileAvatarState(side, profile) : null;
    if (fromProfile) {
      return fromProfile;
    }
  }

  return { side, exists: false };
}

export function createAvatarResolver(paths: AppPaths): AvatarResolver {
  const playerIndex = buildPlayerIndex(paths);
  return {
    forMatch: (match) => ({
      left: resolveSide(paths, match, 'left', playerIndex),
      right: resolveSide(paths, match, 'right', playerIndex),
    }),
  };
}

/** 单场一次性解析（调用点只解析一场时使用） */
export function resolveMatchAvatars(paths: AppPaths, match: MatchRecord | null): AvatarCollectionState {
  return createAvatarResolver(paths).forMatch(match);
}
