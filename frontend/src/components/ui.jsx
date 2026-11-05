import { useEffect } from "react";
import { CircleCheck, CircleHelp, CircleX, X } from "lucide-react";

export const VERDICT_STYLE = {
  VERIFIED: {
    label: "Verified",
    icon: CircleCheck,
    chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
    dot: "bg-emerald-400",
    bar: "border-l-emerald-400",
    text: "text-emerald-300",
  },
  UNVERIFIED: {
    label: "Unverified",
    icon: CircleHelp,
    chip: "bg-amber-500/10 text-amber-300 border-amber-500/40",
    dot: "bg-amber-400",
    bar: "border-l-amber-400",
    text: "text-amber-300",
  },
  CONTRADICTED: {
    label: "Contradicted",
    icon: CircleX,
    chip: "bg-rose-500/10 text-rose-300 border-rose-500/40",
    dot: "bg-rose-500",
    bar: "border-l-rose-500",
    text: "text-rose-300",
  },
};

export const RISK_STYLE = {
  HIGH: {
    label: "HIGH RISK",
    wrap: "border-rose-500/50 bg-gradient-to-r from-rose-950/90 via-rose-950/60 to-slate-900",
    text: "text-rose-300",
    pill: "bg-rose-500 text-white",
    meter: "bg-rose-500",
  },
  MEDIUM: {
    label: "MEDIUM RISK",
    wrap: "border-amber-500/50 bg-gradient-to-r from-amber-950/80 via-amber-950/50 to-slate-900",
    text: "text-amber-300",
    pill: "bg-amber-400 text-amber-950",
    meter: "bg-amber-400",
  },
  LOW: {
    label: "LOW RISK",
    wrap: "border-emerald-500/50 bg-gradient-to-r from-emerald-950/80 via-emerald-950/50 to-slate-900",
    text: "text-emerald-300",
    pill: "bg-emerald-400 text-emerald-950",
    meter: "bg-emerald-400",
  },
};

export function VerdictBadge({ verdict, size = "sm" }) {
  const s = VERDICT_STYLE[verdict];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold tracking-wide ${s.chip} ${
        size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      <Icon className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {verdict}
    </span>
  );
}

export function SeverityTag({ severity }) {
  if (!severity || severity === "none") return null;
  const cls = {
    high: "bg-rose-500/15 text-rose-300",
    medium: "bg-amber-500/15 text-amber-300",
    low: "bg-sky-500/15 text-sky-300",
  }[severity];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>{severity}</span>;
}

export function Button({ variant = "primary", size = "md", className = "", children, ...rest }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  const variants = {
    primary: "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-900/40 hover:from-blue-500 hover:to-indigo-500",
    secondary: "border border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-500 hover:bg-slate-700/80",
    ghost: "text-slate-300 hover:bg-slate-800 hover:text-white",
    danger: "bg-rose-600 text-white shadow-lg shadow-rose-900/40 hover:bg-rose-500",
    success: "bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 hover:bg-emerald-500",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Modal({ open, onClose, children, tone = "default", labelledBy, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const border = tone === "danger" ? "border-rose-500/70 shadow-rose-950/60" : tone === "success" ? "border-emerald-500/50" : "border-slate-700";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className={`pop-in relative max-h-[92vh] w-full overflow-y-auto rounded-2xl border bg-slate-900 shadow-2xl scrollbar-thin ${border} ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        {onClose && (
          <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-14 text-center">
      {Icon && (
        <div className="mb-3 rounded-2xl bg-slate-800/70 p-3">
          <Icon className="h-6 w-6 text-slate-400" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <div className="mt-1 max-w-md text-xs text-slate-400">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Toasts({ toasts, dismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`fade-in pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-xl backdrop-blur ${
            t.tone === "danger"
              ? "border-rose-500/50 bg-rose-950/90 text-rose-100"
              : t.tone === "success"
                ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
                : "border-slate-700 bg-slate-900/95 text-slate-200"
          }`}
        >
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-white" aria-label="Dismiss notification">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
