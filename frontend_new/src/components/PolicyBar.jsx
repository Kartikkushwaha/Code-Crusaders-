import { useMemo, useRef, useState } from "react";
import { BookOpenText, FileText, LoaderCircle, PenLine, RefreshCw, ScrollText, ShieldCheck, Trash2, Upload } from "lucide-react";
import { extractPolicySource, ocrNote } from "../lib/fileParser.js";
import { derivePolicy } from "../lib/insights.js";
import { Button, Modal } from "./ui.jsx";

/** Strip above the editor: which content and which policy are being checked. Policy can be swapped here. */
export default function PolicyBar({ source, policyDoc, detected, onPolicy, onRemovePolicy, onReplaceContent, onViewPolicy, toast }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const pasteRules = useMemo(() => derivePolicy(pasteText).detected, [pasteText]);

  const openPaste = () => {
    setPasteText(policyDoc?.pasted ? policyDoc.text : "");
    setPasteOpen(true);
  };
  const savePaste = () => {
    const text = pasteText.trim();
    onPolicy({ name: "Pasted policy", text, pages: 1, chars: text.length, pasted: true });
    setPasteOpen(false);
  };

  const pick = async (file) => {
    setBusy(true);
    try {
      const doc = await extractPolicySource(file);
      if (!doc.text.replace(/\[Page \d+\]/g, "").trim()) throw new Error("No readable text found in the policy file.");
      onPolicy(doc);
      if (doc.ocrFailed?.length) toast(`Pages ${doc.ocrFailed.join(", ")} are pictures of text and OCR couldn't run. Paste those rules instead.`, "danger");
    } catch (e) {
      toast(e.message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
        <FileText className="h-5 w-5 shrink-0 text-blue-400" />
        <div className="min-w-[9rem] flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Checking</div>
          <div className="truncate text-sm font-semibold text-slate-100">{source?.name || "Untitled document"}</div>
        </div>
        {source?.type === "upload" && (
          <button onClick={onReplaceContent} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">
            <RefreshCw className="h-3.5 w-3.5" /> Replace
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
        {policyDoc ? <ScrollText className="h-5 w-5 shrink-0 text-violet-400" /> : <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />}
        <div className="min-w-[9rem] flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Against</div>
          <div className="truncate text-sm font-semibold text-slate-100">{policyDoc ? policyDoc.name : "PUBLIVRA built-in rules"}</div>
          {policyDoc && ocrNote(policyDoc) && <div className="truncate text-[11px] text-sky-300">{ocrNote(policyDoc)}</div>}
          {policyDoc && detected.length > 0 && (
            <div className="truncate text-[11px] text-violet-300">{detected.map((d) => d.label).join(" · ")}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <button
          onClick={onViewPolicy}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
          title="Read the policy line by line"
        >
          <BookOpenText className="h-3.5 w-3.5" /> View
        </button>
        <button
          onClick={openPaste}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
          title="Write or paste policy rules"
          aria-label={policyDoc?.pasted ? "Edit pasted policy" : "Paste policy"}
        >
          <PenLine className="h-3.5 w-3.5" /> {policyDoc?.pasted ? "Edit" : "Paste"}
        </button>
        <button
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg bg-violet-600/80 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
        >
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {policyDoc ? "Upload new" : "Upload"}
        </button>
        {policyDoc && (
          <button onClick={onRemovePolicy} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-300" aria-label="Remove policy" title="Use built-in rules only">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        </div>
        <input
          ref={ref}
          type="file"
          accept=".pdf,.txt,.md,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            e.target.value = "";
          }}
        />
      </div>

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} labelledBy="paste-policy-title" wide>
        <div className="p-6">
          <h2 id="paste-policy-title" className="text-lg font-bold">
            Write or paste your policy
          </h2>
          <p className="mt-1 text-xs text-slate-400">Plain sentences are fine. Simple rules are applied live; the AI audit reads the whole text.</p>
          <textarea
            autoFocus
            rows={10}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Tone must be formal.\nUse "Enterprise client" instead of "Customer".\nDo not use "synergy" or "disruptive".\nDelivery timelines must not exceed 60 days.`}
            className="mt-3 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
          />
          <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
            {pasteRules.length > 0 && <span className="text-[11px] text-slate-500">Picked up:</span>}
            {pasteRules.map((d) => (
              <span key={d.label} className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200">
                {d.label}
              </span>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePaste} disabled={pasteText.trim().length < 10} className="from-violet-600! to-violet-600!">
              Use this policy
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
