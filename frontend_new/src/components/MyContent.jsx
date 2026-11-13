import { ArrowRight, FolderOpen } from "lucide-react";
import { timeAgo } from "../lib/workflow.js";
import { StatusChip } from "./ReviewPanel.jsx";

const ACTION = {
  draft: "Open to edit",
  rejected: "Open to revise",
  approved: "Open to publish",
  pending_manager: "View",
  pending_legal: "View",
  published: "View",
  closed: "View",
};

function lastWord(s) {
  if (s.status === "rejected" && s.rejection) {
    const who = s.rejection.role === "legal" ? "Legal approver" : "Manager";
    return `${who}${s.rejection.name ? ` ${s.rejection.name}` : ""}: “${[s.rejection.reason, s.rejection.improvements].filter(Boolean).join(" · ")}”`;
  }
  if (s.status === "approved") {
    const note = s.approvals.legal?.note || s.approvals.manager?.note;
    return `Approved${s.approvals.legal?.by === "legal" ? " by manager and legal approver" : " by the manager"}${note ? `: “${note}”` : ""}. Ready to publish.`;
  }
  if (s.status === "pending_legal") return `Manager ${s.approvals.manager?.name || ""} approved it; waiting for the legal approver.`;
  if (s.status === "pending_manager") return "Waiting for the manager's decision.";
  if (s.status === "published") return `Published${s.publication?.fileName ? ` as ${s.publication.fileName}` : ""}. Sign-off pending.`;
  if (s.status === "closed") return "Published and signed off.";
  return "Saved, not sent yet.";
}

/**
 * Creator start screen: the content already sent for approval, with its status and the reviewers'
 * comments. Signing out and back in never hides it; "Open" loads it into the editor.
 */
export default function MyContent({ submissions, onOpen }) {
  if (!submissions.length) return null;
  const list = [...submissions].sort((a, b) => Number(a.seenByCreator) - Number(b.seenByCreator) || b.updatedAt - a.updatedAt).slice(0, 8);
  const fresh = submissions.filter((s) => !s.seenByCreator).length;
  return (
    <section className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4" aria-label="Your content">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FolderOpen className="h-4 w-4 text-indigo-300" />
        <h2 className="text-sm font-semibold text-white">Your content</h2>
        {fresh > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{fresh} new decision{fresh === 1 ? "" : "s"}</span>}
        <span className="ml-auto text-[11px] text-slate-400">Open an item to see it, revise it or publish it. Or start a new check below.</span>
      </div>
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className={`flex flex-wrap items-center gap-3 rounded-xl border bg-slate-900/70 p-3 ${s.seenByCreator ? "border-slate-800" : "border-rose-500/50"}`}>
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-semibold text-slate-100">{s.title}</span>
                <StatusChip status={s.status} />
                {!s.seenByCreator && <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300">New</span>}
              </div>
              <p className="mt-1 break-words text-xs text-slate-400">{lastWord(s)}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Version {s.version} · updated {timeAgo(s.updatedAt)} · risk {s.risk.level} ({s.risk.score}/100)
              </p>
            </div>
            <button
              onClick={() => onOpen(s)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/20"
            >
              {ACTION[s.status] || "Open"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
