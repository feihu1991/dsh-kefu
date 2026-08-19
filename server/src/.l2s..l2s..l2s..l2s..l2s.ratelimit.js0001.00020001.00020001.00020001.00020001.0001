// dsh-kefu — 限流：滑动窗口计数（内存实现，简单可靠）
const WINDOW_MS = 60 * 1000;

/** 内存滑动窗口限流器 */
export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.perMinute - 每分钟允许次数
   * @param {number} [opts.burst] - 突发上限（默认 = perMinute * 2）
   */
  constructor({ perMinute, burst }) {
    this.perMinute = perMinute;
    this.burst = burst ?? perMinute * 2;
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
      hits = [];
      this.windows.set(key, hits);
    }
    while (hits.length > 0 && hits[0] <= now - WINDOW_MS) hits.shift();
    const allowed = hits.length < this.perMinute;
    if (allowed) hits.push(now);
    const remaining = Math.max(0, this.perMinute - hits.length);
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

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}
