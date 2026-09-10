import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import LoginPage from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx";
import AgentsPage from "./pages/agents.jsx";
import ConversationsPage from "./pages/conversations.jsx";
import UsersPage from "./pages/users.jsx";
import KbPage from "./pages/kb.jsx";
import AdminPage from "./pages/admin.jsx";

function NavIcon({ name }) {
  const paths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.6" />
        <rect x="14" y="3" width="7" height="7" rx="1.6" />
        <rect x="3" y="14" width="7" height="7" rx="1.6" />
        <rect x="14" y="14" width="7" height="7" rx="1.6" />
      </>
    ),
    agents: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
        <path d="M16 5.5a3 3 0 0 1 0 5" />
        <path d="M17.5 14.2A5.5 5.5 0 0 1 21 19.5" />
      </>
    ),
    conversations: (
      <>
        <path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.4A8 8 0 1 1 21 12Z" />
        <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
      </>
    ),
    kb: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
        <path d="M4 5.5v15" />
        <path d="M8 7h8M8 11h8" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
        <circle cx="17.5" cy="9" r="2.4" />
        <path d="M17 14.4a4.5 4.5 0 0 1 4 4.1" />
      </>
    ),
    admin: (
      <>
        <path d="M12 3 20 6v5.5c0 4.8-3.2 8.2-8 9.5-4.8-1.3-8-4.7-8-9.5V6Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  };
  return (
    <span className="nav-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
    </span>
  );
}


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
    ["dashboard", "仪表盘", "dashboard"],
    ["agents", "店员管理", "agents"],
    ["conversations", "会话接待", "conversations"],
    ["kb", "知识库", "kb"],
    ["users", "账号管理", "users"],
    ...(isAdmin ? [["admin", "平台管理", "admin"]] : []),
  ];

  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setSession(null);
  };

  return (
    <div className="layout">
      <div className="sidebar">
        <div className="brand">DSH <span>客服平台</span></div>
        {nav.map(([key, label, icon]) => (
          <div key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => setPage(key)}>
            <NavIcon name={icon} />
            {label}
          </div>
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
