// Friendly layer on top of the audit engine:
// 1. derivePolicy()  - reads an uploaded policy document and picks up simple rules for the live checks
// 2. ISSUE_GROUPS / groupFindings() - turns raw findings into "top issues" a person can act on
// 3. COMMON_MISTAKES - the pitfalls shown on the start screen

import { DEFAULT_POLICY, TONE_PROFILES } from "../data/defaultPolicy.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
// A quoted phrase; double quotes may contain apostrophes ("world's best").
const QUOTED = `(?:"([^"\\n]{2,40})"|“([^”\\n]{2,40})”|'([^'\\n]{2,40})'|‘([^’\\n]{2,40})’)`;
const pick = (m, from) => m.slice(from, from + 4).find((x) => x !== undefined);

/**
 * Read plain policy text and extract rules the live engine can enforce.
 * Conservative on purpose: anything it cannot read reliably is still sent to the AI audit.
 */
export function derivePolicy(text, base = DEFAULT_POLICY) {
  const policy = clone(base);
  const detected = [];
  if (!text) return { policy, detected };
  const flat = text.replace(/\s+/g, " ");
  const known = new Set(policy.bannedTerms.map((t) => t.term.toLowerCase()));
  const addTerm = (term, replacement, label) => {
    term = term.trim().replace(/[.,;:]$/, "");
    if (term.length < 3 || term.length > 40 || known.has(term.toLowerCase())) return;
    known.add(term.toLowerCase());
    policy.bannedTerms.push({ term, replacement: (replacement || "").trim(), clause: "Your policy", severity: "medium" });
    detected.push({ kind: "term", label });
  };

  // Use "A" instead of "B"
  const insteadRe = new RegExp(`use\\s+${QUOTED}\\s+(?:instead of|rather than|in place of)\\s+${QUOTED}`, "gi");
  for (const m of flat.matchAll(insteadRe)) {
    const good = pick(m, 1), bad = pick(m, 5);
    addTerm(bad, good, `"${bad}" → "${good}"`);
  }

  // Replace "B" with "A"
  const replaceRe = new RegExp(`replace\\s+${QUOTED}\\s+with\\s+${QUOTED}`, "gi");
  for (const m of flat.matchAll(replaceRe)) {
    const bad = pick(m, 1), good = pick(m, 5);
    addTerm(bad, good, `"${bad}" → "${good}"`);
  }

  // Avoid / do not use / restricted / banned: "x", "y" ...
  const listRe = new RegExp(
    `(?:avoid|do not use|don't use|never use|must not use|prohibited|banned|restricted|forbidden)[^.!?"“'‘]{0,40}((?:${QUOTED}[\\s,;/]*(?:and|or)?\\s*){1,12})`,
    "gi",
  );
  for (const m of flat.matchAll(listRe)) {
    for (const q of m[1].matchAll(new RegExp(QUOTED, "g"))) {
      const term = pick(q, 1);
      addTerm(term, "", `"${term}" not allowed`);
    }
  }

  // Delivery / timeline limit
  const days = flat.match(/(?:deliver|timeline|turnaround|schedule|completion|phase)[^.]{0,80}?(?:not exceed|maximum(?: of)?|max\.?|no more than|within|up to|at most)\s+(\d{1,3})\s*(?:calendar |business |working )?days/i);
  if (days && Number(days[1]) > 0) {
    policy.maxDeliveryDays = Number(days[1]);
    detected.push({ kind: "limit", label: `Timelines ≤ ${days[1]} days` });
  }

  // Tone
  const tone = flat.match(/tone[^.]{0,80}?\b(formal|friendly|professional)\b/i);
  if (tone) {
    const t = tone[1][0].toUpperCase() + tone[1].slice(1).toLowerCase();
    if (TONE_PROFILES[t]) {
      policy.tone = t;
      detected.push({ kind: "tone", label: `${t} tone` });
    }
  }

  return { policy, detected };
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
