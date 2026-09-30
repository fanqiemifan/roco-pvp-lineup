import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadRuntimeConfig, saveRuntimeConfig } from '../../electron/services/config-service';
import { saveProfilePlayerAvatar } from '../../electron/services/image-service';
import { createMatch, getMatchStore, saveGameLineupForMatch } from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { getProfileStore, savePlayerProfile } from '../../electron/services/profile-service';
import { applySyncImport, exportSyncBundle, previewSyncImport } from '../../electron/services/sync-service';
import { buildPlayerNameMap } from '../../src/admin-antd/lib/tournament';
import type { SyncBundle, SyncImportPreview } from '../../shared/types';

/** 1×1 合法 PNG（用于头像夹具，能通过魔数校验并被 sharp 处理） */
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let paths: AppPaths;
let source: AppPaths;

beforeEach(() => {
  // paths = 本机（导入方），source = 另一台机器（导出方）
  const root = mkdtempSync(join(tmpdir(), 'roco-sync-target-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });

  const sourceRoot = mkdtempSync(join(tmpdir(), 'roco-sync-source-'));
  source = createAppPaths(sourceRoot, sourceRoot);
  mkdirSync(source.dataDir, { recursive: true });
  saveRuntimeConfig(source, { machineCode: 'B' });
});

function acceptAllKeys(preview: SyncImportPreview): string[] {
  return [...preview.matchItems, ...preview.playerItems, ...preview.teamItems]
    .filter((item) => item.action !== 'skip')
    .map((item) => item.key);
}

function cloneBundle(bundle: SyncBundle): SyncBundle {
  return JSON.parse(JSON.stringify(bundle)) as SyncBundle;
}

/** 从另一台机器导出比赛包（不含档案/头像） */
function exportMatchesFromSource(): SyncBundle {
  createMatch(source, { leftPlayer: '夜航', rightPlayer: '青栀', bestOf: 3 });
  createMatch(source, { leftPlayer: '白鹭', rightPlayer: '南风', bestOf: 3 });
  return exportSyncBundle(source, { includeProfiles: false, includeAvatars: false });
}

describe('exportSyncBundle', () => {
  it('导出包含全部比赛与机器码标识；未勾选档案时不含 profiles/avatars', () => {
    saveRuntimeConfig(paths, { machineCode: 'A' });
    createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });

    const bundle = exportSyncBundle(paths, { includeProfiles: false, includeAvatars: false });

    expect(bundle.app).toBe('roco-pvp-lineup');
    expect(bundle.schema).toBe(1);
    expect(bundle.machine).toBe('A');
    expect(bundle.matches).toHaveLength(1);
    expect(bundle.matches[0].id).toMatch(/^\d{8}_A\d{3}$/);
    expect(bundle.profiles).toBeUndefined();
    expect(bundle.avatars).toBeUndefined();
  });

  it('勾选档案与头像时内嵌 base64，缺失头像不产生键', async () => {
    const profiles = savePlayerProfile(paths, { name: '夜航', rank: '12' });
    const playerId = profiles.players[0].id;
    await saveProfilePlayerAvatar(paths, playerId, Buffer.from(PNG_1X1_BASE64, 'base64'));
    savePlayerProfile(paths, { name: '青栀' });

    const bundle = exportSyncBundle(paths, { includeProfiles: true, includeAvatars: true });

    expect(bundle.profiles?.players).toHaveLength(2);
    expect(Object.keys(bundle.avatars?.players ?? {})).toEqual([playerId]);
    // 首 8 字节为 PNG 魔数，确认是原始文件而非 data: 前缀
    const magic = Buffer.from(bundle.avatars?.players[playerId] ?? '', 'base64').subarray(0, 8).toString('hex');
    expect(magic).toBe('89504e470d0a1a0a');
  });
});

