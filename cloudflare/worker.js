/**
 * 洛克王国赛事推流控制台 · 云同步信箱 Worker（Cloudflare Workers + KV）
 *
 * 职责刻意做到最小：只做 KV 读写 + 密钥校验，没有业务逻辑、没有数据库、没有定时器。
 * 数据合并、波次推进、回执全部由两端软件在「点击」时完成（点击式同步方案）。
 *
 * 路由：
 *   GET    /health                 连通性自检（不需要密钥，供「检测 Worker 在线」按钮）
 *   GET    /room/:key/:box         读取信箱
 *   PUT    /room/:key/:box         写入信箱
 *   DELETE /room/:key/:box         清空信箱
 *
 *   :box ∈ { downlink, version, uplink/<机器码>, ack/<机器码> }
 *   :key = syncKey（房间密钥，两端必须一致；不是真正的安全边界，只是键名隔离 + 粗校验）
 *
 * 鉴权：写操作要求请求头 X-Sync-Key 与 URL 中的 :key 一致；读操作也校验同一请求头，
 * 避免拿到链接就能拉走整个赛事数据。
 *
 * 读取一律使用默认 60 秒的 KV 边缘缓存（Cloudflare 限制 cacheTtl 最小 60，填更小的值会被拒绝），
 * 因此「主控刚分发 → 分控立刻拉取」有最长约 60 秒的异地区间延迟。这是 KV 的一致性模型，
 * 不是 bug；界面用版本号 + 时间对比来提示，不要连点刷。
 */

/** 单值大小上限（Cloudflare KV 硬上限 25 MiB）：同步包不带头像时只有几十 KB */
const MAX_BODY_BYTES = 25 * 1024 * 1024;
/** 键名上限保护：syncKey 由使用者填写，防止拼出超长键 */
const MAX_KEY_LENGTH = 64;

const BOX_PATTERN = /^(downlink|version|uplink\/[A-Za-z0-9_-]{1,8}|ack\/[A-Za-z0-9_-]{1,8})$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(),
    },
  });
}

function fail(message, status) {
  return json({ success: false, error: message }, status);
}

/** 请求头里的密钥与 URL 中的房间密钥必须一致 */
function authorized(request, roomKey) {
  const header = request.headers.get('X-Sync-Key') || '';
  return Boolean(header) && header === roomKey;
}

async function readBox(env, kvKey) {
  const entry = await env.SYNC_KV.get(kvKey, 'json');
  if (!entry) {
    return json({ success: true, exists: false, modifiedAt: null, value: null });
  }
  return json({
    success: true,
    exists: true,
    modifiedAt: typeof entry.at === 'string' ? entry.at : null,
    value: entry.value === undefined ? null : entry.value,
  });
}

async function writeBox(request, env, kvKey) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return fail(`信箱内容超过 ${Math.floor(MAX_BODY_BYTES / 1024 / 1024)} MiB 上限`, 413);
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    // 只接受 JSON：方便两端直接存对象，也避免把二进制垃圾写进 KV
    return fail('请求体必须是 JSON', 400);
  }

  const at = new Date().toISOString();
  // 不加 expirationTtl：信箱内容要一直留着，直到下一次分发/回传覆盖
  await env.SYNC_KV.put(kvKey, JSON.stringify({ at, value }));
  return json({ success: true, modifiedAt: at });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 连通性自检：不需要密钥，也不碰 KV，避免为了测通而白扣读写额度
    if (url.pathname === '/health') {
      return json({ success: true, service: 'roco-pvp-cloud-sync', now: new Date().toISOString() });
    }

    const match = /^\/room\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!match) {
      return fail('未知的信箱地址（正确形态：/room/{syncKey}/{downlink|version|uplink/机器码|ack/机器码}）', 404);
    }

    let roomKey;
    try {
      roomKey = decodeURIComponent(match[1]);
    } catch {
      return fail('房间密钥编码不合法', 400);
    }
    const box = decodeURIComponent(match[2]);

    if (!roomKey || roomKey.length > MAX_KEY_LENGTH) {
      return fail(`房间密钥长度必须为 1-${MAX_KEY_LENGTH} 个字符`, 400);
    }
    if (!BOX_PATTERN.test(box)) {
      return fail('未知的信箱名（只支持 downlink / version / uplink/机器码 / ack/机器码）', 400);
    }
    if (!authorized(request, roomKey)) {
      return fail('房间密钥不匹配（X-Sync-Key 与地址中的 syncKey 必须一致）', 401);
    }

    const kvKey = `room:${roomKey}:${box}`;

    try {
      if (request.method === 'GET') {
        return await readBox(env, kvKey);
      }
      if (request.method === 'PUT') {
        return await writeBox(request, env, kvKey);
      }
      if (request.method === 'DELETE') {
        await env.SYNC_KV.delete(kvKey);
        return json({ success: true, deleted: true });
      }
      return fail(`不支持的请求方法：${request.method}`, 405);
    } catch (error) {
      // KV 故障/额度耗尽等：给两端一个可读的中文错误，界面上能直接显示
      return fail(`云端存储操作失败：${error && error.message ? error.message : String(error)}`, 502);
    }
  },
};
