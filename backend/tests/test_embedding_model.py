import numpy as np

from services import embedding_model


class FakeTextEmbedding:
    def __init__(self, model_name):
        self.model_name = model_name

    def embed(self, documents, batch_size=256, **_):
        for _doc in documents:
            yield np.ones(384, dtype=np.float32)


def make(monkeypatch):
    monkeypatch.setattr(embedding_model, "TextEmbedding", FakeTextEmbedding)
    return embedding_model.Embedder("sentence-transformers/all-MiniLM-L6-v2")


def test_single_string_returns_one_vector(monkeypatch):
    vec = make(monkeypatch).encode("hello")
    assert vec.shape == (384,)
    assert len(vec.tolist()) == 384


def test_list_returns_matrix(monkeypatch):
    mat = make(monkeypatch).encode(["a", "b", "c"], show_progress_bar=False)
    assert mat.shape == (3, 384)
    assert len(mat.tolist()) == 3
