// Thin client for the PUBLIVRA AI FastAPI backend (Render).
// Set VITE_API_URL in Vercel (Project → Settings → Environment Variables) or in .env.production.

export const API_BASE = (import.meta.env.VITE_API_URL || "https://event-manager-som4.onrender.com").replace(/\/+$/, "");

async function request(path, { method = "GET", body, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const detail = data?.detail;
      throw new Error(typeof detail === "string" ? detail : `Server responded ${res.status}`);
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The AI engine took too long to respond. Please try again.");
    if (e instanceof TypeError) throw new Error(`Cannot reach the AI engine at ${API_BASE}.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  // Render free instances sleep; the first request can take ~50 s to wake them.
  health: () => request("/api/health", { timeout: 75000 }),
  audit: (payload) => request("/api/audit", { method: "POST", body: payload, timeout: 150000 }),
  createPublication: (payload) => request("/api/publications", { method: "POST", body: payload }),
  verifyPublication: (id, payload) => request(`/api/publications/${id}/verify`, { method: "POST", body: payload }),
  logEvent: (payload) => request("/api/events", { method: "POST", body: payload }).catch(() => null),
  listAudits: (limit = 50) => request(`/api/audits?limit=${limit}`, { timeout: 75000 }),
  listPublications: (limit = 50) => request(`/api/publications?limit=${limit}`, { timeout: 75000 }),
  // Improvement 2: bar-chart data, before (AI audits) and after (publications) in one call.
  analytics: ({ company = "", days = 0 } = {}) =>
    request(`/api/analytics/compare?company=${encodeURIComponent(company)}&days=${days}`, { timeout: 75000 }),
};

/** Shape a dashboard finding (rule engine or AI) the way the backend stores it for the charts. */
export function toServerFinding(f) {
  return {
    claim_text: f.match || f.sentence || "",
    category: f.category || "",
    verdict: f.verdict,
    severity: f.severity,
    explanation: f.explanation || "",
    source_reference: f.source || f.clause || "",
    policy_quote: f.policyQuote || "",
    policy_ref: f.policyRef || null,
  };
}

/** Map a backend finding onto the shape the dashboard uses for rule findings. */
export function toUiFinding(f) {
  const sentence = f.sentence || f.claim_text;
  const suggestion =
    f.suggested_rewrite && f.located
      ? {
          find: f.claim_text,
          replace: f.suggested_rewrite,
          preview: sentence.replace(f.claim_text, f.suggested_rewrite).replace(/\s{2,}/g, " ").trim(),
        }
      : null;
  return {
    id: f.id,
    ai: true,
    located: f.located,
    sentence,
    ruleKey: "ai",
    verdict: f.verdict,
    severity: f.verdict === "VERIFIED" ? "none" : f.severity,
    category: f.category,
    match: f.claim_text,
    offset: f.offset ?? 0,
    clause: "AI · policy audit",
    explanation: f.explanation,
    source: f.source_reference,
    // { source, page, line, text, verified } - the policy line this finding relies on
    policyRef: f.policy_ref || null,
    policyQuote: f.policy_quote || f.policy_ref?.text || "",
    recommendation: f.recommendation || "",
    suggestion,
  };
}
