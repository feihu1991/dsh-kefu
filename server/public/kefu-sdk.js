/**
 * dsh-kefu 网页客服 SDK（v2 悬浮球）
 *
 * 用法（商家店铺页面引入一行即可）：
 *   <script src="https://SERVER/kefu/kefu-sdk.js"
 *           data-token="<网页客服凭据>"
 *           data-server="https://SERVER"           // 可选，默认取脚本域名
 *           data-base-path="/kefu"                 // 可选，默认从脚本 URL 推导
 *           data-title="在线客服"></script>
 *
 * 能力：右下角悬浮气泡 -> 聊天面板；服务端签名的 visitorId 存 localStorage 续接会话；
 *      欢迎语；发送中状态；跨域调用 widget API。
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var token = script.getAttribute("data-token") || "";
  var server = (script.getAttribute("data-server") || location.origin).replace(/\/+$/, "");
  var basePath = script.hasAttribute("data-base-path") ? script.getAttribute("data-base-path") : null;
  if (basePath === null) {
    try {
      var scriptPath = new URL(script.src, location.href).pathname;
      if (/\/kefu-sdk\.js$/.test(scriptPath)) basePath = scriptPath.replace(/\/kefu-sdk\.js$/, "");
      else basePath = "/kefu";
    } catch (_) { basePath = "/kefu"; }
  }
  var title = script.getAttribute("data-title") || "在线客服";
  if (!token) { console.error("[kefu-sdk] 缺少 data-token"); return; }
  var API = server + basePath + "/api/widget/" + token;

  function loadVisitor() {
    var stored = localStorage.getItem("kefu_visitor");
    if (stored && /\.[0-9a-f]{32}$/.test(stored)) return Promise.resolve(stored);
    return fetch(API + "/visitor")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) throw new Error(d.error.message);
        localStorage.setItem("kefu_visitor", d.data.visitorId);
        return d.data.visitorId;
      });
  }
  var visitorPromise = loadVisitor();

  var COLORS = {
    primary: script.getAttribute("data-color") || "#4f6ef7",
    bg: "#ffffff", text: "#172035", muted: "#7b879f", line: "#e3e9f3",
  };
  var style = document.createElement("style");
  style.textContent =
    "#kefu-sdk-root{position:fixed;right:24px;bottom:24px;z-index:2147483000;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}" +
    "#kefu-sdk-root *{box-sizing:border-box;margin:0;padding:0}" +
    ".kefu-bubble{position:relative;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg," + COLORS.primary + ",#7b93ff);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 12px 26px rgba(79,110,247,.36);transition:transform .16s,box-shadow .16s;border:0}" +
    ".kefu-bubble::after{content:'';position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(123,147,255,.35);animation:kefu-pulse 2.4s ease-out infinite}" +
    ".kefu-bubble:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 16px 32px rgba(79,110,247,.44)}" +
    ".kefu-bubble svg{width:28px;height:28px;fill:#fff;position:relative;z-index:1}" +
    ".kefu-panel{position:absolute;right:0;bottom:74px;width:360px;max-width:calc(100vw - 32px);height:510px;max-height:calc(100vh - 120px);background:" + COLORS.bg + ";border-radius:20px;box-shadow:0 26px 70px rgba(23,34,63,.28);display:none;flex-direction:column;overflow:hidden;border:1px solid " + COLORS.line + "}" +
    ".kefu-panel.open{display:flex;animation:kefu-pop .2s ease}" +
    ".kefu-head{position:relative;background:linear-gradient(120deg," + COLORS.primary + " 0%,#7b93ff 62%,#9b6bff 100%);color:#fff;padding:15px 16px;display:flex;align-items:center;gap:11px;box-shadow:0 10px 26px rgba(79,110,247,.24)}" +
    ".kefu-avatar{width:38px;height:38px;border-radius:13px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.34);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}" +
    ".kefu-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}" +
    ".kefu-head .t{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".kefu-head .s{font-size:11px;opacity:.9;display:flex;align-items:center;gap:5px}" +
    ".kefu-head .s::before{content:'';width:6px;height:6px;border-radius:50%;background:#7CFFB2;box-shadow:0 0 0 3px rgba(124,255,178,.22)}" +
    ".kefu-head .x{cursor:pointer;opacity:.9;font-size:15px;padding:4px 6px;border-radius:8px;transition:background .14s}" +
    ".kefu-head .x:hover{background:rgba(255,255,255,.16)}" +
    ".kefu-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:11px;background:linear-gradient(180deg,#f8faff,#f4f7ff)}" +
    ".kefu-body::-webkit-scrollbar{width:6px}.kefu-body::-webkit-scrollbar-thumb{background:#c9d3e6;border-radius:99px}" +
    ".kefu-msg{max-width:82%;padding:10px 13px;border-radius:16px;line-height:1.6;font-size:13px;white-space:pre-wrap;word-break:break-word;color:" + COLORS.text + ";animation:kefu-msg .18s ease}" +
    ".kefu-msg.user{align-self:flex-end;background:linear-gradient(135deg," + COLORS.primary + ",#7b93ff);color:#fff;border-bottom-right-radius:5px;box-shadow:0 8px 18px rgba(79,110,247,.22)}" +
    ".kefu-msg.bot{align-self:flex-start;background:#fff;border:1px solid " + COLORS.line + ";border-bottom-left-radius:5px;box-shadow:0 4px 14px rgba(23,34,63,.06)}" +
    ".kefu-msg .who{font-size:11px;color:" + COLORS.muted + ";margin-bottom:4px;font-weight:650}" +
    ".kefu-msg.user .who{color:rgba(255,255,255,.78)}" +
    ".kefu-input{display:flex;gap:9px;padding:12px;border-top:1px solid " + COLORS.line + ";background:rgba(255,255,255,.96);backdrop-filter:blur(10px)}" +
    ".kefu-input textarea{flex:1;resize:none;height:46px;padding:10px 12px;border:1px solid " + COLORS.line + ";border-radius:13px;font:inherit;font-size:13px;outline:none;color:" + COLORS.text + ";background:#f8fafd;transition:border-color .15s,box-shadow .15s,background .15s}" +
    ".kefu-input textarea:focus{border-color:#7b93ff;background:#fff;box-shadow:0 0 0 4px rgba(79,110,247,.1)}" +
    ".kefu-input button{min-width:68px;padding:0 15px;border:0;border-radius:13px;background:linear-gradient(135deg," + COLORS.primary + ",#7b93ff);color:#fff;font-size:13px;font-weight:650;cursor:pointer;box-shadow:0 10px 20px rgba(79,110,247,.24);transition:transform .14s,box-shadow .14s}" +
    ".kefu-input button:hover{transform:translateY(-1px);box-shadow:0 13px 24px rgba(79,110,247,.3)}" +
    ".kefu-input button:disabled{opacity:.5;transform:none;box-shadow:none}" +
    ".kefu-typing{color:" + COLORS.muted + ";font-size:12px;padding:4px 2px;animation:kefu-blink 1.2s ease-in-out infinite}" +
    "@keyframes kefu-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}" +
    "@keyframes kefu-msg{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}" +
    "@keyframes kefu-pulse{0%{transform:scale(.92);opacity:.8}70%{transform:scale(1.12);opacity:0}100%{transform:scale(1.12);opacity:0}}" +
    "@keyframes kefu-blink{0%,100%{opacity:.45}50%{opacity:1}}";
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.id = "kefu-sdk-root";
  root.innerHTML =
    '<div class="kefu-panel" id="kefu-panel">' +
    '  <div class="kefu-head">' +
    '    <span class="kefu-avatar">客</span>' +
    '    <div class="kefu-meta"><span class="t" id="kefu-title"></span><span class="s">在线 · 通常即时回复</span></div>' +
    "    <span class='x' id='kefu-close'>✕</span>" +
    "  </div>" +
    '  <div class="kefu-body" id="kefu-body"></div>' +
    '  <div class="kefu-input"><textarea id="kefu-text" placeholder="请输入您的问题…"></textarea><button id="kefu-send">发送</button></div>' +
    "</div>" +
    '<button class="kefu-bubble" id="kefu-bubble" title="在线客服" aria-label="在线客服">' +
    '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6 2 11c0 2.8 1.5 5.3 3.9 6.9L5 22l4.3-2.3c.9.2 1.8.3 2.7.3 5.5 0 10-4 10-9S17.5 2 12 2zm-4 9.5A1.5 1.5 0 1 1 9.5 10 1.5 1.5 0 0 1 8 11.5zm8 0A1.5 1.5 0 1 1 17.5 10 1.5 1.5 0 0 1 16 11.5z"/></svg>' +
    "</button>";
  document.body.appendChild(root);
  root.querySelector("#kefu-title").textContent = title;

  var panel = root.querySelector("#kefu-panel");
  var body = root.querySelector("#kefu-body");
  var input = root.querySelector("#kefu-text");
  var sendBtn = root.querySelector("#kefu-send");
  var bubble = root.querySelector("#kefu-bubble");
  var busy = false;
  var agentName = "客服";

  function add(role, text) {
    var div = document.createElement("div");
    div.className = "kefu-msg " + (role === "user" ? "user" : "bot");
    var who = document.createElement("div");
    who.className = "who";
    who.textContent = role === "user" ? "我" : agentName;
    div.appendChild(who);
    var span = document.createElement("span");
    span.textContent = text;
    div.appendChild(span);
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return span;
  }

  function typing(on) {
    var old = body.querySelector(".kefu-typing");
    if (old) old.remove();
    if (on) {
      var d = document.createElement("div");
      d.className = "kefu-typing";
      d.textContent = agentName + " 正在输入…";
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
    }
  }

  function send() {
    var content = input.value.trim();
    if (!content || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    add("user", content);
    typing(true);
    visitorPromise.then(function (visitorId) {
      return fetch(API + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content, visitorId: visitorId }),
      });
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing(false);
        if (d.error) throw new Error(d.error.message);
        add("bot", d.data.message.content);
      })
      .catch(function (e) {
        typing(false);
        add("bot", "抱歉，回复失败：" + e.message);
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
      });
  }

  bubble.onclick = function () { panel.classList.add("open"); };
  root.querySelector("#kefu-close").onclick = function () { panel.classList.remove("open"); };
  sendBtn.onclick = send;
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  fetch(API + "/config")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.error) throw new Error(d.error.message);
      agentName = d.data.agentName || "客服";
      root.querySelector("#kefu-title").textContent = (d.data.merchantName || title) + " · " + agentName;
      if (d.data.welcomeMessage) add("bot", d.data.welcomeMessage);
    })
    .catch(function () { /* 配置失败不阻塞使用 */ });
})();
