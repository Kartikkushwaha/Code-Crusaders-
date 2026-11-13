"""Test-only stand-in for psycopg2, for machines that have a PostgreSQL server but no Python driver.

It drives one long-lived `psql` process and gives the service code what it uses from a cursor:
execute(sql, params) with %s placeholders, fetchone(), fetchall() (rows as dicts), plus errors
that carry `pgcode`. Statements run on the real server, so types, constraints and locks are real.
Not for production: the app itself uses psycopg2 (see auth/db.py).
"""
import json
import re
import subprocess
from contextlib import contextmanager
from datetime import datetime


class PgError(Exception):
    def __init__(self, message, pgcode):
        super().__init__(message)
        self.pgcode = pgcode


def _literal(value) -> str:
    """A psql meta-command argument: single-quoted, with C-style escapes."""
    if isinstance(value, bool):
        value = "true" if value else "false"
    elif isinstance(value, datetime):
        value = value.isoformat()
    elif isinstance(value, (list, tuple)):
        value = "{" + ",".join('"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"' for v in value) + "}"
    text = str(value).replace("\\", "\\\\").replace("'", "''").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return f"'{text}'"


class Session:
    def __init__(self, url: str, schema: str = ""):
        self.proc = subprocess.Popen(
            ["psql", url, "-X", "-q", "-A", "-t", "-v", "VERBOSITY=verbose"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        self.n = 0
        if schema:
            self.run(f'SET search_path TO "{schema}", public;')

    def run(self, command: str) -> list:
        self.n += 1
        marker = f"__END_{self.n}__"
        self.proc.stdin.write(f"{command}\n\\echo {marker}\n")
        self.proc.stdin.flush()
        lines = []
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("psql exited: " + "\n".join(lines))
            line = line.rstrip("\n")
            if line == marker:
                break
            lines.append(line)
        for line in lines:
            m = re.match(r"(?:psql:.*?)?ERROR:\s+(\w{5}):\s*(.*)", line)
            if m:
                raise PgError(m.group(2), m.group(1))
        return lines

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


class Cursor:
    def __init__(self, session: Session):
        self.session, self._rows = session, []

    def execute(self, sql: str, params=()):
        sql = " ".join(sql.split()).rstrip(";")
        args, count = [], 0
        params = list(params or ())

        def swap(_):
            nonlocal count
            value = params.pop(0)
            if value is None:
                return "NULL"
            count += 1
            args.append(_literal(value))
            return f"${count}"

        sql = re.sub(r"%s", swap, sql)
        assert not params, "more parameters than placeholders"
        head = sql.lstrip().split(None, 1)[0].upper()
        if head == "SELECT":
            sql = f"SELECT row_to_json(_t)::text FROM ({sql}) _t"
        elif re.search(r"\bRETURNING\b", sql, re.I):
            sql = f"WITH _t AS ({sql}) SELECT row_to_json(_t)::text FROM _t"
        lines = self.session.run(f"{sql} \\bind {' '.join(args)} \\g")
        self._rows = [json.loads(line) for line in lines if line.startswith("{")]

    def fetchone(self):
        return self._rows.pop(0) if self._rows else None

    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows


def make_transaction(session: Session):
    @contextmanager
    def transaction():
        session.run("BEGIN;")
        try:
            yield Cursor(session)
        except BaseException:
            session.run("ROLLBACK;")
            raise
        else:
            session.run("COMMIT;")

    return transaction
