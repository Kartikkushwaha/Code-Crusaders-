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
CREATE INDEX IF NOT EXISTS idx_events_created ON audit_events (created_at DESC);
"""

INSERT_AUDIT_SQL = """
INSERT INTO document_compliance
    (filename, extracted_text, is_compliant, status, violations, source, risk_level, tone, summary, model, report)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
RETURNING id, created_at;
"""

INSERT_PUBLICATION_SQL = """
INSERT INTO publications (audit_id, title, file_name, risk_level, risk_score, overridden, counts)
VALUES (%s, %s, %s, %s, %s, %s, %s)
RETURNING id, created_at;
"""

VERIFY_PUBLICATION_SQL = """
UPDATE publications
SET status = 'closed', approver_name = %s, approver_role = %s, checklist = %s, closed_at = NOW()
WHERE id = %s
RETURNING id, status, closed_at;
"""

LIST_PUBLICATIONS_SQL = """
SELECT id, audit_id, title, file_name, risk_level, risk_score, overridden, counts, status,
       approver_name, approver_role, created_at, closed_at
FROM publications ORDER BY created_at DESC LIMIT %s;
"""

LIST_AUDITS_SQL = """
SELECT id, filename, status, risk_level, tone, summary, model, source, created_at
FROM document_compliance ORDER BY created_at DESC LIMIT %s;
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


def save_audit(*, filename, text, is_compliant, status_label, violations, source, risk_level, tone, summary, model, report):
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
                ),
            )
            row = cur.fetchone()
        _status.update(state="connected", error=None)
        return row[0], row[1].isoformat()
    except Exception as exc:  # pragma: no cover - network dependent
        _status.update(state="unavailable", error=str(exc)[:300])
        log.warning("Audit not logged: %s", exc)
        return None, None


def create_publication(*, audit_id, title, file_name, risk_level, risk_score, overridden, counts):
    if not is_configured():
        return None, None
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                INSERT_PUBLICATION_SQL,
                (audit_id, title[:300], file_name[:300], risk_level, risk_score, overridden, json.dumps(counts or {})),
            )
            row = cur.fetchone()
        return row[0], row[1].isoformat()
    except Exception as exc:  # pragma: no cover
        log.warning("Publication not logged: %s", exc)
        return None, None


def verify_publication(pub_id, *, approver_name, approver_role, checklist):
    if not is_configured():
        return None
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute(VERIFY_PUBLICATION_SQL, (approver_name[:200], approver_role[:100], json.dumps(checklist or []), pub_id))
            row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "status": row[1], "closed_at": row[2].isoformat()}
    except Exception as exc:  # pragma: no cover
        log.warning("Verification not logged: %s", exc)
        return None


def list_publications(limit=20):
    if not is_configured():
        return []
    try:
        with connection() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(LIST_PUBLICATIONS_SQL, (limit,))
            return [_jsonable(dict(r)) for r in cur.fetchall()]
    except Exception as exc:  # pragma: no cover
        log.warning("Could not list publications: %s", exc)
        return []


def list_audits(limit=20):
    if not is_configured():
        return []
    try:
        with connection() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(LIST_AUDITS_SQL, (limit,))
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
