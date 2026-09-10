import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon, PageHeader, Badge, Modal, Empty, Card, Avatar, formatDate } from "../ui.jsx";

export default function UsersPage({ session }) {
  const [users, setUsers] = useState([]);
  const [show, setShow] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const d = await api("/users");
      setUsers(d.users || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(load, []);

  const openCreate = () => { setErr(""); setShow({ username: "", password: "", displayName: "", status: "active" }); };
  const openEdit = (u) => { setErr(""); setShow({ ...u, password: "" }); };

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      if (show.id) {
        const body = { displayName: show.display_name, status: show.status };
        if (show.password) body.password = show.password;
        await api(`/users/${show.id}`, { method: "PATCH", body });
      } else {
        await api("/users", { method: "POST", body: { username: show.username, password: show.password, displayName: show.displayName } });
      }
      setShow(null);
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const remove = async (u) => {
    if (!confirm(`确认删除账号「${u.username}」？该账号将无法再登录。`)) return;
    await api(`/users/${u.id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div>
      <PageHeader
        title="账号管理"
        subtitle="管理商家下的店员账号，店员只能接待会话，不能修改团队和知识库"
        actions={<button className="btn primary" onClick={openCreate}><Icon name="plus" size={16} />新建店员账号</button>}
      />

      {loading ? (
        <div className="card" style={{ display: "grid", placeItems: "center", minHeight: 200 }}><span className="spinner" /></div>
      ) : users.length === 0 ? (
        <Card><Empty icon="users" title="还没有店员账号" desc="创建店员账号后，他们可以登录控制台接待顾客。" action={<button className="btn primary" onClick={openCreate}>新建店员账号</button>} /></Card>
      ) : (
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="list-row">
              <Avatar name={u.display_name || u.username} size={40} />
              <div className="list-main">
                <div className="list-title">
                  {u.display_name || u.username}
                  <Badge tone={u.role === "merchant_admin" ? "brand" : "info"}>{u.role === "merchant_admin" ? "商家管理员" : "客服店员"}</Badge>
                  <Badge tone={u.status === "active" ? "ok" : "danger"}>{u.status === "active" ? "正常" : "已停用"}</Badge>
                </div>
                <div className="list-desc">用户名：{u.username} · 创建于 {formatDate(u.created_at)}</div>
              </div>
              <div className="list-actions">
                <button className="btn small" onClick={() => openEdit(u)}><Icon name="edit" size={13} />编辑</button>
                {u.id !== session.user.id && <button className="btn small danger" onClick={() => remove(u)}><Icon name="trash" size={13} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {show && (
        <Modal
          title={show.id ? `编辑账号：${show.username}` : "新建店员账号"}
          description={show.id ? "可修改昵称、状态或重置密码；密码留空表示不修改。" : "店员只能接待会话，适合日常客服排班。"}
          onClose={() => setShow(null)}
          footer={<><button className="btn" onClick={() => setShow(null)}>取消</button><button className="btn primary" type="submit" form="user-form">保存</button></>}
        >
          <form id="user-form" onSubmit={save}>
            {!show.id && (
              <div className="field-row">
                <div className="field"><label>用户名</label><input value={show.username} onChange={(e) => setShow({ ...show, username: e.target.value })} required /></div>
                <div className="field"><label>初始密码（至少 6 位）</label><input type="password" value={show.password} onChange={(e) => setShow({ ...show, password: e.target.value })} required /></div>
              </div>
            )}
            <div className="field"><label>昵称</label><input value={show.display_name ?? ""} onChange={(e) => setShow({ ...show, display_name: e.target.value, displayName: e.target.value })} placeholder="例如：客服阿云" /></div>
            {show.id && (
              <>
                <div className="field"><label>新密码（留空不修改）</label><input type="password" value={show.password || ""} onChange={(e) => setShow({ ...show, password: e.target.value })} placeholder="至少 6 位" /></div>
                <div className="field"><label>状态</label><select value={show.status || "active"} onChange={(e) => setShow({ ...show, status: e.target.value })}><option value="active">正常</option><option value="disabled">停用</option></select></div>
              </>
            )}
            {err && <div className="err">{err}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
