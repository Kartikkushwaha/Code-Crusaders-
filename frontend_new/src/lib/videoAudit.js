// Video audit helpers: client-side validation, still frames for the backup engine, timestamps and
// mapping of backend results. The analysis itself (frames, on-screen text, audio, tone, logo) is done
// by the backend's video audit: Gemini video + audio understanding, with a Groq backup engine.

export const VIDEO_MAX_SECONDS = 20;
export const VIDEO_MAX_MB = 40;
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm";

// Timeline lanes, in display order. Keys match the backend's `aspect`.
export const ASPECT_ORDER = ["text", "speech", "audio", "colour", "logo", "visual", "tone", "privacy", "claim"];
export const ASPECT_LABEL = {
  text: "On-screen text",
  speech: "Spoken words",
  audio: "Audio",
  colour: "Colour theme",
  logo: "Logo",
  visual: "Visuals",
  tone: "Tone",
  privacy: "Privacy",
  claim: "Claims",
};

export const STAGE_STEPS = [
  { id: "sending", label: "Upload" },
  { id: "validating", label: "Validate" },
  { id: "uploading", label: "Send to AI" },
  { id: "analysing", label: "Analyse" },
  { id: "aggregating", label: "Match policy" },
];
// queued/processing are shown under their neighbouring step
export const STAGE_TO_STEP = { frames: 0, sending: 0, queued: 1, validating: 1, uploading: 2, processing: 2, analysing: 3, backup: 3, aggregating: 4, done: 5 };

export const VIDEO_MAX_COUNT = 3;

/** 00:07 - used by the review panel and the PDF. */
export const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function clock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Duration and frame size, read by the browser from the file's metadata (nothing is uploaded). */
export function readVideoMeta(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const done = (fn, arg) => {
      clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new Error("This video could not be read. Try exporting it as MP4.")), 10000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      // Some WebM recordings report Infinity until the end is known.
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      done(resolve, { duration: d, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => done(reject, new Error("This browser cannot play that video. Upload an MP4, MOV or WebM clip."));
    v.src = url;
  });
}

/** Returns an error message, or null when the file can be sent. */
export function validateVideoFile(file) {
  const okType = /^video\/(mp4|quicktime|webm|x-m4v)$/.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
  if (!okType) return "Upload an MP4, MOV or WebM video.";
  if (file.size > VIDEO_MAX_MB * 1024 * 1024) return `The video is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${VIDEO_MAX_MB} MB.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** Backend video finding -> the shape FindingDetails and the dashboard use. */
export function toUiVideoFinding(f) {
  return {
    id: f.id,
    ai: true,
    start: f.start,
    end: f.end,
    aspect: f.aspect,
    category: f.category,
    verdict: f.verdict,
    severity: f.verdict === "VERIFIED" ? "none" : f.severity,
    match: f.claim_text,
    explanation: f.explanation,
    source: f.source_reference,
    policyRef: f.policy_ref || null,
    policyQuote: f.policy_quote || f.policy_ref?.text || "",
    recommendation: f.recommendation || "",
  };
}

const SHEETS = 3; // Groq vision models accept up to 3 images per request
const TILES = 4; // 2 x 2 tiles per sheet -> 12 frames in total
const TILE_LONG_SIDE = 640;

/**
 * Still frames for the backup engine (used only when Gemini is busy): 12 frames spread over the clip,
 * drawn onto 3 JPEG contact sheets of 2 x 2 tiles, each tile stamped with its time. Frames are dealt
 * out in turn (frame 1 -> sheet 1, frame 2 -> sheet 2, ...), so every sheet spans the whole clip.
 * Runs in the browser, so the server needs no FFmpeg. Returns null if the frames can't be read.
 */
export async function extractFrameSheets(url, duration) {
  if (!duration || duration <= 0) return null;
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  const once = (event, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} timed out`)), ms);
      v.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true });
      v.addEventListener("error", () => (clearTimeout(timer), reject(new Error("video error"))), { once: true });
    });
  try {
    const ready = once("loadeddata", 10000);
    v.src = url;
    await ready;
    if (!v.videoWidth || !v.videoHeight) return null;
    const scale = TILE_LONG_SIDE / Math.max(v.videoWidth, v.videoHeight);
    const tw = Math.round(v.videoWidth * scale);
    const th = Math.round(v.videoHeight * scale);
    const sheets = Array.from({ length: SHEETS }, () => {
      const c = document.createElement("canvas");
      c.width = tw * 2;
      c.height = th * 2;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, c.width, c.height);
      return { canvas: c, ctx, times: [] };
    });
    const total = SHEETS * TILES;
    let poster = null;
    for (let i = 0; i < total; i++) {
      const t = Math.min(duration - 0.05, ((i + 0.5) * duration) / total);
      const seeked = once("seeked", 5000);
      v.currentTime = t;
      await seeked;
      const sheet = sheets[i % SHEETS];
      const slot = sheet.times.length;
      const x = (slot % 2) * tw;
      const y = Math.floor(slot / 2) * th;
      sheet.ctx.drawImage(v, x, y, tw, th);
      const label = `${t.toFixed(1)}s`;
      sheet.ctx.font = "bold 20px sans-serif";
      sheet.ctx.fillStyle = "rgba(0,0,0,0.75)";
      sheet.ctx.fillRect(x, y, sheet.ctx.measureText(label).width + 14, 28);
      sheet.ctx.fillStyle = "#fff";
      sheet.ctx.fillText(label, x + 7, y + 21);
      sheet.times.push(Number(t.toFixed(1)));
      if (i === 1) {
        // small poster for the results card and the manager's review panel
        const pc = document.createElement("canvas");
        pc.width = 240;
        pc.height = Math.round((240 * th) / tw);
        pc.getContext("2d").drawImage(v, 0, 0, pc.width, pc.height);
        poster = pc.toDataURL("image/jpeg", 0.6);
      }
    }
    const blobs = await Promise.all(sheets.map((s) => new Promise((resolve) => s.canvas.toBlob(resolve, "image/jpeg", 0.8))));
    if (blobs.some((b) => !b)) return null;
    return { blobs, times: sheets.map((s) => s.times), poster };
  } catch {
    return null; // e.g. a codec this browser can't decode: the main engine doesn't need the frames
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

/** data:image/png;base64,... -> Blob (the reference logo is kept as a data URL in the brand kit). */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!m) return null;
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: m[1] });
}

/**
 * Backend result -> the video entry kept in App state. Its findings count towards the risk score,
 * are sent to the manager and feed the charts, exactly like image findings.
 */
export function toVideoEntry(result, { name, width, height, poster }) {
  return {
    name,
    duration: result.duration,
    width,
    height,
    poster: poster || null,
    findings: (result.findings || []).map((f) => ({
      ...toUiVideoFinding(f),
      id: `${f.id}:${name}`,
      time: f.start,
      clause: `Video · ${ASPECT_LABEL[f.aspect] || f.category}`,
      image: name,
    })),
    summary: result.summary,
    tone: { score: result.tone_score, label: result.overall_tone, profile: result.tone_profile },
    colours: result.colours || [],
    audio: result.audio || {},
    transcript: result.transcript || "",
    onScreenText: result.on_screen_text || [],
    model: result.model,
    engine: result.engine,
    engineNotes: result.engine_notes || [],
    logoChecked: !!result.logo_checked,
    policyUsed: result.policy_used,
    auditId: result.audit_id ?? null,
    score: result.risk_score,
    level: result.risk_level,
  };
}