describe('previewSyncImport / applySyncImport（比赛）', () => {
  it('本机为空时全部新增；同包二次导入全部跳过（幂等）', async () => {
    const bundle = exportMatchesFromSource();

    const preview = previewSyncImport(paths, bundle, 'newer');
    expect(preview.summary.match).toEqual({ add: 2, update: 0, skip: 0 });
    expect(preview.matchItems.map((item) => item.label)).toContain('夜航 vs 青栀');
    expect(preview.matchItems[0].localUpdatedAt).toBeNull();

    const first = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(preview),
      includeAvatars: false,
    });
    expect(first.store.matches).toHaveLength(2);
    expect(first.applied.match).toEqual({ add: 2, update: 0, skip: 0 });

    const secondPreview = previewSyncImport(paths, bundle, 'newer');
    expect(secondPreview.summary.match).toEqual({ add: 0, update: 0, skip: 2 });
    const second = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(secondPreview),
      includeAvatars: false,
    });
    expect(second.store.matches).toHaveLength(2);
    expect(second.applied.match.add).toBe(0);
  });

  it('较新覆盖：包内 updatedAt 更新才覆盖本机版本，更旧不覆盖', async () => {
    const bundle = exportMatchesFromSource();
    const basePreview = previewSyncImport(paths, bundle, 'newer');
    await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(basePreview),
      includeAvatars: false,
    });

    const newerBundle = cloneBundle(bundle);
    newerBundle.matches[0].leftPlayer = '夜航新版';
    newerBundle.matches[0].updatedAt = new Date(Date.now() + 60_000).toISOString();
    const newerPreview = previewSyncImport(paths, newerBundle, 'newer');
    expect(newerPreview.matchItems[0].action).toBe('update');
    const newerResult = await applySyncImport(paths, newerBundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(newerPreview),
      includeAvatars: false,
    });
    expect(newerResult.store.matches.find((match) => match.id === newerBundle.matches[0].id)?.leftPlayer).toBe('夜航新版');

    const olderBundle = cloneBundle(bundle);
    olderBundle.matches[0].leftPlayer = '夜航旧版';
    olderBundle.matches[0].updatedAt = new Date(Date.now() - 60_000).toISOString();
    const olderPreview = previewSyncImport(paths, olderBundle, 'newer');
    expect(olderPreview.matchItems[0].action).toBe('skip');
    const olderResult = await applySyncImport(paths, olderBundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(olderPreview),
      includeAvatars: false,
    });
    expect(olderResult.store.matches.find((match) => match.id === olderBundle.matches[0].id)?.leftPlayer).toBe('夜航新版');
  });

  it('以包为准：内容有差异即覆盖（不看时间戳），相同则跳过', async () => {
    const bundle = exportMatchesFromSource();
    const basePreview = previewSyncImport(paths, bundle, 'newer');
    await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(basePreview),
      includeAvatars: false,
    });

    const olderBundle = cloneBundle(bundle);
    olderBundle.matches[0].leftPlayer = '夜航旧版';
    olderBundle.matches[0].updatedAt = new Date(Date.now() - 60_000).toISOString();

    const preview = previewSyncImport(paths, olderBundle, 'bundle');
    expect(preview.matchItems[0].action).toBe('update');
    expect(preview.matchItems[0].reason).toContain('以包为准');

    const result = await applySyncImport(paths, olderBundle, {
      mode: 'bundle',
      acceptedKeys: acceptAllKeys(preview),
      includeAvatars: false,
    });
    expect(result.store.matches.find((match) => match.id === olderBundle.matches[0].id)?.leftPlayer).toBe('夜航旧版');

    const again = previewSyncImport(paths, olderBundle, 'bundle');
    expect(again.summary.match).toEqual({ add: 0, update: 0, skip: 2 });
  });

  it('未勾选的条目不落盘', async () => {
    const bundle = exportMatchesFromSource();
    const preview = previewSyncImport(paths, bundle, 'newer');
    const accepted = preview.matchItems.slice(0, 1).map((item) => item.key);

    const result = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: accepted,
      includeAvatars: false,
    });

    expect(result.store.matches).toHaveLength(1);
    expect(result.applied.match).toEqual({ add: 1, update: 0, skip: 0 });
  });
});

