/**
 * Enterprise sign-in (demo): Parent company -> one of 3 child roles.
 * The company is the tenant: it tags every check, filters the approval queue and the company graph.
 * No passwords - this is a role sign-in for the hackathon demo, kept in localStorage.
 */
const KEY = "publivra.session.v1";
const LAST_COMPANY = "publivra.lastCompany.v1";
const SUFFIXES = new Set(["corp", "corporation", "inc", "incorporated", "ltd", "limited", "pvt", "private", "llc", "llp", "plc", "co", "company", "group", "gmbh", "sa", "ag", "the"]);

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

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s && s.company && s.email && s.role ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.setItem(LAST_COMPANY, JSON.stringify({ company: s.company, domain: s.domain }));
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

export function lastCompany() {
  try {
    return JSON.parse(localStorage.getItem(LAST_COMPANY) || "null");
  } catch {
    return null;
  }
}
