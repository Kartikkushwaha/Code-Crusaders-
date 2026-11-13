/**
 * Approval workflow (Creator -> Manager -> optional Legal approver -> publish), stored in the database.
 *
 * The backend (/api/workflow) owns the state and enforces every rule: who may decide, which company
 * the content belongs to, and that only approved content is published. This module keeps a local copy
 * for the panels, refreshes it every few seconds, and maps server records to the "submission" shape
 * the panels use. Reviewers on other devices see the same data.
 *
 * Server status      -> panel status
 *   draft            -> draft
 *   pending_manager  -> pending_manager
 *   pending_legal    -> pending_legal
 *   approved         -> approved
 *   rejected / changes_requested -> rejected (with the reviewer's comments)
 *   published        -> published, or closed once the human sign-off is done
 */
import { useSyncExternalStore } from "react";
import { api } from "./api.js";

const SYNC_MS = 12000;
const SEEN_KEY = "publivra.workflow.seen.v2";
const LOCAL_KEY = "publivra.workflow.local.v2"; // per content id: { publication, signoff }

export const ROLES = {
  creator: { id: "creator", label: "Creator", panel: "Creator panel" },
  manager: { id: "manager", label: "Manager", panel: "Manager panel" },
  legal: { id: "legal", label: "Legal approver", panel: "Legal approver panel" },
};

export const STATUS = {
  draft: { label: "Draft - not sent", tone: "slate" },
  pending_manager: { label: "Waiting for manager", tone: "amber" },
  pending_legal: { label: "Waiting for legal approver", tone: "sky" },
  approved: { label: "Approved - ready to publish", tone: "emerald" },
  rejected: { label: "Changes requested", tone: "rose" },
  published: { label: "Published - awaiting sign-off", tone: "indigo" },
  closed: { label: "Published & signed off", tone: "slate" },
};

const DEFAULT_RISK = { level: "LOW", score: 0, counts: { verified: 0, unverified: 0, contradicted: 0, high: 0 }, reasons: [] };
const REQUIRED = "\n\nRequired changes: ";

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

let state = { submissions: [], loaded: false, error: null };
let items = []; // last server response
let context = { company: "" };
let timer = null;
const listeners = new Set();

function publish(next) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const EMPTY = { submissions: [], loaded: false, error: null };

/** React hook: the live workflow state, shared by every panel. */
export function useWorkflow() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export function getSubmission(id) {
  return state.submissions.find((s) => s.id === id) || null;
}

const uiRole = (r) => (r === "legal_approver" ? "legal" : r);
const entry = (at, role, name, action, detail = "") => ({ at, role, name, action, detail });

