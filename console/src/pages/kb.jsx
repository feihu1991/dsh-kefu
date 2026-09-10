import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Icon, Card, PageHeader, Badge, Empty, Modal, formatDate } from "../ui.jsx";

export default function KbPage({ session }) {
  const [docs, setDocs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [show, setShow] = useState(null);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const isAdmin = session.user.role === "merchant_admin";

  const load = async () => {
    try {
      const [d, a] = await Promise.all([api("/kb"), api("/agents").catch(() => ({ agents: [] }))]);
      setDocs(d.docs || []);
      setAgents(a.agents || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(load, []);

  const filtered = useMemo(() => docs.filter((d) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [d.title, d.content, d.tags].filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
  }), [docs, search]);

  const openCreate = () => { setErr(""); setShow({ title: "", content: "", tags: "", agentId: "" }); };
  const openEdit = (doc) => { setErr(""); setShow({ ...doc, agentId: doc.agent_id || "" }); };

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const body = { title: show.title, content: show.content, tags: show.tags, agentId: show.agentId || null };
      if (show.id) await api(`/kb/${show.id}`, { method: "PATCH", body });
      else await api("/kb", { method: "POST", body });
      setShow(null);
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const remove = async (doc) => {
    if (!confirm(`确认删除资料「${doc.title}」？`)) return;
    await api(`/kb/${doc.id}`, { method: "DELETE" });
    await load();
  };

  const agentName = (id) => agents.find((a) => a.id === id)?.name || "指定 Agent";

  return (
    <div>
      <PageHeader
        title="知识库"
        subtitle="录入商品资料、售后政策和常见问答，客服回答时会优先依据命中的资料"
        actions={isAdmin && <button className="btn primary" onClick={openCreate}><Icon name="plus" size={16} />新建资料</button>}
      />

      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标题、内容或标签" /></div>
        <span className="muted small">共 {docs.length} 条资料</span>
      </div>

      {loading ? (
        <div className="card" style={{ display: "grid", placeItems: "center", minHeight: 220 }}><span className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <Card><Empty icon="book" title={docs.length === 0 ? "还没有知识库资料" : "没有匹配的资料"} desc={docs.length === 0 ? "把商品参数、发货时效、退换政策录入进来，客服回答会更准确。" : "换个关键词试试。"} action={isAdmin && docs.length === 0 && <button className="btn primary" onClick={openCreate}>新建资料</button>} /></Card>
      ) : (
        <div className="kb-grid">
          {filtered.map((doc) => (
            <Card key={doc.id} className="kb-card">
              <div className="row-between">
                <h3>{doc.title}</h3>
                <Badge tone={doc.agent_id ? "brand" : "ok"}>{doc.agent_id ? `仅 ${agentName(doc.agent_id)}` : "全店共享"}</Badge>
              </div>
              <div className="kb-content">{doc.content}</div>
              <div className="row wrap" style={{ gap: 6 }}>
                {(doc.tags || "").split(",").filter(Boolean).map((tag) => <span key={tag} className="tag"><Icon name="tag" size={11} />{tag.trim()}</span>)}
              </div>
              <div className="kb-foot">
                <span className="muted small">更新于 {formatDate(doc.updated_at)}</span>
                {isAdmin && (
                  <div className="list-actions">
                    <button className="btn small" onClick={() => openEdit(doc)}>编辑</button>
                    <button className="btn small danger" onClick={() => remove(doc)}><Icon name="trash" size={13} /></button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {show && (
        <Modal
          title={show.id ? "编辑知识库资料" : "新建知识库资料"}
          description="资料越具体，RAG 命中越准确。建议一条资料只讲一件事。"
          onClose={() => setShow(null)}
          width={640}
          footer={<><button className="btn" onClick={() => setShow(null)}>取消</button><button className="btn primary" type="submit" form="kb-form">保存</button></>}
        >
          <form id="kb-form" onSubmit={save}>
            <div className="field"><label>标题</label><input value={show.title} onChange={(e) => setShow({ ...show, title: e.target.value })} placeholder="例如：发货时效说明" required /></div>
            <div className="field">
              <label>适用范围</label>
              <select value={show.agentId || ""} onChange={(e) => setShow({ ...show, agentId: e.target.value })}>
                <option value="">全店共享（所有 Agent 可检索）</option>
                {agents.map((a) => <option key={a.id} value={a.id}>仅 {a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>内容</label>
              <textarea rows={8} value={show.content} onChange={(e) => setShow({ ...show, content: e.target.value })} placeholder="例如：本店默认发顺丰，现货 24 小时内发货；7 天无理由退换，退货运费险已赠。" required />
            </div>
            <div className="field"><label>标签（逗号分隔，可选）</label><input value={show.tags} onChange={(e) => setShow({ ...show, tags: e.target.value })} placeholder="发货, 物流, 售后" /></div>
            {err && <div className="err">{err}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}
