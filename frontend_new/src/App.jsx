import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import Drawer from "./components/Drawer.jsx";
import TopBar from "./components/TopBar.jsx";
import StartScreen from "./components/StartScreen.jsx";
import PolicyBar from "./components/PolicyBar.jsx";
import TopIssues from "./components/TopIssues.jsx";
import PolicyViewer from "./components/PolicyViewer.jsx";
import { DEFAULT_GUIDELINES } from "./data/defaultGuidelines.js";
import RichTextEditor from "./components/RichTextEditor.jsx";
import AnalyticsPanel from "./components/AnalyticsPanel.jsx";
import Insights from "./components/Insights.jsx";
import RiskBanner from "./components/RiskBanner.jsx";
import Stepper from "./components/Stepper.jsx";
import { ReadyModal, HighRiskModal } from "./components/PublishModals.jsx";
import HumanVerification from "./components/HumanVerification.jsx";
import AuditTrail from "./components/AuditTrail.jsx";
import { Toasts } from "./components/ui.jsx";
import VisualAudit from "./components/VisualAudit.jsx";
import { ApprovalActions, ApprovalNotice, SendModal } from "./components/ApprovalFlow.jsx";
import ReviewPanel from "./components/ReviewPanel.jsx";
import { SignoffLog } from "./components/SignoffLog.jsx";
import { loadName, markPublished, markSeen, markSignedOff, saveName, submitToManager, useWorkflow } from "./lib/workflow.js";
import LoginScreen from "./components/LoginScreen.jsx";
import NetworkNotice from "./components/NetworkNotice.jsx";
import { clearSession, lastCompany, loadSession, saveSession } from "./lib/session.js";

import { derivePolicy, groupFindings } from "./lib/insights.js";
import { analyzeDocument, computeRisk, policyToText, tidy as tidySentence } from "./lib/policyEngine.js";
import { api, API_BASE, toServerFinding, toUiFinding } from "./lib/api.js";
import { editorPlainText, locateInEditor, replaceInEditor } from "./lib/editorUtils.js";
import { parseUpload } from "./lib/fileParser.js";
import { buildPublicationPdf, domToBlocks, downloadBlob, slugify } from "./lib/pdfExport.js";

let uid = 0;
const POLICY_KEY = "publivra.policy.v1";
function loadSavedPolicy() {
  try {
    const raw = localStorage.getItem(POLICY_KEY);
    const doc = raw ? JSON.parse(raw) : null;
    return doc && typeof doc.text === "string" && doc.text.trim() ? doc : null;
  } catch {
    return null;
  }
}
const nextId = (p) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

