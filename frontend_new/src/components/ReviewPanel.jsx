import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, BriefcaseBusiness, ChevronDown, CircleCheck, CircleX, FileText, Forward, Image as ImageIcon, Inbox, Scale, Sparkles, Wrench } from "lucide-react";
import { Button, EmptyState, RISK_STYLE, VerdictBadge } from "./ui.jsx";
import { STATUS, legalDecision, loadName, managerDecision, saveName, timeAgo } from "../lib/workflow.js";
import SignoffTimeline from "./SignoffLog.jsx";

const CHIP = {
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  indigo: "border-indigo-500/40 bg-indigo-500/10 text-indigo-200",
  slate: "border-slate-600 bg-slate-800 text-slate-300",
};

export function StatusChip({ status }) {
  const s = STATUS[status] || { label: status, tone: "slate" };
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${CHIP[s.tone]}`}>{s.label}</span>;
}

function Section({ icon: Icon, title, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</span>
        {count != null && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{count}</span>}
        <ChevronDown className={`h-4 w-4 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-slate-800 p-3">{children}</div>}
    </div>
  );
}

function Stat({ label, value, cls = "text-slate-100" }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${cls}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none";

function Check({ checked, onChange, children }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-xs ${checked ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100" : "border-slate-700 bg-slate-950/50 text-slate-300"}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500" />
      <span>{children}</span>
    </label>
  );
}

/** Decision box: manager (dual / forward / reject) or legal approver (accept / reject). */
function DecisionBox({ role, sub, toast }) {
  const [mode, setMode] = useState(role === "manager" ? "dual" : "accept");
  const [name, setName] = useState(() => loadName(role));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [improvements, setImprovements] = useState("");
  const [boxes, setBoxes] = useState({ manager: false, legal: false });
  useEffect(() => {
    setNote("");
    setReason("");
    setImprovements("");
    setBoxes({ manager: false, legal: false });
    setMode(role === "manager" ? "dual" : "accept");
  }, [sub.id, sub.version, role]);

  const remember = () => saveName(role, name.trim());
  const decide = (action) => {
    remember();
    const args = { action, name: name.trim(), note: note.trim(), reason: reason.trim(), improvements: improvements.trim() };
    if (role === "manager") managerDecision(sub.id, args);
    else legalDecision(sub.id, args);
    const msg = {
      approve_dual: "Approved as manager and legal approver. Publishing is unlocked for the creator.",
      forward: "Approved and forwarded to the legal approver.",
      accept: "Approved. The creator can now publish and sign off.",
      reject: "Rejected. The creator has been notified with your reason.",
    }[action === "approve" ? "accept" : action];
    toast(msg, action === "reject" ? "danger" : "success");
  };

  const segments =
    role === "manager"
      ? [
          { id: "dual", label: "Manager + Legal (me)", icon: BadgeCheck },
          { id: "forward", label: "Forward to Legal", icon: Forward },
          { id: "reject", label: "Reject", icon: CircleX },
        ]
      : [
          { id: "accept", label: "Accept", icon: CircleCheck },
          { id: "reject", label: "Reject", icon: CircleX },
        ];
  const nameOk = name.trim().length > 1;

  return (
    <section className="rounded-2xl border border-indigo-500/40 bg-indigo-500/5 p-4" aria-label="Your decision">
      <h3 className="text-sm font-semibold text-white">{role === "manager" ? "Your decision as manager" : "Your decision as legal approver"}</h3>
      {role === "legal" && sub.approvals.manager && (
        <p className="mt-1 text-xs text-slate-400">
          Approved by manager {sub.approvals.manager.name} {timeAgo(sub.approvals.manager.at)}
          {sub.approvals.manager.note ? ` - “${sub.approvals.manager.note}”` : ""}.
        </p>
      )}
      <div role="tablist" aria-label="Decision" className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0,1fr))` }}>
        {segments.map((sg) => (
          <button
            key={sg.id}
            role="tab"
            aria-selected={mode === sg.id}
            onClick={() => setMode(sg.id)}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${
              mode === sg.id
                ? sg.id === "reject"
                  ? "border-rose-500/60 bg-rose-500/15 text-rose-100"
                  : "border-indigo-500/60 bg-indigo-500/15 text-white"
                : "border-slate-700 bg-slate-950/50 text-slate-400 hover:text-white"
            }`}
          >
            <sg.icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{sg.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={role === "manager" ? "e.g. Kartik Kumar" : "e.g. Shivam Dev"} className={inputCls} />
        </Field>

        {mode === "dual" && (
          <>
            <p className="text-xs text-slate-400">You hold both authorities. Tick both approvals to unlock publishing for the creator immediately.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Check checked={boxes.manager} onChange={(v) => setBoxes((b) => ({ ...b, manager: v }))}>
                <b>Manager approval</b> - content, fixes and AI score reviewed
              </Check>
              <Check checked={boxes.legal} onChange={(v) => setBoxes((b) => ({ ...b, legal: v }))}>
                <b>Legal approver</b> - I take legal responsibility for this release
              </Check>
            </div>
          </>
        )}
        {mode === "forward" && (
          <>
            <p className="text-xs text-slate-400">You approve as manager. A separate legal approver must accept before the creator can publish.</p>
            <Check checked={boxes.manager} onChange={(v) => setBoxes((b) => ({ ...b, manager: v }))}>
              <b>Manager approval</b> - content, fixes and AI score reviewed
            </Check>
          </>
        )}
        {mode === "accept" && (
          <Check checked={boxes.legal} onChange={(v) => setBoxes((b) => ({ ...b, legal: v }))}>
            <b>Legal approval</b> - this content is legally cleared for publication
          </Check>
        )}
        {mode !== "reject" ? (
          <Field label="Note to the creator (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Good to go for the LinkedIn campaign" className={inputCls} />
          </Field>
        ) : (
          <>
            <Field label="Reason for rejection (required)">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What is wrong and why it cannot be published" className={`${inputCls} resize-y`} />
            </Field>
            <Field label="Required improvements">
              <textarea
                value={improvements}
                onChange={(e) => setImprovements(e.target.value)}
                rows={3}
                placeholder="e.g. Remove the 99.99% claim, use the approved logo, cite a source for the award"
                className={`${inputCls} resize-y`}
              />
            </Field>
          </>
        )}

        {mode === "dual" && (
          <Button variant="success" className="w-full" disabled={!nameOk || !boxes.manager || !boxes.legal} onClick={() => decide("approve_dual")}>
            <BadgeCheck className="h-4 w-4" /> Accept & unlock publishing
          </Button>
        )}
        {mode === "forward" && (
          <Button className="w-full" disabled={!nameOk || !boxes.manager} onClick={() => decide("forward")}>
            <Forward className="h-4 w-4" /> Approve & forward to Legal Approver
          </Button>
        )}
        {mode === "accept" && (
          <Button variant="success" className="w-full" disabled={!nameOk || !boxes.legal} onClick={() => decide("approve")}>
            <CircleCheck className="h-4 w-4" /> Accept & notify creator
          </Button>
        )}
        {mode === "reject" && (
          <Button variant="danger" className="w-full" disabled={!nameOk || reason.trim().length < 5} onClick={() => decide("reject")}>
            <CircleX className="h-4 w-4" /> Reject & notify creator
          </Button>
        )}
      </div>
    </section>
  );
}

