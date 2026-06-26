from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from database import get_client, get_embedder
from services.retriever import retrieve_chunks
from config import settings
from groq import Groq
import json
import os

router = APIRouter()
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))


class AskRequest(BaseModel):
    doc_id: str
    question: str


def format_context(chunks: list[dict]) -> str:
    """Format retrieved chunks into a numbered context block for the LLM."""
    context = ""
    for i, chunk in enumerate(chunks, 1):
        context += f"[Chunk {i} | Score: {chunk['score']}]\n{chunk['text']}\n\n"
    return context.strip()


def build_prompt(question: str, context: str) -> str:
    return f"""You are DocuMind, a precise document assistant.
Answer the question using ONLY the context provided below.
If the answer is not in the context, say "I couldn't find that in the document."
Always cite which chunk(s) you used at the end of your answer.

CONTEXT:
{context}

QUESTION:
{question}

ANSWER:"""


async def stream_answer(question: str, chunks: list[dict]):
    """
    Stream the LLM response token by token using Groq's streaming API.
    Yields Server-Sent Events (SSE) format so the frontend can consume
    the stream incrementally — user sees words appear as they're generated.
    """
    context = format_context(chunks)
    prompt = build_prompt(question, context)

    # First yield the source chunks so frontend can show citations immediately
    yield f"data: {json.dumps({'type': 'sources', 'chunks': chunks})}\n\n"

    # Stream the LLM response
    stream = groq_client.chat.completions.create(
        model=settings.groq_smart_model,
        messages=[{"role": "user", "content": prompt}],
        stream=True,
        max_tokens=1024,
        temperature=0.2,   # Low temp — we want factual, not creative
    )

    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield f"data: {json.dumps({'type': 'token', 'content': delta})}\n\n"

    # Signal stream is complete
    yield f"data: {json.dumps({'type': 'done'})}\n\n"


@router.post("/ask")
async def ask_question(request: AskRequest):
    """
    Retrieve relevant chunks for the question, stream the answer back.
    Response is Server-Sent Events — frontend reads tokens as they arrive.
    """
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    chunks = retrieve_chunks(
        query=request.question,
        doc_id=request.doc_id,
        client=get_client(),
        embedder=get_embedder(),
        collection_name=settings.collection_name,
        top_k=5,
    )

    if not chunks:
        raise HTTPException(
            status_code=404,
            detail="No relevant content found. Make sure the document is uploaded."
        )

    return StreamingResponse(
        stream_answer(request.question, chunks),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # Prevents nginx from buffering the stream
        },
    )