export default function App() {
  // navigation
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Enterprise sign-in: parent company (tenant) -> child role. The role decides the panel.
  const [session, setSession] = useState(loadSession);
  const [loginPrefill, setLoginPrefill] = useState(() => lastCompany());
  const role = session?.role || "creator";
  const [views, setViews] = useState({ creator: "workspace", manager: "approvals", legal: "legal" });
  const view = views[role];
  const setView = useCallback((v) => setViews((vs) => ({ ...vs, [role]: v })), [role]);
  const setCreatorView = useCallback((v) => setViews((vs) => ({ ...vs, creator: v })), []);
  const onLogin = useCallback((s) => {
    saveSession(s);
    if (!loadName(s.role)) saveName(s.role, s.email);
    setSession(s);
    setDrawerOpen(false);
  }, []);
  const switchAccount = useCallback(() => {
    // keep the company, pick another role - the creator's open document stays in place
    setLoginPrefill({ company: session?.company, domain: session?.domain, role: session?.role });
    clearSession();
    setSession(null);
    setDrawerOpen(false);
  }, [session]);
  const logout = useCallback(() => {
    clearSession();
    setLoginPrefill(null);
    setSession(null);
    setDrawerOpen(false);
  }, []);
  const allWorkflow = useWorkflow();
  // each company (tenant) only sees its own submissions
  const tenantOf = (c) => String(c || "").trim().toLowerCase();
  const workflow = useMemo(
    () => ({ ...allWorkflow, submissions: allWorkflow.submissions.filter((s) => tenantOf(s.company) === tenantOf(session?.company)) }),
    [allWorkflow, session?.company],
  );
  const pendingFor = useCallback(
    (c) => {
      const subs = allWorkflow.submissions.filter((s) => tenantOf(s.company) === tenantOf(c));
      return {
        manager: subs.filter((s) => s.status === "pending_manager").length,
        legal: subs.filter((s) => s.status === "pending_legal").length,
        creator: subs.filter((s) => !s.seenByCreator).length,
      };
    },
    [allWorkflow],
  );
  const [currentSubId, setCurrentSubId] = useState(null);
  const currentSub = workflow.submissions.find((s) => s.id === currentSubId) || null;
  const [sendOpen, setSendOpen] = useState(false);
  // Improvement 1: audited images (logo, colours, text in image) for the current document
  const [visualImages, setVisualImages] = useState([]);
  const [videos, setVideos] = useState([]);
  // fixes the creator applied, sent to the manager with the submission
  const [improvements, setImprovements] = useState([]);
  const addImprovement = useCallback((t) => setImprovements((l) => [...l, t].slice(-80)), []);
  // The signed-in parent company tags every audit, publication and submission.
  const company = session?.company || "";

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
  const [analysis, setAnalysis] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [dismissed, setDismissed] = useState({});
  // Uploaded/pasted policy: sent to the AI audit + mined for live rules.
  // Kept between checks (and across reloads) until the user uploads a new one or removes it.
  const [policyDoc, setPolicyDocState] = useState(loadSavedPolicy);
  const setPolicyDoc = useCallback((doc) => {
    setPolicyDocState(doc);
    try {
      if (doc) localStorage.setItem(POLICY_KEY, JSON.stringify(doc));
      else localStorage.removeItem(POLICY_KEY);
    } catch {
      /* storage full or blocked: keep it for this session only */
    }
  }, []);
  const policyInfo = useMemo(() => {
    const info = derivePolicy(policyDoc?.text);
    if (policyDoc) info.policy.name = policyDoc.name;
    return info;
  }, [policyDoc]);
  const policy = policyInfo.policy;
  const [panelFocus, setPanelFocus] = useState(null);
  const [viewer, setViewer] = useState(null); // { doc, target } for the policy viewer
  const openPolicyRef = useCallback(
    (ref) => {
      const wantsDefault = ref?.source === DEFAULT_GUIDELINES.name || (!policyDoc && !ref?.source);
      const doc = wantsDefault || !policyDoc ? DEFAULT_GUIDELINES : policyDoc;
      setViewer({ doc, target: ref && ref.line ? { page: ref.page ?? null, line: ref.line } : null });
    },
    [policyDoc],
  ); // { tab, group, n } - lets dashboard cards drive the panel

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
    const overlaps = (rf, af) => {
      if (rf.sentence !== af.sentence) return false;
      const m = (rf.match || "").toLowerCase();
      const span = (af.match || "").toLowerCase();
      return m && span && (span.includes(m) || m.includes(span));
    };
    const aiFindings = res.findings.filter((f) => (f.located ? sentences.has(f.sentence) : unchanged)).map(toUiFinding);
    // Same issue found by both: keep the instant rule flag (and its one-click fix),
    // but give it the AI's policy citation, quote and recommendation.
    const ruleFindings = analysis.findings.map((rf) => {
      const af = aiFindings.find((a) => overlaps(rf, a));
      if (!af) return rf;
      return {
        ...rf,
        aiConfirmed: true,
        policyRef: rf.policyRef || af.policyRef,
        policyQuote: rf.policyQuote || af.policyQuote,
        recommendation: rf.recommendation || af.recommendation,
        explanation: af.policyRef && !rf.policyRef ? af.explanation || rf.explanation : rf.explanation,
      };
    });
    const aiOnly = aiFindings.filter((af) => !analysis.findings.some((rf) => overlaps(rf, af)));
    return { ...analysis, findings: [...ruleFindings, ...aiOnly] };
  }, [analysis, ai, text]);

  const visualFindings = useMemo(
    () => [...visualImages.flatMap((i) => [...i.findings, ...(i.adFindings || [])]), ...videos.flatMap((v) => v.findings)],
    [visualImages, videos],
  );
  const risk = useMemo(() => (merged ? computeRisk([...merged.findings, ...visualFindings], merged.tone, dismissed) : null), [merged, visualFindings, dismissed]);

  const issueGroups = useMemo(() => (merged ? groupFindings(merged.findings, dismissed) : []), [merged, dismissed]);

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
        // the dashboard's own rule checks, so the charts count PII / banned terms too
        rule_findings: [...(analysis?.findings ?? []), ...visualFindings].filter((f) => f.verdict !== "VERIFIED" && !dismissed[f.id]).map(toServerFinding),
        company: company.trim(),
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
  }, [text, title, source, policy, policyDoc, engine.status, log, toast, analysis, dismissed, company, visualFindings]);

  // Improvement 1: ad / body text read from an image goes through the rule checks + AI deep audit.
  const runAdTextAudit = useCallback(
    async (adText, imageName, imageFindings) => {
      const local = analyzeDocument(adText, policy).findings.map((f) => ({ ...f, id: `${f.id}-${imageName}`, image: imageName }));
      try {
        const result = await api.audit({
          text: adText,
          title: `${imageName} (text in image)`,
          source: "image",
          policy_rules: policyToText(policy),
          policy_document: policyDoc ? { name: policyDoc.name, text: policyDoc.text } : null,
          tone_profile: policy.tone || "Professional",
          rule_findings: [...imageFindings, ...local].filter((f) => f.verdict !== "VERIFIED").map(toServerFinding),
          company: company.trim(),
        });
        const aiFindings = result.findings.map((f) => ({ ...toUiFinding(f), image: imageName }));
        const overlap = (r) => aiFindings.some((x) => (x.match || "").toLowerCase().includes((r.match || "").toLowerCase()) && r.match);
        log(`AI deep audit of the text in ${imageName}: ${result.counts.CONTRADICTED} contradicted, ${result.counts.UNVERIFIED} unverified, ${result.counts.VERIFIED} verified`, "AI");
        return { findings: [...local.filter((r) => !overlap(r)), ...aiFindings], note: result.audit_id ? `AI: ${result.model} · Neon audit #${result.audit_id}` : `AI: ${result.model}` };
      } catch (e) {
        log(`AI deep audit of ${imageName} failed: ${e.message}`, "AI");
        return { findings: local, note: `AI deep audit unavailable (${e.message}). Showing the instant rule checks only.` };
      }
    },
    [policy, policyDoc, company, log],
  );

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
      setVisualImages([]);
      setVideos([]);
      setImprovements([]);
      setCurrentSubId(null);
      setCreatorView("workspace");
      setDrawerOpen(false);
    },
    [setCreatorView],
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

  const onStart = ({ html, source: src, policyDoc: pd }) => {
    setPolicyDoc(pd || null);
    openDocument(html, src);
    log(src.type === "upload" ? `Uploaded ${src.name}` : src.type === "sample" ? "Loaded the sample service proposal" : "Opened the text editor");
    log(pd ? `Checking against uploaded policy "${pd.name}"` : "Checking against PUBLIVRA built-in rules");
  };

  const changePolicy = (doc) => {
    setPolicyDoc(doc);
    const found = derivePolicy(doc?.text).detected.length;
    log(doc ? `Policy set to "${doc.name}" (${found} rule(s) applied live)` : "Policy removed - using built-in rules");
    toast(doc ? `Now checking against ${doc.name}.${found ? ` ${found} rule(s) applied live.` : ""} Run the AI audit for a full check.` : "Using PUBLIVRA built-in rules.", "success");
  };
  const newAudit = () => {
    setMode(null);
    setSource(null);
    setAnalysis(null);
    setText("");
    setDismissed({});
    setAi({ status: "idle", result: null, error: null, textAtRun: "" });
    setActivePubId(null);
    setVisualImages([]);
    setVideos([]);
    setImprovements([]);
    setCurrentSubId(null);
    setCreatorView("workspace");
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
    addImprovement(`${f.clause}: "${f.suggestion.find.trim()}" → "${f.suggestion.replace || "removed"}"`);
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
    list.slice(0, 40).forEach((f) => addImprovement(`${f.clause}: "${f.suggestion.find.trim()}" → "${f.suggestion.replace || "removed"}"`));
    toast(`${applied} fix${applied === 1 ? "" : "es"} applied. Re-scanning…`, "success");
  };

  const onManualEdit = (f, draft) => {
    const ok = replaceInEditor(editorRef.current, f.sentence, f.sentence, draft.trim());
    if (!ok) return toast("Couldn't find that sentence - it may already have been edited.");
    syncFromEditor();
    log(`Manually rewrote a flagged sentence (${f.clause})`);
    addImprovement(`Rewrote a flagged sentence (${f.clause}): "${draft.trim().slice(0, 140)}"`);
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
  // Ready to send = content is checked. Publishing additionally needs manager + legal approval of THIS version.
  const canSend = !!(mode && analysis && !scanning && text.trim().length > 0);
  const approved = !!(currentSub && currentSub.status === "approved" && currentSub.text === text);
  const canPublish = canSend && approved;
  const onPublish = () => {
    if (!canPublish) {
      toast("Publishing is locked. Send the content to your manager; it unlocks once the manager and legal approver approve it.");
      return;
    }
    setCreatorView("workspace");
    setModal("ready");
    log(`Clicked Publish (approved, ${risk.level} RISK)`);
  };

  const sendSummary = risk
    ? {
        title,
        risk,
        ai: ai.result ? { model: ai.result.model } : null,
        aiStale: !!ai.result && text !== ai.textAtRun,
        visual: {
          images: visualImages.length,
          videos: videos.length,
          contradicted: visualFindings.filter((f) => f.verdict === "CONTRADICTED" && !dismissed[f.id]).length,
          unverified: visualFindings.filter((f) => f.verdict === "UNVERIFIED" && !dismissed[f.id]).length,
        },
        improvements: improvements.length,
        overrides: Object.keys(dismissed).length,
      }
    : null;

  const sendToManager = ({ name, note }) => {
    saveName("creator", name);
    const open = (merged?.findings ?? []).filter((f) => f.verdict !== "VERIFIED" && !dismissed[f.id]);
    const allFindings = [...(merged?.findings ?? []), ...visualFindings];
    const payload = {
      title,
      company: company.trim(),
      text,
      risk: { level: risk.level, score: risk.score, counts: risk.counts, reasons: risk.reasons },
      tone: merged?.tone ? { score: merged.tone.score, profile: merged.tone.profile } : null,
      ai: ai.result
        ? { model: ai.result.model, auditId: ai.result.audit_id ?? null, counts: ai.result.counts, stale: text !== ai.textAtRun, ranAt: ai.ranAt || Date.now() }
        : null,
      findings: open.slice(0, 40).map((f) => ({
        verdict: f.verdict,
        severity: f.severity,
        category: f.category,
        match: String(f.match || "").slice(0, 160),
        explanation: String(f.explanation || "").slice(0, 400),
      })),
      improvements: [...improvements],
      overrides: allFindings
        .filter((f) => dismissed[f.id])
        .map((f) => ({ verdict: f.verdict, match: String(f.match || "").slice(0, 120), reason: dismissed[f.id] })),
      visual: visualImages.length || videos.length
        ? {
            videos: videos.map((v) => ({
              name: v.name,
              duration: v.duration,
              poster: v.poster,
              findings: v.findings.filter((f) => !dismissed[f.id]).map(({ id, time, verdict, severity, category, match, explanation, recommendation }) => ({ id, time, verdict, severity, category, match, explanation, recommendation })),
            })),
            images: visualImages.map((i) => ({
              name: i.name,
              thumb: i.thumb,
              findings: i.findings.filter((f) => !dismissed[f.id]).map(({ id, verdict, severity, category, match, explanation, recommendation }) => ({ id, verdict, severity, category, match, explanation, recommendation })),
              adFindings: (i.adFindings || []).filter((f) => !dismissed[f.id]).map(({ id, verdict, severity, category, match, explanation }) => ({ id, verdict, severity, category, match, explanation })),
            })),
          }
        : null,
      policyName: policyDoc ? `${policyDoc.name} + PUBLIVRA built-in rules` : policy.name,
    };
    const resubmit = !!currentSub;
    const id = submitToManager({ id: currentSub?.id, creatorName: name, note, payload });
    setCurrentSubId(id);
    setSendOpen(false);
    log(`${resubmit ? "Re-submitted" : "Sent"} "${title}" to the manager for approval${note ? ` - note: ${note}` : ""}`);
    api.logEvent({ actor: name, action: resubmit ? "resubmit_to_manager" : "send_to_manager", detail: `${title} (risk ${risk.level} ${risk.score}/100)`, audit_id: ai.result?.audit_id ?? null });
    toast(`${resubmit ? "Re-submitted" : "Sent"} to the manager. Publishing unlocks once it is approved.`, "success");
  };

  // Creator notifications when a reviewer decides
  const lastStatus = useRef({});
  useEffect(() => {
    if (!currentSub) return;
    const prev = lastStatus.current[currentSub.id];
    lastStatus.current[currentSub.id] = currentSub.status;
    if (!prev || prev === currentSub.status) return;
    if (currentSub.status === "approved") toast("Approved! Ready to Publish - the Publish & sign-off button is unlocked.", "success");
    if (currentSub.status === "rejected")
      toast(`Changes requested by the ${currentSub.rejection?.role === "legal" ? "legal approver" : "manager"}: ${currentSub.rejection?.reason}`, "danger");
    if (currentSub.status === "pending_legal") toast("Your manager approved and forwarded it to the legal approver.");
  }, [currentSub, toast]);
  useEffect(() => {
    if (role === "creator" && view === "workspace" && currentSub && !currentSub.seenByCreator) markSeen(currentSub.id);
  }, [role, view, currentSub]);

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
      policyName: policyDoc ? `${policyDoc.name} + PUBLIVRA built-in rules` : policy.name,
      overridden,
      publishedAt: at,
      sourceLabel: source?.type === "upload" ? `${source.kind} upload - ${source.name}` : "PUBLIVRA inbuilt editor",
      approvals: currentSub
        ? currentSub.authority === "dual"
          ? `Approved by ${currentSub.approvals.manager?.name} as manager and legal approver (version ${currentSub.version}).`
          : `Approved by manager ${currentSub.approvals.manager?.name} and legal approver ${currentSub.approvals.legal?.name} (version ${currentSub.version}).`
        : null,
    });
    const name = `${slugify(fileName)}.pdf`;
    downloadBlob(blob, name);
    const pub = { id: nextId("pub"), title, fileName: name, at, risk, overridden, status: "pending", serverId: null, subId: currentSub?.id ?? null };
    if (currentSub) markPublished(currentSub.id, { fileName: name, creatorName: currentSub.creatorName });
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
        // final state after the creator's fixes -> the "after publication" chart
        findings: [...merged.findings, ...visualFindings].filter((f) => f.verdict !== "VERIFIED" && !dismissed[f.id]).map(toServerFinding),
        tone_score: merged.tone?.score != null ? Math.round(merged.tone.score) : null,
        company: company.trim(),
      })
      .then((r) => {
        if (r?.id) {
          setPublications((ps) => ps.map((p) => (p.id === pub.id ? { ...p, serverId: r.id } : p)));
          log(`Publication logged to Neon as record #${r.id}`, "AI");
        } else log("Publication kept locally (database not reachable)", "AI");
      })
      .catch((e) => log(`Publication kept locally - ${e.message}`, "AI"));
    setCreatorView("verification");
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
    if (activePub.subId) markSignedOff(activePub.subId, { name: approver.name, role: approver.role });
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
  const roleBadges = {
    creator: workflow.submissions.filter((s) => !s.seenByCreator).length,
    manager: workflow.submissions.filter((s) => s.status === "pending_manager").length,
    legal: workflow.submissions.filter((s) => s.status === "pending_legal").length,
  };
  const navBadges = { verification: pendingCount, approvals: roleBadges.manager, legal: roleBadges.legal, workspace: roleBadges.creator };

  return (
    <>
    <NetworkNotice />
    {!session && <LoginScreen key={loginPrefill?.company || "new"} initial={loginPrefill} onLogin={onLogin} pendingFor={pendingFor} />}
    <div className={session ? "min-h-full" : "hidden"} aria-hidden={!session}>
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
        role={role}
        session={session || { company: "", email: "", role }}
        onSwitchAccount={switchAccount}
        onLogout={logout}
        roleBadges={roleBadges}
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={(v) => {
          setView(v);
          setDrawerOpen(false);
        }}
        badges={navBadges}
        onNewDocument={newAudit}
        policyName={policyDoc ? policyDoc.name : "PUBLIVRA built-in rules"}
        role={role}
        session={session || { company: "", email: "", role }}
        onSwitchAccount={switchAccount}
        onLogout={logout}
      />

      <main className="mx-auto max-w-[1600px] px-3 py-5 sm:px-5">
        {/* Workspace stays mounted so the document survives navigation. */}
        <div className={role === "creator" && view === "workspace" ? "" : "hidden"}>
          {!mode ? (
            <StartScreen onStart={onStart} toast={toast} currentPolicy={policyDoc} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button onClick={newAudit} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">
                  <ArrowLeft className="h-3.5 w-3.5" /> Start over
                </button>
                <Stepper current={step} />
              </div>

              <ApprovalNotice submission={currentSub} text={text} onGoToSignoff={() => setCreatorView("verification")} />
              {risk ? (
                <RiskBanner
                  risk={risk}
                  scanning={scanning}
                  extraCounts={
                    visualImages.length || videos.length
                      ? [visualImages.length && `${visualImages.length} audited image${visualImages.length === 1 ? "" : "s"}`, videos.length && `${videos.length} audited video${videos.length === 1 ? "" : "s"}`]
                          .filter(Boolean)
                          .join(" and ")
                      : null
                  }
                  actions={<ApprovalActions submission={currentSub} text={text} canSend={canSend} onPublish={onPublish} onSend={() => setSendOpen(true)} />}
                />
              ) : (
                <div className="h-[104px] animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
              )}

              {risk && (
                <TopIssues
                  groups={issueGroups}
                  onReview={(group) => setPanelFocus({ tab: "suggestions", group, n: Date.now() })}
                  onFixGroup={(g) => onAcceptAll(g.items.filter((f) => f.suggestion))}
                />
              )}

              <PolicyBar
                source={source}
                policyDoc={policyDoc}
                detected={policyInfo.detected}
                onPolicy={changePolicy}
                onRemovePolicy={() => changePolicy(null)}
                onReplaceContent={() => replaceInputRef.current?.click()}
                onViewPolicy={() => openPolicyRef(null)}
                toast={toast}
              />

              <VisualAudit
                policyText={policyDoc?.text || ""}
                images={visualImages}
                videos={videos}
                onVideosChange={setVideos}
                onImagesChange={setVisualImages}
                onAuditAdText={runAdTextAudit}
                toast={toast}
                log={log}
              />

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
                  policyName={policyDoc ? policyDoc.name : "PUBLIVRA built-in rules"}
                  focus={panelFocus}
                  onOpenRef={openPolicyRef}
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

        {role === "creator" && view === "verification" && (
          <HumanVerification
            publication={activePub}
            onClose={closePublication}
            onRedownload={redownload}
            onNewDocument={newAudit}
            onGoToWorkspace={() => setView("workspace")}
          />
        )}
        {(role === "manager" || role === "legal") && (view === "approvals" || view === "legal") && <ReviewPanel role={role} workflow={workflow} toast={toast} />}
        {view === "insights" && <Insights company={company} />}
        {view === "history" && (
          <div className="mx-auto max-w-6xl space-y-6">
            <SignoffLog workflow={workflow} />
            {role !== "legal" && (
          <AuditTrail
            publications={publications}
            activity={activity}
            engine={engine}
            onOpenVerification={(id) => {
              setActivePubId(id);
              setView("verification");
            }}
          />
            )}
          </div>
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
      <SendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onConfirm={sendToManager}
        summary={sendSummary}
        defaultName={currentSub?.creatorName || loadName("creator") || session?.email || ""}
        resubmit={!!currentSub}
      />
      <PolicyViewer open={!!viewer} onClose={() => setViewer(null)} doc={viewer?.doc} target={viewer?.target} />
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
    </>
  );
}
