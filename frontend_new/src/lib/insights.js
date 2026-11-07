// Friendly layer on top of the audit engine:
// 1. derivePolicy()  - reads an uploaded policy document and picks up simple rules for the live checks
// 2. ISSUE_GROUPS / groupFindings() - turns raw findings into "top issues" a person can act on
// 3. COMMON_MISTAKES - the pitfalls shown on the start screen

import { CORE_POLICY, DEFAULT_POLICY, TONE_PROFILES } from "../data/defaultPolicy.js";
import { numberPolicy } from "./policyLines.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
// A quoted phrase; double quotes may contain apostrophes ("world's best").
const QUOTED = `(?:"([^"\\n]{2,40})"|“([^”\\n]{2,40})”|'([^'\\n]{2,40})'|‘([^’\\n]{2,40})’)`;
const pick = (m, from) => m.slice(from, from + 4).find((x) => x !== undefined);

/**
 * Read plain policy text and extract rules the live engine can enforce.
 * Each rule remembers the policy line it came from ({ page, line, text }) so findings
 * can quote the policy and the viewer can jump to that line.
 * Conservative on purpose: anything it cannot read reliably is still sent to the AI audit.
 */
export function derivePolicy(text, base) {
  // No policy -> PUBLIVRA defaults. A user policy -> only universal safety checks + its own rules.
  const policy = clone(base || (text ? CORE_POLICY : DEFAULT_POLICY));
  policy.refs = policy.refs || {};
  const detected = [];
  if (!text) return { policy, detected };

  const lines = numberPolicy(text);
  // Each line on its own, then each line joined with the next (rules split across lines).
  const windows = lines.map((l) => ({ text: l.text, ref: l }));
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    if (next && next.page === l.page) windows.push({ text: `${l.text} ${next.text}`, ref: l });
  });

  const known = new Set(policy.bannedTerms.map((t) => t.term.toLowerCase()));
  const addTerm = (term, replacement, label, ref) => {
    term = term.trim().replace(/[.,;:]$/, "");
    if (term.length < 3 || term.length > 40 || known.has(term.toLowerCase())) return;
    known.add(term.toLowerCase());
    policy.bannedTerms.push({ term, replacement: (replacement || "").trim(), clause: "Your policy", severity: "medium", ref });
    detected.push({ kind: "term", label, ref });
  };

  const insteadRe = new RegExp(`use\\s+${QUOTED}\\s+(?:instead of|rather than|in place of)\\s+${QUOTED}`, "gi");
  const replaceRe = new RegExp(`replace\\s+${QUOTED}\\s+with\\s+${QUOTED}`, "gi");
  const listRe = new RegExp(
    // keyword, optional "words/terms/hype or buzzwords like", then the quoted list - nothing else in between
    `(?:avoid|do not use|don't use|never use|must not use|prohibited|banned|restricted|forbidden)(?:\\s+(?:the\\s+)?(?:words?|terms?|phrases?|buzzwords?|vocabulary|hype|jargon)(?:\\s+or\\s+[a-z]+)?(?:\\s+(?:like|such as|including))?)?[\\s:,-]*((?:${QUOTED}[\\s,;/]*(?:and|or)?\\s*){1,12})`,
    "gi",
  );
  const daysRe = /(?:deliver|timeline|turnaround|schedule|completion|phase)[^.]{0,80}?(?:not exceed|maximum(?: of)?|max\.?|no more than|within|up to|at most)\s+(\d{1,3})\s*(?:calendar |business |working )?days/i;
  const toneRe = /tone[^.]{0,80}?\b(formal|friendly|professional)\b/i;
  const capsRe = /(?:avoid|do not use|don't use|never use|no|must not use|prohibited)[^.]{0,30}\b(?:all[- ]?caps|capital letters|capitals|upper[- ]?case)\b/i;

  for (const w of windows) {
    // Use "A" instead of "B"
    for (const m of w.text.matchAll(insteadRe)) {
      const good = pick(m, 1), bad = pick(m, 5);
      addTerm(bad, good, `"${bad}" → "${good}"`, w.ref);
    }
    // Replace "B" with "A"
    for (const m of w.text.matchAll(replaceRe)) {
      const bad = pick(m, 1), good = pick(m, 5);
      addTerm(bad, good, `"${bad}" → "${good}"`, w.ref);
    }
    // Avoid / do not use / restricted / banned: "x", "y" ...
    for (const m of w.text.matchAll(listRe)) {
      for (const q of m[1].matchAll(new RegExp(QUOTED, "g"))) {
        const term = pick(q, 1);
        addTerm(term, "", `"${term}" not allowed`, w.ref);
      }
    }
    // Delivery / timeline limit
    const days = !policy.refs.maxDeliveryDays && w.text.match(daysRe);
    if (days && Number(days[1]) > 0) {
      policy.maxDeliveryDays = Number(days[1]);
      policy.refs.maxDeliveryDays = w.ref;
      detected.push({ kind: "limit", label: `Timelines ≤ ${days[1]} days`, ref: w.ref });
    }
    // Tone
    const tone = !policy.refs.tone && w.text.match(toneRe);
    if (tone) {
      const t = tone[1][0].toUpperCase() + tone[1].slice(1).toLowerCase();
      if (TONE_PROFILES[t]) {
        policy.tone = t;
        policy.refs.tone = w.ref;
        detected.push({ kind: "tone", label: `${t} tone`, ref: w.ref });
      }
    }
    // Capitals explicitly banned
    if (!policy.forbidCaps && capsRe.test(w.text)) {
      policy.forbidCaps = true;
      policy.refs.forbidCaps = w.ref;
      detected.push({ kind: "caps", label: "No all-caps words", ref: w.ref });
    }
  }

  // Tables: "Restricted term | Approved alternative | Reason" (Word tables extracted with " | ").
  parseTermTables(lines, addTerm);

  return { policy, detected };
}

