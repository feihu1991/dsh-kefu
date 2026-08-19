/**
 * dsh-kefu 网页客服 SDK（v2 悬浮球）
 *
 * 用法（商家店铺页面引入一行即可）：
 *   <script src="https://SERVER/kefu/kefu-sdk.js"
 *           data-token="<网页客服凭据>"
 *           data-server="https://SERVER"           // 可选，默认取脚本域名
 *           data-title="在线客服"></script>
 *
 * 能力：右下角悬浮气泡 -> 聊天面板；visitorId 存 localStorage 续接会话；
 *      欢迎语；发送中状态；跨域调用 widget API。
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var token = script.getAttribute("data-token") || "";
  var server = (script.getAttribute("data-server") || location.origin).replace(/\/+$/, "");
  var title = script.getAttribute("data-title") || "在线客服";
  if (!token) { console.error("[kefu-sdk] 缺少 data-token"); return; }
  var API = server + "/kefu/api/widget/" + token;

  var visitorId = localStorage.getItem("kefu_visitor") || Math.random().toString(36).slice(2, 12);
  localStorage.setItem("kefu_visitor", visitorId);

  var COLORS = {
    primary: script.getAttribute("data-color") || "#4d6bfe",
    bg: "#ffffff", text: "#1f2430", muted: "#8b96ad", line: "#e3e7f0",
  };
  var style = document.createElement("style");
  style.textContent =
    "#kefu-sdk-root{position:fixed;right:24px;bottom:24px;z-index:2147483000;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}" +
    "#kefu-sdk-root *{box-sizing:border-box;margin:0;padding:0}" +
    ".kefu-bubble{width:56px;height:56px;border-radius:50%;background:" + COLORS.primary + ";color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.22);transition:transform .15s;border:0}" +
    ".kefu-bubble:hover{transform:scale(1.06)}" +
    ".kefu-bubble svg{width:28px;height:28px;fill:#fff}" +
    ".kefu-panel{position:absolute;right:0;bottom:66px;width:340px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 120px);background:" + COLORS.bg + ";border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;border:1px solid " + COLORS.line + "}" +
    ".kefu-panel.open{display:flex}" +
    ".kefu-head{background:" + COLORS.primary + ";color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}" +
    ".kefu-head .t{font-weight:600;flex:1}" +
    ".kefu-head .x{cursor:pointer;opacity:.85;font-size:16px;padding:2px 6px}" +
    ".kefu-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:" + COLORS.bg + "}" +
    ".kefu-msg{max-width:82%;padding:9px 12px;border-radius:12px;line-height:1.6;font-size:13px;white-space:pre-wrap;word-break:break-word;color:" + COLORS.text + "}" +
    ".kefu-msg.user{align-self:flex-end;background:" + COLORS.primary + ";color:#fff;border-bottom-right-radius:4px}" +
    ".kefu-msg.bot{align-self:flex-start;background:#f2f4f8;border-bottom-left-radius:4px}" +
    ".kefu-msg .who{font-size:11px;color:" + COLORS.muted + ";margin-bottom:3px}" +
    ".kefu-input{display:flex;gap:8px;padding:10px;border-top:1px solid " + COLORS.line + ";background:" + COLORS.bg + "}" +
    ".kefu-input textarea{flex:1;resize:none;height:44px;padding:9px 10px;border:1px solid " + COLORS.line + ";border-radius:8px;font:inherit;font-size:13px;outline:none;color:" + COLORS.text + "}" +
    ".kefu-input button{padding:0 16px;border:0;border-radius:8px;background:" + COLORS.primary + ";color:#fff;font-size:13px;cursor:pointer}" +
    ".kefu-input button:disabled{opacity:.5}" +
    ".kefu-typing{color:" + COLORS.muted + ";font-size:12px;padding:4px 2px}";
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.id = "kefu-sdk-root";
  root.innerHTML =
    '<div class="kefu-panel" id="kefu-panel">' +
    '  <div class="kefu-head"><span class="t" id="kefu-title">' + title + "</span><span class='x' id='kefu-close'>✕</span></div>" +
    '  <div class="kefu-body" id="kefu-body"></div>' +
    '  <div class="kefu-input"><textarea id="kefu-text" placeholder="请输入您的问题…"></textarea><button id="kefu-send">发送</button></div>' +
    "</div>" +
    '<button class="kefu-bubble" id="kefu-bubble" title="在线客服" aria-label="在线客服">' +
    '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6 2 11c0 2.8 1.5 5.3 3.9 6.9L5 22l4.3-2.3c.9.2 1.8.3 2.7.3 5.5 0 10-4 10-9S17.5 2 12 2zm-4 9.5A1.5 1.5 0 1 1 9.5 10 1.5 1.5 0 0 1 8 11.5zm8 0A1.5 1.5 0 1 1 17.5 10 1.5 1.5 0 0 1 16 11.5z"/></svg>' +
    "</button>";
  document.body.appendChild(root);

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
    fetch(API + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content, visitorId: visitorId }),
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
