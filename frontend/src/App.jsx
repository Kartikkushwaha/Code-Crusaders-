import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Info } from "lucide-react";

import Drawer from "./components/Drawer.jsx";
import TopBar from "./components/TopBar.jsx";
import InputChooser from "./components/InputChooser.jsx";
import RichTextEditor from "./components/RichTextEditor.jsx";
import AnalyticsPanel from "./components/AnalyticsPanel.jsx";
import RiskBanner from "./components/RiskBanner.jsx";
import Stepper from "./components/Stepper.jsx";
import { ReadyModal, HighRiskModal } from "./components/PublishModals.jsx";
import HumanVerification from "./components/HumanVerification.jsx";
import PolicyLibrary from "./components/PolicyLibrary.jsx";
import AuditTrail from "./components/AuditTrail.jsx";
import { Toasts } from "./components/ui.jsx";

import { DEFAULT_POLICY } from "./data/defaultPolicy.js";
import { SAMPLE_HTML, BLANK_HTML } from "./data/sampleContent.js";
import { analyzeDocument, computeRisk, policyToText, tidy as tidySentence } from "./lib/policyEngine.js";
import { api, API_BASE, toUiFinding } from "./lib/api.js";
import { editorPlainText, locateInEditor, replaceInEditor } from "./lib/editorUtils.js";
import { parseUpload } from "./lib/fileParser.js";
import { buildPublicationPdf, domToBlocks, downloadBlob, slugify } from "./lib/pdfExport.js";

const clonePolicy = () => JSON.parse(JSON.stringify(DEFAULT_POLICY));
let uid = 0;
const nextId = (p) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

