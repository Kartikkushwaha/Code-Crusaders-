// Thin client for the PUBLIVRA AI FastAPI backend (Render).
// Set VITE_API_URL in Vercel (Project → Settings → Environment Variables) or in .env.production.

export const API_BASE = (import.meta.env.VITE_API_URL || "https://event-manager-som4.onrender.com").replace(/\/+$/, "");

// Owner of the audit history in demo mode: the demo session id ("demo:..."). In company mode it is
// empty and the server takes the company from the sign-in token instead.
let tenantTag = "";
export function setTenantTag(tag) {
  tenantTag = tag || "";
}
const owner = () => `company=${encodeURIComponent(tenantTag)}`;

// Sign-in token (set after login). It is sent as a Bearer header; the server decides what it allows.
let authToken = null;
let onUnauthorized = null;
export function setAuthToken(token) {
  authToken = token || null;
}
/** Called when the server says the session is no longer valid (expired token, membership removed). */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function errorMessage(data, status) {
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  // FastAPI validation errors: [{ loc, msg }]
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error,\s*/i, "");
  return `Server responded ${status}`;
}

async function request(path, { method = "GET", body, form, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      // `form` is a FormData upload: the browser sets the multipart content type itself.
      headers: { ...(body && !form ? { "Content-Type": "application/json" } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: form || (body ? JSON.stringify(body) : undefined),
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const err = new Error(errorMessage(data, res.status));
      err.status = res.status;
      if (res.status === 401 && authToken && !path.startsWith("/api/auth/login")) onUnauthorized?.(err.message);
      throw err;
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

const json = (path, method, body, timeout = 30000) => request(path, { method, body, timeout });

export const api = {
  // ---- sign-in: company registration and role logins (wakes a sleeping Render instance, hence the long timeouts)
  auth: {
    // company + the login ID and password of its Creator, Manager and Legal Approver
    registerCompany: (payload) => json("/api/auth/company/register", "POST", payload, 75000),
    login: (payload) => json("/api/auth/login", "POST", payload, 75000),
    me: () => request("/api/auth/me", { timeout: 75000 }),
  },
  // ---- approval workflow, stored in the database and scoped to the signed-in company
  workflow: {
    list: () => request("/api/workflow/content?limit=100", { timeout: 75000 }),
    get: (id) => request(`/api/workflow/content/${id}`),
    create: (payload) => json("/api/workflow/content", "POST", payload),
    update: (id, payload) => json(`/api/workflow/content/${id}`, "PUT", payload),
    submit: (id) => json(`/api/workflow/content/${id}/submit`, "POST"),
    managerReview: (id, payload) => json(`/api/workflow/content/${id}/manager-review`, "POST", payload),
    legalReview: (id, payload) => json(`/api/workflow/content/${id}/legal-review`, "POST", payload),
    publish: (id) => json(`/api/workflow/content/${id}/publish`, "POST"),
  },
  // Render free instances sleep; the first request can take ~50 s to wake them.
  health: () => request("/api/health", { timeout: 75000 }),
  audit: (payload) => request("/api/audit", { method: "POST", body: payload, timeout: 150000 }),
  createPublication: (payload) => request("/api/publications", { method: "POST", body: payload }),
  verifyPublication: (id, payload) => request(`/api/publications/${id}/verify?${owner()}`, { method: "POST", body: payload }),
  logEvent: (payload) => request("/api/events", { method: "POST", body: payload }).catch(() => null),
  // history of the signed-in company (from the token) or of this demo session only
  listAudits: (limit = 50) => request(`/api/audits?limit=${limit}&${owner()}`, { timeout: 75000 }),
  listPublications: (limit = 50) => request(`/api/publications?limit=${limit}&${owner()}`, { timeout: 75000 }),
  // Video audit: the upload returns a job id at once; the status call is polled for progress and the result.
  startVideoAudit: (form) => request("/api/video-audit", { method: "POST", form, timeout: 180000 }),
  videoAuditStatus: (jobId) => request(`/api/video-audit/${jobId}`, { timeout: 30000 }),
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
