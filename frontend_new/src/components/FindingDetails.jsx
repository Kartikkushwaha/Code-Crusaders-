import { BookOpenText, CircleAlert, Lightbulb, ShieldCheck } from "lucide-react";
import { groupOf, ISSUE_GROUPS } from "../lib/insights.js";
import { refLabel } from "../lib/policyLines.js";

/**
 * Problem → what the policy says (with a jump-to-line link) → recommendation.
 * Shared by the "All flags" list and the "Fix issues" queue.
 */
export default function FindingDetails({ f, onOpenRef }) {
  const ref = f.policyRef;
  const quote = f.policyQuote || ref?.text || "";
  const rec = f.recommendation || (f.verdict !== "VERIFIED" ? ISSUE_GROUPS[groupOf(f)]?.advice : "");
  const verified = f.verdict === "VERIFIED";

  return (
    <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
      <div className="flex gap-1.5">
        {verified ? <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />}
        <p className="min-w-0 break-words text-slate-200">
          <b className="text-slate-400">{verified ? "Why it's fine: " : "Problem: "}</b>
          {f.explanation}
        </p>
      </div>

      {(quote || ref) && (
        <div className="flex gap-1.5 rounded-lg border-l-2 border-violet-400 bg-violet-500/10 py-1.5 pl-2 pr-2">
          <BookOpenText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
          <div className="min-w-0">
            <span className="font-semibold text-violet-200">Policy says: </span>
            {quote ? <span className="break-words italic text-slate-200">“{quote}”</span> : <span className="text-slate-400">see referenced line</span>}
            {ref && (
              <button
                onClick={() => onOpenRef?.(ref)}
                className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200 hover:bg-violet-500/40"
                title="Open this line in the policy"
              >
                {ref.source ? `${ref.source.length > 28 ? ref.source.slice(0, 26) + "…" : ref.source} · ` : ""}
                {refLabel(ref)} ↗
              </button>
            )}
            {ref && ref.verified === false && <span className="ml-1 text-[10px] text-amber-300">(line inferred, quote not matched)</span>}
          </div>
        </div>
      )}
      {!quote && !ref && f.source && <p className="break-words text-[10px] text-slate-500">Source: {f.source}</p>}

      {rec && !verified && (
        <div className="flex gap-1.5">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <p className="min-w-0 break-words text-slate-300">
            <b className="text-slate-400">Recommendation: </b>
            {rec}
          </p>
        </div>
      )}
    </div>
  );
}
