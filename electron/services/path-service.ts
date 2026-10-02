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
  /** 晋级积分榜（page14）配置文件（cache/page14.json） */
  page14File: string;
  /** 选手介绍（page11-13）配置文件（cache/page11.json） */
  page11File: string;
  /** MVP 结算（page4）配置文件（cache/mvp.json） */
  mvpFile: string;
  /** 倒计时插件状态文件（cache/countdown.json） */
  countdownFile: string;
  nextgameFile: string;
  configFile: string;
  profilesFile: string;
  /** 系列赛编排状态文件（cache/tournaments.json） */
  tournamentsFile: string;
  /** 云同步本机状态文件（cache/cloud-sync.json：房间名册 / 指派规则 / 回传序号 / 回执） */
  cloudSyncFile: string;
  /** 云同步「同步最新」拉取下来的待合并同步包（cache/cloud-pending.json，确认导入后才清除） */
  cloudPendingFile: string;
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
    page14File: path.join(cacheDir, 'page14.json'),
    page11File: path.join(cacheDir, 'page11.json'),
    mvpFile: path.join(cacheDir, 'mvp.json'),
    countdownFile: path.join(cacheDir, 'countdown.json'),
    nextgameFile: path.join(cacheDir, 'nextgame.json'),
    configFile: path.join(runtimeDir, 'config.json'),
    profilesFile: path.join(cacheDir, 'profiles.json'),
    tournamentsFile: path.join(cacheDir, 'tournaments.json'),
    cloudSyncFile: path.join(cacheDir, 'cloud-sync.json'),
    cloudPendingFile: path.join(cacheDir, 'cloud-pending.json'),
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