const HEADER_BAD = /restricted|forbidden|banned|prohibited|avoid|don'?t use|do not use|flag/i;
const HEADER_GOOD = /approved|alternative|suggest|instead|replacement|use/i;
const NO_REPLACEMENT = /\b(remove|omit|rephrase|delete|avoid|n\/a|none)\b/i;

function parseTermTables(lines, addTerm) {
  let inTable = false;
  let tablePage = null; // page of the current table
  let carry = ""; // first cell that wrapped onto the previous line ("Incentive, Fee," + "Budgets, KPIs | ...")
  lines.forEach((l, i) => {
    const cells = l.text.split(" | ").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && HEADER_BAD.test(cells[0]) && HEADER_GOOD.test(cells[1])) {
      inTable = true;
      tablePage = l.page;
      carry = "";
      return;
    }
    if (!inTable) return;
    if (l.page !== tablePage || /^\d+(\.\d+)*\.?\s+[A-Z]/.test(l.text)) {
      inTable = false; // next section heading or new page ends the table
      return;
    }
    if (cells.length < 2) {
      const next = lines[i + 1];
      if (/,$/.test(l.text) && next && next.text.includes(" | ")) carry = `${l.text} `;
      return;
    }
    if (!carry && /^[a-z]/.test(cells[0])) return; // wrapped text from the row above, not a new row
    const first = `${carry}${cells[0]}`;
    carry = "";
    const condition = (first.match(/\(([^)]+)\)/) || [])[1];
    const alt = cells[1] || "";
    const replacement = NO_REPLACEMENT.test(alt) ? "" : alt.split(/,|;| or /)[0].trim();
    first
      .replace(/\([^)]*\)/g, "")
      .split(/[,;/]/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && t.length <= 40 && !/^(and|or)$/i.test(t))
      .forEach((term) =>
        addTerm(term, replacement, replacement ? `"${term}" → "${replacement}"${condition ? ` (${condition})` : ""}` : `"${term}" not allowed`, l),
      );
  });
}

