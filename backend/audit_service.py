"""Orchestrates one audit: approved sources -> Qdrant retrieval -> Gemini -> normalised findings -> Neon."""
import hashlib
import re

import brand_engine
import config
import database
import policy_index
import rag_engine

TONE_PROFILES = {"Professional", "Formal", "Friendly"}

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[₹A-Z0-9])")


def split_sentences(text: str):
    """Mirror of the frontend splitter so sentences line up for 'locate' and 'accept fix'."""
    out = []
    for line in re.split(r"\n+", text or ""):
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        for s in SENTENCE_SPLIT.split(line):
            s = s.strip()
            if len(s) > 2:
                out.append(s)
    return out


def locate(sentences, claim: str):
    """Find the sentence containing `claim`. Returns (sentence, exact_span, offset) or (None, claim, None)."""
    needle = re.sub(r"\s+", " ", claim or "").strip().strip('"“”')
    if not needle:
        return None, claim, None
    low = needle.lower()
    for s in sentences:
        i = s.lower().find(low)
        if i >= 0:
            return s, s[i : i + len(needle)], i
    # Fuzzy fallback: the model sometimes trims punctuation or adds words.
    head = low[:40]
    if len(head) >= 12:
        for s in sentences:
            i = s.lower().find(head)
            if i >= 0:
                return s, s[i : i + len(head)], i
    return None, needle, None


def compute_risk(findings, tone_score: int):
    contradicted = [f for f in findings if f["verdict"] == "CONTRADICTED"]
    unverified = [f for f in findings if f["verdict"] == "UNVERIFIED"]
    high = [f for f in contradicted if f["severity"] == "high"]
    weight = {"high": 30, "medium": 15, "low": 5}
    score = sum(weight.get(f["severity"], 5) for f in contradicted) + 8 * len(unverified) + max(0, 8 - tone_score) * 2
    level = "LOW"
    if high:
        level = "HIGH"
    elif contradicted or len(unverified) >= 2 or tone_score < 6:
        level = "MEDIUM"
    return level, min(100, score)


def normalise(report, document: str, index=None):
    sentences = split_sentences(document)
    findings, seen = [], set()
    for f in report.findings:
        sentence, span, offset = locate(sentences, f.claim_text)
        if sentence is None:
            # Not in the current document (e.g. quoted from the policy or an earlier version): drop it.
            continue
        key = (f.verdict, (span or "").lower(), sentence)
        if key in seen:
            continue
        seen.add(key)
        rewrite = (f.suggested_rewrite or "").strip()
        if f.verdict == "VERIFIED" or sentence is None or rewrite.lower() == (span or "").lower():
            rewrite = ""
        fid = "ai:" + hashlib.sha1(f"{sentence}|{span}|{f.verdict}".encode()).hexdigest()[:12]
        ref = policy_index.find_ref(index or [], f.policy_quote, f"{f.policy_reference} {f.source_reference}")
        source_label = (
            f"{ref['source']}, " + (f"p.{ref['page']} " if ref["page"] else "") + f"line {ref['line']}"
            if ref
            else (f.source_reference or "No approved source").strip()
        )
        findings.append(
            {
                "id": fid,
                "claim_text": span,
                "sentence": sentence,
                "offset": offset,
                "located": sentence is not None,
                "category": f.category,
                "verdict": f.verdict,
                "severity": "none" if f.verdict == "VERIFIED" else (f.severity if f.severity != "none" else "medium"),
                "explanation": f.explanation.strip(),
                "source_reference": source_label,
                "policy_ref": ref,
                "policy_quote": (ref["text"] if ref and ref["verified"] else f.policy_quote or "").strip(),
                "recommendation": (f.recommendation or "").strip(),
                "suggested_rewrite": rewrite,
            }
        )
    return findings


