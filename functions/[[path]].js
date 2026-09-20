/**
 * EdgeOne Pages Functions 入口文件
 * 文件路径: functions/[[path]].js
 */

export async function onRequest(context) {
    const { request, env } = context;

    try {
        // 1. 获取并清洗环境变量
        const adminToken = (env.ADMIN_TOKEN || '').trim();
        const upstashUrl = (env.UPSTASH_REDIS_REST_URL || '').trim();
        const upstashToken = (env.UPSTASH_REDIS_REST_TOKEN || '').trim();

        const url = new URL(request.url);

        // 2. 路径清洗与统一处理
        let rawPath = url.pathname;
        try { rawPath = decodeURIComponent(rawPath); } catch (e) {}

        const cleanPath = rawPath.toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '');
        const queryToken = (url.searchParams.get('token') || '').trim();

        // 3. 判断是否为 API 请求
        const isApi = cleanPath.includes('/api/') || cleanPath.startsWith('/api') || cleanPath === '/api';

        if (isApi) {
            // 环境变量校验
            if (!adminToken) {
                return jsonRes({ error: '服务端配置缺失：未在 EdgeOne Pages 设置 ADMIN_TOKEN 环境变量' }, 500);
            }

            // 鉴权校验
            if (!queryToken || queryToken !== adminToken) {
                return jsonRes({ error: '鉴权失败：Token 无效或不匹配' }, 403);
            }

            if (!upstashUrl || !upstashToken) {
                return jsonRes({ error: '服务端配置缺失：未配置 Upstash Redis 环境变量' }, 500);
            }

            // 路由划分
            // 3.1 获取列表接口 (/api/list)
            if (cleanPath.endsWith('/api/list')) {
                const keys = await upstashCommand(upstashUrl, upstashToken, 'KEYS', '*');
                const cleanKeys = (keys || []).filter(k => !k.startsWith('_meta:'));

                const list = [];
                for (const key of cleanKeys) {
                    const meta = await upstashCommand(upstashUrl, upstashToken, 'GET', `_meta:${key}`);
                    let readToken = '';
                    if (meta) {
                        try { readToken = JSON.parse(meta).readToken || ''; } catch (e) {}
                    }
                    list.push({ key, readToken });
                }
                return jsonRes(list, 200);
            }

            // 3.2 保存接口 (/api/save)
            if (cleanPath.endsWith('/api/save')) {
                if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);

                let body = {};
                try { body = await request.json(); } catch (e) { return jsonRes({ error: '无效的 JSON 请求体' }, 400); }

                const { key, content, readToken } = body;
                if (!key) return jsonRes({ error: 'Key 不能为空' }, 400);

                await upstashCommand(upstashUrl, upstashToken, 'SET', key, content || '');
                await upstashCommand(upstashUrl, upstashToken, 'SET', `_meta:${key}`, JSON.stringify({ readToken: readToken || '' }));
                return jsonRes({ success: true }, 200);
            }

            // 3.3 删除接口 (/api/delete)
            if (cleanPath.endsWith('/api/delete')) {
                if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);

                let body = {};
                try { body = await request.json(); } catch (e) { return jsonRes({ error: '无效的 JSON 请求体' }, 400); }

                const { key } = body;
                if (!key) return jsonRes({ error: 'Key 不能为空' }, 400);

                await upstashCommand(upstashUrl, upstashToken, 'DEL', key);
                await upstashCommand(upstashUrl, upstashToken, 'DEL', `_meta:${key}`);
                return jsonRes({ success: true }, 200);
            }

            return jsonRes({ error: '未找到对应 API 路由' }, 404);
        }

        // 4. 非 API 请求：静态资源放行机制 (交由 public/ 托管)
        if (env.ASSETS) {
            return env.ASSETS.fetch(request);
        }
        return fetch(request);

    } catch (error) {
        return jsonRes({ error: `服务器内部错误: ${error.message}` }, 500);
    }
}

// 辅助函数：访问 Upstash Redis API
async function upstashCommand(upstashUrl, upstashToken, command, ...args) {
    const endpoint = `${upstashUrl.replace(/\/$/, '')}/${command}/${args.map(encodeURIComponent).join('/')}`;
    const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${upstashToken}` }
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Upstash 通信失败 [${res.status}]: ${errText}`);
    }
    const data = await res.json();
    return data.result;
}

// 辅助函数：统一 JSON 格式化响应
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
