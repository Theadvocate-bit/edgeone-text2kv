export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.toLowerCase();

      // 1. 如果不是 API 请求，放行给静态资源引擎 (public/index.html)
      if (!pathname.startsWith('/api')) {
        if (env.ASSETS) {
          return env.ASSETS.fetch(request);
        }
        return new Response("Not Found", { status: 404 });
      }

      // 2. 读取并校验环境变量
      const adminToken = (env.ADMIN_TOKEN || '').trim();
      const upstashUrl = (env.UPSTASH_REDIS_REST_URL || '').trim();
      const upstashToken = (env.UPSTASH_REDIS_REST_TOKEN || '').trim();

      if (!adminToken) {
        return jsonRes({ error: "配置错误：EdgeOne 环境变量中缺失 ADMIN_TOKEN" }, 500);
      }

      // 3. 鉴权校验：通过 Query 参数 ?token=xxx 或 Header Bearer 传入
      const queryToken = (url.searchParams.get('token') || '').trim();
      const authHeader = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
      const clientToken = queryToken || authHeader;

      if (!clientToken || clientToken !== adminToken) {
        return jsonRes({ error: "鉴权失败：Token 无效或未提供" }, 403);
      }

      if (!upstashUrl || !upstashToken) {
        return jsonRes({ error: "配置错误：EdgeOne 环境变量中缺失 UPSTASH 配置" }, 500);
      }

      // 4. API 路由调度
      // 4.1 获取所有 Key 列表 [/api/list]
      if (pathname === '/api/list' || pathname === '/api/list/') {
        const keys = await upstash(upstashUrl, upstashToken, 'KEYS', '*');
        const cleanKeys = (keys || []).filter(k => !k.startsWith('_meta:'));

        const result = [];
        for (const key of cleanKeys) {
          const meta = await upstash(upstashUrl, upstashToken, 'GET', `_meta:${key}`);
          let readToken = '';
          if (meta) {
            try { readToken = JSON.parse(meta).readToken || ''; } catch (e) {}
          }
          result.push({ key, readToken });
        }
        return jsonRes(result, 200);
      }

      // 4.2 保存数据 [/api/save]
      if (pathname === '/api/save' || pathname === '/api/save/') {
        if (request.method !== 'POST') return jsonRes({ error: "Method Not Allowed" }, 405);
        
        const body = await request.json().catch(() => null);
        if (!body || !body.key) return jsonRes({ error: "请求体非法或缺少 key" }, 400);

        const { key, content, readToken } = body;
        await upstash(upstashUrl, upstashToken, 'SET', key, content || '');
        await upstash(upstashUrl, upstashToken, 'SET', `_meta:${key}`, JSON.stringify({ readToken: readToken || '' }));

        return jsonRes({ success: true, message: "保存成功" }, 200);
      }

      // 4.3 删除数据 [/api/delete]
      if (pathname === '/api/delete' || pathname === '/api/delete/') {
        if (request.method !== 'POST') return jsonRes({ error: "Method Not Allowed" }, 405);

        const body = await request.json().catch(() => null);
        if (!body || !body.key) return jsonRes({ error: "请求体非法或缺少 key" }, 400);

        const { key } = body;
        await upstash(upstashUrl, upstashToken, 'DEL', key);
        await upstash(upstashUrl, upstashToken, 'DEL', `_meta:${key}`);

        return jsonRes({ success: true, message: "删除成功" }, 200);
      }

      // 如果匹配到了 /api/ 但不是上述任何一个路径
      return jsonRes({ error: `未找到该 API 路由: ${pathname}` }, 404);

    } catch (err) {
      return jsonRes({ error: `服务器内部异常: ${err.message}` }, 500);
    }
  }
};

// 辅助方法：封装 Upstash REST 请求
async function upstash(baseUrl, token, command, ...args) {
  const url = `${baseUrl.replace(/\/$/, '')}/${command}/${args.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash 请求失败 [${res.status}]: ${text}`);
  }
  
  const data = await res.json();
  return data.result;
}

// 辅助方法：格式化 JSON 响应
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
