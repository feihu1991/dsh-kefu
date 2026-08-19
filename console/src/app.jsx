import React, { useEffect, useState } from "react";
import { api, setToken, getToken } from "./api.js";
import LoginPage from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx";
import AgentsPage from "./pages/agents.jsx";
import ConversationsPage from "./pages/conversations.jsx";
import UsersPage from "./pages/users.jsx";
import KbPage from "./pages/kb.jsx";
import AdminPage from "./pages/admin.jsx";

export default function App() {
  const [session, setSession] = useState(null); // {user, merchant, platform}
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    (async () => {
      try {
        const data = await api("/auth/me");
        setSession(data);
      } catch {
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="auth-wrap"><div className="muted">加载中…</div></div>;
  if (!session) return <LoginPage onLogin={(s) => { setSession(s); setPage("dashboard"); }} />;

  const isAdmin = session.user.role === "superadmin";
  const nav = [
    ["dashboard", "仪表盘"],
    ["agents", "店员管理"],
    ["conversations", "会话接待"],
    ["kb", "知识库"],
    ["users", "账号管理"],
    ...(isAdmin ? [["admin", "平台管理"]] : []),
  ];

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setToken(null);
    setSession(null);
  };

  return (
    <div className="layout">
      <div className="sidebar">
        <div className="brand">DSH <span>客服平台</span></div>
        {nav.map(([key, label]) => (
          <div key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => setPage(key)}>{label}</div>
        ))}
        <div className="me">
          {session.user.display_name || session.user.username}
          <br />
          {isAdmin ? "平台管理员" : session.merchant?.name}
          <br />
          <a onClick={logout} style={{ cursor: "pointer" }}>退出登录</a>
        </div>
      </div>
      <div className="main">
        {page === "dashboard" && <Dashboard session={session} />}
        {page === "agents" && <AgentsPage session={session} />}
        {page === "conversations" && <ConversationsPage session={session} />}
        {page === "users" && <UsersPage session={session} />}
        {page === "kb" && <KbPage session={session} />}
        {page === "admin" && <AdminPage session={session} />}
      </div>
    </div>
  );
}
