"""Who owns a piece of audit history: the "tenant" tag stored in the `company` column of
document_compliance and publications.

    co:<company_id>     a registered company, taken from the signed-in user's token (never from the request)
    demo:<session id>   one "Take a demo" session (a random id the dashboard creates at demo sign-in)

AI audits, publications, sign-offs and the company graph are read back only for the caller's tenant.
The common graph (all checks) stays visible to everyone.
"""
import re

from fastapi import HTTPException

from auth import service
from auth.db import ServiceError

DEMO_TAG = re.compile(r"^demo:[A-Za-z0-9_-]{8,64}$")


def resolve(authorization: str = "", claimed: str = "") -> str:
    """The caller's tenant tag, or "" when there is none.

    A Bearer token wins and is checked against the database; an invalid token is a 401 (the dashboard
    then signs the user out). Without a token only a well-formed demo tag is accepted, so a company's
    tag can never be claimed by sending its name or id.
    """
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        try:
            member = service.member_from_token(token.strip())
        except ServiceError as exc:
            raise HTTPException(status_code=exc.status, detail=exc.message, headers={"WWW-Authenticate": "Bearer"} if exc.status == 401 else None)
        return f"co:{member['company']['company_id']}"
    claimed = (claimed or "").strip()
    return claimed if DEMO_TAG.match(claimed) else ""
