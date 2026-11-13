import { PART_LABEL, PART_ORDER } from "../lib/riskParts.js";
import { RISK_STYLE } from "./ui.jsx";

/**
 * The three risk scores - text (incl. tone), logo & graphics, video - and their average.
 * `parts[k]` is { score, level } or null when that part was not checked.
 */
export function RiskBreakdown({ score, level, parts }) {
  const checked = PART_ORDER.filter((k) => parts?.[k]);
  return (
    <div className="w-64 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Average risk score</span>
        <span className={`font-mono text-sm font-bold ${RISK_STYLE[level].text}`}>{score}/100</span>
      </div>
      <ul className="mt-2 space-y-2">
        {PART_ORDER.map((k) => {
          const p = parts?.[k];
          return (
            <li key={k}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={p ? "font-medium text-slate-100" : "text-slate-500"}>{PART_LABEL[k]}</span>
                {p ? (
                  <span className="font-mono text-slate-200">
                    {p.score}/100 <span className={`ml-1 text-[10px] font-bold ${RISK_STYLE[p.level].text}`}>{p.level}</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500">not checked</span>
                )}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                {p && <div className={`h-full rounded-full ${RISK_STYLE[p.level].meter}`} style={{ width: `${Math.max(3, p.score)}%` }} />}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 border-t border-slate-800 pt-2 text-[10px] leading-relaxed text-slate-400">
        {checked.length > 1
          ? `Average of ${checked.map((k) => parts[k].score).join(" + ")} over the ${checked.length} parts checked.`
          : "Only the text has been checked so far. Add images or a video to include their scores."}{" "}
        The risk level is the highest level of any part.
      </p>
    </div>
  );
}

/** Navbar risk pill: hover, focus or tap it to see the three scores. */
export function RiskPill({ risk, scanning }) {
  const s = RISK_STYLE[risk.level];
  return (
    <div className="group relative hidden sm:block">
      <button
        type="button"
        aria-label={`${s.label}, average risk score ${risk.score} out of 100. Show the score breakdown.`}
        className={`inline-flex cursor-default items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${s.pill}`}
      >
        {scanning && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />}
        {s.label}
        <span className="rounded-full bg-black/20 px-1.5 font-mono">{risk.score}</span>
      </button>
      <div
        role="tooltip"
        className="invisible absolute right-0 top-full z-50 pt-2 opacity-0 transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl">
          <RiskBreakdown score={risk.score} level={risk.level} parts={risk.parts} />
        </div>
      </div>
    </div>
  );
}