// ------------------------------------------------------------------ issue groups
export const ISSUE_GROUPS = {
  privacy: {
    title: "Personal data exposed",
    advice: "Remove or mask PAN, Aadhaar, phone numbers, emails and keys before publishing.",
    weight: 100,
  },
  guarantee: {
    title: "Absolute promises",
    advice: "Words like “guarantee”, “100%” or “zero risk” create legal exposure. Soften them.",
    weight: 90,
  },
  wrongFact: {
    title: "Figures that contradict your sources",
    advice: "These numbers differ from your approved facts. Use the approved value.",
    weight: 80,
  },
  timeline: {
    title: "Timelines over the limit",
    advice: "A promised delivery time is longer than your policy allows.",
    weight: 70,
  },
  terms: {
    title: "Restricted words",
    advice: "Your guidelines ban these words. Swap in the approved wording.",
    weight: 60,
  },
  unsourced: {
    title: "Numbers without a source",
    advice: "No approved document backs these figures. Cite a source or soften them.",
    weight: 50,
  },
  superlative: {
    title: "Unproven “best / fastest” claims",
    advice: "Comparisons need a benchmark. Without one, tone them down.",
    weight: 40,
  },
  tone: {
    title: "Tone problems",
    advice: "Hype words, shouting caps, slang or “!!” don't match the required tone.",
    weight: 30,
  },
  other: { title: "Other flags", advice: "Review these before publishing.", weight: 10 },
};

export function groupOf(f) {
  const k = f.ruleKey || "";
  if (k.startsWith("pii") || f.category === "Privacy") return "privacy";
  if (k === "absolute" || (k === "term" && f.category === "Facts & claims")) return "guarantee";
  if (k === "fact-bad") return "wrongFact";
  if (k === "timeline" || f.category === "Timeline") return "timeline";
  if (k === "term" || f.category === "Terminology") return "terms";
  if (k === "metric") return "unsourced";
  if (k === "superlative") return "superlative";
  if (k.startsWith("tone") || f.category === "Tone") return "tone";
  if (f.ai && f.category === "Facts & claims") return f.verdict === "CONTRADICTED" ? "wrongFact" : "unsourced";
  return "other";
}

/** Active (non-verified, non-dismissed) findings grouped and sorted by how much they matter. */
export function groupFindings(findings, dismissed = {}) {
  const map = new Map();
  findings.forEach((f) => {
    if (f.verdict === "VERIFIED" || dismissed[f.id]) return;
    const g = groupOf(f);
    if (!map.has(g)) map.set(g, { id: g, ...ISSUE_GROUPS[g], items: [] });
    map.get(g).items.push(f);
  });
  return [...map.values()]
    .map((g) => ({
      ...g,
      count: g.items.length,
      blocking: g.items.some((f) => f.verdict === "CONTRADICTED" && f.severity === "high"),
      fixable: g.items.filter((f) => f.suggestion).length,
      examples: [...new Set(g.items.map((f) => f.match))].slice(0, 3),
    }))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.weight - a.weight || b.count - a.count);
}

// ------------------------------------------------------------------ start-screen guide
export const COMMON_MISTAKES = [
  { group: "privacy", bad: "Contact: PAN ABCDE1234F", good: "Contact: PAN on file" },
  { group: "guarantee", bad: "We guarantee instant results", good: "We aim to deliver fast results" },
  { group: "unsourced", bad: "3x faster approvals", good: "Faster approvals (internal benchmark, 2026)" },
  { group: "superlative", bad: "The world's best platform", good: "A highly capable platform" },
  { group: "timeline", bad: "Phase III takes 120 days", good: "Phase III takes 90 days" },
  { group: "tone", bad: "This is a totally AWESOME deal!!", good: "This is an excellent offer." },
];
