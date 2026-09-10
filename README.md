# dsh-kefu — DSH 多租户客服平台

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 套一层**多租户客服平台壳**：
一台服务器集中管理多个商家，每个商家用独立账号登录，创建自己的「店员 Agent」
（可选模型服务档位，档位细节由平台屏蔽），通过控制台或**网页问答组件**接待顾客。

> 典型场景：淘宝智能客服 SaaS。平台方开账号 → 商家登录创建客服 Agent → 顾客在店铺网页上咨询。

```
┌──────────────────────────────────────────────────────────────┐
│  商家电脑：KefuClient（Tauri 桌面壳）→ 打开 {服务器}/kefu/       │
│  顾客浏览器：店铺网页 iframe 引入 {服务器}/kefu/widget/<token>   │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼───────────────────────────────────┐
│  服务器：dsh web（DeepSeek Harness Web 实例）                   │
│    └── 插件 dsh-kefu（本仓库 server/）                          │
│         ├── SQLite：商家 / 账号 / 档位 / Agent / 会话 / 消息      │
│         ├── 账号体系：scrypt 密码 + 会话 Cookie，登录锁定          │
│         ├── RBAC：平台超管 / 商家管理员 / 店员                    │
│         ├── 限流：每账号 / 每 IP 滑动窗口                         │
│         ├── 店员 Agent：复用 DSH 的 ctx.agents 会话引擎           │
│         │     （模型档位 → provider/model，人设注入 system prompt，│
│         │      多轮会话持久化，SSE 流式回复）                      │
│         └── 商家控制台前端（React SPA，由插件静态托管）             │
└──────────────────────────────────────────────────────────────┘
```

## 目录

| 目录 | 说明 |
|---|---|
| `server/` | **DSH 插件** `dsh-kefu`（核心交付，挂到 web profile） |
| `console/` | 商家控制台前端源码（React + Vite，构建产物进 `server/public/`） |
| `client/` | 桌面客户端（Tauri 2 壳子，连接服务器地址） |
| `docs/` | 详细文档（API 一览、部署、二次开发） |

## 快速部署（服务器）

前置：Node 22.5+ / pnpm（数据层使用 `node:sqlite`，Node 18/20 不可用）、DeepSeek Harness（`npm i -g @deepseek-ai/dsh`）、一个模型 API Key。

```bash
# 1. 构建控制台前端（产物写入 server/public/）
cd console && npm install && npm run build && cd ..

# 2. 安装插件到 web profile（两种方式任选）
dsh plugin --profile web add /path/to/kefu/server          # 本地目录
dsh plugin --profile web add dsh-kefu                      # 发布到 npm 后

# 3. 编辑 profile 的 package.json，把 dsh-kefu 加进 bundles 列表
#    "dsh": { "profile": { "bundles": [..., "dsh-kefu"] } }

# 4. 启动（对局域网开放用 0.0.0.0）
DEEPSEEK_API_KEY=sk-xxx dsh web --host 0.0.0.0 --port 3080
```

启动后：

- 客服平台：`http://<服务器>:3080/kefu/`（首次注册商家账号）
- 平台超管：默认账号 `admin`，密码在启动日志里打印（`[kefu] 已创建平台超管`），首次登录后请修改
- 服务档位：默认创建「高级客服 / 中级客服 / 基础客服」三档（映射到 DeepSeek 模型），
  超管可在「平台管理 → 服务档位」调整或新增（provider/model 对商家不可见）

> 对外暴露端口时建议在前面加一层反向代理（HTTPS），并把
> `dsh web --trusted-host` 加上你的域名（远程浏览器设置功能需要）。
>
> 推荐的插件配置：
> - HTTPS 部署时设置 `secureCookie: true`，为会话 Cookie 增加 `Secure` 标志；
> - 只有请求确实经过可信反向代理时才设置 `trustProxy: true`，此时按 `X-Forwarded-For` 最右侧地址做 IP 限流；
> - 默认 `exposeSessionToken: false`，登录只下发 HttpOnly Cookie；仅当外部客户端必须使用 Bearer 时才显式开启。

## 核心能力

### 多租户与数据隔离
- 商家（merchant）是隔离单元；账号、Agent、会话、消息全部按 `merchant_id` 隔离
- 每个商家有独立工作区目录 `dataDir/merchants/<id>/`，Agent 的 DSH 会话 `cwd` 指向它
- 越权访问（跨商家读会话 / 改 Agent）一律 404

### 账号与权限
| 角色 | 能力 |
|---|---|
| `superadmin` | 平台管理：商家 / 账号 / 档位 / 平台设置 / 审计 |
| `merchant_admin` | 商家管理员：建店员账号、建/改/停 Agent、网页客服凭据、接待 |
| `merchant_staff` | 店员：仅接待会话 |
- 密码 scrypt 存储；登录连续失败 5 次锁定 15 分钟；会话 12 小时（默认仅 HttpOnly Cookie，`exposeSessionToken: true` 时额外支持 Bearer）