export default function App() {
  // navigation
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState("workspace");

  // document
  const editorRef = useRef(null);
  const replaceInputRef = useRef(null);
  const [mode, setMode] = useState(null); // null | 'editor' | 'upload'
  const [docKey, setDocKey] = useState(0);
  const [initialHtml, setInitialHtml] = useState("");
  const [source, setSource] = useState(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("Untitled document");
  const [parsing, setParsing] = useState(null);

  // audit
  const [policy, setPolicy] = useState(clonePolicy);
  const [analysis, setAnalysis] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [dismissed, setDismissed] = useState({});
  const [policyDoc, setPolicyDoc] = useState(null); // approved source document for RAG

  // backend (FastAPI on Render)
  const [engine, setEngine] = useState({ status: "checking", info: null });
  const [ai, setAi] = useState({ status: "idle", result: null, error: null, textAtRun: "" });

  // publishing & governance
  const [modal, setModal] = useState(null); // 'ready' | 'high'
  const [publications, setPublications] = useState([]);
  const [activePubId, setActivePubId] = useState(null);
  const pdfStore = useRef({});
  const [activity, setActivity] = useState([]);
  const [toasts, setToasts] = useState([]);

  // ------------------------------------------------------------ helpers
  const log = useCallback((message, actor = "Human") => {
    setActivity((a) => [{ id: nextId("log"), at: Date.now(), actor, message }, ...a].slice(0, 300));
  }, []);

  const toast = useCallback((message, tone = "default") => {
    const id = nextId("t");
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "danger" ? 7000 : 4500);
  }, []);

  const checkEngine = useCallback(async () => {
    setEngine((e) => ({ ...e, status: "checking" }));
    const wakeTimer = setTimeout(() => setEngine((e) => (e.status === "checking" ? { ...e, status: "waking" } : e)), 3500);
    try {
      const info = await api.health();
      setEngine({ status: info?.ai?.configured ? "online" : "degraded", info });
    } catch (e) {
      setEngine({ status: "offline", info: null, error: e.message });
    } finally {
      clearTimeout(wakeTimer);
    }
  }, []);

  useEffect(() => {
    checkEngine();
  }, [checkEngine]);

  const syncFromEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    setText(editorPlainText(el));
    const h1 = el.querySelector("h1")?.textContent?.trim();
    setTitle(h1 || source?.name || "Untitled document");
  }, [source]);

  // ------------------------------------------------------- live analysis
  useEffect(() => {
    if (!mode) return undefined;
    setScanning(true);
    const t = setTimeout(() => {
      setAnalysis(analyzeDocument(text, policy));
      setScanning(false);
    }, 450);
    return () => clearTimeout(t);
  }, [text, policy, mode]);

  // Merge LLM findings with the live rule findings. AI findings disappear once their sentence is edited.
  const merged = useMemo(() => {
    if (!analysis) return null;
    const res = ai.result;
    if (!res) return analysis;
    const sentences = new Set(analysis.sentences);
    const unchanged = text === ai.textAtRun;
    const aiFindings = res.findings
      .filter((f) => (f.located ? sentences.has(f.sentence) : unchanged))
      .map(toUiFinding)
      .filter((af) => {
        const span = (af.match || "").toLowerCase();
        return !analysis.findings.some((rf) => {
          if (rf.sentence !== af.sentence) return false;
          const m = (rf.match || "").toLowerCase();
          return m && span && (span.includes(m) || m.includes(span));
        });
      });
    return { ...analysis, findings: [...analysis.findings, ...aiFindings] };
  }, [analysis, ai, text]);

  const risk = useMemo(() => (merged ? computeRisk(merged.findings, merged.tone, dismissed) : null), [merged, dismissed]);

  const runAiAudit = useCallback(async () => {
    if (!text.trim()) return;
    const snapshot = text;
    setAi((a) => ({ ...a, status: "running", error: null }));
    log(`Requested AI deep audit (${snapshot.length.toLocaleString("en-IN")} characters)`);
    try {
      const result = await api.audit({
        text: snapshot,
        title,
        source: source?.type || "editor",
        policy_rules: policyToText(policy),
        policy_document: policyDoc ? { name: policyDoc.name, text: policyDoc.text } : null,
        tone_profile: policy.tone || "Professional",
      });
      setAi({ status: "done", result, error: null, textAtRun: snapshot, ranAt: Date.now() });
      if (engine.status !== "online") setEngine((e) => ({ ...e, status: "online" }));
      log(
        `AI (${result.model}) returned ${result.findings.length} finding(s) using ${result.retrieval.mode} retrieval over ${result.retrieval.chunks} approved chunk(s)` +
          (result.audit_id ? ` - Neon audit #${result.audit_id}` : " - not logged to Neon"),
        "AI",
      );
      toast(`AI audit complete: ${result.counts.CONTRADICTED} contradicted, ${result.counts.UNVERIFIED} unverified, ${result.counts.VERIFIED} verified.`, "success");
    } catch (e) {
      setAi((a) => ({ ...a, status: "error", error: e.message }));
      log(`AI audit failed: ${e.message}`, "AI");
      toast(`AI audit failed: ${e.message}`, "danger");
    }
  }, [text, title, source, policy, policyDoc, engine.status, log, toast]);

  const lastLevel = useRef(null);
  useEffect(() => {
    if (!risk || scanning) return;
    if (lastLevel.current !== risk.level) {
      log(`Scan complete: ${risk.counts.contradicted} contradicted, ${risk.counts.unverified} unverified, ${risk.counts.verified} verified - ${risk.level} RISK`, "AI");
      lastLevel.current = risk.level;
    }
  }, [risk, scanning, log]);

  // --------------------------------------------------------- documents
  const openDocument = useCallback(
    (html, src) => {
      setInitialHtml(html);
      setSource(src);
      setMode(src.type === "upload" ? "upload" : "editor");
      setDocKey((k) => k + 1);
      setDismissed({});
      setAnalysis(null);
      setAi({ status: "idle", result: null, error: null, textAtRun: "" });
      lastLevel.current = null;
      setActivePubId(null);
      setView("workspace");
      setDrawerOpen(false);
    },
    [],
  );

  const handleFile = useCallback(
    async (file) => {
      setParsing({ name: file.name, progress: 0 });
      try {
        const res = await parseUpload(file, (p) => setParsing({ name: file.name, progress: p }));
        if (!res.html.trim()) {
          toast(`No text layer found in ${file.name}. Scanned PDFs need OCR, planned with visual parsing in Round 3.`, "danger");
          return;
        }
        openDocument(res.html, { type: "upload", kind: res.kind, name: file.name, pages: res.pages, images: res.images });
        log(`Uploaded ${file.name}`);
        log(`Extracted ${res.chars.toLocaleString("en-IN")} characters from ${res.pages} page(s)${res.images ? `; ${res.images} image(s) queued for Round 3 visual audit` : ""}`, "AI");
        toast(`${file.name} parsed - live audit running.`, "success");
      } catch (e) {
        console.error(e);
        toast(`Could not read ${file.name}: ${e.message}`, "danger");
      } finally {
        setParsing(null);
      }
    },
    [openDocument, log, toast],
  );

  const startEditor = () => {
    openDocument(BLANK_HTML, { type: "editor", name: "Untitled document" });
    log("Opened the inbuilt text editor");
  };
  const loadSample = () => {
    openDocument(SAMPLE_HTML, { type: "sample", name: "Sample proposal" });
    log("Loaded the sample service proposal");
  };
  const newAudit = () => {
    setMode(null);
    setSource(null);
    setAnalysis(null);
    setText("");
    setDismissed({});
    setAi({ status: "idle", result: null, error: null, textAtRun: "" });
    setActivePubId(null);
    setView("workspace");
    setDrawerOpen(false);
  };

  // -------------------------------------------------------- suggestions
  const onLocate = (f) => {
    setView("workspace");
    requestAnimationFrame(() => {
      if (!locateInEditor(editorRef.current, f.sentence, f.match)) toast("That text is no longer in the document.");
    });
  };

  const onAccept = (f) => {
    const ok = replaceInEditor(editorRef.current, f.sentence, f.suggestion.find, f.suggestion.replace);
    if (!ok) return toast("Couldn't find that text - it may already have been edited.");
    syncFromEditor();
    log(`Accepted AI fix (${f.clause}): "${f.suggestion.find.trim()}" → "${f.suggestion.replace || "removed"}"`);
  };

  const onAcceptAll = (list) => {
    const bySentence = new Map();
    list.forEach((f) => {
      if (!bySentence.has(f.sentence)) bySentence.set(f.sentence, []);
      bySentence.get(f.sentence).push(f);
    });
    let applied = 0;
    bySentence.forEach((items, sentence) => {
      let next = sentence;
      [...items]
        .sort((a, b) => (b.offset ?? 0) - (a.offset ?? 0))
        .forEach((f) => {
          let idx = next.indexOf(f.suggestion.find, Math.max(0, (f.offset ?? 0) - 2));
          if (idx < 0) idx = next.indexOf(f.suggestion.find);
          if (idx < 0) return;
          next = next.slice(0, idx) + f.suggestion.replace + next.slice(idx + f.suggestion.find.length);
          applied += 1;
        });
      next = tidySentence(next);
      if (next !== sentence) replaceInEditor(editorRef.current, sentence, sentence, next);
    });
    syncFromEditor();
    log(`Accepted ${applied} AI suggestion(s) in bulk`);
    toast(`${applied} fix${applied === 1 ? "" : "es"} applied. Re-scanning…`, "success");
  };

  const onManualEdit = (f, draft) => {
    const ok = replaceInEditor(editorRef.current, f.sentence, f.sentence, draft.trim());
    if (!ok) return toast("Couldn't find that sentence - it may already have been edited.");
    syncFromEditor();
    log(`Manually rewrote a flagged sentence (${f.clause})`);
  };

  const onDismiss = (f, reason) => {
    setDismissed((d) => ({ ...d, [f.id]: reason }));
    log(`Overrode ${f.verdict} finding "${f.match}" (${f.clause}) - reason: ${reason}`);
    api.logEvent({ actor: "Human", action: "override_finding", detail: `${f.verdict} "${f.match}" (${f.clause}): ${reason}`, audit_id: ai.result?.audit_id ?? null });
  };
  const onRestore = (f) => {
    setDismissed((d) => {
      const n = { ...d };
      delete n[f.id];
      return n;
    });
    log(`Restored finding "${f.match}"`);
  };

  // ------------------------------------------------------------ publish
  const canPublish = !!(mode && analysis && !scanning && text.trim().length > 0);
  const onPublish = () => {
    if (!canPublish) return;
    setView("workspace");
    setModal(risk.level === "HIGH" ? "high" : "ready");
    log(`Clicked Publish at ${risk.level} RISK`);
  };

  const doPublish = (fileName, overridden) => {
    const at = Date.now();
    const blob = buildPublicationPdf({
      title,
      blocks: domToBlocks(editorRef.current),
      risk,
      tone: merged.tone,
      findings: merged.findings,
      aiInfo: ai.result ? { model: ai.result.model, auditId: ai.result.audit_id, retrieval: ai.result.retrieval.mode, stale: text !== ai.textAtRun } : null,
      dismissed,
      policyName: policy.name,
      overridden,
      publishedAt: at,
      sourceLabel: source?.type === "upload" ? `${source.kind} upload - ${source.name}` : "PUBLIVRA inbuilt editor",
    });
    const name = `${slugify(fileName)}.pdf`;
    downloadBlob(blob, name);
    const pub = { id: nextId("pub"), title, fileName: name, at, risk, overridden, status: "pending", serverId: null };
    pdfStore.current[pub.id] = blob;
    setPublications((p) => [pub, ...p]);
    setActivePubId(pub.id);
    setModal(null);
    api
      .createPublication({
        audit_id: ai.result?.audit_id ?? null,
        title,
        file_name: name,
        risk_level: risk.level,
        risk_score: risk.score,
        overridden,
        counts: risk.counts,
      })
      .then((r) => {
        if (r?.id) {
          setPublications((ps) => ps.map((p) => (p.id === pub.id ? { ...p, serverId: r.id } : p)));
          log(`Publication logged to Neon as record #${r.id}`, "AI");
        } else log("Publication kept locally (database not reachable)", "AI");
      })
      .catch((e) => log(`Publication kept locally - ${e.message}`, "AI"));
    setView("verification");
    if (overridden) {
      log(`Typed "confirm" and overrode the HIGH RISK gate - downloaded ${name}`);
      toast("PDF downloaded by override. PUBLIVRA AI will not be held responsible for compliance breaches.", "danger");
    } else {
      log(`Confirmed "Ready to Publish" - downloaded ${name}`);
      toast(`${name} downloaded. Complete the human verification checklist to close the project.`, "success");
    }
  };

  const activePub = publications.find((p) => p.id === activePubId) || publications.find((p) => p.status === "pending") || null;

  const closePublication = (approver) => {
    setPublications((ps) => ps.map((p) => (p.id === activePub.id ? { ...p, status: "closed", approver, closedAt: Date.now() } : p)));
    log(`Human verification completed by ${approver.name} (${approver.role}) - project closed`);
    if (activePub.serverId) {
      api
        .verifyPublication(activePub.serverId, { approver_name: approver.name, approver_role: approver.role, checklist: approver.checklist || [] })
        .then((r) => r?.db_logged && log(`Sign-off stored in Neon (publication #${activePub.serverId})`, "AI"))
        .catch((e) => log(`Sign-off kept locally - ${e.message}`, "AI"));
    }
    toast("Project verified and closed.", "success");
  };

  const redownload = () => {
    const blob = activePub && pdfStore.current[activePub.id];
    if (blob) downloadBlob(blob, activePub.fileName);
  };

  // ------------------------------------------------------------ derived
  const openItems = risk ? risk.counts.contradicted + risk.counts.unverified : 0;
  let step = 0;
  if (mode) step = !analysis || scanning ? 1 : openItems > 0 ? 2 : 3;
  const currentPub = publications.find((p) => p.id === activePubId);
  if (currentPub) step = currentPub.status === "closed" ? 5 : 4;
  const pendingCount = publications.filter((p) => p.status === "pending").length;

  return (
    <div className="min-h-full">
      <TopBar
        onToggleDrawer={() => setDrawerOpen((o) => !o)}
        drawerOpen={drawerOpen}
        title={mode ? title : null}
        risk={mode ? risk : null}
        scanning={scanning}
        onPublish={onPublish}
        canPublish={canPublish}
        engine={engine}
        onRetryEngine={checkEngine}
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={(v) => {
          setView(v);
          setDrawerOpen(false);
        }}
        badges={{ verification: pendingCount }}
        onNewDocument={newAudit}
        policyName={policy.name}
      />

      <main className="mx-auto max-w-[1600px] px-3 py-5 sm:px-5">
        {/* Workspace stays mounted so the document survives navigation. */}
        <div className={view === "workspace" ? "" : "hidden"}>
          {!mode ? (
            <InputChooser onFile={handleFile} onStartEditor={startEditor} onLoadSample={loadSample} parsing={parsing} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button onClick={newAudit} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">
                  <ArrowLeft className="h-3.5 w-3.5" /> Choose input
                </button>
                <Stepper current={step} />
              </div>

              {risk ? (
                <RiskBanner risk={risk} onPublish={onPublish} canPublish={canPublish} scanning={scanning} />
              ) : (
                <div className="h-[104px] animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
              )}

              {mode === "upload" && (
                <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                  Text was extracted from your file and opened for editing. Graphics and images are not parsed yet - visual consistency and accessibility checks are
                  scheduled for Round 3.
                </div>
              )}

              <div className="grid gap-4 xl:h-[calc(100vh-250px)] xl:min-h-[640px] xl:grid-cols-[minmax(0,1fr)_430px]">
                <RichTextEditor
                  editorRef={editorRef}
                  docKey={docKey}
                  initialHtml={initialHtml}
                  onChange={syncFromEditor}
                  source={source}
                  scanning={scanning}
                  lastAnalyzed={analysis?.analyzedAt}
                  onReplaceFile={() => replaceInputRef.current?.click()}
                />
                <AnalyticsPanel
                  analysis={merged}
                  ai={ai}
                  aiStale={!!ai.result && text !== ai.textAtRun}
                  engine={engine}
                  apiBase={API_BASE}
                  onRunAi={runAiAudit}
                  onRetryEngine={checkEngine}
                  policyDoc={policyDoc}
                  risk={risk}
                  dismissed={dismissed}
                  scanning={scanning}
                  onLocate={onLocate}
                  onAccept={onAccept}
                  onAcceptAll={onAcceptAll}
                  onDismiss={onDismiss}
                  onRestore={onRestore}
                  onManualEdit={onManualEdit}
                  policyName={policy.name}
                />
              </div>
              <input
                ref={replaceInputRef}
                type="file"
                accept=".pdf,.tex,.txt,.md,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>

        {view === "policies" && (
          <PolicyLibrary
            policy={policy}
            setPolicy={setPolicy}
            onReset={() => {
              setPolicy(clonePolicy());
              log("Reset policy to the global default");
              toast("Policy reset to PUBLIVRA global default.");
            }}
            log={log}
            policyDoc={policyDoc}
            setPolicyDoc={setPolicyDoc}
          />
        )}
        {view === "verification" && (
          <HumanVerification
            publication={activePub}
            onClose={closePublication}
            onRedownload={redownload}
            onNewDocument={newAudit}
            onGoToWorkspace={() => setView("workspace")}
          />
        )}
        {view === "history" && (
          <AuditTrail
            publications={publications}
            activity={activity}
            onOpenVerification={(id) => {
              setActivePubId(id);
              setView("verification");
            }}
          />
        )}
      </main>

      <ReadyModal open={modal === "ready"} onClose={() => setModal(null)} onConfirm={(n) => doPublish(n, false)} risk={risk} defaultName={slugify(title)} />
      <HighRiskModal
        open={modal === "high"}
        onClose={() => setModal(null)}
        onConfirm={(n) => doPublish(n, true)}
        risk={risk}
        findings={(merged?.findings ?? []).filter((f) => !dismissed[f.id])}
        defaultName={slugify(title)}
      />
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
