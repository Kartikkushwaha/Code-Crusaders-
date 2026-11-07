import { Bot, History, User } from "lucide-react";
import { EmptyState, RISK_STYLE } from "./ui.jsx";

export default function AuditTrail({ publications, activity, onOpenVerification }) {
  return (
    <div className="fade-in mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <History className="h-6 w-6 text-indigo-400" /> Audit Trail
        </h1>
        <p className="mt-1 text-sm text-slate-400">Every publication and action - who, what, when, and whether AI or a human did it.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-bold">Publications</h2>
        {publications.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No publications yet">Documents you publish appear here with their risk level and sign-off status.</EmptyState>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Document</th>
                  <th className="px-3 py-2">Published</th>
                  <th className="px-3 py-2">Risk</th>
                  <th className="px-3 py-2">Release</th>
                  <th className="px-3 py-2">Sign-off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {publications.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-200">{p.title}</div>
                      <div className="text-[10px] text-slate-500">{p.fileName}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{new Date(p.at).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${RISK_STYLE[p.risk.level].pill}`}>{p.risk.level}</span>
                    </td>
                    <td className="px-3 py-2">{p.overridden ? <span className="font-semibold text-rose-300">Override</span> : <span className="text-slate-400">Standard</span>}</td>
                    <td className="px-3 py-2">
                      {p.status === "closed" ? (
                        <span className="text-emerald-300">
                          {p.approver.name} · {p.approver.role}
                        </span>
                      ) : (
                        <button onClick={() => onOpenVerification(p.id)} className="font-semibold text-amber-300 underline hover:text-amber-200">
                          Pending - complete checklist
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-bold">Activity log</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No activity yet.</p>
        ) : (
          <ol className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-800/40">
                <span className={`mt-0.5 rounded-md p-1 ${a.actor === "AI" ? "bg-indigo-500/15 text-indigo-300" : "bg-emerald-500/15 text-emerald-300"}`}>
                  {a.actor === "AI" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                </span>
                <span className="flex-1 text-slate-300">{a.message}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-500">{new Date(a.at).toLocaleTimeString("en-IN")}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
