"""Offline tests: no network, no API key, no database needed.

Run from the backend folder:
    python -m tests.test_core
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402

# Force offline mode before other modules read config.
config.GOOGLE_API_KEY = ""  # no embeddings -> full-context retrieval
config.DATABASE_URL = config.DB_HOST = config.DB_PASSWORD = ""
config.LLM_PROVIDERS = ["groq"]
config.GROQ_API_KEY = "test"
config.GROQ_MODELS = ["model-a", "model-b"]

import audit_service  # noqa: E402
import brand_engine  # noqa: E402
import rag_engine  # noqa: E402
from brand_engine import AuditReport  # noqa: E402

DOC = """NexusMobile Service Proposal
Contact owner: Rahul Mehta, PAN ABCDE1234F.
The new handset ships with a 50 MP camera and a 6000 mAh battery.
We guarantee instant results and our customers report 3x faster approvals."""

CANNED = {
    "is_compliant": False,
    "overall_tone": "Promotional",
    "tone_score": 5,
    "summary": "Exposes a PAN number and makes an absolute guarantee.",
    "findings": [
        {"claim_text": "PAN ABCDE1234F", "category": "Privacy", "verdict": "CONTRADICTED", "severity": "high",
         "explanation": "Personal identifier exposed.", "source_reference": "Brand Guidelines", "suggested_rewrite": "PAN ABXXXXXX4F"},
        {"claim_text": "50 MP camera", "category": "Facts & claims", "verdict": "VERIFIED", "severity": "none",
         "explanation": "Matches spec sheet.", "source_reference": "Policy Library", "suggested_rewrite": "should be dropped"},
        {"claim_text": "We Guarantee Instant Results", "category": "Facts & claims", "verdict": "CONTRADICTED", "severity": "high",
         "explanation": "Absolute guarantee.", "source_reference": "Brand Guidelines", "suggested_rewrite": "We aim to deliver fast results"},
        {"claim_text": "3x faster approvals", "category": "Facts & claims", "verdict": "UNVERIFIED", "severity": "medium",
         "explanation": "No approved source.", "source_reference": "No approved source", "suggested_rewrite": "faster approvals"},
        {"claim_text": "text that is not in the document at all", "category": "Tone", "verdict": "UNVERIFIED", "severity": "low",
         "explanation": "Hallucinated span.", "source_reference": "-", "suggested_rewrite": "x"},
    ],
    "forbidden_terms": ["customers"],
    "recommendations": ["Mask the PAN."],
}


class Reply:
    def __init__(self, content):
        self.content = content


class FakeModel:
    """Stands in for ChatGroq / ChatGoogleGenerativeAI. `fail` simulates an error, `reply` a raw answer."""

    calls = []

    def __init__(self, provider, name, fail=None, reply=None):
        self.name = name
        self.fail = fail
        self.reply = reply
        FakeModel.calls.append(name)

    def invoke(self, _messages):
        if self.fail:
            raise RuntimeError(self.fail)
        return Reply(self.reply if self.reply is not None else json.dumps(CANNED))


def test_sentences_and_locate():
    s = audit_service.split_sentences("Uptime is 99.5% today. Next one!\n\nThird line")
    assert s == ["Uptime is 99.5% today.", "Next one!", "Third line"], s
    sent, span, off = audit_service.locate(s, "uptime IS 99.5%")
    assert sent == "Uptime is 99.5% today." and span == "Uptime is 99.5%" and off == 0


def test_audit_pipeline():
    FakeModel.calls = []
    r = audit_service.audit_text(text=DOC, title="Proposal", model_factory=lambda p, n: FakeModel(p, n), log_to_db=False)
    f = {x["claim_text"]: x for x in r["findings"]}
    assert r["risk_level"] == "HIGH", r["risk_level"]
    assert r["retrieval"]["mode"] == "full-context"
    assert f["PAN ABCDE1234F"]["located"] and f["PAN ABCDE1234F"]["suggested_rewrite"] == "PAN ABXXXXXX4F"
    assert f["50 MP camera"]["suggested_rewrite"] == "" and f["50 MP camera"]["severity"] == "none"
    assert "We guarantee instant results" in f  # exact casing recovered from the document
    unlocated = [x for x in r["findings"] if not x["located"]]
    assert len(unlocated) == 1 and unlocated[0]["suggested_rewrite"] == ""
    assert r["counts"] == {"VERIFIED": 1, "UNVERIFIED": 2, "CONTRADICTED": 2}, r["counts"]
    assert r["db_logged"] is False and FakeModel.calls == ["model-a"] and r["model"] == "model-a · Groq"
    assert r["truncated"] is False


def test_model_fallback():
    FakeModel.calls = []
    overloaded = "503 UNAVAILABLE: This model is currently experiencing high demand."
    factory = lambda p, n: FakeModel(p, n, fail=overloaded) if n == "model-a" else FakeModel(p, n)
    report, used = brand_engine.run_audit(DOC, "t", "ctx", "Professional", model_factory=factory)
    assert used == "model-b · Groq" and isinstance(report, AuditReport) and FakeModel.calls == ["model-a", "model-b"], used


def test_cross_provider_fallback():
    config.LLM_PROVIDERS, config.GOOGLE_API_KEY = ["groq", "gemini"], "g"
    config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODELS = "gem-1", []
    try:
        factory = lambda p, n: FakeModel(p, n) if p == "gemini" else FakeModel(p, n, fail="429 rate limit reached")
        _, used = brand_engine.run_audit(DOC, "t", "ctx", "Professional", model_factory=factory)
        assert used == "gem-1 · Gemini", used
    finally:
        config.LLM_PROVIDERS, config.GOOGLE_API_KEY = ["groq"], ""


def test_all_failing_raises_clear_error():
    try:
        brand_engine.run_audit(DOC, "t", "ctx", "Professional", model_factory=lambda p, n: FakeModel(p, n, fail="quota exceeded"))
    except RuntimeError as exc:
        assert "busy or failed" in str(exc) and "model-a" in str(exc) and "model-b" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")


def test_no_provider_configured():
    key = config.GROQ_API_KEY
    config.GROQ_API_KEY = ""
    try:
        brand_engine.run_audit(DOC, "t", "ctx", "Professional", model_factory=lambda p, n: FakeModel(p, n))
    except RuntimeError as exc:
        assert "GROQ_API_KEY" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
    finally:
        config.GROQ_API_KEY = key


def test_messy_replies_are_repaired():
    messy = (
        "<think>reasoning...</think>```json\n"
        '{"is_compliant": "false", "overall_tone": "Exaggerated", "tone_score": "3/10", "summary": "Bad.",'
        ' "findings": [{"claim": "We guarantee instant results", "category": "Claims", "verdict": "Contradicted",'
        ' "severity": "Critical", "explanation": "Absolute promise.", "source": "Brand Guidelines", "rewrite": "We aim to deliver"},'
        ' {"claim_text": "50 MP camera", "category": "fact", "verdict": "verified", "severity": "low", "explanation": "ok",'
        ' "source_reference": "Policy Library", "suggested_rewrite": "x"},'
        ' {"claim_text": "3x faster approvals", "category": "Facts & claims", "verdict": "UNVER'
    )  # truncated mid-finding, like a model hitting its output limit
    report, used = brand_engine.run_audit(DOC, "t", "ctx", "Professional", model_factory=lambda p, n: FakeModel(p, n, reply=messy))
    assert used == "model-a · Groq"
    assert report.tone_score == 3 and report.is_compliant is False and len(report.findings) == 2, report
    a, b = report.findings
    assert (a.verdict, a.severity, a.category, a.suggested_rewrite) == ("CONTRADICTED", "high", "Facts & claims", "We aim to deliver")
    assert (b.verdict, b.severity, b.suggested_rewrite) == ("VERIFIED", "none", "")


def test_non_json_reply_falls_through():
    FakeModel.calls = []
    factory = lambda p, n: FakeModel(p, n, reply="Sorry, I cannot help.") if n == "model-a" else FakeModel(p, n)
    _, used = brand_engine.run_audit(DOC, "t", "ctx", "Professional", model_factory=factory)
    assert used == "model-b · Groq" and FakeModel.calls == ["model-a", "model-b"]


def test_retired_groq_models_are_skipped():
    original = brand_engine.groq_available_models
    config.GROQ_MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]
    brand_engine.groq_available_models = lambda: ["whisper-large-v3", "openai/gpt-oss-120b", "qwen/qwen3.6-27b", "openai/gpt-oss-20b"]
    try:
        chain = brand_engine.resolve_chain(discover=True)
        assert chain == [("groq", "openai/gpt-oss-120b"), ("groq", "qwen/qwen3.6-27b"), ("groq", "openai/gpt-oss-20b")], chain
    finally:
        brand_engine.groq_available_models = original
        config.GROQ_MODELS = ["model-a", "model-b"]


def test_chunks_keep_pages():
    chunks = rag_engine.build_chunks([rag_engine.Source("Policy.pdf", "[Page 1]\nAlpha rule.\n[Page 2]\nBeta rule.")])
    assert [(c["page"], c["text"].strip()) for c in chunks] == [(1, "Alpha rule."), (2, "Beta rule.")], chunks
    assert rag_engine.label(chunks[1]) == "Policy.pdf, p.2"


def test_risk_levels():
    assert audit_service.compute_risk([], 9) == ("LOW", 0)
    assert audit_service.compute_risk([{"verdict": "UNVERIFIED", "severity": "low"}] * 2, 9)[0] == "MEDIUM"
    assert audit_service.compute_risk([{"verdict": "CONTRADICTED", "severity": "high"}], 9)[0] == "HIGH"


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"\n{len(tests)} tests passed.")
    os._exit(0)
