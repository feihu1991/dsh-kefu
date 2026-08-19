// dsh-kefu — 账号认证：scrypt 密码、会话 token、角色权限
import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt);
const SCRYPT_KEYLEN = 64;

export const ROLES = {
  SUPERADMIN: "superadmin",
  MERCHANT_ADMIN: "merchant_admin",
  MERCHANT_STAFF: "merchant_staff",
};

/** 密码散列：`scrypt$N$r$p$salt$hash` */
export async function hashPassword(password, { N = 16384, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt}$${hash.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, salt, hashHex] = String(stored).split("$");
    if (algo !== "scrypt") return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 登录失败锁定：连续失败 maxFails 次锁 lockMs 毫秒；返回剩余锁定毫秒数 */
export function lockedRemainingMs(user, maxFails = 5, lockMs = 15 * 60 * 1000) {
  if (user.login_fail >= maxFails) {
    const remain = user.locked_until - Date.now();
    if (remain > 0) return remain;
  }
  return 0;
}

export function registerLoginFailure(store, user) {
  const fails = (user.login_fail ?? 0) + 1;
  const locked = fails >= 5 ? Date.now() + 15 * 60 * 1000 : (user.locked_until ?? 0);
  store.updateUser(user.id, { login_fail: fails, locked_until: locked });
}

export function clearLoginFailures(store, user) {
  store.updateUser(user.id, { login_fail: 0, locked_until: 0, last_login_at: Date.now() });
}

/** 生成会话 token（返回明文；库中只存 sha256） */
export function issueSessionToken(store, { userId, merchantId, ttlMs, userAgent = "" }) {
  const token = randomBytes(32).toString("hex");
  store.createSession({ tokenHash: sha256(token), userId, merchantId, ttlMs, userAgent });
  return token;
}

export function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

/** 从 Authorization / Cookie 中解析会话 token */
export function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.slice(7).trim();
  const cookie = req.headers.cookie ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "kefu_session") return rest.join("=");
  }
  return null;
}

/**
 * 认证：把 {user, merchant, session, token} 挂到返回对象上；无效返回 null。
 */
export function authenticate(store, req) {
  const token = extractToken(req);
  if (!token) return null;
  const session = store.getSession(sha256(token));
  if (!session) return null;
  const user = store.getUser(session.user_id);
  if (!user || user.status !== "active") return null;
  const merchant = user.merchant_id ? store.getMerchant(user.merchant_id) : null;
  if (user.merchant_id && (!merchant || merchant.status !== "active")) return null;
  store.touchSession(session.token_hash);
  return { user, merchant, session, token };
}

export function hasRole(user, ...roles) {
  return roles.includes(user.role);
}

/** 公开信息投影（不泄露密码/盐） */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    status: user.status,
    merchant_id: user.merchant_id,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

export function publicMerchant(merchant) {
  if (!merchant) return null;
  return {
    id: merchant.id,
    name: merchant.name,
    contact: merchant.contact,
    status: merchant.status,
    created_at: merchant.created_at,
  };
}
