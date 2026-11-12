/**
 * Video audit - samples frames across the video and runs the same checks as the image audit
 * on each one, with real timestamps:
 *   - brand watermark / logo (present, unchanged, right colour and proportions)
 *   - brand colours on screen
 *   - on-screen captions (OCR): brand name & motto must be identical; the rest goes to the AI deep audit
 * Spoken audio is NOT transcribed in the browser; it is flagged for a reviewer to listen to.
 */
import { checkBrandText, checkColours, dominantColors, loadImage, logoFindings, matchLogo, rgbToLab, toCanvas } from "./visualAudit.js";
import { ocrCanvas } from "./fileParser.js";

let seq = 0;
const fid = () => `vid-${Date.now().toString(36)}-${(seq++).toString(36)}`;
export const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const MAX_FRAMES = 12;

function once(el, ok, bad = "error", ms = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The video took too long to load."));
    }, ms);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onBad = () => {
      cleanup();
      reject(new Error("This video can't be played in this browser. Try an MP4 (H.264) or WEBM file."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(ok, onOk);
      el.removeEventListener(bad, onBad);
    };
    el.addEventListener(ok, onOk);
    el.addEventListener(bad, onBad);
  });
}

async function seek(video, t) {
  if (Math.abs(video.currentTime - t) < 0.01) return;
  const p = once(video, "seeked");
  video.currentTime = t;
  await p;
}

function frameCanvas(video, maxSide = 960) {
  const w0 = video.videoWidth;
  const h0 = video.videoHeight;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w0 * k));
  c.height = Math.max(1, Math.round(h0 * k));
  c.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/** Classify a frame's logo result into one short state. */
function logoState(fs) {
  const bad = fs.find((f) => f.verdict === "CONTRADICTED") || fs.find((f) => f.verdict === "UNVERIFIED");
  if (!bad) return { key: "ok", f: fs[0] };
  if (/not found|missing/i.test(bad.explanation)) return { key: "missing", f: bad };
  if (/recoloured/i.test(bad.match)) return { key: "recoloured", f: bad };
  if (/stretched|squashed/i.test(bad.match)) return { key: "distorted", f: bad };
  return { key: "altered", f: bad };
}

const LOGO_TEXT = {
  ok: { title: "Brand watermark verified", verdict: "VERIFIED", severity: "none" },
  missing: { title: "Brand watermark missing", verdict: "UNVERIFIED", severity: "medium" },
  recoloured: { title: "Brand watermark recoloured", verdict: "CONTRADICTED", severity: "high" },
  distorted: { title: "Brand watermark stretched or squashed", verdict: "CONTRADICTED", severity: "high" },
  altered: { title: "Brand watermark altered", verdict: "CONTRADICTED", severity: "medium" },
};

/**
 * Audit a video file (or a URL) against the brand kit.
 * onAuditCaptions(text, label, findings) -> { findings, note } runs the rule checks + AI deep audit.
 */
