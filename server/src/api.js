// dsh-kefu — REST + SSE API 路由（挂在 webServer 的 basePath 前缀下）
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROLES, authenticate, hasRole, hashPassword, verifyPassword,
  lockedRemainingMs, registerLoginFailure, clearLoginFailures,
  issueSessionToken, publicUser, publicMerchant,
} from "./auth.js";
import { clientIp } from "./ratelimit.js";
import { runConversationTurn } from "./agents.js";
import { now, safeJson } from "./db.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_KEYS = new Set([
  "perMinute", "burst",
  "authPerMinute", "authBurst",
  "widgetPerMinute", "widgetBurst",
  "ipPerMinute", "ipBurst",
]);

/** 构造 API 路由处理器 */
export function createApiHandler({ store, config, limiters, state, ctx }) {
  /** 进行中的会话回合锁：conversationId -> Promise */
  const turnLocks = new Map();

  return async function route(req, res, pathname) {
    try {
      if (pathname.startsWith("/auth/")) return await authRoutes(req, res, pathname);
      if (pathname.startsWith("/widget/")) return await widgetRoutes(req, res, pathname);
      // 其余全部需要登录
      const auth = authenticate(store, req);
      if (!auth) return sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "请先登录" } });
      req.auth = auth;

      if (pathname.startsWith("/admin/")) return await adminRoutes(req, res, pathname);
      return await consoleRoutes(req, res, pathname);
    } catch (err) {
      const status = err?.status ?? 500;
      if (status >= 500) ctx.logger?.error?.(`[kefu] api error: ${err?.stack ?? err}`);
      return sendJson(res, status, { error: { code: err?.code ?? "INTERNAL", message: err?.message ?? "服务器错误" } });
    }
  };

  // ================= 认证 =================

  async function authRoutes(req, res, pathname) {
    const { method } = req;
    if (pathname === "/auth/register" && method === "POST") {
      const rl = limiters.ip.check(`ip:${clientIp(req, config)}:register`);
      if (!rl.allowed) return sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "注册太频繁，请稍后再试" } });
      const body = await readJson(req);
      const name = clean(body.name, 64);
      const username = clean(body.username, 32);
      const password = String(body.password ?? "");
      if (!name || !username || password.length < 6) {
        return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "商家名/用户名/密码（至少6位）不能为空" } });
      }
      if (state.platform.allowRegistration === false) {
        return sendJson(res, 403, { error: { code: "REGISTRATION_CLOSED", message: "当前未开放自助注册，请联系平台管理员开通账号" } });
      }
      if (store.getUserByUsername(username)) {
        return sendJson(res, 409, { error: { code: "USERNAME_TAKEN", message: "用户名已被占用" } });
      }
      // scrypt 是异步的；await 之后再查重一次，消除并发同名注册竞态。
      const { hash, salt } = await hashPasswordSplit(password);
      if (store.getUserByUsername(username)) {
        return sendJson(res, 409, { error: { code: "USERNAME_TAKEN", message: "用户名已被占用" } });
      }
      const dataDir = join(config.dataDir, "merchants", randomUUID());
      mkdirSync(dataDir, { recursive: true });
      const merchant = store.createMerchant({ name, contact: clean(body.contact, 128), dataDir });
      const user = store.createUser({
        merchantId: merchant.id, username, passwordHash: hash, passwordSalt: salt,
        role: ROLES.MERCHANT_ADMIN, displayName: clean(body.displayName, 64) || username,
      });
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "merchant.register", detail: `商家「${name}」注册` });
      return sendJson(res, 201, { data: { user: publicUser(user), merchant: publicMerchant(merchant) } });
    }

    if (pathname === "/auth/login" && method === "POST") {
      const body = await readJson(req);
      const username = clean(body.username, 64);
      const password = String(body.password ?? "");
      const ip = clientIp(req, config);
      const ipLim = limiters.auth.check(`ip:${ip}:login`);
      if (!ipLim.allowed) return sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "登录尝试过多，请稍后再试" } });

      const user = store.getUserByUsername(username);
      if (!user) {
        return sendJson(res, 401, { error: { code: "BAD_CREDENTIALS", message: "用户名或密码错误" } });
      }
      const locked = lockedRemainingMs(user);
      if (locked > 0) {
        return sendJson(res, 423, { error: { code: "ACCOUNT_LOCKED", message: `账号已锁定，请 ${Math.ceil(locked / 60000)} 分钟后重试` } });
      }
      if (user.status !== "active") {
        return sendJson(res, 403, { error: { code: "ACCOUNT_DISABLED", message: "账号已停用" } });
      }
      if (!(await verifyPassword(password, user.password_hash))) {
        registerLoginFailure(store, user);
        return sendJson(res, 401, { error: { code: "BAD_CREDENTIALS", message: "用户名或密码错误" } });
      }
      clearLoginFailures(store, user);
      const merchant = user.merchant_id ? store.getMerchant(user.merchant_id) : null;
      if (user.merchant_id && (!merchant || merchant.status !== "active")) {
        return sendJson(res, 403, { error: { code: "MERCHANT_DISABLED", message: "商家已被停用" } });
      }
      const token = issueSessionToken(store, {
        userId: user.id, merchantId: user.merchant_id, ttlMs: SESSION_TTL_MS,
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200),
      });
      res.setHeader("Set-Cookie", sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000), config));
      store.audit({ actorId: user.id, merchantId: user.merchant_id, action: "auth.login", detail: `IP ${ip}` });
      const data = { user: publicUser(user), merchant: publicMerchant(merchant) };
      // 默认不把会话 token 暴露给 JS；仅 HttpOnly Cookie 已足够同源控制台使用。
      if (config.exposeSessionToken === true) data.token = token;
      return sendJson(res, 200, { data });
    }

    if (pathname === "/auth/logout" && method === "POST") {
      const token = req.auth?.token;
      if (token) store.deleteSession(createHash("sha256").update(token).digest("hex"));
      res.setHeader("Set-Cookie", sessionCookie("", 0, config));
      return sendJson(res, 200, { data: { ok: true } });
    }

    if (pathname === "/auth/me" && method === "GET") {
      const auth = authenticate(store, req);
      if (!auth) return sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "未登录" } });
      return sendJson(res, 200, {
        data: {
          user: publicUser(auth.user),
          merchant: publicMerchant(auth.merchant),
          platform: {
            allowRegistration: state.platform.allowRegistration !== false,
            tiers: store.listTiers(true).map(publicTier),
          },
        },
      });
    }

    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
  }

  // ================= 商家控制台 =================

  async function consoleRoutes(req, res, pathname) {
    const { method, auth } = req;
    const { user, merchant } = auth;

    // --- 档位（所有登录用户可见；隐藏 provider/model） ---
    if (pathname === "/tiers" && method === "GET") {
      return sendJson(res, 200, { data: { tiers: store.listTiers(true).map(publicTier) } });
    }

    // --- 店员 Agent ---
    if (pathname === "/agents" && method === "GET") {
      requireRole(user, ROLES.MERCHANT_ADMIN, ROLES.MERCHANT_STAFF);
      const rows = store.listAgents(merchant.id).map((a) => ({
        ...a, tier: a.tier_id ? publicTier(store.getTier(a.tier_id)) : null,
      }));
      return sendJson(res, 200, { data: { agents: rows } });
    }

    if (pathname === "/agents" && method === "POST") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const body = await readJson(req);
      const name = clean(body.name, 64);
      if (!name) return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Agent 名称不能为空" } });
      const tier = body.tierId ? store.getTier(body.tierId) : null;
      if (body.tierId && (!tier || !tier.enabled)) {
        return sendJson(res, 400, { error: { code: "BAD_TIER", message: "所选服务档位不可用" } });
      }
      const agent = store.createAgent({
        merchantId: merchant.id,
        name,
        avatar: clean(body.avatar, 500),
        persona: clean(body.persona, 4000),
        tierId: body.tierId ?? null,
        welcomeMessage: clean(body.welcomeMessage, 500),
      });
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "agent.create", detail: name });
      return sendJson(res, 201, { data: { agent } });
    }

    if (pathname.startsWith("/agents/") && method === "PATCH") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const agent = scopedAgent(store, merchant.id, id);
      if (!agent) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Agent 不存在" } });
      const body = await readJson(req);
      const fields = {};
      if (body.name !== undefined) fields.name = clean(body.name, 64);
      if (body.avatar !== undefined) fields.avatar = clean(body.avatar, 500);
      if (body.persona !== undefined) fields.persona = clean(body.persona, 4000);
      if (body.welcomeMessage !== undefined) fields.welcome_message = clean(body.welcomeMessage, 500);
      if (body.status !== undefined) fields.status = body.status === "enabled" ? "enabled" : "disabled";
      if (body.tierId !== undefined) {
        const tier = body.tierId ? store.getTier(body.tierId) : null;
        if (body.tierId && (!tier || !tier.enabled)) return sendJson(res, 400, { error: { code: "BAD_TIER", message: "所选服务档位不可用" } });
        fields.tier_id = body.tierId ?? null;
      }
      const updated = store.updateAgent(id, fields);
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "agent.update", detail: updated.name });
      return sendJson(res, 200, { data: { agent: updated } });
    }

    if (pathname.startsWith("/agents/") && method === "DELETE") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const agent = scopedAgent(store, merchant.id, id);
      if (!agent) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Agent 不存在" } });
      store.deleteAgent(id);
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "agent.delete", detail: agent.name });
      return sendJson(res, 200, { data: { ok: true } });
    }

    // --- 网页问答凭据 ---
    if (/^\/agents\/[^/]+\/widget-tokens$/.test(pathname) && method === "GET") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      if (!scopedAgent(store, merchant.id, id)) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Agent 不存在" } });
      return sendJson(res, 200, { data: { tokens: store.listWidgetTokens(id) } });
    }

    if (/^\/agents\/[^/]+\/widget-tokens$/.test(pathname) && method === "POST") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const agent = scopedAgent(store, merchant.id, id);
      if (!agent) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Agent 不存在" } });
      const token = randomBytesHex(24);
      const wt = store.createWidgetToken({ agentId: id, token });
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "widget.token.create", detail: agent.name });
      return sendJson(res, 201, { data: { token: wt.token, url: `${config.basePath}/widget/${wt.token}` } });
    }

    if (/^\/widget-tokens\/[^/]+$/.test(pathname) && method === "DELETE") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const token = pathname.split("/")[2];
      const wt = store.getWidgetToken(token);
      if (!wt) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "凭据不存在" } });
      const agent = store.getAgent(wt.agent_id);
      if (!agent || agent.merchant_id !== merchant.id) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "凭据不存在" } });
      store.deleteWidgetToken(token);
      return sendJson(res, 200, { data: { ok: true } });
    }

    // --- 会话 ---
    if (pathname === "/conversations" && method === "GET") {
      const q = reqUrl(req);
      const rows = store.listConversations({
        merchantId: merchant.id,
        agentId: q.searchParams.get("agentId") || null,
        status: q.searchParams.get("status") || null,
        channel: q.searchParams.get("channel") || null,
        limit: pageInt(q.searchParams.get("limit"), 50, 1, 200),
        offset: pageInt(q.searchParams.get("offset"), 0, 0, 1_000_000),
      });
      return sendJson(res, 200, { data: { conversations: rows } });
    }

    if (pathname === "/conversations" && method === "POST") {
      requireRole(user, ROLES.MERCHANT_ADMIN, ROLES.MERCHANT_STAFF);
      const body = await readJson(req);
      const agent = body.agentId ? scopedAgent(store, merchant.id, body.agentId) : null;
      if (body.agentId && !agent) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Agent 不存在" } });
      if (agent && agent.status !== "enabled") return sendJson(res, 400, { error: { code: "AGENT_DISABLED", message: "该 Agent 已停用" } });
      const conv = store.createConversation({
        merchantId: merchant.id,
        agentId: agent?.id ?? null,
        channel: "console",
        title: clean(body.title, 100),
        dshSessionId: randomUUID(),
        createdBy: user.id,
      });
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "conversation.create", detail: conv.id });
      return sendJson(res, 201, { data: { conversation: conv } });
    }

    if (/^\/conversations\/[^/]+\/messages$/.test(pathname) && method === "GET") {
      const id = pathname.split("/")[2];
      const conv = scopedConversation(store, merchant.id, id);
      if (!conv) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "会话不存在" } });
      return sendJson(res, 200, { data: { conversation: conv, messages: store.listMessages(id) } });
    }

    if (/^\/conversations\/[^/]+\/messages$/.test(pathname) && method === "POST") {
      const id = pathname.split("/")[2];
      const conv = scopedConversation(store, merchant.id, id);
      if (!conv) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "会话不存在" } });
      if (conv.status !== "open") return sendJson(res, 400, { error: { code: "CONVERSATION_CLOSED", message: "会话已关闭" } });
      const agent = conv.agent_id ? store.getAgent(conv.agent_id) : null;
      if (!agent || agent.status !== "enabled") {
        return sendJson(res, 400, { error: { code: "AGENT_UNAVAILABLE", message: "接待 Agent 不可用" } });
      }
      const body = await readJson(req);
      const content = clean(body.content, 8000);
      if (!content) return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "消息内容不能为空" } });

      // 限流：每用户 + 每 IP
      const userLim = limiters.chat.check(`user:${user.id}:chat`);
      if (!userLim.allowed) return sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "发送太频繁，请稍后再试" } });
      const ipLim = limiters.ip.check(`ip:${clientIp(req, config)}:chat`);
      if (!ipLim.allowed) return sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "发送太频繁，请稍后再试" } });

      // 同一会话串行处理
      if (turnLocks.has(id)) return sendJson(res, 409, { error: { code: "TURN_IN_PROGRESS", message: "该会话正在接待中，请稍候" } });

      const wantStream = (req.headers.accept ?? "").includes("text/event-stream");
      const userMsg = store.addMessage({ conversationId: id, role: "user", content });

      if (wantStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`event: started\ndata: ${JSON.stringify({ messageId: userMsg.id })}\n\n`);
      }

      const lock = (async () => {
        try {
          const result = await runConversationTurn({ ctx, store, config }, {
            merchant, agent, conversation: conv, content,
            onChunk: wantStream ? (text, reasoning) => {
              res.write(`event: delta\ndata: ${JSON.stringify({ text, reasoning })}\n\n`);
            } : undefined,
          });
          const meta = { usage: result.usage ?? undefined };
          const reply = store.addMessage({ conversationId: id, role: "assistant", content: result.text, meta });
          if (!conv.meta.started) {
            store.updateConversation(id, { meta: { ...conv.meta, started: true } });
          }
          if (!conv.title) {
            store.updateConversation(id, { title: content.slice(0, 20) });
          }
          if (wantStream) {
            res.write(`event: done\ndata: ${JSON.stringify({ messageId: reply.id, text: result.text, usage: result.usage })}\n\n`);
            res.end();
          } else {
            sendJson(res, 200, { data: { message: reply } });
          }
        } catch (err) {
          ctx.logger?.error?.(`[kefu] turn failed: ${err?.stack ?? err}`);
          if (wantStream) {
            res.write(`event: error\ndata: ${JSON.stringify({ code: err?.code ?? "AGENT_ERROR", message: err?.message ?? "客服响应失败" })}\n\n`);
            res.end();
          } else {
            sendJson(res, err?.code === "AGENT_TIMEOUT" ? 504 : 502, { error: { code: err?.code ?? "AGENT_ERROR", message: err?.message ?? "客服响应失败" } });
          }
        } finally {
          turnLocks.delete(id);
        }
      })();
      turnLocks.set(id, lock);
      // 非流式请求等锁完成
      if (!wantStream) await lock;
      return;
    }

    if (/^\/conversations\/[^/]+$/.test(pathname) && method === "PATCH") {
      const id = pathname.split("/")[2];
      const conv = scopedConversation(store, merchant.id, id);
      if (!conv) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "会话不存在" } });
      const body = await readJson(req);
      const fields = {};
      if (body.status !== undefined) fields.status = body.status === "open" ? "open" : "closed";
      if (body.title !== undefined) fields.title = clean(body.title, 100);
      const updated = store.updateConversation(id, fields);
      return sendJson(res, 200, { data: { conversation: updated } });
    }

    // --- 商家自己的账号管理（merchant_admin） ---
    if (pathname === "/users" && method === "GET") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      return sendJson(res, 200, { data: { users: store.listUsers(merchant.id).map(publicUser) } });
    }

    if (pathname === "/users" && method === "POST") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const body = await readJson(req);
      const username = clean(body.username, 32);
      const password = String(body.password ?? "");
      if (!username || password.length < 6) {
        return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "用户名/密码（至少6位）不能为空" } });
      }
      if (store.getUserByUsername(username)) {
        return sendJson(res, 409, { error: { code: "USERNAME_TAKEN", message: "用户名已被占用" } });
      }
      const role = ROLES.MERCHANT_STAFF;
      const { hash, salt } = await hashPasswordSplit(password);
      if (store.getUserByUsername(username)) {
        return sendJson(res, 409, { error: { code: "USERNAME_TAKEN", message: "用户名已被占用" } });
      }
      const u = store.createUser({
        merchantId: merchant.id, username, passwordHash: hash, passwordSalt: salt, role,
        displayName: clean(body.displayName, 64) || username,
      });
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "user.create", detail: username });
      return sendJson(res, 201, { data: { user: publicUser(u) } });
    }

    if (/^\/users\/[^/]+$/.test(pathname) && method === "PATCH") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const target = store.getUser(id);
      if (!target || target.merchant_id !== merchant.id) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "账号不存在" } });
      const body = await readJson(req);
      const fields = {};
      if (body.displayName !== undefined) fields.display_name = clean(body.displayName, 64);
      if (body.status !== undefined) fields.status = body.status === "active" ? "active" : "disabled";
      if (body.password) {
        if (String(body.password).length < 6) {
          return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "密码至少 6 位" } });
        }
        const { hash, salt } = await hashPasswordSplit(body.password);
        fields.password_hash = hash;
        fields.password_salt = salt;
        store.deleteUserSessions(id);
      }
      const updated = store.updateUser(id, fields);
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "user.update", detail: target.username });
      return sendJson(res, 200, { data: { user: publicUser(updated) } });
    }

    if (/^\/users\/[^/]+$/.test(pathname) && method === "DELETE") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const target = store.getUser(id);
      if (!target || target.merchant_id !== merchant.id) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "账号不存在" } });
      if (target.id === user.id) return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "不能删除自己" } });
      store.deleteUserSessions(id);
      store.deleteUser(id);
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "user.delete", detail: target.username });
      return sendJson(res, 200, { data: { ok: true } });
    }

    // --- 知识库（merchant_admin） ---
    if (pathname === "/kb" && method === "GET") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const q = reqUrl(req);
      const rows = store.listKbDocs(merchant.id, q.searchParams.get("agentId") || null);
      return sendJson(res, 200, { data: { docs: rows, count: rows.length } });
    }

    if (pathname === "/kb" && method === "POST") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const body = await readJson(req);
      const title = clean(body.title, 200);
      const content = clean(body.content, 20000);
      if (!title || !content) {
        return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "标题和内容不能为空" } });
      }
      let agentId = null;
      if (body.agentId) {
        const a = scopedAgent(store, merchant.id, body.agentId);
        if (!a) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Agent 不存在" } });
        agentId = a.id;
      }
      const doc = store.createKbDoc({
        merchantId: merchant.id, agentId, title, content, tags: clean(body.tags, 200),
      });
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "kb.create", detail: title });
      return sendJson(res, 201, { data: { doc } });
    }

    if (/^\/kb\/[^/]+$/.test(pathname) && method === "GET") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const doc = store.getKbDoc(id);
      if (!doc || doc.merchant_id !== merchant.id) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "资料不存在" } });
      return sendJson(res, 200, { data: { doc } });
    }

    if (/^\/kb\/[^/]+$/.test(pathname) && method === "PATCH") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const doc = store.getKbDoc(id);
      if (!doc || doc.merchant_id !== merchant.id) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "资料不存在" } });
      const body = await readJson(req);
      const fields = {};
      if (body.title !== undefined) fields.title = clean(body.title, 200);
      if (body.content !== undefined) fields.content = clean(body.content, 20000);
      if (body.tags !== undefined) fields.tags = clean(body.tags, 200);
      if (body.agentId !== undefined) {
        if (body.agentId) {
          const a = scopedAgent(store, merchant.id, body.agentId);
          if (!a) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Agent 不存在" } });
          fields.agent_id = a.id;
        } else {
          fields.agent_id = null;
        }
      }
      const updated = store.updateKbDoc(id, fields);
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "kb.update", detail: updated.title });
      return sendJson(res, 200, { data: { doc: updated } });
    }

    if (/^\/kb\/[^/]+$/.test(pathname) && method === "DELETE") {
      requireRole(user, ROLES.MERCHANT_ADMIN);
      const id = pathname.split("/")[2];
      const doc = store.getKbDoc(id);
      if (!doc || doc.merchant_id !== merchant.id) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "资料不存在" } });
      store.deleteKbDoc(id);
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "kb.delete", detail: doc.title });
      return sendJson(res, 200, { data: { ok: true } });
    }

    // --- 统计 ---
    if (pathname === "/stats" && method === "GET") {
      if (!merchant) {
        return sendJson(res, 403, { error: { code: "FORBIDDEN", message: "平台管理员请使用「平台管理」查看统计" } });
      }
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      return sendJson(res, 200, {
        data: {
          agents: store.countAgents(merchant.id),
          conversations: store.countConversations(merchant.id),
          messages: store.countMessages(merchant.id),
          todayMessages: store.countMessages(merchant.id, dayAgo),
          openConversations: store.listConversations({ merchantId: merchant.id, status: "open", limit: 1 }).length > 0
            ? store.db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE merchant_id = ? AND status = 'open'").get(merchant.id).n
            : 0,
        },
      });
    }

    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
  }

  // ================= 平台管理（superadmin） =================

  async function adminRoutes(req, res, pathname) {
    const { method, auth } = req;
    const user = auth.user;
    requireRole(user, ROLES.SUPERADMIN);

    if (pathname === "/admin/stats" && method === "GET") {
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      return sendJson(res, 200, {
        data: {
          merchants: store.countMerchants(),
          users: store.countUsers(),
          agents: store.countAgents(),
          conversations: store.countConversations(null, dayAgo),
          messages: store.countMessages(null, dayAgo),
          audit: store.recentAudit(50),
        },
      });
    }

    if (pathname === "/admin/merchants" && method === "GET") {
      const rows = store.listMerchants().map((m) => ({
        ...publicMerchant(m),
        users: store.countUsers(m.id),
        agents: store.countAgents(m.id),
      }));
      return sendJson(res, 200, { data: { merchants: rows } });
    }

    if (pathname === "/admin/merchants" && method === "POST") {
      const body = await readJson(req);
      const name = clean(body.name, 64);
      if (!name) return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "商家名不能为空" } });
      const dataDir = join(config.dataDir, "merchants", randomUUID());
      mkdirSync(dataDir, { recursive: true });
      const merchant = store.createMerchant({ name, contact: clean(body.contact, 128), dataDir });
      store.audit({ actorId: user.id, merchantId: merchant.id, action: "merchant.create", detail: name });
      return sendJson(res, 201, { data: { merchant: publicMerchant(merchant) } });
    }

    if (/^\/admin\/merchants\/[^/]+$/.test(pathname) && method === "PATCH") {
      const id = pathname.split("/")[3];
      const merchant = store.getMerchant(id);
      if (!merchant) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "商家不存在" } });
      const body = await readJson(req);
      const fields = {};
      if (body.name !== undefined) fields.name = clean(body.name, 64);
      if (body.contact !== undefined) fields.contact = clean(body.contact, 128);
      if (body.status !== undefined) fields.status = body.status === "active" ? "active" : "disabled";
      const updated = store.updateMerchant(id, fields);
      return sendJson(res, 200, { data: { merchant: publicMerchant(updated) } });
    }

    if (pathname === "/admin/users" && method === "GET") {
      const q = reqUrl(req);
      const merchantId = q.searchParams.get("merchantId");
      return sendJson(res, 200, { data: { users: store.listUsers(merchantId).map(publicUser) } });
    }

    if (pathname === "/admin/users" && method === "POST") {
      const body = await readJson(req);
      const merchantId = clean(body.merchantId, 64);
      const username = clean(body.username, 32);
      const password = String(body.password ?? "");
      if (!merchantId || !username || password.length < 6) {
        return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "merchantId/用户名/密码（至少6位）必填" } });
      }
      const merchant = store.getMerchant(merchantId);
      if (!merchant) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "商家不存在" } });
      if (store.getUserByUsername(username)) {
        return sendJson(res, 409, { error: { code: "USERNAME_TAKEN", message: "用户名已被占用" } });
      }
      const role = body.role === ROLES.MERCHANT_ADMIN || body.role === ROLES.MERCHANT_STAFF ? body.role : ROLES.MERCHANT_STAFF;
      const { hash, salt } = await hashPasswordSplit(password);
      if (store.getUserByUsername(username)) {
        return sendJson(res, 409, { error: { code: "USERNAME_TAKEN", message: "用户名已被占用" } });
      }
      const u = store.createUser({
        merchantId, username, passwordHash: hash, passwordSalt: salt, role,
        displayName: clean(body.displayName, 64) || username,
      });
      store.audit({ actorId: user.id, merchantId, action: "user.create", detail: username });
      return sendJson(res, 201, { data: { user: publicUser(u) } });
    }

    if (/^\/admin\/users\/[^/]+$/.test(pathname) && method === "PATCH") {
      const id = pathname.split("/")[3];
      const target = store.getUser(id);
      if (!target) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "账号不存在" } });
      const body = await readJson(req);
      const fields = {};
      if (body.displayName !== undefined) fields.display_name = clean(body.displayName, 64);
      if (body.status !== undefined) fields.status = body.status === "active" ? "active" : "disabled";
      if (body.role !== undefined && [ROLES.MERCHANT_ADMIN, ROLES.MERCHANT_STAFF, ROLES.SUPERADMIN].includes(body.role)) fields.role = body.role;
      if (body.password) {
        if (String(body.password).length < 6) {
          return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "密码至少 6 位" } });
        }
        const { hash, salt } = await hashPasswordSplit(body.password);
        fields.password_hash = hash;
        fields.password_salt = salt;
        store.deleteUserSessions(id);
      }
      const updated = store.updateUser(id, fields);
      return sendJson(res, 200, { data: { user: publicUser(updated) } });
    }

    if (/^\/admin\/users\/[^/]+$/.test(pathname) && method === "DELETE") {
      const id = pathname.split("/")[3];
      const target = store.getUser(id);
      if (!target) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "账号不存在" } });
      if (target.id === user.id) return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "不能删除自己" } });
      store.deleteUserSessions(id);
      store.deleteUser(id);
      return sendJson(res, 200, { data: { ok: true } });
    }

    if (pathname === "/admin/tiers" && method === "GET") {
      return sendJson(res, 200, { data: { tiers: store.listTiers() } });
    }

    if (pathname === "/admin/tiers" && method === "POST") {
      const body = await readJson(req);
      const name = clean(body.name, 64);
      const provider = clean(body.provider, 64);
      const model = clean(body.model, 128);
      if (!name || !provider || !model) {
        return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "name/provider/model 必填" } });
      }
      const tier = store.createTier({
        name, description: clean(body.description, 256), provider, model,
        maxTokens: Number.isInteger(body.maxTokens) ? body.maxTokens : null,
        enabled: body.enabled === false ? 0 : 1,
      });
      store.audit({ actorId: user.id, action: "tier.create", detail: name });
      return sendJson(res, 201, { data: { tier } });
    }

    if (/^\/admin\/tiers\/[^/]+$/.test(pathname) && method === "PATCH") {
      const id = pathname.split("/")[3];
      const tier = store.getTier(id);
      if (!tier) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "档位不存在" } });
      const body = await readJson(req);
      const fields = {};
      if (body.name !== undefined) fields.name = clean(body.name, 64);
      if (body.description !== undefined) fields.description = clean(body.description, 256);
      if (body.provider !== undefined) fields.provider = clean(body.provider, 64);
      if (body.model !== undefined) fields.model = clean(body.model, 128);
      if (body.maxTokens !== undefined) fields.max_tokens = Number.isInteger(body.maxTokens) ? body.maxTokens : null;
      if (body.enabled !== undefined) fields.enabled = body.enabled === false ? 0 : 1;
      const updated = store.updateTier(id, fields);
      return sendJson(res, 200, { data: { tier: updated } });
    }

    if (/^\/admin\/tiers\/[^/]+$/.test(pathname) && method === "DELETE") {
      const id = pathname.split("/")[3];
      const tier = store.getTier(id);
      if (!tier) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "档位不存在" } });
      store.deleteTier(id);
      return sendJson(res, 200, { data: { ok: true } });
    }

    if (pathname === "/admin/settings" && method === "GET") {
      return sendJson(res, 200, { data: { settings: state.platform } });
    }

    if (pathname === "/admin/settings" && method === "PATCH") {
      const body = await readJson(req);
      if (body.allowRegistration !== undefined) state.platform.allowRegistration = body.allowRegistration === true;
      if (body.rateLimit !== undefined) {
        if (!body.rateLimit || typeof body.rateLimit !== "object" || Array.isArray(body.rateLimit)) {
          return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "rateLimit 必须是对象" } });
        }
        for (const [key, value] of Object.entries(body.rateLimit)) {
          if (!RATE_LIMIT_KEYS.has(key)) {
            return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: `不支持的限流字段：${key}` } });
          }
          if (!Number.isInteger(value) || value <= 0 || value > 1_000_000) {
            return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: `限流值 ${key} 必须是 1~1000000 的整数` } });
          }
        }
        state.platform.rateLimit = { ...state.platform.rateLimit, ...body.rateLimit };
      }
      state.save?.();
      state.rebuildLimiters?.();
      return sendJson(res, 200, { data: { settings: state.platform } });
    }

    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
  }

  // ================= 客服网页问答（公开接口，v1 基础版） =================

  async function widgetRoutes(req, res, pathname) {
    const { method } = req;

    // 所有公开 widget 响应都带 CORS，保证错误响应也能被店铺页面读取。
    res.setHeader("Access-Control-Allow-Origin", "*");

    // 跨域预检（浏览器从商家网页调用时必需）
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    if (/^\/widget\/[^/]+\/config$/.test(pathname) && method === "GET") {
      const token = pathname.split("/")[2];
      const wt = store.getWidgetToken(token);
      if (!wt || !wt.enabled) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "客服组件不存在或已停用" } });
      const agent = store.getAgent(wt.agent_id);
      if (!agent || agent.status !== "enabled") return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "客服组件不存在或已停用" } });
      const merchant = store.getMerchant(agent.merchant_id);
      if (!merchant || merchant.status !== "active") return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "客服组件不存在或已停用" } });
      res.setHeader("Access-Control-Allow-Origin", "*");
      return sendJson(res, 200, {
        data: {
          merchantName: merchant.name,
          agentName: agent.name,
          avatar: agent.avatar,
          welcomeMessage: agent.welcome_message,
          tierName: agent.tier_id ? store.getTier(agent.tier_id)?.name ?? null : null,
        },
      });
    }

    if (/^\/widget\/[^/]+\/messages$/.test(pathname) && method === "POST") {
      const token = pathname.split("/")[2];
      const wt = store.getWidgetToken(token);
      if (!wt || !wt.enabled) return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "客服组件不存在或已停用" } });
      const agent = store.getAgent(wt.agent_id);
      if (!agent || agent.status !== "enabled") return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "客服组件不存在或已停用" } });
      const merchant = store.getMerchant(agent.merchant_id);
      if (!merchant || merchant.status !== "active") return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "客服组件不存在或已停用" } });

      const ip = clientIp(req, config);
      const ipLim = limiters.ip.check(`ip:${ip}:widget`);
      if (!ipLim.allowed) return sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "发送太频繁，请稍后再试" } });
      const tkLim = limiters.widget.check(`token:${token}:widget`);
      if (!tkLim.allowed) return sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "发送太频繁，请稍后再试" } });

      const body = await readJson(req);
      const content = clean(body.content, 8000);
      if (!content) return sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "消息内容不能为空" } });

      // 复用访客会话（visitorId 由前端生成并存 localStorage）
      const visitorId = clean(body.visitorId, 64) || randomUUID();
      let conv = store.db.prepare(
        "SELECT * FROM conversations WHERE merchant_id = ? AND agent_id = ? AND channel = 'widget' AND status = 'open' AND json_extract(meta, '$.visitor') = ? LIMIT 1"
      ).get(merchant.id, agent.id, visitorId) ?? null;
      if (conv) conv.meta = safeJson(conv.meta);
      if (!conv) {
        conv = store.createConversation({
          merchantId: merchant.id, agentId: agent.id, channel: "widget",
          title: `网页访客 ${visitorId.slice(0, 8)}`, dshSessionId: randomUUID(),
          meta: { visitor: visitorId },
        });
      }

      if (turnLocks.has(conv.id)) return sendJson(res, 409, { error: { code: "TURN_IN_PROGRESS", message: "接待中，请稍候" } });
      store.addMessage({ conversationId: conv.id, role: "user", content });
      const lock = (async () => {
        try {
          const result = await runConversationTurn({ ctx, store, config }, {
            merchant, agent, conversation: conv, content,
          });
          const reply = store.addMessage({ conversationId: conv.id, role: "assistant", content: result.text, meta: { usage: result.usage ?? undefined } });
          if (!conv.meta.started) store.updateConversation(conv.id, { meta: { ...conv.meta, started: true } });
          res.setHeader("Access-Control-Allow-Origin", "*");
          sendJson(res, 200, { data: { message: reply } });
        } catch (err) {
          ctx.logger?.error?.(`[kefu] widget turn failed: ${err?.stack ?? err}`);
          sendJson(res, err?.code === "AGENT_TIMEOUT" ? 504 : 502, { error: { code: err?.code ?? "AGENT_ERROR", message: err?.message ?? "客服响应失败" } });
        } finally {
          turnLocks.delete(conv.id);
        }
      })();
      turnLocks.set(conv.id, lock);
      await lock;
      return;
    }

    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } });
  }

  // ================= 工具函数 =================

  function requireRole(user, ...roles) {
    if (!hasRole(user, ...roles)) {
      const err = new Error("没有权限执行此操作");
      err.code = "FORBIDDEN";
      err.status = 403;
      throw err;
    }
  }

  function scopedAgent(store_, merchantId, id) {
    const a = store_.getAgent(id);
    if (!a || a.merchant_id !== merchantId) return null;
    return a;
  }

  function scopedConversation(store_, merchantId, id) {
    const c = store_.getConversation(id);
    if (!c || c.merchant_id !== merchantId) return null;
    return c;
  }

  async function hashPasswordSplit(password) {
    const hash = await hashPassword(password);
    const parts = hash.split("$");
    return { hash, salt: parts[4] ?? "" };
  }

  function sessionCookie(token, maxAgeSeconds, cfg) {
    const secure = cfg.secureCookie ? "; Secure" : "";
    const path = cfg.basePath && cfg.basePath.startsWith("/") ? cfg.basePath : "/";
    return `kefu_session=${token}; Path=${path}; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAgeSeconds}`;
  }

  function pageInt(raw, fallback, min, max) {
    if (raw === null || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      const err = new Error("分页参数无效");
      err.code = "BAD_REQUEST";
      err.status = 400;
      throw err;
    }
    return n;
  }

  function publicTier(t) {
    if (!t) return null;
    return { id: t.id, name: t.name, description: t.description, enabled: !!t.enabled };
  }

  function randomBytesHex(n) {
    return randomBytes(n).toString("hex");
  }
}

// ================= 传输层工具 =================

export function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

export async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const err = new Error("请求体过大");
      err.code = "PAYLOAD_TOO_LARGE";
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("无效的 JSON 请求体");
    err.code = "BAD_REQUEST";
    err.status = 400;
    throw err;
  }
}

export function reqUrl(req) {
  return new URL(req.url ?? "/", "http://kefu.local");
}

export function clean(s, max) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}