describe('previewSyncImport / applySyncImport（档案与头像）', () => {
  it('同名不同 id 的档案：保留本机 id + 登记 id 别名（对方 id 也能解析出名字）', async () => {
    savePlayerProfile(paths, { name: '夜航', rank: '100' });
    const localId = getProfileStore(paths).players[0].id;
    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_other_machine', name: '夜航', pets: '', declaration: '', rank: '1' }],
      teams: [],
    };

    const preview = previewSyncImport(paths, bundle, 'newer');
    expect(preview.playerItems).toHaveLength(1);
    // 内容有差异 → 可勾选覆盖；说明里点明「保留本机 id + 登记别名」
    expect(preview.playerItems[0].action).toBe('update');
    expect(preview.playerItems[0].reason).toContain('保留本机 id');
    expect(preview.playerItems[0].reason).toContain('p_other_machine');

    const result = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: preview.playerItems.map((item) => item.key),
      includeAvatars: false,
    });

    // 本机 id 不变（比赛/头像目录都引用它），内容按包内更新，并登记别名
    const local = result.profiles?.players.find((player) => player.name === '夜航');
    expect(local?.id).toBe(localId);
    expect(local?.rank).toBe('1');
    expect(result.profiles?.playerAliases?.['p_other_machine']).toBe(localId);
    // 别名能解析出名字：系列赛里的 playerIds 可能来自另一台机器
    const names = buildPlayerNameMap(result.profiles ?? null);
    expect(names.get('p_other_machine')).toBe('夜航');
  });

  it('同名且内容完全一致（预览显示跳过）时也要登记别名', async () => {
    // 之前别名只在「可勾选的更新」分支登记，内容一致的同名档案同步多少次都补不上别名 →
    // 系列赛里对方的 playerIds 一直显示成一串 id
    savePlayerProfile(paths, { id: 'p_local_same', name: '同款选手', rank: '5' });
    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_remote_same', name: '同款选手', pets: '', declaration: '', rank: '5' }],
      teams: [],
    };

    const preview = previewSyncImport(paths, bundle, 'newer');
    expect(preview.playerItems[0].action).toBe('skip');

    // 即便用户一条都没勾选（acceptedKeys 为空），名字匹配上的别名也要落盘
    const result = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: [],
      includeAvatars: false,
    });

    expect(result.profiles?.playerAliases?.p_remote_same).toBe('p_local_same');
    expect(buildPlayerNameMap(result.profiles ?? null).get('p_remote_same')).toBe('同款选手');
    // 本机档案保持原样（跳过不动数据）
    expect(getProfileStore(paths).players.map((player) => player.id)).toEqual(['p_local_same']);
  });

  it('新档案按 id 新增；同 id 内容差异覆盖、相同跳过', async () => {
    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_sync_1', name: '白鹭', pets: '', declaration: '', rank: '7' }],
      teams: [],
    };

    const firstPreview = previewSyncImport(paths, bundle, 'newer');
    expect(firstPreview.playerItems[0].action).toBe('add');
    const first = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: firstPreview.playerItems.map((item) => item.key),
      includeAvatars: false,
    });
    expect(first.profiles?.players.map((player) => player.id)).toEqual(['p_sync_1']);

    const againPreview = previewSyncImport(paths, bundle, 'newer');
    expect(againPreview.playerItems[0].action).toBe('skip');

    bundle.profiles.players[0].rank = '9';
    const changedPreview = previewSyncImport(paths, bundle, 'newer');
    expect(changedPreview.playerItems[0].action).toBe('update');
    const changed = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: changedPreview.playerItems.map((item) => item.key),
      includeAvatars: false,
    });
    expect(changed.profiles?.players[0].rank).toBe('9');
  });

  it('头像只补缺：本地缺失才写入（含同名匹配），已有头像保持不动', async () => {
    savePlayerProfile(paths, { name: '夜航' });
    const localId = getProfileStore(paths).players[0].id;
    expect(existsSync(paths.profilePlayerAvatarFile(localId))).toBe(false);

    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_other_machine', name: '夜航', pets: '', declaration: '', rank: '' }],
      teams: [],
    };
    bundle.avatars = { players: { p_other_machine: PNG_1X1_BASE64 }, teams: {} };

    const preview = previewSyncImport(paths, bundle, 'newer');
    expect(preview.avatars.players).toEqual({ fill: 1, existing: 0, unmatched: 0 });

    const result = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: preview.playerItems.map((item) => item.key),
      includeAvatars: true,
    });
    expect(result.avatarsWritten.players).toBe(1);
    expect(existsSync(paths.profilePlayerAvatarFile(localId))).toBe(true);

    const secondPreview = previewSyncImport(paths, bundle, 'newer');
    expect(secondPreview.avatars.players).toEqual({ fill: 0, existing: 1, unmatched: 0 });
    const second = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: secondPreview.playerItems.map((item) => item.key),
      includeAvatars: true,
    });
    expect(second.avatarsWritten.players).toBe(0);
  });

  it('头像按 id 别名落到本机档案：对方改名后同名匹配失效也不丢头像', async () => {
    // 1) 先同步一次：本机已有同名档案 → 保留本机 id 并登记别名 p_other_machine -> 本机 id
    savePlayerProfile(paths, { name: '夜航' });
    const localId = getProfileStore(paths).players[0].id;
    const first = exportMatchesFromSource();
    first.profiles = {
      players: [{ id: 'p_other_machine', name: '夜航', pets: '', declaration: '', rank: '' }],
      teams: [],
    };
    const firstPreview = previewSyncImport(paths, first, 'newer');
    await applySyncImport(paths, first, {
      mode: 'newer',
      acceptedKeys: firstPreview.playerItems.map((item) => item.key),
      includeAvatars: false,
    });
    expect(getProfileStore(paths).playerAliases?.p_other_machine).toBe(localId);

    // 2) 对方把选手改名后带头像再同步：同名匹配失效，只能靠别名落盘
    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_other_machine', name: '夜航（改名后）', pets: '', declaration: '', rank: '' }],
      teams: [],
    };
    bundle.avatars = { players: { p_other_machine: PNG_1X1_BASE64 }, teams: {} };

    const preview = previewSyncImport(paths, bundle, 'newer');
    expect(preview.avatars.players).toEqual({ fill: 1, existing: 0, unmatched: 0 });

    // 一条档案都不勾选（本机不留对方名字的重名档案），头像仍要写到别名指向的本机档案
    const result = await applySyncImport(paths, bundle, { mode: 'newer', acceptedKeys: [], includeAvatars: true });
    expect(result.avatarsWritten.players).toBe(1);
    expect(existsSync(paths.profilePlayerAvatarFile(localId))).toBe(true);
  });

  it('覆盖已有头像：默认只补缺，勾选 overwriteAvatars 才覆盖本机同档案头像', async () => {
    savePlayerProfile(paths, { name: '夜航' });
    const localId = getProfileStore(paths).players[0].id;
    // 本机先有一张头像（尺寸与包内的不同，覆盖后文件必然变化）
    const localPng = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer();
    const incomingPng = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
      .png()
      .toBuffer();
    await saveProfilePlayerAvatar(paths, localId, localPng);
    const before = readFileSync(paths.profilePlayerAvatarFile(localId));

    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_other_machine', name: '夜航', pets: '', declaration: '', rank: '' }],
      teams: [],
    };
    bundle.avatars = { players: { p_other_machine: incomingPng.toString('base64') }, teams: {} };

    const preview = previewSyncImport(paths, bundle, 'newer');
    expect(preview.avatars.players).toEqual({ fill: 0, existing: 1, unmatched: 0 });

    const onlyFill = await applySyncImport(paths, bundle, { mode: 'newer', acceptedKeys: [], includeAvatars: true });
    expect(onlyFill.avatarsWritten.players).toBe(0);
    expect(readFileSync(paths.profilePlayerAvatarFile(localId))).toEqual(before);

    const overwritten = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: [],
      includeAvatars: true,
      overwriteAvatars: true,
    });
    expect(overwritten.avatarsWritten.players).toBe(1);
    expect(readFileSync(paths.profilePlayerAvatarFile(localId))).not.toEqual(before);
  });

  it('头像找不到对应档案：计入 unmatched，不写入', async () => {
    const bundle = exportMatchesFromSource();
    bundle.avatars = { players: { p_unknown: PNG_1X1_BASE64 }, teams: {} };

    const preview = previewSyncImport(paths, bundle, 'newer');
    expect(preview.avatars.players).toEqual({ fill: 0, existing: 0, unmatched: 1 });

    const result = await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: [],
      includeAvatars: true,
    });
    expect(result.avatarsWritten.players).toBe(0);
  });

  it('头像变更进入 diff：本机无、包内有 → 头像行 + 左右对照（新增档案同样计入补缺）', async () => {
    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_new_with_avatar', name: '小满', pets: '', declaration: '', rank: '' }],
      teams: [],
    };
    bundle.avatars = { players: { p_new_with_avatar: PNG_1X1_BASE64 }, teams: {} };

    const preview = previewSyncImport(paths, bundle, 'newer');
    const item = preview.playerItems[0];
    expect(item.action).toBe('add');
    expect(item.diff).toEqual([{ label: '头像', local: '无', incoming: '有（导入后补缺）' }]);
    expect(item.avatarCompare?.incomingDataUrl).toContain(PNG_1X1_BASE64);
    expect(item.avatarCompare?.localUrl).toBeNull();
    expect(item.avatarCompare?.note).toContain('补缺');
    // 包内新增的档案导入后会落盘，其头像算「补缺」而不是「无法对应」
    expect(preview.avatars.players).toEqual({ fill: 1, existing: 0, unmatched: 0 });
  });

  it('本机已有头像、包内无头像 → 显示「保持本机」差异行且不补缺', async () => {
    const profiles = savePlayerProfile(paths, { name: '夜航' });
    const localId = profiles.players[0].id;
    await saveProfilePlayerAvatar(paths, localId, Buffer.from(PNG_1X1_BASE64, 'base64'));

    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_other_machine', name: '夜航', pets: '', declaration: '', rank: '' }],
      teams: [],
    };
    bundle.avatars = { players: {}, teams: {} };

    const preview = previewSyncImport(paths, bundle, 'newer');
    const item = preview.playerItems[0];
    expect(item.diff).toEqual([{ label: '头像', local: '有（保持本机）', incoming: '无' }]);
    expect(item.avatarCompare).toBeUndefined();
    expect(preview.avatars.players).toEqual({ fill: 0, existing: 0, unmatched: 0 });
  });
});

