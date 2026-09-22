"""CrewAI adapter: the three tools for a crew's agents.

::

    from doubleoh import DoubleOh
    from doubleoh.crewai import doubleoh_tools

    agent = Agent(role=..., tools=doubleoh_tools(DoubleOh(api_key=...)))

CrewAI's ``tool`` decorator builds a tool from a plain function's name, signature, and
docstring — which is exactly what ``doubleoh.tools`` provides, so this module is only the
wrapping.
"""

from __future__ import annotations

from . import DoubleOh
from .tools import build_tools


def doubleoh_tools(client: DoubleOh) -> list:
    try:
        from crewai.tools import tool
    except ImportError as error:  # pragma: no cover - exercised only without crewai
        raise ImportError(
            "The CrewAI adapter needs crewai: pip install crewai"
        ) from error

    return [tool(func) for func in build_tools(client)]
