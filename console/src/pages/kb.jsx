import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function KbPage({ session }) {
  const [docs, setDocs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [show, setShow] = useState(null); // null | {} | doc
  const [err, setErr] = useState("");
  const isAdmin = session.user.role === "merchant_admin";

  const load = () => {
    api("/kb").then((d) => setDocs(d.docs)).catch(() => {});
    api("/agents").then((d) => setAgents(d.agents)).catch(() => {});
  };
  useEffect(load, []);

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const body = { title: show.title, content: show.content, tags: show.tags, agentId: show.agentId || null };
      if (show.id) await api(`/kb/${show.id}`, { method: "PATCH", body });
      else await api("/kb", { method: "POST", body });
      setShow(null);
      load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const del = async (doc) => {
    if (!confirm(`确认删除资料「${doc.title}」？`)) return;
    await api(`/kb/${doc.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>知识库</h2>
        {isAdmin && <button className="btn primary" onClick={() => setShow({ title: "", content: "", tags: "", agentId: "" })}>+ 新建资料</button>}
      </div>
      <div className="card">
        <div className="muted small" style={{ marginBottom: 12 }}>
          录入商品资料、售后政策、常见问题。顾客提问时，客服 Agent 会自动检索相关知识并优先依据它回答。
          {!isAdmin && "（仅商家管理员可维护）"}
        </div>
        {docs.length === 0 && <div className="empty">还没有知识库资料{isAdmin ? "，点击右上角新建" : ""}</div>}
        {docs.map((d) => (
          <div key={d.id} className="list-item">
            <div className="info">
              <div className="row">
                <span className="name">{d.title}</span>
                {d.tags && <span className="badge">{d.tags}</span>}
                {d.agent_id ? <span className="badge warn">仅 {agents.find((a) => a.id === d.agent_id)?.name ?? "某Agent"}</span> : <span className="badge ok">全店共享</span>}
              </div>
              <div className="desc">{d.content.slice(0, 120)}{d.content.length > 120 ? "…" : ""}</div>
            </div>
            {isAdmin && (
              <div className="row">
                <button className="btn small" onClick={() => setShow(d)}>编辑</button>
                <button className="btn small danger" onClick={() => del(d)}>删除</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {show && (
        <div className="modal-mask" onClick={() => setShow(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>{show.id ? "编辑资料" : "新建知识库资料"}</h3>
            <div className="field"><label>标题</label><input value={show.title} onChange={(e) => setShow({ ...show, title: e.target.value })} required /></div>
            <div className="field">
              <label>适用范围（留空 = 全店共享）</label>
              <select value={show.agentId ?? ""} onChange={(e) => setShow({ ...show, agentId: e.target.value })}>
                <option value="">全店共享</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>内容（商品参数 / 售后政策 / 常见问答…）</label>
              <textarea rows={8} value={show.content} onChange={(e) => setShow({ ...show, content: e.target.value })} required placeholder="例如：本店默认发顺丰快递，48小时内发货；7天无理由退换，运费险已赠…" />
            </div>
            <div className="field"><label>标签（逗号分隔，可选）</label><input value={show.tags} onChange={(e) => setShow({ ...show, tags: e.target.value })} /></div>
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
