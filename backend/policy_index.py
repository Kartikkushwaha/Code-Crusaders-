"""Line numbering for policy text, and mapping AI citations back to real policy lines.

Numbering MUST match frontend/src/lib/policyLines.js so a reference like "p.2 L14" opens
the same line in the dashboard's policy viewer:
split on "[Page n]" markers, then on newlines; collapse whitespace; skip empty lines;
number from 1 within each page.
"""
import difflib
import re


def number_policy(text: str, source: str = "Policy"):
    out = []
    if not text:
        return out
    parts = re.split(r"\[Page (\d+)\]", text)
    pages = []
    if len(parts) == 1:
        pages.append((None, text))
    else:
        if parts[0].strip():
            pages.append((None, parts[0]))
        for i in range(1, len(parts), 2):
            pages.append((int(parts[i]), parts[i + 1] if i + 1 < len(parts) else ""))
    for page, body in pages:
        n = 0
        for raw in body.split("\n"):
            line = re.sub(r"\s+", " ", raw).strip()
            if not line:
                continue
            n += 1
            out.append({"source": source, "page": page, "line": n, "text": line})
    return out


def label(entry) -> str:
    return (f"p.{entry['page']} " if entry.get("page") else "") + f"L{entry['line']}"


def numbered_text(lines) -> str:
    return "\n".join(f"[{label(l)}] {l['text']}" for l in lines)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9%]+", " ", (s or "").lower()).strip()


def find_ref(index, quote: str = "", hint: str = ""):
    """Locate the policy line an AI finding cites. Quote match first, then the label hint.

    Returns {source, page, line, text, verified} or None. verified=True means the quote
    really appears in that policy line (so the citation can be trusted).
    """
    if not index:
        return None
    q = _norm(quote)
    if len(q) >= 6:
        for e in index:
            t = _norm(e["text"])
            if q in t or (len(t) >= 12 and t in q):
                return {**e, "verified": True}
        best, score = None, 0.0
        for e in index:
            t = _norm(e["text"])
            if not t:
                continue
            sm = difflib.SequenceMatcher(None, q, t)
            if sm.real_quick_ratio() < 0.5:
                continue
            r = sm.ratio()
            if r > score:
                best, score = e, r
        if best and score >= 0.6:
            return {**best, "verified": score >= 0.8}
    m_line = re.search(r"L(?:ine)?\.?\s*(\d+)", hint or "", re.I)
    if m_line:
        m_page = re.search(r"p(?:age)?\.?\s*(\d+)", hint, re.I)
        page = int(m_page.group(1)) if m_page else None
        line = int(m_line.group(1))
        hint_low = (hint or "").lower()
        candidates = [e for e in index if e["line"] == line and (page is None or e["page"] == page)]
        named = [e for e in candidates if e["source"].lower() in hint_low]
        pick = (named or candidates or [None])[0]
        if pick:
            return {**pick, "verified": False}
    return None
