"""Database access for the auth and workflow modules.

Reuses the app's existing Neon connection (database.connection): there is no second engine or pool.
Every service function runs inside ONE transaction: commit on success, rollback on any error.
All statements are parameterised.
"""
from contextlib import contextmanager
from datetime import datetime, timezone


class ServiceError(Exception):
    """A problem to report to the client. `status` is the HTTP status code."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@contextmanager
def transaction():
    """Yield a cursor whose rows are dicts. The transaction commits when the block ends normally."""
    import database  # imported here so this module loads without a database driver (tests)
    import psycopg2
    import psycopg2.extras

    if not database.is_configured():
        raise ServiceError(503, "The database is not configured on the server.")
    try:
        with database.connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                yield cur
    except psycopg2.OperationalError as exc:
        if getattr(exc, "pgcode", None):  # a SQL-level error: let the caller see it
            raise
        raise ServiceError(503, "The database is not reachable right now. Please try again.") from exc


def is_unique_violation(exc: Exception) -> bool:
    return getattr(exc, "pgcode", None) == "23505"


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value):
    """Timestamps as ISO-8601 strings in API responses."""
    return value.isoformat() if isinstance(value, datetime) else value
