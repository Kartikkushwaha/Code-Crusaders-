import { ChevronRight, PartyPopper, Wrench } from "lucide-react";
import { ISSUE_ICONS } from "./issueIcons.js";

/** Dashboard card: the most common problems in this document, in plain language. */
export default function TopIssues({ groups, onReview, onFixGroup }) {
  if (!groups.length) {
    return (
      <section className="fade-in flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4">
        <PartyPopper className="h-6 w-6 text-emerald-300" />
        <div>
          <div className="text-sm font-bold text-emerald-100">No problems found</div>
          <div className="text-xs text-emerald-200/70">Nothing breaks your policy right now. Do a final read, then publish.</div>
        </div>
      </section>
    );
  }
  const shown = groups.slice(0, 4);
  return (
    <section className="fade-in rounded-2xl border border-slate-800 bg-slate-900/70 p-4" aria-label="Top issues">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">
          Fix these first <span className="ml-1 font-normal text-slate-500">· most important at the top</span>
        </h2>
        {groups.length > shown.length && <span className="text-[11px] text-slate-500">+{groups.length - shown.length} more in the panel</span>}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {shown.map((g) => {
          const Icon = ISSUE_ICONS[g.id];
          const tone = g.blocking
            ? "border-rose-500/40 bg-rose-950/40 text-rose-300"
            : g.items.some((f) => f.verdict === "CONTRADICTED")
              ? "border-amber-500/40 bg-amber-950/30 text-amber-300"
              : "border-sky-500/30 bg-sky-950/30 text-sky-300";
          return (
            <div key={g.id} className={`flex flex-col rounded-xl border p-3 ${tone}`}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-sm font-bold text-slate-100">{g.title}</span>
                <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-bold">{g.count}</span>
              </div>
              {g.blocking && <span className="mt-1 text-[10px] font-bold uppercase tracking-wider">Blocks publishing</span>}
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-300" title={g.advice}>{g.advice}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {g.examples.map((e) => (
                  <span key={e} className="max-w-full truncate rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                    {e}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex gap-1.5 pt-3">
                <button
                  onClick={() => onReview(g.id)}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-black/30 px-2 py-1.5 text-xs font-semibold text-slate-100 hover:bg-black/50"
                >
                  Review <ChevronRight className="h-3.5 w-3.5" />
                </button>
                {g.fixable > 0 && (
                  <button
                    onClick={() => onFixGroup(g)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    <Wrench className="h-3.5 w-3.5" /> Fix {g.fixable === 1 ? "it" : `all ${g.fixable}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
