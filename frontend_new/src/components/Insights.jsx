import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BarChart3, Building2, CheckCircle2, Globe, LoaderCircle, RefreshCw, Repeat2, ShieldAlert, Table2 } from "lucide-react";
import { api } from "../lib/api.js";

// Validated categorical pair for the dark surface (blue = before, orange = after).
const SERIES = {
  before: { label: "Before publishing", sub: "AI audits", color: "#3987e5" },
  after: { label: "After publishing", sub: "Published, after fixes", color: "#d95926" },
};
const LEVEL = {
  HIGH: { text: "High", cls: "text-rose-300 bg-rose-500/10 border-rose-500/30", Icon: ShieldAlert },
  MEDIUM: { text: "Medium", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30", Icon: AlertTriangle },
  LOW: { text: "Low", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", Icon: CheckCircle2 },
};
const SHORT = { privacy: "Privacy" };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const DAYS = [
  { v: 0, label: "All time" },
  { v: 7, label: "7 days" },
  { v: 30, label: "30 days" },
  { v: 90, label: "90 days" },
];

function LevelTag({ level }) {
  const s = LEVEL[level] || LEVEL.LOW;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${s.cls}`}>
      <s.Icon className="h-3 w-3" aria-hidden="true" />
      {s.text}
    </span>
  );
}

function Segmented({ value, onChange, options, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-slate-800 bg-slate-950/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${value === o.v ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tooltip({ bar, stage }) {
  const s = SERIES[stage];
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950/95 p-3 text-left shadow-2xl">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-400">
        <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
        {s.label}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">{bar.label}</span>
        <LevelTag level={bar.level} />
      </div>
      <div className="mt-1 text-xs text-slate-300">
        Avg risk <b className="text-white">{bar.avg_score}</b>/100 · {bar.issues_total} issue{bar.issues_total === 1 ? "" : "s"}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">
        {bar.documents_with_issues} of {bar.documents} documents affected · H {bar.levels.HIGH} · M {bar.levels.MEDIUM} · L {bar.levels.LOW}
      </div>
      {bar.top_issues.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2">
          {bar.top_issues.slice(0, 3).map((t) => (
            <li key={t.issue} className="text-[11px] leading-snug text-slate-300">
              <b className="text-white">{t.times}×</b> {t.issue.length > 80 ? `${t.issue.slice(0, 80)}…` : t.issue}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-slate-500">No issues recorded.</p>
      )}
      <p className="mt-2 text-[10px] text-slate-500">Click for all details</p>
    </div>
  );
}

/** "Repeated issues" indicator under each bar: hover or click for the recurring issues. */
function RepeatIndicator({ index, count, data, stages, pinned, onPin, align }) {
  const [hover, setHover] = useState(false);
  const items = stages.flatMap((st) => data[st].bars[index].top_issues.filter((t) => t.times >= 2).map((t) => ({ ...t, stage: st })));
  const open = hover || pinned;
  const n = new Set(items.map((t) => t.issue)).size;
  const pos = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <div className="relative mt-1 flex justify-center" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        onClick={onPin}
        aria-expanded={open}
        aria-label={`${n} repeated issue${n === 1 ? "" : "s"}`}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
          n ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20" : "border-slate-800 text-slate-500"
        } ${pinned ? "ring-1 ring-amber-400" : ""}`}
      >
        <Repeat2 className="h-3 w-3" aria-hidden="true" />
        <span className="sm:hidden">{n || "0"}</span>
        <span className="hidden sm:inline">{n ? `${n} repeated` : "No repeats"}</span>
      </button>
      {open && (
        <div className={`absolute bottom-full z-30 mb-1.5 w-64 rounded-xl border border-slate-700 bg-slate-950/95 p-3 text-left shadow-2xl ${pos}`} role="dialog" aria-label="Repeated issues">
          <div className="text-[11px] font-semibold text-white">Repeated issues</div>
          <p className="text-[10px] text-slate-500">Issues found in 2 or more documents{count > 1 ? " (both stages)" : ""}.</p>
          {items.length ? (
            <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {items.map((t) => (
                <li key={`${t.stage}:${t.issue}`} className="rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-[11px] leading-snug">
                  <div className="flex items-start gap-1.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-sm" style={{ background: SERIES[t.stage].color }} title={SERIES[t.stage].label} />
                    <span className="min-w-0 flex-1 break-words text-slate-200">{t.issue.length > 110 ? `${t.issue.slice(0, 110)}…` : t.issue}</span>
                    <b className="shrink-0 text-amber-200">{t.times}×</b>
                  </div>
                  {(t.example || t.policy_line) && (
                    <div className="mt-0.5 break-words pl-3.5 text-[10px] text-slate-500">
                      {t.example && <>e.g. “{t.example.slice(0, 60)}”</>}
                      {t.example && t.policy_line && " · "}
                      {t.policy_line && <>policy {t.policy_line}</>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-slate-400">No issue has come up more than once here.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Vertical bar chart: x = violation type, y = average risk 0-100. One or two series (before / after). */
function BarChart({ data, stages, selected, onSelect }) {
  const [hover, setHover] = useState(null); // `${key}:${stage}`
  const [pinnedRepeat, setPinnedRepeat] = useState(null);
  const sections = data[stages[0]].bars;
  const ticks = [100, 60, 25, 0];
  return (
    <div className="relative pl-9 pr-1 pt-4">
      {/* recessive grid: risk-level thresholds */}
      <div className="absolute inset-x-0 bottom-[6rem] top-4 pl-9">
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 flex items-center" style={{ bottom: `${t}%` }}>
            <span className="absolute -left-9 w-7 -translate-y-px text-right text-[10px] text-slate-500">{t}</span>
            <div className={`ml-0 w-full border-t ${t === 0 ? "border-slate-600" : "border-dashed border-slate-800"}`} />
          </div>
        ))}
      </div>
      <div className="relative grid gap-2 sm:gap-4" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
        {sections.map((sec, i) => (
          <div key={sec.key} className="flex min-w-0 flex-col items-center">
            <button
              onClick={() => onSelect(sec.key === selected ? null : sec.key)}
              aria-pressed={selected === sec.key}
              className={`flex h-56 w-full items-end justify-center gap-[2px] rounded-t-lg px-1 transition sm:h-64 ${selected === sec.key ? "bg-slate-800/50" : "hover:bg-slate-800/25"}`}
              aria-label={`${sec.label}: ${stages.map((s) => `${SERIES[s].label} ${data[s].bars[i].avg_score}`).join(", ")}`}
            >
              {stages.map((st) => {
                const bar = data[st].bars[i];
                const id = `${sec.key}:${st}`;
                return (
                  <div
                    key={st}
                    className="relative flex h-full max-w-14 flex-1 flex-col items-center justify-end"
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover((h) => (h === id ? null : h))}
                  >
                    {hover === id && <Tooltip bar={bar} stage={st} />}
                    <span
                      className="absolute left-1/2 -translate-x-1/2 text-[11px] font-semibold tabular-nums text-slate-200"
                      style={{ bottom: `calc(${bar.avg_score}% + 2px)` }}
                    >
                      {bar.avg_score}
                    </span>
                    <div
                      className="w-full rounded-t-[4px] transition-[height] duration-500"
                      style={{ height: `${Math.max(bar.avg_score, bar.documents ? 0.6 : 0)}%`, background: SERIES[st].color, opacity: hover && hover !== id ? 0.55 : 1 }}
                    />
                  </div>
                );
              })}
            </button>
            <div className="mt-2 h-[5.5rem] w-full text-center">
              <div className="truncate text-xs font-semibold text-slate-200">
                <span className="sm:hidden">{SHORT[sec.key] || sec.label}</span>
                <span className="hidden sm:inline">{sec.label}</span>
              </div>
              <div className="mt-1 flex flex-col items-center gap-0.5 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-1">
                {stages.map((st) => (
                  <LevelTag key={st} level={data[st].bars[i].level} />
                ))}
              </div>
              <RepeatIndicator
                index={i}
                count={stages.length}
                data={data}
                stages={stages}
                pinned={pinnedRepeat === sec.key}
                onPin={() => setPinnedRepeat((p) => (p === sec.key ? null : sec.key))}
                align={i === 0 ? "left" : i === sections.length - 1 ? "right" : "center"}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({ sectionKey, data, stages }) {
  const label = data[stages[0]].bars.find((b) => b.key === sectionKey)?.label;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="text-sm font-semibold text-white">{label}: what went wrong</h3>
      <div className={`mt-3 grid gap-4 ${stages.length > 1 ? "md:grid-cols-2" : ""}`}>
        {stages.map((st) => {
          const bar = data[st].bars.find((b) => b.key === sectionKey);
          return (
            <div key={st} className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[st].color }} />
                <span className="font-semibold text-slate-200">{SERIES[st].label}</span>
                <span>
                  avg {bar.avg_score}/100 · {plural(bar.issues_total, "issue")} · {bar.documents_with_issues}/{bar.documents} docs
                </span>
                <LevelTag level={bar.level} />
              </div>
              {bar.top_issues.length ? (
                <ol className="space-y-2">
                  {bar.top_issues.map((t) => (
                    <li key={t.issue} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-slate-200">{t.issue}</span>
                        <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-200">{t.times}×</span>
                      </div>
                      {(t.example || t.policy_line) && (
                        <div className="mt-1 break-words text-[11px] text-slate-500">
                          {t.example && <>e.g. “{t.example}”</>}
                          {t.example && t.policy_line && " · "}
                          {t.policy_line && <>policy {t.policy_line}</>}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-800 p-3 text-xs text-slate-500">No issues recorded in this section.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DataTableView({ data, stages }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2">Section</th>
            {stages.map((st) => (
              <th key={st} className="px-3 py-2">
                {SERIES[st].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {data[stages[0]].bars.map((b, i) => (
            <tr key={b.key}>
              <td className="px-3 py-2 font-semibold text-slate-200">{b.label}</td>
              {stages.map((st) => {
                const x = data[st].bars[i];
                return (
                  <td key={st} className="px-3 py-2 text-slate-300">
                    <span className="mr-2 tabular-nums">{x.avg_score}/100</span>
                    <LevelTag level={x.level} />
                    <span className="ml-2 text-slate-500">
                      {plural(x.issues_total, "issue")} · {x.documents_with_issues}/{x.documents} docs
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One chart card with its own filters. company = "" -> all checks (common graph). */
function ChartCard({ title, subtitle, icon: Icon, company, scope = "", needsCompany }) {
  const [mode, setMode] = useState("compare"); // before | after | compare
  const [days, setDays] = useState(0);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [selected, setSelected] = useState(null);
  const [asTable, setAsTable] = useState(false);

  const load = useCallback(async () => {
    if (needsCompany && !company) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // company graph: the server always answers for the caller's own company / demo session
      const data = await api.analytics({ company: company ? scope || "own" : "", days });
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e.message, data: null });
    }
  }, [company, scope, days, needsCompany]);

  useEffect(() => {
    load();
  }, [load]);

  const stages = mode === "compare" ? ["before", "after"] : [mode];
  const data = state.data;
  const total = data ? stages.reduce((a, s) => a + data[s].documents, 0) : 0;
  const dbState = data?.before?.db;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Icon className="h-4 w-4 text-indigo-400" /> {title}
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>
        </div>
        {stages.length > 1 ? (
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
            {stages.map((st) => (
              <span key={st} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[st].color }} />
                {SERIES[st].label} ({data?.[st]?.documents ?? 0})
              </span>
            ))}
          </div>
        ) : (
          data && <span className="text-[11px] text-slate-400">{data[stages[0]].documents} documents</span>
        )}
      </div>

      {/* filters: one row above the chart */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Stage"
          value={mode}
          onChange={setMode}
          options={[
            { v: "before", label: "Before" },
            { v: "after", label: "After" },
            { v: "compare", label: "Compare" },
          ]}
        />
        <Segmented label="Time range" value={days} onChange={setDays} options={DAYS.map((d) => ({ v: d.v, label: d.label }))} />
        <div className="ml-auto flex gap-2">
          <button onClick={() => setAsTable((t) => !t)} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
            {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />} {asTable ? "Chart" : "Table"}
          </button>
          <button onClick={load} className="inline-flex items-center gap-1 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
            <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {needsCompany && !company ? (
        <div className="flex h-56 flex-col items-center justify-center gap-1 text-center text-xs text-amber-200">
          <Building2 className="h-6 w-6 text-amber-300/70" />
          Enter the company name at the top of this page to see its graph.
          <span className="text-slate-500">Checks and publications are tagged with the company set there.</span>
        </div>
      ) : state.loading && !data ? (
        <div className="flex h-72 items-center justify-center gap-2 text-xs text-slate-400">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading the graph (the server may take a moment to wake up)…
        </div>
      ) : state.error ? (
        <div className="flex h-72 flex-col items-center justify-center gap-2 text-center text-xs text-rose-300">
          Could not load the graph: {state.error}
          <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800">
            Try again
          </button>
        </div>
      ) : dbState && dbState !== "connected" ? (
        <div className="flex h-72 items-center justify-center text-center text-xs text-amber-200">The database is {dbState.replace("_", " ")}, so there is nothing to chart yet.</div>
      ) : total === 0 ? (
        <div className="flex h-72 flex-col items-center justify-center gap-1 text-center text-xs text-slate-400">
          <BarChart3 className="h-6 w-6 text-slate-600" />
          No {mode === "after" ? "publications" : mode === "before" ? "AI audits" : "checks"} recorded{company ? ` for ${company}` : ""} yet.
          <span className="text-slate-500">Run an AI deep audit or publish a document to see the bars.</span>
        </div>
      ) : asTable ? (
        <DataTableView data={data} stages={stages} />
      ) : (
        <BarChart data={data} stages={stages} selected={selected} onSelect={setSelected} />
      )}
      {!asTable && data && total > 0 && (
        <p className="text-[10px] text-slate-500">
          X-axis: violation type. Bar height: average risk (0-100); Low under 25, Medium 25-59, High 60+. Hover a bar for details, click it for the full list; hover or click
          “repeated” for issues that keep coming back.
        </p>
      )}
      {data && total > 0 && selected && <DetailPanel sectionKey={selected} data={data} stages={stages} />}
    </section>
  );
}

/**
 * Improvement 2 - analytics.
 * Common graph: Creator & Manager panels. Company graph: Manager panel only.
 */
/**
 * Improvement 2 - analytics. The same dashboard in the Creator, Manager and Legal approver panels:
 * the common graph (all companies) and the company graph (the signed-in parent company).
 */
export default function Insights({ company, scope = "", demo = false }) {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <BarChart3 className="h-5 w-5 text-indigo-400" /> Insights
          </h1>
          <p className="mt-1 text-xs text-slate-400">Average risk per violation type, before and after publishing, across all checks and for your company.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
          <Building2 className="h-3.5 w-3.5 text-slate-400" /> {company}
        </span>
      </div>
      <ChartCard title="Common graph" subtitle="All checks across every company." icon={Globe} company="" />
      <ChartCard
        title={demo ? `Your demo session - ${company}` : `Company graph - ${company}`}
        subtitle={demo ? "Same graph, only for the checks and publications of this demo session." : "Same graph, only for checks and publications from your company."}
        icon={Building2}
        company={company}
        scope={scope}
        needsCompany
      />
    </div>
  );
}
