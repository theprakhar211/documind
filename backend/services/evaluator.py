from groq import Groq
from sentence_transformers import SentenceTransformer
from services.retriever import retrieve_chunks
from qdrant_client import QdrantClient
from loguru import logger
from config import settings
import json

groq_client = Groq(api_key=settings.groq_api_key)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x ** 2 for x in a) ** 0.5
    norm_b = sum(x ** 2 for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def score_context_recall(
    question: str,
    ground_truth: str,
    chunks: list[dict],
    embedder: SentenceTransformer,
) -> float:
    """
    Context recall: does the retrieved context contain enough
    information to answer the question?

    We embed the ground truth and each chunk, then take the
    max similarity as the recall score. A high score means
    at least one retrieved chunk is semantically close to
    the correct answer.
    """
    if not chunks:
        return 0.0

    gt_vector = embedder.encode(ground_truth).tolist()
    chunk_vectors = embedder.encode([c["text"] for c in chunks]).tolist()

    similarities = [_cosine_similarity(gt_vector, cv) for cv in chunk_vectors]
    return round(max(similarities), 4)


def score_answer_faithfulness(
    question: str,
    answer: str,
    chunks: list[dict],
) -> float:
    """
    Answer faithfulness: did the LLM only say things supported
    by the retrieved context?

    We ask a separate LLM call to judge this — it returns a
    score from 0 to 1 with reasoning.
    """
    context = "\n\n".join([c["text"] for c in chunks])

    prompt = f"""You are an evaluation assistant. Score how faithful the answer is to the context.

CONTEXT:
{context}

QUESTION:
{question}

ANSWER:
{answer}

Score the answer from 0.0 to 1.0 where:
- 1.0 = every claim in the answer is directly supported by the context
- 0.5 = answer is partially supported, some claims go beyond the context
- 0.0 = answer contradicts or ignores the context entirely

Respond ONLY with valid JSON in this exact format:
{{"score": 0.0, "reason": "one sentence explanation"}}"""

    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0.0,
        )
        result = json.loads(response.choices[0].message.content.strip())
        return round(float(result["score"]), 4)
    except Exception as e:
        logger.warning(f"Faithfulness scoring failed: {e}")
        return 0.0


def score_answer_relevance(
    question: str,
    answer: str,
    embedder: SentenceTransformer,
) -> float:
    """
    Answer relevance: does the answer actually address the question?

    We embed both question and answer and compute cosine similarity.
    A high score means the answer is semantically close to the question.
    """
    q_vector = embedder.encode(question).tolist()
    a_vector = embedder.encode(answer).tolist()
    return round(_cosine_similarity(q_vector, a_vector), 4)


def run_eval(
    test_cases: list[dict],
    doc_id: str,
    client: QdrantClient,
    embedder: SentenceTransformer,
    collection_name: str,
) -> dict:
    """
    Run full evaluation on a test set.

    Each test case: {"question": str, "ground_truth": str}
    Returns per-question scores and aggregate averages.
    """
    results = []

    for case in test_cases:
        question = case["question"]
        ground_truth = case["ground_truth"]

        logger.info(f"Evaluating: '{question[:50]}...'")

        # Retrieve chunks
        chunks = retrieve_chunks(
            query=question,
            doc_id=doc_id,
            client=client,
            embedder=embedder,
            collection_name=collection_name,
            top_k=5,
        )

        # Generate answer from chunks
        context = "\n\n".join([c["text"] for c in chunks])
        prompt = f"""Answer the question using only the context below.
If the answer is not in the context, say "Not found in document."

CONTEXT:
{context}

QUESTION:
{question}

ANSWER:"""

        try:
            response = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.1,
            )
            answer = response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"Answer generation failed: {e}")
            answer = "Error generating answer."

        # Score all three metrics
        context_recall = score_context_recall(
            question, ground_truth, chunks, embedder)
        faithfulness = score_answer_faithfulness(question, answer, chunks)
        relevance = score_answer_relevance(question, answer, embedder)

        results.append({
            "question": question,
            "ground_truth": ground_truth,
            "answer": answer,
            "chunks_retrieved": len(chunks),
            "scores": {
                "context_recall": context_recall,
                "answer_faithfulness": faithfulness,
                "answer_relevance": relevance,
                "aggregate": round((context_recall + faithfulness + relevance) / 3, 4),
            }
        })

    # Compute averages
    avg_recall = round(sum(r["scores"]["context_recall"]
                       for r in results) / len(results), 4)
    avg_faith = round(sum(r["scores"]["answer_faithfulness"]
                      for r in results) / len(results), 4)
    avg_rel = round(sum(r["scores"]["answer_relevance"]
                    for r in results) / len(results), 4)
    avg_agg = round((avg_recall + avg_faith + avg_rel) / 3, 4)

    return {
        "total_questions": len(results),
        "aggregate_scores": {
            "context_recall": avg_recall,
            "answer_faithfulness": avg_faith,
            "answer_relevance": avg_rel,
            "overall": avg_agg,
        },
        "per_question": results,
    }
