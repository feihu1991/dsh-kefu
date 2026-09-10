import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, chatStream } from "../api.js";
import { Icon, Card, PageHeader, Badge, Empty, Modal, Avatar, formatTime } from "../ui.jsx";

export default function ConversationsPage({ session }) {
  const [convs, setConvs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [current, setCurrent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [err, setErr] = useState("");
  const bodyRef = useRef(null);

  const loadConvs = async () => {
    const params = new URLSearchParams({ limit: "120" });
    if (status !== "all") params.set("status", status);
    if (channel !== "all") params.set("channel", channel);
    const d = await api(`/conversations?${params.toString()}`);
    setConvs(d.conversations || []);
  };
  const loadAgents = async () => {
    const d = await api("/agents").catch(() => ({ agents: [] }));
    setAgents(d.agents || []);
  };
  useEffect(() => { loadConvs(); loadAgents(); }, [status, channel]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, draft]);

  const filtered = useMemo(() => convs.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [c.title, c.agent_name].filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
  }), [convs, search]);

  const open = async (conv) => {
    const d = await api(`/conversations/${conv.id}/messages`);
    setCurrent(d.conversation);
    setMessages(d.messages || []);
    setDraft("");
  };

  const create = async () => {
    setErr("");
    if (!newAgentId) { setErr("请选择接待的客服 Agent"); return; }
    try {
      const d = await api("/conversations", { method: "POST", body: { agentId: newAgentId } });
      setShowNew(false);
      await loadConvs();
      await open(d.conversation);
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const send = async () => {
    const content = input.trim();
    if (!content || busy || !current || current.status !== "open") return;
    setInput("");
    setBusy(true);
    setDraft("");
    setMessages((m) => [...m, { id: "tmp-" + Date.now(), role: "user", content, created_at: Date.now() }]);
    try {
      await chatStream(current.id, content, {
        onDelta: (p) => setDraft((d) => d + (p.text ?? "")),
        onDone: (p) => {
          setMessages((m) => [...m, { id: "done-" + Date.now(), role: "assistant", content: p.text, created_at: Date.now() }]);
          setDraft("");
          loadConvs();
        },
      });
    } catch (ex) {
      setMessages((m) => [...m, { id: "err-" + Date.now(), role: "assistant", content: `⚠ ${ex.message}`, created_at: Date.now() }]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    if (!current) return;
    const nextStatus = current.status === "open" ? "closed" : "open";
    const d = await api(`/conversations/${current.id}`, { method: "PATCH", body: { status: nextStatus } });
    setCurrent(d.conversation);
    loadConvs();
  };

  const canCreate = session.user.role === "merchant_admin" || session.user.role === "merchant_staff";

  return (
    <div>
      <PageHeader
        title="客服会话"
        subtitle="处理控制台与网页客服咨询，同一会话自动串行接待"
        actions={canCreate && <button className="btn primary" onClick={() => { setNewAgentId(agents.find((a) => a.status === "enabled")?.id || ""); setShowNew(true); }}><Icon name="plus" size={16} />新建会话</button>}
      />

      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索会话标题 / 客服" /></div>
        <div className="segmented">
          {[["all", "全部"], ["open", "接待中"], ["closed", "已关闭"]].map(([key, label]) => (
            <button key={key} className={`segment ${status === key ? "active" : ""}`} onClick={() => setStatus(key)}>{label}</button>
          ))}
        </div>
        <div className="segmented">
          {[["all", "全渠道"], ["console", "控制台"], ["widget", "网页客服"]].map(([key, label]) => (
            <button key={key} className={`segment ${channel === key ? "active" : ""}`} onClick={() => setChannel(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="chat-layout">
        <section className="conv-panel">
          <div className="conv-panel-head row-between">
            <strong style={{ fontSize: 13.5 }}>会话列表</strong>
            <span className="muted small">{filtered.length} 条</span>
          </div>
          <div className="conv-list">
            {filtered.length === 0 ? (
              <Empty icon="chat" title="没有匹配的会话" desc={convs.length === 0 ? "顾客咨询或新建会话后会显示在这里。" : "换个筛选条件试试。"} />
            ) : filtered.map((c) => (
              <div key={c.id} className={`conv-item ${current?.id === c.id ? "active" : ""}`} onClick={() => open(c)}>
                <Avatar name={c.agent_name || "客"} size={36} />
                <div className="conv-item-main">
                  <div className="conv-item-title"><span>{c.title || c.agent_name || "未命名会话"}</span><small>{formatTime(c.updated_at)}</small></div>
                  <div className="conv-item-desc">{c.channel === "widget" ? "网页客服" : "控制台"} · {c.agent_name || "未分配 Agent"} · {c.message_count || 0} 条</div>
                  <div className="row" style={{ marginTop: 6, gap: 6 }}>
                    <Badge tone={c.status === "open" ? "ok" : ""}>{c.status === "open" ? "接待中" : "已关闭"}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="chat-panel">
          {!current ? (
            <Empty icon="message" title="选择左侧会话开始接待" desc="会话列表会展示控制台和网页客服的全部咨询。" />
          ) : (
            <>
              <div className="chat-head">
                <div className="row">
                  <Avatar name={current.agent_name || "客"} size={38} />
                  <div>
                    <h3>{current.title || current.agent_name || "会话"}</h3>
                    <p>{current.channel === "widget" ? "网页客服" : "控制台"} · {current.agent_name || "未分配 Agent"} · {current.status === "open" ? "接待中" : "已关闭"}</p>
                  </div>
                </div>
                <button className={`btn small ${current.status === "open" ? "" : "primary"}`} onClick={toggleStatus}>{current.status === "open" ? "关闭会话" : "重新打开"}</button>
              </div>
              <div className="chat-body" ref={bodyRef}>
                {messages.length === 0 && !draft && <div className="muted small" style={{ textAlign: "center", padding: 20 }}>还没有消息</div>}
                {messages.map((m) => (
                  <div key={m.id} className={`msg-row ${m.role === "user" ? "user" : "assistant"}`}>
                    {m.role !== "user" && <Avatar name={current.agent_name || "客"} size={30} />}
                    <div>
                      <div className="msg-bubble">{m.content}</div>
                      <div className="msg-meta">{m.role === "user" ? "顾客" : current.agent_name || "客服"} · {formatTime(m.created_at)}</div>
                    </div>
                  </div>
                ))}
                {draft && (
                  <div className="msg-row assistant">
                    <Avatar name={current.agent_name || "客"} size={30} />
                    <div><div className="msg-bubble">{draft}</div><div className="msg-meta">{current.agent_name || "客服"} 正在输入…</div></div>
                  </div>
                )}
                {busy && !draft && <div className="typing">{current.agent_name || "客服"} 正在输入…</div>}
              </div>
              <div className="composer">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={current.status === "open" ? "输入顾客问题，Enter 发送，Shift+Enter 换行" : "会话已关闭，重新打开后可发送"}
                  disabled={busy || current.status !== "open"}
                />
                <button className="btn primary" onClick={send} disabled={busy || current.status !== "open"} style={{ alignSelf: "flex-end" }}><Icon name="send" size={16} />发送</button>
              </div>
            </>
          )}
        </section>
      </div>

      {showNew && (
        <Modal
          title="新建客服会话"
          description="选择接待的客服 Agent，创建后会进入会话工作区。"
          onClose={() => setShowNew(false)}
          footer={<><button className="btn" onClick={() => setShowNew(false)}>取消</button><button className="btn primary" onClick={create}>创建并进入</button></>}
        >
          <div className="field">
            <label>接待 Agent</label>
            <select value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
              <option value="">请选择</option>
              {agents.filter((a) => a.status === "enabled").map((a) => <option key={a.id} value={a.id}>{a.name} · {a.tier?.name || "默认档位"}</option>)}
            </select>
          </div>
          {agents.filter((a) => a.status === "enabled").length === 0 && <div className="err">没有启用中的客服 Agent，请先到「客服团队」创建。</div>}
          {err && <div className="err">{err}</div>}
        </Modal>
      )}
    </div>
  );
}
