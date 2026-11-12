import { useEffect } from "react";
import { BarChart3, Building2, ClipboardCheck, FilePenLine, History, Inbox, LayoutDashboard, LogOut, Repeat, Scale, ShieldCheck, X } from "lucide-react";
import { RoleBadge } from "./TopBar.jsx";

export const NAV = {
  creator: [
    { id: "workspace", label: "Check content", hint: "Upload content, images & policy, fix issues", icon: LayoutDashboard },
    { id: "verification", label: "Sign-off", hint: "Final human checklist after approval", icon: ClipboardCheck },
    { id: "insights", label: "Insights", hint: "Common graph + company graph", icon: BarChart3 },
    { id: "history", label: "History & sign-off", hint: "AI audits, approvals and sign-offs", icon: History },
  ],
  manager: [
    { id: "approvals", label: "Approval requests", hint: "Content sent by creators", icon: Inbox },
    { id: "insights", label: "Insights", hint: "Common graph + company graph", icon: BarChart3 },
    { id: "history", label: "History & sign-off", hint: "AI audits, approvals and sign-offs", icon: History },
  ],
  legal: [
    { id: "legal", label: "Legal review", hint: "Submissions forwarded by the manager", icon: Scale },
    { id: "insights", label: "Insights", hint: "Common graph + company graph", icon: BarChart3 },
    { id: "history", label: "History & sign-off", hint: "AI audits, approvals and sign-offs", icon: History },
  ],
};
export const PANEL_TITLE = { creator: "Creator panel", manager: "Manager panel", legal: "Legal approver panel" };

export default function Drawer({ open, onClose, view, onNavigate, badges, onNewDocument, policyName, role, session, onSwitchAccount, onLogout }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-800 bg-slate-900/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Main navigation"
        inert={!open}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-2 shadow-lg shadow-indigo-900/50">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-tight">PUBLIVRA AI</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400">Brand governance</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pt-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              <Building2 className="h-3 w-3" /> {session.company}
            </div>
            <div className="mt-1 truncate text-xs text-slate-200">{session.email}</div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <RoleBadge role={role} />
              <span className="flex gap-1">
                <button onClick={onSwitchAccount} title="Switch account" aria-label="Switch account" className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
                  <Repeat className="h-3.5 w-3.5" />
                </button>
                <button onClick={onLogout} title="Logout" aria-label="Logout" className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300">
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          </div>
        </div>

        {role === "creator" && (
        <div className="px-3 pt-3">
          <button
            onClick={onNewDocument}
            className="flex w-full items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2.5 text-left text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
          >
            <FilePenLine className="h-4 w-4" />
            New check
          </button>
        </div>
        )}

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV[role].map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-slate-800 text-white ring-1 ring-slate-700" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <Icon className={`h-4.5 w-4.5 shrink-0 ${active ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300"}`} />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="block text-[11px] text-slate-500">{item.hint}</span>
                </span>
                {badges[item.id] ? (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{badges[item.id]}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 text-[11px] leading-relaxed text-slate-500">
          <div className="mb-1 font-semibold text-slate-400">Checking against</div>
          <div className="truncate text-slate-300">{policyName}</div>
          <div className="mt-3">AI never auto-publishes. Every action is logged with who, what and when.</div>
        </div>
      </aside>
    </>
  );
}
