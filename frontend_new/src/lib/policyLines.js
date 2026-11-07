// Line numbering for policy documents. MUST match backend/policy_index.py exactly so
// "p.2 · line 14" in an AI finding points at the same line in the policy viewer.
//
// Rules: split on "[Page n]" markers (inserted when a PDF is extracted); inside each page,
// split on newlines, collapse whitespace, skip empty lines; number from 1 per page.

export function numberPolicy(text) {
  const out = [];
  if (!text) return out;
  const parts = text.split(/\[Page (\d+)\]/);
  const pages = [];
  if (parts.length === 1) pages.push([null, text]);
  else {
    if (parts[0].trim()) pages.push([null, parts[0]]);
    for (let i = 1; i < parts.length; i += 2) pages.push([Number(parts[i]), parts[i + 1] || ""]);
  }
  for (const [page, body] of pages) {
    let n = 0;
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;
      n += 1;
      out.push({ page, line: n, text: line });
    }
  }
  return out;
}

export const refLabel = (ref) => (ref ? `${ref.page ? `p.${ref.page} · ` : ""}line ${ref.line}` : "");
