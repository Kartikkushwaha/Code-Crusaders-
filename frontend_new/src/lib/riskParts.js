// Risk is scored in three parts - text (including tone), logo & graphics, and video - and the
// overall score is the average of the parts that were checked.
import { computeRisk } from "./policyEngine.js";

const ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 };
export const PART_ORDER = ["text", "graphics", "video"];
export const PART_LABEL = { text: "Text & tone", graphics: "Logo & graphics", video: "Video" };

/**
 * parts.text      live rules + AI audit of the document, plus its tone score
 * parts.graphics  image audit: logo vs the reference logo, brand colours, text inside images (null if no image)
 * parts.video     video audit: on-screen text, speech, audio, colours, logo, tone (null if no video)
 *
 * score = average of the parts checked. level = the highest level of any part, so one serious
 * breach (for example personal data in a video) is never averaged away.
 */
export function combineRisk({ textFindings, tone, imageFindings = [], hasImages = false, videos = [], dismissed = {} }) {
  const profile = tone?.profile || "Professional";
  const videoTone = videos.length ? Math.min(...videos.map((v) => v.tone?.score ?? 10)) : 10;
  const parts = {
    text: computeRisk(textFindings, tone, dismissed),
    // images carry no tone of their own: their ad text is already judged finding by finding
    graphics: hasImages ? computeRisk(imageFindings, { score: 10, profile }, dismissed) : null,
    video: videos.length ? computeRisk(videos.flatMap((v) => v.findings), { score: videoTone, profile }, dismissed) : null,
  };
  const checked = PART_ORDER.filter((k) => parts[k]);
  const score = Math.round(checked.reduce((a, k) => a + parts[k].score, 0) / checked.length);
  const level = checked.reduce((a, k) => (ORDER[parts[k].level] > ORDER[a] ? parts[k].level : a), "LOW");
  const counts = { verified: 0, unverified: 0, contradicted: 0, high: 0, dismissed: 0 };
  checked.forEach((k) => Object.keys(counts).forEach((c) => (counts[c] += parts[k].counts[c] || 0)));
  const reasons = checked.flatMap((k) => (checked.length > 1 ? parts[k].reasons.map((r) => `${PART_LABEL[k]}: ${r}`) : parts[k].reasons));
  return { level, score, counts, reasons, parts, checked };
}

/** Compact copy for storage / the manager's panel. */
export function partScores(risk) {
  const out = {};
  PART_ORDER.forEach((k) => (out[k] = risk.parts?.[k] ? { score: risk.parts[k].score, level: risk.parts[k].level } : null));
  return out;
}
