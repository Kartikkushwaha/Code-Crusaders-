// Dependency-free PDF writer for the "Publish Verification Engine".
// Converts the editor DOM (headings, paragraphs, lists, bold/italic/underline,
// alignment) into a formatted A4 PDF and appends an audit certificate.

// Helvetica glyph widths (1/1000 em) for ASCII 32..126.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Unicode -> WinAnsi code points for common typographic characters.
const WINANSI = {
  "‘": 145, "’": 146, "“": 147, "”": 148, "•": 149,
  "–": 150, "—": 151, "…": 133, "€": 128, " ": 32,
};
const WIN_WIDTH = { 145: 222, 146: 222, 147: 333, 148: 333, 149: 350, 150: 556, 151: 1000, 133: 1000, 128: 556 };

function normalizeChars(s) {
  return s.replace(/₹\s?/g, "Rs. ").replace(/[​-‍﻿]/g, "");
}

function charCode(ch) {
  if (WINANSI[ch] !== undefined) return WINANSI[ch];
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return c;
  if (c >= 160 && c <= 255) return c;
  return 63; // '?'
}

function glyphWidth(code) {
  if (code >= 32 && code <= 126) return HELV[code - 32];
  return WIN_WIDTH[code] ?? 556;
}

export function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of normalizeChars(str)) w += glyphWidth(charCode(ch));
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

function pdfString(str) {
  let out = "";
  for (const ch of normalizeChars(str)) {
    const c = charCode(ch);
    if (c === 40 || c === 41 || c === 92) out += "\\" + String.fromCharCode(c);
    else if (c > 126 || c < 32) out += "\\" + c.toString(8).padStart(3, "0");
    else out += String.fromCharCode(c);
  }
  return `(${out})`;
}

const rgb = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v.toFixed(3)).join(" ");
};

// ------------------------------------------------------------ DOM -> blocks
export function domToBlocks(root) {
  const blocks = [];
  const runsOf = (el) => {
    const runs = [];
    const walk = (node, style) => {
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
          const t = n.nodeValue.replace(/\s+/g, " ");
          if (t) runs.push({ text: t, ...style });
        } else if (n.nodeType === 1) {
          if (n.tagName === "BR") { runs.push({ text: "\n", ...style }); return; }
          if (["UL", "OL"].includes(n.tagName)) return; // nested lists handled separately
          const fw = n.style?.fontWeight;
          walk(n, {
            bold: style.bold || ["B", "STRONG"].includes(n.tagName) || fw === "bold" || Number(fw) >= 600,
            italic: style.italic || ["I", "EM"].includes(n.tagName) || n.style?.fontStyle === "italic",
            underline: style.underline || n.tagName === "U" || (n.style?.textDecoration || "").includes("underline"),
          });
        }
      });
    };
    walk(el, { bold: false, italic: false, underline: false });
    if (runs.length) runs[0].text = runs[0].text.replace(/^\s+/, "");
    return runs.filter((r) => r.text);
  };
  const alignOf = (el) => {
    const a = el.style?.textAlign || el.getAttribute?.("align") || "left";
    return ["center", "right", "justify"].includes(a) ? a : "left";
  };

  const visit = (el, depth = 0) => {
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        if (n.nodeValue.trim()) blocks.push({ type: "p", align: "left", runs: [{ text: n.nodeValue.trim() }] });
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (["H1", "H2", "H3"].includes(tag)) blocks.push({ type: tag.toLowerCase(), align: alignOf(n), runs: runsOf(n) });
      else if (tag === "UL" || tag === "OL") {
        let i = 0;
        n.querySelectorAll(":scope > li").forEach((li) => {
          i += 1;
          blocks.push({ type: "li", ordered: tag === "OL", index: i, depth, align: alignOf(li), runs: runsOf(li) });
          li.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => visit({ childNodes: [sub] }, depth + 1));
        });
      } else if (["P", "DIV", "BLOCKQUOTE"].includes(tag)) {
        if (n.querySelector("p,h1,h2,h3,ul,ol,div")) visit(n, depth);
        else blocks.push({ type: "p", align: alignOf(n), runs: runsOf(n) });
      } else {
        blocks.push({ type: "p", align: "left", runs: runsOf({ childNodes: [n] }) });
      }
    });
  };
  visit(root);
  return blocks.filter((b) => b.runs.some((r) => r.text.trim()));
}

