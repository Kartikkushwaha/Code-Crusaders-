import { useEffect, useState } from "react";
import { BadgeCheck, CircleCheck, CircleX, Clock3, Download, Lock, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, Modal } from "./ui.jsx";
import { STATUS, timeAgo } from "../lib/workflow.js";

const TONE = {
  info: "border-slate-700 bg-slate-900/70 text-slate-200",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-100",
  emerald: "border-emerald-500/50 bg-emerald-500/10 text-emerald-100",
  rose: "border-rose-500/50 bg-rose-500/10 text-rose-100",
  indigo: "border-indigo-500/40 bg-indigo-500/10 text-indigo-100",
};

export function approvalState(sub, text) {
  if (!sub) return { key: "none", changed: false };
  const changed = sub.text !== text;
  return { key: sub.status, changed };
}

/** Notification banner at the top of the Creator workspace. */
export function ApprovalNotice({ submission: s, text, onGoToSignoff }) {
  const { key, changed } = approvalState(s, text);
  let tone = "info";
  let Icon = Lock;
  let title = "Publishing is locked until your content is approved";
  let body = "Fix the issues, run the AI deep audit, then send it to your manager. Publishing unlocks once the manager (and the legal approver) approve it.";
  let extra = null;

  if (key === "pending_manager" || key === "pending_legal") {
    tone = key === "pending_manager" ? "amber" : "sky";
    Icon = Clock3;
    title = key === "pending_manager" ? `Sent to manager - waiting for a decision (version ${s.version})` : `Manager approved - waiting for the legal approver (version ${s.version})`;
    body =
      key === "pending_legal"
        ? `${s.approvals.manager?.name || "The manager"} approved ${timeAgo(s.approvals.manager?.at || s.updatedAt)} and forwarded it to legal.`
        : `Sent ${timeAgo(s.updatedAt)}. You will be notified here when it is approved or changes are requested.`;
    if (changed) extra = <p className="mt-1.5 text-xs font-semibold text-amber-200">You edited the content after sending it. Re-send so the reviewers see the latest version.</p>;
  } else if (key === "rejected") {
    tone = "rose";
    Icon = CircleX;
    const r = s.rejection;
    title = `Changes requested by the ${r.role === "legal" ? "legal approver" : "manager"}${r.name ? ` (${r.name})` : ""}`;
    body = "Edit the content as requested below, then re-submit it to your manager.";
    extra = (
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-500/30 bg-slate-950/40 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">Reason</div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-100">{r.reason}</p>
        </div>
        <div className="rounded-lg border border-rose-500/30 bg-slate-950/40 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">Required improvements</div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-100">{r.improvements || "See the reason."}</p>
        </div>
      </div>
    );
  } else if (key === "approved") {
    if (changed) {
      tone = "amber";
      Icon = TriangleAlert;
      title = "Content changed after approval - publishing locked again";
      body = "The approval covers the version the reviewers saw. Re-submit your changes, or undo them, to publish.";
    } else {
      tone = "emerald";
      Icon = CircleCheck;
      title = "Ready to Publish";
      const m = s.approvals.manager;
      const l = s.approvals.legal;
      body =
        s.authority === "dual"
          ? `${m?.name || "Your manager"} approved as manager and legal approver. Publish & sign off is now unlocked.`
          : `Approved by ${m?.name || "the manager"} and legal approver ${l?.name || ""}. Publish & sign off is now unlocked.`;
      const notes = [m?.note, s.authority !== "dual" && l?.note].filter(Boolean);
      if (notes.length) extra = <p className="mt-1.5 text-xs text-emerald-200/90">Reviewer notes: {notes.join(" · ")}</p>;
    }
  } else if (key === "published") {
    tone = "indigo";
    Icon = BadgeCheck;
    title = "Published - complete the sign-off";
    body = `${s.publication?.fileName} was downloaded. Finish the human verification checklist to close this project.`;
    extra = (
      <button onClick={onGoToSignoff} className="mt-1.5 text-xs font-semibold text-indigo-200 underline-offset-2 hover:underline">
        Go to sign-off →
      </button>
    );
  } else if (key === "closed") {
    tone = "info";
    Icon = ShieldCheck;
    title = "Published and signed off";
    body = `Signed off by ${s.signoff?.name} (${s.signoff?.role}) ${timeAgo(s.signoff?.at || s.updatedAt)}.`;
  }

  return (
    <section className={`fade-in flex gap-3 rounded-2xl border p-4 ${TONE[tone]}`} role="status" aria-live="polite" aria-label="Approval status">
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{title}</div>
        <p className="mt-0.5 text-xs opacity-90">{body}</p>
        {extra}
      </div>
      {s && <span className="hidden h-fit shrink-0 rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold opacity-80 sm:inline">{STATUS[s.status]?.label}</span>}
    </section>
  );
}

