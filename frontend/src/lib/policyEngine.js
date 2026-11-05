// PUBLIVRA AI - client-side mock audit engine.
// Deterministic rules run first (PII, banned terms, absolute claims, timelines),
// then approved-fact matching labels every claim VERIFIED / CONTRADICTED / UNVERIFIED.
// Unverified is the default state for any claim with no approved source.

import { DEFAULT_TONE, TONE_PROFILES, HYPE_WORDS, CASUAL_WORDS } from "../data/defaultPolicy.js";

export const VERDICT = {
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
  CONTRADICTED: "CONTRADICTED",
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Split plain text into sentences, keeping decimals like 99.5% intact. */
export function splitSentences(text) {
  const out = [];
  text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .forEach((line) => {
      line
        .split(/(?<=[.!?])\s+(?=["'(\[₹A-Z0-9])/)
        .map((s) => s.trim())
        .filter((s) => s.length > 2)
        .forEach((s) => out.push(s));
    });
  return out;
}

/** Wrap a phrase so it only matches whole words/phrases. */
function phraseRe(phrase, flags = "gi") {
  const start = /^[A-Za-z0-9]/.test(phrase) ? "(?<![A-Za-z0-9])" : "";
  const end = /[A-Za-z0-9]$/.test(phrase) ? "(?![A-Za-z0-9])" : "";
  return new RegExp(`${start}${escapeRe(phrase)}${end}`, flags);
}

function unitRe(unit) {
  if (unit === "+") return /(\d[\d,]*)\s*\+/gi;
  if (unit === "%") return /(\d+(?:\.\d+)?)\s*%/gi;
  const base = unit.replace(/s$/i, "");
  return new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${escapeRe(base)}s?(?![A-Za-z])`, "gi");
}

const toNum = (s) => Number(String(s).replace(/,/g, ""));

// ---------------------------------------------------------------- rule tables
const PII_RULES = [
  { key: "pan", label: "PAN number", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, mask: (m) => `${m.slice(0, 2)}XXXXXX${m.slice(-2)}` },
  { key: "aadhaar", label: "Aadhaar number", re: /\b\d{4}\s\d{4}\s\d{4}\b/g, mask: () => "XXXX XXXX XXXX" },
  { key: "email", label: "personal email address", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, mask: () => "[email redacted]" },
  { key: "phone", label: "phone number", re: /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, mask: () => "[phone redacted]" },
  { key: "apikey", label: "API key / secret", re: /\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{12,})\b/g, mask: () => "[secret redacted]" },
];

const ABSOLUTE_RULES = [
  { re: /\bguarantee(?:s|d)?\b/gi, to: (m) => (/^G/.test(m) ? "Aim to provide" : "aim to provide") },
  { re: /\b(?:zero[- ]risk|risk[- ]free)\b/gi, to: () => "low-risk" },
  { re: /\bnever fails?\b/gi, to: () => "is highly reliable" },
  { re: /\bzero downtime\b/gi, to: () => "high availability" },
  { re: /\b100% (?:secure|safe|accurate|reliable)\b/gi, to: (m) => m.replace("100% ", "highly ") },
];

const SUPERLATIVES = {
  "best": "strong", "#1": "top-rated", "number one": "top-rated", "fastest": "fast",
  "most advanced": "advanced", "unmatched": "strong", "unbeatable": "competitive", "first-ever": "new",
};
const SUPERLATIVE_RE = /(?<![A-Za-z])(?:best(?! practice)|#1|number one|fastest|most advanced|unmatched|unbeatable|first-ever)(?![A-Za-z])/gi;

const HYPE_REPLACE = {
  "game-changing": "significant", "game changer": "significant step", "mind-blowing": "impressive",
  unbelievable: "remarkable", insane: "remarkable", amazing: "notable", incredible: "significant",
  "best ever": "strong", ultimate: "complete", "jaw-dropping": "impressive", groundbreaking: "new",
  disruptive: "innovative", perfect: "well-suited", flawless: "reliable", revolutionary: "new",
  "world's best": "highly capable", magic: "automated", unmatched: "strong", unbeatable: "competitive",
};
const CASUAL_REPLACE = {
  awesome: "excellent", super: "very", gonna: "going to", wanna: "want to", crazy: "remarkable",
  lol: "", cool: "useful", stuff: "material", folks: "everyone", hey: "hello", guys: "everyone",
  kinda: "somewhat", totally: "",
};
const ACRONYM_OK = new Set(["PUBLIVRA", "NEXUS", "CCPA", "ASCI", "GDPR", "WCAG", "ISO", "SLA", "API"]);

const METRIC_RE = /(?:₹\s?\d[\d,]*(?:\.\d+)?\s*(?:lakh|crore|k|cr)?|\b\d+(?:\.\d+)?\s*(?:%|x(?![A-Za-z])|times\b|MP\b|mAh\b|hours?\b|hrs?\b|minutes?\b|mins?\b|GB\b|TB\b|ms\b|seconds?\b))/gi;
const COMPARATIVE_RE = /^\s*(?:faster|better|more|less|cheaper|higher|lower|quicker|greater|fewer)\b/i;

// ------------------------------------------------------------------ helpers
function overlaps(taken, s, e) {
  return taken.some(([a, b]) => s < b && e > a);
}

function caseLike(src, repl) {
  if (!repl) return repl;
  if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return repl.toLowerCase();
  if (src[0] === src[0].toUpperCase() && /[a-z]/i.test(src[0])) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

/** Remove a fragment and tidy the double spaces it leaves behind. */
export function tidy(sentence) {
  return sentence
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\b([Aa]) (?=[aeio])/g, "$1n ")
    .trim();
}

function makeFinding(sentence, ruleKey, data) {
  const matchText = data.suggestion?.find ?? data.match ?? "";
  return {
    id: `${ruleKey}:${hash(sentence)}:${hash(matchText + (data.offset ?? ""))}`,
    sentence,
    ruleKey,
    ...data,
  };
}

// --------------------------------------------------------------- tone audit
export function resolveTone(policy) {
  const custom = policy?.tone && TONE_PROFILES[policy.tone];
  const profile = custom ? policy.tone : DEFAULT_TONE.profile;
  return {
    profile,
    description: TONE_PROFILES[profile].description,
    weights: TONE_PROFILES[profile].penalise,
    usingFallback: !custom,
  };
}

function countMatches(text, words) {
  const found = [];
  words.forEach((w) => {
    const m = text.match(phraseRe(w));
    if (m) found.push({ word: w, count: m.length });
  });
  return found;
}

export function auditTone(text, policy) {
  const tone = resolveTone(policy);
  const hype = countMatches(text, HYPE_WORDS);
  const casual = countMatches(text, CASUAL_WORDS);
  const exclamations = (text.match(/!/g) || []).length;
  const caps = (text.match(/\b[A-Z]{5,}\b/g) || []).filter((w) => !ACRONYM_OK.has(w));
  const contractions = (text.match(/\b\w+n't\b|\b\w+'(?:re|ve|ll)\b/gi) || []).length;
  const words = (text.match(/\b\w+\b/g) || []).length;

  const sum = (arr) => arr.reduce((a, b) => a + b.count, 0);
  const w = tone.weights;
  const penalty =
    sum(hype) * w.hype + exclamations * w.exclamation + caps.length * w.caps + sum(casual) * w.casual + contractions * w.contractions;
  const score = words === 0 ? 10 : Math.max(0, Math.min(10, Math.round((10 - penalty) * 10) / 10));

  let detected = "Professional";
  if (score < 4) detected = sum(casual) > sum(hype) ? "Casual" : "Exaggerated";
  else if (score < 6) detected = "Promotional";
  else if (score < 8) detected = "Mostly professional";
  if (tone.profile === "Friendly" && score >= 8) detected = "Friendly & accurate";
  if (tone.profile === "Formal" && score >= 8) detected = "Formal";

  return {
    ...tone,
    score,
    detected,
    meetsRequirement: score >= 7,
    signals: {
      hype,
      casual,
      exclamations,
      caps: [...new Set(caps)],
      contractions,
    },
  };
}

// ---------------------------------------------------------- sentence audit
function auditSentence(sentence, policy, tone) {
  const findings = [];
  const taken = [];
  const take = (s, e) => taken.push([s, e]);
  const add = (ruleKey, data) => findings.push(makeFinding(sentence, ruleKey, data));

  // 1. Privacy / confidential data - exact rules run first.
  PII_RULES.forEach((rule) => {
    for (const m of sentence.matchAll(rule.re)) {
      const s = m.index, e = s + m[0].length;
      if (overlaps(taken, s, e)) continue;
      take(s, e);
      add(`pii-${rule.key}`, {
        verdict: VERDICT.CONTRADICTED, severity: "high", category: "Privacy",
        match: m[0], offset: s,
        clause: "Clause 1.1 Data Privacy",
        explanation: `Contains exposed sensitive personal data (${rule.label}: ${m[0]}). Confidential identifiers must never be published.`,
        source: "Global Policy · Clause 1.1",
        suggestion: { find: m[0], replace: rule.mask(m[0]) },
      });
    }
  });

  // 2. Banned / restricted terminology (longest phrases first).
  [...policy.bannedTerms]
    .sort((a, b) => b.term.length - a.term.length)
    .forEach((bt) => {
      for (const m of sentence.matchAll(phraseRe(bt.term))) {
        const s = m.index, e = s + m[0].length;
        if (overlaps(taken, s, e)) continue;
        take(s, e);
        add("term", {
          verdict: VERDICT.CONTRADICTED, severity: bt.severity || "medium",
          category: bt.clause?.startsWith("CLAIMS") ? "Facts & claims" : "Terminology",
          match: m[0], offset: s, clause: bt.clause,
          explanation: `"${m[0]}" is restricted by ${bt.clause}. Approved wording: "${bt.replacement}".`,
          source: `Brand Guidelines · ${bt.clause}`,
          suggestion: { find: m[0], replace: caseLike(m[0], bt.replacement) },
        });
      }
    });

  // 3. Absolute guarantees.
  ABSOLUTE_RULES.forEach((rule) => {
    for (const m of sentence.matchAll(rule.re)) {
      const s = m.index, e = s + m[0].length;
      if (overlaps(taken, s, e)) continue;
      take(s, e);
      add("absolute", {
        verdict: VERDICT.CONTRADICTED, severity: "high", category: "Facts & claims",
        match: m[0], offset: s, clause: "Clause 2 Claims & Guarantees",
        explanation: `Absolute promise "${m[0]}" is prohibited without an empirical SLA (Consumer Protection Act 2019 exposure).`,
        source: "Global Policy · Clause 2",
        suggestion: { find: m[0], replace: rule.to(m[0]) },
      });
    }
  });

  // 4. Delivery timelines vs. policy limit.
  if (/deliver|schedule|timeline|phase|complete|turnaround|handover/i.test(sentence)) {
    for (const m of sentence.matchAll(/(\d+)\s*(?:calendar\s+|business\s+|working\s+)?days?\b/gi)) {
      const n = Number(m[1]);
      const s = m.index, e = s + m[0].length;
      if (overlaps(taken, s, e)) continue;
      take(s, e);
      if (n > policy.maxDeliveryDays) {
        add("timeline", {
          verdict: VERDICT.CONTRADICTED, severity: "medium", category: "Timeline",
          match: m[0], offset: s, clause: "POL-01 Delivery limits",
          explanation: `Timeline of ${n} days exceeds the maximum permitted limit of ${policy.maxDeliveryDays} calendar days.`,
          source: "Global Policy · POL-01",
          suggestion: { find: m[0], replace: m[0].replace(m[1], String(policy.maxDeliveryDays)) },
        });
      } else {
        add("timeline-ok", {
          verdict: VERDICT.VERIFIED, severity: "none", category: "Timeline",
          match: m[0], offset: s, clause: "POL-01 Delivery limits",
          explanation: `${n} days is within the permitted ${policy.maxDeliveryDays}-day delivery window.`,
          source: "Global Policy · POL-01",
          suggestion: null,
        });
      }
    }
  }

  // 5. Approved facts: numeric claims about a known subject.
  policy.approvedFacts.forEach((fact) => {
    const hasSubject = fact.keywords.some((k) => phraseRe(k, "i").test(sentence));
    if (!hasSubject) return;
    for (const m of sentence.matchAll(unitRe(fact.unit))) {
      const s = m.index, e = s + m[0].length;
      if (overlaps(taken, s, e)) continue;
      take(s, e);
      const val = toNum(m[1]);
      if (Math.abs(val - Number(fact.value)) < 1e-9) {
        add("fact-ok", {
          verdict: VERDICT.VERIFIED, severity: "none", category: "Facts & claims",
          match: m[0], offset: s, clause: fact.id,
          explanation: `${fact.label} of ${fact.value}${fact.unit === "%" || fact.unit === "+" ? "" : " "}${fact.unit} matches the approved source.`,
          source: fact.source, suggestion: null,
        });
      } else {
        add("fact-bad", {
          verdict: VERDICT.CONTRADICTED, severity: "medium", category: "Facts & claims",
          match: m[0], offset: s, clause: fact.id,
          explanation: `States ${m[0].trim()}, but the approved ${fact.label.toLowerCase()} is ${fact.value}${fact.unit === "%" || fact.unit === "+" ? "" : " "}${fact.unit}.`,
          source: fact.source,
          suggestion: { find: m[0], replace: m[0].replace(m[1], String(fact.value)) },
        });
      }
    }
  });

  // 6. Approved qualitative statements.
  policy.approvedStatements.forEach((st) => {
    for (const m of sentence.matchAll(phraseRe(st.text))) {
      const s = m.index, e = s + m[0].length;
      if (overlaps(taken, s, e)) continue;
      take(s, e);
      add("statement-ok", {
        verdict: VERDICT.VERIFIED, severity: "none", category: "Facts & claims",
        match: m[0], offset: s, clause: st.id,
        explanation: `"${st.label}" is backed by an approved source.`,
        source: st.source, suggestion: null,
      });
    }
  });

  // 7. Any remaining metric has no approved source => UNVERIFIED (default state).
  for (const m of sentence.matchAll(METRIC_RE)) {
    const s = m.index, e = s + m[0].length;
    if (overlaps(taken, s, e)) continue;
    take(s, e);
    const after = sentence.slice(e);
    const removable = COMPARATIVE_RE.test(after);
    add("metric", {
      verdict: VERDICT.UNVERIFIED, severity: "medium", category: "Facts & claims",
      match: m[0], offset: s, clause: "Claims evidence rule",
      explanation: `No approved source contains "${m[0].trim()}". Unverified claims are never assumed true - cite a source or soften the figure.`,
      source: "No matching approved source",
      suggestion: removable ? { find: m[0] + " ", replace: "" } : null,
    });
  }

  // 8. Unsupported superlatives.
  for (const m of sentence.matchAll(SUPERLATIVE_RE)) {
    const s = m.index, e = s + m[0].length;
    if (overlaps(taken, s, e)) continue;
    take(s, e);
    const repl = SUPERLATIVES[m[0].toLowerCase()] ?? "strong";
    add("superlative", {
      verdict: VERDICT.UNVERIFIED, severity: "low", category: "Facts & claims",
      match: m[0], offset: s, clause: "Claims evidence rule",
      explanation: `Comparative claim "${m[0]}" has no approved benchmark to support it.`,
      source: "No matching approved source",
      suggestion: { find: m[0], replace: caseLike(m[0], repl) },
    });
  }

  // 9. Tone & persona (sentence level).
  const toneRule = (ruleKey, re, toFn, why) => {
    for (const m of sentence.matchAll(re)) {
      const s = m.index, e = s + m[0].length;
      if (overlaps(taken, s, e)) continue;
      take(s, e);
      add(ruleKey, {
        verdict: VERDICT.CONTRADICTED, severity: "low", category: "Tone",
        match: m[0], offset: s, clause: `Tone · ${tone.profile}`,
        explanation: why(m[0]),
        source: tone.usingFallback ? "Default internal compliance tone" : "Custom policy tone rule",
        suggestion: { find: m[0], replace: toFn(m[0]) },
      });
    }
  };
  HYPE_WORDS.forEach((w) =>
    toneRule("tone-hype", phraseRe(w), (m) => caseLike(m, HYPE_REPLACE[w.toLowerCase()] ?? "notable"),
      (m) => `Hype word "${m}" breaks the ${tone.profile.toLowerCase()} tone requirement.`));
  if (tone.weights.casual >= 0.5) {
    CASUAL_WORDS.forEach((w) =>
      toneRule("tone-casual", phraseRe(w), (m) => caseLike(m, CASUAL_REPLACE[w] ?? ""),
        (m) => `Casual expression "${m}" does not fit a ${tone.profile.toLowerCase()} persona.`));
  }
  if (tone.weights.caps > 0) {
    toneRule("tone-caps", /\b[A-Z]{5,}\b/g, (m) => (ACRONYM_OK.has(m) ? m : m.toLowerCase()),
      (m) => `"${m}" in all caps reads as shouting.`);
    // drop acronym false positives
    for (let i = findings.length - 1; i >= 0; i--) {
      if (findings[i].ruleKey === "tone-caps" && ACRONYM_OK.has(findings[i].match)) findings.splice(i, 1);
    }
  }
  if (tone.weights.exclamation >= 0.5) {
    toneRule("tone-exclaim", /!+/g, () => ".", () => "Exclamation marks read as sensational in brand copy.");
  }
  if (tone.weights.contractions > 0) {
    toneRule("tone-contraction", /\b\w+n't\b/gi,
      (m) => ({ "can't": "cannot", "won't": "will not" }[m.toLowerCase()] ?? m.replace(/n't$/i, " not")),
      (m) => `Contraction "${m}" is not allowed in the Formal tone profile.`);
  }

  // Tidy replacements that delete words.
  findings.forEach((f) => {
    if (f.suggestion && f.suggestion.replace === "" && !f.suggestion.find.endsWith(" ")) {
      const idx = sentence.indexOf(f.suggestion.find);
      if (sentence[idx + f.suggestion.find.length] === " ") f.suggestion.find += " ";
    }
  });

  // Keep articles grammatical: "the fastest" -> "a fast", "a awesome" -> "an excellent".
  findings.forEach((f) => {
    const sg = f.suggestion;
    if (!sg || !sg.replace || f.offset === undefined) return;
    const m = sentence.slice(0, f.offset).match(/\b(the|a|an)\s+$/i);
    if (!m) return;
    const art = m[1].toLowerCase();
    const superlative = f.ruleKey === "superlative" || /best|#1|number one/i.test(f.match);
    if (art === "the" && !superlative) return;
    const wanted = /^[aeio]/i.test(sg.replace) ? "an" : "a";
    if (art === wanted) return;
    sg.find = m[0] + sg.find;
    sg.replace = caseLike(m[1], wanted) + " " + sg.replace;
    f.offset -= m[0].length;
  });

  findings.forEach((f) => {
    if (f.suggestion) {
      f.suggestion.preview = tidy(sentence.replace(f.suggestion.find, f.suggestion.replace));
    }
  });
  return findings;
}

// --------------------------------------------------------------- top level
export function analyzeDocument(text, policy) {
  const sentences = splitSentences(text);
  const tone = auditTone(text, policy);
  const findings = [];
  const seen = new Set();
  sentences.forEach((s) => {
    auditSentence(s, policy, tone).forEach((f) => {
      let id = f.id, n = 1;
      while (seen.has(id)) id = `${f.id}~${n++}`;
      seen.add(id);
      findings.push({ ...f, id });
    });
  });

  const flaggedSentences = new Set(findings.map((f) => f.sentence));
  return {
    sentences,
    findings,
    tone,
    stats: {
      sentences: sentences.length,
      clean: sentences.filter((s) => !flaggedSentences.has(s)).length,
      words: (text.match(/\b\w+\b/g) || []).length,
    },
    analyzedAt: Date.now(),
  };
}

export function computeRisk(findings, tone, dismissed = {}) {
  const active = findings.filter((f) => !dismissed[f.id]);
  const contradicted = active.filter((f) => f.verdict === VERDICT.CONTRADICTED);
  const unverified = active.filter((f) => f.verdict === VERDICT.UNVERIFIED);
  const verified = active.filter((f) => f.verdict === VERDICT.VERIFIED);
  const highCount = contradicted.filter((f) => f.severity === "high").length;

  const weight = { high: 30, medium: 15, low: 5 };
  let score = contradicted.reduce((a, f) => a + (weight[f.severity] || 5), 0) + unverified.length * 8;
  score += Math.max(0, 8 - tone.score) * 2;
  score = Math.min(100, Math.round(score));

  let level = "LOW";
  if (highCount > 0) level = "HIGH";
  else if (contradicted.length > 0 || unverified.length >= 2 || tone.score < 6) level = "MEDIUM";

  const reasons = [];
  if (highCount) reasons.push(`${highCount} high-severity contradiction${highCount > 1 ? "s" : ""}`);
  if (contradicted.length - highCount > 0) reasons.push(`${contradicted.length - highCount} other policy breach${contradicted.length - highCount > 1 ? "es" : ""}`);
  if (unverified.length) reasons.push(`${unverified.length} unverified claim${unverified.length > 1 ? "s" : ""}`);
  if (tone.score < 7) reasons.push(`tone ${tone.score}/10 vs ${tone.profile} requirement`);

  return {
    level,
    score,
    counts: {
      verified: verified.length,
      unverified: unverified.length,
      contradicted: contradicted.length,
      high: highCount,
      dismissed: findings.length - active.length,
    },
    reasons,
  };
}

// ------------------------------------------------------------ policy import
/** Parse the line-based policy import format (see POLICY_TEMPLATE_TEXT). */
export function parsePolicyText(raw, base) {
  const next = {
    ...base,
    bannedTerms: [...base.bannedTerms],
    approvedFacts: [...base.approvedFacts],
    approvedStatements: [...base.approvedStatements],
  };
  const report = { added: 0, errors: [] };
  raw.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith("#")) return;
    const [key, ...rest] = l.split(":");
    const val = rest.join(":").trim();
    try {
      switch (key.trim().toUpperCase()) {
        case "TONE":
          if (!TONE_PROFILES[val]) throw new Error(`unknown tone "${val}"`);
          next.tone = val; report.added++; break;
        case "MAX_DELIVERY_DAYS":
          if (!(Number(val) > 0)) throw new Error("must be a positive number");
          next.maxDeliveryDays = Number(val); report.added++; break;
        case "BANNED": {
          const [pair, clause = "Custom rule", severity = "medium"] = val.split("|").map((x) => x.trim());
          const [term, replacement] = pair.split("=>").map((x) => x.trim());
          if (!term || !replacement) throw new Error("use BANNED: term => replacement | clause | severity");
          next.bannedTerms.push({ term, replacement, clause, severity: severity.toLowerCase() });
          report.added++; break;
        }
        case "FACT": {
          const [label, keywords, value, unit, source] = val.split("|").map((x) => x.trim());
          if (!label || !keywords || value === undefined || !unit) throw new Error("use FACT: label | keywords | value | unit | source");
          next.approvedFacts.push({
            id: `F-${String(next.approvedFacts.length + 1).padStart(2, "0")}`,
            label, keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
            value: Number(value), unit, source: source || "Imported policy",
          });
          report.added++; break;
        }
        case "STATEMENT": {
          const [text, label, source] = val.split("|").map((x) => x.trim());
          if (!text) throw new Error("use STATEMENT: text | label | source");
          next.approvedStatements.push({
            id: `S-${String(next.approvedStatements.length + 1).padStart(2, "0")}`,
            text, label: label || text, source: source || "Imported policy",
          });
          report.added++; break;
        }
        default:
          throw new Error(`unknown key "${key}"`);
      }
    } catch (e) {
      report.errors.push(`Line ${i + 1}: ${e.message}`);
    }
  });
  return { policy: next, report };
}

// ------------------------------------------------------- policy -> AI context
/** Serialise the Policy Library so the backend can index it as an approved source. */
export function policyToText(policy) {
  const tone = resolveTone(policy);
  const lines = [
    `[POLICY LIBRARY: ${policy.name}]`,
    `Required tone: ${tone.profile}${tone.usingFallback ? " (default internal compliance tone)" : ""} - ${tone.description}`,
    `POL-01 Delivery limits: delivery timelines must not exceed ${policy.maxDeliveryDays} calendar days.`,
    "Clause 1.1 Data Privacy: never publish PAN, Aadhaar, phone numbers, personal emails, credentials or API keys.",
    "Clause 2 Claims & Guarantees: absolute guarantees (guarantee, risk-free, zero downtime, 100% ...) are prohibited without an SLA.",
    "",
    "Restricted terminology (restricted => approved replacement):",
    ...policy.bannedTerms.map((t) => `- "${t.term}" => "${t.replacement}" (${t.clause}, ${t.severity} severity)`),
    "",
    "Approved facts (only these figures are VERIFIED):",
    ...policy.approvedFacts.map((f) => `- ${f.id} ${f.label}: ${f.value}${f.unit === "%" || f.unit === "+" ? "" : " "}${f.unit} [source: ${f.source}]`),
    "",
    "Approved statements:",
    ...policy.approvedStatements.map((s) => `- ${s.id} "${s.text}" - ${s.label} [source: ${s.source}]`),
  ];
  return lines.join("\n");
}