describe('机器码与 id 分配', () => {
  it('未设置机器码沿用旧格式；设置后带前缀；导入他机数据后新建不冲突', async () => {
    const legacy = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
    expect(legacy.matches[0].id).toMatch(/^\d{8}_\d{3}$/);

    saveRuntimeConfig(paths, { machineCode: 'A' });
    const first = createMatch(paths, { leftPlayer: '甲', rightPlayer: '丙', bestOf: 3 });
    // 新建比赛前插在列表首位
    const firstId = first.matches[0].id;
    expect(firstId).toMatch(/^\d{8}_A\d{3}$/);

    // 导入 B 机的两场比赛（id 为 B 段）后，A 机新建仍接 A 段序号
    const bundle = exportMatchesFromSource();
    const preview = previewSyncImport(paths, bundle, 'newer');
    await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(preview),
      includeAvatars: false,
    });

    const next = createMatch(paths, { leftPlayer: '甲', rightPlayer: '丁', bestOf: 3 });
    const nextId = next.matches[0].id;
    expect(nextId).toMatch(/^\d{8}_A\d{3}$/);
    expect(nextId).not.toBe(firstId);
    expect(getMatchStore(paths).matches.filter((match) => match.id.startsWith(`${nextId.slice(0, 8)}_B`))).toHaveLength(2);
  });

  it('机器码规范化：小写转大写，非法字符被过滤', () => {
    saveRuntimeConfig(paths, { machineCode: 'b' });
    expect(loadRuntimeConfig(paths).machineCode).toBe('B');

    saveRuntimeConfig(paths, { machineCode: '1#$' });
    expect(loadRuntimeConfig(paths).machineCode).toBe('');
  });
});

