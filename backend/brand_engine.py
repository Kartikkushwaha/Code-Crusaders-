import os
from pathlib import Path
from typing import List, Literal
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

# Load environment configuration
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# --- Structured Schema for Brand Audit ---
class ClaimAuditItem(BaseModel):
    claim_text: str = Field(
        description="The exact claim, statistic, or statement extracted from the document."
    )
    category: Literal["Fact/Metric", "Terminology", "Tone/Persona"] = Field(
        description="Category classification of the analyzed statement."
    )
    verdict: Literal["VERIFIED", "CONTRADICTED", "UNVERIFIED"] = Field(
        description="Audit verdict: VERIFIED (adheres to standards), CONTRADICTED (violates guidelines), or UNVERIFIED (lacks empirical evidence)."
    )
    explanation: str = Field(
        description="Technical justification citing the relevant guideline."
    )

class BrandAuditReport(BaseModel):
    overall_tone_score: str = Field(
        description="Evaluation of overall tonality (e.g., Professional, Exaggerated, Casual)."
    )
    claims_evaluation: List[ClaimAuditItem] = Field(
        description="Granular assessment of every identified claim or key statement."
    )
    forbidden_terms_found: List[str] = Field(
        description="List of unapproved vocabulary, colloquialisms, or banned buzzwords found."
    )
    recommendations: List[str] = Field(
        description="Actionable editorial recommendations to ensure brand alignment."
    )

# Model initialization
llm = ChatGoogleGenerativeAI(
    model="gemini-3.5-flash",
    api_key=os.getenv("GOOGLE_API_KEY"),
    temperature=0.0
)

structured_brand_llm = llm.with_structured_output(BrandAuditReport)

brand_prompt = ChatPromptTemplate.from_messages([
    ("system", 
     "You are an enterprise Brand Audit and Fact-Checking Engine.\n"
     "Evaluate the provided document strictly against the corporate Brand Guidelines.\n"
     "Tasks:\n"
     "1. Extract all performance metrics, guarantees, and marketing statements.\n"
     "2. Assign a strict verdict to each claim: VERIFIED, CONTRADICTED, or UNVERIFIED.\n"
     "3. Detect forbidden vocabulary, unapproved buzzwords, or inappropriate persona.\n"
     "4. Formulate professional editorial recommendations.\n\n"
     "BRAND GUIDELINES:\n{guidelines}"),
    ("human", "DOCUMENT TEXT TO AUDIT:\n{document_text}")
])

brand_audit_chain = brand_prompt | structured_brand_llm

def evaluate_brand_compliance(document_text: str, guidelines_text: str) -> BrandAuditReport:
    """Executes the brand audit pipeline using structured LLM output."""
    return brand_audit_chain.invoke({
        "guidelines": guidelines_text,
        "document_text": document_text
    })