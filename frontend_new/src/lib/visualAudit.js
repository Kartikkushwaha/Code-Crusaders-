/**
 * Improvement 1 - visual audit, run in the browser.
 *
 *  1. Logo check     - finds the reference logo inside the image (multi-scale template matching),
 *                      then checks it is not stretched or recoloured.
 *  2. Brand colours  - dominant colours of the image must match the policy colours.
 *  3. Text in image  - OCR; brand name and motto must be 100% identical to the policy,
 *                      everything else (ad / body text) goes to the AI deep audit.
 */
import { ocrCanvas } from "./fileParser.js";

let seq = 0;
const fid = () => `vis-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// ------------------------------------------------------------------ images
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This file could not be opened as an image."));
    img.src = src;
  });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

/** Draw an image onto a white canvas no larger than maxSide (transparent areas become white). */
export function toCanvas(img, maxSide, exact) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const k = exact ? 1 : Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round((exact?.w ?? w0 * k)));
  const h = Math.max(1, Math.round((exact?.h ?? h0 * k)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

export function thumbnail(img, side = 160) {
  return toCanvas(img, side).toDataURL("image/jpeg", 0.72);
}

/** Small PNG of the reference logo for storage. */
export function logoDataUrl(img, side = 320) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const k = Math.min(1, side / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w0 * k));
  c.height = Math.max(1, Math.round(h0 * k));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

// ------------------------------------------------------------------ colour
const lin = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export function rgbToLab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (lab) => Math.hypot(lab[1], lab[2]);
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Dominant colours (k-means in Lab) with their share of the image. */
export function dominantColors(canvas, k = 6) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor((w * h) / 6000));
  const px = [];
  for (let i = 0; i < w * h; i += step) {
    const o = i * 4;
    px.push({ rgb: [data[o], data[o + 1], data[o + 2]], lab: rgbToLab(data[o], data[o + 1], data[o + 2]) });
  }
  if (!px.length) return [];
  // deterministic k-means++ style seeding: start with the most common-ish pixel, then farthest points
  const centers = [px[Math.floor(px.length / 2)].lab.slice()];
  while (centers.length < Math.min(k, px.length)) {
    let best = null;
    let bestD = -1;
    for (const p of px) {
      const d = Math.min(...centers.map((c) => deltaE(c, p.lab)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (bestD < 4) break;
    centers.push(best.lab.slice());
  }
  let assign = new Array(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    assign = px.map((p) => {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const d = deltaE(c, p.lab);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      return bi;
    });
    centers.forEach((c, i) => {
      let n = 0;
      const s = [0, 0, 0];
      px.forEach((p, j) => {
        if (assign[j] === i) {
          n++;
          s[0] += p.lab[0];
          s[1] += p.lab[1];
          s[2] += p.lab[2];
        }
      });
      if (n) centers[i] = s.map((v) => v / n);
    });
  }
  return centers
    .map((c, i) => {
      const members = px.filter((_, j) => assign[j] === i);
      if (!members.length) return null;
      const rgb = [0, 1, 2].map((ch) => members.reduce((a, p) => a + p.rgb[ch], 0) / members.length);
      return { hex: toHex(...rgb), lab: c, share: members.length / px.length, chroma: chroma(c) };
    })
    .filter(Boolean)
    .sort((a, b) => b.share - a.share);
}

const NEUTRAL_CHROMA = 14; // whites, greys and blacks are always allowed
const SAME_COLOUR = 14; // ΔE: within screen/print tolerance of a policy colour

export function checkColours(dominant, brandColors, label) {
  const findings = [];
  const brand = (brandColors || []).map((c) => ({ ...c, lab: rgbToLab(...hexToRgb(c.hex)) }));
  const coloured = dominant.filter((d) => d.share >= 0.04 && d.chroma >= NEUTRAL_CHROMA);
  if (!brand.length) {
    if (coloured.length)
      findings.push({
        id: fid(),
        verdict: "UNVERIFIED",
        severity: "low",
        category: "Brand colours",
        match: coloured.map((d) => d.hex).join(", "),
        explanation: "The policy does not list brand colours, so the colours in this image could not be checked.",
        recommendation: "Add the brand colour codes (e.g. #4F46E5) to the policy or the brand kit.",
        clause: "Brand kit · Colours",
        image: label,
      });
    return findings;
  }
  const off = [];
  const on = [];
  const vivid = brand.filter((b) => chroma(b.lab) >= NEUTRAL_CHROMA);
  for (const d of coloured) {
    let near = brand[0];
    let dist = Infinity;
    for (const b of brand) {
      const e = deltaE(b.lab, d.lab);
      if (e < dist) {
        dist = e;
        near = b;
      }
    }
    if (dist > SAME_COLOUR && vivid.length) {
      // suggest a real brand colour, not a near-white background tone
      near = vivid.reduce((a, b) => (deltaE(b.lab, d.lab) < deltaE(a.lab, d.lab) ? b : a));
      dist = deltaE(near.lab, d.lab);
    }
    (dist <= SAME_COLOUR ? on : off).push({ ...d, near, dist });
  }
  off.forEach((d) =>
    findings.push({
      id: fid(),
      verdict: "CONTRADICTED",
      severity: d.share >= 0.15 ? "high" : "medium",
      category: "Brand colours",
      match: d.hex,
      explanation: `Off-brand colour ${d.hex.toUpperCase()} covers ${Math.round(d.share * 100)}% of the image. Closest policy colour is ${d.near.hex.toUpperCase()}${
        d.near.name ? ` (${d.near.name})` : ""
      }.`,
      recommendation: `Replace ${d.hex.toUpperCase()} with ${d.near.hex.toUpperCase()} or another approved colour.`,
      clause: "Brand kit · Colours",
      swatch: d.hex,
      expected: d.near.hex,
      image: label,
    }),
  );
  if (on.length && !off.length)
    findings.push({
      id: fid(),
      verdict: "VERIFIED",
      severity: "none",
      category: "Brand colours",
      match: on.map((d) => d.hex).join(", "),
      explanation: `All main colours match the policy palette (${[...new Set(on.map((d) => d.near.hex.toUpperCase()))].join(", ")}).`,
      clause: "Brand kit · Colours",
      image: label,
    });
  return findings;
}

// -------------------------------------------------------------------- logo
function grayOf(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}

/** Normalised cross-correlation of a template over an image, best position. */
function bestNcc(img, iw, ih, tpl, tw, th) {
  const n = tw * th;
  let tm = 0;
  for (let i = 0; i < n; i++) tm += tpl[i];
  tm /= n;
  let tv = 0;
  const t0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    t0[i] = tpl[i] - tm;
    tv += t0[i] * t0[i];
  }
  if (tv < 1e-6) return { score: 0, x: 0, y: 0 };
  // integral images for window mean / variance
  const W = iw + 1;
  const S = new Float64Array(W * (ih + 1));
  const S2 = new Float64Array(W * (ih + 1));
  for (let y = 0; y < ih; y++) {
    let row = 0;
    let row2 = 0;
    for (let x = 0; x < iw; x++) {
      const v = img[y * iw + x];
      row += v;
      row2 += v * v;
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row;
      S2[(y + 1) * W + x + 1] = S2[y * W + x + 1] + row2;
    }
  }
  const stride = Math.max(1, Math.round(Math.min(tw, th) / 10));
  let best = { score: -2, x: 0, y: 0, sign: 1 };
  const scan = (x0, x1, y0, y1, st) => {
    for (let y = y0; y <= y1; y += st) {
      for (let x = x0; x <= x1; x += st) {
        const a = y * W + x;
        const b = y * W + x + tw;
        const c = (y + th) * W + x;
        const d = (y + th) * W + x + tw;
        const sum = S[d] - S[b] - S[c] + S[a];
        const sum2 = S2[d] - S2[b] - S2[c] + S2[a];
        const iv = sum2 - (sum * sum) / n;
        if (iv < 1e-6) continue;
        let cross = 0;
        for (let ty = 0; ty < th; ty++) {
          const ro = (y + ty) * iw + x;
          const to = ty * tw;
          for (let tx = 0; tx < tw; tx++) cross += img[ro + tx] * t0[to + tx];
        }
        const ncc = cross / Math.sqrt(iv * tv);
        const abs = Math.abs(ncc);
        if (abs > best.score) best = { score: abs, x, y, sign: Math.sign(ncc) || 1 };
      }
    }
  };
  scan(0, iw - tw, 0, ih - th, stride);
  if (stride > 1) {
    const { x, y } = best;
    scan(Math.max(0, x - stride), Math.min(iw - tw, x + stride), Math.max(0, y - stride), Math.min(ih - th, y + stride), 1);
  }
  return best;
}

/**
 * Find the reference logo inside the image.
 * Returns { score 0-1, aspect (1 = not stretched), inverted, box, colourDelta, logoColour, foundColour }.
 */
export function matchLogo(imageImg, logoImg, baseSide = 220) {
  const base = toCanvas(imageImg, baseSide);
  const iw = base.width;
  const ih = base.height;
  const ig = grayOf(base);
  const lw0 = logoImg.naturalWidth || logoImg.width;
  const lh0 = logoImg.naturalHeight || logoImg.height;
  const ratio = lh0 / lw0;
  let best = { score: 0 };
  // logo width as a share of the image: fine geometric steps so small watermarks are matched at their true size
  const fractions = [];
  for (let s = 0.08; s < 1; s *= 1.16) fractions.push(s);
  fractions.push(1);
  for (const aspect of [1, 0.8, 1.25]) {
    for (const f of fractions) {
      const tw = Math.round(iw * f);
      const th = Math.round(tw * ratio * aspect);
      if (tw < 8 || th < 6 || tw > iw || th > ih) continue;
      const tpl = grayOf(toCanvas(logoImg, 0, { w: tw, h: th }));
      const r = bestNcc(ig, iw, ih, tpl, tw, th);
      // stretched variants must clearly beat the true aspect ratio to count
      const adj = aspect === 1 ? r.score : r.score - 0.1;
      if (adj > (best.adj ?? -1)) best = { ...r, adj, tw, th, aspect };
    }
  }
  if (!best.tw) return { score: 0 };
  // colour inside the matched box vs the logo's own main colour
  const region = document.createElement("canvas");
  region.width = best.tw;
  region.height = best.th;
  region.getContext("2d").drawImage(base, best.x, best.y, best.tw, best.th, 0, 0, best.tw, best.th);
  const pick = (cv) => dominantColors(cv, 4).find((c) => c.chroma >= NEUTRAL_CHROMA && c.share >= 0.05);
  const logoColour = pick(toCanvas(logoImg, 160));
  const foundColour = pick(region);
  const colourDelta = logoColour && foundColour ? deltaE(logoColour.lab, foundColour.lab) : logoColour && !foundColour ? 60 : 0;
  return {
    score: Math.max(0, best.score),
    aspect: best.aspect,
    inverted: best.sign < 0,
    box: { x: best.x / iw, y: best.y / ih, w: best.tw / iw, h: best.th / ih },
    colourDelta,
    logoColour: logoColour?.hex,
    foundColour: foundColour?.hex,
  };
}

export function logoFindings(m, label, logoName) {
  const pct = Math.round((m.score || 0) * 100);
  const base = { category: "Logo", clause: "Brand kit · Reference logo", image: label, match: `Logo match ${pct}%` };
  if (!m.score || m.score < 0.5)
    return [
      {
        ...base,
        id: fid(),
        verdict: "UNVERIFIED",
        severity: "medium",
        explanation: `The reference logo${logoName ? ` (${logoName})` : ""} was not found in this image (best match ${pct}%). The logo is missing or a different logo is used.`,
        recommendation: "Place the approved logo from the brand kit, unchanged.",
      },
    ];
  const out = [];
  if (m.score < 0.7)
    out.push({
      ...base,
      id: fid(),
      verdict: "CONTRADICTED",
      severity: "medium",
      explanation: `A logo was found but it only matches the reference ${pct}%. It looks altered (redrawn, cropped, distorted or an old version).`,
      recommendation: "Replace it with the approved reference logo file.",
    });
  if (m.aspect !== 1)
    out.push({
      ...base,
      id: fid(),
      verdict: "CONTRADICTED",
      severity: "high",
      match: m.aspect > 1 ? "Logo stretched vertically" : "Logo squashed vertically",
      explanation: "The logo's proportions differ from the reference logo. Logos must not be stretched or squashed.",
      recommendation: "Resize the logo proportionally (lock the aspect ratio).",
    });
  if (m.inverted)
    out.push({
      ...base,
      id: fid(),
      verdict: "UNVERIFIED",
      severity: "low",
      match: "Inverted logo",
      explanation: "The logo appears in reversed (light-on-dark) form. Check the policy allows the reversed version.",
      recommendation: "Use the reversed logo only if the brand guidelines permit it.",
    });
  if (m.colourDelta > 18)
    out.push({
      ...base,
      id: fid(),
      verdict: "CONTRADICTED",
      severity: "high",
      match: `Logo recoloured ${m.foundColour ? m.foundColour.toUpperCase() : ""}`.trim(),
      explanation: `The logo colour (${m.foundColour?.toUpperCase() || "none"}) differs from the reference logo colour (${m.logoColour?.toUpperCase()}).`,
      recommendation: `Use the logo in its original colour ${m.logoColour?.toUpperCase()}.`,
      swatch: m.foundColour,
      expected: m.logoColour,
    });
  if (!out.length)
    out.push({
      ...base,
      id: fid(),
      verdict: "VERIFIED",
      severity: "none",
      explanation: `Reference logo found (${pct}% match), correct proportions and colour.`,
    });
  return out;
}

// -------------------------------------------------------------------- text
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
const squash = (s) => s.replace(/\s+/g, " ").trim();

/** Best fuzzy window of words in the OCR text for a target phrase. */
function bestWindow(words, target) {
  const tw = target.split(" ").length;
  let best = { score: 0, start: 0, len: 0, text: "" };
  for (let len = Math.max(1, tw - 1); len <= tw + 1; len++) {
    for (let i = 0; i + len <= words.length; i++) {
      const text = words.slice(i, i + len).join(" ");
      const s = sim(text.toLowerCase(), target.toLowerCase());
      if (s > best.score) best = { score: s, start: i, len, text };
    }
  }
  return best;
}

/**
 * Brand name and motto must be 100% identical to the policy (case, spelling and punctuation).
 * Returns { findings, bodyText } - bodyText is the OCR text minus those phrases (the "ad text").
 */
export function checkBrandText(ocrText, kit, label) {
  const findings = [];
  const words = squash(ocrText).split(" ").filter(Boolean);
  const used = new Set();
  const checks = [
    { key: "brandName", name: "Brand name", value: squash(kit.brandName || "") },
    { key: "motto", name: "Motto", value: squash(kit.motto || "") },
  ];
  for (const c of checks) {
    if (!c.value || !words.length) continue;
    const w = bestWindow(words, c.value);
    if (w.score < 0.6) continue; // not present in the image
    for (let i = w.start; i < w.start + w.len; i++) used.add(i);
    const base = { id: fid(), category: "Brand name & motto", clause: `Brand kit · ${c.name}`, image: label, match: w.text };
    if (w.text === c.value) findings.push({ ...base, verdict: "VERIFIED", severity: "none", explanation: `${c.name} is identical to the policy: "${c.value}".` });
    else
      findings.push({
        ...base,
        verdict: "CONTRADICTED",
        severity: c.key === "brandName" ? "high" : "medium",
        explanation: `${c.name} reads "${w.text}" but the policy requires exactly "${c.value}"${
          w.text.toLowerCase() === c.value.toLowerCase() ? " (capitalisation differs)" : ""
        }.`,
        recommendation: `Write the ${c.name.toLowerCase()} exactly as "${c.value}".`,
        suggestion: { find: w.text, replace: c.value },
      });
  }
  const bodyText = words.filter((_, i) => !used.has(i)).join(" ");
  return { findings, bodyText };
}

// --------------------------------------------------------------- one image
/**
 * Full visual audit of one image.
 * kit: { logo (dataURL), logoName, colors, brandName, motto }
 */
export async function auditImage(file, kit, onStep = () => {}) {
  const url = await fileToDataUrl(file);
  const img = await loadImage(url);
  const label = file.name;
  const findings = [];

  onStep("Checking colours");
  const dom = dominantColors(toCanvas(img, 160));
  findings.push(...checkColours(dom, kit.colors, label));

  let logo = null;
  if (kit.logo) {
    onStep("Looking for the logo");
    await new Promise((r) => setTimeout(r, 0));
    logo = matchLogo(img, await loadImage(kit.logo));
    findings.push(...logoFindings(logo, label, kit.logoName));
  } else {
    findings.push({
      id: fid(),
      verdict: "UNVERIFIED",
      severity: "low",
      category: "Logo",
      match: "No reference logo",
      explanation: "No reference logo is set in the brand kit, so logo use could not be checked.",
      recommendation: "Upload the approved logo in the brand kit.",
      clause: "Brand kit · Reference logo",
      image: label,
    });
  }

  onStep("Reading text in the image");
  let ocr = { text: "", confidence: 0, error: null };
  try {
    ocr = await ocrCanvas(toCanvas(img, 1800));
  } catch (e) {
    ocr.error = e.message || "OCR failed";
  }
  const brand = checkBrandText(ocr.text, kit, label);
  findings.push(...brand.findings);

  return {
    name: label,
    size: file.size,
    width: img.naturalWidth,
    height: img.naturalHeight,
    thumb: thumbnail(img),
    colours: dom.slice(0, 6).map(({ hex, share }) => ({ hex, share: Math.round(share * 100) })),
    logo,
    ocrText: ocr.text,
    ocrConfidence: ocr.confidence,
    ocrError: ocr.error,
    adText: brand.bodyText,
    findings,
  };
}

// ------------------------------------------------- content logo vs reference logo
/**
 * Direct check of the logo file used in the content against the reference (approved) logo:
 *   shape     - both logos are trimmed to their visible area, scaled to the same size and compared
 *               (normalised cross-correlation of the grey levels; a negative score means inverted)
 *   proportions - the height / width ratio of the visible area (stretched or squashed)
 *   colour    - the main brand colour of each logo (ΔE in Lab)
 */

/** Visible area of a logo: pixels that differ from the corner (background) colour. Works on RGBA data. */
export function contentBox(data, w, h, tol = 40) {
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  const bg = [0, 1, 2].map((c) => corners.reduce((a, p) => a + p[c], 0) / 4);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (Math.max(Math.abs(data[o] - bg[0]), Math.abs(data[o + 1] - bg[1]), Math.abs(data[o + 2] - bg[2])) > tol) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Normalised cross-correlation of two equal-length arrays: 1 identical, 0 unrelated, -1 inverted. */
export function ncc(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    num += da * db;
    va += da * da;
    vb += db * db;
  }
  return va < 1e-6 || vb < 1e-6 ? 0 : num / Math.sqrt(va * vb);
}

/** Findings for the comparison. cmp: { similarity (-1..1), aspectChange (test/ref ratio), colourDelta, refColour, testColour } */
export function logoCompareFindings(cmp, label, logoName) {
  const pct = Math.round(Math.max(0, cmp.similarity) * 100);
  const base = { category: "Logo", clause: "Brand kit · Reference logo", image: label, match: `Logo match ${pct}%`, score: pct };
  const out = [];
  if (cmp.similarity <= -0.5) {
    out.push({
      ...base,
      id: fid(),
      verdict: "UNVERIFIED",
      severity: "low",
      match: "Inverted logo",
      explanation: "This is the reference logo in reversed (light-on-dark) form. Check the policy allows the reversed version.",
      recommendation: "Use the reversed logo only if the brand guidelines permit it.",
    });
  } else if (cmp.similarity < 0.55) {
    out.push({
      ...base,
      id: fid(),
      verdict: "CONTRADICTED",
      severity: "high",
      match: `Different logo (${pct}% match)`,
      explanation: `This logo does not match the reference logo${logoName ? ` (${logoName})` : ""}: only ${pct}% alike. It is a different or heavily redrawn logo.`,
      recommendation: "Use the approved reference logo file.",
    });
  } else if (cmp.similarity < 0.8) {
    out.push({
      ...base,
      id: fid(),
      verdict: "CONTRADICTED",
      severity: "medium",
      match: `Logo altered (${pct}% match)`,
      explanation: `The logo resembles the reference but differs in shape or detail (${pct}% alike): it may be cropped, redrawn, rotated or an old version.`,
      recommendation: "Replace it with the approved reference logo file.",
    });
  }
  const stretch = cmp.aspectChange - 1;
  if (Math.abs(stretch) > 0.08)
    out.push({
      ...base,
      id: fid(),
      verdict: "CONTRADICTED",
      severity: "high",
      match: stretch > 0 ? `Logo stretched vertically ${Math.round(stretch * 100)}%` : `Logo squashed vertically ${Math.round(-stretch * 100)}%`,
      explanation: "The logo's proportions (height to width) differ from the reference logo. Logos must not be stretched or squashed.",
      recommendation: "Resize the logo proportionally (lock the aspect ratio).",
    });
  if (cmp.colourDelta > 18)
    out.push({
      ...base,
      id: fid(),
      verdict: "CONTRADICTED",
      severity: "high",
      match: `Logo recoloured ${cmp.testColour ? cmp.testColour.toUpperCase() : ""}`.trim(),
      explanation: `The logo colour (${cmp.testColour?.toUpperCase() || "none"}) differs from the reference logo colour (${cmp.refColour?.toUpperCase()}).`,
      recommendation: `Use the logo in its original colour ${cmp.refColour?.toUpperCase()}.`,
      swatch: cmp.testColour,
      expected: cmp.refColour,
    });
  if (!out.length)
    out.push({
      ...base,
      id: fid(),
      verdict: "VERIFIED",
      severity: "none",
      explanation: `Matches the reference logo (${pct}% alike), with the same proportions and colour.`,
    });
  return out;
}

/** Trim to the visible area and redraw at exactly w x h. */
function trimmed(img, w, h) {
  const c = toCanvas(img, 400);
  const box = contentBox(c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, w, h);
  return { canvas: out, ratio: box.h / box.w };
}

/**
 * Audit the logo file used in the content against kit.logo (the reference).
 * Returns an image entry (kind: "logo") so it counts in the logo & graphics score and goes to the manager.
 */
export async function auditContentLogo(file, kit) {
  const img = await loadImage(await fileToDataUrl(file));
  const label = `Content logo · ${file.name}`;
  const entry = {
    kind: "logo",
    name: label,
    fileName: file.name,
    size: file.size,
    width: img.naturalWidth,
    height: img.naturalHeight,
    thumb: thumbnail(img),
    colours: [],
    logo: null,
    ocrText: "",
    adText: "",
    adFindings: [],
    adStatus: "none",
  };
  if (!kit.logo) {
    entry.findings = [
      {
        id: fid(),
        verdict: "UNVERIFIED",
        severity: "medium",
        category: "Logo",
        match: "No reference logo",
        explanation: "Upload the reference (approved) logo to compare this logo with it.",
        recommendation: "Upload the reference logo on the left.",
        clause: "Brand kit · Reference logo",
        image: label,
      },
    ];
    return entry;
  }
  const ref = await loadImage(kit.logo);
  // reference shape at its own proportions; the content logo is drawn into the same box, so a
  // stretched logo is still compared shape-for-shape and its distortion is reported separately
  const refProbe = trimmed(ref, 120, 120);
  const W = 96;
  const H = Math.max(8, Math.min(192, Math.round(W * refProbe.ratio)));
  const r = trimmed(ref, W, H);
  const t = trimmed(img, W, H);
  const pick = (cv) => dominantColors(cv, 4).find((c) => c.chroma >= NEUTRAL_CHROMA && c.share >= 0.05);
  const refColour = pick(r.canvas);
  const testColour = pick(t.canvas);
  const cmp = {
    similarity: ncc(grayOf(t.canvas), grayOf(r.canvas)),
    aspectChange: t.ratio / r.ratio,
    colourDelta: refColour && testColour ? deltaE(refColour.lab, testColour.lab) : refColour && !testColour ? 60 : 0,
    refColour: refColour?.hex,
    testColour: testColour?.hex,
  };
  entry.compare = { ...cmp, score: Math.round(Math.max(0, cmp.similarity) * 100) };
  entry.colours = dominantColors(toCanvas(img, 160)).slice(0, 4).map(({ hex, share }) => ({ hex, share: Math.round(share * 100) }));
  entry.findings = logoCompareFindings(cmp, label, kit.logoName);
  return entry;
}
