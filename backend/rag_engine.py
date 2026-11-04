import os
from pathlib import Path
from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore

env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Zero API calls, no 404 endpoint errors, super fast local embedding
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

def index_policy_document(pdf_path: str):
    loader = PyPDFLoader(pdf_path)
    pages = loader.load()

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=600,
        chunk_overlap=100
    )
    docs = text_splitter.split_documents(pages)

    vectorstore = QdrantVectorStore.from_documents(
        docs,
        embeddings,
        location=":memory:",
        collection_name="company_policies"
    )
    return vectorstore

def retrieve_policy_context(vectorstore, query_text: str, k: int = 4):
    retrieved_docs = vectorstore.similarity_search(query_text, k=k)
    context_chunks = []
    for doc in retrieved_docs:
        page_num = doc.metadata.get("page", 0) + 1
        context_chunks.append(f"[Page {page_num}]: {doc.page_content}")
    return "\n\n".join(context_chunks)