export function SubmissionDetail({ sub, role, toast }) {
  const r = RISK_STYLE[sub.risk.level];
  const visualFindings = [
    ...(sub.visual?.images || []).flatMap((i) => [...i.findings, ...(i.adFindings || [])].map((f) => ({ ...f, image: i.name }))),
    ...(sub.visual?.videos || []).flatMap((v) => v.findings.map((f) => ({ ...f, image: v.name }))),
  ];
  const mediaCount = (sub.visual?.images?.length || 0) + (sub.visual?.videos?.length || 0);
  const canDecide = (role === "manager" && sub.status === "pending_manager") || (role === "legal" && sub.status === "pending_legal");
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-bold text-white">{sub.title}</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Version {sub.version} · by {sub.creatorName} · sent {timeAgo(sub.updatedAt)}
              {sub.company ? ` · ${sub.company}` : ""}
            </p>
          </div>
          <StatusChip status={sub.status} />
        </div>
        {sub.note && <p className="mt-2 rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-300">Creator’s note: “{sub.note}”</p>}
        {sub.lastRejection && sub.status !== "rejected" && (
          <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">
            Re-submission after feedback from {sub.lastRejection.name}: “{sub.lastRejection.reason}”
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="AI risk score" value={`${sub.risk.score}/100 · ${sub.risk.level}`} cls={r.text} />
          <Stat label="Contradicted" value={sub.risk.counts.contradicted} cls="text-rose-300" />
          <Stat label="Unverified" value={sub.risk.counts.unverified} cls="text-amber-300" />
          <Stat label="Tone" value={sub.tone ? `${sub.tone.score}/10` : "-"} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {sub.ai
            ? `AI deep audit: ${sub.ai.model}${sub.ai.auditId ? ` · Neon audit #${sub.ai.auditId}` : ""} · ${sub.ai.counts.CONTRADICTED} contradicted, ${sub.ai.counts.UNVERIFIED} unverified, ${sub.ai.counts.VERIFIED} verified${
                sub.ai.stale ? " · ran on an earlier draft" : ""
              }`
            : "AI deep audit was not run on this version."}{" "}
          · Policy: {sub.policyName}
        </p>
      </div>

      {canDecide && <DecisionBox role={role} sub={sub} toast={toast} />}
      {!canDecide && sub.rejection && sub.status === "rejected" && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
          <b>Rejected by the {sub.rejection.role === "legal" ? "legal approver" : "manager"} ({sub.rejection.name}):</b> {sub.rejection.reason}
          {sub.rejection.improvements && <div className="mt-1">Required: {sub.rejection.improvements}</div>}
          <div className="mt-1 opacity-75">Waiting for the creator to re-submit.</div>
        </div>
      )}

      <Section icon={FileText} title="Content" defaultOpen>
        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950/60 p-3 text-sm leading-relaxed text-slate-200 scrollbar-thin">{sub.text}</div>
      </Section>
      <Section icon={Sparkles} title="Open issues (AI + rule checks)" count={sub.findings.length} defaultOpen={sub.findings.length > 0}>
        {sub.findings.length ? (
          <ul className="space-y-1.5">
            {sub.findings.map((f, i) => (
              <li key={i} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <VerdictBadge verdict={f.verdict} />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">{f.category}</span>
                  {f.severity && f.severity !== "none" && <span className="text-[10px] text-slate-500">{f.severity}</span>}
                </div>
                <div className="mt-1 break-words font-medium text-slate-200">“{f.match}”</div>
                <p className="mt-0.5 break-words text-slate-400">{f.explanation}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-emerald-300">No open issues - everything was fixed or verified.</p>
        )}
      </Section>
      <Section icon={Wrench} title="Improvements applied by the creator" count={sub.improvements.length + sub.overrides.length} defaultOpen={false}>
        {sub.improvements.length || sub.overrides.length ? (
          <ul className="space-y-1 text-xs text-slate-300">
            {sub.improvements.map((t, i) => (
              <li key={`i${i}`} className="flex gap-2">
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="break-words">{t}</span>
              </li>
            ))}
            {sub.overrides.map((o, i) => (
              <li key={`o${i}`} className="flex gap-2">
                <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="break-words">
                  Overrode {o.verdict} “{o.match}” - reason: {o.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No fixes were applied in the editor.</p>
        )}
      </Section>
      <Section icon={ImageIcon} title="Visual audit (images & video: logo, colours, captions)" count={mediaCount} defaultOpen={mediaCount > 0}>
        {mediaCount ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(sub.visual.videos || []).map((v) => (
                <div key={v.name} className="w-32 text-center">
                  <div className="relative">
                    {v.poster ? (
                      <img src={v.poster} alt={v.name} className="h-20 w-32 rounded-lg border border-fuchsia-500/50 object-cover" />
                    ) : (
                      <div className="h-20 w-32 rounded-lg border border-fuchsia-500/50 bg-slate-900" />
                    )}
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
                      {String(Math.floor(v.duration / 60)).padStart(2, "0")}:{String(Math.floor(v.duration % 60)).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-fuchsia-200">{v.name}</div>
                </div>
              ))}
              {(sub.visual.images || []).map((im) => (
                <div key={im.name} className="w-24 text-center">
                  {im.thumb ? (
                    <img src={im.thumb} alt={im.name} className="h-20 w-24 rounded-lg border border-slate-700 bg-white object-contain" />
                  ) : (
                    <div className="grid h-20 w-24 place-items-center rounded-lg border border-slate-700 text-slate-500">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                  <div className="mt-1 truncate text-[10px] text-slate-400">{im.name}</div>
                </div>
              ))}
            </div>
            <ul className="space-y-1.5">
              {visualFindings.map((f, i) => (
                <li key={i} className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <VerdictBadge verdict={f.verdict} />
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{f.category}</span>
                    <span className="truncate text-[10px] text-slate-500">{f.image}</span>
                  </div>
                  <p className="mt-1 break-words text-slate-300">{f.explanation}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-slate-500">No images were submitted with this content.</p>
        )}
      </Section>
      <Section icon={BadgeCheck} title="History & sign-off log" count={sub.history.length} defaultOpen={false}>
        <SignoffTimeline sub={sub} />
      </Section>
    </div>
  );
}

const FILTERS = {
  manager: [
    { id: "todo", label: "Needs my decision", test: (s) => s.status === "pending_manager" },
    { id: "legal", label: "With legal", test: (s) => s.status === "pending_legal" },
    { id: "approved", label: "Approved", test: (s) => ["approved", "published", "closed"].includes(s.status) },
    { id: "rejected", label: "Changes requested", test: (s) => s.status === "rejected" },
    { id: "all", label: "All", test: () => true },
  ],
  legal: [
    { id: "todo", label: "Needs my decision", test: (s) => s.status === "pending_legal" },
    { id: "done", label: "Decided", test: (s) => s.history.some((h) => h.role === "legal") },
    { id: "all", label: "All forwarded", test: (s) => s.authority === "separate" || s.history.some((h) => h.role === "legal") },
  ],
};

/** Manager panel and Legal approver panel. */
export default function ReviewPanel({ role, workflow, toast }) {
  const filters = FILTERS[role];
  const [filter, setFilter] = useState("todo");
  const [selectedId, setSelectedId] = useState(null);
  const list = useMemo(() => workflow.submissions.filter(filters.find((f) => f.id === filter).test), [workflow, filter, filters]);
  const selected = workflow.submissions.find((s) => s.id === selectedId) || list[0] || null;
  useEffect(() => setFilter("todo"), [role]);

  const Icon = role === "manager" ? BriefcaseBusiness : Scale;
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-white">
          <Icon className="h-5 w-5 text-indigo-400" /> {role === "manager" ? "Manager panel - approval requests" : "Legal approver panel"}
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          {role === "manager"
            ? "Review what creators send: the content, the fixes they applied, the visual audit and the AI score. Approve with both authorities, forward to legal, or reject with a reason."
            : "Submissions the manager approved and forwarded to you. Accept to unlock publishing for the creator, or reject with the improvements needed."}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter submissions">
        {filters.map((f) => {
          const n = workflow.submissions.filter(f.test).length;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setSelectedId(null);
              }}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${filter === f.id ? "border-slate-600 bg-slate-800 text-white" : "border-slate-800 text-slate-400 hover:text-white"}`}
            >
              {f.label} <span className={`ml-1 rounded-full px-1.5 text-[10px] ${f.id === "todo" && n ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-300"}`}>{n}</span>
            </button>
          );
        })}
      </div>
      {!list.length ? (
        <EmptyState icon={Inbox} title={filter === "todo" ? "Nothing waiting for you" : "No submissions here"}>
          {role === "manager"
            ? "When a creator clicks “Send to Manager”, the request appears here. Switch to the Creator panel to try it."
            : "When a manager approves a submission and forwards it to legal, it appears here."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ul className="space-y-2" aria-label="Submissions">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setSelectedId(s.id)}
                  aria-current={selected?.id === s.id}
                  className={`w-full rounded-xl border p-3 text-left transition ${selected?.id === s.id ? "border-indigo-500/60 bg-indigo-500/10" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-semibold text-slate-100">{s.title}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${RISK_STYLE[s.risk.level].pill}`}>{s.risk.level}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    v{s.version} · {s.creatorName} · {timeAgo(s.updatedAt)}
                  </div>
                  <div className="mt-1.5">
                    <StatusChip status={s.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {selected && <SubmissionDetail key={selected.id} sub={selected} role={role} toast={toast} />}
        </div>
      )}
    </div>
  );
}
