from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_client, get_embedder
from services.evaluator import run_eval
from config import settings

router = APIRouter()


class EvalCase(BaseModel):
    question: str
    ground_truth: str


class EvalRequest(BaseModel):
    doc_id: str
    test_cases: list[EvalCase]


@router.post("/eval")
async def evaluate_rag(request: EvalRequest):
    """
    Run RAGAS-style evaluation on a document.

    Provide a list of questions with known correct answers.
    Returns context recall, answer faithfulness, and answer
    relevance scores — per question and as aggregate averages.
    """
    if not request.test_cases:
        raise HTTPException(
            status_code=400, detail="Provide at least one test case.")
    if len(request.test_cases) > 20:
        raise HTTPException(
            status_code=400, detail="Max 20 test cases per eval run.")

    try:
        results = run_eval(
            test_cases=[c.model_dump() for c in request.test_cases],
            doc_id=request.doc_id,
            client=get_client(),
            embedder=get_embedder(),
            collection_name=settings.collection_name,
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
