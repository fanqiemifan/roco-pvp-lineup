/**
 * 洛克王国赛事推流控制台 · 云同步信箱 Worker（Cloudflare Workers + KV）
 *
 * 职责刻意做到最小：只做 KV 读写 + 鉴权，没有业务逻辑、没有数据库、没有定时器。
 * 数据合并、波次推进、回执全部由两端软件在「点击」时完成（点击式同步方案）。
 *
 * 路由：
 *   GET    /health            连通性自检（不需要令牌，供「检测 Worker 在线」按钮）
 *   GET    /room/:box         读取信箱
 *   PUT    /room/:box         写入信箱
 *   DELETE /room/:box         清空信箱
 *
 *   :box ∈ { downlink, version, uplink/<机器码>, ack/<机器码> }
 *
 * 鉴权（两把钥匙，都不出现在 URL 里）：
 *   X-Sync-Key    房间密钥：决定键空间隔离（room:{key}:{box}），两端必须一致
 *   X-Sync-Token  访问令牌：真正的大门，由运营者用 `wrangler secret put SYNC_TOKEN` 配置。
 *                 没配令牌时所有 /room 请求直接 503（fail closed），避免部署完忘记设密钥
 *                 就成了公开可写的 KV。令牌只存在 Cloudflare 与本机 runtime/config.json 里。
 *
 * 读取一律使用默认 60 秒的 KV 边缘缓存（Cloudflare 限制 cacheTtl 最小 60，填更小的值会被拒绝），
 * 因此「主控刚分发 → 分控立刻拉取」有最长约 60 秒的异地区间延迟。这是 KV 的一致性模型，
 * 不是 bug；界面用版本号 + 时间对比来提示，不要连点刷。
 */

/** 单值大小上限（Cloudflare KV 硬上限 25 MiB）：同步包不带头像时只有几十 KB */
const MAX_BODY_BYTES = 25 * 1024 * 1024;
/** 键名上限保护：syncKey 由使用者填写，防止拼出超长键 */
const MAX_KEY_LENGTH = 64;
const MAX_TOKEN_LENGTH = 128;

const BOX_PATTERN = /^(downlink|version|uplink\/[A-Za-z0-9_-]{1,8}|ack\/[A-Za-z0-9_-]{1,8})$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Key,X-Sync-Token',
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

/** 恒定时间比较，避免逐字符比较泄漏令牌长度/前缀信息 */
function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * 鉴权：令牌必须在 Worker 侧配置过才算通过（fail closed）。
 * 返回 null 表示通过，否则返回错误响应。
 */
function authorize(request, env) {
  const expectedToken = typeof env.SYNC_TOKEN === 'string' ? env.SYNC_TOKEN : '';
  if (!expectedToken) {
    return fail(
      '本 Worker 未配置访问令牌（SYNC_TOKEN）：请在 cloudflare 目录执行 npx wrangler secret put SYNC_TOKEN 设置后再使用',
      503,
    );
  }

  const token = request.headers.get('X-Sync-Token') || '';
  if (!token) {
    return fail('缺少访问令牌（请在本机「云同步设置区」填写访问令牌）', 401);
  }
  if (token.length > MAX_TOKEN_LENGTH || !safeEquals(token, expectedToken)) {
    return fail('访问令牌不正确（两端必须填写同一个令牌）', 401);
  }

  const roomKey = request.headers.get('X-Sync-Key') || '';
  if (!roomKey) {
    return fail('缺少房间密钥（请在本机「云同步设置区」填写 syncKey）', 401);
  }
  if (roomKey.length > MAX_KEY_LENGTH) {
    return fail(`房间密钥长度不能超过 ${MAX_KEY_LENGTH} 个字符`, 400);
  }

  return null;
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

    // 连通性自检：不需要令牌、也不碰 KV，避免为了测通而白扣读写额度；
    // 顺带告诉两端「令牌有没有配置 / 要不要填令牌」。
    if (url.pathname === '/health') {
      return json({
        success: true,
        service: 'roco-pvp-cloud-sync',
        now: new Date().toISOString(),
        tokenRequired: true,
        tokenConfigured: Boolean(env.SYNC_TOKEN),
      });
    }

    const match = /^\/room\/(.+)$/.exec(url.pathname);
    if (!match) {
      return fail('未知的信箱地址（正确形态：/room/{downlink|version|uplink/机器码|ack/机器码}）', 404);
    }

    let box;
    try {
      box = decodeURIComponent(match[1]);
    } catch {
      return fail('信箱名编码不合法', 400);
    }
    if (!BOX_PATTERN.test(box)) {
      return fail('未知的信箱名（只支持 downlink / version / uplink/机器码 / ack/机器码）', 400);
    }

    const denied = authorize(request, env);
    if (denied) {
      return denied;
    }

    const roomKey = request.headers.get('X-Sync-Key');
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
