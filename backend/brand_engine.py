"""LLM reasoning layer: Groq first, Gemini as fallback, called through LangChain.

Reliability design (learned from real failures):
- Models are discovered live from Groq's /models endpoint, so retired models are skipped
  automatically instead of returning 404.
- The model is asked for plain JSON (JSON mode), not tool calls. Tool calling failed on
  gpt-oss ("failed to parse tool call arguments" / "model did not call a tool").
- The reply is parsed leniently: code fences and <think> blocks are stripped, truncated JSON is
  repaired, and near-miss values ("Contradicted", "Critical", "7/10") are coerced into the schema.
- Any failure moves on to the next model; the error lists what each model returned.
"""
import json
import logging
import re
import time
from typing import List, Literal

from pydantic import BaseModel

import config

log = logging.getLogger("publivra.ai")

PROVIDER_LABEL = {"groq": "Groq", "gemini": "Gemini"}
CATEGORIES = ["Facts & claims", "Terminology", "Tone", "Privacy", "Timeline", "Messaging"]


# --------------------------------------------------------------------------- schema
class ClaimFinding(BaseModel):
    claim_text: str
    category: Literal["Facts & claims", "Terminology", "Tone", "Privacy", "Timeline", "Messaging"]
    verdict: Literal["VERIFIED", "UNVERIFIED", "CONTRADICTED"]
    severity: Literal["high", "medium", "low", "none"]
    explanation: str
    source_reference: str
    suggested_rewrite: str = ""


class AuditReport(BaseModel):
    is_compliant: bool
    overall_tone: str
    tone_score: int
    summary: str
    findings: List[ClaimFinding]
    forbidden_terms: List[str] = []
    recommendations: List[str] = []


# --------------------------------------------------------------------------- prompt
AUDIT_SYSTEM = """You are PUBLIVRA AI, an enterprise brand-governance and claim-verification auditor.
You review content BEFORE publication against the organisation's APPROVED SOURCES only.

Rules:
1. Use ONLY the APPROVED SOURCES below as evidence. Never use outside knowledge to mark something VERIFIED.
2. UNVERIFIED is the default for any claim, figure or comparison not confirmed by an approved source.
3. CONTRADICTED when the content breaks a rule (restricted term, absolute guarantee, personal data,
   limit exceeded, wrong tone) or when an approved source states a different value.
4. VERIFIED only when an approved source explicitly confirms it; cite that source label.
5. claim_text MUST be copied exactly, character for character, from the document (2-20 words).
6. suggested_rewrite replaces claim_text only, keeps the creator's message and removes the violation.
   Do not invent facts: if no approved figure exists, soften or remove the number. Empty for VERIFIED.
7. Required tone profile: __TONE__. Score tone_score (0-10) against it.
8. Report each distinct issue once, at most 20 findings. Keep each explanation under 25 words.

Respond with ONLY a JSON object, no markdown, in exactly this shape:
{
  "is_compliant": false,
  "overall_tone": "Professional | Promotional | Exaggerated | Casual | Formal",
  "tone_score": 7,
  "summary": "2-3 sentence executive summary",
  "findings": [
    {
      "claim_text": "exact span from the document",
      "category": "Facts & claims | Terminology | Tone | Privacy | Timeline | Messaging",
      "verdict": "VERIFIED | UNVERIFIED | CONTRADICTED",
      "severity": "high | medium | low | none",
      "explanation": "why, naming the rule or fact",
      "source_reference": "source label from the context, or No approved source",
      "suggested_rewrite": "replacement for claim_text, or empty string"
    }
  ],
  "forbidden_terms": ["restricted terms found verbatim"],
  "recommendations": ["up to 5 short editorial recommendations"]
}
Severity: high = legal/privacy/absolute guarantee, medium = factual or policy mismatch, low = tone/terminology, none = verified.

APPROVED SOURCES (each chunk prefixed with its source label):
__CONTEXT__
"""

AUDIT_HUMAN = """DOCUMENT TITLE: __TITLE__

DOCUMENT TEXT TO AUDIT (return the JSON object only):
__DOCUMENT__"""


# --------------------------------------------------------------------------- JSON handling
def _scan_closers(s: str) -> str:
    """Return the brackets needed to close every structure still open in s (strings respected)."""
    stack, in_str, esc = [], False, False
    for ch in s:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]" and stack:
            stack.pop()
    return "" if in_str else "".join(reversed(stack))


