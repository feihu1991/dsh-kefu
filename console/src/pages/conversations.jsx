import React, { useEffect, useRef, useState } from "react";
import { api, chatStream } from "../api.js";

export default function ConversationsPage({ session }) {
  const [convs, setConvs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [current, setCurrent] = useState(null); // {id, title, agent_name}
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(""); // 流式中的增量文本
  const [agentId, setAgentId] = useState("");
  const bodyRef = useRef(null);

  const loadConvs = () => {
    api("/conversations?limit=100").then((d) => setConvs(d.conversations)).catch(() => {});
  };
  const loadAgents = () => {
    api("/agents").then((d) => setAgents(d.agents)).catch(() => {});
  };
  useEffect(() => { loadConvs(); loadAgents(); }, []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, draft]);

  const open = async (conv) => {
    const d = await api(`/conversations/${conv.id}/messages`);
    setCurrent(d.conversation);
    setMessages(d.messages);
  };

  const create = async () => {
    if (!agentId) { alert("请先选择店员 Agent"); return; }
    const d = await api("/conversations", { method: "POST", body: { agentId } });
    await open(d.conversation);
    loadConvs();
  };

  const send = async () => {
    const content = input.trim();
    if (!content || busy || !current) return;
    setInput("");
    setBusy(true);
    setDraft("");
    setMessages((m) => [...m, { id: "tmp-" + Date.now(), role: "user", content }]);
    try {
      await chatStream(current.id, content, {
        onDelta: (p) => setDraft((d) => d + (p.text ?? "")),
        onDone: (p) => {
          setMessages((m) => [...m, { id: "done-" + Date.now(), role: "assistant", content: p.text }]);
          setDraft("");
          loadConvs();
        },
      });
    } catch (ex) {
      setMessages((m) => [...m, { id: "err-" + Date.now(), role: "assistant", content: `⚠ ${ex.message}` }]);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  const closeConv = async (conv) => {
    await api(`/conversations/${conv.id}`, { method: "PATCH", body: { status: conv.status === "open" ? "closed" : "open" } });
    loadConvs();
  };

  return (
    <div className="page">
      <h2>会话接待</h2>
      <div className="chat-pane">
        <div className="chat-list">
          <div className="card" style={{ padding: 12 }}>
            <div className="row">
              <select className="grow" style={{ padding: 8, borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--text)" }} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">选择店员 Agent</option>
                {agents.filter((a) => a.status === "enabled").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="btn small primary" onClick={create}>新建会话</button>
            </div>
          </div>
          {convs.map((c) => (
            <div key={c.id} className="list-item" style={{ cursor: "pointer", ...(current?.id === c.id ? { borderColor: "var(--accent)" } : {}) }} onClick={() => open(c)}>
              <div className="info">
                <div className="row">
                  <span className="name" style={{ fontSize: 13 }}>{c.title || c.agent_name || "未命名会话"}</span>
                  <span className={`badge ${c.status === "open" ? "ok" : ""}`}>{c.status === "open" ? "接待中" : "已关闭"}</span>
                </div>
                <div className="desc">{c.channel === "widget" ? "网页客服" : "控制台"} · {c.agent_name || "无Agent"} · {c.message_count} 条</div>
              </div>
            </div>
          ))}
          {convs.length === 0 && <div className="card empty">暂无会话，先新建一个</div>}
        </div>
        <div className="chat-main">
          <div className="chat-head">
            <span>{current ? (current.title || current.agent_name || "会话") : "选择左侧会话开始接待"}</span>
            {current && (
              <div className="row">
                <button className="btn small" onClick={() => closeConv(current)}>{current.status === "open" ? "关闭会话" : "重新打开"}</button>
              </div>
            )}
          </div>
          <div className="chat-body" ref={bodyRef}>
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                <div className="who">{m.role === "user" ? "顾客" : current?.agent_name || "客服"}</div>
                {m.content}
              </div>
            ))}
            {draft && (
              <div className="msg assistant">
                <div className="who">{current?.agent_name || "客服"}（回复中…）</div>
                {draft}
              </div>
            )}
            {busy && !draft && <div className="muted small" style={{ padding: 8 }}>客服思考中…</div>}
          </div>
          <div className="chat-input">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={current ? "输入顾客问题，Enter 发送" : "请先选择或新建会话"}
              disabled={!current || busy}
            />
            <button className="btn primary" onClick={send} disabled={!current || busy}>发送</button>
          </div>
        </div>
      </div>
    </div>
  );
}
