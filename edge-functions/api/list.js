// EdgeOne Makers Edge Function — GET /api/list
// 列出所有 key 及其 readToken（需 admin token）
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

async function cmd(url, token, c, ...a) {
  const ep = `${url.replace(/\/$/, '')}/${c}/${a
    .map(encodeURIComponent)
    .join('/')}`;
  const r = await fetch(ep, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Upstash error [${r.status}]`);
  return (await r.json()).result;
}

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
    const { a, u, t } = env(e);
    const url = new URL(request.url);

    if (!u || !t) return json({ error: '服务端配置缺失：未配置 Upstash Redis 环境变量' }, 500);
    if (!a) return json({ error: '服务端配置缺失：未在 EdgeOne Makers 设置 ADMIN_TOKEN 环境变量' }, 500);

    const provided = auth(request, url);
    if (!provided || provided !== a) return json({ error: '鉴权失败：Token 无效或不匹配' }, 403);

    const keys = await cmd(u, t, 'KEYS', '*');
    const cleanKeys = (keys || []).filter((k) => !k.startsWith('_meta:'));
    if (cleanKeys.length === 0) return json([], 200);

    const metas = await pipe(u, t, cleanKeys.map((k) => ['GET', `_meta:${k}`]));
    const list = cleanKeys.map((key, i) => {
      let readToken = '';
      try { readToken = JSON.parse(metas[i]).readToken || ''; } catch {}
      return { key, readToken };
    });
    return json(list, 200);
  } catch (err) {
    console.error('Worker error:', err);
    return json({ error: '服务器内部错误' }, 500);
  }
}
