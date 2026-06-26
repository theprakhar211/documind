# DocuMind — RAG Document Q&A

> **Upload a PDF. Ask anything. Get cited, streaming answers.**

DocuMind is a production-grade Retrieval-Augmented Generation (RAG) system. Upload any PDF, ask questions in natural language, and get answers that stream in token-by-token — with exact source citations showing which passage the answer came from and how relevant it was.

**Stack:** FastAPI · Qdrant · sentence-transformers · Groq · Next.js · Docker

---

## Demo

1. Upload a PDF (research paper, resume, technical doc, textbook chapter)
2. Ask any question about its contents
3. Watch the answer stream in real time
4. Expand source cards to see the exact passages retrieved — with similarity scores

---

## Architecture

```
┌─────────────────┐     HTTPS      ┌──────────────────────────┐
│  Next.js (App)  │ ─────────────► │  FastAPI (Python 3.11)   │
│  localhost:3000 │                │  localhost:8000          │
└─────────────────┘                └────────────┬─────────────┘
                                                │
                          ┌─────────────────────┼──────────────────┐
                          │                     │                  │
                ┌─────────▼──────┐   ┌──────────▼──────┐  ┌───────▼──────┐
                │  Qdrant Cloud  │   │   Groq API      │  │  Embedder    │
                │  Vector store  │   │   Llama 3.3 70B │  │  MiniLM-L6   │
                │  Payload index │   │   Streaming     │  │  (local)     │
                └────────────────┘   └─────────────────┘  └──────────────┘
```

### Ingestion pipeline

```
PDF bytes
  └─► PyMuPDF extracts raw text
        └─► Recursive character chunking (512 chars, 64 overlap)
              └─► all-MiniLM-L6-v2 embeds each chunk → 384-dim vector
                    └─► Qdrant upserts vectors + payload (text, doc_id, filename)
```

### Query pipeline

```
User question
  └─► all-MiniLM-L6-v2 embeds question → 384-dim vector
        └─► Qdrant filtered search (by doc_id) → top 5 chunks
              └─► Chunks + question → Groq Llama 3.3 70B (stream=True)
                    └─► SSE stream → frontend renders tokens as they arrive
```

### Key architecture decisions

**Overlapping chunks** — chunks overlap by 64 characters so sentences split across chunk boundaries still appear complete in at least one chunk, preventing retrieval from missing edge context.

**Filtered vector search** — every Qdrant query filters by `doc_id` so users can upload multiple documents without answers bleeding across them. A payload index on `doc_id` makes this filter O(1).

**Sources-first streaming** — the SSE stream sends retrieved source chunks as the first event before any tokens arrive. The frontend renders citation cards immediately, then the answer streams in alongside them.

**Honest retrieval** — if no relevant chunks are found, the system says so rather than hallucinating. The prompt explicitly instructs the LLM to only answer from provided context.

**Local embeddings** — `all-MiniLM-L6-v2` runs inside the Docker container. Zero embedding API calls, zero per-token cost, zero latency on the embed step.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, Tailwind CSS |
| Backend | FastAPI (Python 3.11) |
| Vector DB | Qdrant Cloud (free tier) |
| Embeddings | sentence-transformers — all-MiniLM-L6-v2 (local) |
| LLM | Groq API — Llama 3.3 70B |
| PDF parsing | PyMuPDF |
| Streaming | Server-Sent Events (SSE) |
| Containerisation | Docker + docker-compose |

---

## Project Structure

```
documind/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── .env.example
│   ├── main.py              # FastAPI entry, CORS, lifespan
│   ├── config.py            # Pydantic settings
│   ├── database.py          # Qdrant client + embedder init, payload index
│   ├── routers/
│   │   ├── documents.py     # POST /documents/upload, DELETE /documents/{doc_id}
│   │   └── qa.py            # POST /qa/ask → SSE stream
│   └── services/
│       ├── chunker.py       # PDF extraction + overlapping text chunking
│       ├── embedder.py      # Vector embedding + Qdrant upsert/delete
│       └── retriever.py     # Filtered vector search → ranked chunks
└── frontend/
    └── app/
        ├── globals.css      # Design tokens, dark theme
        └── page.tsx         # Upload zone + chat view + source cards
```

