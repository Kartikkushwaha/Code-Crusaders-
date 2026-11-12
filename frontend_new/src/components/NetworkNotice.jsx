import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";

const KEY = "publivra.networkNotice.seen";

function seen() {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Shown once per browser session when the app first opens. */
export default function NetworkNotice() {
  const [open, setOpen] = useState(() => !seen());
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!open) return null;
  function dismiss() {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setClosing(true);
    setTimeout(() => setOpen(false), 220);
  }
  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm transition-opacity duration-200 ${closing ? "opacity-0" : "opacity-100"}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="net-title"
    >
      <div className={`w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl transition-all duration-200 ${closing ? "scale-95 opacity-0" : "fade-in scale-100"}`}>
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/15">
          <Wifi className="h-6 w-6 text-sky-300" />
        </div>
        <h2 id="net-title" className="mt-4 text-xl font-extrabold tracking-tight text-white">
          Network Stability Notice
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Please ensure that you have a good and stable internet connection. On slower networks, loading compliance insights and audit history may take 2–3 seconds.
        </p>
        <button
          autoFocus
          onClick={dismiss}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 hover:from-blue-500 hover:to-indigo-500"
        >
          I Understand / Continue
        </button>
      </div>
    </div>
  );
}
