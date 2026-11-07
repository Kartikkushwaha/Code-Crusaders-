import { useEffect, useMemo, useRef } from "react";
import { BookOpenText } from "lucide-react";
import { Modal } from "./ui.jsx";
import { numberPolicy, refLabel } from "../lib/policyLines.js";

/** Shows the policy line by line (same numbering the AI uses) and jumps to the cited line. */
export default function PolicyViewer({ open, onClose, doc, target }) {
  const lines = useMemo(() => numberPolicy(doc?.text || ""), [doc]);
  const listRef = useRef(null);
  const isTarget = (l) => target && l.line === target.line && (target.page ?? null) === (l.page ?? null);

  useEffect(() => {
    if (!open || !target) return;
    const t = setTimeout(() => listRef.current?.querySelector("[data-target='true']")?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [open, target]);

  let lastPage;
  return (
    <Modal open={open} onClose={onClose} labelledBy="policy-viewer-title" wide>
      <div className="flex max-h-[85vh] flex-col">
        <div className="border-b border-slate-800 px-5 py-4 pr-12">
          <h2 id="policy-viewer-title" className="flex items-center gap-2 text-base font-bold">
            <BookOpenText className="h-5 w-5 shrink-0 text-violet-300" />
            <span className="min-w-0 truncate">{doc?.name || "Policy"}</span>
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {target ? `Showing ${refLabel(target)} - highlighted below.` : `${lines.length} numbered lines. AI findings cite these line numbers.`}
          </p>
        </div>
        <ol ref={listRef} className="flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
          {lines.length === 0 && <li className="p-6 text-center text-xs text-slate-500">This policy isn't available in the browser.</li>}
          {lines.map((l) => {
            const header = l.page && l.page !== lastPage;
            lastPage = l.page;
            const hit = isTarget(l);
            return (
              <li key={`${l.page}-${l.line}`}>
                {header && <div className="sticky top-0 z-10 bg-slate-900/95 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Page {l.page}</div>}
                <div
                  data-target={hit ? "true" : undefined}
                  className={`flex gap-3 rounded-md px-3 py-1 text-xs leading-relaxed ${hit ? "bg-violet-500/25 ring-1 ring-violet-400" : "hover:bg-slate-800/50"}`}
                >
                  <span className={`w-8 shrink-0 text-right font-mono text-[10px] ${hit ? "text-violet-200" : "text-slate-600"}`}>{l.line}</span>
                  <span className={`min-w-0 break-words ${hit ? "text-white" : "text-slate-300"}`}>{l.text}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Modal>
  );
}
