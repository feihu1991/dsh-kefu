import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon, Card, PageHeader, Badge, Empty, formatTime } from "../ui.jsx";

export default function Dashboard({ session, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [kbCount, setKbCount] = useState(0);
  const [convs, setConvs] = useState([]);
  const [widgetAgents, setWidgetAgents] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, t, a, k, c] = await Promise.all([
          api("/stats"),
          api("/tiers"),
          api("/agents"),
          api("/kb").catch(() => ({ docs: [], count: 0 })),
          api("/conversations?limit=6").catch(() => ({ conversations: [] })),
        ]);
        setStats(s);
        setTiers(t.tiers || []);
        const list = a.agents || [];
        setAgents(list);
        setKbCount(k.count || (k.docs || []).length || 0);
        setConvs(c.conversations || []);
        const tokenLists = await Promise.all(list.map((ag) => api(`/agents/${ag.id}/widget-tokens`).catch(() => ({ tokens: [] }))));
        setWidgetAgents(tokenLists.filter((x) => (x.tokens || []).length > 0).length);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const enabledAgents = agents.filter((a) => a.status === "enabled");
  const steps = [
    { title: "创建并启用客服 Agent", desc: "配置人设话术与服务档位", done: enabledAgents.length > 0, page: "agents", action: "去创建" },
    { title: "录入店铺知识库", desc: "商品资料、售后政策、常见问答", done: kbCount > 0, page: "kb", action: "去录入" },
    { title: "生成网页接入凭据", desc: "独立问答页或悬浮球 SDK", done: widgetAgents > 0, page: "agents", action: "去接入" },
    { title: "开始接待顾客", desc: "在会话页处理控制台/网页咨询", done: (stats?.conversations || 0) > 0, page: "conversations", action: "去接待" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  if (loading) {
    return <div className="card" style={{ display: "grid", placeItems: "center", minHeight: 260 }}><span className="spinner" /></div>;
  }

  return (
    <div>
      <PageHeader
        title={`你好，${session.user.display_name || session.user.username}`}
        subtitle={`${session.merchant?.name || "平台"} · 今天也要把每一次咨询接好`}
        actions={<button className="btn primary" onClick={() => onNavigate("conversations")}><Icon name="chat" size={16} />进入会话接待</button>}
      />

      <div className="grid grid-4 mb-16">
        <Stat icon="chat" label="进行中会话" value={stats?.openConversations ?? 0} hint={`累计 ${stats?.conversations ?? 0} 个会话`} />
        <Stat icon="message" label="今日消息" value={stats?.todayMessages ?? 0} hint={`消息总量 ${stats?.messages ?? 0}`} />
        <Stat icon="team" label="客服 Agent" value={agents.length} hint={`${enabledAgents.length} 个接待中`} />
        <Stat icon="book" label="知识库资料" value={kbCount} hint={kbCount ? "已参与 RAG 检索" : "建议尽快录入"} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, .9fr)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div className="card-head">
              <div>
                <div className="card-title">营业准备度</div>
                <div className="card-sub">完成 {doneCount}/{steps.length} 项，即可对外接待顾客</div>
              </div>
              <Badge tone={doneCount === steps.length ? "ok" : "brand"}>{doneCount === steps.length ? "已就绪" : "待完善"}</Badge>
            </div>
            <div className="guide-list">
              {steps.map((step, index) => (
                <div key={step.title} className={`guide-item ${step.done ? "done" : ""}`}>
                  <span className="guide-index">{step.done ? <Icon name="check" size={14} /> : index + 1}</span>
                  <div className="guide-main">
                    <strong>{step.title}</strong>
                    <p>{step.desc}</p>
                  </div>
                  {!step.done && <button className="btn small" onClick={() => onNavigate(step.page)}>{step.action}</button>}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <div className="card-title">最近会话</div>
                <div className="card-sub">控制台与网页客服的最新咨询</div>
              </div>
              <button className="btn small ghost" onClick={() => onNavigate("conversations")}>查看全部<Icon name="chevronRight" size={14} /></button>
            </div>
            {convs.length === 0 ? (
              <Empty icon="chat" title="还没有会话" desc="顾客从网页咨询或控制台新建会话后，会显示在这里。" action={<button className="btn primary small" onClick={() => onNavigate("conversations")}>去创建会话</button>} />
            ) : (
              <div className="list">
                {convs.map((c) => (
                  <div key={c.id} className="list-row" style={{ cursor: "pointer" }} onClick={() => onNavigate("conversations")}>
                    <span className="avatar gray" style={{ width: 34, height: 34, borderRadius: 11 }}>{c.channel === "widget" ? "网" : "台"}</span>
                    <div className="list-main">
                      <div className="list-title">{c.title || c.agent_name || "未命名会话"}</div>
                      <div className="list-desc">{c.channel === "widget" ? "网页客服" : "控制台"} · {c.agent_name || "未分配 Agent"} · {c.message_count || 0} 条消息</div>
                    </div>
                    <div className="list-meta">{formatTime(c.updated_at)}<br /><Badge tone={c.status === "open" ? "ok" : ""}>{c.status === "open" ? "接待中" : "已关闭"}</Badge></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div className="card-head">
              <div>
                <div className="card-title">网页接入状态</div>
                <div className="card-sub">独立问答页 / 悬浮球 SDK</div>
              </div>
              <Icon name="globe" size={20} className="muted" />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="stat-value" style={{ fontSize: 24 }}>{widgetAgents}</span>
              <span className="muted small">/ {agents.length || 0} 个 Agent 已生成凭据</span>
            </div>
            <div className="divider" />
            <div className="muted small" style={{ lineHeight: 1.8 }}>
              生成凭据后可在店铺页面嵌入一行 SDK，或直接分享独立问答页；建议同时配置店铺域名白名单与每日额度。
            </div>
            <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => onNavigate("agents")}><Icon name="link" size={15} />管理网页接入</button>
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <div className="card-title">可选服务档位</div>
                <div className="card-sub">由平台统一配置，商家只看到名称</div>
              </div>
              <Icon name="spark" size={20} className="muted" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {tiers.map((t) => (
                <div key={t.id} className="copy-line">
                  <span className="tag"><Icon name="spark" size={12} />{t.name}</span>
                  <span className="small muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description || "模型服务档位"}</span>
                </div>
              ))}
              {tiers.length === 0 && <div className="muted small">平台暂未配置档位</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span className="stat-icon"><Icon name={icon} size={18} /></span>
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
