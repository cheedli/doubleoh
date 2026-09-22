"""The loop as agent tools — plain functions, which is what most frameworks now want.

The OpenAI Agents SDK, AutoGen, and Pydantic AI all accept ordinary Python callables as
tools, reading the name, signature, and docstring. So the base adapter is exactly that:
``build_tools(client)`` returns three well-documented functions, and those three
frameworks need nothing else::

    from doubleoh import DoubleOh
    from doubleoh.tools import build_tools

    tools = build_tools(DoubleOh(api_key=...))

    # OpenAI Agents SDK:   Agent(tools=[function_tool(f) for f in tools])
    # AutoGen:             AssistantAgent(tools=list(tools))
    # Pydantic AI:         Agent(tools=list(tools))

The functions return STRINGS written for a model to read: a tool result is context, not
an API payload, and "A colleague has done this before: …" steers a model where a JSON
blob does not. LangChain/LangGraph, CrewAI, and LlamaIndex have their own modules that
wrap these same functions in each framework's tool class.
"""

from __future__ import annotations

from typing import Callable

from . import DoubleOh, DoubleOhError, LearnedSkill


def _skill_lines(skill: LearnedSkill) -> str:
    return (
        f'Skill "{skill.name}" (worked {skill.times_worked}×, failed {skill.times_failed}×):\n'
        f"{skill.description}\n{skill.instructions}"
    )


def build_tools(client: DoubleOh) -> tuple[Callable, Callable, Callable]:
    """The three tools, bound to one client, in the order an agent uses them."""

    def doubleoh_skills_for(task: str) -> str:
        """BEFORE attempting a task you have failed at before, ask what has been learned.

        Returns step-by-step procedures compiled from past human fixes, with how often
        each has worked. Follow a returned procedure instead of improvising.

        Args:
            task: The task, in one sentence. Phrase it the same way each time — the
                phrasing is part of the skill's identity.
        """
        skills = client.skills_for(task)
        if not skills:
            return (
                "Nothing has been learned about this task yet. Proceed, and if you get "
                "stuck, use doubleoh_request_fix."
            )
        rendered = "\n\n".join(_skill_lines(skill) for skill in skills)
        return f"A colleague has done this before. Follow these steps:\n\n{rendered}"

    def doubleoh_request_fix(url: str, task: str) -> str:
        """When you are STUCK on a web page, ask a human to fix it.

        A login wall, a changed layout, a step you cannot complete — a person fixes it
        once in a live browser and the fix becomes a skill the whole fleet reuses. If the
        fleet already knows this wall, the learned procedure is returned instantly
        instead and nobody is paged: follow it and retry. Do not call this for tasks you
        have not attempted.

        Args:
            url: The public http(s) page you are stuck on.
            task: What you were trying to do, in one sentence (max 500 characters).
        """
        try:
            fix = client.request_fix(url=url, task=task)
        except DoubleOhError as error:
            # A refusal is an answer the model should read, not an exception to crash on.
            return f"DoubleOh refused ({error.status}): {error}"
        if fix.deflected and fix.skill:
            return (
                "No human was needed — this wall is already known. Follow this procedure "
                f"and retry:\n\n{_skill_lines(fix.skill)}\n\n"
                "If it still fails, call doubleoh_request_fix again: the second ask "
                "reaches a human."
            )
        if fix.duplicate_of:
            blocked = fix.blocked_runs or "several"
            return (
                f"A human has already been asked about this exact wall ({blocked} runs "
                "are blocked on it). Do not ask again; move to other work or wait."
            )
        return (
            f"A human has been asked to fix this. Fix link (already sent to the team if "
            f"a webhook is configured): {fix.fix_url}. Move on to other work; the fix "
            "becomes a reusable skill once a person completes it."
        )

    def doubleoh_report_skill(name: str, worked: bool) -> str:
        """AFTER following a skill, report whether it worked.

        This keeps the skill's track record honest; a skill that keeps failing stops
        being served. Always call this when you used a skill.

        Args:
            name: The skill's name, exactly as returned.
            worked: True if following the skill completed the task.
        """
        client.report_skill(name, worked)
        return "Recorded. Thank you — the skill's track record is what the next agent trusts."

    return doubleoh_skills_for, doubleoh_request_fix, doubleoh_report_skill
