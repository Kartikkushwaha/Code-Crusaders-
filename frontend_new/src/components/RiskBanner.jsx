import { TriangleAlert, ShieldAlert, ShieldCheck } from "lucide-react";
import { RISK_STYLE } from "./ui.jsx";
import { PART_LABEL, PART_ORDER } from "../lib/riskParts.js";

export default function RiskBanner({ risk, scanning, actions, extraCounts, parts }) {
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
          <span>{parts ? "Average risk score" : "Risk score"}</span>
          <span className="font-mono font-semibold text-slate-200">{risk.score}/100</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full transition-all duration-500 ${s.meter}`} style={{ width: `${Math.max(3, risk.score)}%` }} />
        </div>
        {parts && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {PART_ORDER.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950/50 px-2 py-0.5 text-slate-300">
                {PART_LABEL[k]}
                {parts[k] ? <b className={`font-mono ${RISK_STYLE[parts[k].level].text}`}>{parts[k].score}</b> : <span className="text-slate-500">not checked</span>}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
          {risk.reasons.length ? risk.reasons.map((r) => <span key={r}>• {r}</span>) : <span>• No open issues - send it to your manager for approval</span>}
          {extraCounts ? <span className="text-slate-400">• includes {extraCounts}</span> : null}
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
        <div className="grid w-full grid-cols-3 gap-1.5 text-center sm:w-auto">
          <Count n={risk.counts.verified} label="Verified" cls="text-emerald-300" />
          <Count n={risk.counts.unverified} label="Unverified" cls="text-amber-300" />
          <Count n={risk.counts.contradicted} label="Contradicted" cls="text-rose-300" />
        </div>
        {actions}
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
    <div className="min-w-0 rounded-lg bg-slate-950/50 px-1.5 py-1 sm:min-w-[84px]">
      <div className={`text-base font-bold ${cls}`}>{n}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
