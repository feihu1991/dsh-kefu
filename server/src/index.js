// dsh-kefu — DSH 多租户客服平台插件入口（cordis plugin，挂到 web profile）
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { join, dirname, extname, isAbsolute, normalize, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { KefuStore } from "./db.js";
import { hashPassword, ROLES } from "./auth.js";
import { createLimiters } from "./ratelimit.js";
import { createApiHandler, sendJson } from "./api.js";

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(PLUGIN_DIR, "..", "public");

const name = "dsh-kefu";

const inject = ["webServer", "agents"];

const Config = z.object({
  basePath: z.string().default("/kefu"),
  /** 数据目录（商家工作区 + sqlite）；留空则用 $DSH_HOME/kefu */
  dataDir: z.string().default(""),
  /** 是否开放商家自助注册 */
  allowRegistration: z.boolean().default(true),
  /** 是否信任上游反向代理的 X-Forwarded-For（默认关闭；开启时取最右侧地址） */
  trustProxy: z.boolean().default(false),
  /** HTTPS 部署时应设为 true，为会话 Cookie 增加 Secure 标志 */
  secureCookie: z.boolean().default(false),
  /** 是否在登录响应中返回 Bearer token（默认关闭，仅使用 HttpOnly Cookie） */
  exposeSessionToken: z.boolean().default(false),
  /** 客服回合超时（毫秒） */
  agentTimeoutMs: z.natural().default(5 * 60 * 1000),
  /** 默认档位（当 Agent 未选档位时） */
  defaultTier: z.object({
    provider: z.string().default("deepseek-official"),
    model: z.string().default("deepseek-v4-flash"),
  }).default({}),
  /** 首个超管账号（密码留空则随机生成并打印） */
  seedAdmin: z.object({
    username: z.string().default("admin"),
    password: z.string().default(""),
  }).default({}),
  rateLimit: z.object({
    perMinute: z.natural().default(30),
    burst: z.natural().default(60),
    authPerMinute: z.natural().default(10),
    authBurst: z.natural().default(20),
    widgetPerMinute: z.natural().default(10),
    widgetBurst: z.natural().default(20),
    ipPerMinute: z.natural().default(60),
    ipBurst: z.natural().default(120),
  }).default({}),
});

function apply(ctx, config) {
  const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
  const dataDir = config.dataDir ? resolve(config.dataDir) : join(dshHome, "kefu");
  const dbPath = join(dataDir, "kefu.sqlite");
  const statePath = join(dataDir, "kefu-state.json");
  const basePath = normalize(config.basePath || "/kefu").replace(/\/+$/, "");

  const store = new KefuStore(dbPath);
  const state = loadState(statePath, { allowRegistration: config.allowRegistration });
  state.platform.rateLimit = sanitizeRateLimit(state.platform.rateLimit);

  function saveState() {
    // 原子写入：先写临时文件再 rename，避免崩溃/并发导致状态文件损坏。
    const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify({ platform: state.platform }, null, 2), { mode: 0o600 });
    renameSync(tmpPath, statePath);
  }

  // 管理端改限流设置后即时生效
  function rebuildLimiters() {
    const next = createLimiters({ rateLimit: sanitizeRateLimit(state.platform.rateLimit) });
    limits.chat = next.chat;
    limits.auth = next.auth;
    limits.widget = next.widget;
    limits.ip = next.ip;
  }

  // 暴露给 api.js 中的管理接口使用。
  state.save = saveState;
  state.rebuildLimiters = rebuildLimiters;

  const limits = createLimiters({ rateLimit: sanitizeRateLimit(state.platform.rateLimit) });

  // ---- 种子：默认档位 ----
  if (store.listTiers().length === 0) {
    store.createTier({ name: "高级客服", description: "旗舰模型，复杂问题与高价值客户", provider: "deepseek-official", model: "deepseek-v4-pro", maxTokens: 8192 });
    store.createTier({ name: "中级客服", description: "主力模型，日常接待", provider: "deepseek-official", model: "deepseek-v4-flash", maxTokens: 8192 });
    store.createTier({ name: "基础客服", description: "经济模型，高频简单问答", provider: "deepseek-official", model: "deepseek-v4-flash", maxTokens: 4096 });
    ctx.logger?.info?.("[kefu] 已初始化默认服务档位（高级/中级/基础客服）");
  }

  // ---- 种子：首个超管 ----
  if (store.countUsers() === 0) {
    const username = config.seedAdmin.username || "admin";
    const password = config.seedAdmin.password || randomPassword();
    hashPassword(password).then((hash) => {
      store.createUser({ merchantId: null, username, passwordHash: hash, passwordSalt: hash, role: ROLES.SUPERADMIN, displayName: "平台管理员" });
      ctx.logger?.info?.(`[kefu] 已创建平台超管：${username}${config.seedAdmin.password ? "" : `，初始密码：${password}（请尽快修改）`}`);
    }).catch((err) => ctx.logger?.error?.(`[kefu] 创建超管失败: ${err}`));
  }

  const api = createApiHandler({ store, config: { ...config, dataDir, basePath }, limiters: limits, state, ctx });

  // ---- 路由：/kefu/* ----
  const disposeRoute = ctx.webServer.register({
    kind: "prefix",
    path: basePath,
    handler: async (req, res) => {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://kefu.local").pathname);
      } catch {
        return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "无效的请求地址" } });
      }
      const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
      const rel = rest.startsWith("/") ? rest.slice(1) : rest;

      // 公开 API
      if (rel.startsWith("api/")) {
        return api(req, res, "/" + rel.slice(4));
      }
      // 网页问答组件页 GET {base}/widget/<token>
      if (req.method === "GET" && /^widget\/[^/]+$/.test(rel)) {
        return serveStatic(res, join(PUBLIC_DIR, "widget.html"), "text/html; charset=utf-8");
      }
      // 静态资源（商家控制台）
      if (req.method === "GET" || req.method === "HEAD") {
        return serveAsset(res, rel);
      }
      return sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "方法不允许" } });
    },
  });

  ctx.logger?.info?.(`[kefu] 客服平台已启动：${basePath}（数据目录 ${dataDir}）`);
  ctx.on("dispose", () => {
    try { disposeRoute(); } catch { /* ignore */ }
    try { store.close(); } catch { /* ignore */ }
  });
}