### 店员 Agent
- 商家创建 Agent：名称、人设话术、**服务档位**（商家只看到档位名，如「高级客服」，看不到 provider/model）
- 每轮对话由插件通过 `ctx.agents.create/resume` 驱动 DSH 会话：
  - 档位 → `{provider, model, maxTokens}` 注入 AgentOptions
  - 人设注入 system prompt（并遮蔽 Harness 的通用身份/运行时上下文，**禁用全部工具**，保持纯客服行为）
  - 多轮上下文由 DSH 会话持久化自动续接
- 回复通过 SSE 流式返回（`delta` 事件含文本与思考过程；`done` 含最终文本与 token 用量）

### 知识库（RAG v1）
- 商家在「知识库」录入商品资料 / 售后政策 / 常见问答（可指定某 Agent 专用或全店共享）
- 顾客提问时自动检索（FTS5 trigram 整句匹配 + 2 字关键词 LIKE 回退，中文口语友好），
  把命中的资料作为权威依据注入客服 system prompt，回答优先照实引用资料、不编造

### 客服网页问答（v1 可用 + v2 悬浮球 SDK）
- 商家在「店员管理 → 网页客服」生成凭据 token，拿到三种接入方式：
  1. **独立问答页** `{base}/widget/<token>`：可发链接，可 iframe 嵌入店铺网页
  2. **悬浮球 SDK**（推荐）：店铺页面加一行 `<script src="{server}/kefu/kefu-sdk.js" data-token="…">`，
     右下角气泡聊天面板，自动续接会话（演示页 `{base}/sdk-demo.html?token=…`）
  3. 公开接口（免登录、按 IP + token 双限流）：
     - `GET  {base}/widget/<token>/config` — 商家名 / 客服名 / 欢迎语
     - `POST {base}/widget/<token>/messages` — 聊天（按 visitorId 续接同一会话）
- **规划**：知识库向量化（语义检索）、转人工、订单查询工具

### 限流
- 登录：10 次/分钟/IP；注册：按 IP；聊天：30 次/分钟/账号 + 60 次/分钟/IP；网页客服：10 次/分钟/凭据
- 超管可在「平台设置」改数值，即时生效（内存滑动窗口）

## API 一览（前缀 `{base}/api`，默认 `/kefu/api`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册商家（可后台关闭） |
| POST | `/auth/login` / `/auth/logout` | 登录 / 退出 |
| GET | `/auth/me` | 当前用户 + 商家 + 档位 |
| GET | `/tiers` | 服务档位（仅公开字段） |
| GET/POST | `/agents` | 店员 Agent 列表 / 新建 |
| PATCH/DELETE | `/agents/:id` | 改 / 删 Agent |
| GET/POST | `/agents/:id/widget-tokens` | 网页客服凭据 |
| GET/POST | `/conversations` | 会话列表 / 新建 |
| GET/POST | `/conversations/:id/messages` | 历史 / 发消息（SSE 流式） |
| PATCH | `/conversations/:id` | 关闭 / 重开 / 改标题 |
| GET/POST | `/users` | 商家账号（merchant_admin） |
| GET/POST | `/kb` `/kb/:id` | 知识库（商家管理员） |
| GET | `/stats` | 商家统计 |
| GET/POST | `/admin/merchants` `/admin/users` `/admin/tiers` | 平台管理 |
| GET/PATCH | `/admin/settings` | 平台设置（注册开关 / 限流） |
| GET | `/admin/stats` | 平台统计 + 审计 |
| GET/POST | `/widget/:token/config` `/widget/:token/messages` | 网页问答公开接口 |

错误统一 `{error: {code, message}}`；429 限流、401 未登录、403 无权限、404 不存在/越权。

## 开发与测试

```bash
# 控制台开发（vite 代理到 3080 的 dsh web）
cd console && npm run dev

# 插件 API + Agent 工具隔离测试（不需要模型 API Key）
cd server && pnpm install && pnpm test

# 用独立 DSH_HOME 起一个测试实例（不动正式实例）
DSH_HOME=~/.dsh-kefu dsh --profile web --host 127.0.0.1 --port 3100

# 数据目录
$DSH_HOME/kefu/kefu.sqlite          # 全部业务数据
$DSH_HOME/kefu/merchants/<id>/      # 商家工作区
```

## 安全注意
- 上线必须 HTTPS（反向代理），并设置 `secureCookie: true`，否则密码/会话 Cookie 会被嗅探
- 只有经过可信反向代理时才设置 `trustProxy: true`；否则保留默认值，直接按 TCP 对端地址限流
- 建议关闭自助注册（平台设置），由超管统一开账号
- 客服 Agent 通过 `tools.restrict({ allow: [] })` 白名单禁用全部工具；若目标 DSH 不支持该能力，接待会 fail-closed（直接失败），不会带着工具继续运行。升级 DSH 后请跑工具可见性冒烟测试
- 定期备份 `kefu.sqlite` 与 `merchants/` 目录

## License
MIT