// --------------------------------------------------------------- the writer
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M_L = 62;
const M_R = 62;
const M_TOP = 84;
const M_BOTTOM = 70;
const CONTENT_W = PAGE_W - M_L - M_R;

const STYLE = {
  h1: { size: 20, bold: true, before: 4, after: 10, leading: 1.25, color: "#0f172a" },
  h2: { size: 14.5, bold: true, before: 14, after: 6, leading: 1.3, color: "#1e3a8a" },
  h3: { size: 12, bold: true, before: 10, after: 4, leading: 1.3, color: "#1e293b" },
  p: { size: 10.5, bold: false, before: 0, after: 8, leading: 1.5, color: "#1f2937" },
  li: { size: 10.5, bold: false, before: 0, after: 4, leading: 1.5, color: "#1f2937" },
};

class Writer {
  constructor() {
    this.pages = [];
    this.newPage();
  }
  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - M_TOP;
  }
  ensure(h) {
    if (this.y - h < M_BOTTOM) this.newPage();
  }
  font(bold, italic) {
    return bold && italic ? "F4" : bold ? "F2" : italic ? "F3" : "F1";
  }
  text(x, y, str, { size = 10.5, bold = false, italic = false, color = "#1f2937" } = {}) {
    this.ops.push(`BT /${this.font(bold, italic)} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(str)} Tj ET`);
  }
  rect(x, y, w, h, fill, stroke) {
    if (fill) this.ops.push(`${rgb(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    if (stroke) this.ops.push(`${rgb(stroke)} RG 0.8 w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  }
  line(x1, y1, x2, y2, color = "#cbd5e1", width = 0.6) {
    this.ops.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  /** Lay out styled runs as wrapped lines. */
  flow(runs, { size, leading, color, align = "left", indent = 0, bold: forceBold = false }) {
    const maxW = CONTENT_W - indent;
    const tokens = [];
    runs.forEach((r) => {
      r.text.split(/(\s+)/).forEach((t) => {
        if (!t) return;
        if (t.includes("\n")) tokens.push({ br: true });
        else tokens.push({ text: t, space: /^\s+$/.test(t), bold: r.bold || forceBold, italic: r.italic, underline: r.underline });
      });
    });
    const lines = [];
    let cur = [];
    let w = 0;
    const push = () => {
      while (cur.length && cur[cur.length - 1].space) cur.pop();
      lines.push(cur);
      cur = [];
      w = 0;
    };
    tokens.forEach((t) => {
      if (t.br) return push();
      if (t.space) {
        if (!cur.length) return;
        t = { ...t, text: " " };
      }
      let tw = textWidth(t.text, size, t.bold);
      if (!t.space && w + tw > maxW && cur.length) push();
      // hard-break very long words
      if (!t.space && tw > maxW) {
        let chunk = "";
        for (const ch of t.text) {
          if (textWidth(chunk + ch, size, t.bold) > maxW) {
            cur.push({ ...t, text: chunk });
            push();
            chunk = "";
          }
          chunk += ch;
        }
        t = { ...t, text: chunk };
        tw = textWidth(chunk, size, t.bold);
      }
      cur.push({ ...t, w: tw });
      w += tw;
    });
    if (cur.length) push();

    const lh = size * leading;
    lines.forEach((ln, idx) => {
      this.ensure(lh);
      const baseline = this.y - size;
      const lineW = ln.reduce((a, t) => a + t.w, 0);
      let x = M_L + indent;
      let extraSpace = 0;
      if (align === "center") x += (maxW - lineW) / 2;
      else if (align === "right") x += maxW - lineW;
      else if (align === "justify" && idx < lines.length - 1) {
        const spaces = ln.filter((t) => t.space).length;
        if (spaces) extraSpace = (maxW - lineW) / spaces;
      }
      // group consecutive tokens with identical style into one Tj
      let seg = null;
      const flushSeg = () => {
        if (!seg) return;
        this.text(seg.x, baseline, seg.text, { size, bold: seg.bold, italic: seg.italic, color });
        if (seg.underline) this.line(seg.x, baseline - 1.6, seg.x + seg.w, baseline - 1.6, color, 0.6);
        seg = null;
      };
      ln.forEach((t) => {
        const tw = t.w + (t.space ? extraSpace : 0);
        const same = seg && seg.bold === t.bold && seg.italic === t.italic && seg.underline === t.underline && !extraSpace;
        if (same) {
          seg.text += t.text;
          seg.w += tw;
        } else {
          flushSeg();
          seg = { x, text: t.text, w: tw, bold: t.bold, italic: t.italic, underline: t.underline };
        }
        x += tw;
      });
      flushSeg();
      this.y -= lh;
    });
  }

  space(h) {
    this.y -= h;
  }
}

function wrapPlain(str, size, maxW, bold) {
  const words = str.split(/\s+/);
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size, bold) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  });
  if (cur) lines.push(cur);
  return lines;
}