/** One server content record -> the submission shape used by the panels. */
export function toSubmission(item, { company = "" } = {}, seen = {}, local = {}) {
  const audit = item.audit || {};
  const payload = audit.payload || {};
  const created = Date.parse(item.created_at);
  const updated = Date.parse(item.updated_at);
  const returned = item.status === "rejected" || item.status === "changes_requested";

  let approvals = { manager: null, legal: null };
  let authority = null;
  let rejection = null;
  let lastRejection = null;
  const history = (audit.submits || []).map((s) =>
    entry(s.at, "creator", item.creator.full_name, s.version > 1 ? `Re-submitted version ${s.version}` : "Sent to manager for approval", [s.note, s.risk && `risk ${s.risk.level} (${s.risk.score}/100)`].filter(Boolean).join(" · ")),
  );
  if (!history.length) history.push(entry(created, "creator", item.creator.full_name, "Created"));

  for (const r of item.approvals || []) {
    const at = Date.parse(r.created_at);
    const role = uiRole(r.reviewer_role);
    const name = r.reviewer.full_name;
    const who = role === "legal" ? "legal approver" : "manager";
    if (r.decision === "rejected" || r.decision === "changes_requested") {
      const [reason, improvements = ""] = r.comments.split(REQUIRED);
      lastRejection = rejection || lastRejection;
      rejection = { role, name, reason, improvements, at, kind: r.decision };
      approvals = { manager: null, legal: null };
      authority = null;
      history.push(entry(at, role, name, r.decision === "rejected" ? `Rejected by ${who}` : `Changes requested by ${who}`, r.comments.replace(REQUIRED, " · Required: ")));
      continue;
    }
    if (rejection) {
      lastRejection = rejection;
      rejection = null;
    }
    const mark = { name, at, note: r.comments };
    if (r.decision === "sent_to_legal") {
      approvals = { manager: mark, legal: null };
      authority = "separate";
      history.push(entry(at, role, name, "Approved by manager, forwarded to legal approver", r.comments));
    } else if (role === "manager") {
      approvals = { manager: mark, legal: { ...mark, by: "manager" } };
      authority = "dual";
      history.push(entry(at, role, name, "Approved by manager (legal review not required)", r.comments || "Publishing unlocked"));
    } else {
      approvals = { ...approvals, legal: { ...mark, by: "legal" } };
      history.push(entry(at, role, name, "Approved by legal approver", r.comments || "Publishing unlocked"));
    }
  }
  if (!returned && rejection) {
    lastRejection = rejection;
    rejection = null;
  }

  const mine = local[item.content_id] || {};
  let status = returned ? "rejected" : item.status;
  let publication = null;
  if (item.status === "published") {
    publication = mine.publication || { fileName: "the PDF", at: updated };
    history.push(entry(publication.at, "creator", item.creator.full_name, "Published", mine.publication ? `Downloaded ${publication.fileName}` : ""));
    if (mine.signoff) {
      status = "closed";
      history.push(entry(mine.signoff.at, "creator", mine.signoff.name, "Signed off", `${mine.signoff.name} (${mine.signoff.role}) completed the human verification checklist`));
    }
  }
  history.sort((a, b) => a.at - b.at);

  return {
    id: item.content_id,
    createdAt: created,
    updatedAt: updated,
    version: audit.version || 1,
    status,
    serverStatus: item.status,
    creatorName: item.creator.full_name,
    creatorId: item.creator.user_id,
    note: audit.note || "",
    title: item.title,
    company,
    text: item.body,
    risk: payload.risk || DEFAULT_RISK,
    tone: payload.tone || null,
    ai: payload.ai || null,
    findings: payload.findings || [],
    improvements: payload.improvements || [],
    overrides: payload.overrides || [],
    visual: payload.visual || null,
    policyName: payload.policyName || "",
    // true when the audit summary was not stored (migration 002 not run): only title and text are known
    summaryMissing: !item.audit,
    submits: audit.submits || [],
    authority,
    approvals,
    rejection,
    lastRejection,
    publication,
    signoff: mine.signoff || null,
    seenByCreator: seen[item.content_id] === item.updated_at,
    serverUpdatedAt: item.updated_at,
    history,
  };
}

function remap() {
  const seen = readJson(SEEN_KEY);
  const local = readJson(LOCAL_KEY);
  publish({ submissions: items.map((i) => toSubmission(i, context, seen, local)) });
}

/** Load the company's content from the server (what this role is allowed to see). */
export async function refreshWorkflow() {
  try {
    const res = await api.workflow.list();
    items = res.items || [];
    state = { ...state, loaded: true, error: null };
    remap();
  } catch (e) {
    if (e.status !== 401) publish({ error: e.message });
  }
}

/** Start syncing after sign-in. Returns a function that stops it (call it on sign-out). */
export function startWorkflowSync({ company }) {
  stopWorkflowSync();
  context = { company };
  refreshWorkflow();
  timer = setInterval(() => document.visibilityState === "visible" && refreshWorkflow(), SYNC_MS);
  window.addEventListener("focus", refreshWorkflow);
  return stopWorkflowSync;
}

export function stopWorkflowSync() {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener("focus", refreshWorkflow);
  items = [];
  publish({ submissions: [], loaded: false, error: null });
}

function upsert(item) {
  items = [item, ...items.filter((i) => i.content_id !== item.content_id)];
  remap();
}

// ------------------------------------------------------------------ creator
/** Drop image thumbnails / video posters if the summary would be too large to store. */
function fit(audit) {
  if (JSON.stringify(audit).length < 550_000 || !audit.payload?.visual) return audit;
  const v = audit.payload.visual;
  return {
    ...audit,
    payload: { ...audit.payload, visual: { ...v, images: (v.images || []).map(({ thumb, ...i }) => i), videos: (v.videos || []).map(({ poster, ...x }) => x) } },
  };
}

