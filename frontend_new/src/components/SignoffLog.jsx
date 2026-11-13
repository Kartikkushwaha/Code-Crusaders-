import { useState } from "react";
import { BadgeCheck, BriefcaseBusiness, ChevronDown, PenLine, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { RISK_STYLE } from "./ui.jsx";
import { timeAgo } from "../lib/workflow.js";
import { StatusChip } from "./ReviewPanel.jsx";

const ROLE_ICON = { creator: PenLine, manager: BriefcaseBusiness, legal: Scale };
const fmt = (at) => new Date(at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** Every step of one submission, oldest first. */
export default function SignoffTimeline({ sub }) {
  return (
    <ol className="relative space-y-3 border-l border-slate-800 pl-4">
      {sub.history.map((h, i) => {
        const Icon = ROLE_ICON[h.role] || ShieldCheck;
        const bad = /reject/i.test(h.action);
        const good = /approved|signed off|published/i.test(h.action);
        return (
          <li key={i} className="relative">
            <span
              className={`absolute -left-[25px] top-0.5 grid h-4 w-4 place-items-center rounded-full border ${
                bad ? "border-rose-500 bg-rose-950" : good ? "border-emerald-500 bg-emerald-950" : "border-slate-600 bg-slate-900"
              }`}
            >
              <Icon className={`h-2.5 w-2.5 ${bad ? "text-rose-300" : good ? "text-emerald-300" : "text-slate-400"}`} />
            </span>
            <div className="text-xs font-semibold text-slate-200">{h.action}</div>
            <div className="text-[11px] text-slate-500">
              {h.name} · {fmt(h.at)}
            </div>
            {h.detail && <p className="mt-0.5 break-words text-[11px] text-slate-400">{h.detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function Track({ icon: Icon, title, children }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">{children}</div>
    </div>
  );
}

const REOPENABLE = { draft: "Open in editor", rejected: "Open to revise", approved: "Open to publish" };

function Card({ s, onOpen, current }) {
  const [open, setOpen] = useState(false);
  const r = RISK_STYLE[s.risk.level];
  const m = s.approvals.manager;
  const l = s.approvals.legal;
  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/60">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 p-3 text-left">
        <span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-100">{s.title}</span>
        <span className="text-[11px] text-slate-500">
          v{s.version} · {s.creatorName} · {timeAgo(s.updatedAt)}
        </span>
        <StatusChip status={s.status} />
        <ChevronDown className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <div className="grid gap-2 px-3 pb-3 md:grid-cols-2">
        <Track icon={Sparkles} title="1 · AI audit">
          <div>
            Risk <b className={r.text}>{s.risk.level}</b> ({s.risk.score}/100) · {s.risk.counts.contradicted} contradicted · {s.risk.counts.unverified} unverified
          </div>
          <div className="text-slate-400">
            {s.ai ? `${s.ai.model}${s.ai.auditId ? ` · Neon audit #${s.ai.auditId}` : ""}` : "AI deep audit not run"}
            {s.visual?.images?.length ? ` · ${s.visual.images.length} image(s)` : ""}{s.visual?.videos?.length ? ` · ${s.visual.videos.length} video(s)` : ""}
          </div>
        </Track>
        <Track icon={BadgeCheck} title="2 · Publication & sign-off">
          <div>
            Manager: {m ? <b className="text-emerald-300">{m.name}</b> : <span className="text-slate-500">pending</span>}
            {" · "}Legal:{" "}
            {l ? (
              <b className="text-emerald-300">
                {l.name}
                {l.by === "manager" ? " (manager, dual authority)" : ""}
              </b>
            ) : s.status === "rejected" ? (
              <span className="text-rose-300">rejected</span>
            ) : (
              <span className="text-slate-500">pending</span>
            )}
          </div>
          <div className="text-slate-400">
            {s.publication ? `Published ${s.publication.fileName}` : "Not published yet"}
            {s.signoff ? ` · signed off by ${s.signoff.name}` : s.publication ? " · sign-off pending" : ""}
          </div>
        </Track>
      </div>
      {onOpen && REOPENABLE[s.status] && (
        <div className="flex items-center justify-end gap-2 px-3 pb-3">
          {current ? (
            <span className="text-[11px] text-slate-500">Open in the editor now</span>
          ) : (
            <button onClick={() => onOpen(s)} className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/20">
              {REOPENABLE[s.status]}
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="border-t border-slate-800 p-3">
          <SignoffTimeline sub={s} />
        </div>
      )}
    </li>
  );
}

/** History & sign-off log - shared by the Creator, Manager and Legal panels. */
export function SignoffLog({ workflow, title = "Approvals, publication & sign-off log", onOpen = null, currentId = null }) {
  const subs = workflow.submissions;
  return (
    <section className="space-y-3" aria-label="Sign-off log">
      <div>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="text-[11px] text-slate-400">Every submission with (1) its AI audit and (2) its approvals, publication and sign-off. Click a row for the full timeline.</p>
      </div>
      {subs.length ? (
        <ul className="space-y-2">
          {subs.map((s) => (
            <Card key={s.id} s={s} onOpen={onOpen} current={s.id === currentId} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">No submissions yet. Creators send content to the manager from the Creator panel.</p>
      )}
    </section>
  );
}
