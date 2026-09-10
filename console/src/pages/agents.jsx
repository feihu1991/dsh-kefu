import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon, Card, PageHeader, Badge, Empty, Modal, Avatar, CopyButton } from "../ui.jsx";

const emptyAgent = { name: "", persona: "", tierId: "", welcomeMessage: "", status: "enabled" };

export default function AgentsPage({ session }) {
  const [agents, setAgents] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(null);
  const [err, setErr] = useState("");
  const [widgetAgent, setWidgetAgent] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [tokenErr, setTokenErr] = useState("");
  const [origins, setOrigins] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = session.user.role === "merchant_admin";

  const load = async () => {
    try {
      const [a, t] = await Promise.all([api("/agents"), api("/tiers")]);
      setAgents(a.agents || []);
      setTiers(t.tiers || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(load, []);

  const openCreate = () => { setErr(""); setShow({ ...emptyAgent, tierId: tiers[0]?.id || "" }); };
  const openEdit = (agent) => { setErr(""); setShow({ ...agent, tierId: agent.tier_id || "" }); };

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      if (show.id) await api(`/agents/${show.id}`, { method: "PATCH", body: show });
      else await api("/agents", { method: "POST", body: show });
      setShow(null);
      await load();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const toggle = async (agent) => {
    await api(`/agents/${agent.id}`, { method: "PATCH", body: { status: agent.status === "enabled" ? "disabled" : "enabled" } });
    await load();
  };

  const remove = async (agent) => {
    if (!confirm(`确认删除客服「${agent.name}」？历史会话会保留。`)) return;
    await api(`/agents/${agent.id}`, { method: "DELETE" });
    await load();
  };

  const openWidget = async (agent) => {
    setWidgetAgent(agent); setTokenErr(""); setOrigins("");
    const d = await api(`/agents/${agent.id}/widget-tokens`).catch(() => ({ tokens: [] }));
    setTokens(d.tokens || []);
  };

  const createToken = async () => {
    setBusy(true); setTokenErr("");
    try {
      const d = await api(`/agents/${widgetAgent.id}/widget-tokens`, { method: "POST", body: { allowedOrigins: origins } });
      setOrigins("");
      const next = await api(`/agents/${widgetAgent.id}/widget-tokens`);
      setTokens(next.tokens || []);
    } catch (ex) {
      setTokenErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async (token) => {
    if (!confirm("确认删除这个网页客服凭据？已接入的页面会立即失效。")) return;
    await api(`/widget-tokens/${token}`, { method: "DELETE" });
    setTokens(tokens.filter((t) => t.token !== token));
  };

  const basePath = location.pathname.replace(/\/+$/, "");
  const assetBase = location.origin + basePath;

  return (
    <div>
      <PageHeader
        title="客服团队"
        subtitle="创建并配置客服 Agent，管理网页客服接入凭据"
        actions={isAdmin && <button className="btn primary" onClick={openCreate}><Icon name="plus" size={16} />新建客服 Agent</button>}
      />

      {loading ? (
        <div className="card" style={{ display: "grid", placeItems: "center", minHeight: 220 }}><span className="spinner" /></div>
      ) : agents.length === 0 ? (
        <Card><Empty icon="team" title="还没有客服 Agent" desc="创建第一个客服 Agent，设置人设话术与服务档位后即可接待顾客。" action={isAdmin && <button className="btn primary" onClick={openCreate}>新建客服 Agent</button>} /></Card>
      ) : (
        <div className="agent-grid">
          {agents.map((agent) => (
            <Card key={agent.id} className="agent-card">
              <div className="agent-head">
                <Avatar name={agent.name} size={44} />
                <div className="grow">
                  <h3>{agent.name}</h3>
                  <p>{agent.tier?.name || "默认档位"} · {agent.status === "enabled" ? "接待中" : "已停用"}</p>
                </div>
                <Badge tone={agent.status === "enabled" ? "ok" : ""}>{agent.status === "enabled" ? "启用" : "停用"}</Badge>
              </div>
              <div className="agent-persona">{agent.persona || "还没有设置人设话术，建议补充客服语气和业务规则。"}</div>
              <div className="agent-foot">
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone="info">{agent.tier?.name || "未选档位"}</Badge>
                  {agent.welcome_message && <span className="tag">有欢迎语</span>}
                </div>
                <div className="list-actions">
                  <button className="btn small" onClick={() => openWidget(agent)}><Icon name="globe" size={13} />接入</button>
                  {isAdmin && <button className="btn small ghost" onClick={() => openEdit(agent)}>编辑</button>}
                  {isAdmin && <button className="btn small ghost" onClick={() => toggle(agent)}>{agent.status === "enabled" ? "停用" : "启用"}</button>}
                  {isAdmin && <button className="btn small danger" onClick={() => remove(agent)}><Icon name="trash" size={13} /></button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {show && (
        <Modal
          title={show.id ? `编辑客服：${show.name}` : "新建客服 Agent"}
          description="人设话术会注入 system prompt，建议写清业务范围和回答风格。"
          onClose={() => setShow(null)}
          footer={<><button type="button" className="btn" onClick={() => setShow(null)}>取消</button><button type="submit" form="agent-form" className="btn primary">保存</button></>}
        >
          <form id="agent-form" onSubmit={save}>
            <div className="field"><label>名称</label><input value={show.name} onChange={(e) => setShow({ ...show, name: e.target.value })} placeholder="例如：客服小星" required /></div>
            <div className="field">
              <label>服务档位</label>
              <select value={show.tierId} onChange={(e) => setShow({ ...show, tierId: e.target.value })}>
                <option value="">不指定（使用默认模型）</option>
                {tiers.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}
              </select>
            </div>
            <div className="field">
              <label>人设 / 话术</label>
              <textarea rows={5} value={show.persona} onChange={(e) => setShow({ ...show, persona: e.target.value })} placeholder="例如：你是本店资深客服，熟悉 7 天无理由退换货规则，回答要简洁、亲切，不确定时建议转人工。" />
              <div className="hint">最多 4000 字；知识库内容会作为权威依据额外注入。</div>
            </div>
            <div className="field"><label>欢迎语</label><input value={show.welcomeMessage} onChange={(e) => setShow({ ...show, welcomeMessage: e.target.value })} placeholder="网页客服打开时自动展示" /></div>
            {show.id && (
              <div className="field">
                <label>状态</label>
                <select value={show.status || "enabled"} onChange={(e) => setShow({ ...show, status: e.target.value })}>
                  <option value="enabled">启用，参与接待</option>
                  <option value="disabled">停用</option>
                </select>
              </div>
            )}
            {err && <div className="err">{err}</div>}
          </form>
        </Modal>
      )}

      {widgetAgent && (
        <Modal
          title={`网页接入 · ${widgetAgent.name}`}
          description="生成凭据后，可分享独立问答页链接，或把悬浮球 SDK 嵌入店铺页面。"
          onClose={() => setWidgetAgent(null)}
          width={680}
          footer={<button type="button" className="btn" onClick={() => setWidgetAgent(null)}>关闭</button>}
        >
          <div className="field">
            <label>允许的店铺域名（可选，逗号分隔）</label>
            <input value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://shop.example.com, https://mall.example.com" />
            <div className="hint">留空表示不限制来源；同一凭据只允许这些 Origin 的浏览器请求。修改域名需删除后重新生成凭据。</div>
          </div>
          <button className="btn primary" onClick={createToken} disabled={busy}>{busy ? "生成中…" : <><Icon name="plus" size={15} />生成新凭据</>}</button>
          {tokenErr && <div className="err">{tokenErr}</div>}

          <div className="divider" />
          <div className="card-title" style={{ marginBottom: 10 }}>已有凭据（{tokens.length}）</div>
          {tokens.length === 0 ? (
            <div className="muted small">还没有凭据，生成后即可接入网页客服。</div>
          ) : (
            <div className="list">
              {tokens.map((t) => {
                const pageUrl = `${location.origin}${basePath}/widget/${t.token}`;
                const sdk = `<script src="${assetBase}/kefu-sdk.js" data-token="${t.token}" data-server="${location.origin}" data-base-path="${basePath}"></` + `script>`;
                return (
                  <div key={t.token} className="list-row" style={{ alignItems: "flex-start", flexDirection: "column" }}>
                    <div className="row-between" style={{ width: "100%" }}>
                      <div className="grow">
                        <div className="list-title">凭据 …{t.token.slice(-8)} <Badge tone={t.enabled ? "ok" : ""}>{t.enabled ? "启用" : "停用"}</Badge></div>
                        <div className="list-desc">{t.allowed_origins ? `白名单：${t.allowed_origins}` : "来源限制：未配置"}</div>
                      </div>
                      <button className="btn small danger" onClick={() => removeToken(t.token)}><Icon name="trash" size={13} />删除</button>
                    </div>
                    <div style={{ width: "100%", marginTop: 10 }}>
                      <div className="small muted" style={{ marginBottom: 6 }}>独立问答页</div>
                      <div className="copy-line"><code>{pageUrl}</code><CopyButton text={pageUrl} /><a className="btn small" href={pageUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} /></a></div>
                      <div className="small muted" style={{ margin: "10px 0 6px" }}>悬浮球 SDK</div>
                      <div className="copy-line"><code>{sdk}</code><CopyButton text={sdk} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
