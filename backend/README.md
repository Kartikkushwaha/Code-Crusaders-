# PUBLIVRA AI - Backend (FastAPI)

This backend runs the claim audit. It retrieves passages from your approved sources with Qdrant and LangChain, sends the document and those passages to an LLM (Groq first, Gemini as fallback) for a structured audit, and logs every audit, publication and sign-off to Neon (PostgreSQL in the cloud).

## Run locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000                   # http://localhost:8000/docs
python -m tests.test_core                               # offline tests (no key / DB needed)
```

`.env` in this folder holds the Gemini key and Neon credentials. **Add your free Groq key** (https://console.groq.com/keys) as `GROQ_API_KEY`. The tables are created or upgraded automatically on startup. If your existing `document_compliance` table is there, new columns are added to it and your old rows are kept.

## Deploy on Render (free tier, 512 MB)

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Runtime | Python 3 (`.python-version` pins 3.11.11) |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1` |
| Health check path | `/api/health` |
| Environment | the keys from `.env` (`GROQ_API_KEY`, `GOOGLE_API_KEY`, `DB_*`, `LLM_PROVIDERS`, `GROQ_MODELS`, `ALLOWED_ORIGINS`, …) |

Alternatively, use `render.yaml` in the repo root (Blueprint deploy).

**Why it fits in 512 MB:** the old setup ran a local embedding model (`fastembed`/ONNX), and that is gone. Embeddings now come from the Gemini API, Qdrant runs inside the same process, `langchain-community` was removed, and there is a single worker. Expect roughly 180–260 MB in use.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Status, models in use, Neon connection state |
| POST | `/api/audit` | **Main endpoint.** JSON `{text, title, source, policy_rules, policy_document:{name,text}, tone_profile}` → findings with VERIFIED / UNVERIFIED / CONTRADICTED, severity, source, rewrite, risk, `audit_id` |
| POST | `/api/audit-document` | Original multipart PDF endpoint (`document_file` or `file`, optional `policy_file`). Same response shape as before |
| POST | `/api/brand-audit` | Original brand-tone endpoint (multipart PDF) |
| POST | `/api/publications` | Log a publish or override |
| POST | `/api/publications/{id}/verify` | Record the human sign-off |
| GET | `/api/publications`, `/api/audits` | History from Neon |
| POST | `/api/events` | Audit-trail events (overrides, etc.) |

## How an audit works

1. **Approved sources:** `brand_guidelines.txt`, the rules from the dashboard's Policy Library, and any policy document you upload (page numbers are kept).
2. **Retrieval:** sources are split into chunks, embedded with `gemini-embedding-001`, and indexed in in-memory Qdrant. The index is cached, so the default guidelines are embedded only once per server start. Excerpts from the document are used as queries to pull the most relevant chunks. If embedding fails, the audit falls back to the full approved text, so it still runs.
3. **LLM:** the model sees only the retrieved approved chunks. Unverified is the default verdict, and Verified requires a cited source.
   - **Model order:** the `GROQ_MODELS` that Groq still serves (checked live through its `/models` endpoint), then `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS`. Any failure moves on to the next model.
   - **Reading the reply:** models are asked for plain JSON (JSON mode). The reply is parsed leniently: code fences and `<think>` blocks are stripped, a truncated reply is repaired, and near-miss values are normalised.
   - **Length limit:** Groq's free tier allows only a few thousand tokens per minute, so the first `LLM_MAX_DOC_CHARS` (9,000) characters are audited. The dashboard says so when it trims a document.
4. **Normalisation:** each claim is located in the document so the dashboard can highlight it and apply the fix. Rewrites are dropped for Verified claims and for spans that can't be found. Risk is then computed and the result is logged to Neon.

## Changes from the Round 2 draft

- `brand_guidlines.txt` was never loaded, because `main.py` looked for `brand_guidelines.txt`. The file is now renamed, and both names are accepted.
- Gemini "high demand" errors no longer break audits. Groq is now the main provider, with automatic fallback across five models. Before, `main.py` and `brand_engine.py` also used different Gemini models.
- Local PostgreSQL is replaced by Neon (`database.py`, which was empty). If the database is unreachable, the API still returns its result and reports `db_logged: false`.
- `.dict()` is replaced by Pydantic v2 `model_dump()`. The duplicate `/api/audit-document` route is removed.
- The `.pyc` cache files are not included because they are build output.
- `compliance_checker.py` moved to `tools/` and uses the shared engine.
