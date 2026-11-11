import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Database, FileCheck2, History, LoaderCircle, RefreshCw, Search, User } from "lucide-react";
import { api } from "../lib/api.js";
import { RISK_STYLE } from "./ui.jsx";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

function RiskPill({ level }) {
  if (!level) return <span className="text-slate-500">—</span>;
  const s = RISK_STYLE[level] || RISK_STYLE.MEDIUM;
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${s.pill}`}>{level}</span>;
}

function StatusPill({ ok, yes, no }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
      {ok ? yes : no}
    </span>
  );
}

/**
 * Table on wide screens, stacked cards on phones, so nothing overflows.
 * columns: [{ key, label, render(row), primary?, wide? }]
 */
function DataTable({ columns, rows, empty }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">{empty}</p>;
  const primary = columns.find((c) => c.primary) || columns[0];
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-800 lg:block">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-slate-800/30">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2.5 text-slate-300 ${c.wide ? "min-w-[240px] max-w-[380px]" : ""}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 lg:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="mb-2 min-w-0 break-words text-sm font-semibold text-slate-100">{primary.render(r)}</div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
              {columns
                .filter((c) => c !== primary)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{c.label}</dt>
                    <dd className="min-w-0 break-words text-slate-300">{c.render(r)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function Stat({ label, value, cls = "text-slate-100" }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
      <div className={`text-lg font-extrabold ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

export default function AuditTrail({ publications, activity, onOpenVerification, engine }) {
  const [remote, setRemote] = useState({ loading: true, error: null, audits: [], pubs: [] });
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setRemote((r) => ({ ...r, loading: true, error: null }));
    try {
      const [a, p] = await Promise.all([api.listAudits(100), api.listPublications(100)]);
      setRemote({ loading: false, error: null, audits: a?.items || [], pubs: p?.items || [] });
    } catch (e) {
      setRemote({ loading: false, error: e.message, audits: [], pubs: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const match = (...vals) => !q || vals.some((v) => String(v ?? "").toLowerCase().includes(q));
  const audits = useMemo(() => remote.audits.filter((a) => match(a.filename, a.summary, a.model, a.status, a.risk_level)), [remote.audits, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const pubs = useMemo(() => remote.pubs.filter((p) => match(p.title, p.file_name, p.approver_name, p.risk_level)), [remote.pubs, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingLocal = publications.filter((p) => p.status === "pending");

  const dbState = engine?.info?.database?.state;
  const stats = {
    audits: remote.audits.length,
    compliant: remote.audits.filter((a) => a.status === "COMPLIANT").length,
    high: remote.audits.filter((a) => a.risk_level === "HIGH").length,
    pubs: remote.pubs.length,
    overrides: remote.pubs.filter((p) => p.overridden).length,
    signed: remote.pubs.filter((p) => p.status === "closed").length,
  };

  const auditCols = [
    { key: "id", label: "Audit #", render: (r) => <span className="font-mono text-slate-400">#{r.id}</span> },
    { key: "doc", label: "Document", primary: true, render: (r) => <span className="font-semibold text-slate-100">{r.filename || "Untitled"}</span> },
    { key: "date", label: "Checked on", render: (r) => <span className="whitespace-nowrap">{fmt(r.created_at)}</span> },
    { key: "result", label: "Result", render: (r) => <StatusPill ok={r.status === "COMPLIANT"} yes="Compliant" no="Non-compliant" /> },
    { key: "risk", label: "Risk", render: (r) => <RiskPill level={r.risk_level} /> },
    { key: "tone", label: "Tone", render: (r) => r.tone || "—" },
    { key: "model", label: "AI model", render: (r) => <span className="break-words font-mono text-[11px] text-slate-400">{r.model || "—"}</span> },
    { key: "source", label: "Source", render: (r) => r.source || "—" },
    { key: "summary", label: "Summary", wide: true, render: (r) => <span className="line-clamp-3 text-slate-400">{r.summary || "—"}</span> },
  ];

  const pubCols = [
    { key: "id", label: "Record #", render: (r) => <span className="font-mono text-slate-400">#{r.id}</span> },
    { key: "doc", label: "Document", primary: true, render: (r) => <span className="font-semibold text-slate-100">{r.title}</span> },
    { key: "file", label: "PDF file", render: (r) => <span className="break-all text-slate-400">{r.file_name || "—"}</span> },
    { key: "date", label: "Published on", render: (r) => <span className="whitespace-nowrap">{fmt(r.created_at)}</span> },
    { key: "risk", label: "Risk", render: (r) => <RiskPill level={r.risk_level} /> },
    { key: "score", label: "Score", render: (r) => (r.risk_score ?? "—") + (r.risk_score != null ? "/100" : "") },
    { key: "release", label: "Release", render: (r) => (r.overridden ? <span className="font-semibold text-rose-300">Override</span> : "Standard") },
    { key: "audit", label: "Linked audit", render: (r) => (r.audit_id ? <span className="font-mono">#{r.audit_id}</span> : "—") },
    {
      key: "signoff",
      label: "Sign-off",
      render: (r) => (r.status === "closed" ? <StatusPill ok yes="Signed off" /> : <span className="font-semibold text-amber-300">Pending</span>),
    },
    { key: "approver", label: "Approver", render: (r) => (r.approver_name ? `${r.approver_name}${r.approver_role ? ` · ${r.approver_role}` : ""}` : "—") },
    { key: "closed", label: "Signed on", render: (r) => <span className="whitespace-nowrap">{fmt(r.closed_at)}</span> },
  ];

  return (
    <div className="fade-in mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <History className="h-6 w-6 shrink-0 text-indigo-400" /> History
          </h1>
          <p className="mt-1 text-sm text-slate-400">Every audit, publication and sign-off saved in your Neon database.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents, approvers…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-8 pr-3 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <button
            onClick={load}
            disabled={remote.loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50"
          >
            {remote.loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </div>
      </div>

      {/* Connection state */}
      <div
        className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
          remote.error ? "border-rose-500/40 bg-rose-950/30 text-rose-200" : "border-slate-800 bg-slate-900/60 text-slate-300"
        }`}
      >
        <Database className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">
          {remote.loading
            ? "Loading records from Neon… (the first request can take up to a minute while Render wakes up)"
            : remote.error
              ? `Couldn't load saved records: ${remote.error}`
              : dbState && dbState !== "connected"
                ? `Database status: ${dbState.replace("_", " ")}. Records appear here once the backend can reach Neon.`
                : `Connected to Neon · ${stats.audits} audit${stats.audits === 1 ? "" : "s"} and ${stats.pubs} publication${stats.pubs === 1 ? "" : "s"} loaded.`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="AI audits" value={stats.audits} />
        <Stat label="Compliant" value={stats.compliant} cls="text-emerald-300" />
        <Stat label="High risk" value={stats.high} cls="text-rose-300" />
        <Stat label="Publications" value={stats.pubs} />
        <Stat label="Overrides" value={stats.overrides} cls="text-amber-300" />
        <Stat label="Signed off" value={stats.signed} cls="text-emerald-300" />
      </div>

      {pendingLocal.length > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4">
          <h2 className="text-sm font-bold text-amber-100">Waiting for your sign-off</h2>
          <ul className="mt-2 space-y-1.5">
            {pendingLocal.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="min-w-0 break-words text-slate-200">
                  {p.title} <span className="text-slate-500">· {fmt(p.at)}</span>
                </span>
                <button onClick={() => onOpenVerification(p.id)} className="rounded-lg bg-amber-500 px-2.5 py-1 font-semibold text-amber-950 hover:bg-amber-400">
                  Complete checklist
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
          <Bot className="h-4 w-4 text-violet-300" /> AI audits
        </h2>
        <p className="mb-3 text-[11px] text-slate-500">One row per "Run AI audit", from the <code className="font-mono">document_compliance</code> table.</p>
        <DataTable columns={auditCols} rows={audits} empty={remote.loading ? "Loading…" : q ? "No audits match your search." : "No AI audits saved yet."} />
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
          <FileCheck2 className="h-4 w-4 text-emerald-300" /> Publications & sign-offs
        </h2>
        <p className="mb-3 text-[11px] text-slate-500">One row per published PDF, from the <code className="font-mono">publications</code> table.</p>
        <DataTable columns={pubCols} rows={pubs} empty={remote.loading ? "Loading…" : q ? "No publications match your search." : "Nothing published yet."} />
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h2 className="text-sm font-bold">This session's activity</h2>
        <p className="mb-3 text-[11px] text-slate-500">Who did what, and whether it was the AI or a person. Clears when you reload the page.</p>
        {activity.length === 0 ? (
          <p className="text-xs text-slate-500">No activity yet.</p>
        ) : (
          <ol className="max-h-[420px] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-800/40">
                <span className={`mt-0.5 shrink-0 rounded-md p-1 ${a.actor === "AI" ? "bg-indigo-500/15 text-indigo-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                  {a.actor === "AI" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 break-words text-slate-300">{a.message}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-500">{new Date(a.at).toLocaleTimeString("en-IN")}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
