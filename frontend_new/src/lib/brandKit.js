/**
 * Brand kit for the visual audit: reference logo, brand colours, brand name and motto.
 * Colours, brand name and motto are read from the policy text automatically; the creator
 * can correct them and upload the reference logo. Edits are kept in localStorage.
 */
const KEY = "publivra.brandkit.v1";

const clean = (s) =>
  String(s || "")
    .replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function normHex(h) {
  let x = String(h || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(x)) x = x.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(x) ? `#${x}` : null;
}

/** Pull brand colours, brand name and motto out of policy text. */
export function parseBrandKit(text) {
  const src = String(text || "");
  const colors = [];
  const seen = new Set();
  const add = (hex, name) => {
    const h = normHex(hex);
    if (h && !seen.has(h)) {
      seen.add(h);
      colors.push({ hex: h, name: clean(name).slice(0, 40) });
    }
  };
  for (const line of src.split(/\n/)) {
    for (const m of line.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const before = line.slice(0, m.index).split(/[|:,;(\-–]/).pop() || "";
      add(m[1], before.split(/\s+/).slice(-3).join(" "));
    }
    for (const m of line.matchAll(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi)) {
      const hex = [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, "0")).join("");
      add(hex, line.slice(0, m.index).split(/[|:,;(]/).pop());
    }
  }
  const pick = (re) => {
    const m = src.match(re);
    return m ? clean(m[1]) : "";
  };
  const brandName = pick(/(?:brand|company|product|organisation|organization)\s*name\s*(?:is|must be|[:|\-–=])\s*["“']?([^\n"”|]{2,60})/i);
  const motto = pick(/(?:motto|tag\s?line|slogan|strapline)\s*(?:is|must be|[:|\-–=])\s*["“']?([^\n"”|]{3,140})/i);
  return { colors: colors.slice(0, 12), brandName, motto };
}

export function loadSavedKit() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveKit(kit) {
  try {
    localStorage.setItem(KEY, JSON.stringify(kit));
    return true;
  } catch {
    return false;
  }
}

/** Saved edits win over what was read from the policy. */
export function effectiveKit(policyText, saved) {
  const derived = parseBrandKit(policyText);
  return {
    logo: saved.logo || null,
    logoName: saved.logoName || "",
    colors: saved.colors ? saved.colors : derived.colors,
    brandName: saved.brandName !== undefined ? saved.brandName : derived.brandName,
    motto: saved.motto !== undefined ? saved.motto : derived.motto,
    derived,
  };
}
