import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function AgentsPage({ session }) {
  const [agents, setAgents] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [show, setShow] = useState(null); // null | {} (new) | agent (edit)
  const [err, setErr] = useState("");
  const isAdmin = session.user.role === "merchant_admin";

  const load = () => {
    api("/agents").then((d) => setAgents(d.agents)).catch(() => {});
    api("/tiers").then((d) => setTiers(d.tiers)).catch(() => {});
  };
  useEffect(load, []);

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      if (show.id) {
        await api(`/agents/${show.id}`, { method: "PATCH", body: show });
      } else {
        await api("/agents", { method: "POST", body: show });
      }
      setShow(null);
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const del = async (agent) => {
    if (!confirm(`确认删除店员「${agent.name}」？历史会话保留。`)) return;
    await api(`/agents/${agent.id}`, { method: "DELETE" });
    load();
  };

  const toggle = async (agent) => {
    await api(`/agents/${agent.id}`, { method: "PATCH", body: { status: agent.status === "enabled" ? "disabled" : "enabled" } });
    load();
  };

  const createWidget = async (agent) => {
    try {
      const d = await api(`/agents/${agent.id}/widget-tokens`, { method: "POST" });
      alert(`网页客服地址已生成（复制到浏览器打开预览）：\n${location.origin}${d.url}\n\n完整地址：${location.origin}${d.url}`);
    } catch (ex) {
      alert(ex.message);
    }
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>店员管理</h2>
        {isAdmin && <button className="btn primary" onClick={() => setShow({ name: "", persona: "", tierId: tiers[0]?.id ?? "", welcomeMessage: "" })}>+ 新建店员 Agent</button>}
      </div>
      {agents.length === 0 && <div className="card empty">还没有店员 Agent{isAdmin ? "，点击右上角新建" : "，请联系商家管理员创建"}</div>}
      {agents.map((a) => (
        <div key={a.id} className="list-item">
          <div className="info">
            <div className="row">
              <span className="name">{a.name}</span>
              <span className={`badge ${a.status === "enabled" ? "ok" : "err"}`}>{a.status === "enabled" ? "接待中" : "已停用"}</span>
              <span className="badge">{a.tier?.name ?? "未选档位"}</span>
            </div>
            <div className="desc">{a.persona || "（未设置人设话术）"}</div>
          </div>
          <div className="row">
            <button className="btn small" onClick={createWidget}>网页客服</button>
            {isAdmin && <button className="btn small" onClick={() => setShow(a)}>编辑</button>}
            {isAdmin && <button className="btn small" onClick={() => toggle(a)}>{a.status === "enabled" ? "停用" : "启用"}</button>}
            {isAdmin && <button className="btn small danger" onClick={() => del(a)}>删除</button>}
          </div>
        </div>
      ))}

      {show && (
        <div className="modal-mask" onClick={() => setShow(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>{show.id ? `编辑店员：${show.name}` : "新建店员 Agent"}</h3>
            <div className="field"><label>名称</label><input value={show.name} onChange={(e) => setShow({ ...show, name: e.target.value })} required /></div>
            <div className="field">
              <label>服务档位（对应模型由平台配置）</label>
              <select value={show.tierId} onChange={(e) => setShow({ ...show, tierId: e.target.value })}>
                <option value="">不指定（用默认模型）</option>
                {tiers.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
              </select>
            </div>
            <div className="field">
              <label>人设 / 话术（会注入客服身份设定）</label>
              <textarea rows={5} value={show.persona} onChange={(e) => setShow({ ...show, persona: e.target.value })} placeholder="例如：你是本店资深客服，熟悉 7 天无理由退换货规则……" />
            </div>
            <div className="field"><label>欢迎语（网页客服使用）</label><input value={show.welcomeMessage} onChange={(e) => setShow({ ...show, welcomeMessage: e.target.value })} /></div>
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
