from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from sentence_transformers import SentenceTransformer
from loguru import logger
import uuid


def embed_and_store(
    chunks: list[dict],
    doc_id: str,
    filename: str,
    client: QdrantClient,
    embedder: SentenceTransformer,
    collection_name: str,
) -> int:
    """
    Convert chunks to vectors and store in Qdrant.
    Returns number of chunks stored.

    Each point in Qdrant has:
    - id: unique UUID
    - vector: 384-dim embedding of the chunk text
    - payload: the original text + metadata (for retrieval)
    """
    texts = [chunk["text"] for chunk in chunks]

    logger.info(f"Embedding {len(texts)} chunks...")
    vectors = embedder.encode(texts, show_progress_bar=False).tolist()

    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload={
                "text": chunk["text"],
                "chunk_index": chunk["chunk_index"],
                "doc_id": doc_id,
                "filename": filename,
            },
        )
        for chunk, vector in zip(chunks, vectors)
    ]

    client.upsert(collection_name=collection_name, points=points)
    logger.info(f"Stored {len(points)} vectors in Qdrant.")
    return len(points)


def delete_document(
    doc_id: str,
    client: QdrantClient,
    collection_name: str,
) -> None:
    """Delete all vectors belonging to a document by doc_id."""
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    client.delete(
        collection_name=collection_name,
        points_selector=Filter(
            must=[FieldCondition(
                key="doc_id",
                match=MatchValue(value=doc_id)
            )]
        ),
    )
    logger.info(f"Deleted all vectors for doc_id: {doc_id}")