/**
 * Signed-in session, in one of two modes:
 *
 *   { mode: "demo", company, domain, role, email }
 *       "Take a demo": no password, any role, data kept in this browser.
 *   { mode: "company", token, userId, name, email, company, companyId, domain, role }
 *       "Start as company": login ID + password checked by the backend, which returns a signed token
 *       holding the user, the company and the role. Company and role always come from the server.
 *
 * The server re-checks the membership on every request, so removing a member ends their access
 * even while their token is still valid.
 */
const KEY = "publivra.session.v3";
const LAST_DEMO = "publivra.lastCompany.v1";
const LAST_LOGIN = "publivra.lastLogin.v1";
const SUFFIXES = new Set(["corp", "corporation", "inc", "incorporated", "ltd", "limited", "pvt", "private", "llc", "llp", "plc", "co", "company", "group", "gmbh", "sa", "ag", "the"]);

// The dashboard calls the third role "legal"; the database calls it "legal_approver".
export const toApiRole = (role) => (role === "legal" ? "legal_approver" : role);
export const toUiRole = (role) => (role === "legal_approver" ? "legal" : role);

/** "Publivra Corp" -> "publivra.com", "Nexus Mobile Pvt Ltd" -> "nexusmobile.com" */
export function domainFromCompany(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const core = words.filter((w) => !SUFFIXES.has(w));
  const base = (core.length ? core : words).slice(0, 2).join("");
  return base ? `${base}.com` : "";
}

export const cleanDomain = (d) =>
  String(d || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9.-]/g, "");

export function isValidDomain(d) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
}

export function emailError(email, domain) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "Enter your company ID.";
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(e)) return `Use the format username@${domain}.`;
  if (!e.endsWith(`@${domain}`)) return `This ID must end with @${domain}.`;
  return "";
}

/** Login response -> company-mode session. */
export function sessionFromLogin(res) {
  return {
    mode: "company",
    token: res.token,
    expiresAt: Date.now() + (res.expires_in || 0) * 1000,
    userId: res.user.user_id,
    name: res.user.full_name,
    email: res.user.email,
    company: res.company.company_name,
    companyId: res.company.company_id,
    domain: res.company.company_domain || "",
    role: toUiRole(res.role),
  };
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s || !s.company || !s.email || !s.role) return null;
    if (s.mode === "company") return s.token && (!s.expiresAt || s.expiresAt > Date.now()) ? s : null;
    return s.mode === "demo" ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    if (s.mode === "company") localStorage.setItem(LAST_LOGIN, JSON.stringify({ email: s.email, role: s.role }));
    else localStorage.setItem(LAST_DEMO, JSON.stringify({ company: s.company, domain: s.domain }));
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};
/** Demo: the company used last time on this browser. */
export const lastCompany = () => read(LAST_DEMO);
/** Company mode: login ID and role of the last sign-in (never the password). */
export const lastLogin = () => read(LAST_LOGIN);
