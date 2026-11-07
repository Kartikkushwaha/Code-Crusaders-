import { useState } from "react";
import { ChevronDown, CloudOff, Database, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "./ui.jsx";

/** AI deep-audit control: runs the backend RAG + LLM audit and shows its provenance. */
export default function AiAuditCard({ ai, stale, engine, apiBase, onRun, onRetry, policyDoc, disabled }) {
  const [open, setOpen] = useState(false);
  const running = ai.status === "running";
  const res = ai.result;
  const offline = engine.status === "offline";
  const outdated = engine.status === "online" && engine.info && !(engine.info.features || []).includes("policy-line-refs");

  return (
    <div className="border-b border-slate-800 bg-gradient-to-r from-violet-950/40 to-slate-900 px-4 py-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-violet-300" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-violet-100">AI deep audit</div>
          <div className="truncate text-[10px] text-slate-400">
            {running
              ? engine.status === "waking"
                ? "Waking the Render instance (up to ~50 s)…"
                : "Retrieving approved sources and verifying claims…"
              : res
                ? `${res.model} · ${res.retrieval.mode} · ${res.retrieval.chunks} approved chunk${res.retrieval.chunks === 1 ? "" : "s"}`
                : offline
                  ? `Backend unreachable at ${apiBase}`
                  : `Rules run live · AI verifies against ${policyDoc ? policyDoc.name : "your approved sources"}`}
          </div>
        </div>
        {offline && !running ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <CloudOff className="h-3.5 w-3.5" /> Retry
          </Button>
        ) : (
          <Button size="sm" onClick={onRun} disabled={disabled || running} className="from-violet-600! to-indigo-600!">
            {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : res ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {running ? "Auditing" : res ? "Re-run" : "Run AI audit"}
          </Button>
        )}
      </div>

      {ai.status === "error" && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-500/10 p-2 text-[11px] text-rose-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {ai.error}
        </p>
      )}

      {res && stale && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            You've edited the document since the last AI audit, so its summary is out of date and has been hidden. AI flags on sentences you
            changed were removed. <b>Re-run</b> to check the current version.
          </span>
        </div>
      )}

      {res && !stale && (
        <div className="mt-2 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className={`rounded px-1.5 py-0.5 font-bold ${res.is_compliant ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{res.status.replace("_", "-")}</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
              Tone {res.overall_tone} · {res.tone_score}/10
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-emerald-300">
              <Database className="h-3 w-3" />
              {res.audit_id ? `Audit #${res.audit_id} (Neon)` : "Not logged"}
            </span>
            {res.truncated && (
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300" title="Free-tier LLM token limits: only the first part was sent">
                First {res.audited_chars.toLocaleString("en-IN")} chars audited
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-slate-500">Checked against: {res.policy_used || "(not reported by this backend)"}</div>
          {outdated && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
              Your backend ({engine.info?.version ? `v${engine.info.version}` : "old version"}) doesn't read uploaded policies or cite policy lines.
              Redeploy the latest <code className="font-mono">backend</code> folder to Render (or restart it locally).
            </p>
          )}
          {res.findings.filter((f) => f.verdict !== "VERIFIED").length === 0 ? (
            <p className="rounded-lg bg-emerald-500/10 p-2 text-[11px] text-emerald-200">The AI found no remaining problems in this version. Do a final read, then publish.</p>
          ) : (
            <>
              <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-1 text-left text-[11px] text-slate-300 hover:text-white">
                <span className={`min-w-0 break-words ${open ? "" : "line-clamp-2"}`}>{res.summary}</span>
                <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && res.recommendations?.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-slate-950/50 p-2 text-[11px] text-indigo-200">
                  {res.recommendations.map((r) => (
                    <li key={r} className="break-words">
                      → {r}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
