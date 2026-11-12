import { BriefcaseBusiness, Lock, Menu, PenLine, Rocket, Scale, ShieldCheck } from "lucide-react";

const ENGINE = {
  checking: { label: "Connecting", dot: "bg-slate-400 animate-pulse" },
  waking: { label: "Waking AI engine", dot: "bg-amber-400 animate-pulse" },
  online: { label: "AI engine online", dot: "bg-emerald-400" },
  degraded: { label: "AI key missing", dot: "bg-amber-400" },
  offline: { label: "AI engine offline", dot: "bg-rose-500" },
};
import { RISK_STYLE } from "./ui.jsx";

export const ROLE_TABS = [
  { id: "creator", label: "Creator", icon: PenLine },
  { id: "manager", label: "Manager", icon: BriefcaseBusiness },
  { id: "legal", label: "Legal", icon: Scale },
];

/** Switch between the Creator, Manager and Legal approver panels (shared state). */
export function RoleSwitcher({ role, onRole, badges = {}, full = false }) {
  return (
    <div role="radiogroup" aria-label="Switch panel" className={`inline-flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 ${full ? "w-full" : ""}`}>
      {ROLE_TABS.map((r) => (
        <button
          key={r.id}
          role="radio"
          aria-checked={role === r.id}
          onClick={() => onRole(r.id)}
          title={`${r.label} panel`}
          className={`relative inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition ${full ? "flex-1" : ""} ${
            role === r.id ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
          }`}
        >
          <r.icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className={full ? "" : "hidden sm:inline"}>{r.label}</span>
          {badges[r.id] ? (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{badges[r.id]}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export default function TopBar({ onToggleDrawer, drawerOpen, title, risk, scanning, onPublish, canPublish, engine, onRetryEngine, role, onRole, roleBadges }) {
  const eng = ENGINE[engine?.status || "checking"];
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-800 bg-slate-950/85 px-3 backdrop-blur-xl sm:px-4">
      <button
        onClick={onToggleDrawer}
        className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:border-slate-600 hover:text-white"
        aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={drawerOpen}
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-indigo-400" />
        <span className="hidden text-sm font-extrabold tracking-tight min-[420px]:inline">PUBLIVRA AI</span>
      </div>
      <RoleSwitcher role={role} onRole={onRole} badges={roleBadges} />
      {title && role === "creator" && (
        <div className="hidden min-w-0 items-center gap-2 border-l border-slate-800 pl-3 md:flex">
          <span className="truncate text-sm text-slate-400">{title}</span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onRetryEngine}
          title={engine?.info ? `${engine.info.ai.model} · DB ${engine.info.database.state}` : engine?.error || "Click to re-check"}
          className="hidden items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-600 lg:inline-flex"
        >
          <span className={`h-2 w-2 rounded-full ${eng.dot}`} />
          {eng.label}
        </button>
        {risk && role === "creator" && (
          <span
            className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide sm:inline-flex ${RISK_STYLE[risk.level].pill}`}
            aria-live="polite"
          >
            {scanning && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />}
            {RISK_STYLE[risk.level].label}
          </span>
        )}
        {role === "creator" && (
        <button
          onClick={onPublish}
          disabled={!canPublish}
          title={canPublish ? "Publish & download PDF" : "Locked until the manager and legal approver approve this version"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-900/40 hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {canPublish ? <Rocket className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Publish</span>
        </button>
        )}
      </div>
    </header>
  );
}
