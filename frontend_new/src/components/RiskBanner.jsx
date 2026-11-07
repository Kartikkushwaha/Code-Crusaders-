import { TriangleAlert, ShieldAlert, ShieldCheck, Rocket } from "lucide-react";
import { RISK_STYLE, Button } from "./ui.jsx";

export default function RiskBanner({ risk, onPublish, canPublish, scanning }) {
  const s = RISK_STYLE[risk.level];
  const Icon = risk.level === "HIGH" ? ShieldAlert : risk.level === "MEDIUM" ? TriangleAlert : ShieldCheck;
  return (
    <section className={`fade-in flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center ${s.wrap}`} aria-live="polite" aria-label="Overall risk">
      <div className="flex items-center gap-3">
        <div className={`rounded-xl p-2.5 ${risk.level === "HIGH" ? "bg-rose-500/20" : risk.level === "MEDIUM" ? "bg-amber-500/20" : "bg-emerald-500/20"}`}>
          <Icon className={`h-7 w-7 ${s.text} ${risk.level === "HIGH" ? "animate-pulse" : ""}`} />
        </div>
        <div>
          <div className={`text-xl font-extrabold tracking-tight ${s.text}`}>{s.label}</div>
          <div className="max-w-xs text-xs text-slate-300">{scanning ? "Checking your latest changes…" : headline(risk)}</div>
        </div>
      </div>

      <div className="flex-1 sm:px-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>Risk score</span>
          <span className="font-mono font-semibold text-slate-200">{risk.score}/100</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full transition-all duration-500 ${s.meter}`} style={{ width: `${Math.max(3, risk.score)}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
          {risk.reasons.length ? risk.reasons.map((r) => <span key={r}>• {r}</span>) : <span>• No open issues - ready for human sign-off</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <Count n={risk.counts.verified} label="Verified" cls="text-emerald-300" />
          <Count n={risk.counts.unverified} label="Unverified" cls="text-amber-300" />
          <Count n={risk.counts.contradicted} label="Contradicted" cls="text-rose-300" />
        </div>
        <Button variant={risk.level === "HIGH" ? "danger" : "primary"} onClick={onPublish} disabled={!canPublish}>
          <Rocket className="h-4 w-4" /> Publish
        </Button>
      </div>
    </section>
  );
}

function headline(risk) {
  const { high, contradicted, unverified } = risk.counts;
  if (risk.level === "HIGH") return `${high} serious problem${high === 1 ? "" : "s"} must be fixed before publishing.`;
  if (risk.level === "MEDIUM")
    return `Safe to publish after a review: ${contradicted} policy issue${contradicted === 1 ? "" : "s"}, ${unverified} claim${unverified === 1 ? "" : "s"} without a source.`;
  return "Looks good. Do a final read and publish.";
}

function Count({ n, label, cls }) {
  return (
    <div className="rounded-lg bg-slate-950/50 px-2 py-1">
      <div className={`text-base font-bold ${cls}`}>{n}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}
