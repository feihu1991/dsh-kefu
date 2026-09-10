import React, { useEffect, useState } from "react";
import { api } from "../api.js";

function Tab({ active, onClick, children }) {
  return <button className={`btn small ${active ? "primary" : ""}`} onClick={onClick} style={{ marginRight: 8 }}>{children}</button>;
}

export default function AdminPage({ session }) {
  const [tab, setTab] = useState("merchants");
  const [merchants, setMerchants] = useState([]);
  const [users, setUsers] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [show, setShow] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    api("/admin/stats").then(setStats).catch(() => {});
    api("/admin/merchants").then((d) => setMerchants(d.merchants)).catch(() => {});
    api("/admin/users").then((d) => setUsers(d.users)).catch(() => {});
    api("/admin/tiers").then((d) => setTiers(d.tiers)).catch(() => {});
    api("/admin/settings").then((d) => setSettings(d.settings)).catch(() => {});
  };
  useEffect(load, []);

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      if (tab === "merchants" && show) {
        if (show.id) {
          await api(`/admin/merchants/${show.id}`, { method: "PATCH", body: show });
        } else {
          await api("/admin/merchants", { method: "POST", body: show });
        }
      }
      if (tab === "tiers" && show) {
        const body = { name: show.name, description: show.description, provider: show.provider, model: show.model, maxTokens: show.maxTokens || null, enabled: show.enabled !== false };
        if (show.id) await api(`/admin/tiers/${show.id}`, { method: "PATCH", body });
        else await api("/admin/tiers", { method: "POST", body });
      }
      if (tab === "users" && show) {
        if (show.id) {
          await api(`/admin/users/${show.id}`, { method: "PATCH", body: { displayName: show.displayName, role: show.role, status: show.status } });
        } else {
          await api("/admin/users", { method: "POST", body: show });
        }
      }
      setShow(null);
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const saveSettings = async () => {
    await api("/admin/settings", { method: "PATCH", body: settings });
    alert("已保存（限流设置即时生效）");
  };

  const newMerchant = () => setShow({ name: "", contact: "" });
  const newTier = () => setShow({ name: "", description: "", provider: "deepseek-official", model: "", maxTokens: 8192 });
  const newUser = () => setShow({ username: "", password: "", displayName: "", merchantId: merchants[0]?.id ?? "", role: "merchant_staff" });

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, marginRight: 20 }}>平台管理</h2>
        <Tab active={tab === "merchants"} onClick={() => { setTab("merchants"); setShow(null); }}>商家</Tab>
        <Tab active={tab === "users"} onClick={() => { setTab("users"); setShow(null); }}>账号</Tab>
        <Tab active={tab === "tiers"} onClick={() => { setTab("tiers"); setShow(null); }}>服务档位</Tab>
        <Tab active={tab === "settings"} onClick={() => { setTab("settings"); setShow(null); }}>平台设置</Tab>
      </div>

      {stats && (
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat"><div className="t">商家</div><div className="n">{stats.merchants}</div></div>
          <div className="stat"><div className="t">账号</div><div className="n">{stats.users}</div></div>
          <div className="stat"><div className="t">Agent</div><div className="n">{stats.agents}</div></div>
          <div className="stat"><div className="t">今日会话</div><div className="n">{stats.conversations}</div></div>
          <div className="stat"><div className="t">今日消息</div><div className="n">{stats.messages}</div></div>
        </div>
      )}

      {tab === "merchants" && (
        <div className="card">
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
            <button className="btn primary small" onClick={newMerchant}>+ 新增商家</button>
          </div>
          <table className="tbl">
            <thead><tr><th>商家</th><th>联系人</th><th>状态</th><th>账号数</th><th>Agent数</th><th>创建时间</th></tr></thead>
            <tbody>
              {merchants.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.contact || "—"}</td>
                  <td><span className={`badge ${m.status === "active" ? "ok" : "err"}`}>{m.status === "active" ? "正常" : "停用"}</span></td>
                  <td>{m.users}</td>
                  <td>{m.agents}</td>
                  <td className="muted small">{new Date(m.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "users" && (
        <div className="card">
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
            <button className="btn primary small" onClick={newUser}>+ 新建账号</button>
          </div>
          <table className="tbl">
            <thead><tr><th>用户名</th><th>昵称</th><th>角色</th><th>商家</th><th>状态</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.display_name}</td>
                  <td>{u.role === "superadmin" ? "平台超管" : u.role === "merchant_admin" ? "商家管理员" : "店员"}</td>
                  <td>{merchants.find((m) => m.id === u.merchant_id)?.name ?? "—"}</td>
                  <td><span className={`badge ${u.status === "active" ? "ok" : "err"}`}>{u.status === "active" ? "正常" : "停用"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "tiers" && (
        <div className="card">
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
            <button className="btn primary small" onClick={newTier}>+ 新增档位</button>
          </div>
          <table className="tbl">
            <thead><tr><th>名称</th><th>说明</th><th>Provider</th><th>Model</th><th>MaxTokens</th><th>状态</th><th>商家可见</th></tr></thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted">{t.description}</td>
                  <td className="muted">{t.provider}</td>
                  <td className="muted">{t.model}</td>
                  <td className="muted">{t.max_tokens ?? "—"}</td>
                  <td><span className={`badge ${t.enabled ? "ok" : "err"}`}>{t.enabled ? "启用" : "停用"}</span></td>
                  <td>{t.enabled ? "✓ 是" : "✗ 否"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "settings" && settings && (
        <div className="card" style={{ maxWidth: 520 }}>
          <h3>平台设置</h3>
          <div className="field">
            <label><input type="checkbox" checked={!!settings.allowRegistration} onChange={(e) => setSettings({ ...settings, allowRegistration: e.target.checked })} style={{ marginRight: 8 }} />开放商家自助注册</label>
          </div>
          <div className="row">
            <div className="field grow">
              <label>聊天限流（次/分钟/账号）</label>
              <input type="number" value={settings.rateLimit?.perMinute ?? 30} onChange={(e) => setSettings({ ...settings, rateLimit: { ...settings.rateLimit, perMinute: Number(e.target.value) } })} />
            </div>
            <div className="field grow">
              <label>网页客服限流（次/分钟/访客IP）</label>
              <input type="number" value={settings.rateLimit?.widgetPerMinute ?? 10} onChange={(e) => setSettings({ ...settings, rateLimit: { ...settings.rateLimit, widgetPerMinute: Number(e.target.value) } })} />
            </div>
          </div>
          <div className="field">
            <label>网页客服每日消息额度（0 = 不限制，含顾客与客服消息）</label>
            <input type="number" min="0" value={settings.widgetDailyMessageLimit ?? 2000} onChange={(e) => setSettings({ ...settings, widgetDailyMessageLimit: Number(e.target.value) })} />
          </div>
          <button className="btn primary" onClick={saveSettings}>保存设置</button>
        </div>
      )}

      {show && (
        <div className="modal-mask" onClick={() => setShow(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>
              {tab === "merchants" && (show.id ? "编辑商家" : "新增商家")}
              {tab === "tiers" && (show.id ? "编辑档位" : "新增档位")}
              {tab === "users" && (show.id ? "编辑账号" : "新建账号")}
            </h3>
            {tab === "merchants" && (
              <>
                <div className="field"><label>商家名称</label><input value={show.name} onChange={(e) => setShow({ ...show, name: e.target.value })} required /></div>
                <div className="field"><label>联系人</label><input value={show.contact} onChange={(e) => setShow({ ...show, contact: e.target.value })} /></div>
              </>
            )}
            {tab === "tiers" && (
              <>
                <div className="field"><label>名称（商家可见，如：高级客服）</label><input value={show.name} onChange={(e) => setShow({ ...show, name: e.target.value })} required /></div>
                <div className="field"><label>说明</label><input value={show.description} onChange={(e) => setShow({ ...show, description: e.target.value })} /></div>
                <div className="field"><label>Provider（内部）</label><input value={show.provider} onChange={(e) => setShow({ ...show, provider: e.target.value })} required /></div>
                <div className="field"><label>Model（内部）</label><input value={show.model} onChange={(e) => setShow({ ...show, model: e.target.value })} required /></div>
                <div className="field"><label>MaxTokens（内部）</label><input type="number" value={show.maxTokens ?? ""} onChange={(e) => setShow({ ...show, maxTokens: Number(e.target.value) })} /></div>
                <div className="field"><label><input type="checkbox" checked={show.enabled !== false} onChange={(e) => setShow({ ...show, enabled: e.target.checked })} style={{ marginRight: 8 }} />启用（商家可见可选）</label></div>
              </>
            )}
            {tab === "users" && (
              <>
                {!show.id && <div className="field"><label>用户名</label><input value={show.username} onChange={(e) => setShow({ ...show, username: e.target.value })} required /></div>}
                {!show.id && <div className="field"><label>密码（至少 6 位）</label><input type="password" value={show.password} onChange={(e) => setShow({ ...show, password: e.target.value })} required /></div>}
                {!show.id && (
                  <div className="field"><label>所属商家</label>
                    <select value={show.merchantId} onChange={(e) => setShow({ ...show, merchantId: e.target.value })} required>
                      <option value="">选择商家</option>
                      {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="field"><label>昵称</label><input value={show.displayName} onChange={(e) => setShow({ ...show, displayName: e.target.value })} /></div>
                <div className="field"><label>角色</label>
                  <select value={show.role} onChange={(e) => setShow({ ...show, role: e.target.value })}>
                    <option value="merchant_admin">商家管理员</option>
                    <option value="merchant_staff">店员</option>
                    <option value="superadmin">平台超管</option>
                  </select>
                </div>
              </>
            )}
            {err && <div className="err">{err}</div>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShow(null)}>取消</button>
              <button type="submit" className="btn primary">保存</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
