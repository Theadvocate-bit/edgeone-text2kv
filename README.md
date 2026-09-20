# edgeone-text2kv

一个部署在 [EdgeOne Makers](https://cloud.tencent.com/document/product/1552/127365) 上的轻量 KV 存储工具，后端使用 [Upstash Redis](https://upstash.com/) REST API。

## 项目结构

```
edgeone-text2kv/
├── edge-functions/          # EdgeOne Makers Edge Functions
│   └── api/
│       ├── list.js         # GET  /api/list      — 列出所有 key（需 admin token）
│       ├── save.js         # POST /api/save      — 保存 key-value（需 admin token）
│       ├── delete.js       # POST /api/delete    — 删除 key（需 admin token）
│       └── get.js          # GET  /api/get       — 公开读取（需 readToken）
├── public/
│   └── index.html          # 管理界面（静态资源，由平台直接路由）
├── edgeone.json            # 构建配置
└── README.md
```

## 与 Cloudflare Pages 的差异

| 项 | Cloudflare Pages | EdgeOne Makers |
|---|---|---|
| 函数目录 | `functions/` | `edge-functions/` |
| 路由 | `[[path]].js` 单文件兜底 | 文件即路由（`list.js`, `save.js`...） |
| 静态回退 | `context.next()` | 平台优先路由静态资源，无需回退 |
| 配置文件 | `_redirects` / `_headers` | `edgeone.json` |
| 导出 | `export function onRequest` | `export async function onRequest` |

## 部署

1. 在 EdgeOne Makers 控制台创建项目，关联本 GitHub 仓库
2. 构建配置：
   - 根目录：`./`
   - 构建命令：留空（无构建步骤）
   - 输出目录：`./public`（已在 `edgeone.json` 中指定）
3. 环境变量：
   - `ADMIN_TOKEN` — 管理界面鉴权 Token
   - `UPSTASH_REDIS_REST_URL` — Upstash Redis REST URL
   - `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis REST Token
4. 部署后访问预览链接，输入 `ADMIN_TOKEN` 即可使用管理界面

## API 说明

### GET /api/list?token=xxx
列出所有 key 及其 readToken。需要 admin token。

### POST /api/save
保存 key-value。需要 admin token。

请求体：
```json
{
  "key": "my-key",
  "content": "my-value",
  "readToken": "optional-read-token"
}
```

### POST /api/delete
删除 key。需要 admin token。

请求体：
```json
{
  "key": "my-key"
}
```

### GET /api/get?key=xxx&readToken=yyy
公开读取接口。如果 key 设置了 readToken，需要提供；否则无需 token。

## 迁移说明

本项目从 Cloudflare Pages 迁移至 EdgeOne Makers。主要变更：

1. **目录结构**：`functions/` → `edge-functions/`
2. **路由方式**：单文件 `[[path]].js` 兜底 → 文件即路由（每个 API 端点一个文件）
3. **静态资源**：`context.next()` 回退 → 平台优先路由静态资源（`edgeone.json` 指定 `outputDirectory: ./public`）
4. **配置文件**：无 → `edgeone.json`（指定构建输出目录）
5. **代码导出**：`export async function onRequest`（命名导出，EdgeOne Makers 标准）
6. **自包含路由**：Edge Functions 目录内所有 .js 文件均视为路由，无法引入共享模块，因此每个路由文件自包含所需工具函数

> 参考：[从 Cloudflare Pages 迁移至 EdgeOne Makers](https://cloud.tencent.com/document/product/1552/127455)
