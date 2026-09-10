// dsh-kefu API 端到端冒烟测试：不启动真实 DSH/模型，只验证鉴权、多租户、
// 平台设置持久化/限流重建、删除账号外键等 HTTP 层行为。
import { Readable } from "node:stream";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.js";

class MockRes {
  constructor() {
    this.status = 200;
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
    this.ended = false;
  }
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; }
  getHeader(k) { return this.headers[k.toLowerCase()]; }
  writeHead(status, headers) {
    this.status = status;
    this.headersSent = true;
    if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    return this;
  }
  write(c) { this.chunks.push(Buffer.from(c)); return true; }
  end(c) {
    if (c !== undefined) this.chunks.push(Buffer.from(c));
    this.body = Buffer.concat(this.chunks).toString("utf8");
    this.ended = true;
  }
}

function makeReq(method, url, { body, headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function setupPlugin(config) {
  const routes = [];
  const disposes = [];
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    webServer: { register(route) { routes.push(route); return () => {}; } },
    on(event, cb) { if (event === "dispose") disposes.push(cb); },
  };
  apply(ctx, config);
  return { route: routes[0], disposes };
}

async function call(route, method, path, { body, cookie, headers = {} } = {}) {
  const req = makeReq(method, path, { body, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
  const res = new MockRes();
  await route.handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, body: res.body, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAIL: " + msg);
  console.log("PASS:", msg);
}

const dir = mkdtempSync(join(tmpdir(), "kefu-e2e-"));
try {
  const { route, disposes } = setupPlugin({
    basePath: "/kefu",
    dataDir: dir,
    allowRegistration: true,
    trustProxy: false,
    secureCookie: false,
    exposeSessionToken: false,
    seedAdmin: { username: "admin", password: "admin123" },
    defaultTier: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    rateLimit: {
      perMinute: 30, burst: 60,
      authPerMinute: 100, authBurst: 200,
      widgetPerMinute: 10, widgetBurst: 20,
      ipPerMinute: 60, ipBurst: 120,
    },
  });
  const P = "/kefu/api";

  // 1) 注册商家并登录
  let r = await call(route, "POST", P + "/auth/register", { body: { name: "店铺A", username: "owner", password: "secret123" } });
  assert(r.status === 201, "注册商家返回 201");
  r = await call(route, "POST", P + "/auth/login", { body: { username: "owner", password: "secret123" } });
  assert(r.status === 200, "商家登录返回 200");
  assert(!("token" in (r.json?.data || {})), "默认登录响应不返回明文 token");
  const ownerCookie = String(r.headers["set-cookie"]).split(";")[0];
  const setCookie = String(r.headers["set-cookie"]);
  assert(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Lax"), "Set-Cookie 含 HttpOnly/SameSite=Lax");
  assert(!setCookie.includes("Secure"), "默认 secureCookie=false 时不带 Secure");
  assert(setCookie.includes("Path=/kefu"), "Cookie Path 使用 basePath");

  // 2) 建 Agent、用工号建会话，再删除该工号（覆盖外键 500 问题）
  r = await call(route, "POST", P + "/agents", { cookie: ownerCookie, body: { name: "客服A" } });
  assert(r.status === 201, "商家管理员创建 Agent 返回 201");
  const agentId = r.json.data.agent.id;
  r = await call(route, "POST", P + "/users", { cookie: ownerCookie, body: { username: "staff", password: "secret123" } });
  assert(r.status === 201, "创建店员返回 201");
  const staffId = r.json.data.user.id;
  r = await call(route, "POST", P + "/auth/login", { body: { username: "staff", password: "secret123" } });
  assert(r.status === 200, "店员登录返回 200");
  const staffCookie = String(r.headers["set-cookie"]).split(";")[0];
  r = await call(route, "POST", P + "/conversations", { cookie: staffCookie, body: { agentId } });
  assert(r.status === 201, "店员创建会话返回 201");
  r = await call(route, "DELETE", P + "/users/" + staffId, { cookie: ownerCookie });
  assert(r.status === 200, "删除创建过会话的账号返回 200（外键修复）");

  // 2b) 账号被锁后，正确密码仍可登录（防锁定 DoS）
  r = await call(route, "POST", P + "/users", { cookie: ownerCookie, body: { username: "lockme", password: "secret123" } });
  assert(r.status === 201, "创建锁定测试账号返回 201");
  for (let i = 0; i < 5; i++) {
    r = await call(route, "POST", P + "/auth/login", { body: { username: "lockme", password: "wrongpass" } });
    assert(r.status === 401, `锁定测试第 ${i + 1} 次错误密码返回 401`);
  }
  r = await call(route, "POST", P + "/auth/login", { body: { username: "lockme", password: "secret123" } });
  assert(r.status === 200, "锁定后用正确密码仍可登录（不再被攻击者 DoS）");

  // 2c) widget visitorId 必须由服务端签名，伪造值直接 400
  r = await call(route, "POST", P + `/agents/${agentId}/widget-tokens`, {
    cookie: ownerCookie,
    body: { allowedOrigins: "https://shop.example.com" },
  });
  assert(r.status === 201, "生成网页客服凭据返回 201");
  const widgetToken = r.json.data.token;
  assert(r.json.data.allowedOrigins === "https://shop.example.com", "凭据保存了域名白名单");

  r = await call(route, "GET", P + `/widget/${widgetToken}/visitor`, { headers: { origin: "https://evil.example" } });
  assert(r.status === 403 && r.json.error.code === "ORIGIN_NOT_ALLOWED", "非白名单 Origin 被拒绝");
  r = await call(route, "GET", P + `/widget/${widgetToken}/visitor`, { headers: { origin: "https://shop.example.com" } });
  assert(r.status === 200 && /^[0-9a-f-]{36}\.[0-9a-f]{32}$/.test(r.json.data.visitorId), "服务端签发签名 visitorId");
  r = await call(route, "GET", P + `/widget/${widgetToken}/visitor`, { headers: { origin: "https://server.example", host: "server.example" } });
  assert(r.status === 200, "同源独立问答页始终允许");

  r = await call(route, "POST", P + `/widget/${widgetToken}/messages`, { body: { content: "hi", visitorId: "forged" } });
  assert(r.status === 400 && r.json.error.code === "INVALID_VISITOR", "伪造 visitorId 被拒绝");

  // 3) 等待种子超管可登录
  let adminCookie = "";
  for (let i = 0; i < 50; i++) {
    const login = await call(route, "POST", P + "/auth/login", { body: { username: "admin", password: "admin123" } });
    if (login.status === 200) { adminCookie = String(login.headers["set-cookie"]).split(";")[0]; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(!!adminCookie, "种子超管可登录");

  // 4) 设置开关与限流落盘并即时生效
  r = await call(route, "PATCH", P + "/admin/settings", {
    cookie: adminCookie,
    body: { allowRegistration: false, widgetDailyMessageLimit: 1234, rateLimit: { authPerMinute: 1 } },
  });
  assert(r.status === 200, "PATCH /admin/settings 返回 200（state.save 修复）");
  const stateFile = join(dir, "kefu-state.json");
  assert(existsSync(stateFile), "设置已写入状态文件");
  const saved = JSON.parse(readFileSync(stateFile, "utf8"));
  assert(saved.platform.allowRegistration === false, "注册开关已持久化为 false");
  assert(saved.platform.rateLimit.authPerMinute === 1, "限流值已持久化为 1");
  assert(saved.platform.widgetDailyMessageLimit === 1234, "widget 每日消息额度已持久化为 1234");

  r = await call(route, "POST", P + "/auth/register", { body: { name: "店铺B", username: "newuser", password: "secret123" } });
  assert(r.status === 403, "关闭注册后新用户名返回 403");
  r = await call(route, "POST", P + "/auth/register", { body: { name: "店铺C", username: "owner", password: "secret123" } });
  assert(r.status === 403, "关闭注册后已有用户名也返回 403（不再枚举用户名）");

  r = await call(route, "POST", P + "/auth/login", { body: { username: "owner", password: "wrongpass" } });
  assert(r.status === 401, "重建限流后第一次登录尝试放行（401）");
  r = await call(route, "POST", P + "/auth/login", { body: { username: "owner", password: "wrongpass" } });
  assert(r.status === 429, "重建限流后第二次登录被 429（限流即时生效）");

  r = await call(route, "PATCH", P + "/admin/settings", { cookie: adminCookie, body: { rateLimit: { authPerMinute: 0 } } });
  assert(r.status === 400, "非法限流值返回 400");
  r = await call(route, "PATCH", P + "/admin/settings", { cookie: adminCookie, body: { widgetDailyMessageLimit: -1 } });
  assert(r.status === 400, "非法 widget 日额度返回 400");

  for (const dispose of disposes) dispose();
  console.log("\nALL API E2E CHECKS PASSED");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
