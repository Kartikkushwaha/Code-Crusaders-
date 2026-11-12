"""Central configuration for the PUBLIVRA AI backend.

Values come from environment variables (Render dashboard in production,
backend/.env locally). Nothing heavy is imported here.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent

# backend/.env first, then a repo-root .env (keeps the old layout working).
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")


def _csv(name: str, default: str) -> list:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


# ---- LLM providers -------------------------------------------------------------
# Tried in this order; every model of a provider is tried before moving to the next
# provider. Any failure (overload, rate limit, timeout, bad output) moves on.
LLM_PROVIDERS = _csv("LLM_PROVIDERS", "groq,gemini")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODELS = _csv("GROQ_MODELS", "openai/gpt-oss-120b,qwen/qwen3.6-27b,openai/gpt-oss-20b")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "").strip()
# gemini-2.5-flash is restricted to legacy projects; 3.5 Flash is the supported default.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip()
GEMINI_FALLBACK_MODELS = _csv("GEMINI_FALLBACK_MODELS", "gemini-flash-latest")

LLM_TIMEOUT_SECONDS = int(os.getenv("LLM_TIMEOUT_SECONDS", "60"))
LLM_MAX_OUTPUT_TOKENS = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "3000"))
# Groq's free tier allows ~8-12K tokens/minute per model, so the text sent to the LLM is capped.
LLM_MAX_DOC_CHARS = int(os.getenv("LLM_MAX_DOC_CHARS", "9000"))
# Policies up to this size are sent to the model in FULL (every numbered line), so it reviews
# the whole policy. Larger ones go through Qdrant retrieval.
POLICY_FULL_CHARS = int(os.getenv("POLICY_FULL_CHARS", "9000"))
# Total characters (policy context + document) per request; keeps Groq free-tier requests
# (input + output tokens) under its per-minute limit. The document is trimmed first.
LLM_INPUT_BUDGET_CHARS = int(os.getenv("LLM_INPUT_BUDGET_CHARS", "16000"))

# ---- Embeddings (retrieval). Optional: if they fail, the full approved text is used. ----
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "models/gemini-embedding-001").strip()
EMBED_TIMEOUT_SECONDS = int(os.getenv("EMBED_TIMEOUT_SECONDS", "20"))


# ---- Video audit (Gemini video + audio understanding) ---------------------------
# The clip is sent straight to Gemini, which reads frames, on-screen text and audio itself,
# so the server needs no FFmpeg and no local model (fits Render's 512 MB tier).
GEMINI_API_BASE = os.getenv("GEMINI_API_BASE", "https://generativelanguage.googleapis.com").strip().rstrip("/")
VIDEO_MODELS = _csv("VIDEO_MODELS", "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash")
VIDEO_MAX_SECONDS = float(os.getenv("VIDEO_MAX_SECONDS", "20"))
VIDEO_MIN_SECONDS = float(os.getenv("VIDEO_MIN_SECONDS", "1"))
VIDEO_MAX_BYTES = int(os.getenv("VIDEO_MAX_BYTES", str(40 * 1024 * 1024)))
# Up to this size the clip goes inline in the request; larger clips are streamed from disk
# to Gemini's Files API, so they are never held in memory.
VIDEO_INLINE_MAX_BYTES = int(os.getenv("VIDEO_INLINE_MAX_BYTES", str(8 * 1024 * 1024)))
VIDEO_TIMEOUT_SECONDS = int(os.getenv("VIDEO_TIMEOUT_SECONDS", "120"))
VIDEO_MAX_OUTPUT_TOKENS = int(os.getenv("VIDEO_MAX_OUTPUT_TOKENS", "8192"))
VIDEO_POLICY_CHARS = int(os.getenv("VIDEO_POLICY_CHARS", "60000"))


def video_models() -> list:
    """Gemini models tried in order for a video audit (needs GOOGLE_API_KEY)."""
    if not GOOGLE_API_KEY:
        return []
    return list(dict.fromkeys(VIDEO_MODELS + [GEMINI_MODEL] + GEMINI_FALLBACK_MODELS))


def llm_chain() -> list:
    """Ordered (provider, model) pairs that have an API key configured."""
    chain = []
    for provider in LLM_PROVIDERS:
        p = provider.lower()
        if p == "groq" and GROQ_API_KEY:
            chain += [("groq", m) for m in GROQ_MODELS]
        elif p == "gemini" and GOOGLE_API_KEY:
            chain += [("gemini", m) for m in dict.fromkeys([GEMINI_MODEL] + GEMINI_FALLBACK_MODELS)]
    return chain

ALLOWED_ORIGINS = _csv("ALLOWED_ORIGINS", "*")

# Neon PostgreSQL. DATABASE_URL wins if present, else the DB_* parts.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_HOST = os.getenv("DB_HOST", "").strip()
DB_NAME = os.getenv("DB_NAME", "neondb").strip()
DB_USER = os.getenv("DB_USER", "neondb_owner").strip()
DB_PASSWORD = os.getenv("DB_PASSWORD", "").strip()
DB_PORT = os.getenv("DB_PORT", "5432").strip()
DB_SSLMODE = os.getenv("DB_SSLMODE", "require").strip()

# Input limits keep memory and token use predictable on a 512 MB instance.
MAX_DOCUMENT_CHARS = int(os.getenv("MAX_DOCUMENT_CHARS", "60000"))
MAX_POLICY_CHARS = int(os.getenv("MAX_POLICY_CHARS", "120000"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))
RAG_MAX_CONTEXT_CHUNKS = int(os.getenv("RAG_MAX_CONTEXT_CHUNKS", "6"))


def guidelines_text() -> str:
    """Brand guidelines shipped with the backend (falls back to the old misspelt file)."""
    for name in ("brand_guidelines.txt", "brand_guidlines.txt"):
        p = BASE_DIR / name
        if p.exists():
            return p.read_text(encoding="utf-8")
    return DEFAULT_BRAND_GUIDELINES


DEFAULT_BRAND_GUIDELINES = """[BRAND TONE & IDENTITY RULES]
1. Tonality: objective, professional and fact-driven. Avoid hyperbole ('revolutionary', 'best-in-the-world', '100% bug-free').
2. Terminology: use 'AI-powered compliance engine' instead of 'magic AI solution'; 'Enterprise client' instead of 'Customer'.
3. Claims: every metric or performance statement needs verifiable proof. Absolute zero-risk or perfection claims are prohibited.
"""
