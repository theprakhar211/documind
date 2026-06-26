from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    groq_api_key: str
    qdrant_url: str
    qdrant_api_key: str
    collection_name: str = "documind"
    environment: str = "development"

    # Chunking config
    chunk_size: int = 512
    chunk_overlap: int = 64

    # Embedding model
    embedding_model: str = "all-MiniLM-L6-v2"

    # Groq models
    groq_smart_model: str = "llama-3.3-70b-versatile"
    groq_fast_model: str = "llama-3.1-8b-instant"

    class Config:
        env_file = ".env"


settings = Settings()