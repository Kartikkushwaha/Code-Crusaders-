"""Each company (and each demo session) sees only its own AI audits, publications, sign-offs and
company graph; the common graph shows everything. Runs against a real PostgreSQL database.

    TEST_DATABASE_URL=postgresql://user:pass@host/scratchdb python -m tests.test_tenancy

Like test_auth_workflow, it builds the tables in a temporary schema and drops it afterwards.
"""
import os
import re
import subprocess
import sys
import types
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
URL = os.environ.get("TEST_DATABASE_URL", "")
if not URL:
    sys.exit("Set TEST_DATABASE_URL to a scratch PostgreSQL database (never production).")
SCHEMA = "publivra_tenancy_" + uuid.uuid4().hex[:10]

# This file always uses the psql stand-in, so it runs without psycopg2 and without FastAPI.
stub = types.ModuleType("psycopg2")
stub.extras = types.ModuleType("psycopg2.extras")
stub.extras.RealDictCursor = object
stub.OperationalError = type("OperationalError", (Exception,), {})
stub.connect = lambda *a, **k: None
sys.modules["psycopg2"], sys.modules["psycopg2.extras"] = stub, stub.extras
try:
    import fastapi  # noqa: F401
except ImportError:
    fa = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code, detail=None, headers=None):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail

    fa.HTTPException = HTTPException
    sys.modules["fastapi"] = fa

import config  # noqa: E402

config.AUTH_SECRET_KEY = "test-secret-key-that-is-long-enough-0123456789"
config.DATABASE_URL = URL

import analytics  # noqa: E402
import database  # noqa: E402
from auth import db, security, service  # noqa: E402
from auth import tenant as tenancy  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from tests import pg_shim  # noqa: E402
from workflow import services as wf  # noqa: E402

ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d")