def extract_json(text: str) -> dict:
    """Parse a model reply into a dict, tolerating fences, <think> blocks and truncation."""
    if not isinstance(text, str):
        text = str(text)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S | re.I)
    text = re.sub(r"```(?:json)?", "", text, flags=re.I)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in model reply")
    s = text[start:].strip()
    try:
        return json.loads(s[: s.rfind("}") + 1], strict=False)
    except Exception:
        pass
    # Truncated reply: cut back to a complete element and close the open brackets.
    cuts = [m.start() for m in re.finditer(r"[}\]]", s)][::-1][:80]
    for pos in cuts:
        head = s[: pos + 1].rstrip().rstrip(",")
        closers = _scan_closers(head)
        try:
            return json.loads(head + closers, strict=False)
        except Exception:
            continue
    raise ValueError("model reply was not valid JSON")


def _first_number(v, default):
    if isinstance(v, (int, float)):
        return v
    m = re.search(r"-?\d+(?:\.\d+)?", str(v or ""))
    return float(m.group()) if m else default


def _category(v: str) -> str:
    v = (v or "").lower()
    for key, cat in (
        ("term", "Terminology"), ("vocab", "Terminology"), ("tone", "Tone"), ("persona", "Tone"),
        ("privacy", "Privacy"), ("pii", "Privacy"), ("personal", "Privacy"), ("data", "Privacy"),
        ("time", "Timeline"), ("deliver", "Timeline"), ("schedule", "Timeline"), ("messag", "Messaging"),
    ):
        if key in v:
            return cat
    return "Facts & claims"


def _verdict(v: str) -> str:
    v = (v or "").upper()
    if any(k in v for k in ("CONTRA", "VIOLAT", "FAIL", "NON-COMPLIANT", "BREACH")):
        return "CONTRADICTED"
    if "VERIF" in v and "UN" not in v and "NOT" not in v:
        return "VERIFIED"
    return "UNVERIFIED"


def _severity(v: str, verdict: str) -> str:
    if verdict == "VERIFIED":
        return "none"
    v = (v or "").lower()
    if "crit" in v or "high" in v or "severe" in v:
        return "high"
    if "med" in v or "moder" in v:
        return "medium"
    if "low" in v or "minor" in v or "info" in v:
        return "low"
    return "medium"


def _str_list(v) -> list:
    out = []
    for x in v or []:
        if isinstance(x, dict):
            x = x.get("text") or x.get("term") or x.get("recommendation") or next(iter(x.values()), "")
        if str(x).strip():
            out.append(str(x).strip())
    return out


def coerce_report(d: dict) -> AuditReport:
    """Turn a loosely-shaped dict into a valid AuditReport."""
    raw = d.get("findings") or d.get("claims") or d.get("claims_evaluation") or []
    findings = []
    for f in raw if isinstance(raw, list) else []:
        if not isinstance(f, dict):
            continue
        claim = str(f.get("claim_text") or f.get("claim") or f.get("text") or f.get("span") or "").strip()
        if not claim:
            continue
        verdict = _verdict(str(f.get("verdict") or f.get("status") or ""))
        findings.append(
            ClaimFinding(
                claim_text=claim,
                category=_category(str(f.get("category") or f.get("type") or "")),
                verdict=verdict,
                severity=_severity(str(f.get("severity") or f.get("risk") or ""), verdict),
                explanation=str(f.get("explanation") or f.get("reason") or "").strip() or "Flagged by the AI audit.",
                source_reference=str(f.get("source_reference") or f.get("source") or "No approved source").strip(),
                suggested_rewrite="" if verdict == "VERIFIED" else str(f.get("suggested_rewrite") or f.get("rewrite") or f.get("fix") or "").strip(),
            )
        )
    comp = d.get("is_compliant")
    if isinstance(comp, str):
        comp = comp.strip().lower() in ("true", "yes", "compliant")
    if comp is None:
        comp = not any(f.verdict == "CONTRADICTED" for f in findings)
    return AuditReport(
        is_compliant=bool(comp),
        overall_tone=str(d.get("overall_tone") or d.get("tone") or "Unknown").strip()[:40],
        tone_score=int(max(0, min(10, round(_first_number(d.get("tone_score"), 5))))),
        summary=str(d.get("summary") or "").strip() or "AI audit completed.",
        findings=findings,
        forbidden_terms=_str_list(d.get("forbidden_terms")),
        recommendations=_str_list(d.get("recommendations"))[:5],
    )


def _reply_text(resp) -> str:
    content = getattr(resp, "content", resp)
    if isinstance(content, list):  # Gemini can return content parts
        content = "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    return content or ""


# --------------------------------------------------------------------------- providers
_groq_cache = {"at": 0.0, "ids": None}
_EXCLUDE = re.compile(r"whisper|tts|orpheus|guard|safeguard|compound|embed|playai|distil|allam", re.I)
_PREFER = ["gpt-oss-120b", "qwen", "kimi", "llama-4", "gpt-oss-20b", "llama", "mistral", "gemma", "deepseek"]


