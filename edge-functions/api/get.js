// EdgeOne Makers Edge Function — GET /api/get?key=xxx&readToken=yyy
// 公开读取接口：无需 admin token，通过 readToken 鉴权
// KV 存储格式：filename:readToken → content（无 readToken 时只用 filename）
// 自包含：Edge Functions 目录内所有 .js 文件均视为路由，无法引入共享模块

// ====== Helpers ======
const env = (e) => ({
  u: (e.UPSTASH_REDIS_REST_URL || '').trim(),
  t: (e.UPSTASH_REDIS_REST_TOKEN || '').trim(),
});

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });

// Plain text response — for direct access links (/api/get?key=...)
const text = (body, s = 200) =>
  new Response(body, {
    status: s,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });

async function pipe(url, token, cmds) {
  const ep = `${url.replace(/\/$/, '')}/pipeline`;
  const r = await fetch(ep, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Upstash pipeline error [${r.status}]`);
  return (await r.json()).map((i) => {
    if (i.error) throw new Error(`Upstash command error: ${i.error}`);
    return i.result;
  });
}

// ====== Handler ======
export async function onRequest(context) {
  const { request, env: e } = context;
  try {
    if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

    const { u, t } = env(e);
    if (!u || !t) return json({ error: '服务端配置缺失：未配置 Upstash Redis 环境变量' }, 500);

    const url = new URL(request.url);
    const key = (url.searchParams.get('key') || '').trim();
    if (!key || key.startsWith('_meta:')) return json({ error: 'Key 无效' }, 400);
    // key 参数必须与 filename 格式一致；readToken 通过独立参数传递
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(key))
      return json({ error: 'Key 无效：仅允许字母、数字、连字符、下划线' }, 400);

    const readToken = (url.searchParams.get('readToken') || '').trim();
    const fullKey = readToken ? key + ':' + readToken : key;

    const [content] = await pipe(u, t, [
      ['GET', fullKey],
    ]);

    if (content === null || content === undefined) return json({ error: 'Key 不存在' }, 404);

    // Plain text response — access links show content directly in browser
    return text(content, 200);
  } catch (err) {
    console.error('Worker error:', err);
    return json({ error: '服务器内部错误' }, 500);
  }
}
