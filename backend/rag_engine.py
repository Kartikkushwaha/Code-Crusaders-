import os
import io
from pathlib import Path
from dotenv import load_dotenv
from pypdf import PdfReader
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
from langchain_qdrant import QdrantVectorStore

env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Ultra-lightweight ONNX runtime (~30-50MB RAM only)
embeddings = FastEmbedEmbeddings(model_name="BAAI/bge-small-en-v1.5")

def index_policy_bytes(pdf_bytes: bytes):
    """Parses PDF bytes in-memory and builds an ultra-low-memory vector store."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    docs = []
    
    for idx, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        if page_text.strip():
            docs.append(Document(page_content=page_text, metadata={"page": idx + 1}))

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=600,
        chunk_overlap=100
    )
    split_docs = text_splitter.split_documents(docs)

    vectorstore = QdrantVectorStore.from_documents(
        split_docs,
        embeddings,
        location=":memory:",
        collection_name="dynamic_company_policies"
    )
    return vectorstore

def retrieve_policy_context(vectorstore, query_text: str, k: int = 4):
    retrieved_docs = vectorstore.similarity_search(query_text, k=k)
    context_chunks = []
    for doc in retrieved_docs:
        page_num = doc.metadata.get("page", 1)
        context_chunks.append(f"[Page {page_num}]: {doc.page_content}")
    return "\n\n".join(context_chunks)
