import path from 'node:path';

export interface AppPaths {
  projectRoot: string;
  pagesDir: string;
  rendererDistDir: string;
  scriptsDir: string;
  stylesDir: string;
  assetsDir: string;
  resourcesDir: string;
  spritesDir: string;
  /** 精灵头像图标目录（resources/sprites-icon，命名 {pet_id}_{name}.png） */
  spritesIconDir: string;
  dataDir: string;
  runtimeDir: string;
  cacheDir: string;
  scoreboardFile: string;
  matchesFile: string;
  stageFile: string;
  page6File: string;
  page7File: string;
  page8File: string;
  page9File: string;
  /** 选手介绍（page11-13）配置文件（cache/page11.json） */
  page11File: string;
  /** 倒计时插件状态文件（cache/countdown.json） */
  countdownFile: string;
  page8WallpaperFile: string;
  nextgameFile: string;
  configFile: string;
  profilesFile: string;
  /** 「信息录入」选手头像文件（cache/profiles/players/{playerId}.png） */
  profilePlayerAvatarFile(playerId: string): string;
  /** 「信息录入」战队 logo/头像文件（cache/profiles/teams/{teamId}.png） */
  profileTeamLogoFile(teamId: string): string;
  panelStatePath(position: 'left' | 'right'): string;
  avatarDir(matchId: string | null): string;
  avatarFile(side: 'left' | 'right', matchId: string | null): string;
  avatarMetaFile(side: 'left' | 'right', matchId: string | null): string;
}

export function createAppPaths(projectRoot: string, userDataDir: string): AppPaths {
  const runtimeDir = path.join(userDataDir, 'runtime');
  const cacheDir = path.join(runtimeDir, 'cache');

  return {
    projectRoot,
    pagesDir: path.join(projectRoot, 'src', 'pages'),
    rendererDistDir: path.join(projectRoot, 'dist'),
    scriptsDir: path.join(projectRoot, 'src', 'scripts'),
    stylesDir: path.join(projectRoot, 'src', 'styles'),
    assetsDir: path.join(projectRoot, 'src', 'assets'),
    resourcesDir: path.join(projectRoot, 'resources'),
    spritesDir: path.join(projectRoot, 'resources', 'sprites-img'),
    spritesIconDir: path.join(projectRoot, 'resources', 'sprites-icon'),
    dataDir: path.join(projectRoot, 'resources', 'data'),
    runtimeDir,
    cacheDir,
    scoreboardFile: path.join(cacheDir, 'scoreboard.json'),
    matchesFile: path.join(cacheDir, 'matches.json'),
    stageFile: path.join(cacheDir, 'stage.json'),
    page6File: path.join(cacheDir, 'page6.json'),
    page7File: path.join(cacheDir, 'page7.json'),
    page8File: path.join(cacheDir, 'page8.json'),
    page9File: path.join(cacheDir, 'page9.json'),
    page11File: path.join(cacheDir, 'page11.json'),
    countdownFile: path.join(cacheDir, 'countdown.json'),
    page8WallpaperFile: path.join(cacheDir, 'page8-wallpaper.jpg'),
    nextgameFile: path.join(cacheDir, 'nextgame.json'),
    configFile: path.join(runtimeDir, 'config.json'),
    profilesFile: path.join(cacheDir, 'profiles.json'),
    // profile id 仅允许字母数字与 -_，防止路径穿越
    profilePlayerAvatarFile(playerId: string) {
      const safeId = String(playerId ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
      return path.join(cacheDir, 'profiles', 'players', `${safeId}.png`);
    },
    profileTeamLogoFile(teamId: string) {
      const safeId = String(teamId ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
      return path.join(cacheDir, 'profiles', 'teams', `${safeId}.png`);
    },
    panelStatePath(position: 'left' | 'right') {
      return path.join(cacheDir, `${position}.json`);
    },
    avatarDir(matchId) {
      // 头像按赛事隔离：cache/avatars/{matchId}
      return path.join(cacheDir, 'avatars', matchId ? String(matchId) : 'none');
    },
    avatarFile(side, matchId) {
      return path.join(this.avatarDir(matchId), `${side}-avatar.png`);
    },
    avatarMetaFile(side, matchId) {
      return path.join(this.avatarDir(matchId), `${side}-avatar.json`);
    },
  };
}
