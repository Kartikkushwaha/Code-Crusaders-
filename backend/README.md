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
| POST | `/api/video-audit` | **Video check.** Multipart `video` (MP4 / MOV / WebM, ≤ 20 s, ≤ 40 MB) + `policy_text`, `policy_name`, `title`, `tone_profile`, `company`, `duration` → `202 {job_id}` |
| GET | `/api/video-audit/{job_id}` | Job progress (`stage`, `progress`, `message`) and, when `status` is `done`, the result |
| POST | `/api/publications` | Log a publish or override |
| POST | `/api/publications/{id}/verify` | Record the human sign-off |
| GET | `/api/publications`, `/api/audits` | History from Neon |
| POST | `/api/events` | Audit-trail events (overrides, etc.) |
| GET | `/api/analytics?stage=before\|after&company=&days=` | Bar-chart data: Tone, Logo, Data & Privacy, Others → average risk score, level, issue count, level mix and top repeated issues (hover) |
| GET | `/api/analytics/compare` | Before and after publication in one call |

**Chart sections (Improvement 2).** Every audit row (`document_compliance`, before publication) and every
publication row (after the creator's fixes) stores, for each of `tone`, `logo`, `privacy`, `other`:
`<section>_score` (0-100), `<section>_level` (HIGH/MEDIUM/LOW), `<section>_count` and `<section>_issues` (JSONB list:
claim, verdict, severity, rule, policy line). Both tables also get `risk_score`, `company` and `tone_profile_score`.
Columns are added automatically on boot and older rows are backfilled from their stored report.
`/api/audit` accepts optional `rule_findings` and `company`; `/api/publications` accepts optional final `findings`,
`tone_score` and `company` (if omitted, the audit's stored findings are used).

## How an audit works

1. **Approved sources:** `brand_guidelines.txt`, the rules from the dashboard's Policy Library, and any policy document you upload (page numbers are kept).
2. **Retrieval:** sources are split into chunks, embedded with `gemini-embedding-001`, and indexed in in-memory Qdrant. The index is cached, so the default guidelines are embedded only once per server start. Excerpts from the document are used as queries to pull the most relevant chunks. If embedding fails, the audit falls back to the full approved text, so it still runs.
3. **LLM:** the model sees only the retrieved approved chunks. Unverified is the default verdict, and Verified requires a cited source.
   - **Model order:** the `GROQ_MODELS` that Groq still serves (checked live through its `/models` endpoint), then `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS`. Any failure moves on to the next model.
   - **Reading the reply:** models are asked for plain JSON (JSON mode). The reply is parsed leniently: code fences and `<think>` blocks are stripped, a truncated reply is repaired, and near-miss values are normalised.
   - **Length limit:** Groq's free tier allows only a few thousand tokens per minute, so the first `LLM_MAX_DOC_CHARS` (9,000) characters are audited. The dashboard says so when it trims a document.
3b. **Policy review and citations (v2.2):**
   - **Line numbers:** every policy line is numbered (`[p.2 L14]`, see `policy_index.py`). Policies up to `POLICY_FULL_CHARS` (9,000) characters are sent to the model **in full**, so it reviews every rule. Longer policies go through Qdrant retrieval, and the numbered labels are kept inside the chunks.
   - **What each finding contains:** the problem, `policy_reference` (the line label), `policy_quote` (the policy's exact words), the solution (`suggested_rewrite`) and a `recommendation`.
   - **Citation check:** the backend matches the quote against the real policy lines and returns `policy_ref = {source, page, line, text, verified}`. It never invents a citation.
   - **Which policy is used:** when the dashboard sends a policy, it is the only knowledge base. `brand_guidelines.txt` is used only when no policy is given.
   - **Capitals:** words in capitals used for emphasis are not flagged unless the policy forbids capitals.
4. **Normalisation:** each claim is located in the document so the dashboard can highlight it and apply the fix. Rewrites are dropped for Verified claims and for spans that can't be found. Risk is then computed and the result is logged to Neon.

## Changes from the Round 2 draft

- `brand_guidlines.txt` was never loaded, because `main.py` looked for `brand_guidelines.txt`. The file is now renamed, and both names are accepted.
- Gemini "high demand" errors no longer break audits. Groq is now the main provider, with automatic fallback across five models. Before, `main.py` and `brand_engine.py` also used different Gemini models.
- Local PostgreSQL is replaced by Neon (`database.py`, which was empty). If the database is unreachable, the API still returns its result and reports `db_logged: false`.
- `.dict()` is replaced by Pydantic v2 `model_dump()`. The duplicate `/api/audit-document` route is removed.
- The `.pyc` cache files are not included because they are build output.
- `compliance_checker.py` moved to `tools/` and uses the shared engine.

## Video audit (v2.4)

A short clip is checked against the same policy as the text and image checks.

1. **Video API** (`main.py`): the upload is streamed to a temp file (1 MB at a time), the container type is read from the file's first bytes, and the length is read from the MP4/MOV header in pure Python (`video_service.probe_duration`). Clips over `VIDEO_MAX_SECONDS` (20) or `VIDEO_MAX_BYTES` (40 MB) are refused before a job is created.
2. **Job**: the endpoint answers at once with a `job_id`; the work runs in a background thread and the dashboard polls for progress. One video is analysed at a time.
3. **Multimodal AI engine**: the clip goes straight to Gemini, which reads the frames, the on-screen text and the audio track itself. Clips up to `VIDEO_INLINE_MAX_BYTES` (8 MB) are sent inline; larger ones are streamed from disk to Gemini's Files API and deleted afterwards. Models are tried in the order of `VIDEO_MODELS` (default `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`), then `GEMINI_MODEL`.
4. **Aggregator** (`video_service.aggregate`): timestamps are clamped to the clip, duplicate events are merged, and every citation is matched against the numbered policy lines (`policy_index.find_ref`). A CONTRADICTED verdict with no matching policy line is downgraded to UNVERIFIED unless it is a universal safety rule (personal data, absolute guarantees).
5. **Result**: summary, tone, transcript, on-screen text, colours, and timeline findings (`start`, `end`, `aspect`, `verdict`, `severity`, `policy_ref`, `recommendation`), plus risk level and score. It is saved to `document_compliance` with `source = "video"`, so it appears in History and in the Insights charts.

**Memory:** there is no FFmpeg, no local model and no new dependency (Gemini is called with the standard library). **`GOOGLE_API_KEY` is required** for this feature; Groq models cannot read video.

```bash
python -m tests.test_video      # offline: a local fake Gemini server covers inline, Files API, fallback and jobs
```

### Backup engine (v2.5) - when Gemini answers "high demand"

Gemini's free tier is often overloaded. The video audit no longer depends on it:

1. Gemini models are tried once each (`VIDEO_MODELS`, now including `gemini-3.5-flash-lite`), 60 s per call, 75 s in total.
2. If none answers, the **Groq backup engine** takes over (needs only `GROQ_API_KEY`):
   - **Speech:** the clip is streamed to Whisper on Groq (`whisper-large-v3-turbo`), which returns the transcript with timestamps.
   - **Frames:** the dashboard sends 12 still frames of the clip as 3 small JPEG contact sheets (made in the browser, so the server still needs no FFmpeg). A Groq vision model (`GROQ_VISION_MODELS`) checks them with the transcript against the policy.
   - The result has the same shape; `engine` is `"groq"` and `engine_notes` says what was not covered.
3. If the backup also fails, Gemini gets one more pass before the job ends with an error.

**Limits of the backup:** it sees 12 frames, not the whole video, and it cannot hear music or sound effects - only speech. Long policies are cut to `VIDEO_BACKUP_POLICY_CHARS` (12,000) to fit Groq's free-tier token budget.

`VIDEO_ENGINE=groq` skips Gemini completely (fastest when Gemini is down all day); `VIDEO_ENGINE=gemini` turns the backup off.

### Reference logo and brand kit in the video audit

`POST /api/video-audit` also accepts:

| Field | What it is |
| --- | --- |
| `reference_logo` | Optional PNG / JPEG / WebP of the approved logo (max 1 MB). Gemini receives it right after the video; the Groq backup receives it as its third image (2 contact sheets + the logo). |
| `brand_kit` | Optional JSON: `{"brandName": "...", "motto": "...", "colors": [{"hex": "#1E3A8A"}]}` |

The model is told to compare every logo in the video with the reference logo and to cite brand-kit findings as `BRAND KIT`.
The aggregator accepts that citation only when a brand kit was really sent (`source_reference` becomes `Brand kit` or
`Brand kit · Reference logo`); otherwise an uncited CONTRADICTED finding is still downgraded to UNVERIFIED. The result has `logo_checked`.

## Sign-in and approval workflow (v3.0)

Multi-company sign-in with exactly three roles per company (Creator, Manager, Legal Approver) and a
database-backed approval workflow. It serves the dashboard's **Start as company** channel; **Take a demo**
needs no backend sign-in (its workflow stays in the browser). It uses the six `auth_*` tables that already exist in Neon
(`migrations/001_workflow.sql` is a reference copy: **do not run it again**).

```
auth/        db.py (reuses database.connection - no second engine), security.py (Argon2id, JWT, rate limits),
             schemas.py, service.py, routes.py
workflow/    services.py (rules + SQL), routes.py
migrations/  001_workflow.sql (reference, already applied) · 002_content_audit.sql (optional, see below)
scripts/     smoke_auth.py (HTTP test of the 20 checks against a running server)
```

The existing code talks to Neon with psycopg2, not SQLAlchemy, so these modules do the same: every service
function runs in one transaction on the existing connection helper, with parameterised SQL.

| Method | Path | Who | What |
| --- | --- | --- | --- |
| POST | `/api/auth/company/register` | anyone | Creates the company **and** the logins of its Creator, Manager and Legal Approver (login ID + password chosen by the registrant), in one transaction |
| POST | `/api/auth/login` | member | Login ID + password + role → signed JWT (user, company, role, expiry) |
| GET | `/api/auth/me` | signed in | Current user, company and role |
| POST | `/api/workflow/content` | creator | Create a draft |
| PUT | `/api/workflow/content/{id}` | creator (owner) | Edit a draft / returned item; editing approved content sends it back to draft |
| GET | `/api/workflow/content` | signed in | Own company only: creator = own items, manager = submitted items, legal = items sent to legal |
| GET | `/api/workflow/content/{id}` | signed in | One item with its approval records and comments |
| POST | `/api/workflow/content/{id}/submit` | creator (owner) | draft / rejected / changes_requested → pending_manager |
| POST | `/api/workflow/content/{id}/manager-review` | manager | `approved`, `sent_to_legal`, `rejected`, `changes_requested` |
| POST | `/api/workflow/content/{id}/legal-review` | legal approver | `approved`, `rejected`, `changes_requested` (only while pending_legal) |
| POST | `/api/workflow/content/{id}/publish` | creator (owner) | approved → published |

**Security**
- Passwords: Argon2id (19 MiB, t=2); 8+ characters with a letter and a number. Never returned or logged.
- Registration is all or nothing: a taken login ID or domain creates nothing. A domain (and each login ID) can be registered once.
- Tokens: HS256 JWT signed with `AUTH_SECRET_KEY`. No default key: without it the auth endpoints answer 503.
- Every protected request re-checks the membership (user + company + role) in the database. The company and role are never taken from the request.
- Every workflow statement is scoped to the member's `company_id`; other companies' content answers 404.
- A status change is one conditional `UPDATE ... WHERE status = <expected>`, written together with its approval record, so two reviewers cannot both decide the same item.
- Login is rate limited (8 attempts per 5 minutes per login ID + IP); company registration 6 per hour per IP.
- Login IDs look like e-mail addresses (suggested as `role@companydomain`) but are not verified as real mailboxes.

**Optional migration `002_content_audit.sql`** adds one nullable `audit JSONB` column to `auth_content`. It stores what the
creator sends with a submission (risk scores, findings, fixes, image / video audit, note), which the reviewers' panels show.
Without it everything still works, but reviewers see the title and text only. Run it once by hand in the Neon SQL editor;
the app never runs migrations itself.

**Environment variables (Render):** `AUTH_SECRET_KEY` (required, 32+ characters), `AUTH_TOKEN_HOURS` (12).
`DATABASE_URL` is reused.

```bash
# service-level tests on a scratch PostgreSQL database (creates and drops a temporary schema)
TEST_DATABASE_URL=postgresql://user:pass@host/scratchdb python -m tests.test_auth_workflow
# HTTP test against a running server (registers two throw-away companies on random domains)
python scripts/smoke_auth.py http://localhost:8000 --skip-audit
```

The older endpoints (`/api/audit`, `/api/video-audit`, `/api/analytics`, `/api/publications`, ...) are unchanged and still open.

Request body of `POST /api/auth/company/register`:

```json
{
  "company_name": "ABC Technologies",
  "company_domain": "abctechnologies.com",
  "company_email": "",
  "accounts": {
    "creator":        {"login_id": "creator@abctechnologies.com", "password": "...", "full_name": "Asha"},
    "manager":        {"login_id": "manager@abctechnologies.com", "password": "...", "full_name": ""},
    "legal_approver": {"login_id": "legal@abctechnologies.com",   "password": "...", "full_name": ""}
  }
}
```
`company_email` defaults to `contact@<domain>`; an empty `full_name` becomes "<Company> <Role>". The `auth_invitations` table is
not used by this flow (it stays in place, untouched).
