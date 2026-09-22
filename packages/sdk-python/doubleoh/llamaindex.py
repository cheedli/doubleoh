"""LlamaIndex adapter: the three tools as ``FunctionTool`` objects.

::

    from doubleoh import DoubleOh
    from doubleoh.llamaindex import doubleoh_tools

    agent = ReActAgent.from_tools(doubleoh_tools(DoubleOh(api_key=...)), llm=llm)
"""

from __future__ import annotations

from . import DoubleOh
from .tools import build_tools


def doubleoh_tools(client: DoubleOh) -> list:
    try:
        from llama_index.core.tools import FunctionTool
    except ImportError as error:  # pragma: no cover - exercised only without llama-index
        raise ImportError(
            "The LlamaIndex adapter needs llama-index-core: pip install llama-index-core"
        ) from error

    return [FunctionTool.from_defaults(fn=func) for func in build_tools(client)]
