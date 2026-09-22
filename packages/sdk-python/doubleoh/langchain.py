"""LangChain / LangGraph adapter: the three tools as LangChain ``Tool`` objects.

LangGraph agents consume LangChain tools, so this one module covers both::

    from doubleoh import DoubleOh
    from doubleoh.langchain import doubleoh_tools

    tools = doubleoh_tools(DoubleOh(api_key=...))
    graph = create_react_agent(model, tools=tools)   # LangGraph
    agent = initialize_agent(tools, llm, ...)         # classic LangChain

The framework import happens inside the call, so importing this module costs nothing and
failing is a sentence about what to install rather than an ImportError from the middle of
somebody's dependency tree.
"""

from __future__ import annotations

from . import DoubleOh
from .tools import build_tools


def doubleoh_tools(client: DoubleOh) -> list:
    try:
        from langchain_core.tools import StructuredTool
    except ImportError as error:  # pragma: no cover - exercised only without langchain
        raise ImportError(
            "The LangChain adapter needs langchain-core: pip install langchain-core"
        ) from error

    return [
        StructuredTool.from_function(func)
        for func in build_tools(client)
    ]
