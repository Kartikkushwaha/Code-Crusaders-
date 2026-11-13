import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Clapperboard, Clock, Eye, Film, LoaderCircle, Lock, MessageSquareText, Mic, Palette, Play, PlayCircle, ScanSearch, Sparkles, Trash2, Type, Upload, Video } from "lucide-react";
import { api } from "../lib/api.js";
import {
  ASPECT_LABEL,
  ASPECT_ORDER,
  clock,
  dataUrlToBlob,
  extractFrameSheets,
  readVideoMeta,
  STAGE_STEPS,
  STAGE_TO_STEP,
  toVideoEntry,
  validateVideoFile,
  VIDEO_ACCEPT,
  VIDEO_MAX_COUNT,
  VIDEO_MAX_MB,
  VIDEO_MAX_SECONDS,
} from "../lib/videoAudit.js";
import FindingDetails from "./FindingDetails.jsx";
import { Button, RISK_STYLE, SeverityTag, VERDICT_STYLE, VerdictBadge } from "./ui.jsx";

const ASPECT_ICON = { text: Type, speech: Mic, audio: AudioLines, colour: Palette, logo: ScanSearch, visual: Eye, tone: MessageSquareText, privacy: Lock, claim: Sparkles };
const FILTERS = [
  { id: "ALL", label: "All" },
  { id: "CONTRADICTED", label: "Contradicted" },
  { id: "UNVERIFIED", label: "Unverified" },
  { id: "VERIFIED", label: "Verified" },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One lane per aspect; each finding is a block coloured by verdict. Click a block (or the lane) to jump there. */
function Timeline({ findings, duration, now, activeId, onSeek }) {
  const lanes = ASPECT_ORDER.map((a) => ({ aspect: a, items: findings.filter((f) => f.aspect === a) })).filter((l) => l.items.length);
  const pct = (t) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;
  const ticks = [];
  for (let t = 0; t <= duration + 0.01; t += duration > 12 ? 5 : 2) ticks.push(t);
  const seekFromClick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - box.left) / box.width) * duration);
  };
  if (!lanes.length) return null;
  return (
    <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Timeline</span>
        <span className="flex gap-2.5 text-[10px] text-slate-400">
          {["VERIFIED", "UNVERIFIED", "CONTRADICTED"].map((v) => (
            <span key={v} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${VERDICT_STYLE[v].dot}`} /> {VERDICT_STYLE[v].label}
            </span>
          ))}
        </span>
      </div>
      <div className="space-y-1.5">
        {lanes.map(({ aspect, items }) => {
          const Icon = ASPECT_ICON[aspect];
          return (
            <div key={aspect} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1 truncate text-[10px] text-slate-400">
                <Icon className="h-3 w-3 shrink-0" /> {ASPECT_LABEL[aspect]}
              </span>
              <div className="relative h-5 cursor-pointer rounded bg-slate-800/70" onClick={seekFromClick}>
                {items.map((f) => (
                  <button
                    key={f.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(f.start, f.id);
                    }}
                    title={`${clock(f.start)} - ${clock(f.end)} · ${VERDICT_STYLE[f.verdict].label}: ${f.match}`}
                    aria-label={`${ASPECT_LABEL[aspect]}, ${VERDICT_STYLE[f.verdict].label}, ${clock(f.start)} to ${clock(f.end)}`}
                    className={`absolute inset-y-0.5 rounded-sm opacity-90 hover:opacity-100 ${VERDICT_STYLE[f.verdict].dot} ${activeId === f.id ? "ring-2 ring-white" : ""}`}
                    style={{ left: pct(f.start), width: `max(6px, ${((f.end - f.start) / duration) * 100}%)` }}
                  />
                ))}
                <span className="pointer-events-none absolute inset-y-0 w-px bg-white/80" style={{ left: pct(now) }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 grid grid-cols-[88px_minmax(0,1fr)] gap-2">
        <span />
        <div className="relative h-3">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 font-mono text-[9px] text-slate-500" style={{ left: pct(t) }}>
              {clock(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Details({ label, disabled, children }) {
  if (disabled) return <p className="mt-1.5 text-[11px] text-slate-500">{label}</p>;
  return (
    <details className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5">
      <summary className="cursor-pointer text-[11px] font-semibold text-slate-300">{label}</summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

function VideoResult({ v, url, onRemove, onOpenRef }) {
  const player = useRef(null);
  const [now, setNow] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const seek = useCallback((t, id) => {
    if (id) setActiveId(id);
    if (!player.current) return;
    player.current.currentTime = Math.max(0, t);
    player.current.play?.().catch(() => {});
  }, []);
  const count = (verdict) => v.findings.filter((f) => f.verdict === verdict).length;
  const shown = useMemo(() => v.findings.filter((f) => filter === "ALL" || f.verdict === filter), [v.findings, filter]);
  const rs = RISK_STYLE[v.level] || RISK_STYLE.LOW;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Film className="h-4 w-4 shrink-0 text-fuchsia-300" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{v.name}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${rs.pill}`} title="Risk score of this video">
          Video score {v.score}/100
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {clock(v.duration)} · <span className={count("CONTRADICTED") ? "text-rose-300" : ""}>{count("CONTRADICTED")} contradicted</span> ·{" "}
          <span className={count("UNVERIFIED") ? "text-amber-300" : ""}>{count("UNVERIFIED")} unverified</span> · {count("VERIFIED")} verified
        </span>
        <button onClick={onRemove} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300" aria-label={`Remove ${v.name}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {v.engineNotes.length > 0 && (
        <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-950/30 p-2 text-[11px] leading-relaxed text-amber-100">
          {v.engineNotes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0">
          {url ? (
            <video
              ref={player}
              src={url}
              controls
              playsInline
              preload="metadata"
              poster={v.poster || undefined}
              className="aspect-video w-full rounded-lg border border-slate-700 bg-black"
              onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            />
          ) : v.poster ? (
            <img src={v.poster} alt="" className="aspect-video w-full rounded-lg border border-slate-700 object-cover" />
          ) : (
            <div className="aspect-video w-full rounded-lg border border-slate-700 bg-black" />
          )}
          <Timeline findings={v.findings} duration={v.duration} now={now} activeId={activeId} onSeek={seek} />

          <div className="mt-2 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
            <p className="text-xs leading-relaxed text-slate-200">{v.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
              <span>
                Tone: <b className="text-slate-200">{v.tone.label}</b> · {v.tone.score}/10 vs {v.tone.profile}
              </span>
              <span>
                Logo: <b className="text-slate-200">{v.logoChecked ? "compared with the reference logo" : "no reference logo given"}</b>
              </span>
              {v.colours.length > 0 && (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  Colours:
                  {v.colours.map((c) => (
                    <span key={c.hex} className="inline-flex items-center gap-1" title={`${c.name || c.hex}${c.share ? ` · ${c.share}%` : ""}`}>
                      <span className="inline-block h-3.5 w-3.5 rounded border border-white/20" style={{ background: c.hex }} />
                      <span className="font-mono text-[10px]">{c.hex}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
            {v.audio.description && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                <b className="text-slate-300">Audio:</b> {v.audio.description}
              </p>
            )}
            <Details label={`Spoken words${v.transcript ? "" : " (none heard)"}`} disabled={!v.transcript}>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{v.transcript}</p>
            </Details>
            <Details label={`Text read from the video (${v.onScreenText.length})`} disabled={!v.onScreenText.length}>
              <ul className="space-y-1">
                {v.onScreenText.map((t, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-300">
                    <button onClick={() => seek(t.start)} className="shrink-0 font-mono text-[11px] text-fuchsia-200 hover:underline">
                      {clock(t.start)}
                    </button>
                    <span className="min-w-0 break-words">{t.text}</span>
                  </li>
                ))}
              </ul>
            </Details>
            <p className="mt-2 text-[10px] text-slate-500">
              {v.model} · policy: {v.policyUsed} · {v.auditId ? `Neon audit #${v.auditId}` : "not logged to Neon"}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {FILTERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  filter === t.id ? "border-fuchsia-400 bg-fuchsia-500/20 text-white" : "border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
              >
                {t.label} <span className="text-slate-400">{t.id === "ALL" ? v.findings.length : count(t.id)}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400">{v.findings.length ? "Nothing in this group." : "The AI found nothing to report in this clip."}</p>
          ) : (
            <ol className="max-h-[34rem] space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
              {shown.map((f) => {
                const Icon = ASPECT_ICON[f.aspect] || Eye;
                return (
                  <li
                    key={f.id}
                    className={`rounded-lg border border-l-4 bg-slate-900/70 p-2.5 text-xs ${VERDICT_STYLE[f.verdict].bar} ${
                      activeId === f.id ? "border-fuchsia-400/70 ring-1 ring-fuchsia-400/50" : now > 0 && now >= f.start && now <= f.end ? "border-slate-600" : "border-slate-800"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => seek(f.start, f.id)}
                        className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-fuchsia-200 hover:bg-slate-700"
                        title="Play this moment"
                      >
                        <Play className="h-3 w-3" /> {clock(f.start)} - {clock(f.end)}
                      </button>
                      <VerdictBadge verdict={f.verdict} />
                      <SeverityTag severity={f.severity} />
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
                        <Icon className="h-3 w-3" /> {ASPECT_LABEL[f.aspect] || f.category}
                      </span>
                    </div>
                    <p className="mt-1.5 break-words text-[13px] font-medium text-slate-100">“{f.match}”</p>
                    <FindingDetails f={f} onOpenRef={onOpenRef} />
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function Progress({ job }) {
  const step = STAGE_TO_STEP[job.stage] ?? 0;
  return (
    <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-3" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-100">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {job.name}: {job.message}…
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 transition-all duration-700" style={{ width: `${Math.max(3, job.progress)}%` }} />
      </div>
      <ol className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px]">
        {STAGE_STEPS.map((s, i) => (
          <li key={s.id} className={i < step ? "text-emerald-300" : i === step ? "font-semibold text-fuchsia-100" : "text-slate-500"}>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[10px] text-slate-400">Usually 15-40 seconds, or up to 2 minutes when the main AI engine is busy and the backup takes over.</p>
    </div>
  );
}

/**
 * Video audit card, directly below the images & graphics audit.
 * A clip of up to 20 seconds is analysed by the backend (Gemini video + audio understanding, with a
 * Groq backup engine) against the policy and the brand kit: on-screen text, spoken words, audio,
 * colour theme, logo (vs the reference logo), visuals and tone. Findings are kept in App state, so
 * they count towards the risk score and are sent to the manager.
 */
export default function VideoAudit({ kit, policyDoc, toneProfile, company, videos, onVideosChange, ensureSampleKit, onOpenRef, onEngineOnline, toast, log }) {
  const input = useRef(null);
  const urls = useRef(new Map());
  const runId = useRef(0);
  const [job, setJob] = useState(null); // { name, stage, progress, message }
  const latest = useRef(videos);
  latest.current = videos;
  useEffect(() => {
    const map = urls.current;
    return () => {
      runId.current += 1;
      map.forEach((u) => URL.revokeObjectURL(u));
      map.clear();
    };
  }, []);
  // a new document clears the results: release the players' object URLs too
  useEffect(() => {
    const names = new Set(videos.map((v) => v.name));
    urls.current.forEach((u, name) => {
      if (!names.has(name)) {
        URL.revokeObjectURL(u);
        urls.current.delete(name);
      }
    });
  }, [videos]);

  const run = async (file, kitOverride) => {
    if (latest.current.length >= VIDEO_MAX_COUNT && !latest.current.some((v) => v.name === file.name)) return toast(`Up to ${VIDEO_MAX_COUNT} videos per check.`, "danger");
    const problem = validateVideoFile(file);
    if (problem) return toast(problem, "danger");
    const id = ++runId.current;
    const alive = () => runId.current === id;
    const k = kitOverride || kit;
    const url = URL.createObjectURL(file);
    const stage = (s, progress, message) => alive() && setJob({ name: file.name, stage: s, progress, message });
    try {
      stage("frames", 2, "Reading the video");
      const meta = await readVideoMeta(url);
      if (meta.duration > VIDEO_MAX_SECONDS + 0.75) throw new Error(`the clip is ${meta.duration.toFixed(1)} s long. Trim it to ${VIDEO_MAX_SECONDS} seconds or less.`);
      stage("frames", 3, "Preparing still frames");
      const sheets = await extractFrameSheets(url, meta.duration);

      const form = new FormData();
      form.append("video", file, file.name);
      form.append("title", file.name);
      form.append("policy_text", policyDoc?.text || "");
      form.append("policy_name", policyDoc?.name || "");
      form.append("tone_profile", toneProfile || "Professional");
      form.append("company", (company || "").trim());
      form.append("duration", meta.duration ? String(meta.duration) : "");
      if (sheets) {
        sheets.blobs.forEach((b, i) => form.append("frames", b, `sheet-${i + 1}.jpg`));
        form.append("frame_times", JSON.stringify(sheets.times));
      }
      // brand kit: the reference logo is compared with the logo in the video
      const logo = k.logo ? dataUrlToBlob(k.logo) : null;
      if (logo) form.append("reference_logo", logo, k.logoName || "reference-logo.png");
      form.append("brand_kit", JSON.stringify({ brandName: k.brandName || "", motto: k.motto || "", colors: (k.colors || []).map((c) => ({ hex: c.hex })) }));

      stage("sending", 5, "Uploading to the PUBLIVRA server (the first request can take a minute while it wakes up)");
      log?.(`Requested AI video audit of ${file.name} against ${policyDoc ? policyDoc.name : "PUBLIVRA built-in rules"}${logo ? " and the reference logo" : ""}`);
      let state = await api.startVideoAudit(form);
      onEngineOnline?.();
      const deadline = Date.now() + 6 * 60 * 1000;
      while (alive() && state.status === "running") {
        stage(state.stage, state.progress, state.message);
        if (Date.now() > deadline) throw new Error("the analysis is taking too long. Please try again.");
        await sleep(1500);
        state = await api.videoAuditStatus(state.job_id);
      }
      if (!alive()) return URL.revokeObjectURL(url);
      if (state.status === "error") throw new Error(state.error || "the analysis failed.");

      const entry = toVideoEntry(state.result, { name: file.name, width: meta.width, height: meta.height, poster: sheets?.poster });
      const old = urls.current.get(entry.name);
      if (old) URL.revokeObjectURL(old);
      urls.current.set(entry.name, url);
      onVideosChange([...latest.current.filter((x) => x.name !== entry.name), entry]);
      const c = state.result.counts;
      log?.(
        `AI (${entry.model}) audited ${entry.name}: ${c.CONTRADICTED} contradicted, ${c.UNVERIFIED} unverified, ${c.VERIFIED} verified - video score ${entry.score}/100` +
          (entry.auditId ? ` - Neon audit #${entry.auditId}` : ""),
        "AI",
      );
      toast(`Video audit complete: ${c.CONTRADICTED} contradicted, ${c.UNVERIFIED} unverified, ${c.VERIFIED} verified.`, c.CONTRADICTED ? "danger" : "success");
    } catch (e) {
      URL.revokeObjectURL(url);
      if (alive()) {
        log?.(`AI video audit of ${file.name} failed: ${e.message}`, "AI");
        toast(`Could not audit ${file.name}: ${e.message}`, "danger");
      }
    } finally {
      if (alive()) setJob(null);
    }
  };

  const loadSample = async () => {
    try {
      setJob({ name: "sample-ad-video.mp4", stage: "frames", progress: 1, message: "Downloading the sample" });
      const blob = await (await fetch("/sample-ad-video.mp4")).blob();
      const sampleKit = await ensureSampleKit();
      await run(new File([blob], "sample-ad-video.mp4", { type: "video/mp4" }), sampleKit);
    } catch (e) {
      setJob(null);
      toast(`Could not load the sample video: ${e.message}`, "danger");
    }
  };

  const onFiles = (list) => {
    const vids = [...list].filter((f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (!vids.length) return toast("Choose an MP4, MOV or WEBM video.", "danger");
    (async () => {
      for (const f of vids) await run(f);
    })();
  };

  const busy = !!job;
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
          <h2 className="text-base font-extrabold tracking-tight text-white sm:text-lg">Upload Video — AI Video &amp; Audio Compliance Audit</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            The AI watches the clip and listens to its audio, then checks on-screen text, spoken words, music and sounds, colour theme, logo, visuals and tone against your policy.
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> Up to {VIDEO_MAX_SECONDS} seconds · {VIDEO_MAX_MB} MB · MP4, MOV or WEBM
            </span>
            <span className={`inline-flex items-center gap-1 ${kit.logo ? "text-emerald-300" : "text-amber-300"}`}>
              <ScanSearch className="h-3 w-3" />
              {kit.logo ? "Reference logo set: the logo in the video will be compared with it" : "No reference logo yet: add it above to check the logo in the video"}
            </span>
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-col">
          <Button onClick={() => input.current?.click()} disabled={busy} className="flex-1 bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 sm:flex-none">
            <Upload className="h-4 w-4" /> Upload Video
          </Button>
          <Button variant="secondary" onClick={loadSample} disabled={busy} className="flex-1 sm:flex-none">
            <PlayCircle className="h-4 w-4" /> Load Sample Ad Video
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept={VIDEO_ACCEPT}
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
          {busy && <Progress job={job} />}
          {videos.map((v) => (
            <VideoResult
              key={v.name}
              v={v}
              url={urls.current.get(v.name)}
              onOpenRef={onOpenRef}
              onRemove={() => onVideosChange(latest.current.filter((x) => x.name !== v.name))}
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
          <Video className="h-4 w-4 text-fuchsia-300" /> Drop an MP4, MOV or WEBM ad here · up to {VIDEO_MAX_SECONDS} seconds
        </button>
      )}
    </section>
  );
}
