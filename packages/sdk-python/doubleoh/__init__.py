"""The DoubleOh client, for an agent that would rather learn than fail twice.

The whole SDK is three moments: before you try something, ask what has been learned
(``skills_for``); when you get stuck, ask a human (``request_fix``); when you know how a
skill went, say so (``report_skill``). Everything else an integrator writes — the retry
loop, the "am I stuck" heuristic — is theirs, because only they know their agent.

No dependencies. It is ``urllib`` and dataclasses, readable in one sitting: a reliability
tool that drags a dependency tree into your build is a reliability problem.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import quote

__all__ = [
    "DoubleOh",
    "DoubleOhError",
    "LearnedSkill",
    "Intervention",
    "InterventionStatus",
]

_DEFAULT_BASE_URL = "https://api.doubleoh.ai"


class DoubleOhError(Exception):
    """The server refused: its own sentence about why, a stable code, and the next move.

    ``code`` is one of key_required, rate_limited, bad_request, target_refused,
    computer_required, quota_exceeded, not_found, unavailable. ``next`` is written for the
    program reading it.
    """

    def __init__(self, message: str, status: int, code: Optional[str] = None, next: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.next = next


@dataclass(frozen=True)
class LearnedSkill:
    """A procedure learned from a past human fix, ready to hand to your agent."""

    name: str
    description: str
    #: The steps, as prose. Put this in your agent's context before it tries the task.
    instructions: str
    #: How many agents followed this and reported it worked / did not. Raw counts on
    #: purpose: 5 for 5 is worth following, 1 for 1 is a guess that happened to work
    #: once, and a rate cannot tell those two apart.
    times_worked: int = 0
    times_failed: int = 0
    #: The edge of the skill's authority: ``{"requiresHuman": [...], "never": [...]}``.
    authority: Optional[dict[str, list[str]]] = None
    #: The skill as one block of context for a model, boundary first. Paste it verbatim.
    system_hint: Optional[str] = None


@dataclass(frozen=True)
class Intervention:
    """What came back from asking for help.

    Exactly one of three shapes:
      - ``fix_url`` is set: a human has been asked; send the link where your team lives.
      - ``deflected`` is True: nobody was paged — ``skill`` already answers this wall.
        Retry with its instructions in context; if that still fails, ask again (the same
        wall deflects only once, so the second ask reaches a human).
      - ``duplicate_of`` is set: this wall is already waiting on a human. ``blocked_runs``
        says how many runs are stuck on it, yours included — triage by it.
    """

    id: Optional[str]
    fix_url: Optional[str]
    prepared: bool
    duplicate_of: Optional[str] = None
    waiting_since: Optional[str] = None
    blocked_runs: Optional[int] = None
    deflected: bool = False
    skill: Optional[LearnedSkill] = None
    #: Stable id of this wall (key, site, task words). Retries and rephrasings share it.
    wall_id: Optional[str] = None
    #: GET it: holds up to 55 seconds and returns when the status changes.
    wait_url: Optional[str] = None
    #: Typical time for a person to reach the fix. A planning number.
    expected_seconds: Optional[int] = None
    #: The next move, written for the program reading it.
    next: Optional[str] = None


@dataclass(frozen=True)
class InterventionStatus:
    id: str
    url: str
    task: str
    #: ``open``, ``resolved``, ``abandoned``, or ``expired``.
    status: str
    #: The skill this fix produced, once it has. None until then, or if nothing was learned.
    skill_name: Optional[str]
    #: How many runs hit this wall while it was open. The triage number.
    blocked_runs: int
    created_at: str


def _skill_from(payload: dict[str, Any]) -> LearnedSkill:
    return LearnedSkill(
        name=payload["name"],
        description=payload.get("description", ""),
        instructions=payload.get("instructions", ""),
        times_worked=payload.get("timesWorked", 0),
        times_failed=payload.get("timesFailed", 0),
        authority=payload.get("authority"),
        system_hint=payload.get("systemHint"),
    )


class DoubleOh:
    """One customer's handle on the loop.

    >>> doubleoh = DoubleOh(api_key="oo_live_...")
    >>> skills = doubleoh.skills_for("check out on the supplier portal")
    >>> if skills:
    ...     prompt += skills[0].instructions
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ):
        if not api_key or not api_key.startswith("oo_"):
            raise ValueError("A DoubleOh API key is required (it starts with oo_).")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    # ---- the three moments -------------------------------------------------

    def skills_for(self, task: str, url: Optional[str] = None) -> list[LearnedSkill]:
        """What has been learned that helps with this task.

        Call this BEFORE your agent attempts something it has failed at before. If a
        skill comes back, put its ``instructions`` in the agent's context; that is the
        whole point of the loop, the moment a past human's fix saves this run.

        Pass ``url`` when you have it: skills are scoped to the site they were learned
        on, and the page's host is what keeps one site's fix from answering another.
        """
        query = f"task={quote(task)}" + (f"&url={quote(url, safe='')}" if url else "")
        body = self._get(f"/v1/skills?{query}")
        return [_skill_from(skill) for skill in body["skills"]]

    def request_fix(self, url: str, task: str) -> Intervention:
        """Ask a human to finish what your agent could not.

        ``url`` must be a public http(s) page — the page your agent is stuck on. ``task``
        is one sentence (max 500 chars); phrase it the same way each time so repeated
        fixes of one wall stay one skill.
        """
        body = self._post("/v1/interventions", {"url": url, "task": task})
        raw = body["intervention"]
        skill = raw.get("skill")
        return Intervention(
            id=raw.get("id"),
            fix_url=raw.get("fixUrl"),
            prepared=bool(raw.get("prepared", False)),
            duplicate_of=raw.get("duplicateOf"),
            waiting_since=raw.get("waitingSince"),
            blocked_runs=raw.get("blockedRuns"),
            deflected=bool(raw.get("deflected", False)),
            skill=_skill_from(skill) if skill else None,
            wall_id=raw.get("wallId"),
            wait_url=raw.get("waitUrl"),
            expected_seconds=raw.get("expectedSeconds"),
            next=raw.get("next"),
        )

    def report_skill(self, name: str, worked: bool) -> None:
        """Say whether a skill worked.

        This closes the loop, and it is the one call people are tempted to skip. Without
        it a skill compiled from a single recording is served forever with nothing
        checking it. One boolean, so it costs nothing to wire into whatever already tells
        you a run succeeded. A skill followed three times that never works retires itself.
        """
        self._post(f"/v1/skills/{quote(name, safe='')}/outcome", {"worked": worked})

    # ---- the rest ------------------------------------------------------------

    def intervention(self, intervention_id: str, wait: int = 0) -> InterventionStatus:
        """How one fix is going, and, once resolved, the skill it produced.

        With ``wait`` the server holds the request up to that many seconds (55 at most)
        and answers as soon as the status changes: one call instead of a polling loop.
        """
        wait = max(0, min(int(wait), 55))
        suffix = f"?wait={wait}" if wait else ""
        body = self._get(f"/v1/interventions/{quote(intervention_id, safe='')}{suffix}")
        return self._status_from(body["intervention"])

    def wait_for_fix(self, intervention_id: str, timeout: float = 600.0) -> InterventionStatus:
        """Wait until a person has finished, or ``timeout`` seconds pass.

        Each round trip holds up to 55 seconds on the server, so a ten-minute wait is
        about eleven calls, not three hundred.
        """
        deadline = time.monotonic() + timeout
        status = self.intervention(intervention_id, wait=55)
        while status.status == "open" and time.monotonic() < deadline:
            status = self.intervention(intervention_id, wait=55)
        return status

    def interventions(self) -> list[InterventionStatus]:
        """Recent fixes across your fleet, newest first."""
        body = self._get("/v1/interventions")
        return [self._status_from(row) for row in body["interventions"]]

    def retire_skill(self, name: str, reason: str) -> None:
        """Stop serving a learned skill that turned out to be wrong, immediately."""
        self._post(f"/v1/skills/{quote(name, safe='')}/retire", {"reason": reason})

    # ---- wire ------------------------------------------------------------------

    @staticmethod
    def _status_from(raw: dict[str, Any]) -> InterventionStatus:
        return InterventionStatus(
            id=raw["id"],
            url=raw["url"],
            task=raw["task"],
            status=raw["status"],
            skill_name=raw.get("skillName"),
            blocked_runs=raw.get("blockedRuns", 1),
            created_at=raw.get("createdAt", ""),
        )

    def _get(self, path: str) -> dict[str, Any]:
        return self._request("GET", path, None)

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", path, payload)

    def _request(self, method: str, path: str, payload: Optional[dict[str, Any]]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self._base_url}{path}",
            method=method,
            headers={
                "x-api-key": self._api_key,
                "content-type": "application/json",
            },
            data=json.dumps(payload).encode() if payload is not None else None,
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                return json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            # The server's own message names what went wrong; the status is the fallback.
            code = next_move = None
            try:
                detail = json.loads(error.read().decode())
                message = detail.get("error") or f"DoubleOh answered {error.code}"
                code, next_move = detail.get("code"), detail.get("next")
            except Exception:
                message = f"DoubleOh answered {error.code}"
            raise DoubleOhError(message, error.code, code, next_move) from None
        except urllib.error.URLError as error:
            raise DoubleOhError(f"Could not reach DoubleOh: {error.reason}", 0) from None
