"""Neon (serverless PostgreSQL) persistence for audits, publications and events.

Neon replaces the local PostgreSQL server, so the database stays available when
your PC is off. Every function fails soft: if the DB is unreachable the API
still returns its AI result and reports `db_logged: false`.
"""
import json
import logging
from contextlib import contextmanager

import psycopg2
import psycopg2.extras

import analytics
import config

log = logging.getLogger("publivra.db")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS document_compliance (
    id SERIAL PRIMARY KEY,
    filename TEXT,
    extracted_text TEXT,
    is_compliant BOOLEAN,
    status TEXT,
    violations TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE document_compliance ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE document_compliance ADD COLUMN IF NOT EXISTS risk_level TEXT;
ALTER TABLE document_compliance ADD COLUMN IF NOT EXISTS tone TEXT;
ALTER TABLE document_compliance ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE document_compliance ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE document_compliance ADD COLUMN IF NOT EXISTS report JSONB;

CREATE TABLE IF NOT EXISTS publications (
    id SERIAL PRIMARY KEY,
    audit_id INTEGER,
    title TEXT NOT NULL,
    file_name TEXT,
    risk_level TEXT,
    risk_score INTEGER,
    overridden BOOLEAN DEFAULT FALSE,
    counts JSONB,
    status TEXT DEFAULT 'pending',
    approver_name TEXT,
    approver_role TEXT,
    checklist JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    audit_id INTEGER,
    publication_id INTEGER,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_publications_created ON publications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_created ON document_compliance (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON audit_events (created_at DESC);
"""


def _section_columns_sql(table: str) -> str:
    """Improvement 2: one score/level/count/issues column per chart section (Tone, Logo, Data & Privacy, Others)."""
    out = [
        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS risk_score INTEGER;",
        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS company TEXT;",
        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS tone_profile_score INTEGER;",
    ]
    for k in analytics.SECTION_KEYS:
        out += [
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {k}_score INTEGER;",
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {k}_level TEXT;",
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {k}_count INTEGER;",
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {k}_issues JSONB;",
        ]
    return "\n".join(out)


SCHEMA_SQL += _section_columns_sql("document_compliance") + "\n" + _section_columns_sql("publications")

SECTION_COLS = [f"{k}_{c}" for k in analytics.SECTION_KEYS for c in ("score", "level", "count", "issues")]


def _section_values(cols: dict):
    vals = []
    for name in SECTION_COLS:
        v = (cols or {}).get(name)
        vals.append(json.dumps(v or []) if name.endswith("_issues") else v)
    return vals


INSERT_AUDIT_SQL = """
INSERT INTO document_compliance
    (filename, extracted_text, is_compliant, status, violations, source, risk_level, tone, summary, model, report,
     risk_score, company, tone_profile_score, """ + ", ".join(SECTION_COLS) + """)
VALUES (""" + ", ".join(["%s"] * (14 + len(SECTION_COLS))) + """)
RETURNING id, created_at;
"""

INSERT_PUBLICATION_SQL = """
INSERT INTO publications (audit_id, title, file_name, risk_level, risk_score, overridden, counts,
    company, tone_profile_score, """ + ", ".join(SECTION_COLS) + """)
VALUES (""" + ", ".join(["%s"] * (9 + len(SECTION_COLS))) + """)
RETURNING id, created_at;
"""

GET_AUDIT_REPORT_SQL = "SELECT report, company FROM document_compliance WHERE id = %s;"

VERIFY_PUBLICATION_SQL = """
UPDATE publications
SET status = 'closed', approver_name = %s, approver_role = %s, checklist = %s, closed_at = NOW()
WHERE id = %s AND company = %s AND status <> 'closed'
RETURNING id, status, closed_at;
"""

LIST_PUBLICATIONS_SQL = """
SELECT id, audit_id, title, file_name, risk_level, risk_score, overridden, counts, status,
       approver_name, approver_role, created_at, closed_at
FROM publications WHERE company = %s ORDER BY created_at DESC LIMIT %s;
"""

LIST_AUDITS_SQL = """
SELECT id, filename, status, risk_level, tone, summary, model, source, created_at
FROM document_compliance WHERE company = %s ORDER BY created_at DESC LIMIT %s;
"""

INSERT_EVENT_SQL = """
INSERT INTO audit_events (audit_id, publication_id, actor, action, detail)
VALUES (%s, %s, %s, %s, %s)
RETURNING id, created_at;
"""

_status = {"state": "unknown", "error": None}


def is_configured() -> bool:
    return bool(config.DATABASE_URL or (config.DB_HOST and config.DB_PASSWORD))


def _connect():
    if config.DATABASE_URL:
        return psycopg2.connect(config.DATABASE_URL, connect_timeout=8)
    return psycopg2.connect(
        host=config.DB_HOST,
        dbname=config.DB_NAME,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        port=config.DB_PORT,
        sslmode=config.DB_SSLMODE,
        connect_timeout=8,
    )


@contextmanager
def connection():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def status() -> dict:
    if not is_configured():
        return {"state": "not_configured", "error": None}
    return dict(_status)


def init_db() -> bool:
    """Create/upgrade tables. Safe to run on every boot (idempotent)."""
    if not is_configured():
        _status.update(state="not_configured", error=None)
        log.warning("Database not configured - running without persistence.")
        return False
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
        _status.update(state="connected", error=None)
        try:
            n = backfill_sections()
            if n:
                log.info("Backfilled chart sections for %s rows.", n)
        except Exception as exc:  # pragma: no cover - never block boot
            log.warning("Section backfill skipped: %s", exc)
        log.info("Neon database ready.")
        return True
    except Exception as exc:  # pragma: no cover - network dependent
        _status.update(state="unavailable", error=str(exc)[:300])
        log.warning("Neon database unavailable: %s", exc)
        return False


def _jsonable(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        out[k] = v.isoformat() if hasattr(v, "isoformat") else v
    return out


def save_audit(*, filename, text, is_compliant, status_label, violations, source, risk_level, tone, summary, model, report,
               risk_score=None, company=None, tone_score=None, sections=None):
    """Returns (audit_id, created_at_iso) or (None, None) if the DB is unavailable."""
    if not is_configured():
        return None, None
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                INSERT_AUDIT_SQL,
                (
                    filename[:300],
                    text[:20000],
                    is_compliant,
                    status_label,
                    violations[:8000],
                    source,
                    risk_level,
                    tone,
                    summary[:4000],
                    model,
                    json.dumps(report)[:200000],
                    risk_score,
                    (company or None) and company[:120],
                    tone_score,
                    *_section_values(sections),
                ),
            )
            row = cur.fetchone()
        _status.update(state="connected", error=None)
        return row[0], row[1].isoformat()
    except Exception as exc:  # pragma: no cover - network dependent
        _status.update(state="unavailable", error=str(exc)[:300])
        log.warning("Audit not logged: %s", exc)
        return None, None


def create_publication(*, audit_id, title, file_name, risk_level, risk_score, overridden, counts, company=None, tone_score=None, sections=None):
    if not is_configured():
        return None, None
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                INSERT_PUBLICATION_SQL,
                (audit_id, title[:300], file_name[:300], risk_level, risk_score, overridden, json.dumps(counts or {}),
                 (company or None) and company[:120], tone_score, *_section_values(sections)),
            )
            row = cur.fetchone()
        return row[0], row[1].isoformat()
    except Exception as exc:  # pragma: no cover
        log.warning("Publication not logged: %s", exc)
        return None, None


def verify_publication(pub_id, *, approver_name, approver_role, checklist, company):
    """Close a publication of `company` (the caller's tenant). None if it is not theirs or already closed."""
    if not is_configured() or not company:
        return None
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(VERIFY_PUBLICATION_SQL, (approver_name[:200], approver_role[:100], json.dumps(checklist or []), pub_id, company))
            row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "status": row[1], "closed_at": row[2].isoformat()}
    except Exception as exc:  # pragma: no cover
        log.warning("Verification not logged: %s", exc)
        return None


def list_publications(limit=20, company=None):
    """Publications of one tenant only (a company, or one demo session). Nothing without a tenant."""
    if not is_configured() or not company:
        return []
    try:
        with connection() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(LIST_PUBLICATIONS_SQL, (company, limit))
            return [_jsonable(dict(r)) for r in cur.fetchall()]
    except Exception as exc:  # pragma: no cover
        log.warning("Could not list publications: %s", exc)
        return []


def list_audits(limit=20, company=None):
    """AI audits of one tenant only (a company, or one demo session). Nothing without a tenant."""
    if not is_configured() or not company:
        return []
    try:
        with connection() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(LIST_AUDITS_SQL, (company, limit))
            return [_jsonable(dict(r)) for r in cur.fetchall()]
    except Exception as exc:  # pragma: no cover
        log.warning("Could not list audits: %s", exc)
        return []


def log_event(*, actor, action, detail=None, audit_id=None, publication_id=None):
    if not is_configured():
        return None
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(INSERT_EVENT_SQL, (audit_id, publication_id, actor[:20], action[:120], (detail or "")[:2000]))
            return cur.fetchone()[0]
    except Exception as exc:  # pragma: no cover
        log.warning("Event not logged: %s", exc)
        return None


def get_audit_report(audit_id):
    """The stored AI report of an audit (used when a publication arrives without its final findings)."""
    if not is_configured() or not audit_id:
        return None, None
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(GET_AUDIT_REPORT_SQL, (audit_id,))
            row = cur.fetchone()
        return (row[0], row[1]) if row else (None, None)
    except Exception as exc:  # pragma: no cover
        log.warning("Could not read audit %s: %s", audit_id, exc)
        return None, None


def analytics_rows(stage="before", company=None, days=None, limit=1000):
    """Section columns for the bar chart. stage 'before' = document_compliance, 'after' = publications."""
    if not is_configured():
        return []
    table = "publications" if stage == "after" else "document_compliance"
    where, args = [f"{analytics.SECTION_KEYS[0]}_level IS NOT NULL"], []
    if company:
        where.append("company = %s")
        args.append(company)
    if days:
        where.append("created_at >= NOW() - make_interval(days => %s)")
        args.append(int(days))
    sql = f"SELECT {', '.join(SECTION_COLS)}, created_at FROM {table} WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT %s;"
    try:
        with connection() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, (*args, limit))
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:  # pragma: no cover
        log.warning("Could not read analytics rows: %s", exc)
        return []


def backfill_sections(limit=2000):
    """Fill the section columns for rows saved before Improvement 2, from their stored report."""
    sets = ", ".join(f"{c} = %s" for c in SECTION_COLS)
    done = 0
    with connection() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT id, report FROM document_compliance WHERE {analytics.SECTION_KEYS[0]}_level IS NULL AND report IS NOT NULL LIMIT %s;", (limit,))
        for audit_id, report in cur.fetchall():
            report = report or {}
            cols = analytics.columns(analytics.breakdown(report.get("findings"), report.get("tone_score")))
            cur.execute(f"UPDATE document_compliance SET {sets}, risk_score = COALESCE(risk_score, %s), tone_profile_score = COALESCE(tone_profile_score, %s) WHERE id = %s;",
                        (*_section_values(cols), report.get("risk_score"), report.get("tone_score"), audit_id))
            done += 1
        # publications copy the breakdown of their audit (the best record we have for old rows)
        src_cols = ", ".join(f"{c} = d.{c}" for c in SECTION_COLS)
        cur.execute(f"""UPDATE publications p SET {src_cols}, tone_profile_score = COALESCE(p.tone_profile_score, d.tone_profile_score)
                        FROM document_compliance d
                        WHERE p.audit_id = d.id AND p.{analytics.SECTION_KEYS[0]}_level IS NULL AND d.{analytics.SECTION_KEYS[0]}_level IS NOT NULL;""")
        done += cur.rowcount or 0
    return done
