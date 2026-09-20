export default {
    async fetch(request, env) {
        try {
            // 1. 获取环境变量
            const adminToken = (env.ADMIN_TOKEN || '').trim();
            const upstashUrl = (env.UPSTASH_REDIS_REST_URL || '').trim();
            const upstashToken = (env.UPSTASH_REDIS_REST_TOKEN || '').trim();

            const url = new URL(request.url);
            
            // 解码并标准化路径
            let path = url.pathname;
            try { path = decodeURIComponent(path); } catch (e) {}
            
            // 统一转小写，去除连续斜杠，去除末尾斜杠
            const cleanPath = path.toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '');
            const queryToken = (url.searchParams.get('token') || '').trim();

            // 2. 更加稳健的 API 路由判断（只要路径以 api/xxx 结尾或包含 api/xxx）
            const isListApi = cleanPath.endsWith('/api/list') || cleanPath.endsWith('/api/list/');
            const isSaveApi = cleanPath.endsWith('/api/save') || cleanPath.endsWith('/api/save/');
            const isDeleteApi = cleanPath.endsWith('/api/delete') || cleanPath.endsWith('/api/delete/');
            
            const isApi = isListApi || isSaveApi || isDeleteApi || cleanPath.includes('/api/');

            if (isApi) {
                // 环境变量配置检查
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

                // 3.1 获取列表接口
                if (isListApi) {
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

                // 3.2 保存接口
                if (isSaveApi) {
                    if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);
                    
                    let body = {};
                    try { body = await request.json(); } catch (e) { return jsonRes({ error: '无效的 JSON 请求体' }, 400); }
                    
                    const { key, content, readToken } = body;
                    if (!key) return jsonRes({ error: 'Key 不能为空' }, 400);

                    await upstashCommand(upstashUrl, upstashToken, 'SET', key, content || '');
                    await upstashCommand(upstashUrl, upstashToken, 'SET', `_meta:${key}`, JSON.stringify({ readToken: readToken || '' }));
                    return jsonRes({ success: true }, 200);
                }

                // 3.3 删除接口
                if (isDeleteApi) {
                    if (request.method !== 'POST') return jsonRes({ error: 'Method Not Allowed' }, 405);
                    
                    let body = {};
                    try { body = await request.json(); } catch (e) { return jsonRes({ error: '无效的 JSON 请求体' }, 400); }

                    const { key } = body;
                    if (!key) return jsonRes({ error: 'Key 不能为空' }, 400);

                    await upstashCommand(upstashUrl, upstashToken, 'DEL', key);
                    await upstashCommand(upstashUrl, upstashToken, 'DEL', `_meta:${key}`);
                    return jsonRes({ success: true }, 200);
                }

                return jsonRes({ error: `未找到对应 API 路由，当前匹配路径: ${cleanPath}` }, 404);
            }

            // 4. 静态资源回退机制
            if (env.ASSETS) {
                return env.ASSETS.fetch(request);
            }

            return new Response('Not Found', { status: 404 });

        } catch (error) {
            return jsonRes({ error: `服务器内部错误: ${error.message}` }, 500);
        }
    }
};

// 辅助函数：访问 Upstash
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

// 辅助函数：统一 JSON 返回
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
