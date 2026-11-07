import { useState } from "react";
import { Check, CheckCheck, Crosshair, PenLine, ShieldOff, Sparkles, X } from "lucide-react";
import { VerdictBadge, SeverityTag, Button } from "./ui.jsx";

export default function SuggestionsQueue({ queue, onAccept, onAcceptAll, onDismiss, onManualEdit, onLocate }) {
  const fixable = queue.filter((f) => f.suggestion);
  if (!queue.length) {
    return (
      <div className="rounded-xl border border-dashed border-emerald-800/60 bg-emerald-950/20 p-6 text-center">
        <CheckCheck className="mx-auto h-8 w-8 text-emerald-400" />
        <p className="mt-2 text-sm font-semibold text-emerald-200">Nothing left to fix here</p>
        <p className="mt-1 text-xs text-slate-400">Every problem has been fixed or skipped with a reason.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
        <div className="text-xs text-indigo-100">
          <div className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="h-3.5 w-3.5" /> {queue.length} thing{queue.length > 1 ? "s" : ""} to check
          </div>
          <div className="text-[11px] text-indigo-200/70">{fixable.length} can be fixed in one click</div>
        </div>
        <Button size="sm" onClick={() => onAcceptAll(fixable)} disabled={!fixable.length}>
          <CheckCheck className="h-3.5 w-3.5" /> Fix all
        </Button>
      </div>
      <ul className="space-y-2.5">
        {queue.map((f) => (
          <SuggestionCard key={f.id} f={f} onAccept={onAccept} onDismiss={onDismiss} onManualEdit={onManualEdit} onLocate={onLocate} />
        ))}
      </ul>
    </div>
  );
}

function SuggestionCard({ f, onAccept, onDismiss, onManualEdit, onLocate }) {
  const [mode, setMode] = useState(null); // null | 'edit' | 'dismiss'
  const [draft, setDraft] = useState(f.suggestion?.preview ?? f.sentence);
  const [reason, setReason] = useState("");

  const i = f.sentence.indexOf(f.suggestion?.find ?? f.match);
  const findLen = (f.suggestion?.find ?? f.match).length;

  return (
    <li className="fade-in rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center gap-1.5">
        <VerdictBadge verdict={f.verdict} size="xs" />
        <SeverityTag severity={f.severity} />
        {f.ai && <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">AI</span>}
        <span className="truncate text-[10px] text-slate-500">{f.clause}</span>
        <button onClick={() => onLocate(f)} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-indigo-300" title="Show in document" aria-label="Show in document">
          <Crosshair className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mt-2 text-[11px] text-slate-400">{f.explanation}</p>

      {f.suggestion ? (
        <div className="mt-2 rounded-lg bg-slate-900 p-2.5 text-xs leading-relaxed">
          {i >= 0 ? (
            <p className="text-slate-300">
              {f.sentence.slice(0, i)}
              <del className="rounded bg-rose-500/20 px-0.5 text-rose-300 decoration-rose-400">{f.sentence.slice(i, i + findLen)}</del>
              {f.suggestion.replace && <ins className="ml-0.5 rounded bg-emerald-500/20 px-0.5 text-emerald-200 no-underline">{f.suggestion.replace}</ins>}
              {f.sentence.slice(i + findLen)}
            </p>
          ) : (
            <p className="text-emerald-200">{f.suggestion.preview}</p>
          )}
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-slate-900 p-2.5 text-[11px] italic text-slate-400">
          No safe automatic rewrite - add an approved source, soften the claim, or fine-tune it manually.
        </p>
      )}

      {mode === "edit" && (
        <div className="mt-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500" htmlFor={`edit-${f.id}`}>
            Fine-tune sentence
          </label>
          <textarea
            id={`edit-${f.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" onClick={() => { onManualEdit(f, draft); setMode(null); }} disabled={!draft.trim() || draft.trim() === f.sentence}>
              <Check className="h-3.5 w-3.5" /> Apply edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === "dismiss" && (
        <div className="mt-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500" htmlFor={`why-${f.id}`}>
            Why skip this? (saved to the audit trail)
          </label>
          <input
            id={`why-${f.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Legal approved wording on 04 Nov"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
          />
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => { onDismiss(f, reason.trim()); setMode(null); }} disabled={reason.trim().length < 4}>
              <ShieldOff className="h-3.5 w-3.5" /> Skip with reason
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {!mode && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {f.suggestion && (
            <Button size="sm" variant="success" onClick={() => onAccept(f)}>
              <Check className="h-3.5 w-3.5" /> Apply fix
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => { setDraft(f.suggestion?.preview ?? f.sentence); setMode("edit"); }}>
            <PenLine className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("dismiss")}>
            <X className="h-3.5 w-3.5" /> Skip
          </Button>
        </div>
      )}
    </li>
  );
}
