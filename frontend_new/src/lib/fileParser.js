// Client-side extraction for uploaded content.
// PDF -> text via pdf.js (text layer only; images/graphics are Round 3 scope).
// TeX -> lightweight conversion of sections, emphasis and itemize lists.
// TXT / MD -> paragraphs.

import { escapeHtml } from "./editorUtils.js";

let pdfjsPromise = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const looksLikeHeading = (line) =>
  line.length < 70 && !/[.,;:]$/.test(line) && /^[A-Z0-9]/.test(line) && line.split(" ").length <= 9;

function linesToHtml(lines) {
  const html = [];
  let para = [];
  let list = [];
  const flushPara = () => {
    if (para.length) html.push(`<p>${escapeHtml(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) html.push(`<ul>${list.map((li) => `<li>${escapeHtml(li)}</li>`).join("")}</ul>`);
    list = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); return; }
    const bullet = line.match(/^(?:[•\-*▪●◦]|\d+[.)])\s+(.*)$/);
    if (bullet) { flushPara(); list.push(bullet[1]); return; }
    flushList();
    if (looksLikeHeading(line) && para.length === 0) {
      html.push(i === 0 ? `<h1>${escapeHtml(line)}</h1>` : `<h2>${escapeHtml(line)}</h2>`);
      return;
    }
    para.push(line);
    if (/[.!?]["')]?$/.test(line)) flushPara();
  });
  flushPara();
  flushList();
  return html.join("\n");
}

export async function parsePdf(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  let imageCount = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let current = "";
    let lastY = null;
    let lastH = 10;
    const pushLine = () => {
      if (current.trim()) lines.push(current);
      current = "";
    };
    content.items.forEach((item) => {
      if (!("str" in item)) return;
      const y = item.transform?.[5];
      const h = item.height || lastH;
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
        pushLine();
        // A vertical gap much larger than the line height starts a new paragraph.
        if (Math.abs(lastY - y) > h * 1.9) lines.push("");
      }
      if (item.str) current += item.str;
      if (item.hasEOL) pushLine();
      if (y !== undefined && item.str.trim()) {
        lastY = y;
        lastH = h;
      }
    });
    if (current) lines.push(current);
    lines.push("");
    try {
      const ops = await page.getOperatorList();
      imageCount += ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject).length;
    } catch {
      /* operator list is optional */
    }
    onProgress?.(Math.round((p / doc.numPages) * 100));
  }
  const cleaned = lines.map((l) => l.replace(/\s+/g, " ").trim());
  return {
    html: linesToHtml(cleaned),
    pages: doc.numPages,
    images: imageCount,
    chars: cleaned.join(" ").length,
  };
}

export function parseTex(source) {
  let body = source;
  const docMatch = source.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (docMatch) body = docMatch[1];
  const title = source.match(/\\title\{([^}]*)\}/)?.[1];
  body = body
    .replace(/(^|[^\\])%.*$/gm, "$1")
    .replace(/\\maketitle/g, title ? `\n@@H1@@${title}\n` : "")
    .replace(/\\section\*?\{([^}]*)\}/g, "\n@@H2@@$1\n")
    .replace(/\\subsection\*?\{([^}]*)\}/g, "\n@@H3@@$1\n")
    .replace(/\\textbf\{([^}]*)\}/g, "@@B@@$1@@/B@@")
    .replace(/\\(?:textit|emph)\{([^}]*)\}/g, "@@I@@$1@@/I@@")
    .replace(/\\underline\{([^}]*)\}/g, "@@U@@$1@@/U@@")
    .replace(/\\begin\{(?:itemize|enumerate)\}/g, "\n@@UL@@\n")
    .replace(/\\end\{(?:itemize|enumerate)\}/g, "\n@@/UL@@\n")
    .replace(/\\item\s*/g, "\n@@LI@@")
    .replace(/\\(?:begin|end)\{[^}]*\}/g, "")
    .replace(/\\(?:includegraphics|input|include|label|ref|cite|documentclass|usepackage)\*?(\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\\\\/g, "\n")
    .replace(/\\%/g, "%")
    .replace(/\\&/g, "&")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{([^}]*)\})?/g, "$3")
    .replace(/[{}]/g, "");

  const inline = (s) =>
    escapeHtml(s)
      .replace(/@@B@@/g, "<b>").replace(/@@\/B@@/g, "</b>")
      .replace(/@@I@@/g, "<i>").replace(/@@\/I@@/g, "</i>")
      .replace(/@@U@@/g, "<u>").replace(/@@\/U@@/g, "</u>");

  const html = [];
  let para = [];
  let inList = false;
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  body.split("\n").forEach((raw) => {
    const line = raw.trim();
    if (!line) return flush();
    if (line.startsWith("@@H1@@")) { flush(); html.push(`<h1>${inline(line.slice(6))}</h1>`); }
    else if (line.startsWith("@@H2@@")) { flush(); html.push(`<h2>${inline(line.slice(6))}</h2>`); }
    else if (line.startsWith("@@H3@@")) { flush(); html.push(`<h3>${inline(line.slice(6))}</h3>`); }
    else if (line === "@@UL@@") { flush(); html.push("<ul>"); inList = true; }
    else if (line === "@@/UL@@") { flush(); html.push("</ul>"); inList = false; }
    else if (line.startsWith("@@LI@@") && inList) { flush(); html.push(`<li>${inline(line.slice(6))}</li>`); }
    else para.push(line);
  });
  flush();
  return { html: html.join("\n"), pages: 1, images: (source.match(/\\includegraphics/g) || []).length, chars: body.length };
}

export function parsePlain(text) {
  return { html: linesToHtml(text.split(/\r?\n/)), pages: 1, images: 0, chars: text.length };
}

export async function parseUpload(file, onProgress) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return { kind: "PDF", ...(await parsePdf(file, onProgress)) };
  const text = await file.text();
  onProgress?.(100);
  if (name.endsWith(".tex")) return { kind: "TeX", ...parseTex(text) };
  if (name.endsWith(".txt") || name.endsWith(".md")) return { kind: "Text", ...parsePlain(text) };
  throw new Error("Unsupported file type. Upload a .pdf, .tex or .txt file.");
}

/**
 * Extract an approved-source document (policy, spec sheet, claims policy) as plain text
 * with "[Page n]" markers so the backend can cite page numbers.
 */
export async function extractPolicySource(file) {
  const name = file.name;
  if (name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, verbosity: 0 }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const text = content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
      pages.push(`[Page ${p}]\n${text.replace(/[ \t]+/g, " ").trim()}`);
    }
    const text = pages.join("\n\n");
    return { name, text, pages: doc.numPages, chars: text.length };
  }
  if (/\.(txt|md|tex)$/i.test(name)) {
    const text = await file.text();
    return { name, text, pages: 1, chars: text.length };
  }
  throw new Error("Upload a .pdf, .txt or .md policy document.");
}
