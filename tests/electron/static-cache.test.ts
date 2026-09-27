import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocalServer, type LocalServer } from '../../electron/socket-server';
import { createAppPaths } from '../../electron/services/path-service';

let server: LocalServer;
let root: string;
let port: number;

function rawRequest(
  pathname: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk as Buffer));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    request.on('error', reject);
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'roco-cache-'));
  const paths = createAppPaths(root, root);
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.spritesDir, { recursive: true });

  writeFileSync(join(paths.spritesDir, '1001_暮星辰.png'), 'png');

  server = await createLocalServer(paths, 0, '127.0.0.1');
  port = (server.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await server.close();
});

describe('静态资源缓存头', () => {
  it('/img 精灵图：30 天 immutable 长缓存', async () => {
    const { status, headers, body } = await rawRequest(
      `/img/${encodeURIComponent('1001_暮星辰.png')}`,
      { 'Accept-Encoding': 'identity' },
    );
    expect(status).toBe(200);
    expect(headers['cache-control']).toContain('max-age=2592000');
    expect(headers['cache-control']).toContain('immutable');
    expect(body.toString()).toBe('png');
  });

  it('/runtime 用户上传内容不挂 immutable（保持协商缓存）', async () => {
    // cacheDir 由 ensureRuntimeDirs 在启动时创建
    writeFileSync(join(root, 'runtime', 'cache', 'cache-probe.txt'), 'runtime-content', 'utf-8');
    const { status, headers, body } = await rawRequest('/runtime/cache-probe.txt', { 'Accept-Encoding': 'identity' });
    expect(status).toBe(200);
    expect(String(headers['cache-control'] ?? '')).not.toContain('immutable');
    expect(body.toString()).toBe('runtime-content');
  });
});
