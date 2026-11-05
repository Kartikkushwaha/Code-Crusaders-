import { useRef, useState } from "react";
import { BookOpen, FileText, FileUp, LoaderCircle, Plus, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import { extractPolicySource } from "../lib/fileParser.js";
import { Button } from "./ui.jsx";
import { DEFAULT_TONE, TONE_PROFILES, POLICY_TEMPLATE_TEXT } from "../data/defaultPolicy.js";
import { parsePolicyText } from "../lib/policyEngine.js";

const input = "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none";

export default function PolicyLibrary({ policy, setPolicy, onReset, log, policyDoc, setPolicyDoc }) {
  const [importText, setImportText] = useState("");
  const [importReport, setImportReport] = useState(null);
  const fileRef = useRef(null);
  const sourceRef = useRef(null);
  const [sourceState, setSourceState] = useState({ loading: false, error: null });

  const loadSource = async (file) => {
    setSourceState({ loading: true, error: null });
    try {
      const doc = await extractPolicySource(file);
      if (!doc.text.trim()) throw new Error("No text layer found in this file.");
      setPolicyDoc(doc);
      log(`Added approved source document "${doc.name}" (${doc.pages} page(s)) for AI retrieval`);
      setSourceState({ loading: false, error: null });
    } catch (e) {
      setSourceState({ loading: false, error: e.message });
    }
  };
  const [term, setTerm] = useState({ term: "", replacement: "", clause: "Custom rule", severity: "medium" });
  const [fact, setFact] = useState({ label: "", keywords: "", value: "", unit: "", source: "" });

  const update = (patch, msg) => {
    setPolicy((p) => ({ ...p, ...patch }));
    if (msg) log(msg);
  };

  const runImport = (text) => {
    const { policy: next, report } = parsePolicyText(text, policy);
    setPolicy(next);
    setImportReport(report);
    log(`Imported policy rules (${report.added} added, ${report.errors.length} errors)`);
  };

  return (
    <div className="fade-in mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <BookOpen className="h-6 w-6 text-indigo-400" /> Policy Library
          </h1>
          <p className="mt-1 text-sm text-slate-400">The approved guidelines, facts and tone every audit runs against. Changes re-scan the open document instantly.</p>
        </div>
        <Button variant="secondary" onClick={onReset}>
          <RotateCcw className="h-4 w-4" /> Reset to global default
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Tone & limits */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-bold">Persona & tone</h2>
          <label className="mt-3 block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Required tone</span>
            <select
              value={policy.tone ?? ""}
              onChange={(e) => update({ tone: e.target.value || null }, `Tone requirement set to ${e.target.value || "default"}`)}
              className={`${input} mt-1`}
            >
              <option value="">Not specified - use default ({DEFAULT_TONE.profile})</option>
              {Object.keys(TONE_PROFILES).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{TONE_PROFILES[policy.tone ?? DEFAULT_TONE.profile].description}</p>
          {!policy.tone && <p className="mt-2 rounded-lg bg-sky-500/10 p-2 text-[11px] text-sky-300">No tone in this policy - the auditor falls back to the default internal compliance tone.</p>}

          <h2 className="mt-6 text-sm font-bold">Delivery limits (POL-01)</h2>
          <label className="mt-3 block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Maximum delivery window (calendar days)</span>
            <input
              type="number"
              min={1}
              value={policy.maxDeliveryDays}
              onChange={(e) => update({ maxDeliveryDays: Math.max(1, Number(e.target.value) || 1) })}
              className={`${input} mt-1`}
            />
          </label>

          <h2 className="mt-6 text-sm font-bold">Always-on rules</h2>
          <ul className="mt-2 space-y-1.5 text-[11px] text-slate-400">
            <li>• Clause 1.1 - PAN, Aadhaar, phone, email and API keys are blocked</li>
            <li>• Clause 2 - absolute guarantees (guarantee, risk-free, zero downtime)</li>
            <li>• Unsourced figures default to UNVERIFIED</li>
            <li>• Superlatives without benchmarks are flagged</li>
          </ul>
        </section>

        {/* Banned terms */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:col-span-2">
          <h2 className="text-sm font-bold">Terminology - restricted terms & approved replacements</h2>
          <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-slate-800 scrollbar-thin">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Restricted</th>
                  <th className="px-3 py-2">Approved replacement</th>
                  <th className="px-3 py-2">Clause</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {policy.bannedTerms.map((t, i) => (
                  <tr key={`${t.term}-${i}`} className="hover:bg-slate-800/30">
                    <td className="px-3 py-1.5 font-medium text-rose-300">{t.term}</td>
                    <td className="px-3 py-1.5 text-emerald-300">{t.replacement}</td>
                    <td className="px-3 py-1.5 text-slate-400">{t.clause}</td>
                    <td className="px-3 py-1.5 capitalize text-slate-400">{t.severity}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => update({ bannedTerms: policy.bannedTerms.filter((_, j) => j !== i) }, `Removed restricted term "${t.term}"`)}
                        className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-300"
                        aria-label={`Remove ${t.term}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!term.term.trim() || !term.replacement.trim()) return;
              update({ bannedTerms: [...policy.bannedTerms, { ...term, term: term.term.trim(), replacement: term.replacement.trim() }] }, `Added restricted term "${term.term}"`);
              setTerm({ term: "", replacement: "", clause: "Custom rule", severity: "medium" });
            }}
          >
            <input className={input} placeholder="Restricted term" value={term.term} onChange={(e) => setTerm({ ...term, term: e.target.value })} />
            <input className={input} placeholder="Replacement" value={term.replacement} onChange={(e) => setTerm({ ...term, replacement: e.target.value })} />
            <input className={input} placeholder="Clause" value={term.clause} onChange={(e) => setTerm({ ...term, clause: e.target.value })} />
            <select className={input} value={term.severity} onChange={(e) => setTerm({ ...term, severity: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <Button size="sm" type="submit" className="col-span-2 sm:col-span-1">
              <Plus className="h-3.5 w-3.5" /> Add term
            </Button>
          </form>
        </section>
      </div>

      {/* Approved facts */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-bold">Approved facts & sources</h2>
        <p className="mt-0.5 text-[11px] text-slate-400">A claim is VERIFIED only when it matches one of these. A matching subject with a different figure is CONTRADICTED.</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Fact</th>
                <th className="px-3 py-2">Keywords</th>
                <th className="px-3 py-2">Approved value</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {policy.approvedFacts.map((f, i) => (
                <tr key={f.id + i} className="hover:bg-slate-800/30">
                  <td className="px-3 py-1.5 font-mono text-slate-500">{f.id}</td>
                  <td className="px-3 py-1.5 text-slate-200">{f.label}</td>
                  <td className="px-3 py-1.5 text-slate-400">{f.keywords.join(", ")}</td>
                  <td className="px-3 py-1.5 font-mono text-emerald-300">
                    {f.value} {f.unit}
                  </td>
                  <td className="px-3 py-1.5 text-slate-400">{f.source}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => update({ approvedFacts: policy.approvedFacts.filter((_, j) => j !== i) }, `Removed approved fact ${f.id}`)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-300"
                      aria-label={`Remove ${f.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {policy.approvedStatements.map((s, i) => (
                <tr key={s.id + i} className="hover:bg-slate-800/30">
                  <td className="px-3 py-1.5 font-mono text-slate-500">{s.id}</td>
                  <td className="px-3 py-1.5 text-slate-200">{s.label}</td>
                  <td className="px-3 py-1.5 text-slate-400">"{s.text}"</td>
                  <td className="px-3 py-1.5 text-emerald-300">Statement</td>
                  <td className="px-3 py-1.5 text-slate-400">{s.source}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => update({ approvedStatements: policy.approvedStatements.filter((_, j) => j !== i) }, `Removed approved statement ${s.id}`)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-300"
                      aria-label={`Remove ${s.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fact.label.trim() || !fact.keywords.trim() || fact.value === "" || !fact.unit.trim()) return;
            const id = `F-${String(policy.approvedFacts.length + 1).padStart(2, "0")}`;
            update(
              {
                approvedFacts: [
                  ...policy.approvedFacts,
                  {
                    id, label: fact.label.trim(), keywords: fact.keywords.split(",").map((k) => k.trim()).filter(Boolean),
                    value: Number(fact.value), unit: fact.unit.trim(), source: fact.source.trim() || "Added in Policy Library",
                  },
                ],
              },
              `Added approved fact ${id} (${fact.label})`,
            );
            setFact({ label: "", keywords: "", value: "", unit: "", source: "" });
          }}
        >
          <input className={input} placeholder="Fact label" value={fact.label} onChange={(e) => setFact({ ...fact, label: e.target.value })} />
          <input className={input} placeholder="Keywords (comma sep.)" value={fact.keywords} onChange={(e) => setFact({ ...fact, keywords: e.target.value })} />
          <input className={input} placeholder="Value" type="number" step="any" value={fact.value} onChange={(e) => setFact({ ...fact, value: e.target.value })} />
          <input className={input} placeholder="Unit (%, MP, hours)" value={fact.unit} onChange={(e) => setFact({ ...fact, unit: e.target.value })} />
          <input className={input} placeholder="Source & page" value={fact.source} onChange={(e) => setFact({ ...fact, source: e.target.value })} />
          <Button size="sm" type="submit">
            <Plus className="h-3.5 w-3.5" /> Add fact
          </Button>
        </form>
      </section>

      {/* Approved source document for RAG */}
      <section className="rounded-2xl border border-violet-500/30 bg-gradient-to-r from-violet-950/40 to-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">Approved source document (AI retrieval)</h2>
            <p className="text-[11px] text-slate-400">
              Upload a brand book, claims policy or spec sheet. The backend indexes it in Qdrant and the AI cites it page by page during the deep audit.
            </p>
          </div>
          <div className="flex gap-2">
            {policyDoc && (
              <Button size="sm" variant="ghost" onClick={() => { setPolicyDoc(null); log(`Removed approved source "${policyDoc.name}"`); }}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => sourceRef.current?.click()} disabled={sourceState.loading}>
              {sourceState.loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
              {policyDoc ? "Replace document" : "Upload PDF / TXT"}
            </Button>
            <input
              ref={sourceRef}
              type="file"
              accept=".pdf,.txt,.md,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadSource(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {policyDoc ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs">
            <FileText className="h-4 w-4 text-violet-300" />
            <span className="font-semibold text-slate-200">{policyDoc.name}</span>
            <span className="text-slate-500">
              · {policyDoc.pages} page{policyDoc.pages === 1 ? "" : "s"} · {policyDoc.chars.toLocaleString("en-IN")} characters
            </span>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-slate-500">No document uploaded - the AI uses the backend brand guidelines plus the rules on this page.</p>
        )}
        {sourceState.error && <p className="mt-2 text-[11px] text-rose-300">{sourceState.error}</p>}
      </section>

      {/* Import */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">Import custom policy rules</h2>
            <p className="text-[11px] text-slate-400">Paste rules or upload a .txt file. Leave out TONE to keep the default internal tone.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setImportText(POLICY_TEMPLATE_TEXT)}>
              <WandSparkles className="h-3.5 w-3.5" /> Insert template
            </Button>
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5" /> Upload .txt
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setImportText(await f.text());
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={POLICY_TEMPLATE_TEXT}
          className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => runImport(importText)} disabled={!importText.trim()}>
            Apply rules
          </Button>
          {importReport && (
            <span className="text-[11px] text-slate-400">
              <span className="text-emerald-300">{importReport.added} rule(s) added</span>
              {importReport.errors.length > 0 && <span className="text-rose-300"> · {importReport.errors.join(" · ")}</span>}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
