"""Tests for sign-in and the approval workflow, run against a real PostgreSQL database.

    TEST_DATABASE_URL=postgresql://user:pass@host/db  python -m tests.test_auth_workflow

Use a scratch database (or a Neon branch) - NOT production. The tests create a temporary schema,
build the auth_* tables in it from migrations/001_schema.sql, run, and drop the schema again;
tables in `public` are never touched.

With psycopg2 installed the app's real database code is used. Without it (as on the build machine)
a psql-based stand-in (tests/pg_shim.py) runs the same SQL on the same server.
"""
import hashlib
import os
import subprocess
import sys
import time
import types
import uuid
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

URL = os.environ.get("TEST_DATABASE_URL", "")
if not URL:
    sys.exit("Set TEST_DATABASE_URL to a scratch PostgreSQL database (never production).")
SCHEMA = "publivra_test_" + uuid.uuid4().hex[:10]

try:
    import psycopg2  # noqa: F401

    DRIVER = "psycopg2"
except ImportError:
    DRIVER = "psql stand-in"
    stub = types.ModuleType("psycopg2")
    stub.extras = types.ModuleType("psycopg2.extras")
    stub.OperationalError = type("OperationalError", (Exception,), {})
    sys.modules["psycopg2"], sys.modules["psycopg2.extras"] = stub, stub.extras

import config  # noqa: E402

config.AUTH_SECRET_KEY = "test-secret-key-that-is-long-enough-0123456789"
config.DATABASE_URL = URL

from auth import db, schemas, security, service  # noqa: E402
from auth.db import ServiceError  # noqa: E402
from workflow import services as wf  # noqa: E402

try:
    import argon2  # noqa: F401

    HASHER = "argon2id"
except ImportError:  # build machine only: keep the tests runnable, and say so
    HASHER = "scrypt stand-in (argon2-cffi is not installed here)"

    def _hash(password):
        salt = os.urandom(16)
        return "scrypt$" + salt.hex() + "$" + hashlib.scrypt(password.encode(), salt=salt, n=2**12, r=8, p=1).hex()

    def _verify(stored, password):
        try:
            _, salt, digest = stored.split("$")
            return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**12, r=8, p=1).hex() == digest
        except Exception:
            return False

    security.hash_password, security.verify_password = _hash, _verify


def psql(sql: str, *files):
    cmd = ["psql", URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql]
    for f in files:
        cmd += ["-f", str(f)]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def setup():
    # gen_random_uuid() is built in since PostgreSQL 13, so the pgcrypto line is not needed in the copy
    ddl = (ROOT / "migrations" / "001_schema.sql").read_text()
    scratch = ROOT / "tests" / f".{SCHEMA}.sql"
    scratch.write_text(f'CREATE SCHEMA "{SCHEMA}";\nSET search_path TO "{SCHEMA}", public;\n{ddl}\n')
    try:
        psql("SELECT 1", scratch)
    finally:
        scratch.unlink()
    if DRIVER == "psycopg2":
        import database

        real_connect = database._connect

        def connect():
            conn = real_connect()
            with conn.cursor() as cur:
                cur.execute(f'SET search_path TO "{SCHEMA}", public')
            conn.commit()
            return conn

        database._connect = connect
        return None
    from tests import pg_shim

    session = pg_shim.Session(URL, SCHEMA)
    db.transaction = service.transaction = wf.transaction = pg_shim.make_transaction(session)
    return session


