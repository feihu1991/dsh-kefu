import React, { useState } from "react";

const ICON_PATHS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3 1.3-4.6A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5" />
      <path d="M17.5 14.2A5.5 5.5 0 0 1 21 19.5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
      <path d="M4 5.5v15" />
      <path d="M8 7.5h8M8 11h8" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="17.5" cy="9" r="2.4" />
      <path d="M17 14.4a4.5 4.5 0 0 1 4 4.1" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 20 6v5.5c0 4.8-3.2 8.2-8 9.5-4.8-1.3-8-4.7-8-9.5V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.5a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.1.38.32.72.62 1 .3.28.68.43 1.08.43H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.57Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" /></>,
  send: <path d="m22 2-7 20-4-9-9-4Z" />,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  message: <path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.4A8 8 0 1 1 21 12Z" />,
  tag: <><path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9Z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
  robot: <><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M9 13h.01M15 13h.01M9 16h6" /><path d="M12 8V5M12 5h.01" /></>,
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5" />,
  filter: <path d="M4 5h16l-6.5 7.5V20l-3-1.5v-6Z" />,
  arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
  power: <><path d="M12 2v10" /><path d="M18.4 5.6a9 9 0 1 1-12.8 0" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
};

export function Icon({ name, size = 18, className = "" }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name] ?? ICON_PATHS.spark}
    </svg>
  );
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-header-actions">{actions}{children}</div>
    </header>
  );
}

export function Card({ className = "", children, onClick }) {
  return <section className={`card ${className}`} onClick={onClick}>{children}</section>;
}

export function Modal({ title, description, children, footer, onClose, width = 560 }) {
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon = "spark", title, desc, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={24} /></span>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {action}
    </div>
  );
}

export function Badge({ tone = "", children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function CopyButton({ text, children = "复制", className = "" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const el = document.createElement("textarea");
        el.value = text; document.body.appendChild(el); el.select(); document.execCommand("copy"); el.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("请手动复制：", text);
    }
  };
  return <button type="button" className={`btn small ${className}`} onClick={copy}>{copied ? "已复制" : children}</button>;
}

export function Avatar({ name = "", size = 36 }) {
  const text = String(name).trim().slice(0, 1) || "客";
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{text}</span>;
}

export function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const yd = new Date(now); yd.setDate(now.getDate() - 1);
  if (d.toDateString() === yd.toDateString()) return "昨天 " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
