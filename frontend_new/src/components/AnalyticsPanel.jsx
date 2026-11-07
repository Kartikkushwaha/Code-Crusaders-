import { useEffect, useMemo, useState } from "react";
import { Activity, BrainCircuit, Crosshair, Gauge, ListChecks, MicVocal, X } from "lucide-react";
import { groupOf, ISSUE_GROUPS } from "../lib/insights.js";
import AiAuditCard from "./AiAuditCard.jsx";
import FindingDetails from "./FindingDetails.jsx";
import { VERDICT_STYLE, VerdictBadge, SeverityTag } from "./ui.jsx";
import SuggestionsQueue from "./SuggestionsQueue.jsx";
import ToneAuditor from "./ToneAuditor.jsx";

const FILTERS = ["ALL", "CONTRADICTED", "UNVERIFIED", "VERIFIED"];

export default function AnalyticsPanel({ analysis, risk, dismissed, scanning, onLocate, onAccept, onAcceptAll, onDismiss, onRestore, onManualEdit, policyName, ai, aiStale, engine, apiBase, onRunAi, onRetryEngine, policyDoc, focus, onOpenRef }) {
  const [tab, setTab] = useState("suggestions");
  const [filter, setFilter] = useState("ALL");
  const [group, setGroup] = useState(null);

  // Dashboard "Review" buttons open a tab pre-filtered to one issue type.
  useEffect(() => {
    if (!focus) return;
    setTab(focus.tab);
    setGroup(focus.group ?? null);
  }, [focus]);

  const findings = analysis?.findings ?? [];
  const queue = useMemo(
    () => findings.filter((f) => f.verdict !== "VERIFIED" && !dismissed[f.id] && (!group || groupOf(f) === group)),
    [findings, dismissed, group],
  );

  const visible = findings.filter((f) => filter === "ALL" || f.verdict === filter);
  const order = { CONTRADICTED: 0, UNVERIFIED: 1, VERIFIED: 2 };
  const sorted = [...visible].sort((a, b) => order[a.verdict] - order[b.verdict]);

  const TABS = [
    { id: "suggestions", label: "Fix issues", icon: BrainCircuit, count: queue.length },
    { id: "findings", label: "All flags", icon: ListChecks, count: findings.length },
    { id: "tone", label: "Tone", icon: MicVocal },
  ];

  return (
    <aside className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl" aria-label="AI Compliance Analytics Panel">
      <div className="border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className={`h-4 w-4 ${scanning ? "animate-pulse text-indigo-400" : "text-emerald-400"}`} />
          <h2 className="text-sm font-bold">Compliance check</h2>
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${scanning ? "bg-indigo-500/15 text-indigo-300" : "bg-emerald-500/10 text-emerald-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${scanning ? "animate-ping bg-indigo-400" : "bg-emerald-400"}`} />
            {scanning ? "Scanning" : "Live"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">Checking against: {policyName}</p>

        {analysis && (
          <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
            <Mini label="Sentences" value={analysis.stats.sentences} />
            <Mini label="Clean" value={analysis.stats.clean} cls="text-slate-200" />
            <Mini label="Tone" value={`${analysis.tone.score}`} cls={analysis.tone.score >= 7 ? "text-emerald-300" : analysis.tone.score >= 5 ? "text-amber-300" : "text-rose-300"} suffix="/10" />
            <Mini label="Overrides" value={risk?.counts.dismissed ?? 0} cls="text-sky-300" />
          </div>
        )}
      </div>

      <AiAuditCard ai={ai} stale={aiStale} engine={engine} apiBase={apiBase} onRun={onRunAi} onRetry={onRetryEngine} policyDoc={policyDoc} disabled={!analysis || !analysis.stats.words} />

      <div className="flex border-b border-slate-800" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors ${
                tab === t.id ? "border-indigo-500 bg-slate-800/40 text-indigo-300" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count !== undefined && <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-300">{t.count}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {!analysis && <p className="p-6 text-center text-xs text-slate-500">Add content to start the live audit.</p>}

        {analysis && tab === "findings" && (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {FILTERS.map((f) => {
                const n = f === "ALL" ? findings.length : findings.filter((x) => x.verdict === f).length;
                const active = filter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      active ? "border-indigo-400 bg-indigo-500/15 text-indigo-200" : "border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {f !== "ALL" && <span className={`h-2 w-2 rounded-full ${VERDICT_STYLE[f].dot}`} />}
                    {f === "ALL" ? "All" : VERDICT_STYLE[f].label} <span className="text-slate-500">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="mb-3 grid grid-cols-3 gap-1.5 text-[10px] leading-tight text-slate-400">
              <span className="rounded-lg bg-emerald-500/10 px-2 py-1.5"><b className="block text-emerald-300">Verified</b>Backed by your sources</span>
              <span className="rounded-lg bg-amber-500/10 px-2 py-1.5"><b className="block text-amber-300">Unverified</b>No source found yet</span>
              <span className="rounded-lg bg-rose-500/10 px-2 py-1.5"><b className="block text-rose-300">Contradicted</b>Breaks your policy</span>
            </div>
            {sorted.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
                {findings.length ? "Nothing in this filter." : "No claims or rule matches found yet. Facts, figures, guarantees and restricted terms will appear here."}
              </p>
            )}
            <ul className="space-y-2">
              {sorted.map((f) => (
                <FindingCard key={f.id} f={f} dismissedReason={dismissed[f.id]} onLocate={() => onLocate(f)} onRestore={() => onRestore(f)} onOpenRef={onOpenRef} />
              ))}
            </ul>
          </>
        )}

        {analysis && tab === "suggestions" && group && (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-slate-800/70 px-3 py-2 text-xs">
            <span>
              Showing: <b className="text-slate-100">{ISSUE_GROUPS[group]?.title}</b>
            </span>
            <button onClick={() => setGroup(null)} className="inline-flex items-center gap-1 text-slate-400 hover:text-white">
              Show all <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {analysis && tab === "suggestions" && (
          <SuggestionsQueue queue={queue} onAccept={onAccept} onAcceptAll={onAcceptAll} onDismiss={onDismiss} onManualEdit={onManualEdit} onLocate={onLocate} onOpenRef={onOpenRef} />
        )}

        {analysis && tab === "tone" && <ToneAuditor tone={analysis.tone} />}
      </div>

      {analysis && (
        <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">
          <Gauge className="h-3 w-3" /> Rules run first · LLM layer sees approved sources only · Unverified is the default state
        </div>
      )}
    </aside>
  );
}

function Mini({ label, value, cls = "text-slate-100", suffix }) {
  return (
    <div className="rounded-lg bg-slate-950/60 px-1.5 py-1.5">
      <div className={`text-sm font-bold ${cls}`}>
        {value}
        {suffix && <span className="text-[10px] text-slate-500">{suffix}</span>}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function Highlight({ sentence, match, verdict }) {
  const i = match ? sentence.indexOf(match) : -1;
  if (i < 0) return <>{sentence}</>;
  const cls = { VERIFIED: "bg-emerald-400/20 text-emerald-200", UNVERIFIED: "bg-amber-400/20 text-amber-200", CONTRADICTED: "bg-rose-500/25 text-rose-200" }[verdict];
  return (
    <>
      {sentence.slice(0, i)}
      <mark className={`rounded px-0.5 ${cls}`}>{match}</mark>
      {sentence.slice(i + match.length)}
    </>
  );
}

function FindingCard({ f, dismissedReason, onLocate, onRestore, onOpenRef }) {
  const s = VERDICT_STYLE[f.verdict];
  return (
    <li className={`fade-in rounded-xl border border-slate-800 border-l-4 bg-slate-950/50 p-3 ${s.bar} ${dismissedReason ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-1.5">
        <VerdictBadge verdict={f.verdict} size="xs" />
        <SeverityTag severity={f.severity} />
        {f.ai && <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">AI</span>}
        <span className="text-[10px] text-slate-500">{f.category}</span>
        {f.located !== false && (
          <button onClick={onLocate} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-indigo-300" title="Show in document" aria-label="Show in document">
            <Crosshair className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-300">
        “<Highlight sentence={f.sentence} match={f.match} verdict={f.verdict} />”
      </p>
      <FindingDetails f={f} onOpenRef={onOpenRef} />
      {f.suggestion && f.verdict !== "VERIFIED" && (
        <p className="mt-1.5 break-words rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-200">
          <b className="text-emerald-300">Suggested fix: </b>
          {f.suggestion.preview}
        </p>
      )}
      {dismissedReason && (
        <div className="mt-2 flex items-center justify-between rounded-md bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300">
          <span>Overridden: {dismissedReason}</span>
          <button onClick={onRestore} className="font-semibold underline hover:text-white">
            Restore
          </button>
        </div>
      )}
    </li>
  );
}
