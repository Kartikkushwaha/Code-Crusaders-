"""Passwords (Argon2id), login tokens (JWT, HS256) and rate limiting."""
import secrets
import threading
import time
from datetime import timedelta

import config
from auth.db import ServiceError, now

ROLES = ("creator", "manager", "legal_approver")

_hasher = None


def _argon2():
    global _hasher
    if _hasher is None:
        from argon2 import PasswordHasher

        # Argon2id, 19 MiB per hash (OWASP minimum): safe on a 512 MB instance even with parallel logins.
        _hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
    return _hasher


def hash_password(password: str) -> str:
    return _argon2().hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return bool(_argon2().verify(password_hash, password))
    except Exception:  # wrong password, or a hash that is not Argon2
        return False


_DUMMY_HASH = None


def burn_time(password: str) -> None:
    """Spend the same time as a real check when the e-mail is unknown, so timing reveals nothing."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    verify_password(_DUMMY_HASH, password)


# ---- login tokens ------------------------------------------------------------------
def _secret() -> str:
    if len(config.AUTH_SECRET_KEY) < 32:
        raise ServiceError(503, "Sign-in is not configured on the server (AUTH_SECRET_KEY must be set to at least 32 characters).")
    return config.AUTH_SECRET_KEY


def ensure_configured() -> None:
    _secret()


def make_token(user_id: str, company_id: str, role: str):
    """Signed token holding the user, the company and the role. Returns (token, seconds until it expires)."""
    import jwt

    issued = now()
    lifetime = timedelta(hours=config.AUTH_TOKEN_HOURS)
    payload = {"sub": str(user_id), "cid": str(company_id), "role": role, "iat": int(issued.timestamp()), "exp": int((issued + lifetime).timestamp())}
    return jwt.encode(payload, _secret(), algorithm="HS256"), int(lifetime.total_seconds())


def read_token(token: str) -> dict:
    """Verified claims of a token, or 401. The algorithm is fixed, so the token cannot choose it."""
    import jwt

    try:
        claims = jwt.decode(token, _secret(), algorithms=["HS256"], options={"require": ["exp", "sub", "cid", "role"]})
    except jwt.ExpiredSignatureError:
        raise ServiceError(401, "Your session has expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise ServiceError(401, "Invalid sign-in token. Please sign in again.")
    if claims.get("role") not in ROLES:
        raise ServiceError(401, "Invalid sign-in token. Please sign in again.")
    return claims


# ---- rate limiting (in memory; the API runs as one process on Render) ---------------
class RateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self._hits = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """Count one attempt for `key`; raise 429 when there are too many in the window."""
        t = time.time()
        with self._lock:
            if len(self._hits) > 5000:  # forget idle keys
                self._hits = {k: v for k, v in self._hits.items() if v and t - v[-1] < self.window}
            hits = [h for h in self._hits.get(key, []) if t - h < self.window]
            if len(hits) >= self.limit:
                self._hits[key] = hits
                wait = int(self.window - (t - hits[0])) + 1
                raise ServiceError(429, f"Too many attempts. Please wait {max(1, wait // 60)} minute(s) and try again.")
            hits.append(t)
            self._hits[key] = hits

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


login_limiter = RateLimiter(limit=8, window_seconds=300)  # per e-mail + IP
signup_limiter = RateLimiter(limit=6, window_seconds=3600)  # per IP
