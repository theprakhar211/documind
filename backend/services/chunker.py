import pymupdf
from loguru import logger


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract raw text from PDF bytes using PyMuPDF."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    logger.info(f"Extracted {len(text)} characters from PDF.")
    return text


def chunk_text(text: str, chunk_size: int = 512, overlap: int = 64) -> list[dict]:
    """
    Split text into overlapping chunks.
    Each chunk is a dict with: text, chunk_index, start_char, end_char.

    Why overlapping? So that sentences split across chunk boundaries
    still appear in at least one complete chunk — preventing retrieval
    from missing context at the edges.
    """
    chunks = []
    start = 0
    index = 0

    while start < len(text):
        end = start + chunk_size

        # Don't cut mid-word — walk back to the nearest space
        if end < len(text):
            while end > start and text[end] not in (" ", "\n"):
                end -= 1

        chunk_text = text[start:end].strip()

        if chunk_text:
            chunks.append({
                "text": chunk_text,
                "chunk_index": index,
                "start_char": start,
                "end_char": end,
            })
            index += 1

        # Move forward by chunk_size minus overlap
        start += chunk_size - overlap

    logger.info(f"Split into {len(chunks)} chunks.")
    return chunks