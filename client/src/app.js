// 客户端逻辑：读配置 -> 设置页 -> iframe 加载 {server}/kefu/
const { invoke } = window.__TAURI__;

const $ = (id) => document.getElementById(id);
const settingsEl = $("settings");
const mainEl = $("main");
const frame = $("frame");
const urlInput = $("server-url");
const statusEl = $("status");

let serverUrl = "";

function normalize(url) {
  url = (url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;
  return url;
}

async function init() {
  try {
    const cfg = await invoke("get_config");
    if (cfg.server_url) {
      urlInput.value = cfg.server_url;
      connect(cfg.server_url);
    } else {
      showSettings();
    }
  } catch (e) {
    showSettings();
    setStatus("初始化失败：" + e, true);
  }
}

function showSettings() {
  settingsEl.classList.remove("hidden");
  mainEl.classList.add("hidden");
}

async function connect(url) {
  url = normalize(url);
  serverUrl = url;
  setStatus("正在连接 " + url + " …");
  // 探活：/kefu/api/auth/me 未登录返回 401 即说明平台在线
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url + "/kefu/api/auth/me", { signal: controller.signal, mode: "cors" });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 200) {
      await invoke("set_config", { serverUrl: url });
      settingsEl.classList.add("hidden");
      mainEl.classList.remove("hidden");
      $("bar-url").textContent = url + "/kefu/";
      frame.src = url + "/kefu/";
      setStatus("");
    } else {
      setStatus("平台响应异常（HTTP " + res.status + "），请检查地址是否正确", true);
    }
  } catch (e) {
    setStatus("无法连接：" + e.message + "，请确认服务器已启动且地址可访问", true);
  }
}

function setStatus(text, isError) {
  statusEl.textContent = text || "";
  statusEl.className = "status " + (isError ? "err" : text ? "ok" : "");
}

$("save").onclick = () => connect(urlInput.value);
$("back").onclick = showSettings;
$("refresh").onclick = () => { frame.src = serverUrl + "/kefu/"; };
$("external").onclick = () => invoke("open_in_browser", { url: serverUrl + "/kefu/" });
$("open-browser").onclick = () => invoke("open_in_browser", { url: normalize(urlInput.value || "http://127.0.0.1:3080") + "/kefu/" });

urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") connect(urlInput.value); });

init();