def build_sources(policy_rules: str = "", policy_document=None):
    """The user's policy is the knowledge base. The default guidelines (plus the dashboard's
    default facts) are used only when no policy is given."""
    if policy_document and (policy_document.get("text") or "").strip():
        return [rag_engine.Source(policy_document.get("name") or "Uploaded policy", policy_document["text"][: config.MAX_POLICY_CHARS])]
    sources = [rag_engine.Source("Default Brand Guidelines", config.guidelines_text())]
    if policy_rules and policy_rules.strip():
        sources.append(rag_engine.Source("Live rule checks", policy_rules[: config.MAX_POLICY_CHARS]))
    return sources


def build_context(sources, document_text: str):
    """Number every policy line, then send the whole policy if it fits, else retrieve via Qdrant.

    Returns (context, retrieval_info, index) where index lists every numbered policy line.
    """
    index, numbered = [], []
    for src in sources:
        lines = policy_index.number_policy(src.text, src.name)
        index += lines
        numbered.append(rag_engine.Source(src.name, policy_index.numbered_text(lines)))
    total = sum(len(s.text) for s in numbered)
    if total <= config.POLICY_FULL_CHARS:
        context = "\n\n".join(f"=== {s.name} ===\n{s.text}" for s in numbered)
        return context, {"mode": "full-policy", "chunks": len(index), "sources": [s.name for s in numbered]}, index
    context, info = rag_engine.retrieve(numbered, document_text)
    return context, info, index


def audit_text(*, text, title="Untitled", source="editor", policy_rules="", policy_document=None, tone_profile="Professional", model_factory=None, log_to_db=True):
    text = (text or "")[: config.MAX_DOCUMENT_CHARS]
    tone_profile = tone_profile if tone_profile in TONE_PROFILES else "Professional"

    sources = build_sources(policy_rules, policy_document)
    context, retrieval, index = build_context(sources, text[: config.LLM_MAX_DOC_CHARS])

    # Free-tier LLMs have small per-minute token budgets: the policy context takes priority,
    # the document gets the rest of the budget (at least 4,000 characters).
    doc_budget = max(4000, min(config.LLM_MAX_DOC_CHARS, config.LLM_INPUT_BUDGET_CHARS - len(context)))
    llm_text = text[:doc_budget]
    truncated = len(text) > len(llm_text)

    report, model_used = brand_engine.run_audit(llm_text, title, context, tone_profile, model_factory=model_factory)
    tone_score = max(0, min(10, int(report.tone_score)))
    findings = normalise(report, text, index)
    level, score = compute_risk(findings, tone_score)
    is_compliant = not any(f["verdict"] == "CONTRADICTED" for f in findings)

    result = {
        "title": title,
        "policy_used": (policy_document or {}).get("name") or "Default Brand Guidelines",
        "model": model_used,
        "truncated": truncated,
        "audited_chars": len(llm_text),
        "retrieval": retrieval,
        "is_compliant": is_compliant,
        "status": "COMPLIANT" if is_compliant else "NON_COMPLIANT",
        "overall_tone": report.overall_tone,
        "tone_score": tone_score,
        "tone_profile": tone_profile,
        "summary": report.summary,
        "findings": findings,
        "forbidden_terms": list(dict.fromkeys(report.forbidden_terms or [])),
        "recommendations": (report.recommendations or [])[:5],
        "risk_level": level,
        "risk_score": score,
        "counts": {v: sum(1 for f in findings if f["verdict"] == v) for v in ("VERIFIED", "UNVERIFIED", "CONTRADICTED")},
    }

    audit_id, created_at = (None, None)
    if log_to_db:
        violations = "\n".join(f"{f['claim_text']}: {f['explanation']}" for f in findings if f["verdict"] == "CONTRADICTED") or "None"
        audit_id, created_at = database.save_audit(
            filename=title or "Untitled",
            text=text,
            is_compliant=is_compliant,
            status_label=result["status"],
            violations=violations,
            source=source,
            risk_level=level,
            tone=report.overall_tone,
            summary=report.summary,
            model=model_used,
            report=result,
        )
    result.update(audit_id=audit_id, created_at=created_at, db_logged=audit_id is not None)
    return result
