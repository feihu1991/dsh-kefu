import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Icon, Avatar } from "./ui.jsx";
import LoginPage from "./pages/login.jsx";
import Dashboard from "./pages/dashboard.jsx";
import AgentsPage from "./pages/agents.jsx";
import ConversationsPage from "./pages/conversations.jsx";
import UsersPage from "./pages/users.jsx";
import KbPage from "./pages/kb.jsx";
import AdminPage from "./pages/admin.jsx";

const ROLE_TEXT = {
  superadmin: "平台管理员",
  merchant_admin: "商家管理员",
  merchant_staff: "客服店员",
};

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [mobileNav, setMobileNav] = useState(false);

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

  if (loading) {
    return <div className="login-page"><div className="login-panel" style={{ gridColumn: "1 / -1" }}><div className="spinner" /></div></div>;
  }
  if (!session) return <LoginPage onLogin={(s) => { setSession(s); setPage("dashboard"); }} />;

  const isAdmin = session.user.role === "superadmin";
  const isStaff = session.user.role === "merchant_staff";
  const nav = [
    { key: "dashboard", label: "概览", icon: "dashboard" },
    { key: "conversations", label: "客服会话", icon: "chat" },
    { key: "agents", label: "客服团队", icon: "team" },
    { key: "kb", label: "知识库", icon: "book" },
    ...(!isStaff ? [{ key: "users", label: "账号管理", icon: "users" }] : []),
    ...(isAdmin ? [{ key: "admin", label: "平台管理", icon: "shield" }] : []),
  ];

  const navigate = (key) => { setPage(key); setMobileNav(false); };
  const logout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setSession(null);
  };
  const displayName = session.user.display_name || session.user.username;
  const merchantName = session.merchant?.name || "平台";

  return (
    <div className="app-shell">
      {mobileNav && <div className="sidebar-backdrop" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="sidebar-brand">
          <span className="logo"><Icon name="spark" size={19} /></span>
          <div>DSH 客服平台<small>Customer Service</small></div>
        </div>
        <nav className="sidebar-nav">
          {nav.map((item) => (
            <div key={item.key} className={`nav-item ${page === item.key ? "active" : ""}`} onClick={() => navigate(item.key)}>
              <Icon name={item.icon} size={17} />
              {item.label}
            </div>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-user">
          <strong>{displayName}</strong>
          <div className="role">{ROLE_TEXT[session.user.role] || session.user.role} · {merchantName}</div>
          <button type="button" onClick={logout}><Icon name="logout" size={14} />退出登录</button>
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-topbar">
          <button type="button" className="icon-btn" onClick={() => setMobileNav(true)} aria-label="打开菜单"><Icon name="menu" /></button>
          <div className="brand"><span className="logo"><Icon name="spark" size={17} /></span>DSH 客服平台</div>
          <Avatar name={displayName} size={32} />
        </header>
        <main className="content">
          {page === "dashboard" && <Dashboard session={session} onNavigate={navigate} />}
          {page === "agents" && <AgentsPage session={session} />}
          {page === "conversations" && <ConversationsPage session={session} />}
          {page === "users" && <UsersPage session={session} />}
          {page === "kb" && <KbPage session={session} />}
          {page === "admin" && <AdminPage session={session} />}
        </main>
      </div>
    </div>
  );
}
