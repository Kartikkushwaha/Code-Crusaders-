"""Command-line audit (the original compliance_checker.py, now using the shared engine and Neon).

Usage (from the backend folder):
    python tools/compliance_checker.py check.pdf [policy.pdf]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pypdf import PdfReader  # noqa: E402

import audit_service  # noqa: E402
import database  # noqa: E402


def pdf_text(path: Path, with_pages=False) -> str:
    reader = PdfReader(str(path))
    return "\n".join((f"[Page {i + 1}]\n" if with_pages else "") + (p.extract_text() or "") for i, p in enumerate(reader.pages)).strip()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    target = Path(sys.argv[1])
    policy = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if not target.exists():
        sys.exit(f"Error: target file not found: {target}")
    if policy and not policy.exists():
        sys.exit(f"Error: policy file not found: {policy}")

    database.init_db()
    print(f"[1/3] Extracting text from {target.name}...")
    text = pdf_text(target)
    policy_doc = {"name": policy.name, "text": pdf_text(policy, with_pages=True)} if policy else None

    print("[2/3] Retrieving approved sources and auditing with Gemini...")
    result = audit_service.audit_text(text=text, title=target.name, source="cli", policy_document=policy_doc)

    print(f"[3/3] Neon record: {result['audit_id'] or 'not logged'}\n")
    print("=" * 60)
    print(f"{result['risk_level']} RISK  ·  {result['status']}  ·  tone {result['overall_tone']} ({result['tone_score']}/10)")
    print(f"Model: {result['model']}  ·  Retrieval: {result['retrieval']['mode']}")
    print("-" * 60)
    for f in result["findings"]:
        print(f"[{f['verdict']:<12}] {f['claim_text']}\n    {f['explanation']} (source: {f['source_reference']})")
    print("-" * 60)
    print(f"Summary: {result['summary']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
