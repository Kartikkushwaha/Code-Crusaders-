"""Content creation and the approval workflow.

Tables used (already created): auth_content, auth_approval_records (+ auth_users for names).

    draft / rejected / changes_requested --creator submits--> pending_manager
    pending_manager --manager--> approved | pending_legal | rejected | changes_requested
    pending_legal   --legal----> approved | rejected | changes_requested
    approved        --creator publishes--> published

Every function takes `member` - the signed-in {user, company, role} from the token, re-checked in the
database - and every statement is scoped to member's company_id. A status change is ONE conditional
UPDATE (... WHERE status = <expected>), so two reviewers can never both decide the same item.
"""
import json
import uuid

from auth.db import ServiceError, iso, now, transaction

MAX_TITLE, MAX_BODY, MAX_COMMENTS, MAX_AUDIT_BYTES = 300, 300_000, 4000, 700_000
EDITABLE = ["draft", "rejected", "changes_requested", "approved"]  # editing approved content sends it back to draft
SUBMITTABLE = ["draft", "rejected", "changes_requested"]
MANAGER_DECISIONS = {"approved": "approved", "sent_to_legal": "pending_legal", "rejected": "rejected", "changes_requested": "changes_requested"}
LEGAL_DECISIONS = {"approved": "approved", "rejected": "rejected", "changes_requested": "changes_requested"}

_audit_column = None


def has_audit_column(cur) -> bool:
    """True once migrations/002_content_audit.sql has been run (optional `audit` JSONB column)."""
    global _audit_column
    if _audit_column is None:
        cur.execute(
            "SELECT 1 AS present FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'auth_content' AND column_name = 'audit'"
        )
        _audit_column = cur.fetchone() is not None
    return _audit_column


