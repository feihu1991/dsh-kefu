import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Dashboard({ session }) {
  const [stats, setStats] = useState(null);
  const [tiers, setTiers] = useState([]);

  useEffect(() => {
    api("/stats").then(setStats).catch(() => {});
    api("/tiers").then((d) => setTiers(d.tiers)).catch(() => {});
  }, []);

  return (
    <div className="page">
      <h2>仪表盘</h2>
      {session.merchant && (
        <div className="card">
          <h3>{session.merchant.name}</h3>
          <div className="muted small">商家 ID：{session.merchant.id}</div>
        </div>
      )}
      {stats && (
        <div className="stats">
          <div className="stat"><div className="t">店员 Agent</div><div className="n">{stats.agents}</div></div>
          <div className="stat"><div className="t">总会话</div><div className="n">{stats.conversations}</div></div>
          <div className="stat"><div className="t">接待中</div><div className="n">{stats.openConversations}</div></div>
          <div className="stat"><div className="t">消息总量</div><div className="n">{stats.messages}</div></div>
          <div className="stat"><div className="t">今日消息</div><div className="n">{stats.todayMessages}</div></div>
        </div>
      )}
      <div className="card">
        <h3>可选服务档位</h3>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {tiers.map((t) => (
            <span key={t.id} className="badge" style={{ fontSize: 13, padding: "6px 12px" }}>{t.name} · {t.description}</span>
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>
          创建店员 Agent 时可按档位选择模型服务，档位对应模型由平台统一配置。
        </div>
      </div>
    </div>
  );
}
