/**
 * Round 3 - shared approval workflow (Creator -> Manager -> Legal approver).
 *
 * All three panels read and write the same store in localStorage, so switching role
 * (or opening another tab in the same browser) shows the same submissions instantly.
 *
 * Submission status:
 *   pending_manager -> (manager rejects)            -> rejected
 *                   -> (manager ticks both boxes)   -> approved
 *                   -> (manager forwards)           -> pending_legal -> approved | rejected
 *   approved -> (creator publishes)  -> published -> (creator signs off) -> closed
 *   rejected -> (creator re-submits) -> pending_manager (version + 1)
 */
import { useSyncExternalStore } from "react";

const KEY = "publivra.workflow.v1";
const ROLE_KEY = "publivra.role";
const EVENT = "publivra:workflow";
const MAX_SUBMISSIONS = 60;

export const ROLES = {
  creator: { id: "creator", label: "Creator", panel: "Creator panel" },
  manager: { id: "manager", label: "Manager", panel: "Manager panel" },
  legal: { id: "legal", label: "Legal approver", panel: "Legal approver panel" },
};

export const STATUS = {
  pending_manager: { label: "Waiting for manager", tone: "amber" },
  pending_legal: { label: "Waiting for legal approver", tone: "sky" },
  approved: { label: "Approved - ready to publish", tone: "emerald" },
  rejected: { label: "Changes requested", tone: "rose" },
  published: { label: "Published - awaiting sign-off", tone: "indigo" },
  closed: { label: "Published & signed off", tone: "slate" },
};

const EMPTY = { submissions: [] };
let cache = null;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && Array.isArray(data.submissions) ? data : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getSnapshot() {
  if (cache === null) cache = read();
  return cache;
}