def _content_id(value: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise ServiceError(404, "Content not found.")


def _clean(title, body):
    title = " ".join(str(title or "").split())
    body = str(body or "")
    if not title:
        raise ServiceError(422, "The content needs a title.")
    if len(title) > MAX_TITLE:
        raise ServiceError(422, f"The title is longer than {MAX_TITLE} characters.")
    if not body.strip():
        raise ServiceError(422, "The content is empty.")
    if len(body) > MAX_BODY:
        raise ServiceError(413, f"The content is longer than {MAX_BODY:,} characters.")
    return title, body  # the body is stored exactly as sent


def _audit_json(audit):
    if audit is None:
        return None
    if not isinstance(audit, dict):
        raise ServiceError(422, "The audit summary must be an object.")
    text = json.dumps(audit, ensure_ascii=False)
    if len(text.encode("utf-8")) > MAX_AUDIT_BYTES:
        raise ServiceError(413, "The audit summary is too large.")
    return text


def _need(member: dict, *roles: str) -> None:
    if member["role"] not in roles:
        raise ServiceError(403, "Your role is not allowed to do this.")


# --------------------------------------------------------------------------- reading
def _select(cur) -> str:
    audit = ", c.audit" if has_audit_column(cur) else ""
    return (
        "SELECT c.content_id, c.company_id, c.creator_user_id, c.title, c.body, c.status, c.created_at, c.updated_at, "
        f"u.full_name AS creator_name{audit} FROM auth_content c JOIN auth_users u ON u.user_id = c.creator_user_id "
    )


def _attach_records(cur, rows: list) -> list:
    """Shape rows for the API and add each item's approval records (oldest first)."""
    items = []
    by_id = {}
    for r in rows:
        audit = r.get("audit")
        if isinstance(audit, str):
            audit = json.loads(audit)
        item = {
            "content_id": str(r["content_id"]),
            "company_id": str(r["company_id"]),
            "title": r["title"],
            "body": r["body"],
            "status": r["status"],
            "created_at": iso(r["created_at"]),
            "updated_at": iso(r["updated_at"]),
            "creator": {"user_id": str(r["creator_user_id"]), "full_name": r["creator_name"]},
            "audit": audit,
            "approvals": [],
        }
        items.append(item)
        by_id[item["content_id"]] = item
    if items:
        cur.execute(
            "SELECT a.approval_id, a.content_id, a.reviewer_role, a.decision, a.comments, a.created_at, a.reviewer_user_id, u.full_name AS reviewer_name "
            "FROM auth_approval_records a JOIN auth_users u ON u.user_id = a.reviewer_user_id "
            "WHERE a.content_id = ANY(%s::uuid[]) ORDER BY a.created_at, a.approval_id",
            (list(by_id),),
        )
        for a in cur.fetchall():
            by_id[str(a["content_id"])]["approvals"].append(
                {
                    "approval_id": str(a["approval_id"]),
                    "reviewer": {"user_id": str(a["reviewer_user_id"]), "full_name": a["reviewer_name"]},
                    "reviewer_role": a["reviewer_role"],
                    "decision": a["decision"],
                    "comments": a["comments"] or "",
                    "created_at": iso(a["created_at"]),
                }
            )
    return items


def _visibility(member: dict):
    """(extra WHERE clause, parameters): what this role may see inside its own company."""
    if member["role"] == "creator":
        return "AND c.creator_user_id = %s", [member["user"]["user_id"]]
    if member["role"] == "manager":
        return "AND c.status <> 'draft'", []
    # legal approver: only what a manager has sent to legal (now or earlier)
    return "AND (c.status = 'pending_legal' OR EXISTS (SELECT 1 FROM auth_approval_records x WHERE x.content_id = c.content_id AND x.decision = 'sent_to_legal'))", []


def list_content(member: dict, status: str = "", limit: int = 100) -> list:
    where, params = _visibility(member)
    limit = max(1, min(int(limit or 100), 200))
    with transaction() as cur:
        sql = _select(cur) + "WHERE c.company_id = %s " + where
        args = [member["company"]["company_id"], *params]
        if status:
            sql += " AND c.status = %s"
            args.append(status)
        cur.execute(sql + " ORDER BY c.updated_at DESC LIMIT %s", (*args, limit))
        return _attach_records(cur, cur.fetchall())


def _get(cur, member: dict, content_id: str) -> dict:
    where, params = _visibility(member)
    cur.execute(_select(cur) + "WHERE c.company_id = %s AND c.content_id = %s " + where, (member["company"]["company_id"], content_id, *params))
    rows = cur.fetchall()
    if not rows:
        # same answer for "does not exist", "another company's" and "not yours to see": nothing leaks
        raise ServiceError(404, "Content not found.")
    return _attach_records(cur, rows)[0]


def get_content(member: dict, content_id: str) -> dict:
    with transaction() as cur:
        return _get(cur, member, _content_id(content_id))


# --------------------------------------------------------------------------- creator
def create_content(member: dict, title: str, body: str, audit=None) -> dict:
    _need(member, "creator")
    title, body = _clean(title, body)
    audit_text = _audit_json(audit)
    content_id, moment = str(uuid.uuid4()), now()
    with transaction() as cur:
        if has_audit_column(cur):
            cur.execute(
                "INSERT INTO auth_content (content_id, company_id, creator_user_id, title, body, status, created_at, updated_at, audit) "
                "VALUES (%s, %s, %s, %s, %s, 'draft', %s, %s, %s::jsonb)",
                (content_id, member["company"]["company_id"], member["user"]["user_id"], title, body, moment, moment, audit_text),
            )
        else:
            cur.execute(
                "INSERT INTO auth_content (content_id, company_id, creator_user_id, title, body, status, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, 'draft', %s, %s)",
                (content_id, member["company"]["company_id"], member["user"]["user_id"], title, body, moment, moment),
            )
        return _get(cur, member, content_id)


def _why_not(cur, member: dict, content_id: str, allowed: list, action: str):
    """A conditional UPDATE matched nothing: say why, without revealing other companies' content."""
    item = _get(cur, member, content_id)  # 404 if it is not visible to this member
    raise ServiceError(409, f"This content is '{item['status']}', so it cannot be {action}. Allowed from: {', '.join(allowed)}.")


def update_content(member: dict, content_id: str, title: str, body: str, audit=None) -> dict:
    """Creator edits their own draft / returned content. Editing approved content needs approval again."""
    _need(member, "creator")
    content_id = _content_id(content_id)
    title, body = _clean(title, body)
    audit_text = _audit_json(audit)
    with transaction() as cur:
        set_audit = ", audit = %s::jsonb" if has_audit_column(cur) and audit is not None else ""
        args = [title, body, now()] + ([audit_text] if set_audit else [])
        cur.execute(
            "UPDATE auth_content SET title = %s, body = %s, updated_at = %s" + set_audit + ", "
            "status = CASE WHEN status = 'approved' THEN 'draft' ELSE status END "
            "WHERE content_id = %s AND company_id = %s AND creator_user_id = %s AND status = ANY(%s::text[]) RETURNING content_id",
            (*args, content_id, member["company"]["company_id"], member["user"]["user_id"], EDITABLE),
        )
        if not cur.fetchone():
            _why_not(cur, member, content_id, EDITABLE, "edited")
        return _get(cur, member, content_id)


def _move(cur, member, content_id, allowed: list, new_status: str, action: str, owner_only: bool):
    owner = " AND creator_user_id = %s" if owner_only else ""
    args = [new_status, now(), content_id, member["company"]["company_id"]] + ([member["user"]["user_id"]] if owner_only else []) + [allowed]
    cur.execute(
        "UPDATE auth_content SET status = %s, updated_at = %s WHERE content_id = %s AND company_id = %s" + owner + " AND status = ANY(%s::text[]) RETURNING content_id",
        tuple(args),
    )
    if not cur.fetchone():
        _why_not(cur, member, content_id, allowed, action)


def submit_content(member: dict, content_id: str) -> dict:
    _need(member, "creator")
    content_id = _content_id(content_id)
    with transaction() as cur:
        _move(cur, member, content_id, SUBMITTABLE, "pending_manager", "submitted", owner_only=True)
        return _get(cur, member, content_id)


def publish_content(member: dict, content_id: str) -> dict:
    """Only the creator who owns it, and only once it is approved."""
    _need(member, "creator")
    content_id = _content_id(content_id)
    with transaction() as cur:
        _move(cur, member, content_id, ["approved"], "published", "published", owner_only=True)
        return _get(cur, member, content_id)


# --------------------------------------------------------------------------- reviewers
def _review(member: dict, content_id: str, decision: str, comments: str, role: str, decisions: dict, from_status: str) -> dict:
    _need(member, role)
    content_id = _content_id(content_id)
    decision = str(decision or "").strip().lower()
    if decision not in decisions:
        raise ServiceError(422, f"Decision must be one of: {', '.join(decisions)}.")
    comments = str(comments or "").strip()
    if len(comments) > MAX_COMMENTS:
        raise ServiceError(422, f"Comments are longer than {MAX_COMMENTS} characters.")
    if decision in ("rejected", "changes_requested") and not comments:
        raise ServiceError(422, "Add a comment so the creator knows what to change.")
    with transaction() as cur:
        # status change and approval record are written together, or not at all
        _move(cur, member, content_id, [from_status], decisions[decision], "reviewed", owner_only=False)
        cur.execute(
            "INSERT INTO auth_approval_records (approval_id, content_id, reviewer_user_id, reviewer_role, decision, comments, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (str(uuid.uuid4()), content_id, member["user"]["user_id"], role, decision, comments or None, now()),
        )
        return _get(cur, member, content_id)


def manager_review(member: dict, content_id: str, decision: str, comments: str = "") -> dict:
    """Manager: approve directly, send to legal, reject or request changes. Only while it waits for the manager."""
    return _review(member, content_id, decision, comments, "manager", MANAGER_DECISIONS, "pending_manager")


def legal_review(member: dict, content_id: str, decision: str, comments: str = "") -> dict:
    """Legal approver: only content a manager sent to legal, and only the legal approver can decide it."""
    return _review(member, content_id, decision, comments, "legal_approver", LEGAL_DECISIONS, "pending_legal")
