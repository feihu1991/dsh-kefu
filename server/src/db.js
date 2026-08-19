// dsh-kefu — SQLite 数据层（node:sqlite，零原生依赖）
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS merchants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',      -- active | disabled
  data_dir   TEXT NOT NULL,
  settings   TEXT NOT NULL DEFAULT '{}',          -- JSON：限流/开关等
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT REFERENCES merchants(id) ON DELETE CASCADE,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  role            TEXT NOT NULL,                  -- superadmin | merchant_admin | merchant_staff
  display_name    TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active', -- active | disabled
  login_fail      INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0,
  last_login_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id  TEXT REFERENCES merchants(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent   TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- 模型服务档位（对外只展示 name/description，屏蔽 provider/model 细节）
CREATE TABLE IF NOT EXISTS tiers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                      -- 高级客服 / 中级客服 / 基础客服
  description TEXT DEFAULT '',
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  max_tokens  INTEGER,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- 店员 Agent
CREATE TABLE IF NOT EXISTS agents (
  id               TEXT PRIMARY KEY,
  merchant_id      TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  avatar           TEXT DEFAULT '',
  persona          TEXT NOT NULL DEFAULT '',      -- 人设/话术（注入 system prompt）
  tier_id          TEXT REFERENCES tiers(id),
  welcome_message  TEXT DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'enabled', -- enabled | disabled
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_merchant ON agents(merchant_id);

-- 会话（一次客服接待 = 一条 conversation = 一个 DSH session）
CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  agent_id       TEXT REFERENCES agents(id) ON DELETE SET NULL,
  channel        TEXT NOT NULL DEFAULT 'console',  -- console | widget
  title          TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open',     -- open | closed
  dsh_session_id TEXT NOT NULL,
  created_by     TEXT REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  meta           TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_conv_merchant ON conversations(merchant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,                  -- user | assistant | system
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  meta            TEXT NOT NULL DEFAULT '{}'      -- usage 等
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

-- 网页问答凭据（客服小部件）
CREATE TABLE IF NOT EXISTS widget_tokens (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- 商家知识库（agent_id 为空 = 全店共享；FTS5 trigram 支持中文子串检索）
CREATE TABLE IF NOT EXISTS kb_docs (
  id          TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  agent_id    TEXT REFERENCES agents(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_merchant ON kb_docs(merchant_id, updated_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(doc_id UNINDEXED, title, content, tokenize='trigram');

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT,
  merchant_id TEXT,
  action      TEXT NOT NULL,
  detail      TEXT DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
`;

const now = () => Date.now();

/** 轻量数据层：持有 DatabaseSync + 常用查询。所有多租户查询必须带 merchant_id。 */
export class KefuStore {
  constructor(dbPath) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
    this.now = now;
  }

  close() {
    this.db.close();
  }

  // ---------- merchants ----------
  createMerchant({ id = randomUUID(), name, contact = "", dataDir }) {
    const t = now();
    this.db.prepare(
      `INSERT INTO merchants (id, name, contact, status, data_dir, settings, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, '{}', ?, ?)`
    ).run(id, name, contact, dataDir, t, t);
    return this.getMerchant(id);
  }

  getMerchant(id) {
    return this.db.prepare("SELECT * FROM merchants WHERE id = ?").get(id) ?? null;
  }

  listMerchants() {
    return this.db.prepare("SELECT * FROM merchants ORDER BY created_at ASC").all();
  }

  updateMerchant(id, fields) {
    const allowed = ["name", "contact", "status", "settings"];
    const sets = [];
    const vals = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      vals.push(typeof fields[key] === "object" ? JSON.stringify(fields[key]) : fields[key]);
    }
    if (sets.length === 0) return this.getMerchant(id);
    sets.push("updated_at = ?");
    vals.push(now());
    this.db.prepare(`UPDATE merchants SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.getMerchant(id);
  }

  countMerchants() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM merchants").get().n;
  }

  // ---------- users ----------
  createUser({ id = randomUUID(), merchantId = null, username, passwordHash, passwordSalt, role, displayName = "" }) {
    const t = now();
    this.db.prepare(
      `INSERT INTO users (id, merchant_id, username, password_hash, password_salt, role, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(id, merchantId, username, passwordHash, passwordSalt, role, displayName, t, t);
    return this.getUserByUsername(username);
  }

  getUserByUsername(username) {
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) ?? null;
  }

  getUser(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) ?? null;
  }

  listUsers(merchantId = null) {
    if (merchantId) {
      return this.db.prepare("SELECT * FROM users WHERE merchant_id = ? ORDER BY created_at ASC").all(merchantId);
    }
    return this.db.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
  }

  updateUser(id, fields) {
    const allowed = ["display_name", "status", "role", "password_hash", "password_salt", "login_fail", "locked_until", "last_login_at"];
    const sets = [];
    const vals = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
    if (sets.length === 0) return this.getUser(id);
    sets.push("updated_at = ?");
    vals.push(now());
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.getUser(id);
  }

  deleteUser(id) {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  countUsers(merchantId = null) {
    if (merchantId) return this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE merchant_id = ?").get(merchantId).n;
    return this.db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  }

  // ---------- sessions ----------
  createSession({ tokenHash, userId, merchantId, ttlMs, userAgent = "" }) {
    const t = now();
    this.db.prepare(
      `INSERT INTO sessions (token_hash, user_id, merchant_id, created_at, expires_at, last_seen_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(tokenHash, userId, merchantId, t, t + ttlMs, t, userAgent);
  }

  getSession(tokenHash) {
    const s = this.db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) ?? null;
    if (!s) return null;
    if (s.expires_at < now()) {
      this.deleteSession(tokenHash);
      return null;
    }
    return s;
  }

  touchSession(tokenHash) {
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now(), tokenHash);
  }

  deleteSession(tokenHash) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteUserSessions(userId) {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  // ---------- tiers ----------
  createTier({ id = randomUUID(), name, description = "", provider, model, maxTokens = null, enabled = 1 }) {
    this.db.prepare(
      `INSERT INTO tiers (id, name, description, provider, model, max_tokens, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, description, provider, model, maxTokens, enabled, now());
    return this.getTier(id);
  }

  getTier(id) {
    return this.db.prepare("SELECT * FROM tiers WHERE id = ?").get(id) ?? null;
  }

  listTiers(enabledOnly = false) {
    if (enabledOnly) return this.db.prepare("SELECT * FROM tiers WHERE enabled = 1 ORDER BY created_at ASC").all();
    return this.db.prepare("SELECT * FROM tiers ORDER BY created_at ASC").all();
  }

  updateTier(id, fields) {
    const allowed = ["name", "description", "provider", "model", "max_tokens", "enabled"];
    const sets = [];
    const vals = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
    if (sets.length === 0) return this.getTier(id);
    this.db.prepare(`UPDATE tiers SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.getTier(id);
  }

  deleteTier(id) {
    this.db.prepare("UPDATE agents SET tier_id = NULL WHERE tier_id = ?").run(id);
    this.db.prepare("DELETE FROM tiers WHERE id = ?").run(id);
  }

  // ---------- agents ----------
  createAgent({ id = randomUUID(), merchantId, name, avatar = "", persona = "", tierId = null, welcomeMessage = "" }) {
    const t = now();
    this.db.prepare(
      `INSERT INTO agents (id, merchant_id, name, avatar, persona, tier_id, welcome_message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?)`
    ).run(id, merchantId, name, avatar, persona, tierId, welcomeMessage, t, t);
    return this.getAgent(id);
  }

  getAgent(id) {
    return this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) ?? null;
  }

  listAgents(merchantId) {
    return this.db
      .prepare("SELECT * FROM agents WHERE merchant_id = ? ORDER BY created_at ASC")
      .all(merchantId);
  }

  updateAgent(id, fields) {
    const allowed = ["name", "avatar", "persona", "tier_id", "welcome_message", "status"];
    const sets = [];
    const vals = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
    if (sets.length === 0) return this.getAgent(id);
    sets.push("updated_at = ?");
    vals.push(now());
    this.db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.getAgent(id);
  }

  deleteAgent(id) {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  countAgents(merchantId = null) {
    if (merchantId) return this.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE merchant_id = ?").get(merchantId).n;
    return this.db.prepare("SELECT COUNT(*) AS n FROM agents").get().n;
  }

  // ---------- conversations ----------
  createConversation({ id = randomUUID(), merchantId, agentId = null, channel = "console", title = "", dshSessionId, createdBy = null, meta = {} }) {
    const t = now();
    this.db.prepare(
      `INSERT INTO conversations (id, merchant_id, agent_id, channel, title, status, dsh_session_id, created_by, created_at, updated_at, meta)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
    ).run(id, merchantId, agentId, channel, title, dshSessionId, createdBy, t, t, JSON.stringify(meta));
    return this.getConversation(id);
  }

  getConversation(id) {
    const c = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) ?? null;
    if (c) c.meta = safeJson(c.meta);
    return c;
  }

  listConversations({ merchantId, agentId = null, status = null, channel = null, limit = 50, offset = 0 }) {
    const where = ["c.merchant_id = ?"];
    const vals = [merchantId];
    if (agentId) { where.push("c.agent_id = ?"); vals.push(agentId); }
    if (status) { where.push("c.status = ?"); vals.push(status); }
    if (channel) { where.push("c.channel = ?"); vals.push(channel); }
    vals.push(limit, offset);
    const rows = this.db
      .prepare(
        `SELECT c.*, a.name AS agent_name, a.avatar AS agent_avatar,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c LEFT JOIN agents a ON a.id = c.agent_id
         WHERE ${where.join(" AND ")} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...vals);
    for (const r of rows) r.meta = safeJson(r.meta);
    return rows;
  }

  updateConversation(id, fields) {
    const allowed = ["status", "title", "meta"];
    const sets = [];
    const vals = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      vals.push(typeof fields[key] === "object" ? JSON.stringify(fields[key]) : fields[key]);
    }
    if (sets.length === 0) return this.getConversation(id);
    sets.push("updated_at = ?");
    vals.push(now());
    this.db.prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.getConversation(id);
  }

  countConversations(merchantId = null, since = 0) {
    if (merchantId) {
      return this.db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE merchant_id = ? AND created_at >= ?").get(merchantId, since).n;
    }
    return this.db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?").get(since).n;
  }

  // ---------- messages ----------
  addMessage({ id = randomUUID(), conversationId, role, content, meta = {} }) {
    const t = now();
    this.db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, created_at, meta) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, conversationId, role, content, t, JSON.stringify(meta));
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(t, conversationId);
    return this.getMessage(id);
  }

  getMessage(id) {
    const m = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) ?? null;
    if (m) m.meta = safeJson(m.meta);
    return m;
  }

  listMessages(conversationId, limit = 200) {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?")
      .all(conversationId, limit);
    for (const r of rows) r.meta = safeJson(r.meta);
    return rows;
  }

  countMessages(merchantId = null, since = 0) {
    if (merchantId) {
      return this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE c.merchant_id = ? AND m.created_at >= ?`
        )
        .get(merchantId, since).n;
    }
    return this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?").get(since).n;
  }

  // ---------- widget tokens ----------
  createWidgetToken({ id = randomUUID(), agentId, token }) {
    this.db.prepare("INSERT INTO widget_tokens (id, agent_id, token, enabled, created_at) VALUES (?, ?, ?, 1, ?)").run(id, agentId, token, now());
    return this.getWidgetToken(token);
  }

  getWidgetToken(token) {
    return this.db.prepare("SELECT * FROM widget_tokens WHERE token = ?").get(token) ?? null;
  }

  listWidgetTokens(agentId) {
    return this.db.prepare("SELECT id, agent_id, token, enabled, created_at FROM widget_tokens WHERE agent_id = ?").all(agentId);
  }

  updateWidgetToken(token, fields) {
    const allowed = ["enabled"];
    const sets = [];
    const vals = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
    if (sets.length === 0) return this.getWidgetToken(token);
    this.db.prepare(`UPDATE widget_tokens SET ${sets.join(", ")} WHERE token = ?`).run(...vals, token);
    return this.getWidgetToken(token);
  }

  deleteWidgetToken(token) {
    this.db.prepare("DELETE FROM widget_tokens WHERE token = ?").run(token);
  }

  // ---------- 知识库 ----------
  createKbDoc({ id = randomUUID(), merchantId, agentId = null, title, content, tags = "" }) {
    const t = now();
    this.db.prepare(
      `INSERT INTO kb_docs (id, merchant_id, agent_id, title, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, merchantId, agentId, title, content, tags, t, t);
    this.db.prepare("INSERT INTO kb_fts (doc_id, title, content) VALUES (?, ?, ?)").run(id, title, content);
    return this.getKbDoc(id);
  }

  getKbDoc(id) {
    return this.db.prepare("SELECT * FROM kb_docs WHERE id = ?").get(id) ?? null;
  }

  listKbDocs(merchantId, agentId = null) {
    if (agentId) {
      return this.db.prepare("SELECT * FROM kb_docs WHERE merchant_id = ? AND (agent_id = ? OR agent_id IS NULL) ORDER BY updated_at DESC").all(merchantId, agentId);
    }
    return this.db.prepare("SELECT * FROM kb_docs WHERE merchant_id = ? ORDER BY updated_at DESC").all(merchantId);
  }

  updateKbDoc(id, fields) {
    const allowed = ["title", "content", "tags", "agent_id"];
    const sets = [];
    const vals = [];
    for (const key of Object.keys(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
    if (sets.length === 0) return this.getKbDoc(id);
    sets.push("updated_at = ?");
    vals.push(now());
    this.db.prepare(`UPDATE kb_docs SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    const doc = this.getKbDoc(id);
    if (doc) {
      this.db.prepare("DELETE FROM kb_fts WHERE doc_id = ?").run(id);
      this.db.prepare("INSERT INTO kb_fts (doc_id, title, content) VALUES (?, ?, ?)").run(id, doc.title, doc.content);
    }
    return doc;
  }

  deleteKbDoc(id) {
    this.db.prepare("DELETE FROM kb_docs WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM kb_fts WHERE doc_id = ?").run(id);
  }

  countKbDocs(merchantId) {
    return this.db.prepare("SELECT COUNT(*) AS n FROM kb_docs WHERE merchant_id = ?").get(merchantId).n;
  }

  /**
   * 知识库检索（v1 混合检索）：
   * 1) FTS5 trigram 整句/子句短语匹配（精确）；
   * 2) 未命中时按 2 字窗口提取关键词做 LIKE 模糊匹配（召回，中文口语问题常用）；
   * 按命中顺序去重返回。
   * @returns {Array<{id, title, content, tags}>}
   */
  searchKnowledge(merchantId, agentId, query, limit = 5) {
    const q = String(query ?? "").trim();
    if (q.length < 3) return [];
    const seen = new Set();
    const hits = [];
    const push = (row) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      hits.push({ id: row.id, title: row.title, content: row.content, tags: row.tags });
    };
    const escape = (s) => String(s).replace(/"/g, '""');

    // ---- 1) FTS5 trigram 短语匹配 ----
    const candidates = [q];
    const parts = q.split(/[，。！？、；,.!?;\s]+/).map((s) => s.trim()).filter((s) => s.length >= 3);
    for (const p of parts) if (!candidates.includes(p)) candidates.push(p);
    for (const cand of candidates.slice(0, 12)) {
      const rows = this.db.prepare(
        `SELECT f.doc_id AS id, d.title, d.content, d.tags, f.rank
         FROM kb_fts f JOIN kb_docs d ON d.id = f.doc_id
         WHERE d.merchant_id = ? AND (d.agent_id = ? OR d.agent_id IS NULL)
           AND kb_fts MATCH ?
         ORDER BY f.rank LIMIT ?`
      ).all(merchantId, agentId, `"${escape(cand)}"`, limit);
      for (const row of rows) {
        push(row);
        if (hits.length >= limit) return hits;
      }
    }

    // ---- 2) LIKE 关键词回退（2 字窗口，去停用词） ----
    if (hits.length === 0) {
      const STOP = "的了是在有我你他她它你们我们咱们什么怎么请问哪个哪家多久发会能可以吗呢啊吧呀哦与和或及这那要多少钱价格";
      const cleaned = q.replace(/[，。！？、；,.!?;\s'"“”‘’]+/g, "");
      const grams = new Set();
      for (let i = 0; i + 2 <= cleaned.length; i++) {
        const g = cleaned.slice(i, i + 2);
        if (STOP.includes(g)) continue;
        grams.add(g);
      }
      const base = "SELECT id, title, content, tags FROM kb_docs WHERE merchant_id = ? AND (agent_id = ? OR agent_id IS NULL) AND (content LIKE ? OR title LIKE ?) ORDER BY updated_at DESC LIMIT ?";
      const stmt = this.db.prepare(base);
      for (const g of [...grams].slice(0, 10)) {
        const rows = stmt.all(merchantId, agentId, `%${g}%`, `%${g}%`, limit);
        for (const row of rows) {
          push(row);
          if (hits.length >= limit) return hits;
        }
      }
    }
    return hits;
  }

  // ---------- audit ----------
  audit({ actorId = null, merchantId = null, action, detail = "" }) {
    this.db.prepare("INSERT INTO audit_log (actor_id, merchant_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(actorId, merchantId, action, detail, now());
  }

  recentAudit(limit = 50) {
    return this.db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?").all(limit);
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export { now, safeJson };
