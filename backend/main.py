"""PUBLIVRA AI - FastAPI backend.

Run locally:   uvicorn main:app --reload --port 8000
Render start:  uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1
"""
import io
import logging
import threading
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import audit_service
import config
import database

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("publivra.api")

VERSION = "2.1.0"


@asynccontextmanager
async def lifespan(_app):
    # Create/upgrade Neon tables in the background so a slow DB never blocks boot.
    threading.Thread(target=database.init_db, daemon=True).start()
    yield


app = FastAPI(
    title="PUBLIVRA AI - Compliance & Brand Audit API",
    version=VERSION,
    description="Evidence-based brand compliance: Qdrant retrieval over approved sources + LLM structured audits (Groq, Gemini fallback), logged to Neon.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials="*" not in config.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- models
class PolicyDocument(BaseModel):
    name: str = "Uploaded policy"
    text: str = ""


class AuditRequest(BaseModel):
    text: str = Field(..., description="Plain text of the document (one block per line).")
    title: str = "Untitled document"
    source: str = "editor"
    policy_rules: str = ""
    policy_document: Optional[PolicyDocument] = None
    tone_profile: str = "Professional"


class PublicationRequest(BaseModel):
    audit_id: Optional[int] = None
    title: str
    file_name: str = ""
    risk_level: str
    risk_score: int = 0
    overridden: bool = False
    counts: dict = {}


class VerifyRequest(BaseModel):
    approver_name: str
    approver_role: str
    checklist: List[str] = []


class EventRequest(BaseModel):
    actor: str = "Human"
    action: str
    detail: str = ""
    audit_id: Optional[int] = None
    publication_id: Optional[int] = None


# --------------------------------------------------------------------------- helpers
def _pdf_text(raw: bytes, with_pages: bool = False) -> str:
    from pypdf import PdfReader

    if len(raw) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than the 10 MB limit.")
    try:
        reader = PdfReader(io.BytesIO(raw))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the PDF file.")
    parts = []
    for i, page in enumerate(reader.pages):
        t = page.extract_text() or ""
        parts.append(f"[Page {i + 1}]\n{t}" if with_pages else t)
    return "\n".join(parts).strip()


def _run_audit(**kwargs):
    try:
        return audit_service.audit_text(**kwargs)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("AI audit failed")
        raise HTTPException(status_code=502, detail=f"AI audit failed: {str(exc)[:300]}")


# --------------------------------------------------------------------------- routes
@app.get("/")
@app.get("/api/health")
def health():
    chain = config.llm_chain()
    return {
        "status": "healthy",
        "service": "PUBLIVRA AI Engine",
        "version": VERSION,
        "ai": {
            "configured": bool(chain),
            "model": f"{chain[0][1]} ({chain[0][0]})" if chain else None,
            "chain": [f"{p}/{m}" for p, m in chain],
            "embedding_model": config.EMBEDDING_MODEL if config.GOOGLE_API_KEY else None,
        },
        "database": database.status(),
    }


@app.post("/api/audit")
def audit(req: AuditRequest):
    """Main endpoint used by the dashboard: text in, evidence-backed findings out."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Document text is empty.")
    return _run_audit(
        text=req.text,
        title=req.title,
        source=req.source,
        policy_rules=req.policy_rules,
        policy_document=req.policy_document.model_dump() if req.policy_document else None,
        tone_profile=req.tone_profile,
    )


@app.post("/api/audit-document")
def audit_document(
    document_file: UploadFile = File(None, description="Target document PDF"),
    file: UploadFile = File(None, description="Legacy field name for the target PDF"),
    policy_file: UploadFile = File(None, description="Optional policy PDF to check against"),
):
    """Original PDF endpoint (kept for compatibility). Response shape unchanged."""
    target = document_file or file
    if target is None or not (target.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload the target document as a PDF.")
    text = _pdf_text(target.file.read())
    if not text:
        raise HTTPException(status_code=400, detail="Target document contains no readable text.")

    policy_doc, policy_name = None, "Default Global Policy"
    if policy_file is not None and (policy_file.filename or "").lower().endswith(".pdf"):
        policy_doc = {"name": policy_file.filename, "text": _pdf_text(policy_file.file.read(), with_pages=True)}
        policy_name = policy_file.filename

    result = _run_audit(text=text, title=target.filename, source="pdf-upload", policy_document=policy_doc)
    contradicted = [f for f in result["findings"] if f["verdict"] == "CONTRADICTED"]
    return {
        "audit_id": result["audit_id"] or "N/A",
        "filename": target.filename,
        "policy_used": policy_name,
        "status": result["status"],
        "is_compliant": result["is_compliant"],
        "warning_triggered": not result["is_compliant"],
        "violations": [f"{f['claim_text']}: {f['explanation']}" for f in contradicted],
        "source_references": sorted({f["source_reference"] for f in contradicted}),
        "summary": result["summary"],
        "risk_level": result["risk_level"],
        "created_at": result["created_at"] or "Live Session",
    }


@app.post("/api/brand-audit")
def brand_audit(document_file: UploadFile = File(None), file: UploadFile = File(None)):
    """Original brand-tone endpoint (kept for compatibility)."""
    target = document_file or file
    if target is None or not (target.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
    text = _pdf_text(target.file.read())
    if not text:
        raise HTTPException(status_code=400, detail="Target document contains no readable text.")
    result = _run_audit(text=text, title=target.filename, source="pdf-upload")
    return {
        "filename": target.filename,
        "overall_tone": result["overall_tone"],
        "tone_score": result["tone_score"],
        "claims_evaluation": [
            {"claim_text": f["claim_text"], "category": f["category"], "verdict": f["verdict"], "explanation": f["explanation"]}
            for f in result["findings"]
        ],
        "forbidden_terms": result["forbidden_terms"],
        "recommendations": result["recommendations"],
        "audit_id": result["audit_id"],
    }


@app.post("/api/publications")
def create_publication(req: PublicationRequest):
    pub_id, created_at = database.create_publication(
        audit_id=req.audit_id,
        title=req.title,
        file_name=req.file_name,
        risk_level=req.risk_level,
        risk_score=req.risk_score,
        overridden=req.overridden,
        counts=req.counts,
    )
    if pub_id:
        database.log_event(
            actor="Human",
            action="override_publish" if req.overridden else "publish",
            detail=f"{req.title} at {req.risk_level} risk",
            audit_id=req.audit_id,
            publication_id=pub_id,
        )
    return {"id": pub_id, "created_at": created_at, "db_logged": pub_id is not None}


@app.post("/api/publications/{pub_id}/verify")
def verify_publication(pub_id: int, req: VerifyRequest):
    if not req.approver_name.strip():
        raise HTTPException(status_code=400, detail="Approver name is required.")
    row = database.verify_publication(pub_id, approver_name=req.approver_name, approver_role=req.approver_role, checklist=req.checklist)
    if row:
        database.log_event(actor="Human", action="verify_close", detail=f"{req.approver_name} ({req.approver_role})", publication_id=pub_id)
    return {"id": pub_id, "db_logged": row is not None, **(row or {"status": "closed"})}


@app.get("/api/publications")
def list_publications(limit: int = 20):
    return {"items": database.list_publications(max(1, min(limit, 100)))}


@app.get("/api/audits")
def list_audits(limit: int = 20):
    return {"items": database.list_audits(max(1, min(limit, 100)))}


@app.post("/api/events")
def log_event(req: EventRequest):
    event_id = database.log_event(
        actor=req.actor, action=req.action, detail=req.detail, audit_id=req.audit_id, publication_id=req.publication_id
    )
    return {"id": event_id, "db_logged": event_id is not None}
