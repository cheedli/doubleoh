# doubleoh

**Your agents learn from every fix. Stop failing the same way twice.**

When your agent gets stuck on a real website, one of *your* people fixes it once in a live
browser. That fix compiles into a skill. The next time any agent in your fleet hits the same
wall, it follows the skill instead of asking a human.

```bash
pip install doubleoh
```

Zero dependencies — it is `urllib` and dataclasses.

## The loop, in code

```python
from doubleoh import DoubleOh

doubleoh = DoubleOh(api_key=os.environ["DOUBLEOH_API_KEY"])

# 1. Before your agent tries something it has failed at before, ask what has been learned.
skills = doubleoh.skills_for("check out on the supplier portal")
if skills and skills[0].times_worked > skills[0].times_failed:
    prompt += f"\n\nA colleague has done this before:\n{skills[0].instructions}"

# 2. Your agent runs. When it gets stuck, ask for a human.
fix = doubleoh.request_fix(url=page.url, task="Check out on the supplier portal")
if fix.deflected:
    # Nobody was paged: the fleet already knows this wall. Retry with the skill.
    prompt += fix.skill.instructions
elif fix.fix_url:
    slack.send(f"An agent needs a hand: {fix.fix_url}")
# fix.duplicate_of set? The wall is already waiting on a human — fix.blocked_runs says
# how many runs are stuck on it. Your retry loop needs no change; nobody gets re-paged.

# 3. Close the loop: say whether the skill worked. This is what makes the counts mean
#    something, and a skill followed three times that never works retires itself.
doubleoh.report_skill(skills[0].name, worked=True)
```

You decide what "stuck" means — a timeout, a retry count, a model that says it cannot
proceed. Only you know your agent.

## API

- `skills_for(task) -> list[LearnedSkill]` — what has been learned; put `instructions` in
  your agent's context. `times_worked` / `times_failed` are raw counts on purpose: 5 for 5
  is worth following, 1 for 1 is a guess that happened to work once.
- `request_fix(url, task) -> Intervention` — ask for help. Three possible shapes: a
  `fix_url` (a human was paged), `deflected=True` with `skill` (nobody was paged — you
  already know the answer), or `duplicate_of` with `blocked_runs` (already waiting; triage
  by the count). `url` must be a public page; private and loopback addresses are refused.
- `report_skill(name, worked)` — one boolean; wire it to whatever already tells you a run
  succeeded.
- `intervention(id)` / `interventions()` — status; `skill_name` is the receipt.
- `retire_skill(name, reason)` — stop serving a skill immediately.

Errors raise `DoubleOhError` carrying the server's own message and the HTTP `status`.

## What is recorded

Fix sessions keep screenshots and the shape of each action. **Typed text is never
recorded** — a fix session is exactly where a password gets typed, so keystrokes stay off
the record entirely.

## Framework adapters

Every adapter serves the same three tools; pick your framework's line.

```python
from doubleoh import DoubleOh
client = DoubleOh(api_key=os.environ["DOUBLEOH_API_KEY"])

# LangChain / LangGraph
from doubleoh.langchain import doubleoh_tools
graph = create_react_agent(model, tools=doubleoh_tools(client))

# CrewAI
from doubleoh.crewai import doubleoh_tools
agent = Agent(role="operator", tools=doubleoh_tools(client))

# LlamaIndex
from doubleoh.llamaindex import doubleoh_tools
agent = ReActAgent.from_tools(doubleoh_tools(client), llm=llm)

# OpenAI Agents SDK, AutoGen, Pydantic AI — all accept plain functions:
from doubleoh.tools import build_tools
skills_for, request_fix, report_skill = build_tools(client)
agent = Agent(tools=[function_tool(skills_for), function_tool(request_fix), function_tool(report_skill)])
```

No framework is a dependency of this package: each adapter imports its framework lazily
and, if it is missing, raises one sentence naming what to `pip install`.

Using Claude or another MCP-capable agent? Skip the SDK entirely — `doubleoh-mcp` serves
the same three tools over MCP.
