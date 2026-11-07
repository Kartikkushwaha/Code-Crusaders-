import { Check } from "lucide-react";

const STEPS = ["Add content", "Check", "Fix issues", "Publish", "Sign off"];

export default function Stepper({ current }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px] scrollbar-thin" aria-label="Workflow progress">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex shrink-0 items-center gap-1">
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${
                done ? "bg-emerald-500/15 text-emerald-300" : active ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-500/50" : "text-slate-500"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${done ? "bg-emerald-500 text-emerald-950" : active ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-400"}`}>
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s}
            </span>
            {i < STEPS.length - 1 && <span className={`h-px w-4 sm:w-6 ${done ? "bg-emerald-500/50" : "bg-slate-800"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
