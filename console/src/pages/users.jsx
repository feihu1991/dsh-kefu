import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function UsersPage({ session }) {
  const [users, setUsers] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "merchant_staff" });
  const [err, setErr] = useState("");

  const load = () => api("/users").then((d) => setUsers(d.users)).catch(() => {});
  useEffect(load, []);

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api("/users", { method: "POST", body: form });
      setShow(false);
      setForm({ username: "", password: "", displayName: "", role: "merchant_staff" });
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const toggle = async (u) => {
    await api(`/users/${u.id}`, { method: "PATCH", body: { status: u.status === "active" ? "disabled" : "active" } });
    load();
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>账号管理</h2>
        <button className="btn primary" onClick={() => setShow(true)}>+ 新建店员账号</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>用户名</th><th>昵称</th><th>角色</th><th>状态</th><th>最近登录</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>{u.role === "merchant_admin" ? "商家管理员" : "店员"}</td>
                <td><span className={`badge ${u.status === "active" ? "ok" : "err"}`}>{u.status === "active" ? "正常" : "停用"}</span></td>
                <td className="muted small">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                <td>
                  <button className="btn small" onClick={() => toggle(u)}>{u.status === "active" ? "停用" : "启用"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && (
        <div className="modal-mask" onClick={() => setShow(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>新建店员账号</h3>
            <div className="field"><label>用户名</label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
            <div className="field"><label>密码（至少 6 位）</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
            <div className="field"><label>昵称</label><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></div>
            <div className="field"><label>角色</label><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="merchant_staff">店员（仅接待）</option><option value="merchant_admin">管理员</option></select></div>
            {err && <div className="err">{err}</div>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShow(false)}>取消</button>
              <button type="submit" className="btn primary">创建</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
