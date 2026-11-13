import { useEffect, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, Building2, Check, CircleAlert, Copy, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, PenLine, Scale, ShieldCheck, Wand2 } from "lucide-react";
import { Button, Modal } from "./ui.jsx";
import { api } from "../lib/api.js";
import { cleanDomain, domainFromCompany, isValidDomain, sessionFromLogin, toApiRole } from "../lib/session.js";

const ROLES = [
  { id: "creator", api: "creator", label: "Creator", user: "creator", icon: PenLine, desc: "Checks content, fixes issues, sends it for approval and publishes." },
  { id: "manager", api: "manager", label: "Manager", user: "manager", icon: BriefcaseBusiness, desc: "Reviews requests, approves directly or sends to legal." },
  { id: "legal", api: "legal_approver", label: "Legal Approver", user: "legal", icon: Scale, desc: "Approves or rejects content the manager sent for legal review." },
];
const inputCls =
  "mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";
const passwordProblem = (p) => (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p) ? "At least 8 characters, with a letter and a number." : "");
const idProblem = (id) => (/^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(id.trim()) ? "" : "Use the format name@yourcompany.com.");

function strongPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const body = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `${body.slice(0, 6)}-${body.slice(6)}${(bytes[0] % 8) + 2}`;
}

function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11px] text-rose-300">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {children}
    </p>
  );
}

function PasswordInput({ value, onChange, autoComplete, invalid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        maxLength={128}
        aria-invalid={invalid}
        className={`${inputCls} pr-10 ${invalid ? "border-rose-500" : ""}`}
      />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 mt-[3px] -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-white" aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return (
    <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-indigo-500 hover:text-white">
      {done ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />} {done ? "Copied" : label}
    </button>
  );
}

/** Busy state, error message and the "server is waking up" hint for one API call. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slow, setSlow] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setError("");
    const timer = setTimeout(() => setSlow(true), 4000);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      clearTimeout(timer);
      setSlow(false);
      setBusy(false);
    }
  };
  return { busy, error, slow, run, setError };
}
const Waking = ({ show }) => (show ? <p className="text-center text-[11px] text-amber-200">The server is waking up. The first request can take up to a minute.</p> : null);

// ------------------------------------------------------------- sign-in popup
/**
 * Popup: pick Creator, Manager or Legal Approver, then sign in with that role's ID and password.
 * initial.ids: login IDs to prefill per role ({ creator, manager, legal }).
 */
