// dsh-kefu — 限流：滑动窗口计数（内存实现，简单可靠）
const WINDOW_MS = 60 * 1000;

/** 内存滑动窗口限流器 */
export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.perMinute - 每分钟允许次数
   * @param {number} [opts.burst] - 窗口内硬上限（默认 = perMinute * 2；小于 perMinute 时更严格）
   * @param {number} [opts.maxKeys] - 最多跟踪的 key 数量，防止伪造来源导致内存膨胀
   */
  constructor({ perMinute, burst, maxKeys = 50000 }) {
    this.perMinute = perMinute;
    this.burst = burst ?? perMinute * 2;
    this.maxKeys = maxKeys;
    this.windows = new Map(); // key -> number[] timestamps
    this.lastSweep = Date.now();
  }

  /**
   * @param {string} key - 限流键（如 `user:xxx:chat` / `ip:1.2.3.4:widget`）
   * @returns {{allowed: boolean, remaining: number, retryAfterMs: number}}
   */
  check(key, now = Date.now()) {
    if (now - this.lastSweep > WINDOW_MS) {
      this.sweep(now);
      this.lastSweep = now;
    }
    let hits = this.windows.get(key);
    if (!hits) {
      // 新 key 先清理过期窗口；仍达到上限则拒绝新来源，避免无界增长。
      if (this.windows.size >= this.maxKeys) {
        this.sweep(now);
        if (this.windows.size >= this.maxKeys) {
          return { allowed: false, remaining: 0, retryAfterMs: WINDOW_MS };
        }
      }
      hits = [];
      this.windows.set(key, hits);
    }
    while (hits.length > 0 && hits[0] <= now - WINDOW_MS) hits.shift();
    const limit = Math.min(this.perMinute, this.burst);
    const allowed = hits.length < limit;
    if (allowed) hits.push(now);
    const remaining = Math.max(0, limit - hits.length);
    const retryAfterMs = hits.length > 0 ? Math.max(0, WINDOW_MS - (now - hits[0])) : 0;
    return { allowed, remaining, retryAfterMs };
  }

  sweep(now) {
    for (const [key, hits] of this.windows) {
      while (hits.length > 0 && hits[0] <= now - WINDOW_MS) hits.shift();
      if (hits.length === 0) this.windows.delete(key);
    }
  }

  get size() {
    return this.windows.size;
  }
}

/** 基于插件配置构造限流器集合 */
export function createLimiters(config) {
  const chat = new RateLimiter({
    perMinute: config.rateLimit?.perMinute ?? 30,
    burst: config.rateLimit?.burst ?? 60,
  });
  const auth = new RateLimiter({
    perMinute: config.rateLimit?.authPerMinute ?? 10,
    burst: config.rateLimit?.authBurst ?? 20,
  });
  const widget = new RateLimiter({
    perMinute: config.rateLimit?.widgetPerMinute ?? 10,
    burst: config.rateLimit?.widgetBurst ?? 20,
  });
  const ip = new RateLimiter({
    perMinute: config.rateLimit?.ipPerMinute ?? 60,
    burst: config.rateLimit?.ipBurst ?? 120,
  });
  return { chat, auth, widget, ip };
}

/**
 * 解析客户端 IP。
 *
 * 默认只信任 TCP 对端地址；只有显式开启 trustProxy 时才读取
 * X-Forwarded-For，并且取最右侧的值（可信反代追加的真实客户端 IP），
 * 避免请求方自行伪造左侧条目绕过限流。
 */
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const fwd = req.headers["x-forwarded-for"];
    if (fwd) {
      const parts = String(fwd).split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
  }
  return req.socket?.remoteAddress ?? "unknown";
}
