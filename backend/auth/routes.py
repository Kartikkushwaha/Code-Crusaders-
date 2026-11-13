"""/api/auth endpoints and the dependencies that protect other routes."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from auth import service
from auth.db import ServiceError
from auth.schemas import CompanyRegister, Login
from auth.security import signup_limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])


def http_error(exc: ServiceError) -> HTTPException:
    headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else None
    return HTTPException(status_code=exc.status, detail=exc.message, headers=headers)


def client_ip(request: Request) -> str:
    # Render terminates TLS in front of the app: the caller's address is the first forwarded one.
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "")


def current_member(authorization: str = Header(default="")) -> dict:
    """Dependency: the signed-in member ({user, company, role}) or 401."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Sign in to continue.", headers={"WWW-Authenticate": "Bearer"})
    try:
        return service.member_from_token(token.strip())
    except ServiceError as exc:
        raise http_error(exc)


def require_role(*roles: str):
    """Dependency factory: the signed-in member must hold one of `roles` (checked on the server)."""

    def dependency(member: dict = Depends(current_member)) -> dict:
        if member["role"] not in roles:
            raise HTTPException(status_code=403, detail="Your role is not allowed to do this.")
        return member

    return dependency


@router.post("/company/register", status_code=201)
def register_company(body: CompanyRegister, request: Request):
    """Register a company together with the login ID and password of its Creator, Manager and Legal Approver."""
    try:
        signup_limiter.check(client_ip(request))
        accounts = {role: getattr(body.accounts, role).model_dump() for role in ("creator", "manager", "legal_approver")}
        return service.register_company(body.company_name, body.company_domain, body.company_email, accounts)
    except ServiceError as exc:
        raise http_error(exc)


@router.post("/login")
def login(body: Login, request: Request):
    try:
        return service.login(body.email, body.password, body.role, client_ip(request))
    except ServiceError as exc:
        raise http_error(exc)


@router.get("/me")
def me(member: dict = Depends(current_member)):
    return member