/** Publish (locked until approved) with "Send to Manager" directly below it. */
export function ApprovalActions({ submission: s, text, canSend, onPublish, onSend }) {
  const { key, changed } = approvalState(s, text);
  const unlocked = key === "approved" && !changed;
  let sendLabel = "Send to Manager";
  let sendDisabled = !canSend;
  if (key === "rejected") sendLabel = "Re-submit to Manager";
  else if (key === "pending_manager" || key === "pending_legal") {
    sendLabel = changed ? "Re-send latest version" : "Sent - awaiting decision";
    sendDisabled = !canSend || !changed;
  } else if (key === "approved") {
    sendLabel = changed ? "Re-submit changes" : "Approved";
    sendDisabled = !canSend || !changed;
  } else if (key === "published" || key === "closed") {
    sendLabel = "Already published";
    sendDisabled = true;
  }
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-52">
      <Button
        variant={unlocked ? "success" : "secondary"}
        onClick={onPublish}
        disabled={!unlocked}
        className="w-full"
        title={unlocked ? "Publish, download the PDF and sign off" : "Locked until the manager and legal approver approve this version"}
      >
        {unlocked ? <Download className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        {unlocked ? "Publish & download PDF" : "Publish locked"}
      </Button>
      <Button variant="primary" onClick={onSend} disabled={sendDisabled} className="w-full">
        <Send className="h-4 w-4" /> {sendLabel}
      </Button>
    </div>
  );
}

function Row({ ok, warn, children }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {ok ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <TriangleAlert className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${warn ? "text-amber-400" : "text-rose-400"}`} />}
      <span className="text-slate-300">{children}</span>
    </li>
  );
}

/** Confirm what goes to the manager. */
export function SendModal({ open, onClose, onConfirm, summary, defaultName, resubmit }) {
  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setNote("");
    }
  }, [open, defaultName]);
  if (!summary) return null;
  const { risk, ai, aiStale, visual, improvements, overrides, title } = summary;
  return (
    <Modal open={open} onClose={onClose} labelledBy="send-title">
      <div className="p-6">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/15">
          <Send className="h-6 w-6 text-indigo-300" />
        </div>
        <h2 id="send-title" className="mt-3 text-xl font-extrabold tracking-tight">
          {resubmit ? "Re-submit to Manager" : "Send to Manager"}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          “{title}” goes to the Manager panel with the full content, the fixes you applied, the visual audit and the AI score.
        </p>
        <ul className="mt-4 space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <Row ok={risk.level === "LOW"} warn={risk.level === "MEDIUM"}>
            Risk {risk.level} ({risk.score}/100) · {risk.counts.contradicted} contradicted · {risk.counts.unverified} unverified
          </Row>
          <Row ok={!!ai && !aiStale} warn>
            {ai ? `AI deep audit by ${ai.model}${aiStale ? " - out of date, the content changed after it ran" : ""}` : "AI deep audit not run - the manager will see this"}
          </Row>
          <Row ok={visual.images + (visual.videos || 0) > 0 && visual.contradicted === 0} warn>
            {visual.images || visual.videos
              ? `Visual audit: ${[visual.images && `${visual.images} image(s)`, visual.videos && `${visual.videos} video(s)`].filter(Boolean).join(" + ")}, ${visual.contradicted} contradicted, ${visual.unverified} unverified`
              : "No images or videos audited"}
          </Row>
          <Row ok warn>
            {improvements} fix{improvements === 1 ? "" : "es"} applied{overrides ? ` · ${overrides} finding(s) overridden with a reason` : ""}
          </Row>
        </ul>
        <label className="mt-4 block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ishnoordeep Kaur"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Note to the manager (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={resubmit ? "What did you change after the feedback?" : "Anything the reviewers should know"}
            className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!name.trim()} onClick={() => onConfirm({ name: name.trim(), note: note.trim() })}>
            <Send className="h-4 w-4" /> {resubmit ? "Re-submit" : "Send"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
