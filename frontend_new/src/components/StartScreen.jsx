import { useMemo, useRef, useState } from "react";
import {
  ArrowRight, BookOpenCheck, CheckCheck, CloudUpload, FileText, ImageOff, Lightbulb, LoaderCircle, PenLine,
  ScrollText, ShieldCheck, Sparkles, SquarePen, X,
} from "lucide-react";
import { parseUpload, extractPolicySource, ocrNote } from "../lib/fileParser.js";
import { derivePolicy, COMMON_MISTAKES, ISSUE_GROUPS } from "../lib/insights.js";
import { BLANK_HTML, SAMPLE_HTML } from "../data/sampleContent.js";
import { SAMPLE_POLICY } from "../data/samplePolicy.js";
import { ISSUE_ICONS } from "./issueIcons.js";


/** Drop zone used for both the content file and the policy file. */
function DropZone({ accept, onFile, busy, children, tone = "blue" }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const ring = tone === "violet" ? "border-violet-400 bg-violet-500/10" : "border-blue-400 bg-blue-500/10";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && ref.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
        over ? ring : "border-slate-700 bg-slate-950/40 hover:border-slate-500 hover:bg-slate-950/70"
      }`}
    >
      {children}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function FileChip({ icon: Icon, name, meta, onRemove, onEdit, tone = "blue" }) {
  const c = tone === "violet" ? "border-violet-500/40 bg-violet-500/10 text-violet-200" : "border-blue-500/40 bg-blue-500/10 text-blue-200";
  return (
    <div className={`fade-in flex items-center gap-3 rounded-xl border px-3 py-3 ${c}`}>
      <Icon className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="text-[11px] opacity-75">{meta}</div>
      </div>
      {onEdit && (
        <button onClick={onEdit} className="rounded-lg p-1.5 opacity-70 hover:bg-white/10 hover:opacity-100" aria-label={`Edit ${name}`} title="Edit">
          <SquarePen className="h-4 w-4" />
        </button>
      )}
      <button onClick={onRemove} className="rounded-lg p-1.5 opacity-70 hover:bg-white/10 hover:opacity-100" aria-label={`Remove ${name}`}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function StartScreen({ onStart, toast, currentPolicy }) {
  const [content, setContent] = useState(null); // { html, source, label, meta }
  const [contentBusy, setContentBusy] = useState(null);
  const [policy, setPolicy] = useState(null); // { doc, detected }
  const [policyBusy, setPolicyBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  // When a policy is already loaded from an earlier check, the user picks: keep it, or bring a new one.
  const [choice, setChoice] = useState(currentPolicy ? "current" : "new");
  const usingCurrent = !!currentPolicy && choice === "current";
  const currentRules = useMemo(() => (currentPolicy ? derivePolicy(currentPolicy.text).detected : []), [currentPolicy]);
  const [pasteText, setPasteText] = useState("");
  const pasteRules = useMemo(() => derivePolicy(pasteText).detected, [pasteText]);

  const savePasted = () => {
    const text = pasteText.trim();
    const doc = { name: "Pasted policy", text, pages: 1, chars: text.length, pasted: true };
    setPolicy({ doc, detected: derivePolicy(text).detected });
    setPasting(false);
  };

  const pickContent = async (file) => {
    setContentBusy(0);
    try {
      const res = await parseUpload(file, (p) => setContentBusy(p));
      if (!res.html.trim()) throw new Error("No readable text found. Scanned PDFs need OCR (planned for Round 3).");
      setContent({
        html: res.html,
        source: { type: "upload", kind: res.kind, name: file.name, pages: res.pages, images: res.images },
        label: file.name,
        meta: `${res.kind} · ${res.pages} page${res.pages === 1 ? "" : "s"} · ${res.chars.toLocaleString("en-IN")} characters${res.images ? ` · ${res.images} image(s) skipped` : ""}`,
      });
    } catch (e) {
      toast(e.message, "danger");
    } finally {
      setContentBusy(null);
    }
  };

  const pickPolicy = async (file) => {
    setPolicyBusy(true);
    try {
      const doc = await extractPolicySource(file, (p) => setPolicyBusy(p));
      if (!doc.text.replace(/\[Page \d+\]/g, "").trim()) throw new Error("No readable text found in the policy file.");
      setPolicy({ doc, detected: derivePolicy(doc.text).detected });
      if (doc.ocrFailed?.length)
        toast(`Pages ${doc.ocrFailed.join(", ")} of ${file.name} are pictures of text and OCR couldn't run (it needs internet the first time). Paste those rules instead.`, "danger");
      else if (doc.ocrPages?.length) toast(`Pages ${doc.ocrPages.join(", ")} were images of text - read them with OCR. Check the policy with "View" if anything looks off.`, "success");
    } catch (e) {
      toast(e.message, "danger");
    } finally {
      setPolicyBusy(false);
    }
  };

  const applySamplePolicy = () => setPolicy({ doc: { ...SAMPLE_POLICY, chars: SAMPLE_POLICY.text.length }, detected: derivePolicy(SAMPLE_POLICY.text).detected });

  // A policy typed in the box counts even if "Use this policy" wasn't clicked.
  const typedPolicy = !usingCurrent && pasting && pasteText.trim().length >= 10;
  const start = (override) => {
    const text = pasteText.trim();
    const doc = usingCurrent
      ? currentPolicy
      : typedPolicy
        ? { name: "Pasted policy", text, pages: 1, chars: text.length, pasted: true }
        : policy?.doc || null;
    onStart({ ...(override || content), policyDoc: doc });
  };

  return (
    <div className="fade-in mx-auto max-w-6xl">
      {/* Hero */}
      <div className="mb-8 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-indigo-300">
          <Sparkles className="h-3.5 w-3.5" /> Check before you publish
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Is your content safe to publish?</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-400">
          Add your content and your brand policy. PUBLIVRA checks every claim, word and number against the policy, explains each problem in plain
          language, and suggests a fix.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Step 1: content */}
        <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-500 text-sm font-bold text-white">1</span>
            <div>
              <h2 className="text-base font-bold">Your content</h2>
              <p className="text-xs text-slate-400">The draft you want to publish: a PDF, TeX or text file</p>
            </div>
          </div>

          {content ? (
            <FileChip icon={FileText} name={content.label} meta={content.meta} onRemove={() => setContent(null)} />
          ) : (
            <DropZone accept=".pdf,.tex,.txt,.md,application/pdf" onFile={pickContent} busy={contentBusy !== null}>
              {contentBusy !== null ? (
                <>
                  <LoaderCircle className="h-9 w-9 animate-spin text-blue-400" />
                  <span className="mt-2 text-sm font-semibold">Reading your file… {contentBusy}%</span>
                </>
              ) : (
                <>
                  <CloudUpload className="h-9 w-9 text-blue-400" />
                  <span className="mt-2 text-sm font-semibold text-slate-200">Drop your content here or click to browse</span>
                  <span className="mt-0.5 text-xs text-slate-500">.pdf · .tex · .txt</span>
                </>
              )}
            </DropZone>
          )}

          <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-600">
            <span className="h-px flex-1 bg-slate-800" /> or <span className="h-px flex-1 bg-slate-800" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => start({ html: BLANK_HTML, source: { type: "editor", name: "Untitled document" } })}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
            >
              <PenLine className="h-4 w-4" /> Write or paste
            </button>
            <button
              onClick={() => {
                if (!policy && !usingCurrent) applySamplePolicy();
                setContent({ html: SAMPLE_HTML, source: { type: "sample", name: "Proclinical Q3 draft copy" }, label: "Proclinical Q3 draft copy", meta: "Three campaign drafts that break the sample policy" });
              }}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
            >
              <Lightbulb className="h-4 w-4" /> Try a sample
            </button>
          </div>
        </section>

        {/* Step 2: policy */}
        <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-violet-500 text-sm font-bold text-white">2</span>
            <div>
              <h2 className="text-base font-bold">
                Your policy <span className="text-xs font-normal text-slate-500">(recommended)</span>
              </h2>
              <p className="text-xs text-slate-400">Brand guidelines, claims policy or spec sheet to check against</p>
            </div>
          </div>

          {currentPolicy && (
            <div className="mb-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Which policy to use">
              {[
                { id: "current", title: "Use the current policy", sub: currentPolicy.name },
                { id: "new", title: "Upload a new policy", sub: "File, paste or sample" },
              ].map((o) => (
                <button
                  key={o.id}
                  role="radio"
                  aria-checked={choice === o.id}
                  onClick={() => setChoice(o.id)}
                  className={`flex min-w-0 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                    choice === o.id ? "border-violet-400 bg-violet-500/15" : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
                  }`}
                >
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${choice === o.id ? "border-violet-400" : "border-slate-500"}`}>
                    {choice === o.id && <span className="h-2 w-2 rounded-full bg-violet-400" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-100">{o.title}</span>
                    <span className="block truncate text-[11px] text-slate-400">{o.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {usingCurrent ? (
            <div className="fade-in">
              <FileChip
                icon={ScrollText}
                tone="violet"
                name={currentPolicy.name}
                meta={`Kept from your last check · ${currentPolicy.chars?.toLocaleString("en-IN") ?? currentPolicy.text.length} characters`}
                onRemove={() => setChoice("new")}
              />
              {currentRules.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {currentRules.map((d) => (
                    <span key={d.label} className="max-w-full truncate rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200">
                      {d.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
          {policy ? (
              <>
                <FileChip
                  icon={ScrollText}
                  tone="violet"
                  name={policy.doc.name}
                  meta={`${policy.doc.pasted ? `${policy.doc.chars.toLocaleString("en-IN")} characters` : `${policy.doc.pages} page${policy.doc.pages === 1 ? "" : "s"}`}${ocrNote(policy.doc) ? ` · ${ocrNote(policy.doc)}` : ""} · used by the AI audit${policy.detected.length ? ` · ${policy.detected.length} rule(s) applied live` : ""}`}
                  onRemove={() => setPolicy(null)}
                  onEdit={
                    policy.doc.pasted || policy.doc.name === SAMPLE_POLICY.name
                      ? () => {
                          setPasteText(policy.doc.text);
                          setPolicy(null);
                          setPasting(true);
                        }
                      : undefined
                  }
                />
                {policy.detected.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[11px] font-semibold text-slate-400">Rules we picked up and will check as you type:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {policy.detected.map((d) => (
                        <span key={d.label} className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200">
                          {d.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : pasting ? (
              <div className="fade-in">
                <label htmlFor="policy-paste" className="mb-1.5 block text-[11px] font-semibold text-slate-400">
                  Write or paste your policy rules
                </label>
                <textarea
                  id="policy-paste"
                  autoFocus
                  rows={9}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={`For example:\nTone must be formal.\nUse "Enterprise client" instead of "Customer".\nDo not use "synergy" or "disruptive".\nDelivery timelines must not exceed 60 days.\nNever publish phone numbers or PAN.`}
                  className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
                />
                <div className="mt-2 min-h-6">
                  {pasteRules.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">Picked up:</span>
                      {pasteRules.map((d) => (
                        <span key={d.label} className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200">
                          {d.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500">Plain sentences are fine. The AI audit reads the whole text.</span>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={savePasted}
                    disabled={pasteText.trim().length < 10}
                    className="flex-1 rounded-xl bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Use this policy
                  </button>
                  <button onClick={() => setPasting(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <DropZone accept=".pdf,.txt,.md,application/pdf" onFile={pickPolicy} busy={policyBusy} tone="violet">
                  {policyBusy ? (
                    <>
                      <LoaderCircle className="h-9 w-9 animate-spin text-violet-400" />
                      <span className="mt-2 text-sm font-semibold">{policyBusy?.phase === "ocr" ? `Page ${policyBusy.page} of ${policyBusy.total} is an image - reading it with OCR…` : "Reading policy…"}</span>
                    </>
                  ) : (
                    <>
                      <BookOpenCheck className="h-9 w-9 text-violet-400" />
                      <span className="mt-2 text-sm font-semibold text-slate-200">Drop your policy here or click to browse</span>
                      <span className="mt-0.5 text-xs text-slate-500">.pdf · .txt · .md</span>
                    </>
                  )}
                </DropZone>
                <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-600">
                  <span className="h-px flex-1 bg-slate-800" /> or <span className="h-px flex-1 bg-slate-800" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPasting(true)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
                  >
                    <PenLine className="h-4 w-4" /> Write or paste
                  </button>
                  <button
                    onClick={applySamplePolicy}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-500"
                  >
                    <Lightbulb className="h-4 w-4" /> Use sample policy
                  </button>
                </div>
              </>
            )}

            </>
          )}

          <div className="mt-auto pt-4">
            <div className="flex items-start gap-2 rounded-xl bg-slate-800/50 p-3 text-[11px] leading-relaxed text-slate-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                {policy || usingCurrent
                  ? "Your policy is combined with PUBLIVRA's built-in safety rules (personal data, guarantees, unsourced numbers)."
                  : "No policy? PUBLIVRA's built-in rules still check personal data, absolute promises, unsourced numbers, hype and tone."}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Start */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          onClick={() => start()}
          disabled={!content}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-3.5 text-base font-bold text-white shadow-xl shadow-indigo-900/40 transition-all hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Check my content <ArrowRight className="h-5 w-5" />
        </button>
        <span className="text-xs text-slate-500">
          {content
            ? usingCurrent
              ? `Ready: content + ${currentPolicy.name}`
              : policy || typedPolicy
                ? "Ready: content + your new policy"
                : "Ready: we'll use the built-in rules"
            : "Add your content to begin"}
        </span>
      </div>

      {/* Common mistakes */}
      <section className="mt-12">
        <div className="mb-4 flex items-center gap-2">
          <CheckCheck className="h-5 w-5 text-amber-300" />
          <h2 className="text-lg font-bold">Most common problems we catch</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMMON_MISTAKES.map((m) => {
            const g = ISSUE_GROUPS[m.group];
            const Icon = ISSUE_ICONS[m.group];
            return (
              <div key={m.group} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-amber-500/15 p-1.5">
                    <Icon className="h-4 w-4 text-amber-300" />
                  </span>
                  <h3 className="text-sm font-bold">{g.title}</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{g.advice}</p>
                <div className="mt-3 space-y-1 text-xs">
                  <div className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-rose-200">
                    <span className="mr-1 font-bold">✗</span>
                    {m.bad}
                  </div>
                  <div className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-emerald-200">
                    <span className="mr-1 font-bold">✓</span>
                    {m.good}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