describe('非法同步包', () => {
  it('app / schema 不符时抛错', () => {
    expect(() => previewSyncImport(paths, { app: 'other-app', schema: 1, matches: [] }, 'newer')).toThrow();
    expect(() => previewSyncImport(paths, { app: 'roco-pvp-lineup', schema: 99, matches: [] }, 'newer')).toThrow();
  });

  it('越权 id 的比赛被忽略（不进入合并，也不会拼进头像目录）', async () => {
    const evilBundle = {
      app: 'roco-pvp-lineup',
      schema: 1,
      machine: 'B',
      exportedAt: '',
      matches: [{ id: '../../evil', leftPlayer: '甲', rightPlayer: '乙' }],
    };

    const preview = previewSyncImport(paths, evilBundle, 'newer');
    expect(preview.summary.match).toEqual({ add: 0, update: 0, skip: 1 });
    expect(preview.matchItems[0].reason).toContain('不合法');

    const result = await applySyncImport(paths, evilBundle, {
      mode: 'newer',
      acceptedKeys: [],
      includeAvatars: false,
    });
    expect(result.store.matches).toHaveLength(0);
    expect(result.warnings.join('')).toContain('不合法');
  });
});

describe('完整工作流（A 统一创建 + 基线分发 + 回传）', () => {
  it('16 场：A 创建 → B 导入基线 → 各登记 8 场 → 回传后两端一致', async () => {
    saveRuntimeConfig(paths, { machineCode: 'A' });
    for (let index = 0; index < 16; index += 1) {
      createMatch(paths, { leftPlayer: `左${index + 1}`, rightPlayer: `右${index + 1}`, bestOf: 3 });
    }

    // ① 基线分发：A 导出 → B 导入（同一批 id，全部新增）
    const baseline = exportSyncBundle(paths, { includeProfiles: false, includeAvatars: false });
    expect(baseline.matches).toHaveLength(16);
    const baselinePreview = previewSyncImport(source, baseline, 'newer');
    expect(baselinePreview.summary.match).toEqual({ add: 16, update: 0, skip: 0 });
    await applySyncImport(source, baseline, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(baselinePreview),
      includeAvatars: false,
    });

    // 等 1 毫秒刻度，保证后续登记的时间戳晚于基线（updatedAt 精度为毫秒）
    await new Promise((resolve) => setTimeout(resolve, 10));

    // ② 分工登记：B 登记前 8 场、A 登记后 8 场（用阵容录入模拟）
    const ids = baseline.matches.map((match) => match.id);
    ids.slice(0, 8).forEach((matchId) => {
      saveGameLineupForMatch(source, matchId, 1, { left: [{ sprite: 'pet-b' }] });
    });
    ids.slice(8).forEach((matchId) => {
      saveGameLineupForMatch(paths, matchId, 1, { left: [{ sprite: 'pet-a' }] });
    });

    // ③ 回传汇总：B 导出全部 → A 导入（B 登记的 8 场较新覆盖，A 自己的保持不动）
    const fromB = exportSyncBundle(source, { includeProfiles: false, includeAvatars: false });
    const aPreview = previewSyncImport(paths, fromB, 'newer');
    expect(aPreview.summary.match).toEqual({ add: 0, update: 8, skip: 8 });
    await applySyncImport(paths, fromB, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(aPreview),
      includeAvatars: false,
    });

    // ④ 全量回传：A 导出 → B 导入（B 自己的 8 场跳过，补齐 A 登记的 8 场）
    const fromA = exportSyncBundle(paths, { includeProfiles: false, includeAvatars: false });
    expect(fromA.matches).toHaveLength(16);
    const bPreview = previewSyncImport(source, fromA, 'newer');
    expect(bPreview.summary.match).toEqual({ add: 0, update: 8, skip: 8 });
    await applySyncImport(source, fromA, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(bPreview),
      includeAvatars: false,
    });

    // ⑤ 两端一致：各 16 场，且双方登记的阵容在对方也能看到
    const storeA = getMatchStore(paths);
    const storeB = getMatchStore(source);
    expect(storeA.matches).toHaveLength(16);
    expect(storeB.matches).toHaveLength(16);
    const lineupPet = (store: typeof storeA, matchId: string) => store.matches
      .find((match) => match.id === matchId)?.games[0].leftSlots[0].pet_id ?? null;
    ids.slice(0, 8).forEach((matchId) => {
      expect(lineupPet(storeA, matchId)).toBe('pet-b');
      expect(lineupPet(storeB, matchId)).toBe('pet-b');
    });
    ids.slice(8).forEach((matchId) => {
      expect(lineupPet(storeA, matchId)).toBe('pet-a');
      expect(lineupPet(storeB, matchId)).toBe('pet-a');
    });
  });
});