export async function auditVideo({ src, name, kit, onStep = () => {}, onAuditCaptions }) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  onStep("Loading the video");
  await once(video, "loadeddata");
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) throw new Error("Could not read the video length.");

  const count = Math.min(MAX_FRAMES, Math.max(3, Math.ceil(duration / 2)));
  const times = Array.from({ length: count }, (_, i) => Math.min(duration - 0.05, (duration / count) * (i + 0.5)));
  const logoImg = kit.logo ? await loadImage(kit.logo) : null;

  const frames = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    onStep(`Checking frame ${i + 1} of ${times.length} (${fmtTime(t)})`);
    await seek(video, t);
    const canvas = frameCanvas(video);
    const label = `${name} @ ${fmtTime(t)}`;
    const colourFindings = checkColours(dominantColors(toCanvas(canvas, 160)), kit.colors, label);
    // watermarks are small: match on a larger frame than for still images
    const logo = logoImg ? logoState(logoFindings(matchLogo(canvas, logoImg, 360), label, kit.logoName)) : null;
    let text = "";
    try {
      text = (await ocrCanvas(canvas)).text;
    } catch {
      /* OCR unavailable - captions skipped for this frame */
    }
    const brand = checkBrandText(text, kit, label);
    frames.push({ t, thumb: toCanvas(canvas, 120).toDataURL("image/jpeg", 0.6), colourFindings, logo, text, brand });
  }
  const poster = frames[0]?.thumb || null;
  const findings = [];
  const at = (t, title) => `[${fmtTime(t)}] ${title}`;

  // --- watermark / logo: one finding per run of frames in the same state
  if (logoImg) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const L = LOGO_TEXT[run.key];
      const range = run.start === run.end ? fmtTime(run.start) : `${fmtTime(run.start)}-${fmtTime(run.end)}`;
      findings.push({
        id: fid(),
        time: run.start,
        verdict: L.verdict,
        severity: L.severity,
        category: "Logo",
        match: at(run.start, L.title),
        explanation: run.key === "ok" ? `The approved logo is visible and unchanged from ${range}.` : `${run.f.explanation} (${range})`,
        recommendation: run.f.recommendation,
        clause: "Brand kit · Reference logo",
        swatch: run.f.swatch,
        expected: run.f.expected,
      });
    };
    for (const fr of frames) {
      if (run && run.key === fr.logo.key) run.end = fr.t;
      else {
        flush();
        run = { key: fr.logo.key, start: fr.t, end: fr.t, f: fr.logo.f };
      }
    }
    flush();
  } else {
    findings.push({
      id: fid(),
      time: 0,
      verdict: "UNVERIFIED",
      severity: "low",
      category: "Logo",
      match: at(0, "Watermark not checked"),
      explanation: "No reference logo is set in the brand kit, so the brand watermark could not be checked.",
      recommendation: "Upload the approved logo in the brand kit.",
      clause: "Brand kit · Reference logo",
    });
  }

  // --- colours: each off-brand colour once, at the first second it appears
  const seen = [];
  for (const fr of frames) {
    for (const f of fr.colourFindings.filter((x) => x.verdict !== "VERIFIED" && x.swatch)) {
      const lab = rgbToLab(...[1, 3, 5].map((i) => parseInt(f.swatch.slice(i, i + 2), 16)));
      const prev = seen.find((s) => Math.hypot(s.lab[0] - lab[0], s.lab[1] - lab[1], s.lab[2] - lab[2]) < 12);
      if (prev) {
        prev.frames++;
        continue;
      }
      seen.push({ lab, frames: 1, f: { ...f, id: fid(), time: fr.t, match: at(fr.t, `Off-brand colour ${f.swatch.toUpperCase()}`) } });
    }
  }
  if (seen.length)
    seen.forEach((s) => findings.push({ ...s.f, explanation: `${s.f.explanation.replace(/ of the image/, " of the frame")} Seen in ${s.frames} of ${frames.length} sampled frames.` }));
  else if (kit.colors?.length)
    findings.push({
      id: fid(),
      time: 0,
      verdict: "VERIFIED",
      severity: "none",
      category: "Brand colours",
      match: at(0, "Brand colours on-brand"),
      explanation: `All ${frames.length} sampled frames use the policy colours.`,
      clause: "Brand kit · Colours",
    });

  // --- captions: brand name & motto (identical), once per distinct reading
  const brandSeen = new Set();
  for (const fr of frames) {
    for (const f of fr.brand.findings) {
      const k = `${f.clause}|${f.verdict}|${f.match}`;
      if (brandSeen.has(k)) continue;
      brandSeen.add(k);
      findings.push({ ...f, id: fid(), time: fr.t, match: at(fr.t, `Caption: ${f.match}`) });
    }
  }

  // --- captions: everything else goes to the rule checks + AI deep audit
  const lines = [];
  for (const fr of frames) {
    const body = fr.brand.bodyText.trim();
    if (body && !lines.some((l) => l.text === body)) lines.push({ t: fr.t, text: body });
  }
  let captionNote = "";
  if (lines.length && onAuditCaptions) {
    onStep("AI deep audit of the on-screen captions");
    const text = lines.map((l) => l.text).join("\n");
    const res = await onAuditCaptions(text, `${name} (captions)`, findings);
    captionNote = res.note || "";
    for (const f of res.findings) {
      const needle = String(f.match || "").toLowerCase();
      const line = lines.find((l) => needle && l.text.toLowerCase().includes(needle)) || lines[0];
      findings.push({ ...f, id: fid(), time: line.t, match: at(line.t, `Caption: ${f.match}`) });
    }
  } else if (!lines.length) {
    captionNote = "No on-screen captions were read in the sampled frames.";
  }

  // --- audio: honest about what is not analysed
  findings.push({
    id: fid(),
    time: 0,
    verdict: "UNVERIFIED",
    severity: "low",
    category: "Audio",
    match: at(0, "Voiceover needs manual review"),
    explanation: "Spoken audio is not transcribed in this version, so voiceover claims are unverified. A reviewer must listen to the full video before approval.",
    recommendation: "Listen to the voiceover and confirm it matches the approved script.",
    clause: "Audio",
  });

  findings.sort((a, b) => a.time - b.time);
  return {
    name,
    duration,
    width: video.videoWidth,
    height: video.videoHeight,
    poster,
    frames: frames.map((f) => ({ t: f.t, thumb: f.thumb, state: f.logo?.key || "na", text: f.text })),
    captionNote,
    findings,
  };
}
