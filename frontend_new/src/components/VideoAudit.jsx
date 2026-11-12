import { useEffect, useRef, useState } from "react";
import { Clapperboard, Film, LoaderCircle, PlayCircle, Trash2, Upload, Video } from "lucide-react";
import { Button, VerdictBadge } from "./ui.jsx";
import { auditVideo, fmtTime } from "../lib/videoAudit.js";

const MAX_VIDEOS = 3;
const MAX_MB = 200;
const STATE_COLOR = { ok: "bg-emerald-400", missing: "bg-amber-400", recoloured: "bg-rose-500", distorted: "bg-rose-500", altered: "bg-rose-400", na: "bg-slate-500" };

function VideoResult({ v, url, onRemove }) {
  const player = useRef(null);
  const jump = (t) => {
    if (!player.current) return;
    player.current.currentTime = t;
    player.current.play?.().catch(() => {});
  };
  const bad = v.findings.filter((f) => f.verdict === "CONTRADICTED").length;
  const unv = v.findings.filter((f) => f.verdict === "UNVERIFIED").length;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Film className="h-4 w-4 shrink-0 text-fuchsia-300" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{v.name}</span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {fmtTime(v.duration)} · <span className={bad ? "text-rose-300" : ""}>{bad} contradicted</span> · <span className={unv ? "text-amber-300" : ""}>{unv} unverified</span>
        </span>
        <button onClick={onRemove} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300" aria-label={`Remove ${v.name}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="min-w-0">
          {url ? (
            <video ref={player} src={url} controls playsInline poster={v.poster || undefined} className="aspect-video w-full rounded-lg border border-slate-700 bg-black" />
          ) : (
            <img src={v.poster} alt="" className="aspect-video w-full rounded-lg border border-slate-700 object-cover" />
          )}
          {/* frame timeline: colour = watermark state at that moment */}
          <div className="mt-2 flex gap-0.5" aria-label="Sampled frames">
            {v.frames.map((f) => (
              <button key={f.t} onClick={() => jump(f.t)} title={`${fmtTime(f.t)} · watermark ${f.state}`} className="group relative min-w-0 flex-1">
                <img src={f.thumb} alt="" className="aspect-video w-full rounded-sm object-cover opacity-80 group-hover:opacity-100" />
                <span className={`absolute inset-x-0 bottom-0 h-1 rounded-b-sm ${STATE_COLOR[f.state]}`} />
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">{v.frames.length} frames sampled across the video. Click a frame or a timestamp to jump there.</p>
        </div>
        <ol className="max-h-80 min-w-0 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
          {v.findings.map((f) => (
            <li key={f.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => jump(f.time)} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-fuchsia-200 hover:bg-slate-700">
                  {fmtTime(f.time)}
                </button>
                <VerdictBadge verdict={f.verdict} />
                <span className="text-[10px] uppercase tracking-wider text-slate-500">{f.category}</span>
              </div>
              <div className="mt-1 break-words font-medium text-slate-200">{f.match.replace(/^\[\d\d:\d\d\]\s*/, "")}</div>
              <p className="mt-0.5 break-words text-slate-400">{f.explanation}</p>
              {f.recommendation && f.verdict !== "VERIFIED" && <p className="mt-0.5 break-words text-emerald-300/90">Fix: {f.recommendation}</p>}
            </li>
          ))}
          {v.captionNote && <li className="px-1 text-[11px] text-slate-500">{v.captionNote}</li>}
        </ol>
      </div>
    </div>
  );
}

/** Improvement 1+ : video audit card, directly below the images & graphics audit. */
export default function VideoAudit({ kit, videos, onVideosChange, onAuditAdText, ensureSampleKit, toast, log }) {
  const input = useRef(null);
  const urls = useRef(new Map());
  const [busy, setBusy] = useState(null);
  const latest = useRef(videos);
  latest.current = videos;
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const run = async (file) => {
    if (latest.current.length >= MAX_VIDEOS) return toast(`Up to ${MAX_VIDEOS} videos per check.`, "danger");
    if (file.size > MAX_MB * 1024 * 1024) return toast(`Videos up to ${MAX_MB} MB.`, "danger");
    const url = URL.createObjectURL(file);
    setBusy({ name: file.name, step: "Loading the video" });
    try {
      const k = file.__sampleKit || kit;
      const v = await auditVideo({ src: url, name: file.name, kit: k, onStep: (step) => setBusy({ name: file.name, step }), onAuditCaptions: onAuditAdText });
      urls.current.set(v.name, url);
      onVideosChange([...latest.current.filter((x) => x.name !== v.name), v]);
      log?.(`Video audit of ${v.name}: ${v.findings.filter((f) => f.verdict === "CONTRADICTED").length} contradicted, ${v.findings.filter((f) => f.verdict === "UNVERIFIED").length} unverified`, "AI");
    } catch (e) {
      URL.revokeObjectURL(url);
      toast(`Could not audit ${file.name}: ${e.message}`, "danger");
    } finally {
      setBusy(null);
    }
  };

  const loadSample = async () => {
    try {
      setBusy({ name: "sample-ad-video.mp4", step: "Downloading the sample" });
      const blob = await (await fetch("/sample-ad-video.mp4")).blob();
      const file = new File([blob], "sample-ad-video.mp4", { type: "video/mp4" });
      file.__sampleKit = await ensureSampleKit();
      await run(file);
    } catch (e) {
      setBusy(null);
      toast(`Could not load the sample video: ${e.message}`, "danger");
    }
  };

  const onFiles = (list) => {
    const vids = [...list].filter((f) => /^video\//.test(f.type) || /\.(mp4|mov|webm)$/i.test(f.name));
    if (!vids.length) return toast("Choose an MP4, MOV or WEBM video.", "danger");
    (async () => {
      for (const f of vids) await run(f);
    })();
  };

  return (
    <section
      aria-label="Video audit"
      className="relative overflow-hidden rounded-2xl border-2 border-fuchsia-500/60 bg-gradient-to-br from-fuchsia-500/10 via-slate-900/80 to-indigo-500/10 shadow-[0_0_40px_-12px_rgba(217,70,239,0.55)]"
    >
      <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
        <div className="rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 p-3 shadow-lg shadow-fuchsia-900/40">
          <Clapperboard className="h-6 w-6 text-white" />
        </div>
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-extrabold tracking-tight text-white sm:text-lg">Upload Video — Real-Time Frame-by-Frame &amp; Audio Compliance Engine</h2>
            <span className="rounded-full border border-fuchsia-400/50 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-200">New</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            Eliminate regulatory blind spots before launch—our multimodal AI audits on-screen captions, brand watermarks, colours and tone across every second of your video.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Checks frames across the whole video for the logo, brand colours and captions. Spoken voiceover is flagged for a reviewer to listen to.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-col">
          <Button onClick={() => input.current?.click()} disabled={!!busy} className="flex-1 bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 sm:flex-none">
            <Upload className="h-4 w-4" /> Upload Video
          </Button>
          <Button variant="secondary" onClick={loadSample} disabled={!!busy} className="flex-1 sm:flex-none">
            <PlayCircle className="h-4 w-4" /> Load Sample Ad Video
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          multiple
          className="hidden"
          aria-label="Upload video"
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {(busy || videos.length > 0) && (
        <div className="space-y-3 border-t border-fuchsia-500/20 p-4">
          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-100" aria-live="polite">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {busy.name}: {busy.step}…
            </div>
          )}
          {videos.map((v) => (
            <VideoResult
              key={v.name}
              v={v}
              url={urls.current.get(v.name)}
              onRemove={() => {
                const u = urls.current.get(v.name);
                if (u) URL.revokeObjectURL(u);
                urls.current.delete(v.name);
                onVideosChange(latest.current.filter((x) => x.name !== v.name));
              }}
            />
          ))}
        </div>
      )}
      {!busy && !videos.length && (
        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
          }}
          className="mx-4 mb-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl border border-dashed border-fuchsia-500/40 px-4 py-4 text-xs text-slate-300 hover:bg-fuchsia-500/5"
        >
          <Video className="h-4 w-4 text-fuchsia-300" /> Drop an MP4, MOV or WEBM ad here · up to {MAX_MB} MB
        </button>
      )}
    </section>
  );
}