def teardown(session):
    if session:
        session.close()
    psql(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')


def raises(status, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except ServiceError as exc:
        assert exc.status == status, f"expected {status}, got {exc.status}: {exc.message}"
        return exc.message
    raise AssertionError(f"expected ServiceError {status}, but the call succeeded")


def query(sql, params=()):
    with db.transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


RESULTS = []


def check(number, title):
    def wrap(fn):
        RESULTS.append((number, title, fn))
        return fn

    return wrap


S = {}  # shared state between the numbered checks
PASSWORD = "SecurePassword123"


def accounts(prefix, domain, password=PASSWORD):
    return {
        "creator": {"login_id": f"{prefix}creator@{domain}", "password": password, "full_name": f"{prefix.title()}Asha Creator"},
        "manager": {"login_id": f"{prefix}manager@{domain}", "password": password, "full_name": ""},
        "legal_approver": {"login_id": f"{prefix}legal@{domain}", "password": password, "full_name": "Leela Legal"},
    }


@check(1, "Register Company A with the logins of its three roles")
def _():
    S["A"] = service.register_company("ABC Technologies", "abc.com", "", accounts("", "abc.com"))
    assert S["A"]["message"] == "Company registered successfully" and uuid.UUID(S["A"]["company_id"])
    acc = S["A"]["accounts"]
    assert {r: acc[r]["login_id"] for r in acc} == {"creator": "creator@abc.com", "manager": "manager@abc.com", "legal_approver": "legal@abc.com"}
    assert acc["manager"]["full_name"] == "ABC Technologies Manager"  # default name when none is given
    assert "password" not in str(S["A"]).lower()
    row = query("SELECT company_email, company_domain FROM auth_companies WHERE company_id = %s", (S["A"]["company_id"],))[0]
    assert row == {"company_email": "contact@abc.com", "company_domain": "abc.com"}


@check(2, "Exactly one Creator, one Manager and one Legal Approver; passwords stored only as hashes")
def _():
    rows = query(
        "SELECT m.role, u.email, u.password_hash FROM auth_company_memberships m JOIN auth_users u ON u.user_id = m.user_id WHERE m.company_id = %s ORDER BY m.role",
        (S["A"]["company_id"],),
    )
    assert [r["role"] for r in rows] == ["creator", "legal_approver", "manager"]
    for r in rows:
        assert PASSWORD not in r["password_hash"] and (r["password_hash"].startswith("$argon2id$") or HASHER != "argon2id")


@check(3, "Registration is all or nothing")
def _():
    before = query("SELECT count(*) AS n FROM auth_users")[0]["n"]
    clash = accounts("", "beta.io")
    clash["legal_approver"]["login_id"] = "manager@abc.com"  # already taken by company A
    assert "manager@abc.com" in raises(409, service.register_company, "Beta Corp", "beta.io", "", clash)
    assert query("SELECT count(*) AS n FROM auth_users")[0]["n"] == before
    assert not query("SELECT 1 AS x FROM auth_companies WHERE company_domain = 'beta.io'")


@check(4, "Each role needs its own login ID")
def _():
    same = accounts("", "gamma.in")
    same["manager"]["login_id"] = "CREATOR@gamma.in"
    raises(422, service.register_company, "Gamma", "gamma.in", "", same)


@check(5, "A domain can be registered only once")
def _():
    raises(409, service.register_company, "ABC Clone", "ABC.com", "", accounts("x", "abc.com"))
    S["B"] = service.register_company("Beta Corp", "beta.io", "hello@beta.io", accounts("", "beta.io"))


@check(6, "Weak passwords and bad IDs are refused by the request checks")
def _():
    good = {"company_name": "Delta", "company_domain": "delta.org", "accounts": accounts("", "delta.org")}
    schemas.CompanyRegister(**good)
    for role, field, value in (("creator", "password", "short1"), ("manager", "password", "allletters"), ("legal_approver", "login_id", "not-an-id")):
        bad = {**good, "accounts": {**good["accounts"], role: {**good["accounts"][role], field: value}}}
        try:
            schemas.CompanyRegister(**bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {field}={value}")
    for domain in ("", "nodot", "bad domain.com"):
        try:
            schemas.CompanyRegister(**{**good, "company_domain": domain})
        except ValueError:
            continue
        raise AssertionError(f"accepted domain {domain!r}")
    assert schemas.CompanyRegister(**{**good, "company_domain": "@Delta.org"}).company_domain == "delta.org"


@check(7, "Invalid passwords are rejected")
def _():
    raises(401, service.login, "creator@abc.com", "WrongPassword999", "creator", "t7")
    raises(401, service.login, "nobody@gmail.com", PASSWORD, "creator", "t7")
    for _ in range(8):
        try:
            service.login("creator@abc.com", "WrongPassword999", "creator", "t7-flood")
        except ServiceError:
            pass
    raises(429, service.login, "creator@abc.com", PASSWORD, "creator", "t7-flood")  # rate limited, even with the right password


@check(8, "Login works for all three roles; role and company come from the database")
def _():
    for key, email, role in (("creator", "creator@abc.com", "creator"), ("manager", "manager@abc.com", "manager"), ("legal", "legal@abc.com", "legal_approver")):
        out = service.login(email.upper(), PASSWORD, role, "t8")
        assert out["role"] == role and out["company"]["company_id"] == S["A"]["company_id"] and out["token"].count(".") == 2
        assert "password_hash" not in out["user"]
        member = service.member_from_token(out["token"])
        assert member["user"]["email"] == email and member["role"] == role
        S[key] = member
    raises(403, service.login, "creator@abc.com", PASSWORD, "manager", "t8")  # right password, wrong role
    S["bea"] = service.member_from_token(service.login("creator@beta.io", PASSWORD, "creator", "t8")["token"])
    # tokens: tampered, signed with another key, or naming a company / role the user does not hold
    good = service.login("creator@abc.com", PASSWORD, "creator", "t8")["token"]
    raises(401, service.member_from_token, good[:-3] + ("abc" if not good.endswith("abc") else "xyz"))
    raises(401, service.member_from_token, "not.a.token")
    forged_company, _ = security.make_token(S["creator"]["user"]["user_id"], S["B"]["company_id"], "creator")
    raises(401, service.member_from_token, forged_company)
    forged_role, _ = security.make_token(S["creator"]["user"]["user_id"], S["A"]["company_id"], "manager")
    raises(401, service.member_from_token, forged_role)
    import jwt

    other_key = jwt.encode({"sub": S["creator"]["user"]["user_id"], "cid": S["A"]["company_id"], "role": "creator", "exp": int(time.time()) + 600}, "x" * 40, algorithm="HS256")
    raises(401, service.member_from_token, other_key)
    expired = jwt.encode({"sub": S["creator"]["user"]["user_id"], "cid": S["A"]["company_id"], "role": "creator", "exp": int(time.time()) - 5}, config.AUTH_SECRET_KEY, algorithm="HS256")
    assert "expired" in raises(401, service.member_from_token, expired)


@check(9, "Creator can create content")
def _():
    body = "Line one.\n  It's \"quoted\"; DROP TABLE auth_users; --\nLine three with a tab\tand a backslash \\ end.  "
    c = wf.create_content(S["creator"], "  Diwali   offer  ", body)
    assert c["status"] == "draft" and c["title"] == "Diwali offer" and c["body"] == body  # stored exactly, as data
    assert c["creator"]["full_name"] == "Asha Creator" and c["approvals"] == []
    S["c1"] = c["content_id"]
    S["c2"] = wf.create_content(S["creator"], "Loan advert", "Guaranteed approval in 24 hours.")["content_id"]
    S["c3"] = wf.create_content(S["creator"], "Needs work", "First draft.")["content_id"]
    raises(422, wf.create_content, S["creator"], "", "x")
    raises(422, wf.create_content, S["creator"], "Title", "   ")
    raises(403, wf.create_content, S["manager"], "Manager post", "Not allowed")
    assert query("SELECT count(*) AS n FROM auth_users")[0]["n"] == 6  # the injection attempt was just text


@check(10, "Creator can submit content to the manager")
def _():
    assert [c["content_id"] for c in wf.list_content(S["manager"])] == []  # drafts are private to the creator
    assert wf.submit_content(S["creator"], S["c1"])["status"] == "pending_manager"
    raises(409, wf.submit_content, S["creator"], S["c1"])  # already submitted
    raises(409, wf.publish_content, S["creator"], S["c1"])  # pending review: cannot publish
    raises(409, wf.update_content, S["creator"], S["c1"], "Edited", "while pending")
    assert [c["content_id"] for c in wf.list_content(S["manager"])] == [S["c1"]]
    assert wf.list_content(S["legal"]) == []  # nothing has been sent to legal


@check(11, "Manager can approve content directly (legal is optional)")
def _():
    raises(422, wf.manager_review, S["manager"], S["c1"], "maybe")
    c = wf.manager_review(S["manager"], S["c1"], "approved", "Looks good")
    assert c["status"] == "approved" and len(c["approvals"]) == 1
    a = c["approvals"][0]
    assert (a["reviewer_role"], a["decision"], a["comments"], a["reviewer"]["full_name"]) == ("manager", "approved", "Looks good", "ABC Technologies Manager")
    raises(409, wf.manager_review, S["manager"], S["c1"], "rejected", "too late")  # one decision per review
    assert len(wf.get_content(S["manager"], S["c1"])["approvals"]) == 1


@check(12, "Creator can publish directly approved content")
def _():
    assert wf.publish_content(S["creator"], S["c1"])["status"] == "published"
    raises(409, wf.publish_content, S["creator"], S["c1"])
    raises(409, wf.update_content, S["creator"], S["c1"], "Edit", "after publishing")


@check(13, "Manager can forward another item to Legal")
def _():
    wf.submit_content(S["creator"], S["c2"])
    c = wf.manager_review(S["manager"], S["c2"], "sent_to_legal", "Financial promise - legal please")
    assert c["status"] == "pending_legal"
    raises(409, wf.manager_review, S["manager"], S["c2"], "approved")  # now only legal can decide
    raises(409, wf.publish_content, S["creator"], S["c2"])
    assert [x["content_id"] for x in wf.list_content(S["legal"])] == [S["c2"]]


@check(14, "Legal can approve that content")
def _():
    raises(422, wf.legal_review, S["legal"], S["c2"], "sent_to_legal")  # not a legal decision
    c = wf.legal_review(S["legal"], S["c2"], "approved")
    assert c["status"] == "approved"
    assert [(a["reviewer_role"], a["decision"]) for a in c["approvals"]] == [("manager", "sent_to_legal"), ("legal_approver", "approved")]


@check(15, "Creator can publish legally approved content")
def _():
    assert wf.publish_content(S["creator"], S["c2"])["status"] == "published"


@check(16, "Legal cannot publish")
def _():
    wf.submit_content(S["creator"], S["c3"])
    wf.manager_review(S["manager"], S["c3"], "sent_to_legal")
    raises(403, wf.publish_content, S["legal"], S["c3"])
    raises(403, wf.publish_content, S["manager"], S["c3"])
    raises(403, wf.submit_content, S["legal"], S["c3"])


@check(17, "Creator cannot approve")
def _():
    raises(403, wf.manager_review, S["creator"], S["c3"], "approved")
    raises(403, wf.legal_review, S["creator"], S["c3"], "approved")
    assert wf.get_content(S["creator"], S["c3"])["status"] == "pending_legal"


@check(18, "Manager cannot perform the legal approval")
def _():
    raises(403, wf.legal_review, S["manager"], S["c3"], "approved")
    raises(403, wf.manager_review, S["legal"], S["c3"], "approved")
    assert wf.get_content(S["manager"], S["c3"])["status"] == "pending_legal"


@check(19, "Company B cannot access Company A's content")
def _():
    bea = S["bea"]
    for cid in (S["c1"], S["c2"], S["c3"]):
        raises(404, wf.get_content, bea, cid)
        raises(404, wf.update_content, bea, cid, "Hijack", "text")
        raises(404, wf.submit_content, bea, cid)
        raises(404, wf.publish_content, bea, cid)
    assert wf.list_content(bea) == []
    # B's manager cannot see or decide A's pending item either
    bob = service.member_from_token(service.login("manager@beta.io", PASSWORD, "manager", "t19")["token"])
    assert wf.list_content(bob) == []
    raises(404, wf.get_content, bob, S["c3"])
    raises(404, wf.manager_review, bob, S["c3"], "approved")
    assert wf.get_content(S["legal"], S["c3"])["status"] == "pending_legal"  # untouched
    raises(404, wf.get_content, S["creator"], "not-a-uuid")
    raises(404, wf.get_content, S["creator"], str(uuid.uuid4()))
    # B's own content is invisible to A
    b1 = wf.create_content(bea, "Beta launch", "Hello from Beta.")["content_id"]
    wf.submit_content(bea, b1)
    assert b1 not in [c["content_id"] for c in wf.list_content(S["manager"])]
    assert [c["content_id"] for c in wf.list_content(bob)] == [b1]


@check(21, "Rejection and change requests: comments reach the creator, who revises and resubmits")
def _():
    raises(422, wf.legal_review, S["legal"], S["c3"], "changes_requested", "  ")  # a comment is required
    c = wf.legal_review(S["legal"], S["c3"], "changes_requested", "Remove the word 'guaranteed'.")
    assert c["status"] == "changes_requested"
    mine = wf.get_content(S["creator"], S["c3"])
    assert mine["approvals"][-1]["comments"] == "Remove the word 'guaranteed'." and mine["approvals"][-1]["reviewer_role"] == "legal_approver"
    raises(409, wf.publish_content, S["creator"], S["c3"])  # awaiting changes: cannot publish
    assert wf.update_content(S["creator"], S["c3"], "Needs work v2", "Second draft.")["status"] == "changes_requested"
    assert wf.submit_content(S["creator"], S["c3"])["status"] == "pending_manager"
    c = wf.manager_review(S["manager"], S["c3"], "rejected", "Off brand.")
    assert c["status"] == "rejected"
    raises(409, wf.publish_content, S["creator"], S["c3"])  # rejected: cannot publish
    wf.update_content(S["creator"], S["c3"], "Needs work v3", "Third draft.")
    wf.submit_content(S["creator"], S["c3"])
    assert wf.manager_review(S["manager"], S["c3"], "approved")["status"] == "approved"
    # editing approved content withdraws the approval
    assert wf.update_content(S["creator"], S["c3"], "Needs work v4", "Changed after approval.")["status"] == "draft"
    raises(409, wf.publish_content, S["creator"], S["c3"])
    history = [(a["reviewer_role"], a["decision"]) for a in wf.get_content(S["creator"], S["c3"])["approvals"]]
    assert history == [("manager", "sent_to_legal"), ("legal_approver", "changes_requested"), ("manager", "rejected"), ("manager", "approved")], history  # the full history is kept


@check(22, "The audit summary is stored and returned (and the app still works without the column)")
def _():
    psql(f'ALTER TABLE "{SCHEMA}".auth_content DROP COLUMN audit')
    wf._audit_column = None
    assert wf.create_content(S["creator"], "No column", "Body.", {"risk": {"score": 40}})["audit"] is None  # ignored without the column
    psql(f'ALTER TABLE "{SCHEMA}".auth_content ADD COLUMN audit JSONB')
    wf._audit_column = None
    audit = {"risk": {"score": 40, "level": "MEDIUM", "parts": {"text": {"score": 23}}}, "note": "It's ready\nplease check", "version": 2}
    c = wf.create_content(S["creator"], "With audit", "Body.", audit)
    assert c["audit"] == audit
    assert wf.update_content(S["creator"], c["content_id"], "With audit", "Body 2.", {"version": 3})["audit"] == {"version": 3}
    assert wf.update_content(S["creator"], c["content_id"], "With audit", "Body 3.")["audit"] == {"version": 3}  # kept when not sent
    assert wf.get_content(S["creator"], S["c1"])["audit"] is None and wf.get_content(S["creator"], S["c1"])["status"] == "published"
    wf.submit_content(S["creator"], c["content_id"])
    assert wf.list_content(S["manager"], status="pending_manager")[0]["audit"] == {"version": 3}
    raises(413, wf.create_content, S["creator"], "Too big", "Body.", {"blob": "x" * 800_000})


@check(23, "A removed membership ends access at once, even with a valid token")
def _():
    token = service.login("manager@beta.io", PASSWORD, "manager", "t23")["token"]
    assert service.member_from_token(token)["role"] == "manager"
    query("DELETE FROM auth_company_memberships WHERE user_id = %s RETURNING membership_id", (service.member_from_token(token)["user"]["user_id"],))
    raises(401, service.member_from_token, token)
    raises(403, service.login, "manager@beta.io", PASSWORD, "manager", "t23")
    saved, config.AUTH_SECRET_KEY = config.AUTH_SECRET_KEY, ""
    try:
        raises(503, service.login, "creator@abc.com", PASSWORD, "creator", "t23")  # no secret configured -> no sign-in, no default key
    finally:
        config.AUTH_SECRET_KEY = saved


if __name__ == "__main__":
    print(f"PostgreSQL via {DRIVER} · passwords: {HASHER} · schema {SCHEMA}\n")
    session = setup()
    failed = 0
    try:
        for number, title, fn in RESULTS:
            try:
                fn()
                print(f"PASS  {number:>2}. {title}")
            except Exception as exc:  # keep going so the report is complete
                failed += 1
                print(f"FAIL  {number:>2}. {title}\n          {type(exc).__name__}: {exc}")
    finally:
        teardown(session)
    print(f"\n{len(RESULTS) - failed} passed, {failed} failed  (check 20 - existing health/audit endpoints - is in scripts/smoke_auth.py)")
    sys.exit(1 if failed else 0)
