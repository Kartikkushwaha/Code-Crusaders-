import { useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, Building2, ChevronDown, Lock, LogOut, Menu, PenLine, Repeat, Rocket, Scale, ShieldCheck } from "lucide-react";

const ENGINE = {
  checking: { label: "Connecting", dot: "bg-slate-400 animate-pulse" },
  waking: { label: "Waking AI engine", dot: "bg-amber-400 animate-pulse" },
  online: { label: "AI engine online", dot: "bg-emerald-400" },
  degraded: { label: "AI key missing", dot: "bg-amber-400" },
  offline: { label: "AI engine offline", dot: "bg-rose-500" },
};
import { RiskPill } from "./RiskBreakdown.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

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

const ROLE_BADGE = {
  creator: { label: "Creator", icon: PenLine, cls: "border-indigo-500/50 bg-indigo-500/15 text-indigo-200" },
  manager: { label: "Manager", icon: BriefcaseBusiness, cls: "border-amber-500/50 bg-amber-500/15 text-amber-200" },
  legal: { label: "Legal Approver", icon: Scale, cls: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200" },
};

export function RoleBadge({ role, compact = false }) {
  const r = ROLE_BADGE[role];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${r.cls}`}>
      <r.icon className="h-3 w-3" aria-hidden="true" />
      <span className={compact ? "hidden sm:inline" : ""}>{r.label}</span>
    </span>
  );
}

/** Signed-in account: company, ID, role badge + Switch account / Logout. */
export function AccountMenu({ session, onSwitch, onLogout, badges = {} }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const waiting = Object.entries(badges).filter(([r, n]) => r !== session.role && n);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account"
        className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-left hover:border-slate-600"
      >
        <RoleBadge role={session.role} compact />
        <span className="hidden min-w-0 flex-col leading-tight md:flex">
          <span className="truncate text-[11px] font-semibold text-slate-100">{session.company}</span>
          <span className="truncate text-[10px] text-slate-400">{session.email}</span>
        </span>
        {waiting.length > 0 && <span className="h-2 w-2 rounded-full bg-rose-500" aria-label="Other roles have items waiting" />}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className="fade-in absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl sm:left-auto sm:right-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Building2 className="h-3.5 w-3.5" /> {session.mode === "company" ? "Company" : "Parent company"}
            {session.mode === "demo" && <span className="ml-auto rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 text-[10px] font-semibold text-amber-200">Demo</span>}
          </div>
          <div className="mt-0.5 truncate text-sm font-bold text-white">{session.company}</div>
          <div className="mt-2 truncate text-xs text-slate-300">{session.email}</div>
          <div className="mt-1.5">
            <RoleBadge role={session.role} />
          </div>
          {waiting.length > 0 && (
            <p className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
              Waiting: {waiting.map(([r, n]) => `${n} for ${ROLE_BADGE[r].label}`).join(", ")}
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setOpen(false);
                onSwitch();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              <Repeat className="h-3.5 w-3.5" /> Switch account
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 px-2 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/10"
            >
              <LogOut className="h-3.5 w-3.5" /> Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopBar({ onToggleDrawer, drawerOpen, title, risk, scanning, onPublish, canPublish, engine, onRetryEngine, role, session, onSwitchAccount, onLogout, roleBadges }) {
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
      <AccountMenu session={session} onSwitch={onSwitchAccount} onLogout={onLogout} badges={roleBadges} />
      {title && role === "creator" && (
        <div className="hidden min-w-0 items-center gap-2 border-l border-slate-800 pl-3 md:flex">
          <span className="truncate text-sm text-slate-400">{title}</span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={onRetryEngine}
          title={engine?.info ? `${engine.info.ai.model} · DB ${engine.info.database.state}` : engine?.error || "Click to re-check"}
          className="hidden items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-600 lg:inline-flex"
        >
          <span className={`h-2 w-2 rounded-full ${eng.dot}`} />
          {eng.label}
        </button>
        {/* hover / focus: text, logo & graphics and video scores, and their average */}
        {risk && role === "creator" && <RiskPill risk={risk} scanning={scanning} />}
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
