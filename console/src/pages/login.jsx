import React, { useState } from "react";
import { api } from "../api.js";

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", password: "", name: "", displayName: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "login") {
        await api("/auth/login", { method: "POST", body: { username: form.username, password: form.password } });
        const me = await api("/auth/me");
        onLogin(me);
      } else {
        await api("/auth/register", {
          method: "POST",
          body: { name: form.name, username: form.username, password: form.password, displayName: form.displayName },
        });
        await api("/auth/login", { method: "POST", body: { username: form.username, password: form.password } });
        const me = await api("/auth/me");
        onLogin(me);
      }
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>{mode === "login" ? "登录" : "注册商家"}</h1>
        <div className="sub">{mode === "login" ? "DSH 客服平台 · 商家工作台" : "创建您的商家账号，开通智能客服"}</div>
        {mode === "register" && (
          <div className="field">
            <label>商家名称</label>
            <input value={form.name} onChange={set("name")} placeholder="例如：XX旗舰店" required />
          </div>
        )}
        <div className="field">
          <label>用户名</label>
          <input value={form.username} onChange={set("username")} placeholder="登录账号" required autoComplete="username" />
        </div>
        <div className="field">
          <label>密码</label>
          <input type="password" value={form.password} onChange={set("password")} placeholder="至少 6 位" required autoComplete="current-password" />
        </div>
        {mode === "register" && (
          <div className="field">
            <label>联系人昵称（可选）</label>
            <input value={form.displayName} onChange={set("displayName")} placeholder="怎么称呼您" />
          </div>
        )}
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登 录" : "注册并登录"}</button>
        <div className="small muted" style={{ textAlign: "center", marginTop: 14 }}>
          {mode === "login" ? (
            <a onClick={() => { setMode("register"); setErr(""); }}>没有账号？注册商家</a>
          ) : (
            <a onClick={() => { setMode("login"); setErr(""); }}>已有账号？去登录</a>
          )}
        </div>
      </form>
    </div>
  );
}
