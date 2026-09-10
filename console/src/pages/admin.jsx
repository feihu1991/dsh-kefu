import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon, Card, PageHeader, Badge, Empty, Modal, Avatar, formatDate, formatTime } from "../ui.jsx";

const TABS = [
  { key: "overview", label: "概览" },
  { key: "merchants", label: "商家" },
  { key: "users", label: "账号" },
  { key: "tiers", label: "服务档位" },
  { key: "settings", label: "平台设置" },
];

export default function AdminPage() {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [merchants, setMerchants] = useState([]);
  const [users, setUsers] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [show, setShow] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [s, m, u, t, cfg] = await Promise.all([
      api("/admin/stats").catch(() => null),
      api("/admin/merchants").catch(() => ({ merchants: [] })),
      api("/admin/users").catch(() => ({ users: [] })),
      api("/admin/tiers").catch(() => ({ tiers: [] })),
      api("/admin/settings").catch(() => null),
    ]);
    setStats(s);
    setMerchants(m.merchants || []);
    setUsers(u.users || []);
    setTiers(t.tiers || []);
    setSettings(cfg?.settings || null);
  };
  useEffect(load, []);

  const closeModal = () => { setShow(null); setErr(""); };

  const save = async (e) => {
    e.preventDefault();
    setErr(""); setSaving(true);
    try {
      if (tab === "merchants") {
        const body = { name: show.name, contact: show.contact, status: show.status };
        if (show.id) await api(`/admin/merchants/${show.id}`, { method: "PATCH", body });
        else await api("/admin/merchants", { method: "POST", body });
      }
      if (tab === "users") {
        if (show.id) await api(`/admin/users/${show.id}`, { method: "PATCH", body: { displayName: show.display_name, role: show.role, status: show.status } });
        else await api("/admin/users", { method: "POST", body: show });
      }
      if (tab === "tiers") {
        const body = { name: show.name, description: show.description, provider: show.provider, model: show.model, maxTokens: show.max_tokens || null, enabled: show.enabled !== false };
        if (show.id) await api(`/admin/tiers/${show.id}`, { method: "PATCH", body });
        else await api("/admin/tiers", { method: "POST", body });
      }
      closeModal();
      await load();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const d = await api("/admin/settings", { method: "PATCH", body: settings });
      setSettings(d.settings);
      alert("平台设置已保存并即时生效");
    } catch (ex) {
      alert(ex.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind, item) => {
    const label = kind === "tiers" ? item.name : item.username;
    if (!confirm(`确认删除「${label}」？`)) return;
    if (kind === "tiers") await api(`/admin/tiers/${item.id}`, { method: "DELETE" });
    if (kind === "users") await api(`/admin/users/${item.id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div>
      <PageHeader title="平台管理" subtitle="商家、账号、服务档位与平台级设置" />
      <div className="segmented mb-16">
        {TABS.map((t) => <button key={t.key} className={`segment ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {tab === "overview" && (
        <>
          <div className="grid grid-4 mb-16">
            <Stat icon="users" label="商家" value={stats?.merchants ?? 0} />
            <Stat icon="team" label="账号" value={stats?.users ?? 0} />
            <Stat icon="robot" label="客服 Agent" value={stats?.agents ?? 0} />
            <Stat icon="message" label="今日消息" value={stats?.messages ?? 0} hint={`今日会话 ${stats?.conversations ?? 0}`} />
          </div>
          <Card>
            <div className="card-head"><div className="card-title">最近审计</div><span className="muted small">最近 50 条</span></div>
            {(stats?.audit || []).length === 0 ? <Empty icon="shield" title="暂无审计记录" /> : (
              <div className="list">
                {stats.audit.map((a) => (
                  <div key={a.id} className="list-row">
                    <span className="stat-icon" style={{ width: 32, height: 32, borderRadius: 10 }}><Icon name="shield" size={15} /></span>
                    <div className="list-main"><div className="list-title">{a.action}</div><div className="list-desc">{a.detail || "—"} · {a.merchant_id || "平台"}</div></div>
                    <div className="list-meta">{formatTime(a.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "merchants" && (
        <>
          <div className="toolbar"><span className="muted small">共 {merchants.length} 个商家</span><button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setShow({ name: "", contact: "", status: "active" })}><Icon name="plus" size={15} />新增商家</button></div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>商家</th><th>联系人</th><th>状态</th><th>账号数</th><th>Agent 数</th><th>创建时间</th><th /></tr></thead><tbody>
            {merchants.map((m) => (
              <tr key={m.id}>
                <td><div className="row"><Avatar name={m.name} size={30} /><strong>{m.name}</strong></div></td>
                <td>{m.contact || "—"}</td>
                <td><Badge tone={m.status === "active" ? "ok" : "danger"}>{m.status === "active" ? "正常" : "停用"}</Badge></td>
                <td>{m.users}</td><td>{m.agents}</td><td className="muted small">{formatDate(m.created_at)}</td>
                <td className="text-right"><button className="btn small ghost" onClick={() => setShow(m)}>编辑</button></td>
              </tr>
            ))}
          </tbody></table></div>
        </>
      )}

      {tab === "users" && (
        <>
          <div className="toolbar"><span className="muted small">共 {users.length} 个账号</span><button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setShow({ username: "", password: "", displayName: "", merchantId: merchants[0]?.id || "", role: "merchant_staff" })}><Icon name="plus" size={15} />新建账号</button></div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>用户</th><th>角色</th><th>所属商家</th><th>状态</th><th /></tr></thead><tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><div className="row"><Avatar name={u.display_name || u.username} size={30} /><div><strong>{u.display_name || u.username}</strong><div className="muted small">@{u.username}</div></div></div></td>
                <td><Badge tone={u.role === "superadmin" ? "brand" : u.role === "merchant_admin" ? "info" : ""}>{u.role === "superadmin" ? "平台超管" : u.role === "merchant_admin" ? "商家管理员" : "客服店员"}</Badge></td>
                <td>{merchants.find((m) => m.id === u.merchant_id)?.name || "—"}</td>
                <td><Badge tone={u.status === "active" ? "ok" : "danger"}>{u.status === "active" ? "正常" : "停用"}</Badge></td>
                <td className="text-right"><button className="btn small ghost" onClick={() => setShow(u)}>编辑</button></td>
              </tr>
            ))}
          </tbody></table></div>
        </>
      )}

      {tab === "tiers" && (
        <>
          <div className="toolbar"><span className="muted small">Provider / Model 仅平台可见，商家只看到档位名称</span><button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setShow({ name: "", description: "", provider: "deepseek-official", model: "", max_tokens: 8192, enabled: true })}><Icon name="plus" size={15} />新增档位</button></div>
          <div className="grid grid-3">
            {tiers.map((t) => (
              <Card key={t.id}>
                <div className="row-between"><h3>{t.name}</h3><Badge tone={t.enabled ? "ok" : "danger"}>{t.enabled ? "启用" : "停用"}</Badge></div>
                <p className="muted small" style={{ marginTop: 6, minHeight: 36 }}>{t.description || "—"}</p>
                <div className="divider" />
                <div className="small muted">Provider：{t.provider}</div>
                <div className="small muted">Model：{t.model}</div>
                <div className="small muted">MaxTokens：{t.max_tokens ?? "默认"}</div>
                <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
                  <button className="btn small" onClick={() => setShow(t)}>编辑</button>
                  <button className="btn small danger" onClick={() => remove("tiers", t)}>删除</button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {tab === "settings" && settings && (
        <div className="grid grid-2">
          <Card>
            <div className="card-title" style={{ marginBottom: 14 }}>注册与额度</div>
            <div className="field">
              <label className="checkline"><input type="checkbox" checked={!!settings.allowRegistration} onChange={(e) => setSettings({ ...settings, allowRegistration: e.target.checked })} />开放商家自助注册</label>
            </div>
            <div className="field"><label>网页客服每日消息额度（0 = 不限制，含顾客与客服消息）</label><input type="number" min="0" value={settings.widgetDailyMessageLimit ?? 2000} onChange={(e) => setSettings({ ...settings, widgetDailyMessageLimit: Number(e.target.value) })} /></div>
          </Card>
          <Card>
            <div className="card-title" style={{ marginBottom: 14 }}>限流（次/分钟）</div>
            <div className="field-row">
              <div className="field"><label>聊天 / 账号</label><input type="number" value={settings.rateLimit?.perMinute ?? 30} onChange={(e) => setSettings({ ...settings, rateLimit: { ...settings.rateLimit, perMinute: Number(e.target.value) } })} /></div>
              <div className="field"><label>聊天 / IP</label><input type="number" value={settings.rateLimit?.ipPerMinute ?? 60} onChange={(e) => setSettings({ ...settings, rateLimit: { ...settings.rateLimit, ipPerMinute: Number(e.target.value) } })} /></div>
              <div className="field"><label>网页客服 / 凭据</label><input type="number" value={settings.rateLimit?.widgetPerMinute ?? 10} onChange={(e) => setSettings({ ...settings, rateLimit: { ...settings.rateLimit, widgetPerMinute: Number(e.target.value) } })} /></div>
              <div className="field"><label>登录 / IP</label><input type="number" value={settings.rateLimit?.authPerMinute ?? 10} onChange={(e) => setSettings({ ...settings, rateLimit: { ...settings.rateLimit, authPerMinute: Number(e.target.value) } })} /></div>
            </div>
            <button className="btn primary" onClick={saveSettings} disabled={saving}>保存设置</button>
          </Card>
        </div>
      )}

      {show && (
        <Modal
          title={modalTitle(tab, show)}
          onClose={closeModal}
          footer={<><button className="btn" onClick={closeModal}>取消</button><button className="btn primary" type="submit" form="admin-form" disabled={saving}>{saving ? "保存中…" : "保存"}</button></>}
        >
          <form id="admin-form" onSubmit={save}>
            {tab === "merchants" && (
              <>
                <div className="field"><label>商家名称</label><input value={show.name || ""} onChange={(e) => setShow({ ...show, name: e.target.value })} required /></div>
                <div className="field"><label>联系人</label><input value={show.contact || ""} onChange={(e) => setShow({ ...show, contact: e.target.value })} /></div>
                {show.id && <div className="field"><label>状态</label><select value={show.status || "active"} onChange={(e) => setShow({ ...show, status: e.target.value })}><option value="active">正常</option><option value="disabled">停用</option></select></div>}
              </>
            )}
            {tab === "users" && (
              <>
                {!show.id && (
                  <>
                    <div className="field-row">
                      <div className="field"><label>用户名</label><input value={show.username || ""} onChange={(e) => setShow({ ...show, username: e.target.value })} required /></div>
                      <div className="field"><label>初始密码</label><input type="password" value={show.password || ""} onChange={(e) => setShow({ ...show, password: e.target.value })} required /></div>
                    </div>
                    <div className="field"><label>所属商家</label><select value={show.merchantId || ""} onChange={(e) => setShow({ ...show, merchantId: e.target.value })} required><option value="">选择商家</option>{merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
                  </>
                )}
                <div className="field"><label>昵称</label><input value={show.display_name || show.displayName || ""} onChange={(e) => setShow({ ...show, display_name: e.target.value, displayName: e.target.value })} /></div>
                <div className="field"><label>角色</label><select value={show.role || "merchant_staff"} onChange={(e) => setShow({ ...show, role: e.target.value })}><option value="merchant_admin">商家管理员</option><option value="merchant_staff">客服店员</option><option value="superadmin">平台超管</option></select></div>
                {show.id && <div className="field"><label>状态</label><select value={show.status || "active"} onChange={(e) => setShow({ ...show, status: e.target.value })}><option value="active">正常</option><option value="disabled">停用</option></select></div>}
              </>
            )}
            {tab === "tiers" && (
              <>
                <div className="field"><label>档位名称（商家可见）</label><input value={show.name || ""} onChange={(e) => setShow({ ...show, name: e.target.value })} required /></div>
                <div className="field"><label>说明</label><input value={show.description || ""} onChange={(e) => setShow({ ...show, description: e.target.value })} /></div>
                <div className="field-row">
                  <div className="field"><label>Provider</label><input value={show.provider || ""} onChange={(e) => setShow({ ...show, provider: e.target.value })} required /></div>
                  <div className="field"><label>Model</label><input value={show.model || ""} onChange={(e) => setShow({ ...show, model: e.target.value })} required /></div>
                </div>
                <div className="field-row">
                  <div className="field"><label>MaxTokens</label><input type="number" value={show.max_tokens ?? ""} onChange={(e) => setShow({ ...show, max_tokens: Number(e.target.value) })} /></div>
                  <div className="field"><label className="checkline" style={{ marginTop: 30 }}><input type="checkbox" checked={show.enabled !== false} onChange={(e) => setShow({ ...show, enabled: e.target.checked })} />商家可见可选</label></div>
                </div>
              </>
            )}
            {err && <div className="err">{err}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}

function modalTitle(tab, show) {
  const map = { merchants: ["新增商家", "编辑商家"], users: ["新建账号", "编辑账号"], tiers: ["新增服务档位", "编辑服务档位"] };
  const pair = map[tab] || ["", ""];
  return show.id ? pair[1] : pair[0];
}

function Stat({ icon, label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span className="stat-icon"><Icon name={icon} size={18} /></span></div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