function drawBanner(wr, { fill, stroke, titleColor, bodyColor, title, lines }) {
  const bodyLines = lines.flatMap((l) => wrapPlain(l, 9.5, CONTENT_W - 28, false));
  const h = 20 + 14 + bodyLines.length * 13;
  wr.ensure(h + 10);
  const top = wr.y;
  wr.rect(M_L, top - h, CONTENT_W, h, fill, stroke);
  wr.rect(M_L, top - h, 4, h, stroke);
  wr.text(M_L + 14, top - 18, title, { size: 10.5, bold: true, color: titleColor });
  bodyLines.forEach((l, i) => wr.text(M_L + 14, top - 34 - i * 13, l, { size: 9.5, color: bodyColor }));
  wr.y = top - h - 16;
}

const VERDICT_COLOR = { VERIFIED: "#047857", UNVERIFIED: "#b45309", CONTRADICTED: "#b91c1c" };

/**
 * Build the final publication PDF.
 * @returns {Blob}
 */
export function buildPublicationPdf({ title, blocks, risk, tone, findings, dismissed, policyName, overridden, publishedAt, sourceLabel, aiInfo, approvals }) {
  const wr = new Writer();
  const date = new Date(publishedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  // Status banner at the top of page 1.
  if (overridden) {
    drawBanner(wr, {
      fill: "#fef2f2", stroke: "#dc2626", titleColor: "#991b1b", bodyColor: "#7f1d1d",
      title: "HIGH RISK - PUBLISHED BY MANUAL OVERRIDE",
      lines: [
        "PUBLIVRA AI will not be held responsible for compliance breaches.",
        `The publisher confirmed this release despite ${risk.counts.high} high-severity and ${risk.counts.contradicted} total contradicted finding(s) on ${date}.`,
      ],
    });
  } else {
    const medium = risk.level === "MEDIUM";
    drawBanner(wr, {
      fill: medium ? "#fffbeb" : "#ecfdf5", stroke: medium ? "#d97706" : "#059669",
      titleColor: medium ? "#92400e" : "#065f46", bodyColor: medium ? "#78350f" : "#064e3b",
      title: `${risk.level} RISK - READY TO PUBLISH`,
      lines: [
        `Audited against ${policyName} on ${date}. ${risk.counts.verified} verified, ${risk.counts.unverified} unverified, ${risk.counts.contradicted} contradicted.`,
        ...(approvals ? [approvals] : []),
      ],
    });
  }

  // Document body.
  blocks.forEach((b, i) => {
    const st = STYLE[b.type] || STYLE.p;
    if (i > 0) wr.space(st.before);
    if (b.type === "li") {
      const indent = 18 + (b.depth || 0) * 16;
      wr.ensure(st.size * st.leading);
      const marker = b.ordered ? `${b.index}.` : "•";
      wr.text(M_L + indent - 12, wr.y - st.size, marker, { size: st.size, color: "#334155", bold: b.ordered });
      wr.flow(b.runs, { ...st, align: b.align, indent });
    } else {
      wr.ensure(st.size * st.leading * 2);
      wr.flow(b.runs, { ...st, align: b.align, bold: st.bold });
      if (b.type === "h1") {
        wr.line(M_L, wr.y + 2, PAGE_W - M_R, wr.y + 2, "#c7d2fe", 1);
        wr.space(4);
      }
    }
    wr.space(st.after);
  });

  // Audit certificate.
  wr.newPage();
  wr.flow([{ text: "PUBLIVRA AI Audit Certificate" }], { ...STYLE.h1 });
  wr.line(M_L, wr.y + 2, PAGE_W - M_R, wr.y + 2, "#c7d2fe", 1);
  wr.space(12);
  const rows = [
    ["Document", title],
    ["Source", sourceLabel],
    ["Policy", policyName],
    ["Published", date],
    ["Risk level", `${risk.level} (score ${risk.score}/100)`],
    ["Claim verdicts", `${risk.counts.verified} verified · ${risk.counts.unverified} unverified · ${risk.counts.contradicted} contradicted`],
    ["Tone", `${tone.detected} - ${tone.score}/10 against "${tone.profile}"${tone.usingFallback ? " (default internal tone)" : " (custom policy)"}`],
    ["Overrides", `${Object.keys(dismissed).length} finding(s) dismissed with a recorded reason`],
    ["Release mode", overridden ? "Manual override of HIGH risk gate" : "Standard release"],
    [
      "AI deep audit",
      aiInfo
        ? `${aiInfo.model} · ${aiInfo.retrieval} retrieval${aiInfo.auditId ? ` · Neon audit #${aiInfo.auditId}` : ""}${aiInfo.stale ? " · document edited after the AI run" : ""}`
        : "Not run - rule engine findings only",
    ],
  ];
  rows.forEach(([k, v]) => {
    const lines = wrapPlain(String(v), 10, CONTENT_W - 130, false);
    wr.ensure(lines.length * 14 + 6);
    wr.text(M_L, wr.y - 10, k, { size: 9.5, bold: true, color: "#475569" });
    lines.forEach((l, i) => wr.text(M_L + 130, wr.y - 10 - i * 14, l, { size: 10, color: "#0f172a" }));
    wr.y -= lines.length * 14 + 6;
    wr.line(M_L, wr.y + 3, PAGE_W - M_R, wr.y + 3, "#e2e8f0", 0.5);
  });

  wr.space(14);
  wr.flow([{ text: "Findings at time of publication" }], { ...STYLE.h2 });
  wr.space(4);
  const active = findings.filter((f) => !dismissed[f.id]);
  if (!active.length) wr.flow([{ text: "No findings were open at publication." }], STYLE.p);
  active.slice(0, 40).forEach((f) => {
    const head = `${f.verdict} · ${f.ai ? "AI · " : ""}${f.category}${f.severity !== "none" ? ` · ${f.severity}` : ""}`;
    const body = `"${f.match}" - ${f.explanation} Source: ${f.source}.`;
    const lines = wrapPlain(body, 9, CONTENT_W - 12, false);
    wr.ensure(16 + lines.length * 12);
    wr.text(M_L, wr.y - 10, head, { size: 9, bold: true, color: VERDICT_COLOR[f.verdict] });
    lines.forEach((l, i) => wr.text(M_L + 12, wr.y - 23 - i * 12, l, { size: 9, color: "#334155" }));
    wr.y -= 18 + lines.length * 12;
  });
  if (active.length > 40) wr.flow([{ text: `+ ${active.length - 40} more findings recorded in the PUBLIVRA AI audit trail.` }], STYLE.p);

  const dismissedList = findings.filter((f) => dismissed[f.id]);
  if (dismissedList.length) {
    wr.space(10);
    wr.flow([{ text: "Human overrides" }], { ...STYLE.h2 });
    dismissedList.forEach((f) => {
      wr.flow([{ text: `"${f.match}" (${f.verdict}) - reason: ${dismissed[f.id]}` }], { ...STYLE.li, indent: 12 });
    });
  }

  wr.space(14);
  drawBanner(wr, {
    fill: "#eff6ff", stroke: "#2563eb", titleColor: "#1e3a8a", bodyColor: "#1e3a8a",
    title: "AI disclosure & human verification",
    lines: [
      "Findings were generated by PUBLIVRA AI's deterministic rule engine and, where run, an LLM audit (Groq, with Gemini as fallback) restricted to retrieved approved sources (Qdrant). AI never auto-publishes: a named human approver must complete the Human Verification checklist before external release.",
    ],
  });

  // Page furniture (header/footer) now that the page count is known.
  const total = wr.pages.length;
  wr.pages.forEach((ops, i) => {
    const hdr = [];
    const t = (x, y, s, o) => hdr.push(`BT /${o.bold ? "F2" : "F1"} ${o.size} Tf ${rgb(o.color)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(s)} Tj ET`);
    hdr.push(`${rgb("#4f46e5")} rg ${M_L} ${PAGE_H - 46} 14 14 re f`);
    t(M_L + 20, PAGE_H - 43, "PUBLIVRA AI", { size: 10, bold: true, color: "#1e1b4b" });
    t(M_L + 92, PAGE_H - 43, "Evidence-backed publication", { size: 8.5, color: "#64748b" });
    const badge = overridden ? "OVERRIDE · HIGH RISK" : `${risk.level} RISK`;
    t(PAGE_W - M_R - textWidth(badge, 8.5, true), PAGE_H - 43, badge, {
      size: 8.5, bold: true, color: overridden || risk.level === "HIGH" ? "#b91c1c" : risk.level === "MEDIUM" ? "#b45309" : "#047857",
    });
    hdr.push(`${rgb("#e2e8f0")} RG 0.6 w ${M_L} ${PAGE_H - 56} m ${PAGE_W - M_R} ${PAGE_H - 56} l S`);
    hdr.push(`${rgb("#e2e8f0")} RG 0.6 w ${M_L} 48 m ${PAGE_W - M_R} 48 l S`);
    const foot = `Page ${i + 1} of ${total}`;
    t(M_L, 34, title.length > 70 ? title.slice(0, 67) + "..." : title, { size: 8, color: "#94a3b8" });
    t(PAGE_W - M_R - textWidth(foot, 8), 34, foot, { size: 8, color: "#94a3b8" });
    if (overridden) t(M_L, 22, "PUBLIVRA AI will not be held responsible for compliance breaches.", { size: 7.5, bold: true, color: "#b91c1c" });
    ops.unshift(...hdr);
  });

  return assemble(wr.pages, title);
}

function assemble(pages, title) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add(null);
  const pagesId = add(null);
  const fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"].map((f) =>
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`),
  );
  const fontRes = `<< /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R /F4 ${fonts[3]} 0 R >>`;
  const pageIds = pages.map((ops) => {
    const stream = ops.join("\n");
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontRes} >> /Contents ${contentId} 0 R >>`);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const infoId = add(`<< /Title ${pdfString(title)} /Producer (PUBLIVRA AI Publish Verification Engine) /Creator (PUBLIVRA AI) >>`);

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += `${String(o).padStart(10, "0")} 00000 n \n`));
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const slugify = (s) =>
  (s || "document").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