---

## Local Setup

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [Qdrant Cloud account](https://cloud.qdrant.io) — free tier, no credit card
- [Groq API key](https://console.groq.com) — free tier, 14,400 req/day
- Node.js 18+ (for frontend only)

### 1. Clone and configure

```bash
git clone https://github.com/theprakhar211/documind.git
cd documind
cp backend/.env.example backend/.env
```

Fill in `backend/.env`:

```env
GROQ_API_KEY=gsk_...
QDRANT_URL=https://xxxx-xxxx.aws.cloud.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key
COLLECTION_NAME=documind
ENVIRONMENT=development
```

### 2. Start the backend

```bash
docker compose up --build
```

First build takes 5–8 minutes (downloads sentence-transformers + torch). Subsequent runs take ~15 seconds.

Wait for:
```
Connecting to Qdrant...
Created collection: documind
Embedding model loaded.
Application startup complete.
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`

### 4. Verify backend

| URL | Expected |
|---|---|
| http://localhost:8000/docs | FastAPI Swagger UI |
| http://localhost:8000/health | `{"status": "ok"}` |

### Useful commands

```bash
docker compose up -d          # start backend detached
docker compose stop backend   # stop backend
docker compose start backend  # start backend (no rebuild)
docker compose logs backend -f  # tail backend logs
```

---

## API Reference

### `POST /documents/upload`
Upload a PDF for ingestion.

**Request:** `multipart/form-data` with `file` field (PDF, max 10MB)

**Response:**
```json
{
  "doc_id": "uuid-v4",
  "filename": "research_paper.pdf",
  "chunks_stored": 42,
  "message": "Successfully processed research_paper.pdf into 42 chunks."
}
```

---

### `POST /qa/ask`
Ask a question against an uploaded document. Returns an SSE stream.

**Request:**
```json
{
  "doc_id": "uuid-v4",
  "question": "What methodology did the authors use?"
}
```

**Response:** `text/event-stream` with three event types:

```
data: {"type": "sources", "chunks": [...]}   ← retrieved passages, fires first
data: {"type": "token", "content": "The"}    ← LLM tokens, stream in real time
data: {"type": "done"}                       ← stream complete
```

---

### `DELETE /documents/document/{doc_id}`
Remove all vectors for a document from Qdrant.

---

## How RAG Works — Plain English

Traditional search matches keywords. RAG matches *meaning*.

When you upload a PDF, DocuMind converts each text chunk into a 384-dimensional vector — a point in high-dimensional space where semantically similar text lands nearby. When you ask a question, your question gets converted to a vector too, and we find the chunks whose vectors are closest to it.

Those chunks become the LLM's context. The LLM only answers from what's in those chunks — it can't hallucinate facts that aren't in your document. If the answer isn't there, it says so.

This is why DocuMind correctly declines questions like "What is the ATS score of this resume?" — ATS score doesn't exist anywhere in the document, so no relevant chunks are retrieved, and the system honestly reports it couldn't find the answer.

---

## Known Limitations

- **Text PDFs only** — scanned PDFs without embedded text will return empty extractions. OCR support is a planned addition.
- **No persistent sessions** — `doc_id` lives in browser state. Refreshing loses the reference (vectors stay in Qdrant but you'd need to re-upload to get a new doc_id).
- **Single document per session** — the chat is scoped to one document at a time by design.
- **Groq free tier** — 14,400 requests/day, sufficient for personal use and demos.

---

## Roadmap

- [ ] RAGAS eval endpoint — automated retrieval quality scoring (context recall, answer faithfulness)
- [ ] Multi-document support — ask across multiple uploaded PDFs
- [ ] OCR fallback — handle scanned PDFs via Tesseract
- [ ] Persistent sessions — save doc_id to localStorage so uploads survive refresh
- [ ] Whisper transcription — ask questions by voice

---

## Author

**Prakhar Sharma**
GitHub: [@theprakhar211](https://github.com/theprakhar211)

---

## License

MIT