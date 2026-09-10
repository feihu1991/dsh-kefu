import React, { useState } from "react";
import { api } from "../api.js";
import { Icon } from "../ui.jsx";

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
      } else {
        await api("/auth/register", {
          method: "POST",
          body: { name: form.name, username: form.username, password: form.password, displayName: form.displayName },
        });
        await api("/auth/login", { method: "POST", body: { username: form.username, password: form.password } });
      }
      const me = await api("/auth/me");
      onLogin(me);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-brand">
          <span className="logo"><Icon name="spark" size={21} /></span>
          DSH 客服平台
        </div>
        <h2>让每一次顾客咨询，都有专业客服即时响应</h2>
        <p>多租户智能客服工作台：统一管理客服团队、会话接待、知识库与网页接入，把 DeepSeek Harness 的 Agent 能力变成可直接营业的客服系统。</p>
        <div className="login-points">
          <div className="login-point"><Icon name="team" size={17} /><span>多商家隔离，多角色协作</span></div>
          <div className="login-point"><Icon name="chat" size={17} /><span>控制台 + 网页客服组件，全渠道接待</span></div>
          <div className="login-point"><Icon name="book" size={17} /><span>知识库 RAG，回答有据可依</span></div>
          <div className="login-point"><Icon name="globe" size={17} /><span>网页接入凭据、域名白名单与日额度控制</span></div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h1>{mode === "login" ? "登录工作台" : "开通商家账号"}</h1>
          <div className="login-sub">
            {mode === "login" ? "使用商家管理员或店员账号登录" : "注册后即可创建客服 Agent、接入网页客服"}
          </div>

          {mode === "register" && (
            <div className="field">
              <label>商家名称</label>
              <input value={form.name} onChange={set("name")} placeholder="例如：星河优选旗舰店" required />
            </div>
          )}
          <div className="field">
            <label>用户名</label>
            <input value={form.username} onChange={set("username")} placeholder="登录账号" autoComplete="username" required />
          </div>
          <div className="field">
            <label>密码</label>
            <input type="password" value={form.password} onChange={set("password")} placeholder="至少 6 位" autoComplete={mode === "login" ? "current-password" : "new-password"} required />
          </div>
          {mode === "register" && (
            <div className="field">
              <label>联系人昵称（可选）</label>
              <input value={form.displayName} onChange={set("displayName")} placeholder="怎么称呼您" />
            </div>
          )}

          {err && <div className="err">{err}</div>}
          <button className="btn primary block" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? <><span className="spinner" style={{ width: 15, height: 15, borderColor: "rgba(255,255,255,.4)", borderTopColor: "#fff" }} />请稍候…</> : mode === "login" ? "登录" : "注册并登录"}
          </button>
          <div className="login-switch">
            {mode === "login" ? (
              <span>还没有账号？<a onClick={() => { setMode("register"); setErr(""); }}>注册商家</a></span>
            ) : (
              <span>已有账号？<a onClick={() => { setMode("login"); setErr(""); }}>去登录</a></span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
