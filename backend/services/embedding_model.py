import numpy as np
from fastembed import TextEmbedding


class Embedder:
    """
    Thin wrapper around FastEmbed (ONNX runtime, no PyTorch).

    Keeps the `.encode(...)` interface the rest of the code already uses:
    a string returns a 1-D array, a list of strings returns a 2-D array,
    and both support `.tolist()`.
    """

    def __init__(self, model_name: str):
        self._model = TextEmbedding(model_name=model_name)

    def encode(self, texts, **_ignored):
        if isinstance(texts, str):
            return next(iter(self._model.embed([texts])))
        return np.array(list(self._model.embed(list(texts), batch_size=32)))
