"""Company registration (with its three role logins), login and membership checks.

Tables used (created by migrations/001_schema.sql):
  auth_companies, auth_users, auth_company_memberships
"""
import logging
import uuid
from auth import security
from auth.db import ServiceError, is_unique_violation, iso, now, transaction

log = logging.getLogger("publivra.auth")

ROLE_LABEL = {"creator": "Creator", "manager": "Manager", "legal_approver": "Legal Approver"}


def register_company(company_name: str, company_domain: str, company_email: str, accounts: dict) -> dict:
    """Create the company and the logins of its three roles in ONE transaction.

    accounts: {"creator" | "manager" | "legal_approver": {"login_id", "password", "full_name"}}
    The person registering the company chooses each role's login ID and password and hands them
    to the three people. Nothing is created unless everything is valid.
    """
    security.ensure_configured()
    ids = [accounts[r]["login_id"].lower() for r in security.ROLES]
    if len(set(ids)) != 3:
        raise ServiceError(422, "Each role needs its own login ID.")
    company_email = company_email or f"contact@{company_domain}"
    # hashing takes a moment: do it before the transaction opens
    hashes = {r: security.hash_password(accounts[r]["password"]) for r in security.ROLES}
    company_id, moment = str(uuid.uuid4()), now()
    created = {}
    try:
        with transaction() as cur:
            cur.execute(
                "SELECT company_name FROM auth_companies WHERE LOWER(company_domain) = LOWER(%s) OR LOWER(company_email) = LOWER(%s) LIMIT 1",
                (company_domain, company_email),
            )
            if cur.fetchone():
                raise ServiceError(409, f"A company with the domain {company_domain} (or e-mail {company_email}) is already registered.")
            cur.execute("SELECT LOWER(email) AS email FROM auth_users WHERE LOWER(email) = ANY(%s::text[])", (ids,))
            taken = [r["email"] for r in cur.fetchall()]
            if taken:
                raise ServiceError(409, f"These login IDs are already in use: {', '.join(taken)}. Choose different ones.")
            cur.execute(
                "INSERT INTO auth_companies (company_id, company_name, company_email, company_domain, created_at) VALUES (%s, %s, %s, %s, %s)",
                (company_id, company_name, company_email, company_domain, moment),
            )
            for role in security.ROLES:
                acc = accounts[role]
                user_id = str(uuid.uuid4())
                name = acc.get("full_name") or f"{company_name} {ROLE_LABEL[role]}"
                cur.execute(
                    "INSERT INTO auth_users (user_id, full_name, email, password_hash, created_at) VALUES (%s, %s, %s, %s, %s)",
                    (user_id, name[:150], acc["login_id"].lower(), hashes[role], moment),
                )
                cur.execute(
                    "INSERT INTO auth_company_memberships (membership_id, company_id, user_id, role, created_at) VALUES (%s, %s, %s, %s, %s)",
                    (str(uuid.uuid4()), company_id, user_id, role, moment),
                )
                created[role] = {"user_id": user_id, "login_id": acc["login_id"].lower(), "full_name": name[:150]}
    except ServiceError:
        raise
    except Exception as exc:
        if is_unique_violation(exc):  # lost a race for a login ID
            raise ServiceError(409, "One of these login IDs was registered a moment ago. Choose different ones.")
        raise
    log.info("Company registered with 3 role logins: %s (%s)", company_name, company_id)  # never log passwords
    return {
        "message": "Company registered successfully",
        "company_id": company_id,
        "company_name": company_name,
        "company_domain": company_domain,
        "accounts": created,
    }


_MEMBER_SQL = """
SELECT u.user_id, u.full_name, u.email, m.role, c.company_id, c.company_name, c.company_domain
FROM auth_company_memberships m
JOIN auth_users u ON u.user_id = m.user_id
JOIN auth_companies c ON c.company_id = m.company_id
"""


def _member(row) -> dict:
    return {
        "user": {"user_id": str(row["user_id"]), "full_name": row["full_name"], "email": row["email"]},
        "company": {"company_id": str(row["company_id"]), "company_name": row["company_name"], "company_domain": row["company_domain"] or ""},
        "role": row["role"],
    }


def login(email: str, password: str, role: str, client: str = "") -> dict:
    """Check the password and that the chosen role is really this user's role; return a signed token.

    The company and role in the token come from the membership row, never from the request.
    """
    security.ensure_configured()
    key = f"{email}|{client}"
    security.login_limiter.check(key)
    with transaction() as cur:
        cur.execute("SELECT user_id, password_hash FROM auth_users WHERE LOWER(email) = LOWER(%s)", (email,))
        user = cur.fetchone()
        if not user:
            security.burn_time(password)
            raise ServiceError(401, "Incorrect e-mail or password.")
        if not security.verify_password(user["password_hash"], password):
            raise ServiceError(401, "Incorrect e-mail or password.")
        cur.execute(_MEMBER_SQL + "WHERE m.user_id = %s AND m.role = %s ORDER BY m.created_at LIMIT 1", (str(user["user_id"]), role))
        row = cur.fetchone()
    if not row:
        raise ServiceError(403, f"This account is not registered as {ROLE_LABEL[role]}. Choose the role you registered with.")
    security.login_limiter.reset(key)
    member = _member(row)
    token, expires_in = security.make_token(member["user"]["user_id"], member["company"]["company_id"], member["role"])
    return {"token": token, "token_type": "bearer", "expires_in": expires_in, **member}


def member_from_token(token: str) -> dict:
    """The signed-in member, re-checked against the database on every request.

    A valid signature is not enough: the membership (user + company + role) must still exist.
    """
    claims = security.read_token(token)
    try:
        user_id, company_id = str(uuid.UUID(claims["sub"])), str(uuid.UUID(claims["cid"]))
    except (ValueError, TypeError, AttributeError):
        raise ServiceError(401, "Invalid sign-in token. Please sign in again.")
    with transaction() as cur:
        cur.execute(_MEMBER_SQL + "WHERE m.user_id = %s AND m.company_id = %s AND m.role = %s", (user_id, company_id, claims["role"]))
        row = cur.fetchone()
    if not row:
        raise ServiceError(401, "This account no longer has access. Please sign in again.")
    return _member(row)
