import { ArrowRight, Building2, Lock, PlayCircle, Repeat, ShieldCheck, Users } from "lucide-react";

function Brand() {
  return (
    <div className="mb-8 flex items-center justify-center gap-2.5">
      <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-2 shadow-lg shadow-indigo-900/50">
        <ShieldCheck className="h-5 w-5 text-white" />
      </div>
      <span className="text-lg font-extrabold tracking-tight text-white">PUBLIVRA AI</span>
    </div>
  );
}

function Channel({ icon: Icon, accent, title, desc, points, cta, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col rounded-3xl border bg-slate-900/80 p-6 text-left shadow-2xl transition hover:-translate-y-0.5 sm:p-7 ${accent.border}`}
    >
      <div className={`w-fit rounded-2xl p-3 ${accent.icon}`}>
        <Icon className="h-6 w-6 text-white" />
      </div>
      <h2 className="mt-4 text-xl font-extrabold tracking-tight text-white">{title}</h2>
      <p className="mt-1.5 text-sm text-slate-400">{desc}</p>
      <ul className="mt-4 space-y-2 text-xs text-slate-300">
        {points.map(([PIcon, text]) => (
          <li key={text} className="flex items-start gap-2">
            <PIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {text}
          </li>
        ))}
      </ul>
      <span className={`mt-6 inline-flex items-center gap-1.5 text-sm font-bold ${accent.cta}`}>
        {cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

/** First screen: two separate channels - a free demo, or a real company workspace. */
export default function Landing({ onDemo, onCompany }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.18),transparent_60%)] px-4 py-10">
      <div className="w-full max-w-4xl">
        <Brand />
        <h1 className="text-center text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Brand-compliance checks before you publish</h1>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-400">Text, logo, images and video checked against your policy, then approved by your manager and legal team.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Channel
            icon={PlayCircle}
            accent={{ border: "border-amber-500/40 hover:border-amber-400", icon: "bg-gradient-to-br from-amber-500 to-orange-600", cta: "text-amber-200" }}
            title="Take a demo"
            desc="Try every feature straight away. No account needed."
            points={[
              [Repeat, "Switch freely between Creator, Manager and Legal Approver"],
              [Users, "Any company name; sample content, logo and video included"],
              [Lock, "Everything stays in this browser"],
            ]}
            cta="Take a demo"
            onClick={onDemo}
          />
          <Channel
            icon={Building2}
            accent={{ border: "border-indigo-500/50 hover:border-indigo-400", icon: "bg-gradient-to-br from-blue-600 to-indigo-600", cta: "text-indigo-200" }}
            title="Start as company"
            desc="Register your company and give each role its own login."
            points={[
              [Users, "One Creator, one Manager and one Legal Approver per company"],
              [Lock, "Each person signs in with their own ID and password"],
              [ShieldCheck, "A company only ever sees its own content and approvals"],
            ]}
            cta="Start as company"
            onClick={onCompany}
          />
        </div>
      </div>
    </div>
  );
}