/**
 * Send (or re-send) a document to the manager: saves the content, then submits it.
 * payload: { title, company, text, risk, tone, ai, findings, improvements, overrides, visual, policyName }
 * Resolves to the content id. Rejects with the server's reason (err.contentId is set if a draft was saved).
 */
export async function submitToManager({ id, note, payload }) {
  const prev = id ? getSubmission(id) : null;
  if (prev && (prev.serverStatus === "pending_manager" || prev.serverStatus === "pending_legal"))
    throw new Error("This content is already with the reviewers. You can send a new version after their decision.");
  const { title, text, company: _company, ...summary } = payload;
  const version = prev ? prev.version + (prev.submits.length ? 1 : 0) : 1;
  const audit = fit({
    payload: summary,
    note: note || "",
    version,
    submits: [...(prev?.submits || []), { at: Date.now(), version, note: note || "", risk: { level: payload.risk.level, score: payload.risk.score } }].slice(-20),
  });
  const body = { title, body: text, audit };
  const saved = prev ? await api.workflow.update(prev.id, body) : await api.workflow.create(body);
  upsert(saved);
  try {
    const submitted = await api.workflow.submit(saved.content_id);
    markSeenAt(submitted.content_id, submitted.updated_at);
    upsert(submitted);
    return submitted.content_id;
  } catch (e) {
    e.contentId = saved.content_id;
    throw e;
  }
}

function markSeenAt(id, updatedAt) {
  writeJson(SEEN_KEY, { ...readJson(SEEN_KEY), [id]: updatedAt });
}

export function markSeen(id) {
  const s = getSubmission(id);
  if (s && !s.seenByCreator) {
    markSeenAt(id, s.serverUpdatedAt);
    remap();
  }
}

/** Publish on the server first: it refuses anything that is not approved. Then remember the file name. */
export async function markPublished(id, { fileName }) {
  const item = await api.workflow.publish(id);
  const local = readJson(LOCAL_KEY);
  writeJson(LOCAL_KEY, { ...local, [id]: { ...local[id], publication: { fileName, at: Date.now() } } });
  markSeenAt(id, item.updated_at);
  upsert(item);
  return item;
}

/** The human sign-off checklist is recorded with the publication (see /api/publications); this marks it done here. */
export function markSignedOff(id, { name, role }) {
  const local = readJson(LOCAL_KEY);
  writeJson(LOCAL_KEY, { ...local, [id]: { ...local[id], signoff: { name, role, at: Date.now() } } });
  remap();
}

// ---------------------------------------------------------------- reviewers
const comments = ({ note, reason, improvements }) => (improvements ? `${reason}${REQUIRED}${improvements}` : reason || note || "");

/**
 * action: "approve_dual" - manager approves directly (legal review not needed) -> approved
 *         "forward"      - manager sends it to the legal approver -> pending_legal
 *         "reject"       - back to the creator: "changes_requested" when improvements are listed, else "rejected"
 */
export async function managerDecision(id, { action, note, reason, improvements }) {
  const decision = action === "approve_dual" ? "approved" : action === "forward" ? "sent_to_legal" : improvements ? "changes_requested" : "rejected";
  upsert(await api.workflow.managerReview(id, { decision, comments: action === "reject" ? comments({ reason, improvements }) : note || "" }));
}

export async function legalDecision(id, { action, note, reason, improvements }) {
  const decision = action === "reject" ? (improvements ? "changes_requested" : "rejected") : "approved";
  upsert(await api.workflow.legalReview(id, { decision, comments: action === "reject" ? comments({ reason, improvements }) : note || "" }));
}

// -------------------------------------------------------------------- names
/** Remembered names per role, so the sign-off form doesn't need retyping. */
export function loadName(role) {
  try {
    return localStorage.getItem(`publivra.name.${role}`) || "";
  } catch {
    return "";
  }
}
export function saveName(role, name) {
  try {
    localStorage.setItem(`publivra.name.${role}`, name);
  } catch {
    /* ignore */
  }
}

export function timeAgo(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
