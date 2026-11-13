import { useEffect, useState } from "react";
import { BriefcaseBusiness, PenLine, Scale, ShieldCheck } from "lucide-react";

const ROLE = {
  creator: { label: "Creator", place: "your workspace", icon: PenLine },
  manager: { label: "Manager", place: "the approval queue", icon: BriefcaseBusiness },
  legal: { label: "Legal Approver", place: "the legal review queue", icon: Scale },
};
export const ENTER_MS = 1500;

/** Short full-screen transition after signing in: who is signing in, where, and a progress bar. */
export default function EnterScreen({ role, company, name, demo }) {
  const r = ROLE[role] || ROLE.creator;
  const steps = [demo ? "Starting your demo session" : "Verifying your account", `Loading ${company || "your company"}'s data`, `Opening ${r.place}`];
  const [step, setStep] = useState(0);
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFilled(true));
    const timers = [1, 2].map((i) => setTimeout(() => setStep(i), (ENTER_MS / 3) * i));
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/95 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="w-full max-w-sm px-6 text-center">
        <div className="relative mx-auto h-20 w-20">
          <span className="absolute inset-0 animate-ping rounded-3xl bg-indigo-500/20" />
          <div className="relative grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-2xl shadow-indigo-900/60">
            <ShieldCheck className="h-9 w-9 text-white" />
          </div>
          <span className="absolute -bottom-2 -right-2 grid h-9 w-9 place-items-center rounded-full border-2 border-slate-950 bg-slate-800">
            <r.icon className="h-4 w-4 text-indigo-200" />
          </span>
        </div>
        <p className="mt-6 text-sm text-slate-400">Signing in as</p>
        <h2 className="mt-0.5 text-xl font-extrabold tracking-tight text-white">{r.label}</h2>
        <p className="mt-1 truncate text-xs text-slate-400">
          {name ? `${name} · ` : ""}
          {company}
          {demo ? " · demo" : ""}
        </p>
        <div className="mx-auto mt-6 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-fuchsia-500"
            style={{ width: filled ? "100%" : "4%", transition: `width ${ENTER_MS - 150}ms cubic-bezier(0.4, 0, 0.2, 1)` }}
          />
        </div>
        <p key={step} className="fade-in mt-3 text-xs font-medium text-indigo-200">
          {steps[step]}…
        </p>
      </div>
    </div>
  );
}
