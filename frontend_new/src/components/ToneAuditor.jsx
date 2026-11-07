import { Info, MicVocal } from "lucide-react";

export default function ToneAuditor({ tone }) {
  const pct = (tone.score / 10) * 100;
  const color = tone.score >= 7 ? "#34d399" : tone.score >= 5 ? "#fbbf24" : "#fb7185";
  const sig = tone.signals;
  const rows = [
    { label: "Hype / sensational words", value: sig.hype.reduce((a, b) => a + b.count, 0), detail: sig.hype.map((h) => h.word).join(", ") },
    { label: "Casual expressions", value: sig.casual.reduce((a, b) => a + b.count, 0), detail: sig.casual.map((h) => h.word).join(", ") },
    { label: "Exclamation marks", value: sig.exclamations },
    { label: "Shouting (sentences in capitals)", value: sig.caps.length, detail: sig.caps.length ? sig.caps.join(" · ") : "Capitalised words for emphasis are fine" },
    { label: "Contractions", value: sig.contractions, detail: tone.profile === "Formal" ? "Not allowed in Formal" : "Allowed" },
  ];

  return (
    <div className="space-y-3">
      {tone.usingFallback ? (
        <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-[11px] text-sky-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Your policy does not define a tone, so PUBLIVRA AI is using its <b>default internal compliance tone</b> ({tone.profile}). Upload a policy that names a tone (for example "Tone must be formal") to change it.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-[11px] text-indigo-200">
          <MicVocal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Tone requirement loaded from your custom policy: <b>{tone.profile}</b>.
          </span>
        </div>
      )}

      <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
        <div
          className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(${color} ${pct}%, #1e293b ${pct}% 100%)` }}
          role="img"
          aria-label={`Tone score ${tone.score} out of 10`}
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-950">
            <span className="text-lg font-extrabold" style={{ color }}>
              {tone.score}
              <span className="text-[10px] text-slate-500">/10</span>
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Detected persona</div>
          <div className="text-base font-bold text-slate-100">{tone.detected}</div>
          <div className="mt-1 text-[11px] text-slate-400">
            Required: <span className="font-semibold text-slate-200">{tone.profile}</span> · {tone.meetsRequirement ? <span className="text-emerald-300">meets requirement</span> : <span className="text-rose-300">below requirement (7/10)</span>}
          </div>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">{tone.description}</p>

      <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
            <div>
              <div className="text-slate-300">{r.label}</div>
              {r.detail && <div className="mt-0.5 text-[10px] text-slate-500">{r.detail}</div>}
            </div>
            <span className={`font-mono font-semibold ${r.value ? "text-amber-300" : "text-emerald-300"}`}>{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