def groq_available_models():
    """Live list of Groq chat models (cached 10 min). None if the list can't be fetched."""
    if time.time() - _groq_cache["at"] < 600 and _groq_cache["ids"] is not None:
        return _groq_cache["ids"]
    try:
        import httpx

        r = httpx.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
            timeout=8,
        )
        r.raise_for_status()
        ids = [m["id"] for m in r.json().get("data", []) if m.get("active", True) and not _EXCLUDE.search(m["id"])]
        _groq_cache.update(at=time.time(), ids=ids)
        return ids
    except Exception as exc:
        log.warning("Could not list Groq models (%s); using configured list.", str(exc)[:120])
        return None


def resolve_chain(discover: bool = True) -> list:
    """Ordered (provider, model) pairs to try. Retired Groq models are dropped, live ones added."""
    by_provider = {}
    for provider, model in config.llm_chain():
        by_provider.setdefault(provider, []).append(model)

    if discover and by_provider.get("groq"):
        live = groq_available_models()
        if live:
            configured = by_provider["groq"]
            keep = [m for m in configured if m in live]
            skipped = [m for m in configured if m not in live]
            if skipped:
                log.info("Skipping Groq models that are no longer served: %s", ", ".join(skipped))
            rank = lambda m: next((i for i, k in enumerate(_PREFER) if k in m.lower()), len(_PREFER))
            extras = sorted((m for m in live if m not in keep), key=rank)
            by_provider["groq"] = (keep + extras)[: max(3, len(keep))]

    chain = []
    for provider in [p.lower() for p in config.LLM_PROVIDERS]:
        chain += [(provider, m) for m in by_provider.get(provider, [])]
    return chain


def _chat_model(provider: str, model_name: str):
    """LangChain chat model in JSON mode, with low retries (we fall through to the next model)."""
    if provider == "groq":
        from langchain_groq import ChatGroq

        llm = ChatGroq(
            model=model_name,
            api_key=config.GROQ_API_KEY,
            temperature=0.0,
            max_tokens=config.LLM_MAX_OUTPUT_TOKENS,
            max_retries=1,
            timeout=config.LLM_TIMEOUT_SECONDS,
        )
        extra = {"response_format": {"type": "json_object"}}
        if "gpt-oss" in model_name:
            extra["reasoning_effort"] = "low"  # keeps hidden reasoning tokens (and TPM use) small
        elif "qwen" in model_name:
            extra["reasoning_format"] = "hidden"  # JSON mode requires hidden/parsed reasoning
        return llm.bind(**extra)
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        kwargs = dict(
            model=model_name,
            google_api_key=config.GOOGLE_API_KEY,
            temperature=0.0,
            max_output_tokens=8192,  # thinking models spend part of this budget on reasoning
            max_retries=1,
            timeout=config.LLM_TIMEOUT_SECONDS,
        )
        try:
            return ChatGoogleGenerativeAI(response_mime_type="application/json", **kwargs)
        except TypeError:
            return ChatGoogleGenerativeAI(**kwargs)
    raise ValueError(f"Unknown LLM provider: {provider}")


def _short(exc: Exception) -> str:
    msg = " ".join(str(exc).split())
    return msg[:170] + ("…" if len(msg) > 170 else "")


def run_audit(document: str, title: str, context: str, tone_profile: str, model_factory=None):
    """Try every available model until one returns a usable audit. Returns (AuditReport, label)."""
    chain = resolve_chain(discover=model_factory is None)
    if not chain:
        raise RuntimeError("No AI provider configured. Set GROQ_API_KEY (recommended) and/or GOOGLE_API_KEY on the server.")

    system = AUDIT_SYSTEM.replace("__TONE__", tone_profile).replace("__CONTEXT__", context or "(no approved sources supplied)")
    human = AUDIT_HUMAN.replace("__TITLE__", title or "Untitled").replace("__DOCUMENT__", document)
    messages = [("system", system), ("human", human)]
    factory = model_factory or _chat_model

    errors = []
    for provider, name in chain:
        try:
            reply = _reply_text(factory(provider, name).invoke(messages))
            report = coerce_report(extract_json(reply))
            if errors:
                log.info("Audit succeeded with %s/%s after %d fallback(s).", provider, name, len(errors))
            return report, f"{name} · {PROVIDER_LABEL.get(provider, provider)}"
        except Exception as exc:
            errors.append(f"{provider}/{name}: {_short(exc)}")
            log.warning("LLM %s/%s failed - trying next. %s", provider, name, _short(exc))
    raise RuntimeError("All AI models are busy or failed. Please retry in a minute. Details: " + " | ".join(errors))


def evaluate_brand_compliance(document_text: str, guidelines_text: str, model_factory=None):
    """Original brand-audit entry point, now backed by the unified AuditReport."""
    report, _ = run_audit(document_text, "Document", guidelines_text, "Professional", model_factory)
    return report
