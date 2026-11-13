"""HTTP smoke test of sign-in + approval workflow against a RUNNING backend (standard library only).

    python scripts/smoke_auth.py http://localhost:8000

It walks the 20 checks of the brief through the real API, including check 20 (the existing
health and audit endpoints still answer). It registers two throw-away companies with random
domains; there is no delete endpoint, so point it at a local or staging database.
Pass --skip-audit to leave out the AI audit call (it uses your LLM quota).
"""
import json
import sys
import urllib.error
import urllib.request
import uuid

BASE = (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "http://localhost:8000").rstrip("/")
SKIP_AUDIT = "--skip-audit" in sys.argv
RUN = uuid.uuid4().hex[:8]
PASSWORD = "SecurePassword123"
passed = failed = 0


def call(method, path, body=None, token=None, timeout=120):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, {"detail": raw.decode("utf-8", "replace")[:200]}


def check(number, title, ok, detail=""):
    global passed, failed
    passed, failed = passed + bool(ok), failed + (not ok)
    print(f"{'PASS' if ok else 'FAIL'}  {number:>2}. {title}{'' if ok else f'  -> {detail}'}")


def company(name):
    domain = f"smoke-{RUN}-{name.lower()}.example.com"
    accounts = {r: {"login_id": f"{r.split('_')[0]}@{domain}", "password": PASSWORD} for r in ("creator", "manager", "legal_approver")}
    status, data = call("POST", "/api/auth/company/register", {"company_name": f"Smoke {name}", "company_domain": domain, "accounts": accounts})
    return status, data, {r: a["login_id"] for r, a in accounts.items()}


def login(email, role, password=PASSWORD):
    return call("POST", "/api/auth/login", {"email": email, "password": password, "role": role})


s, a, ids = company("Alpha")
check(1, "Register Company A with its three role logins", s == 201 and a.get("company_id"), a)
acc = a.get("accounts", {}) if isinstance(a, dict) else {}
check(2, "Exactly three role logins issued", sorted(acc) == ["creator", "legal_approver", "manager"], acc)
creator_email, manager_email, legal_email = ids["creator"], ids["manager"], ids["legal_approver"]
s, d, _ = company("Alpha")
check(3, "The same domain / login IDs cannot be registered twice", s == 409, (s, d))
s, d = call("POST", "/api/auth/company/register", {"company_name": "Weak", "company_domain": f"weak-{RUN}.example.com",
            "accounts": {r: {"login_id": f"{r}@weak-{RUN}.example.com", "password": "short"} for r in ("creator", "manager", "legal_approver")}})
check(4, "Weak passwords are refused", s == 422, (s, d))
check(5, "(covered by 1-2: one login per role)", True)
s, d = login(creator_email, "manager")
check(6, "A login cannot be used for another role", s == 403, (s, d))
s, d = login(creator_email, "creator", "WrongPassword999")
check(7, "Invalid passwords are rejected", s == 401, (s, d))
tokens = {}
ok = True
for key, email, role in (("creator", creator_email, "creator"), ("manager", manager_email, "manager"), ("legal", legal_email, "legal_approver")):
    s, d = login(email, role)
    ok = ok and s == 200 and d.get("role") == role
    tokens[key] = d.get("token")
    s, me = call("GET", "/api/auth/me", token=tokens[key])
    ok = ok and s == 200 and me["user"]["email"] == email
s, d = login(creator_email, "manager")
check(8, "Login works for all three roles (and a wrong role is refused)", ok and s == 403 and call("GET", "/api/auth/me")[0] == 401, (s, d))

s, c1 = call("POST", "/api/workflow/content", {"title": "Smoke one", "body": "First item."}, tokens["creator"])
check(9, "Creator can create content", s == 201 and c1.get("status") == "draft", c1)
id1 = c1.get("content_id")
s, d = call("POST", f"/api/workflow/content/{id1}/submit", token=tokens["creator"])
check(10, "Creator can submit content", s == 200 and d.get("status") == "pending_manager", d)
s, d = call("POST", f"/api/workflow/content/{id1}/manager-review", {"decision": "approved", "comments": "ok"}, tokens["manager"])
check(11, "Manager can directly approve content", s == 200 and d.get("status") == "approved", d)
s, d = call("POST", f"/api/workflow/content/{id1}/publish", token=tokens["creator"])
check(12, "Creator can publish directly approved content", s == 200 and d.get("status") == "published", d)

s, c2 = call("POST", "/api/workflow/content", {"title": "Smoke two", "body": "Second item."}, tokens["creator"])
id2 = c2.get("content_id")
call("POST", f"/api/workflow/content/{id2}/submit", token=tokens["creator"])
s, d = call("POST", f"/api/workflow/content/{id2}/manager-review", {"decision": "sent_to_legal"}, tokens["manager"])
check(13, "Manager can forward another item to Legal", s == 200 and d.get("status") == "pending_legal", d)
s16, _ = call("POST", f"/api/workflow/content/{id2}/publish", token=tokens["legal"])
s17, _ = call("POST", f"/api/workflow/content/{id2}/manager-review", {"decision": "approved"}, tokens["creator"])
s17b, _ = call("POST", f"/api/workflow/content/{id2}/legal-review", {"decision": "approved"}, tokens["creator"])
s18, _ = call("POST", f"/api/workflow/content/{id2}/legal-review", {"decision": "approved"}, tokens["manager"])
s, d = call("POST", f"/api/workflow/content/{id2}/legal-review", {"decision": "approved"}, tokens["legal"])
check(14, "Legal can approve that content", s == 200 and d.get("status") == "approved", d)
s, d = call("POST", f"/api/workflow/content/{id2}/publish", token=tokens["creator"])
check(15, "Creator can publish legally approved content", s == 200 and d.get("status") == "published", d)
check(16, "Legal cannot publish", s16 == 403, s16)
check(17, "Creator cannot approve", s17 == 403 and s17b == 403, (s17, s17b))
check(18, "Manager cannot perform legal approval", s18 == 403, s18)

_, _, b_ids = company("Beta")
_, bd = login(b_ids["creator"], "creator")
s_get, _ = call("GET", f"/api/workflow/content/{id1}", token=bd.get("token"))
s_list, listing = call("GET", "/api/workflow/content", token=bd.get("token"))
s_anon, _ = call("GET", "/api/workflow/content")
check(19, "Company B cannot access Company A's content", s_get == 404 and s_list == 200 and listing.get("items") == [] and s_anon == 401, (s_get, s_list, s_anon))

s, health = call("GET", "/api/health")
ok = s == 200 and "ai" in health and "database" in health
detail = (s, health)
if ok and not SKIP_AUDIT:
    s, audit = call("POST", "/api/audit", {"text": "We guarantee 100% returns for every client.", "title": "Smoke audit"}, timeout=180)
    ok, detail = s == 200 and "findings" in audit, (s, str(audit)[:200])
check(20, "Existing health and audit endpoints still work" + (" (audit call skipped)" if SKIP_AUDIT else ""), ok, detail)

print(f"\n{passed} passed, {failed} failed against {BASE}")
sys.exit(1 if failed else 0)
