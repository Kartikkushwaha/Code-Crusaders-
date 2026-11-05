import os
import io
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader
import psycopg2
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

# Fix: Import index_policy_bytes instead of index_policy_document
from rag_engine import index_policy_bytes, retrieve_policy_context
from brand_engine import evaluate_brand_compliance

# Load environment configuration
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

app = FastAPI(
    title="CodeNexus Compliance & Brand Audit API",
    version="2.0",
    description="Automated enterprise policy validation and brand integrity engine."
)

# CORS Middleware Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_BRAND_GUIDELINES = """
[BRAND TONE & IDENTITY RULES]
1. Tonality: Must remain objective, professional, and fact-driven. Avoid sensationalism or marketing hyperbole (e.g., 'revolutionary', 'best-in-the-world', '100% bug-free').
2. Terminology:
   - Approved: 'AI-assisted solution', 'Enterprise partner', 'Compliance framework'.
   - Restricted: 'Magic AI', 'Cheap service', 'Guaranteed instant results'.
3. Verification & Claims:
   - Performance metrics and turnaround timelines must reference verifiable empirical benchmarks.
   - Absolute liability exemptions or unbacked performance assurances are strictly prohibited.
"""

class ComplianceReport(BaseModel):
    is_compliant: bool = Field(description="True if document complies with policy, False otherwise.")
    violations: list[str] = Field(description="List of specific violations found.")
    source_references: list[str] = Field(description="Policy clauses/pages violated.")
    summary: str = Field(description="Evaluation summary.")

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    api_key=os.getenv("GOOGLE_API_KEY"),
    temperature=0.0
)
structured_compliance_llm = llm.with_structured_output(ComplianceReport)

compliance_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are an automated Compliance Auditor. Match the document strictly against the provided policy context.\n"
               "If ANY rule is violated, mark is_compliant as False and itemize the violation.\n\n"
               "POLICY CONTEXT:\n{policy}"),
    ("human", "DOCUMENT CONTENT:\n{document}")
])

compliance_chain = compliance_prompt | structured_compliance_llm

def get_db():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME", "codenexus_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
        sslmode="require"
    )

@app.get("/")
def health_check():
    return {"status": "healthy", "service": "CodeNexus Compliance & Brand Audit Engine"}

@app.post("/api/audit-document")
async def audit_document(
    document_file: UploadFile = File(..., description="Target document to verify"),
    policy_file: UploadFile = File(..., description="Company policy PDF to check against")
):
    if not document_file.filename.endswith(".pdf") or not policy_file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Both uploaded files must be valid PDF documents.")

    doc_bytes = await document_file.read()
    policy_bytes = await policy_file.read()

    reader = PdfReader(io.BytesIO(doc_bytes))
    extracted_text = "\n".join([page.extract_text() or "" for page in reader.pages]).strip()

    if not extracted_text:
        raise HTTPException(status_code=400, detail="Target document contains no readable text.")

    try:
        temp_vectorstore = index_policy_bytes(policy_bytes)
        matched_policy_clauses = retrieve_policy_context(temp_vectorstore, extracted_text[:2000])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Policy vector indexing error: {str(e)}")

    try:
        report: ComplianceReport = compliance_chain.invoke({
            "policy": matched_policy_clauses,
            "document": extracted_text
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM processing error: {str(e)}")

    status = "COMPLIANT" if report.is_compliant else "NON_COMPLIANT"
    violations_str = "\n".join(report.violations) if report.violations else "None"

    audit_id = "N/A"
    created_at = "Live Session"

    # PostgreSQL logging with safe bypass if DB is not configured in Render
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO document_compliance (filename, extracted_text, is_compliant, status, violations)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at;
            """,
            (document_file.filename, extracted_text, report.is_compliant, status, violations_str)
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        audit_id = row[0]
        created_at = str(row[1])
    except Exception as db_err:
        print(f"⚠️ Database logging bypassed: {db_err}")

    return {
        "audit_id": audit_id,
        "filename": document_file.filename,
        "policy_used": policy_file.filename,
        "status": status,
        "is_compliant": report.is_compliant,
        "warning_triggered": not report.is_compliant,
        "violations": report.violations,
        "source_references": report.source_references,
        "summary": report.summary,
        "created_at": created_at
    }

@app.post("/api/audit-document")
async def audit_document(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    doc_bytes = await file.read()
    reader = PdfReader(io.BytesIO(doc_bytes))
    extracted_text = "\n".join([page.extract_text() or "" for page in reader.pages]).strip()

    if not extracted_text:
        raise HTTPException(status_code=400, detail="Target document contains no readable text.")

    # Static / Default enterprise policy rules
    policy_context = (
        "Clause 1 (Data Privacy & PII): Documents must strictly forbid unauthorized exposure of personal identifiable information (PII), secret tokens, or customer credentials.\n"
        "Clause 2 (Brand & Performance Claims): Absolute performance claims (e.g., '100% bug-free', 'guaranteed zero downtime') are prohibited without verifiable SLA benchmarks.\n"
        "Clause 3 (Liability & Compliance): Liability disclaimers and regulatory frameworks must follow standard statutory audit guidelines."
    )

    try:
        report: ComplianceReport = compliance_chain.invoke({
            "policy": policy_context,
            "document": extracted_text
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM processing error: {str(e)}")

    status = "COMPLIANT" if report.is_compliant else "NON_COMPLIANT"
    violations_str = "\n".join(report.violations) if report.violations else "None"

    audit_id = "N/A"
    created_at = "Live Session"

    # PostgreSQL logging
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO document_compliance (filename, extracted_text, is_compliant, status, violations)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at;
            """,
            (file.filename, extracted_text, report.is_compliant, status, violations_str)
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        audit_id = row[0]
        created_at = str(row[1])
    except Exception as db_err:
        print(f"⚠️ Database logging warning: {db_err}")

    return {
        "audit_id": audit_id,
        "filename": file.filename,
        "status": status,
        "is_compliant": report.is_compliant,
        "warning_triggered": not report.is_compliant,
        "violations": report.violations,
        "source_references": report.source_references,
        "summary": report.summary,
        "created_at": created_at
    }