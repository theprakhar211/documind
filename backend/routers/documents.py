from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from database import get_client, get_embedder
from services.chunker import extract_text_from_pdf, chunk_text
from services.embedder import embed_and_store, delete_document
from config import settings
import uuid

router = APIRouter()


@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """
    Upload a PDF, chunk it, embed it, store in Qdrant.
    Returns a doc_id the frontend uses for all subsequent /ask calls.
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large. Max 10MB.")

    doc_id = str(uuid.uuid4())
    filename = file.filename

    try:
        text = extract_text_from_pdf(pdf_bytes)
        if not text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from PDF.")

        chunks = chunk_text(
            text,
            chunk_size=settings.chunk_size,
            overlap=settings.chunk_overlap,
        )

        count = embed_and_store(
            chunks=chunks,
            doc_id=doc_id,
            filename=filename,
            client=get_client(),
            embedder=get_embedder(),
            collection_name=settings.collection_name,
        )

        return JSONResponse({
            "doc_id": doc_id,
            "filename": filename,
            "chunks_stored": count,
            "message": f"Successfully processed {filename} into {count} chunks.",
        })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")


@router.delete("/document/{doc_id}")
async def remove_document(doc_id: str):
    """Delete all vectors for a document from Qdrant."""
    try:
        delete_document(
            doc_id=doc_id,
            client=get_client(),
            collection_name=settings.collection_name,
        )
        return {"message": f"Document {doc_id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))