"""/api/workflow endpoints. Every route needs a signed-in member; roles are enforced on the server."""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth.db import ServiceError
from auth.routes import current_member, http_error, require_role
from workflow import services

router = APIRouter(prefix="/api/workflow", tags=["workflow"])


class ContentIn(BaseModel):
    title: str = Field(..., max_length=400)
    body: str
    audit: Optional[dict] = None  # the creator's audit summary (stored only if migration 002 was run)


class Decision(BaseModel):
    decision: str
    comments: str = ""


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ServiceError as exc:
        raise http_error(exc)


@router.post("/content", status_code=201)
def create_content(body: ContentIn, member: dict = Depends(require_role("creator"))):
    """Creator: create content as a draft."""
    return _run(services.create_content, member, body.title, body.body, body.audit)


@router.get("/content")
def list_content(status: str = "", limit: int = 100, member: dict = Depends(current_member)):
    """Own company only. Creator: own content. Manager: everything submitted. Legal: what was sent to legal."""
    return {"role": member["role"], "items": _run(services.list_content, member, status, limit)}


@router.get("/content/{content_id}")
def get_content(content_id: str, member: dict = Depends(current_member)):
    return _run(services.get_content, member, content_id)


@router.put("/content/{content_id}")
def update_content(content_id: str, body: ContentIn, member: dict = Depends(require_role("creator"))):
    """Creator: edit own draft or returned content (editing approved content sends it back to draft)."""
    return _run(services.update_content, member, content_id, body.title, body.body, body.audit)


@router.post("/content/{content_id}/submit")
def submit_content(content_id: str, member: dict = Depends(require_role("creator"))):
    return _run(services.submit_content, member, content_id)


@router.post("/content/{content_id}/manager-review")
def manager_review(content_id: str, body: Decision, member: dict = Depends(require_role("manager"))):
    """Manager: approved | sent_to_legal | rejected | changes_requested."""
    return _run(services.manager_review, member, content_id, body.decision, body.comments)


@router.post("/content/{content_id}/legal-review")
def legal_review(content_id: str, body: Decision, member: dict = Depends(require_role("legal_approver"))):
    """Legal approver: approved | rejected | changes_requested."""
    return _run(services.legal_review, member, content_id, body.decision, body.comments)


@router.post("/content/{content_id}/publish")
def publish_content(content_id: str, member: dict = Depends(require_role("creator"))):
    """Creator: publish own content, only after final approval."""
    return _run(services.publish_content, member, content_id)
