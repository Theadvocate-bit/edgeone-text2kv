// EdgeOne Pages Functions 入口（Pages 格式，非 Workers 模块格式）
export async function onRequest(context) {
    const { request, env } = context;

    try {
        // 1. 环境变量（去首尾空格兜底）
        const adminToken = (env.ADMIN_TOKEN || '').trim();
        const upstashUrl = (env.UPSTASH_REDIS_REST_URL || '').trim();
        const upstashToken = (env.UPSTASH_REDIS_REST_TOKEN || '').trim();

        const url = new URL(request.url);

        // 2. 路径清洗（多重解码容错）
        let rawPath = url.pathname;
        try { rawPath = decodeURIComponent(rawPath); } catch (e) {}
        const cleanPath = rawPath.toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '');

        // 3. 路由：仅精确匹配 /api/* 段，避免误拦静态路径
        const apiMatch = cleanPath.match(/(?:^|\/)api\/(list|save|delete|get)$/);

        if (apiMatch) {
            const route = apiMatch[1];

            if (!upstashUrl || !upstashToken) {
                return jsonRes({ error: '服务端配置缺失：未配置 Upstash Redis 环境变量' }, 500);
            }

            // 3.0 公开读取接口 /api/get?key=xxx&readToken=yyy —— 无需 admin token
            if (route === 'get') {
                const key = (url.searchParams.get('key') || '').trim();
                if (!key || key.startsWith('_meta:')) {
                    return jsonRes({ error: 'Key 无效' }, 400);
                }

                const [content, meta] = await upstashPipeline(upstashUrl, upstashToken, [
                    ['GET', key],
                    ['GET', `_meta:${key}`]
                ]);

                if (content === null || content === undefined) {
                    return jsonRes({ error: 'Key 不存在' }, 404);
                }

                let requiredToken = '';
                if (meta) {
                    try { requiredToken = JSON.parse(meta).readToken || ''; } catch (e) {}
                }

                if (requiredToken) {
                    const provided = (url.searchParams.get('readToken') || '').trim();
                    if (provided !== requiredToken) {
                        return jsonRes({ error: '需要有效的读取 Token' }, 403);
                    }
                }

                return jsonRes({ key, content }, 200);
            }

            // —— 以下接口需要管理员鉴权 ——
            if (!adminToken) {
                return jsonRes({ error: '服务端配置缺失：未在 EdgeOne Pages 设置 ADMIN_TOKEN 环境变量' }, 500);
            }

            // Token 支持 Header（推荐）或 query 参数（兼容）
            const headerToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
            const queryToken = (url.searchParams.get('token') || '').trim();
            const providedToken = headerToken || queryToken;

            if (!providedToken || providedToken !== adminToken) {
                return jsonRes({ error: '鉴权失败：Token 无效或不匹配' }, 403);
            }

            // 3.1 列表接口 —— 用 pipeline 一次拿完所有 meta，避免 N+1 串行请求
            if (route === 'list') {
                const keys = await upstashCommand(upstashUrl, upstashToken, 'KEYS', '*');
                const cleanKeys = (keys || []).filter(k => !k.startsWith('_meta:'));

                if (cleanKeys.length === 0) return jsonRes([], 200);

                const metas = await upstashPipeline(
                    upstashUrl, upstashToken,
                    cleanKeys.map(k => ['GET', `_meta:${k}`])
                );

                const list = cleanKeys.map((key, i) => {
                    let readToken = '';
                    const meta = metas[i];
                    if (meta) {
                        try { readToken = JSON.parse(meta).readToken || ''; } catch (e) {}
                    }
                    return { key, readToken };
                });
                return jsonRes(list, 200);
            }

            // 3.2 保存接口
            if (route === 'save') {
                if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);

                let body = {};
                try { body = await request.json(); } catch (e) { return jsonRes({ error: '无效的 JSON 请求体' }, 400); }

                const { key, content, readToken } = body;
                const err = validateKey(key);
                if (err) return jsonRes({ error: err }, 400);

                await upstashPipeline(upstashUrl, upstashToken, [
                    ['SET', key, content || ''],
                    ['SET', `_meta:${key}`, JSON.stringify({ readToken: readToken || '' })]
                ]);
                return jsonRes({ success: true }, 200);
            }

            // 3.3 删除接口
            if (route === 'delete') {
                if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);

                let body = {};
                try { body = await request.json(); } catch (e) { return jsonRes({ error: '无效的 JSON 请求体' }, 400); }

                const err = validateKey(body.key);
                if (err) return jsonRes({ error: err }, 400);

                await upstashPipeline(upstashUrl, upstashToken, [
                    ['DEL', body.key],
                    ['DEL', `_meta:${body.key}`]
                ]);
                return jsonRes({ success: true }, 200);
            }
        }

        // 4. 非 API 请求：回退给 Pages 静态资源（context.next() 替代 env.ASSETS）
        return context.next();

    } catch (error) {
        // 内部细节只打日志，不透传给客户端
        console.error('Worker error:', error);
        return jsonRes({ error: '服务器内部错误' }, 500);
    }
}

// Key 合法性校验：拒绝 _meta: 前缀与危险字符
function validateKey(key) {
    if (!key || typeof key !== 'string') return 'Key 不能为空';
    if (key.startsWith('_meta:')) return 'Key 不允许使用 _meta: 前缀';
    if (!/^[\w.\-:/]{1,200}$/.test(key)) return 'Key 仅允许字母、数字、_ - . : /，最长 200 字符';
    return null;
}

// 单条 Upstash 命令
async function upstashCommand(upstashUrl, upstashToken, command, ...args) {
    const endpoint = `${upstashUrl.replace(/\/$/, '')}/${command}/${args.map(encodeURIComponent).join('/')}`;
    const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${upstashToken}` }
    });
    if (!res.ok) throw new Error(`Upstash error [${res.status}]`);
    const data = await res.json();
    return data.result;
}

// Upstash pipeline：一次 HTTP 请求执行多条命令，返回 result 数组
async function upstashPipeline(upstashUrl, upstashToken, commands) {
    const endpoint = `${upstashUrl.replace(/\/$/, '')}/pipeline`;
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${upstashToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(commands)
    });
    if (!res.ok) throw new Error(`Upstash pipeline error [${res.status}]`);
    const data = await res.json();
    return data.map(item => {
        if (item.error) throw new Error(`Upstash command error: ${item.error}`);
        return item.result;
    });
}

// 统一 JSON 返回
function jsonRes(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