/** 静态资源服务：默认 index.html（SPA） */
function serveAsset(res, rel) {
  const safe = rel === "" ? "index.html" : rel.split("/").filter(Boolean).join("/");
  const file = join(PUBLIC_DIR, safe);
  const relToPublic = relative(PUBLIC_DIR, file);
  if (isAbsolute(relToPublic) || relToPublic.startsWith("..") || !existsSync(file)) {
    // SPA 回退
    const index = join(PUBLIC_DIR, "index.html");
    if (existsSync(index)) return serveStatic(res, index, "text/html; charset=utf-8");
    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "资源不存在" } });
  }
  if (statIsDir(file)) {
    const index = join(file, "index.html");
    if (existsSync(index)) return serveStatic(res, index, "text/html; charset=utf-8");
    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "资源不存在" } });
  }
  return serveStatic(res, file, mimeFor(file));
}

function statIsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function serveStatic(res, file, contentType) {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": contentType.includes("text/html") ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function loadState(path, defaults = {}) {
  let parsed = null;
  try {
    if (existsSync(path)) parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch { /* 损坏则重置 */ }
  const platform = parsed?.platform && typeof parsed.platform === "object" ? parsed.platform : {};
  return {
    platform: {
      allowRegistration: platform.allowRegistration ?? defaults.allowRegistration ?? true,
      rateLimit: platform.rateLimit && typeof platform.rateLimit === "object" ? platform.rateLimit : {},
    },
  };
}

const RATE_LIMIT_KEYS = new Set([
  "perMinute", "burst",
  "authPerMinute", "authBurst",
  "widgetPerMinute", "widgetBurst",
  "ipPerMinute", "ipBurst",
]);

/** 过滤状态文件/请求体中的非法限流数值，避免字符串/负数破坏限流器。 */
function sanitizeRateLimit(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!RATE_LIMIT_KEYS.has(key)) continue;
    const n = Number(value);
    if (Number.isInteger(n) && n > 0 && n <= 1_000_000) out[key] = n;
  }
  return out;
}

function randomPassword(len = 12) {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export { Config, apply, inject, name };
