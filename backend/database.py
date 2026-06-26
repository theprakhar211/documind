from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from sentence_transformers import SentenceTransformer
from loguru import logger
from config import settings

# Single shared instances — imported everywhere
client: QdrantClient = None
embedder: SentenceTransformer = None


def get_client() -> QdrantClient:
    return client


def get_embedder() -> SentenceTransformer:
    return embedder


async def connect_db():
    global client, embedder

    logger.info("Connecting to Qdrant...")
    client = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
    )

    existing = [c.name for c in client.get_collections().collections]
    if settings.collection_name not in existing:
        client.create_collection(
            collection_name=settings.collection_name,
            vectors_config=VectorParams(
                size=384,
                distance=Distance.COSINE,
            ),
        )
        logger.info(f"Created collection: {settings.collection_name}")
    else:
        logger.info(f"Collection already exists: {settings.collection_name}")

    # Create payload index on doc_id for filtered search
    from qdrant_client.models import PayloadSchemaType
    client.create_payload_index(
        collection_name=settings.collection_name,
        field_name="doc_id",
        field_schema=PayloadSchemaType.KEYWORD,
    )
    logger.info("Payload index created on doc_id.")

    logger.info("Loading embedding model...")
    embedder = SentenceTransformer(settings.embedding_model)
    logger.info("Embedding model loaded.")


async def close_db():
    global client
    if client:
        client.close()
        logger.info("Qdrant connection closed.")
