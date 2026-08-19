// API 客户端：自动带 token，SSE 聊天支持
const BASE = "/kefu/api";

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch { /* 空响应 */ }
  if (!res.ok) {
    const err = new Error(payload?.error?.message ?? `请求失败 (${res.status})`);
    err.code = payload?.error?.code;
    err.status = res.status;
    throw err;
  }
  return payload?.data ?? payload;
}

export function setToken(token) {
  // 会话同时走 HttpOnly Cookie（服务端已种），token 仅用于需要显式携带的场景
  if (token) localStorage.setItem("kefu_token", token);
  else localStorage.removeItem("kefu_token");
}

export function getToken() {
  return localStorage.getItem("kefu_token");
}

/** SSE 聊天：POST 消息并流式接收 delta/done/error */
export async function chatStream(conversationId, content, handlers) {
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ content }),
    credentials: "same-origin",
  });
  if (!res.ok || !res.body) {
    let payload = null;
    try { payload = await res.json(); } catch { /* ignore */ }
    throw new Error(payload?.error?.message ?? `请求失败 (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (event === "delta") handlers.onDelta?.(parsed);
      else if (event === "done") { handlers.onDone?.(parsed); return parsed; }
      else if (event === "error") throw new Error(parsed.message ?? "客服响应失败");
      else if (event === "started") handlers.onStarted?.(parsed);
    }
  }
  throw new Error("连接中断");
}
