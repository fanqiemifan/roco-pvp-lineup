import { mkdirSync, mkdtempSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { createMatch, setActiveMatch } from '../../electron/services/match-service';
import { createAppPaths, type AppPaths } from '../../electron/services/path-service';
import { savePlayerProfile } from '../../electron/services/profile-service';

// 真实 PNG（sharp 生成）：需要通过上传口的文件魔数校验 + sharp 缩放
let pngBytes: Buffer;

let server: LocalServer;
let base: string;
let paths: AppPaths;
let matchId: string;

function connectRole(role: string): Socket {
  return ioClient(base, { transports: ['websocket'], query: { role } });
}

async function waitConnected(client: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

async function uploadProfileAvatar(playerId: string): Promise<void> {
  const form = new FormData();
  const bytes = new Uint8Array(pngBytes.byteLength);
  bytes.set(pngBytes);
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'avatar.png');
  const response = await fetch(`${base}/api/upload/player-avatar/${playerId}`, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`upload failed ${response.status}: ${await response.text()}`);
  }
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'roco-avatar-broadcast-'));
  paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });

  pngBytes = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 200, g: 80, b: 30, alpha: 1 } } })
    .png()
    .toBuffer();

  const created = createMatch(paths, { leftPlayer: '甲', rightPlayer: '乙', bestOf: 3 });
  matchId = created.matches[0].id;
  setActiveMatch(paths, matchId);
  savePlayerProfile(paths, { id: 'p_alpha', name: '甲', pets: '', declaration: '', rank: '' });

  server = await createLocalServer(paths, 0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
});

describe('档案头像变更的广播（阶段二：改档案头像 → 各展示页立即重解析）', () => {
  it('上传档案头像后 page3 收到 avatar:update，且解析为档案头像路径', async () => {
    const client = connectRole('page3');
    await waitConnected(client);
    try {
      const received = new Promise<any>((resolve) => client.once('avatar:update', resolve));
      await uploadProfileAvatar('p_alpha');

      const payload = await received;
      expect(payload.matchId).toBe(matchId);
      // 该场没有赛事覆盖头像 → 回退到档案头像（阶段一解析口径）
      expect(payload.avatars.left.exists).toBe(true);
      expect(payload.avatars.left.path).toBe('/runtime/profiles/players/p_alpha.png');
      // 乙 未建档案 → 占位
      expect(payload.avatars.right.exists).toBe(false);
    } finally {
      client.close();
    }
  });

  it('page6（比赛结果）同样收到 avatar:update，不再只推给 page3/page11', async () => {
    const client = connectRole('page6');
    await waitConnected(client);
    try {
      const received = new Promise<any>((resolve) => client.once('avatar:update', resolve));
      await uploadProfileAvatar('p_alpha');
      const payload = await received;
      expect(payload.avatars.left.path).toBe('/runtime/profiles/players/p_alpha.png');
    } finally {
      client.close();
    }
  });

  it('上传后 GET /api/avatars 也返回解析后的档案头像', async () => {
    await uploadProfileAvatar('p_alpha');
    const avatars = (await fetch(`${base}/api/avatars`).then((response) => response.json())) as {
      left: { path?: string };
    };
    expect(avatars.left.path).toBe('/runtime/profiles/players/p_alpha.png');
  });
});
