import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, GripHorizontal, Maximize2, PictureInPicture2, Play, X } from "lucide-react";

// Demo walkthrough, streamed from Google Drive (both files are shared as "anyone with the link").
const VIDEO_ID = "1Boa4uGYYvNqVXV7AwX5OR7ARaYnh_QyV";
const POSTER_ID = "1DUJmNPJJXwo5-DOMywVroFRwa9udvNOv";
const EMBED_URL = `https://drive.google.com/file/d/${VIDEO_ID}/preview`;
const POSTERS = [
  `https://drive.google.com/thumbnail?id=${POSTER_ID}&sz=w1280`,
  `https://lh3.googleusercontent.com/d/${POSTER_ID}=w1280`,
];

const FLOAT_W = 440; // floating player width in px (16:9 video + header)
const MARGIN = 16;

/** Poster with a play button; opening it gives a floating player or a full-screen one. */
export function DemoVideoCard({ onOpen }) {
  const [posterIdx, setPosterIdx] = useState(0);
  const poster = POSTERS[posterIdx];
  return (
    <div className="flex flex-col rounded-3xl border border-fuchsia-500/40 bg-slate-900/80 p-6 text-left shadow-2xl sm:p-7 md:col-span-2 lg:col-span-1">
      <div className="flex items-center gap-3">
        <div className="w-fit rounded-2xl bg-gradient-to-br from-fuchsia-600 to-violet-600 p-3">
          <Clapperboard className="h-6 w-6 text-white" />
        </div>
        <span className="rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-fuchsia-200">
          Watch first
        </span>
      </div>
      <h2 className="mt-4 text-xl font-extrabold tracking-tight text-white">Demo walkthrough</h2>
      <p className="mt-1.5 text-sm text-slate-400">See a full check from draft to publish before you try it.</p>

      <button
        onClick={() => onOpen("float")}
        className="group relative mt-4 aspect-video w-full overflow-hidden rounded-2xl border border-slate-700 bg-slate-950"
        aria-label="Play the demo walkthrough"
      >
        {poster ? (
          <img
            src={poster}
            alt="PUBLIVRA AI demo walkthrough"
            referrerPolicy="no-referrer"
            onError={() => setPosterIdx((i) => i + 1)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-indigo-900 via-slate-900 to-fuchsia-900" />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <span className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/95 shadow-xl transition group-hover:scale-110">
          <Play className="ml-0.5 h-6 w-6 fill-indigo-600 text-indigo-600" />
        </span>
      </button>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => onOpen("float")}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-bold text-slate-200 hover:border-fuchsia-400 hover:text-white"
        >
          <PictureInPicture2 className="h-4 w-4" /> Floating
        </button>
        <button
          onClick={() => onOpen("full")}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-3 py-2 text-xs font-bold text-white hover:brightness-110"
        >
          <Maximize2 className="h-4 w-4" /> Full screen
        </button>
      </div>
    </div>
  );
}

/**
 * The player. One iframe stays mounted while switching between floating and full screen, so
 * the video keeps playing from the same point. The floating window can be dragged by its bar.
 */
export function DemoVideoPlayer({ mode, onMode, onClose }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [pos, setPos] = useState(null); // top-left of the floating window; null = bottom-right corner

  const clamp = useCallback((x, y) => {
    const el = boxRef.current;
    const w = el?.offsetWidth || FLOAT_W;
    const h = el?.offsetHeight || 280;
    return {
      x: Math.min(Math.max(MARGIN, x), window.innerWidth - w - MARGIN),
      y: Math.min(Math.max(MARGIN, y), window.innerHeight - h - MARGIN),
    };
  }, []);

  // Full screen: also ask the browser for real full screen; leaving it keeps the full-window view.
  useEffect(() => {
    if (mode !== "full") {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      return;
    }
    boxRef.current?.requestFullscreen?.().catch(() => {});
  }, [mode]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (mode === "full" && !document.fullscreenElement) onMode("float");
      else if (mode === "float") onClose();
    };
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [mode, onMode, onClose, clamp]);

  const startDrag = (e) => {
    if (mode !== "float" || e.button !== 0 || e.target.closest("button")) return;
    const r = boxRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e) => {
    if (!drag.current) return;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  };
  const endDrag = () => (drag.current = null);

  const full = mode === "full";
  const floatStyle = pos ? { left: pos.x, top: pos.y, width: FLOAT_W } : { right: MARGIN, bottom: MARGIN, width: FLOAT_W };

  return (
    <>
      {full && <div className="fixed inset-0 z-[60] bg-black/90" onClick={() => onMode("float")} aria-hidden="true" />}
      <div
        ref={boxRef}
        role="dialog"
        aria-label="PUBLIVRA AI demo walkthrough"
        style={full ? undefined : { ...floatStyle, maxWidth: `calc(100vw - ${MARGIN * 2}px)` }}
        className={
          full
            ? "fixed inset-0 z-[61] flex flex-col bg-black"
            : "fixed z-[61] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
        }
      >
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`flex items-center gap-2 px-3 py-2 ${full ? "bg-black" : "cursor-move select-none border-b border-slate-800 bg-slate-900"}`}
        >
          {!full && <GripHorizontal className="h-4 w-4 text-slate-500" aria-hidden="true" />}
          <span className="truncate text-xs font-bold text-slate-200">Demo walkthrough · PUBLIVRA AI</span>
          <div className="ml-auto flex items-center gap-1">
            {full ? (
              <button
                onClick={() => onMode("float")}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10"
                title="Switch to the floating player"
              >
                <PictureInPicture2 className="h-4 w-4" /> Floating
              </button>
            ) : (
              <button
                onClick={() => onMode("full")}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                title="Full screen"
                aria-label="Full screen"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className={`rounded-lg p-1.5 ${full ? "text-slate-300 hover:bg-white/10" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
              title="Close"
              aria-label="Close the demo video"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className={full ? "flex flex-1 items-center justify-center p-2 sm:p-6" : ""}>
          <div className="aspect-video w-full" style={full ? { maxWidth: "min(100%, calc((100vh - 6rem) * 16 / 9))" } : undefined}>
            <iframe
              src={EMBED_URL}
              title="PUBLIVRA AI demo walkthrough"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0 bg-black"
            />
          </div>
        </div>
      </div>
    </>
  );
}
