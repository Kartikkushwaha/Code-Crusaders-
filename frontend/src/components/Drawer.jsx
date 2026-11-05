import { useEffect } from "react";
import { BookOpen, ClipboardCheck, FilePenLine, History, LayoutDashboard, ShieldCheck, X } from "lucide-react";

const NAV = [
  { id: "workspace", label: "Audit Workspace", hint: "Upload, edit & live analysis", icon: LayoutDashboard },
  { id: "policies", label: "Policy Library", hint: "Guidelines, facts & tone", icon: BookOpen },
  { id: "verification", label: "Human Verification", hint: "Sign-off checklist", icon: ClipboardCheck },
  { id: "history", label: "Audit Trail", hint: "Publications & activity log", icon: History },
];

export default function Drawer({ open, onClose, view, onNavigate, badges, onNewDocument, policyName }) {
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
          <button
            onClick={onNewDocument}
            className="flex w-full items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2.5 text-left text-sm font-semibold text-indigo-200 hover:bg-indigo-500/20"
          >
            <FilePenLine className="h-4 w-4" />
            New audit
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
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
          <div className="mb-1 font-semibold text-slate-400">Active policy</div>
          <div className="truncate text-slate-300">{policyName}</div>
          <div className="mt-3">AI never auto-publishes. Every action is logged with who, what and when.</div>
        </div>
      </aside>
    </>
  );
}
