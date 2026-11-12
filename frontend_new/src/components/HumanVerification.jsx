import { useEffect, useState } from "react";
import { BadgeCheck, ClipboardCheck, Download, FilePlus2, Lock, ShieldAlert, UserCheck } from "lucide-react";
import { Button, EmptyState, RISK_STYLE } from "./ui.jsx";

const ITEMS = [
  { id: "contradicted", text: "I reviewed every CONTRADICTED finding and either fixed it or recorded an override reason." },
  { id: "unverified", text: "Unverified claims now cite an approved source, were softened, or were removed." },
  { id: "privacy", text: "No personal data, credentials or confidential material is exposed in the final file." },
  { id: "tone", text: "Tone and persona match the brand guidelines for this audience." },
  { id: "visual", text: "Images passed the visual audit (logo, brand colours, brand name and motto), or were checked manually." },
  { id: "accountability", text: "I accept accountability as the human approver for this publication." },
];

export default function HumanVerification({ publication, onClose, onRedownload, onNewDocument, onGoToWorkspace }) {
  const [checked, setChecked] = useState({});
  const [approver, setApprover] = useState("");
  const [role, setRole] = useState("Brand / legal reviewer");

  useEffect(() => {
    setChecked({});
    setApprover("");
  }, [publication?.id]);

  if (!publication) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing awaiting sign-off"
        action={<Button onClick={onGoToWorkspace}>Go to workspace</Button>}
      >
        Publish a document from the Audit Workspace. Its Human Verification checklist will appear here to close out the project.
      </EmptyState>
    );
  }

  const closed = publication.status === "closed";
  const all = ITEMS.every((i) => checked[i.id]);
  const done = Object.values(checked).filter(Boolean).length;
  const r = RISK_STYLE[publication.risk.level];

  return (
    <div className="fade-in mx-auto max-w-3xl space-y-4">
      {publication.overridden && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-rose-500 bg-rose-950/70 p-4" role="alert">
          <ShieldAlert className="h-6 w-6 shrink-0 text-rose-300" />
          <div>
            <div className="text-sm font-extrabold uppercase tracking-wide text-rose-200">PUBLIVRA AI will not be held responsible for compliance breaches.</div>
            <div className="mt-0.5 text-xs text-rose-200/80">This document was downloaded by manual override of a HIGH risk gate. The override is recorded in the audit trail.</div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl bg-indigo-500/15 p-2.5">
            <UserCheck className="h-6 w-6 text-indigo-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight">Human Verification Required</h1>
            <p className="truncate text-xs text-slate-400">
              {publication.title} · {publication.fileName} · {new Date(publication.at).toLocaleString("en-IN")}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${r.pill}`}>{r.label}</span>
        </div>

        {closed ? (
          <div className="mt-5 rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-5 text-center">
            <BadgeCheck className="mx-auto h-10 w-10 text-emerald-300" />
            <h2 className="mt-2 text-lg font-bold text-emerald-100">Project closed</h2>
            <p className="mt-1 text-xs text-emerald-200/80">
              Signed off by {publication.approver.name} ({publication.approver.role}) on {new Date(publication.closedAt).toLocaleString("en-IN")}.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={onRedownload}>
                <Download className="h-4 w-4" /> Download PDF again
              </Button>
              <Button onClick={onNewDocument}>
                <FilePlus2 className="h-4 w-4" /> Start a new audit
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-[11px] text-slate-400">
                <span>Checklist progress</span>
                <span>
                  {done}/{ITEMS.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(done / ITEMS.length) * 100}%` }} />
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {ITEMS.map((item) => (
                <li key={item.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors ${
                      checked[item.id] ? "border-emerald-600/50 bg-emerald-950/30 text-emerald-100" : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!!checked[item.id]}
                      onChange={(e) => setChecked((c) => ({ ...c, [item.id]: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
                    />
                    {item.text}
                  </label>
                </li>
              ))}
            </ul>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Approver name</span>
                <input
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  placeholder="Full name"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option>Brand / legal reviewer</option>
                  <option>Marketing manager</option>
                  <option>Content creator</option>
                </select>
              </label>
            </div>
            {publication.risk.level === "HIGH" && role === "Content creator" && (
              <p className="mt-2 text-[11px] text-rose-300">High-risk content must be signed off by a brand/legal reviewer, not the creator.</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" onClick={onRedownload}>
                <Download className="h-4 w-4" /> Re-download PDF
              </Button>
              <Button
                variant="success"
                disabled={!all || approver.trim().length < 3 || (publication.risk.level === "HIGH" && role === "Content creator")}
                onClick={() => onClose({ name: approver.trim(), role, checklist: ITEMS.map((i) => i.text) })}
              >
                <Lock className="h-4 w-4" /> Verify & close project
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
