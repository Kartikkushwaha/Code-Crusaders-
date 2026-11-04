import os
from pathlib import Path
from dotenv import load_dotenv
from pypdf import PdfReader
import psycopg2
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

# Load .env from root directory
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# --- 1. PDF Text Extractor ---
def extract_text_from_pdf(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    full_text = ""
    for page in reader.pages:
        text = page.extract_text()
        if text:
            full_text += text + "\n"
    return full_text.strip()

# --- 2. Structured Output Schema for Compliance ---
class ComplianceReport(BaseModel):
    is_compliant: bool = Field(description="True if document complies with all policy rules, False otherwise.")
    violations: list[str] = Field(description="List of specific violations found. Empty if compliant.")
    summary: str = Field(description="Short summary explaining the evaluation.")

# --- 3. Policy Verifier via LLM ---
def verify_document_compliance(extracted_text: str, company_policy: str) -> ComplianceReport:
    llm = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash",
        api_key=os.getenv("GOOGLE_API_KEY"),
        temperature=0.0
    )
    
    structured_llm = llm.with_structured_output(ComplianceReport)

    prompt = ChatPromptTemplate.from_messages([
        ("system", 
         "You are an automated Compliance Officer. Evaluate the submitted document against the provided Company Policy.\n"
         "If ANY policy rule is broken, mark is_compliant as False and list the violation.\n\n"
         "COMPANY POLICY:\n{policy}"),
        ("human", "DOCUMENT TO EVALUATE:\n{document}")
    ])

    chain = prompt | structured_llm
    report = chain.invoke({"policy": company_policy, "document": extracted_text})
    return report

# --- 4. PostgreSQL Storage Function ---
def save_to_postgres(filename: str, text: str, report: ComplianceReport):
    conn = psycopg2.connect(
        dbname=os.getenv("DB_NAME", "codenexus_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD"),
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432")
    )
    cursor = conn.cursor()

    status = "COMPLIANT" if report.is_compliant else "NON_COMPLIANT"
    violations_text = "\n".join(report.violations) if report.violations else "None"

    insert_query = """
    INSERT INTO document_compliance (filename, extracted_text, is_compliant, status, violations)
    VALUES (%s, %s, %s, %s, %s)
    RETURNING id;
    """
    cursor.execute(insert_query, (filename, text, report.is_compliant, status, violations_text))
    doc_id = cursor.fetchone()[0]
    conn.commit()
    cursor.close()
    conn.close()
    return doc_id

# --- Main Execution Flow ---
if __name__ == "__main__":
    current_dir = Path(__file__).resolve().parent

    policy_pdf_path = current_dir / "policy.pdf"
    check_pdf_path = current_dir / "check.pdf"

    # Files existence check
    if not policy_pdf_path.exists():
        print(f"Error: Policy file nahi mili: {policy_pdf_path.name}")
        exit()

    if not check_pdf_path.exists():
        print(f"Error: Target check file nahi mili: {check_pdf_path.name}")
        exit()

    print(f"[1/4] Extracting policy from {policy_pdf_path.name}...")
    company_policy_text = extract_text_from_pdf(str(policy_pdf_path))

    print(f"[2/4] Extracting document text from {check_pdf_path.name}...")
    document_text = extract_text_from_pdf(str(check_pdf_path))

    print("[3/4] Verifying compliance with Gemini...")
    report = verify_document_compliance(document_text, company_policy_text)

    print("[4/4] Storing in PostgreSQL...")
    saved_id = save_to_postgres(check_pdf_path.name, document_text, report)
    print(f"Record successfully saved in DB with ID: {saved_id}\n")

    print("=" * 45)
    if not report.is_compliant:
        print("⚠️  WARNING: DOCUMENT VIOLATES COMPANY POLICY!")
        print("Status: NON_COMPLIANT")
        print("\nViolations:")
        for idx, v in enumerate(report.violations, 1):
            print(f"  {idx}. {v}")
    else:
        print("✅ SUCCESS: Document is fully compliant with company policy.")
        print("Status: COMPLIANT")
    print(f"\nSummary:\n{report.summary}")
    print("=" * 45)