def psql(*args):
    subprocess.run(["psql", URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", *args], check=True, capture_output=True, text=True)


def setup():
    scratch = ROOT / "tests" / f".{SCHEMA}.sql"
    scratch.write_text(f'CREATE SCHEMA "{SCHEMA}";\nSET search_path TO "{SCHEMA}";\n' + (ROOT / "migrations" / "001_schema.sql").read_text() + "\n" + database.SCHEMA_SQL)
    try:
        psql("-f", str(scratch))
    finally:
        scratch.unlink()
    session = pg_shim.Session(URL, SCHEMA)

    class Cur(pg_shim.Cursor):
        def __init__(self, as_dicts):
            super().__init__(session)
            self.as_dicts = as_dicts

        def execute(self, sql, params=()):
            super().execute(sql, params)
            conv = lambda v: datetime.fromisoformat(v) if isinstance(v, str) and ISO.match(v) else v  # noqa: E731
            self._rows = [{k: conv(v) for k, v in r.items()} for r in self._rows]
            if not self.as_dicts:
                self._rows = [tuple(r.values()) for r in self._rows]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class Conn:
        def cursor(self, cursor_factory=None):
            return Cur(cursor_factory is not None)

        def commit(self):
            pass

        def rollback(self):
            pass

        def close(self):
            pass

    database._connect = lambda: Conn()
    db.transaction = service.transaction = wf.transaction = pg_shim.make_transaction(session)
    try:
        import argon2  # noqa: F401
    except ImportError:  # build machine only
        security.hash_password = lambda p: "plain$" + p
        security.verify_password = lambda h, p: h == "plain$" + p
    return session


def accounts(domain):
    return {r: {"login_id": f"{r.split('_')[0]}@{domain}", "password": "SecurePassword123", "full_name": ""} for r in ("creator", "manager", "legal_approver")}


def save(owner, title, privacy_hit=False):
    findings = [{"verdict": "CONTRADICTED", "severity": "high", "category": "Privacy", "claim_text": "PAN shown"}] if privacy_hit else []
    cols = analytics.columns(analytics.breakdown(findings, 8))
    audit_id, _ = database.save_audit(filename=title, text="t", is_compliant=not privacy_hit, status_label="x", violations="", source="editor",
                                      risk_level="LOW", tone="Professional", summary="", model="m", report={"findings": findings, "tone_score": 8},
                                      risk_score=10, company=owner, tone_score=8, sections=cols)
    return audit_id


def raises_http(status, fn, *a):
    try:
        fn(*a)
    except HTTPException as exc:
        assert exc.status_code == status, (exc.status_code, exc.detail)
        return
    raise AssertionError("expected HTTP %s" % status)


def run():
    A = service.register_company("Alpha Ltd", "alpha.io", "", accounts("alpha.io"))
    B = service.register_company("Beta Ltd", "beta.io", "", accounts("beta.io"))
    tok = lambda login, role: "Bearer " + service.login(login, "SecurePassword123", role, "t")["token"]  # noqa: E731
    a_creator, a_manager, b_creator = tok("creator@alpha.io", "creator"), tok("manager@alpha.io", "manager"), tok("creator@beta.io", "creator")
    tA, tB = f"co:{A['company_id']}", f"co:{B['company_id']}"
    demo1, demo2 = "demo:" + uuid.uuid4().hex, "demo:" + uuid.uuid4().hex

    # 1. who is the caller: from the token, never from the request
    assert tenancy.resolve(a_creator, "") == tA and tenancy.resolve(a_manager, "Beta Ltd") == tA
    assert tenancy.resolve(a_creator, tB) == tA, "a token always wins over a claimed tenant"
    assert tenancy.resolve("", tA) == "" and tenancy.resolve("", "Alpha Ltd") == "", "a company tag cannot be claimed without its token"
    assert tenancy.resolve("", demo1) == demo1 and tenancy.resolve("", "demo:short") == ""
    raises_http(401, tenancy.resolve, "Bearer not.a.token", "")
    print("PASS  1. The tenant comes from the token (company) or a demo session id; it cannot be claimed")

    # 2. audits are listed per tenant only
    a1, a2 = save(tA, "alpha-1"), save(tA, "alpha-2", privacy_hit=True)
    b1 = save(tB, "beta-1")
    d1, d2 = save(demo1, "demo-one"), save(demo2, "demo-two", privacy_hit=True)
    names = lambda owner: sorted(r["filename"] for r in database.list_audits(50, owner))  # noqa: E731
    assert names(tA) == ["alpha-1", "alpha-2"] and names(tB) == ["beta-1"]
    assert names(demo1) == ["demo-one"] and names(demo2) == ["demo-two"]
    assert database.list_audits(50, "") == [] and database.list_audits(50, None) == [], "no tenant -> nothing"
    print("PASS  2. AI audit history: each company and each demo session sees only its own audits")

    # 3. publications and sign-off per tenant
    pa, _ = database.create_publication(audit_id=a2, title="Alpha ad", file_name="a.pdf", risk_level="HIGH", risk_score=60, overridden=False, counts={}, company=tA, tone_score=8, sections=analytics.columns(analytics.breakdown([], 8)))
    pd, _ = database.create_publication(audit_id=d1, title="Demo ad", file_name="d.pdf", risk_level="LOW", risk_score=5, overridden=False, counts={}, company=demo1, tone_score=8, sections=analytics.columns(analytics.breakdown([], 8)))
    assert [p["title"] for p in database.list_publications(50, tA)] == ["Alpha ad"] and database.list_publications(50, tB) == []
    assert [p["title"] for p in database.list_publications(50, demo1)] == ["Demo ad"] and database.list_publications(50, demo2) == []
    assert database.verify_publication(pa, approver_name="Eve", approver_role="x", checklist=[], company=tB) is None, "Beta cannot sign off Alpha's publication"
    assert database.verify_publication(pa, approver_name="Eve", approver_role="x", checklist=[], company="") is None
    assert database.verify_publication(pa, approver_name="Asha", approver_role="Creator", checklist=["ok"], company=tA)["status"] == "closed"
    assert database.verify_publication(pa, approver_name="Asha", approver_role="Creator", checklist=["ok"], company=tA) is None, "only once"
    assert database.list_publications(50, tA)[0]["approver_name"] == "Asha"
    print("PASS  3. Publications and sign-offs: listed and closed only by their own company / demo session")

    # 4. graphs: the company graph is the caller's own; the common graph has everything
    assert len(database.analytics_rows("before", tA)) == 2 and len(database.analytics_rows("before", tB)) == 1
    assert len(database.analytics_rows("before", demo2)) == 1 and len(database.analytics_rows("after", demo1)) == 1
    assert len(database.analytics_rows("before", None)) == 5 and len(database.analytics_rows("after", None)) == 2
    print("PASS  4. Insights: company graph = own data only; common graph = every company and demo session")
    return a1, b1, d2


if __name__ == "__main__":
    session = setup()
    try:
        session.run("BEGIN;")
        run()
        session.run("ROLLBACK;")
    finally:
        session.close()
        psql("-c", f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
    print("\n4 tenancy checks passed")
