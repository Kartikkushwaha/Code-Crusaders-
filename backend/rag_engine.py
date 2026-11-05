"""Approved-source retrieval: LangChain + in-memory Qdrant + Gemini embeddings.

Lightweight for Render's 512 MB tier:
- embeddings come from the Gemini API (no local ONNX/torch model in RAM);
- Qdrant runs in-process (":memory:"), so there is no extra service;
- indexes are cached by content hash, so the default guidelines are embedded once per process;
- if embeddings fail, retrieval degrades to the full approved text, so the audit still runs.
"""
import hashlib
import logging
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import config

log = logging.getLogger("publivra.rag")

_CACHE = OrderedDict()
_CACHE_MAX = 3
_LOCK = threading.Lock()
_embeddings = None
_EXECUTOR = ThreadPoolExecutor(max_workers=1)
_embed_down_until = 0.0  # circuit breaker: skip embeddings for a while after a failure


class Source:
    """A body of approved text (guidelines, policy rules, an uploaded policy document)."""

    def __init__(self, name: str, text: str):
        self.name = name
        self.text = text or ""


def _split_pages(text: str):
    """Honour "[Page n]" markers that the frontend inserts when it extracts a PDF."""
    parts = re.split(r"\[Page (\d+)\]", text)
    if len(parts) == 1:
        return [(None, text)]
    pages = []
    if parts[0].strip():
        pages.append((None, parts[0]))
    for i in range(1, len(parts), 2):
        pages.append((int(parts[i]), parts[i + 1] if i + 1 < len(parts) else ""))
    return pages


def build_chunks(sources, chunk_size=800, overlap=120, max_chunks=150):
    """Split sources into chunks with source/page metadata. Pure Python, easy to test."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=overlap)
    chunks = []
    for src in sources:
        for page, body in _split_pages(src.text):
            if not body.strip():
                continue
            for piece in splitter.split_text(body):
                chunks.append({"text": piece, "source": src.name, "page": page})
                if len(chunks) >= max_chunks:
                    return chunks
    return chunks


def label(chunk) -> str:
    return f"{chunk['source']}" + (f", p.{chunk['page']}" if chunk.get("page") else "")


def _get_embeddings():
    global _embeddings
    if _embeddings is None:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        try:
            _embeddings = GoogleGenerativeAIEmbeddings(model=config.EMBEDDING_MODEL, google_api_key=config.GOOGLE_API_KEY, max_retries=1)
        except TypeError:  # older versions without max_retries
            _embeddings = GoogleGenerativeAIEmbeddings(model=config.EMBEDDING_MODEL, google_api_key=config.GOOGLE_API_KEY)
    return _embeddings


def _build_store(chunks):
    from langchain_core.documents import Document
    from langchain_qdrant import QdrantVectorStore

    docs = [Document(page_content=c["text"], metadata={"source": c["source"], "page": c["page"]}) for c in chunks]
    return QdrantVectorStore.from_documents(
        docs,
        _get_embeddings(),
        location=":memory:",
        collection_name="publivra_approved_sources",
    )


def _queries(document_text: str, max_queries=5, window=1500):
    text = document_text.strip()
    if len(text) <= window:
        return [text] if text else []
    step = max(window, len(text) // max_queries)
    return [text[i : i + window] for i in range(0, len(text), step)][:max_queries]


def retrieve(sources, document_text: str):
    """Return (context_text, retrieval_info). Never raises."""
    chunks = build_chunks(sources)
    if not chunks:
        return "", {"mode": "none", "chunks": 0, "sources": []}

    def full_context(reason):
        picked = chunks[: config.RAG_MAX_CONTEXT_CHUNKS * 2]
        ctx = "\n\n".join(f"[{label(c)}]: {c['text']}" for c in picked)
        return ctx, {
            "mode": "full-context",
            "reason": reason,
            "chunks": len(picked),
            "sources": sorted({label(c) for c in picked}),
        }

    global _embed_down_until
    if not config.GOOGLE_API_KEY:
        return full_context("no embedding key (GOOGLE_API_KEY)")
    if time.time() < _embed_down_until:
        return full_context("embeddings paused after a recent failure")

    key = hashlib.sha256(("|".join(f"{c['source']}{c['page']}{c['text']}" for c in chunks) + config.EMBEDDING_MODEL).encode()).hexdigest()
    try:
        with _LOCK:
            store = _CACHE.get(key)
            if store is None:
                # Bounded wait so a busy embedding API never stalls the audit.
                store = _EXECUTOR.submit(_build_store, chunks).result(timeout=config.EMBED_TIMEOUT_SECONDS)
                _CACHE[key] = store
                while len(_CACHE) > _CACHE_MAX:
                    _CACHE.popitem(last=False)
            else:
                _CACHE.move_to_end(key)

        seen, picked = set(), []
        for q in _queries(document_text):
            for doc in store.similarity_search(q, k=config.RAG_TOP_K):
                sig = (doc.metadata.get("source"), doc.metadata.get("page"), doc.page_content[:80])
                if sig in seen:
                    continue
                seen.add(sig)
                picked.append({"text": doc.page_content, "source": doc.metadata.get("source"), "page": doc.metadata.get("page")})
                if len(picked) >= config.RAG_MAX_CONTEXT_CHUNKS:
                    break
            if len(picked) >= config.RAG_MAX_CONTEXT_CHUNKS:
                break
        ctx = "\n\n".join(f"[{label(c)}]: {c['text']}" for c in picked)
        return ctx, {"mode": "qdrant", "chunks": len(picked), "indexed": len(chunks), "sources": sorted({label(c) for c in picked})}
    except Exception as exc:  # network / overload / quota / timeout
        _embed_down_until = time.time() + 300
        reason = "embedding timeout" if exc.__class__.__name__ == "TimeoutError" else f"embedding error: {str(exc)[:160]}"
        log.warning("Qdrant retrieval failed, using full approved context for 5 min: %s", reason)
        return full_context(reason)


# --- Backwards-compatible helpers used by the original endpoints -------------
def index_policy_bytes(pdf_bytes: bytes):
    """Kept for compatibility: returns approved-source chunks from a policy PDF."""
    import io

    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = "".join(f"[Page {i + 1}]{p.extract_text() or ''}\n" for i, p in enumerate(reader.pages))
    return [Source("Uploaded policy", text)]


def retrieve_policy_context(sources, query_text: str, k: int = 4):
    ctx, _ = retrieve(sources, query_text)
    return ctx
