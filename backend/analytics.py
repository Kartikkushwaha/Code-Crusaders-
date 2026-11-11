"""Improvement 2: per-section breakdown of every audit, and the bar-chart data built from it.

Each audit (before publication) and each publication (after the creator's fixes) is split into
four chart sections. For every section we store a 0-100 risk score, a HIGH/MEDIUM/LOW level,
an issue count and the list of issues (shown when a bar is hovered or clicked).
"""
from collections import Counter

import pandas as pd

# x-axis of the bar chart, in display order: (key used in DB columns, label)
SECTIONS = [("tone", "Tone"), ("logo", "Logo"), ("privacy", "Data & Privacy"), ("other", "Others")]
SECTION_KEYS = [k for k, _ in SECTIONS]
LABELS = dict(SECTIONS)

WEIGHT = {"high": 30, "medium": 15, "low": 5}
MAX_ISSUES_STORED = 25


def section_of(category: str) -> str:
    """Map a finding category (AI or rule engine) to a chart section."""
    c = (category or "").lower()
    if "tone" in c or "persona" in c:
        return "tone"
    if any(k in c for k in ("logo", "visual", "colour", "color", "image")):
        return "logo"
    if any(k in c for k in ("privacy", "pii", "personal", "data")):
        return "privacy"
    return "other"


def level_for(score: float, has_high: bool = False) -> str:
    if has_high or score >= 60:
        return "HIGH"
    if score >= 25:
        return "MEDIUM"
    return "LOW"


def _issue(f: dict) -> dict:
    ref = f.get("policy_ref") or {}
    return {
        "claim": str(f.get("claim_text") or "")[:200],
        "verdict": f.get("verdict"),
        "severity": f.get("severity") or "medium",
        "category": f.get("category") or "",
        "rule": str(f.get("policy_quote") or f.get("explanation") or f.get("source_reference") or "")[:240],
        "policy_line": (f"line {ref['line']}" if ref.get("line") else "") or str(f.get("source_reference") or "")[:80],
    }


def breakdown(findings, tone_score=None) -> dict:
    """findings: list of finding dicts (AI and/or rule engine). tone_score: 0-10 from the AI.

    Returns {section: {"score", "level", "count", "issues"}} for every chart section.
    """
    out = {k: {"score": 0, "level": "LOW", "count": 0, "issues": []} for k in SECTION_KEYS}
    high = {k: False for k in SECTION_KEYS}
    seen = set()
    for f in findings or []:
        if not isinstance(f, dict) or f.get("verdict") not in ("CONTRADICTED", "UNVERIFIED"):
            continue
        key = section_of(f.get("category"))
        claim = " ".join(str(f.get("claim_text") or "").lower().split())
        # the AI and the rule checks often flag the same text ("PAN ABCDE1234F" vs "ABCDE1234F"): count it once
        if any(k == key and claim and (claim in c or c in claim) for k, c in seen):
            continue
        seen.add((key, claim))
        sev = f.get("severity") if f.get("severity") in WEIGHT else "medium"
        sec = out[key]
        sec["score"] += WEIGHT[sev] if f["verdict"] == "CONTRADICTED" else 8
        sec["count"] += 1
        if f["verdict"] == "CONTRADICTED" and sev == "high":
            high[key] = True
        if len(sec["issues"]) < MAX_ISSUES_STORED:
            sec["issues"].append(_issue(f))
    if tone_score is not None:
        # A tone that misses the brand profile raises the Tone bar even without a flagged sentence.
        out["tone"]["score"] += max(0, 8 - int(round(float(tone_score)))) * 5
    for k, sec in out.items():
        sec["score"] = min(100, sec["score"])
        sec["level"] = level_for(sec["score"], high[k])
    return out


def columns(b: dict) -> dict:
    """Flatten a breakdown into DB column values: tone_score, tone_level, tone_count, tone_issues, ..."""
    cols = {}
    for k in SECTION_KEYS:
        sec = b.get(k) or {}
        cols[f"{k}_score"] = int(sec.get("score") or 0)
        cols[f"{k}_level"] = sec.get("level") or "LOW"
        cols[f"{k}_count"] = int(sec.get("count") or 0)
        cols[f"{k}_issues"] = sec.get("issues") or []
    return cols


def chart(rows, stage: str) -> dict:
    """Build the bar chart from DB rows (each row holds the flattened section columns).

    x = section, y = average risk score (0-100) + level; hover = level mix and most repeated issues.
    """
    df = pd.DataFrame(rows or [])
    bars = []
    for key, label in SECTIONS:
        bar = {"key": key, "label": label, "avg_score": 0, "level": "LOW", "issues_total": 0,
               "documents": 0, "documents_with_issues": 0, "levels": {"HIGH": 0, "MEDIUM": 0, "LOW": 0}, "top_issues": []}
        if not df.empty and f"{key}_score" in df:
            scores = pd.to_numeric(df[f"{key}_score"], errors="coerce").fillna(0)
            counts = pd.to_numeric(df.get(f"{key}_count"), errors="coerce").fillna(0)
            levels = df.get(f"{key}_level", pd.Series(dtype=str)).fillna("LOW").str.upper()
            avg = round(float(scores.mean()), 1)
            bar.update(
                avg_score=avg,
                level=level_for(avg),
                issues_total=int(counts.sum()),
                documents=int(len(df)),
                documents_with_issues=int((counts > 0).sum()),
                levels={lv: int((levels == lv).sum()) for lv in ("HIGH", "MEDIUM", "LOW")},
            )
            tally, example = Counter(), {}
            for issues in df.get(f"{key}_issues", []):
                for i in issues or []:
                    name = (i.get("rule") or i.get("claim") or "").strip()
                    if name:
                        tally[name] += 1
                        example.setdefault(name, i)
            bar["top_issues"] = [
                {"issue": n, "times": c, "policy_line": example[n].get("policy_line", ""), "example": example[n].get("claim", "")}
                for n, c in tally.most_common(5)
            ]
        bars.append(bar)
    return {"stage": stage, "documents": int(len(df)), "bars": bars}