describe('冲突识别与字段级 diff', () => {
  it('两台机器都登记过同一场且内容不同 → conflict = true，diff 列出差异字段', async () => {
    const bundle = exportMatchesFromSource();
    const basePreview = previewSyncImport(paths, bundle, 'newer');
    await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(basePreview),
      includeAvatars: false,
    });

    const matchId = bundle.matches[0].id;
    // 本机登记这场（录入阵容）
    saveGameLineupForMatch(paths, matchId, 1, { left: [{ sprite: 'pet-local' }] });

    // 包内也登记了同一场（不同阵容 + 更晚时间戳）
    const incoming = cloneBundle(bundle);
    const incomingMatch = incoming.matches.find((match) => match.id === matchId);
    if (!incomingMatch) {
      throw new Error('match not found in bundle');
    }
    incomingMatch.games[0].leftSlots[0].pet_id = 'pet-bundle';
    incomingMatch.games[0].leftLineup = ['pet-bundle'];
    incomingMatch.updatedAt = new Date(Date.now() + 60_000).toISOString();

    const preview = previewSyncImport(paths, incoming, 'newer');
    const item = preview.matchItems.find((entry) => entry.id === matchId);
    expect(item?.conflict).toBe(true);
    expect(item?.action).toBe('update');
    expect(item?.diff.length ?? 0).toBeGreaterThan(0);
    expect(item?.diff.map((field) => field.label)).toContain('第 1 局左侧阵容');
    expect(item?.diff.find((field) => field.label === '第 1 局左侧阵容')).toEqual({
      label: '第 1 局左侧阵容',
      local: 'pet-local',
      incoming: 'pet-bundle',
    });
  });

  it('只有一边登记过 → 不算冲突（正常同步），但仍有 diff', async () => {
    const bundle = exportMatchesFromSource();
    const basePreview = previewSyncImport(paths, bundle, 'newer');
    await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: acceptAllKeys(basePreview),
      includeAvatars: false,
    });

    // 只有包内登记（本机保持空白基线）
    const incoming = cloneBundle(bundle);
    const incomingMatch = incoming.matches[0];
    incomingMatch.games[0].status = 'completed';
    incomingMatch.games[0].winner = 'left';
    incomingMatch.updatedAt = new Date(Date.now() + 60_000).toISOString();

    const preview = previewSyncImport(paths, incoming, 'newer');
    const item = preview.matchItems.find((entry) => entry.id === incomingMatch.id);
    expect(item?.action).toBe('update');
    expect(item?.conflict).toBe(false);
    expect(item?.diff.length ?? 0).toBeGreaterThan(0);
  });

  it('档案 diff：同 id 内容差异列出变更字段', async () => {
    const bundle = exportMatchesFromSource();
    bundle.profiles = {
      players: [{ id: 'p_sync_1', name: '白鹭', pets: '', declaration: '', rank: '7' }],
      teams: [],
    };
    const firstPreview = previewSyncImport(paths, bundle, 'newer');
    await applySyncImport(paths, bundle, {
      mode: 'newer',
      acceptedKeys: firstPreview.playerItems.map((item) => item.key),
      includeAvatars: false,
    });

    bundle.profiles.players[0].rank = '9';
    const preview = previewSyncImport(paths, bundle, 'newer');
    const item = preview.playerItems[0];
    expect(item.action).toBe('update');
    expect(item.diff).toEqual([{ label: '排名', local: '7', incoming: '9' }]);
  });
});