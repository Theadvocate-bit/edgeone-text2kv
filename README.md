# edgeone-text2kv

部署在 [EdgeOne Makers](https://cloud.tencent.com/document/product/1552/127365) 上的轻量 KV 存储工具，后端使用 [Upstash Redis](https://upstash.com/) REST API，前端提供完整的 Web 管理界面。

## 功能

- **Web 管理界面** — 登录、创建、编辑、删除、搜索 key-value
- **深色模式** — 跟随系统偏好，支持手动切换，自动持久化
- **访问链接** — 一键复制公开访问 URL，浏览器直接显示纯文本内容
- **内容加密** — 为 key 设置 readToken，访问时自动附加到链接
- **搜索过滤** — 按 key 或 content 实时搜索
- **复制功能** — 复制 key 名称或完整访问链接
- **字符统计** — 显示 content 字符数

## 项目结构

```
edgeone-text2kv/
├── edge-functions/              # EdgeOne Makers Edge Functions
│   └── api/
│       ├── list.js             # GET  /api/list    — 列出所有 key（需 admin token）
│       ├── save.js             # POST /api/save    — 保存 key-value（需 admin token）
│       ├── delete.js           # POST /api/delete  — 删除 key（需 admin token）
│       └── get.js              # GET  /api/get     — 公开读取（返回纯文本）
├── public/
│   └── index.html              # 管理界面（单文件，无外部依赖）
├── edgeone.json                # 构建配置
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

### Key 命名与存储格式

- **Key 合法字符**：仅允许**字母、数字、连字符、下划线**，最长 200 字符。不允许 `.`、`:`、`/`、空格、汉字、其他特殊字符，也不允许 `_meta:` 前缀。
- **KV 存储格式**：单条 Redis 记录，`key = filename:readToken`（无 readToken 时只用 `filename`），`value = content` 原文。不再使用 `_meta:` 双写。
- **示例**：
  - `filename = "my-key"`，无 readToken → KV: `my-key` → `"hello"`
  - `filename = "user_profile"`，readToken = `"secret"` → KV: `user_profile:secret` → `"weekly report"`

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
删除 key。需要 admin token。请求体中若该 key 设有 readToken，需要同时传入以定位准确的 KV 记录。

请求体：
```json
{
  "key": "my-key",
  "readToken": "optional-read-token"
}
```

### GET /api/get?key=xxx&readToken=yyy
公开读取接口。返回纯文本内容（`Content-Type: text/plain; charset=utf-8`），浏览器直接显示。

- 如果 key 未设置 readToken：直接访问 `/api/get?key=my-key`
- 如果 key 设置了 readToken：需要提供 `&readToken=yyy`
- 错误时返回 JSON（如 `{ "error": "Key 不存在" }`）

## 管理界面功能

### 登录
- 首次使用需设置 Admin Token（浏览器本地存储）
- 后续自动填充，无需重复输入

### 创建 Key
- 点击「新增」按钮，弹出表单
- 填写 key 名称和 content 内容
- 可选设置 readToken（加密读取权限）

### 编辑 Key
- 点击「编辑」按钮，弹出表单
- 修改 content 或 readToken
- 实时显示字符数统计

### 删除 Key
- 点击「删除」按钮
- 确认弹窗后删除

### 搜索
- 在搜索框输入关键词
- 按 key 或 content 实时过滤

### 复制
- 点击「复制」复制 key 名称
- 点击「链接」复制完整访问 URL（含 readToken 时自动附加）
- 访问链接打开后直接显示纯文本内容

### 深色模式
- 默认跟随系统偏好
- 右上角切换按钮手动切换
- 自动保存到浏览器本地存储
- 适配 Edge、Safari 等浏览器

## 迁移说明

本项目从 Cloudflare Pages 迁移至 EdgeOne Makers。主要变更：

1. **目录结构**：`functions/` → `edge-functions/`
2. **路由方式**：单文件 `[[path]].js` 兜底 → 文件即路由（每个 API 端点一个文件）
3. **静态资源**：`context.next()` 回退 → 平台优先路由静态资源（`edgeone.json` 指定 `outputDirectory: ./public`）
4. **配置文件**：无 → `edgeone.json`（指定构建输出目录）
5. **代码导出**：`export async function onRequest`（命名导出，EdgeOne Makers 标准）
6. **自包含路由**：Edge Functions 目录内所有 .js 文件均视为路由，无法引入共享模块，因此每个路由文件自包含所需工具函数

> 参考：[从 Cloudflare Pages 迁移至 EdgeOne Makers](https://cloud.tencent.com/document/product/1552/127455)
