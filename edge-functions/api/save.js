// EdgeOne Makers Edge Function — POST /api/save
// 保存 key-value 及可选 readToken（需 admin token）
// 自包含：Edge Functions 目录内所有 .js 文件均视为路由，无法引入共享模块

// ====== Helpers ======
const env = (e) => ({
  a: (e.ADMIN_TOKEN || '').trim(),
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

const auth = (req, url) => {
  const h = (req.headers.get('Authorization') || '').replace(
    /^Bearer\s+/i,
    ''
  ).trim();
  return h || (url.searchParams.get('token') || '').trim();
};

const validate = (k) => {
  if (!k || typeof k !== 'string') return 'Key 不能为空';
  if (k.startsWith('_meta:')) return 'Key 不允许使用 _meta: 前缀';
  if (!/^[\w.\-:/]{1,200}$/.test(k))
    return 'Key 仅允许字母、数字、_ - . : /，最长 200 字符';
  return null;
};

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
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

    const { a, u, t } = env(e);
    const url = new URL(request.url);

    if (!u || !t) return json({ error: '服务端配置缺失：未配置 Upstash Redis 环境变量' }, 500);
    if (!a) return json({ error: '服务端配置缺失：未在 EdgeOne Makers 设置 ADMIN_TOKEN 环境变量' }, 500);

    const provided = auth(request, url);
    if (!provided || provided !== a) return json({ error: '鉴权失败：Token 无效或不匹配' }, 403);

    let body = {};
    try { body = await request.json(); } catch { return json({ error: '无效的 JSON 请求体' }, 400); }

    const { key, content, readToken } = body;
    const err = validate(key);
    if (err) return json({ error: err }, 400);

    await pipe(u, t, [
      ['SET', key, content || ''],
      ['SET', `_meta:${key}`, JSON.stringify({ readToken: readToken || '' })],
    ]);
    return json({ success: true }, 200);
  } catch (err) {
    console.error('Worker error:', err);
    return json({ error: '服务器内部错误' }, 500);
  }
}
