// Global policy checklist used by the mock audit engine.
// Mirrors backend/brand_guidlines.txt and the fallback clauses in backend/main.py,
// plus an approved-facts sheet so claims can resolve to VERIFIED / CONTRADICTED.

export const DEFAULT_TONE = {
  profile: "Professional",
  description:
    "Objective, professional and fact-driven. No hype, sensationalism, shouting or slang.",
};

export const TONE_PROFILES = {
  Professional: {
    description: "Objective, professional and fact-driven. No hype, shouting or slang.",
    penalise: { hype: 1.2, exclamation: 0.8, caps: 0.6, casual: 1.0, contractions: 0 },
  },
  Formal: {
    description: "Formal register for legal, policy and investor content. No contractions or slang.",
    penalise: { hype: 1.4, exclamation: 1.2, caps: 0.8, casual: 1.4, contractions: 0.4 },
  },
  Friendly: {
    description: "Warm and approachable, but still accurate. Light informality is fine; hype is not.",
    penalise: { hype: 1.0, exclamation: 0.25, caps: 0.5, casual: 0.2, contractions: 0 },
  },
};

export const DEFAULT_POLICY = {
  id: "global-v1",
  name: "PUBLIVRA Global Compliance Policy v1.0",
  tone: null, // null => fall back to DEFAULT_TONE
  maxDeliveryDays: 90,
  bannedTerms: [
    { term: "world's best", replacement: "highly capable", clause: "BRAND-1 Tonality", severity: "medium" },
    { term: "best-in-the-world", replacement: "highly capable", clause: "BRAND-1 Tonality", severity: "medium" },
    { term: "revolutionary", replacement: "new", clause: "BRAND-1 Tonality", severity: "low" },
    { term: "100% bug-free", replacement: "rigorously tested", clause: "CLAIMS-2 Absolute claims", severity: "high" },
    { term: "guaranteed #1", replacement: "a leading option", clause: "CLAIMS-2 Absolute claims", severity: "high" },
    { term: "magic AI", replacement: "AI-powered compliance engine", clause: "TERM-3 Approved terminology", severity: "medium" },
    { term: "magic AI solution", replacement: "AI-powered compliance engine", clause: "TERM-3 Approved terminology", severity: "medium" },
    { term: "cheap service", replacement: "cost-effective service", clause: "TERM-3 Approved terminology", severity: "medium" },
    { term: "guaranteed instant results", replacement: "fast, measurable results", clause: "CLAIMS-2 Absolute claims", severity: "high" },
    { term: "zero downtime guarantee", replacement: "a 99.5% uptime commitment", clause: "CLAIMS-2 Absolute claims", severity: "high" },
    { term: "customers", replacement: "enterprise clients", clause: "TERM-3 Approved terminology", severity: "low" },
  ],
  approvedFacts: [
    { id: "F-01", label: "Rear camera resolution", keywords: ["camera"], value: 50, unit: "MP", source: "Product Spec Sheet v3, p.2" },
    { id: "F-02", label: "Platform uptime SLA", keywords: ["uptime", "availability"], value: 99.5, unit: "%", source: "Master Service Agreement, Clause 4.1" },
    { id: "F-03", label: "Battery capacity", keywords: ["battery"], value: 5000, unit: "mAh", source: "Product Spec Sheet v3, p.3" },
    { id: "F-04", label: "Support first-response time", keywords: ["support", "response"], value: 4, unit: "hours", source: "Support Policy SP-2, p.1" },
    { id: "F-05", label: "Enterprise clients served", keywords: ["clients", "brands", "enterprises"], value: 120, unit: "+", source: "Annual Report FY25-26, p.9" },
    { id: "F-06", label: "Audit accuracy on internal benchmark", keywords: ["accuracy"], value: 92, unit: "%", source: "Model Evaluation Report R2, p.4" },
  ],
  approvedStatements: [
    { id: "S-01", text: "ISO 27001", label: "ISO/IEC 27001 certified", source: "Certificate No. IN-27001-4471" },
    { id: "S-02", text: "data is encrypted", label: "Encryption at rest and in transit", source: "Security Whitepaper, p.6" },
  ],
};

// Used when the user supplies their own policy: only universal safety checks stay on
// (personal data, absolute guarantees, unsourced numbers, hype/tone). Everything else
// comes from the user's policy, so demo facts and terms never leak into their audit.
export const CORE_POLICY = {
  id: "user-policy",
  name: "Your policy",
  tone: null,
  maxDeliveryDays: null,
  bannedTerms: [],
  approvedFacts: [],
  approvedStatements: [],
};

// Words and phrases the tone auditor treats as hype / casual language.
export const HYPE_WORDS = [
  "revolutionary", "game-changing", "game changer", "mind-blowing", "unbelievable", "insane",
  "amazing", "incredible", "unmatched", "unbeatable", "best ever", "world's best", "ultimate",
  "jaw-dropping", "groundbreaking", "disruptive", "magic", "perfect", "flawless",
];

export const CASUAL_WORDS = [
  "awesome", "super", "gonna", "wanna", "crazy", "lol", "cool", "stuff", "folks", "hey", "guys", "kinda", "totally",
];

export const POLICY_TEMPLATE_TEXT = `# PUBLIVRA policy import format (one rule per line)
TONE: Formal
MAX_DELIVERY_DAYS: 60
BANNED: industry-first => new to our range | TERM-9 Product naming | medium
FACT: Warranty period | warranty | 2 | years | Warranty Terms WT-1, p.1
STATEMENT: SOC 2 Type II | SOC 2 Type II report | Auditor letter 2026
`;