function SignInModal({ open, onClose, initial, notice, onLogin }) {
  const [role, setRole] = useState(null);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const act = useAction();
  useEffect(() => {
    if (!open) return;
    setRole(null); // always start from the three roles
    setId("");
    setPassword("");
    act.setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const r = ROLES.find((x) => x.id === role);
  const submit = (e) => {
    e.preventDefault();
    act.run(async () => {
      const res = await api.auth.login({ email: id.trim(), password, role: toApiRole(role) });
      onLogin(sessionFromLogin(res));
    });
  };
  return (
    <Modal open={open} onClose={onClose} labelledBy="signin-title" wide={!r}>
      <div className="p-6">
        {!r ? (
          <>
            <h2 id="signin-title" className="text-lg font-bold text-white">
              Sign in as
            </h2>
            <p className="mt-1 text-xs text-slate-400">Choose your role in the company.</p>
            {notice && <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{notice}</p>}
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {ROLES.map((x) => (
                <button
                  key={x.id}
                  onClick={() => {
                    setRole(x.id);
                    setId(initial?.ids?.[x.id] || "");
                  }}
                  className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-left transition hover:border-indigo-500 hover:bg-indigo-500/10"
                >
                  <x.icon className="h-5 w-5 text-indigo-300" />
                  <div className="mt-2 text-sm font-bold text-white">{x.label}</div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">{x.desc}</p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <button type="button" onClick={() => setRole(null)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white">
              <ArrowLeft className="h-3 w-3" /> Choose another role
            </button>
            <div className="flex items-center gap-2">
              <r.icon className="h-5 w-5 text-indigo-300" />
              <h2 id="signin-title" className="text-lg font-bold text-white">
                Sign in as {r.label}
              </h2>
            </div>
            <Field label="Login ID">
              <input type="email" required autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder={`${r.user}@yourcompany.com`} className={inputCls} autoFocus />
            </Field>
            <Field label="Password">
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <ErrorNote>{act.error}</ErrorNote>
            <Button type="submit" className="w-full" disabled={act.busy}>
              {act.busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in as {r.label}
            </Button>
            <Waking show={act.slow} />
          </form>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ registration
const emptyAccount = () => ({ name: "", id: "", idEdited: false, password: "" });

function RegisterCompany({ onBack, onRegistered }) {
  const [company, setCompany] = useState("");
  const [domain, setDomain] = useState("");
  const [domainEdited, setDomainEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [accounts, setAccounts] = useState({ creator: emptyAccount(), manager: emptyAccount(), legal: emptyAccount() });
  const [touched, setTouched] = useState(false);
  const act = useAction();
  const d = cleanDomain(domain);

  // suggestion: @companyname.com, and role IDs on that domain - until the user edits them
  useEffect(() => {
    if (!domainEdited) setDomain(domainFromCompany(company));
  }, [company, domainEdited]);
  useEffect(() => {
    setAccounts((a) => {
      const next = { ...a };
      ROLES.forEach((r) => {
        if (!a[r.id].idEdited) next[r.id] = { ...a[r.id], id: d ? `${r.user}@${d}` : "" };
      });
      return next;
    });
  }, [d]);

  const set = (role, patch) => setAccounts((a) => ({ ...a, [role]: { ...a[role], ...patch } }));
  const ids = ROLES.map((r) => accounts[r.id].id.trim().toLowerCase());
  const problems = {
    company: company.trim().length < 2 ? "Enter the company name." : "",
    domain: isValidDomain(d) ? "" : "Enter a domain such as abc.com.",
    ...Object.fromEntries(
      ROLES.flatMap((r, i) => [
        [`${r.id}.id`, idProblem(accounts[r.id].id) || (ids.indexOf(ids[i]) !== i ? "Each role needs its own login ID." : "")],
        [`${r.id}.password`, passwordProblem(accounts[r.id].password)],
      ]),
    ),
  };
  const valid = Object.values(problems).every((p) => !p);
  const show = (key) => (touched ? problems[key] : "");

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    act.run(async () => {
      const res = await api.auth.registerCompany({
        company_name: company.trim(),
        company_domain: d,
        company_email: email.trim(),
        accounts: Object.fromEntries(ROLES.map((r) => [r.api, { login_id: accounts[r.id].id.trim(), password: accounts[r.id].password, full_name: accounts[r.id].name.trim() }])),
      });
      onRegistered({ result: res, passwords: Object.fromEntries(ROLES.map((r) => [r.api, accounts[r.id].password])) });
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white">
        <ArrowLeft className="h-3 w-3" /> Back
      </button>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">Register your company</h1>
        <p className="mt-1 text-sm text-slate-400">Create the login ID and password for each of the three roles. Give each person their own login.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" error={show("company")}>
          <input required maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. ABC Technologies" className={inputCls} />
        </Field>
        <Field label="Company domain" hint={d ? `Login IDs are suggested as name@${d}` : "Suggested from the company name"} error={show("domain")}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 mt-[3px] -translate-y-1/2 text-sm text-slate-500">@</span>
            <input
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setDomainEdited(true);
              }}
              placeholder="companyname.com"
              className={`${inputCls} pl-7`}
            />
          </div>
        </Field>
      </div>
      <Field label="Company e-mail (optional)" hint={d ? `Leave empty to use contact@${d}` : ""}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={d ? `contact@${d}` : "contact@companyname.com"} className={inputCls} />
      </Field>

      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Logins for the three roles</div>
        {ROLES.map((r) => {
          const a = accounts[r.id];
          return (
            <fieldset key={r.id} className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
              <legend className="flex items-center gap-2 px-1 text-sm font-bold text-white">
                <r.icon className="h-4 w-4 text-indigo-300" /> {r.label}
              </legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name (optional)">
                  <input value={a.name} maxLength={150} onChange={(e) => set(r.id, { name: e.target.value })} placeholder={`${r.label} name`} className={inputCls} />
                </Field>
                <Field label="Login ID" error={show(`${r.id}.id`)}>
                  <input type="email" value={a.id} onChange={(e) => set(r.id, { id: e.target.value, idEdited: true })} placeholder={`${r.user}@${d || "companyname.com"}`} className={inputCls} />
                </Field>
                <div>
                  <Field label="Password" error={show(`${r.id}.password`)}>
                    <PasswordInput value={a.password} onChange={(v) => set(r.id, { password: v })} autoComplete="new-password" invalid={!!show(`${r.id}.password`)} />
                  </Field>
                  <button type="button" onClick={() => set(r.id, { password: strongPassword() })} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300 hover:underline">
                    <Wand2 className="h-3 w-3" /> Generate a strong password
                  </button>
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>

      <ErrorNote>{act.error || (touched && !valid ? "Please fix the highlighted fields." : "")}</ErrorNote>
      <Button type="submit" className="w-full" size="lg" disabled={act.busy}>
        {act.busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Done & create
      </Button>
      <Waking show={act.slow} />
    </form>
  );
}

function Registered({ data, onSignIn }) {
  const { result, passwords } = data;
  const all = ROLES.map((r) => `${r.label}\n  Login ID: ${result.accounts[r.api].login_id}\n  Password: ${passwords[r.api]}`).join("\n");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">{result.company_name} is registered</h1>
        <p className="mt-1 text-sm text-slate-400">These three logins are now active. Share each one privately with the person who holds that role.</p>
      </div>
      <p className="flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <b>Copy the passwords now.</b> They are shown only on this screen; PUBLIVRA stores them in a form that cannot be read back.
        </span>
      </p>
      <ul className="space-y-2">
        {ROLES.map((r) => (
          <li key={r.id} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
            <div className="flex items-center gap-2">
              <r.icon className="h-4 w-4 text-indigo-300" />
              <span className="text-sm font-bold text-white">{r.label}</span>
              <span className="truncate text-[11px] text-slate-500">{result.accounts[r.api].full_name}</span>
            </div>
            <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
              <span className="text-slate-400">Login ID</span>
              <code className="truncate font-mono text-emerald-200">{result.accounts[r.api].login_id}</code>
              <CopyButton text={result.accounts[r.api].login_id} />
              <span className="text-slate-400">Password</span>
              <code className="truncate font-mono text-emerald-200">{passwords[r.api]}</code>
              <CopyButton text={passwords[r.api]} />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CopyButton text={all} label="Copy all three logins" />
        <Button onClick={onSignIn}>
          <LogIn className="h-4 w-4" /> Sign in
        </Button>
      </div>
    </div>
  );
}

/**
 * "Start as company": Register your Company, with Sign in just below it.
 * Sign in opens a popup to choose Creator, Manager or Legal Approver, then login ID + password.
 */
export default function CompanyPortal({ onBack, onLogin, initial, notice, openSignIn = false }) {
  const [view, setView] = useState("home"); // home | register | done
  const [registered, setRegistered] = useState(null);
  const [signIn, setSignIn] = useState(openSignIn || !!notice);
  const [prefill, setPrefill] = useState(initial || null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.18),transparent_60%)] px-4 py-10">
      <div className={`w-full ${view === "register" ? "max-w-3xl" : "max-w-xl"}`}>
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-2 shadow-lg shadow-indigo-900/50">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-extrabold tracking-tight text-white">PUBLIVRA AI</span>
          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Company</span>
        </div>

        <div className="fade-in rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl backdrop-blur sm:p-8">
          {view === "home" && (
            <div className="space-y-5">
              <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white">
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white">Start as company</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Each company has one Creator, one Manager and one Legal Approver. Each signs in with their own ID and password, and only sees your company's data.
                </p>
              </div>
              <Button className="w-full" size="lg" onClick={() => setView("register")}>
                <Building2 className="h-4 w-4" /> Register your Company
              </Button>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span className="h-px flex-1 bg-slate-800" /> Already registered? <span className="h-px flex-1 bg-slate-800" />
              </div>
              <Button variant="secondary" className="w-full" size="lg" onClick={() => setSignIn(true)}>
                <KeyRound className="h-4 w-4" /> Sign in
              </Button>
            </div>
          )}
          {view === "register" && (
            <RegisterCompany
              onBack={() => setView("home")}
              onRegistered={(data) => {
                setRegistered(data);
                setView("done");
              }}
            />
          )}
          {view === "done" && registered && (
            <Registered
              data={registered}
              onSignIn={() => {
                const a = registered.result.accounts;
                setPrefill({ ids: { creator: a.creator.login_id, manager: a.manager.login_id, legal: a.legal_approver.login_id } });
                setSignIn(true);
              }}
            />
          )}
        </div>
      </div>
      <SignInModal open={signIn} onClose={() => setSignIn(false)} initial={prefill} notice={notice} onLogin={onLogin} />
    </div>
  );
}
