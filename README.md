# DocuMind — RAG Document Q&A

> **Upload a PDF. Ask anything. Get cited, streaming answers.**

DocuMind is a Retrieval-Augmented Generation (RAG) app. Upload a PDF, ask questions in natural language, and get answers that stream in token by token, with source passages and similarity scores shown alongside.

**Live:** [documind-ps.vercel.app](https://documind-ps.vercel.app/)

**Stack:** FastAPI · Qdrant · FastEmbed (ONNX) · Groq (gpt-oss) · Next.js · Docker

---

## Demo

1. Upload a PDF (research paper, resume, technical doc, textbook chapter)
2. Ask a question about its contents
3. Watch the answer stream in
4. Expand the source cards to see the retrieved passages and their similarity scores
5. Open the **Eval** tab to score retrieval and answer quality on your own test questions

---

## Architecture

```
┌─────────────────┐     HTTPS      ┌──────────────────────────┐
│  Next.js (App)  │ ─────────────► │  FastAPI (Python 3.11)   │
│  Vercel         │                │  Render / Docker         │
└─────────────────┘                └────────────┬─────────────┘
                                                │
                          ┌─────────────────────┼──────────────────┐
                          │                     │                  │
                ┌─────────▼──────┐   ┌──────────▼──────┐  ┌───────▼──────┐
                │  Qdrant Cloud  │   │   Groq API      │  │  FastEmbed   │
                │  Vector store  │   │   gpt-oss-120b  │  │  MiniLM-L6   │
                │  Payload index │   │   Streaming     │  │  (ONNX)      │
                └────────────────┘   └─────────────────┘  └──────────────┘
```

### Ingestion pipeline

```
PDF bytes
  └─► PyMuPDF extracts raw text
        └─► Fixed-size chunking (512 characters, 64 overlap), snapped to word boundaries
              └─► all-MiniLM-L6-v2 (FastEmbed) embeds each chunk → 384-dim vector
                    └─► Qdrant upserts vectors + payload (text, doc_id, filename)
```

### Query pipeline

```
User question
  └─► all-MiniLM-L6-v2 embeds the question → 384-dim vector
        └─► Qdrant filtered search (by doc_id) → top 5 chunks
              └─► Chunks + question → Groq gpt-oss-120b (stream=True)
                    └─► SSE: sources first, then tokens, then done
```

### Key architecture decisions

**Overlapping chunks** — chunks overlap by 64 characters so a sentence split across a boundary still appears whole in at least one chunk. Chunk ends are moved back to the nearest space so words are never cut in half.

**Filtered vector search** — every Qdrant query filters by `doc_id`, so multiple uploaded documents never bleed into each other's answers. A payload index on `doc_id` supports that filter.

**Sources-first streaming** — the SSE stream sends the retrieved chunks as its first event, before any tokens. The frontend can show citation cards immediately while the answer streams in.

**Grounded answers** — the prompt tells the model to answer only from the retrieved context and to say "I couldn't find that in the document." when the answer isn't there. Retrieval always returns the top 5 chunks for the document, so this refusal comes from the prompt, not from an empty search.

**Local embeddings via ONNX** — `all-MiniLM-L6-v2` runs inside the backend container through FastEmbed (ONNX runtime), with no embedding API calls. Replacing PyTorch with FastEmbed fixed a 512 MB out-of-memory crash on Render.

**Model migration** — Groq retired the Llama models this project started on. Answers now use `openai/gpt-oss-120b`, and evaluation judging uses `openai/gpt-oss-20b`. Both are configurable in `backend/config.py`.

---

## Evaluation

`POST /qa/eval` and the **Eval** tab in the UI run a small evaluation on an uploaded document. You supply up to 20 questions with known correct answers, and DocuMind scores each one on three metrics, plus an average:

| Metric | How it is computed |
|---|---|
| **Context recall** | Embeds the ground-truth answer and each retrieved chunk; the highest cosine similarity is the score |
| **Answer faithfulness** | A separate `gpt-oss-20b` call judges whether the answer is supported by the retrieved context (0 to 1) |
| **Answer relevance** | Cosine similarity between the embedded question and the embedded answer |

This is a **custom, RAGAS-inspired evaluator**. It does not use the `ragas` library, and the recall and relevance scores are embedding-similarity proxies, so treat them as relative signals rather than absolute quality measures.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 — deployed on Vercel |
| Backend | FastAPI (Python 3.11) — deployed on Render |
| Vector DB | Qdrant Cloud (free tier) |
| Embeddings | FastEmbed (ONNX) — all-MiniLM-L6-v2 |
| LLM | Groq — `openai/gpt-oss-120b` (answers), `openai/gpt-oss-20b` (evaluation judge) |
| PDF parsing | PyMuPDF |
| Streaming | Server-Sent Events (SSE) |
| Containerisation | Docker (multi-stage build) + docker-compose |

---

## Project Structure

```
documind/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile               # Multi-stage build: builder → runtime
│   ├── .env.example
│   ├── main.py                  # FastAPI entry, CORS, lifespan, /health
│   ├── config.py                # Pydantic settings (chunking, models)
│   ├── database.py              # Qdrant client + embedder init, payload index
│   ├── routers/
│   │   ├── documents.py         # POST /documents/upload, DELETE /documents/document/{doc_id}
│   │   ├── qa.py                # POST /qa/ask → SSE stream
│   │   └── eval.py              # POST /qa/eval
│   ├── services/
│   │   ├── chunker.py           # PDF extraction + overlapping chunking
│   │   ├── embedding_model.py   # FastEmbed (ONNX) wrapper
│   │   ├── embedder.py          # Qdrant upsert/delete
│   │   ├── retriever.py         # Filtered vector search → ranked chunks
│   │   └── evaluator.py         # Context recall, faithfulness, relevance
│   └── tests/
│       └── test_embedding_model.py
└── frontend/
    └── app/
        ├── globals.css          # Design tokens, dark theme
        └── page.tsx             # Upload, Chat and Eval views
```

---

## Local Setup

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [Qdrant Cloud account](https://cloud.qdrant.io) (free tier)
- [Groq API key](https://console.groq.com) (free tier, rate limits apply)
- Node.js 20+ (frontend only)

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

The first build takes a few minutes. Wait for:
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
```

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
npm run dev
```

Open `http://localhost:3000`.

### 4. Verify the backend

| URL | Expected |
|---|---|
| http://localhost:8000/docs | FastAPI Swagger UI |
| http://localhost:8000/health | `{"status": "ok"}` |

### Tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest -q
```

The suite is small: it covers the embedding wrapper with a mocked model.

---

## Deployment

| Service | What |
|---|---|
| Render | Backend (Docker, listens on `$PORT`) |
| Vercel | Frontend (`NEXT_PUBLIC_API_URL` → backend URL) |
| Qdrant Cloud | Vector database |

Backend environment variables: `GROQ_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`, `COLLECTION_NAME`, `ENVIRONMENT`, and `FRONTEND_URL` (extra allowed CORS origin; `localhost:3000` and the live Vercel URL are already allowed in `main.py`).

---

## API Reference

### `POST /documents/upload`
Upload a PDF for ingestion.

**Request:** `multipart/form-data` with a `file` field (PDF, max 10 MB)

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
Ask a question about an uploaded document. Returns an SSE stream.

**Request:**
```json
{
  "doc_id": "uuid-v4",
  "question": "What methodology did the authors use?"
}
```

**Response:** `text/event-stream` with three event types:

```
data: {"type": "sources", "chunks": [...]}   ← retrieved passages, sent first
data: {"type": "token", "content": "The"}    ← LLM tokens, streamed as generated
data: {"type": "done"}                       ← stream complete
```

---

### `POST /qa/eval`
Score retrieval and answer quality on up to 20 test cases.

**Request:**
```json
{
  "doc_id": "uuid-v4",
  "test_cases": [
    { "question": "What is the candidate's name?", "ground_truth": "Prakhar Sharma" }
  ]
}
```

**Response:** per-question scores for `context_recall`, `answer_faithfulness` and `answer_relevance`, plus aggregate averages.

---

### `DELETE /documents/document/{doc_id}`
Remove all vectors for a document from Qdrant.

---

## How RAG Works — Plain English

Traditional search matches keywords. RAG matches *meaning*.

When you upload a PDF, DocuMind converts each text chunk into a 384-dimensional vector, a point in space where semantically similar text lands close together. Your question becomes a vector too, and DocuMind retrieves the chunks nearest to it.

Those chunks become the LLM's context. The prompt tells the model to answer only from that context, and to say so when the answer isn't there. For a question like "What is the ATS score of this resume?", the closest chunks won't contain an answer, and the model is instructed to reply that it couldn't find it in the document.

---

## Known Limitations

- **Text PDFs only** — scanned PDFs without embedded text return empty extractions. OCR is planned.
- **No persistent sessions** — `doc_id` lives in browser state. After a refresh you need to re-upload to get a new `doc_id`, though the old vectors stay in Qdrant.
- **Single document per session** — the chat is scoped to one document at a time.
- **Approximate evaluation** — the evaluator uses embedding-similarity proxies for recall and relevance (see Evaluation).
- **Light test coverage** — only the embedding wrapper has automated tests, and there is no CI workflow yet.
- **Groq free tier** — rate limits apply; fine for personal use and demos.

---

## Roadmap

- [x] RAG pipeline — PDF upload, chunking, embedding, filtered vector search
- [x] Streaming Q&A — SSE token streaming with source citations sent first
- [x] Evaluation endpoint and dashboard — context recall, faithfulness, relevance
- [x] Document deletion — remove vectors from Qdrant
- [x] ONNX embeddings — FastEmbed instead of PyTorch
- [x] Docker multi-stage build; deployed on Render and Vercel
- [ ] Multi-document support — ask across multiple PDFs
- [ ] OCR fallback for scanned PDFs
- [ ] Persistent sessions — save `doc_id` to localStorage
- [ ] Tests for the chunker, retriever and API routes, plus CI
- [ ] Whisper transcription — ask questions by voice

---

## Author

**Prakhar Sharma**
GitHub: [@theprakhar211](https://github.com/theprakhar211)

---

## License

MIT