function write(next) {
  // keep the newest submissions if storage gets tight
  let data = { ...next, submissions: next.submissions.slice(0, MAX_SUBMISSIONS) };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      break;
    } catch {
      // quota: drop image thumbnails from older submissions, then old submissions
      data = {
        ...data,
        submissions: data.submissions
          .slice(0, Math.max(5, data.submissions.length - 10))
          .map((s, i) =>
            i < 3 || !s.visual
              ? s
              : { ...s, visual: { ...s.visual, images: (s.visual.images || []).map(({ thumb, ...img }) => img), videos: (s.visual.videos || []).map(({ poster, ...v }) => v) } },
          ),
      };
    }
  }
  cache = data;
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(fn) {
  const onStorage = (e) => {
    if (e.key === KEY || e.key === null) {
      cache = read();
      fn();
    }
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** React hook: the live workflow state, shared by every panel. */
export function useWorkflow() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function getSubmission(id) {
  return getSnapshot().submissions.find((s) => s.id === id) || null;
}

function update(id, fn) {
  const state = getSnapshot();
  let changed = null;
  const submissions = state.submissions.map((s) => {
    if (s.id !== id) return s;
    changed = { ...fn(s), updatedAt: Date.now() };
    return changed;
  });
  if (changed) write({ ...state, submissions });
  return changed;
}

const entry = (role, name, action, detail = "") => ({ at: Date.now(), role, name: name || ROLES[role]?.label || role, action, detail });
const newId = () => `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// ------------------------------------------------------------------ creator
/**
 * Send (or re-send) a document to the manager.
 * payload: { title, company, text, risk, tone, ai, findings, improvements, overrides, visual, policyName }
 */
export function submitToManager({ id, creatorName, note, payload }) {
  const state = getSnapshot();
  const existing = id ? state.submissions.find((s) => s.id === id) : null;
  const action = existing ? `Re-submitted version ${existing.version + 1}` : "Sent to manager for approval";
  const detail = [note, payload.ai ? `AI deep audit: ${payload.ai.counts.CONTRADICTED} contradicted, ${payload.ai.counts.UNVERIFIED} unverified` : "AI deep audit not run", `risk ${payload.risk.level} (${payload.risk.score}/100)`]
    .filter(Boolean)
    .join(" · ");
  if (existing) {
    update(existing.id, (s) => ({
      ...s,
      ...payload,
      creatorName: creatorName || s.creatorName,
      note: note || "",
      version: s.version + 1,
      status: "pending_manager",
      authority: null,
      approvals: { manager: null, legal: null },
      rejection: null,
      lastRejection: s.rejection || s.lastRejection || null,
      seenByCreator: true,
      history: [...s.history, entry("creator", creatorName, action, detail)],
    }));
    return existing.id;
  }
  const sub = {
    id: newId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    status: "pending_manager",
    creatorName: creatorName || "Creator",
    note: note || "",
    ...payload,
    authority: null,
    approvals: { manager: null, legal: null },
    rejection: null,
    lastRejection: null,
    publication: null,
    signoff: null,
    seenByCreator: true,
    history: [entry("creator", creatorName, action, detail)],
  };
  write({ ...state, submissions: [sub, ...state.submissions] });
  return sub.id;
}

export function markSeen(id) {
  const s = getSubmission(id);
  if (s && !s.seenByCreator) update(id, (x) => ({ ...x, seenByCreator: true }));
}

export function markPublished(id, { fileName, creatorName }) {
  return update(id, (s) => ({
    ...s,
    status: "published",
    publication: { fileName, at: Date.now() },
    history: [...s.history, entry("creator", creatorName || s.creatorName, "Published", `Downloaded ${fileName}`)],
  }));
}

export function markSignedOff(id, { name, role }) {
  return update(id, (s) => ({
    ...s,
    status: "closed",
    signoff: { name, role, at: Date.now() },
    history: [...s.history, entry("creator", name, "Signed off", `${name} (${role}) completed the human verification checklist`)],
  }));
}

// ------------------------------------------------------------------ manager
/**
 * action: "approve_dual"  - manager approves as manager AND legal approver -> approved
 *         "forward"       - manager approves, a separate legal approver must decide -> pending_legal
 *         "reject"        - back to the creator with a reason
 */
export function managerDecision(id, { action, name, note, reason, improvements }) {
  return update(id, (s) => {
    if (s.status !== "pending_manager") return s;
    const who = name || "Manager";
    if (action === "reject") {
      return {
        ...s,
        status: "rejected",
        rejection: { role: "manager", name: who, reason, improvements: improvements || "", at: Date.now() },
        seenByCreator: false,
        history: [...s.history, entry("manager", who, "Rejected by manager", [reason, improvements && `Required: ${improvements}`].filter(Boolean).join(" · "))],
      };
    }
    const manager = { name: who, at: Date.now(), note: note || "" };
    if (action === "approve_dual") {
      return {
        ...s,
        status: "approved",
        authority: "dual",
        approvals: { manager, legal: { ...manager, by: "manager" } },
        seenByCreator: false,
        history: [...s.history, entry("manager", who, "Approved as manager and legal approver", note || "Dual authority - publishing unlocked")],
      };
    }
    return {
      ...s,
      status: "pending_legal",
      authority: "separate",
      approvals: { manager, legal: null },
      history: [...s.history, entry("manager", who, "Approved by manager, forwarded to legal approver", note || "")],
    };
  });
}

// -------------------------------------------------------------------- legal
export function legalDecision(id, { action, name, note, reason, improvements }) {
  return update(id, (s) => {
    if (s.status !== "pending_legal") return s;
    const who = name || "Legal approver";
    if (action === "reject") {
      return {
        ...s,
        status: "rejected",
        rejection: { role: "legal", name: who, reason, improvements: improvements || "", at: Date.now() },
        seenByCreator: false,
        history: [...s.history, entry("legal", who, "Rejected by legal approver", [reason, improvements && `Required: ${improvements}`].filter(Boolean).join(" · "))],
      };
    }
    return {
      ...s,
      status: "approved",
      approvals: { ...s.approvals, legal: { name: who, at: Date.now(), note: note || "", by: "legal" } },
      seenByCreator: false,
      history: [...s.history, entry("legal", who, "Approved by legal approver", note || "Publishing unlocked")],
    };
  });
}

// -------------------------------------------------------------------- roles
export function loadRole() {
  try {
    const r = localStorage.getItem(ROLE_KEY);
    return ROLES[r] ? r : "creator";
  } catch {
    return "creator";
  }
}
export function saveRole(r) {
  try {
    localStorage.setItem(ROLE_KEY, r);
  } catch {
    /* ignore */
  }
}

/** Remembered names per role, so reviewers don't retype them. */
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
