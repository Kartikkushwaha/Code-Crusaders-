import { useEffect, useState } from "react";
import { CircleCheck, Download, FileDown, ShieldAlert, TriangleAlert } from "lucide-react";
import { Modal, Button, VerdictBadge } from "./ui.jsx";

function FileNameField({ value, onChange }) {
  return (
    <label className="mt-4 block text-left">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">File name</span>
      <div className="mt-1 flex items-center rounded-lg border border-slate-700 bg-slate-950 focus-within:border-indigo-500">
        <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent px-3 py-2 text-sm text-slate-100 focus:outline-none" />
        <span className="pr-3 text-xs text-slate-500">.pdf</span>
      </div>
    </label>
  );
}

/** Low / Medium risk: "Ready to Publish" confirmation. */
export function ReadyModal({ open, onClose, onConfirm, risk, defaultName }) {
  const [name, setName] = useState(defaultName);
  useEffect(() => setName(defaultName), [defaultName, open]);
  if (!risk) return null;
  const medium = risk.level === "MEDIUM";
  return (
    <Modal open={open} onClose={onClose} tone="success" labelledBy="ready-title">
      <div className="p-6 text-center">
        <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${medium ? "bg-amber-500/15" : "bg-emerald-500/15"}`}>
          <CircleCheck className={`h-8 w-8 ${medium ? "text-amber-300" : "text-emerald-300"}`} />
        </div>
        <h2 id="ready-title" className="mt-4 text-2xl font-extrabold tracking-tight">Ready to Publish</h2>
        <p className="mt-1 text-sm text-slate-400">
          Risk level is <b className={medium ? "text-amber-300" : "text-emerald-300"}>{risk.level}</b>. The final document will be exported as a formatted PDF with
          its audit certificate.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Verified" n={risk.counts.verified} cls="text-emerald-300" />
          <Stat label="Unverified" n={risk.counts.unverified} cls="text-amber-300" />
          <Stat label="Contradicted" n={risk.counts.contradicted} cls="text-rose-300" />
        </div>
        {medium && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-left text-xs text-amber-200">
            Medium-risk items remain. They will be listed on the certificate so the approving manager can see them.
          </p>
        )}
        <FileNameField value={name} onChange={setName} />
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Keep editing
          </Button>
          <Button variant="success" className="flex-1" onClick={() => onConfirm(name || defaultName)}>
            <Download className="h-4 w-4" /> Confirm & download PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** High risk: severe modal, user must type "confirm". */
export function HighRiskModal({ open, onClose, onConfirm, risk, findings, defaultName }) {
  const [typed, setTyped] = useState("");
  const [name, setName] = useState(defaultName);
  useEffect(() => {
    if (open) {
      setTyped("");
      setName(defaultName);
    }
  }, [open, defaultName]);
  if (!risk) return null;
  const valid = typed.trim() === "confirm";
  const high = findings.filter((f) => f.verdict === "CONTRADICTED" && f.severity === "high").slice(0, 5);

  return (
    <Modal open={open} onClose={onClose} tone="danger" labelledBy="high-title" wide>
      <div className="rounded-t-2xl bg-gradient-to-r from-rose-700 to-rose-600 px-6 py-5">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-9 w-9 animate-pulse text-white" />
          <div>
            <h2 id="high-title" className="text-xl font-extrabold tracking-tight text-white">
              HIGH RISK - publication blocked
            </h2>
            <p className="text-xs text-rose-100">
              {risk.counts.high} high-severity contradiction{risk.counts.high === 1 ? "" : "s"} · risk score {risk.score}/100
            </p>
          </div>
        </div>
      </div>
      <div className="p-6">
        <p className="text-sm text-slate-300">
          This content directly violates your policy. Publishing it may expose the organisation to regulatory penalties (e.g. CCPA action under the Consumer
          Protection Act 2019) and data-protection breaches.
        </p>
        <ul className="mt-3 space-y-1.5">
          {high.map((f) => (
            <li key={f.id} className="flex items-start gap-2 rounded-lg border border-rose-900/70 bg-rose-950/40 p-2 text-xs text-rose-100">
              <VerdictBadge verdict="CONTRADICTED" size="xs" />
              <span>
                <b>{f.clause}:</b> {f.explanation}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/60 bg-rose-500/10 p-3 text-xs font-semibold text-rose-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          PUBLIVRA AI will not be held responsible for compliance breaches. The PDF will carry an override disclaimer on every page.
        </div>

        <FileNameField value={name} onChange={setName} />

        <label className="mt-4 block">
          <span className="text-xs text-slate-300">
            Type <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-rose-300">confirm</code> to override and download anyway
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={typed.length > 0 && !valid}
            placeholder="confirm"
            className={`mt-1.5 w-full rounded-lg border bg-slate-950 px-3 py-2.5 font-mono text-sm text-slate-100 focus:outline-none ${
              typed.length === 0 ? "border-slate-700 focus:border-rose-500" : valid ? "border-emerald-500" : "border-rose-600"
            }`}
          />
          {typed.length > 0 && !valid && <span className="mt-1 block text-[11px] text-rose-400">Type the word exactly: confirm</span>}
        </label>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Go back and fix issues
          </Button>
          <Button variant="danger" className="flex-1" disabled={!valid} onClick={() => onConfirm(name || defaultName)}>
            <FileDown className="h-4 w-4" /> Override & download PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, n, cls }) {
  return (
    <div className="rounded-xl bg-slate-950/60 py-2">
      <div className={`text-lg font-bold ${cls}`}>{n}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}
