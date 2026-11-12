import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, CheckCircle2, LogIn, PenLine, Scale, ShieldCheck, Wand2 } from "lucide-react";
import { Button } from "./ui.jsx";
import { cleanDomain, domainFromCompany, emailError, isValidDomain } from "../lib/session.js";

export const ROLE_CARDS = [
  { id: "creator", label: "Creator", user: "creator", icon: PenLine, desc: "Check content, images & video, fix issues, send for approval, publish." },
  { id: "manager", label: "Manager", user: "manager", icon: BriefcaseBusiness, desc: "Review requests, approve with dual authority or forward to legal." },
  { id: "legal", label: "Legal Approver", user: "legal", icon: Scale, desc: "Accept or reject submissions forwarded by the manager." },
];
const QUICK = ["Publivra Corp", "Proclinical Ltd", "NexusMobile Inc"];
const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

/**
 * Enterprise sign-in: Step 1 parent company (tenant + domain), Step 2 child role + company ID.
 * pendingFor(company) -> { creator, manager, legal } counts, shown on the role cards.
 */
export default function LoginScreen({ initial, onLogin, pendingFor }) {
  const [step, setStep] = useState(initial?.company ? 2 : 1);
  const [company, setCompany] = useState(initial?.company || "");
  const [domain, setDomain] = useState(initial?.domain || "");
  const [domainEdited, setDomainEdited] = useState(!!initial?.domain);
  const [role, setRole] = useState(initial?.role || "creator");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!domainEdited) setDomain(domainFromCompany(company));
  }, [company, domainEdited]);

  const d = cleanDomain(domain);
  const companyOk = company.trim().length >= 2 && isValidDomain(d);
  const err = emailError(email, d);
  const pending = useMemo(() => (step === 2 ? pendingFor(company.trim()) : {}), [step, company, pendingFor]);

  const autofill = (r) => {
    setRole(r.id);
    setEmail(`${r.user}@${d}`);
    setTouched(false);
  };
  const submit = (e) => {
    e?.preventDefault();
    setTouched(true);
    if (err) return;
    onLogin({ company: company.trim(), domain: d, role, email: email.trim().toLowerCase(), at: Date.now() });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.18),transparent_60%)] px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-2 shadow-lg shadow-indigo-900/50">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-extrabold tracking-tight text-white">PUBLIVRA AI</span>
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Enterprise</span>
        </div>

        {/* stepper */}
        <ol className="mb-4 flex items-center justify-center gap-2 text-xs" aria-label="Sign-in steps">
          {["Parent company", "Role & company ID"].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
                  step > i + 1 ? "bg-emerald-500 text-white" : step === i + 1 ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400"
                }`}
              >
                {step > i + 1 ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={step === i + 1 ? "font-semibold text-white" : "text-slate-400"}>{s}</span>
              {i === 0 && <span className="mx-1 h-px w-8 bg-slate-700" />}
            </li>
          ))}
        </ol>

        <div className="fade-in rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl backdrop-blur sm:p-8">
          {step === 1 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (companyOk) setStep(2);
              }}
            >
              <h1 className="text-2xl font-extrabold tracking-tight text-white">Sign in to your company</h1>
              <p className="mt-1 text-sm text-slate-400">Your parent company is the workspace. Every role inside it shares the same approvals and insights.</p>
              <label className="mt-6 block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Parent company name</span>
                <div className="relative mt-1.5">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Publivra Corp" className={`${inputCls} pl-9`} />
                </div>
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK.map((q) => (
                  <button
                    type="button"
                    key={q}
                    onClick={() => {
                      setCompany(q);
                      setDomainEdited(false);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs ${company === q ? "border-indigo-500 bg-indigo-500/15 text-white" : "border-slate-700 text-slate-400 hover:text-white"}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <label className="mt-5 block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Company domain</span>
                <div className="mt-1.5 flex items-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950 focus-within:border-indigo-500">
                  <span className="pl-3.5 text-sm text-slate-500">username@</span>
                  <input
                    value={domain}
                    onChange={(e) => {
                      setDomain(e.target.value);
                      setDomainEdited(true);
                    }}
                    placeholder="publivra.com"
                    className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-slate-100 focus:outline-none"
                  />
                </div>
                <span className="mt-1 block text-[11px] text-slate-500">Generated from the company name. Change it if your IDs use a different domain.</span>
              </label>
              <Button type="submit" className="mt-6 w-full" disabled={!companyOk}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form onSubmit={submit}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-extrabold tracking-tight text-white">Choose your role</h1>
                  <p className="mt-1 text-sm text-slate-400">
                    <Building2 className="mr-1 inline h-3.5 w-3.5" />
                    <b className="text-slate-200">{company}</b> · @{d}
                  </p>
                </div>
                <button type="button" onClick={() => setStep(1)} className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-400 hover:text-white">
                  <ArrowLeft className="h-3.5 w-3.5" /> Change company
                </button>
              </div>
              <div role="radiogroup" aria-label="Role" className="mt-5 grid gap-2.5 sm:grid-cols-3">
                {ROLE_CARDS.map((r) => (
                  <div
                    key={r.id}
                    className={`relative flex flex-col rounded-2xl border p-3.5 transition ${role === r.id ? "border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/30" : "border-slate-700 bg-slate-950/50 hover:border-slate-500"}`}
                  >
                    <button type="button" role="radio" aria-checked={role === r.id} onClick={() => setRole(r.id)} className="text-left">
                      <div className="flex items-center gap-2">
                        <r.icon className={`h-4 w-4 ${role === r.id ? "text-indigo-300" : "text-slate-400"}`} />
                        <span className="text-sm font-bold text-white">{r.label}</span>
                        {pending[r.id] ? <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{pending[r.id]}</span> : null}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{r.desc}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => autofill(r)}
                      className="mt-3 inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-indigo-500 hover:text-white"
                    >
                      <Wand2 className="h-3 w-3" /> Autofill demo ID
                    </button>
                  </div>
                ))}
              </div>
              <label className="mt-5 block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Company ID</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched(true)}
                  type="email"
                  autoComplete="username"
                  placeholder={`${ROLE_CARDS.find((r) => r.id === role).user}@${d}`}
                  aria-invalid={touched && !!err}
                  className={`${inputCls} mt-1.5 ${touched && err ? "border-rose-500" : ""}`}
                />
                {touched && err && <span className="mt-1 block text-xs text-rose-300">{err}</span>}
              </label>
              <Button type="submit" className="mt-5 w-full">
                <LogIn className="h-4 w-4" /> Sign in as {ROLE_CARDS.find((r) => r.id === role).label}
              </Button>
              <p className="mt-3 text-center text-[11px] text-slate-500">Demo sign-in - no password needed. Use “Switch account” in the top bar to try every role.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
