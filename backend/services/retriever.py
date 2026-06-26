from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue, QueryRequest
from sentence_transformers import SentenceTransformer
from loguru import logger


def retrieve_chunks(
    query: str,
    doc_id: str,
    client: QdrantClient,
    embedder: SentenceTransformer,
    collection_name: str,
    top_k: int = 5,
) -> list[dict]:
    logger.info(f"Retrieving top {top_k} chunks for query: '{query[:60]}...'")

    query_vector = embedder.encode(query).tolist()

    results = client.query_points(
        collection_name=collection_name,
        query=query_vector,
        query_filter=Filter(
            must=[FieldCondition(
                key="doc_id",
                match=MatchValue(value=doc_id)
            )]
        ),
        limit=top_k,
        with_payload=True,
    )

    chunks = [
        {
            "text": hit.payload["text"],
            "chunk_index": hit.payload["chunk_index"],
            "filename": hit.payload["filename"],
            "score": round(hit.score, 4),
        }
        for hit in results.points
    ]

    logger.info(f"Retrieved {len(chunks)} chunks, "
                f"top score: {chunks[0]['score'] if chunks else 'N/A'}")
    return chunks
