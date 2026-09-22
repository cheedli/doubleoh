# doubleoh-mcp

**The DoubleOh fix loop as an MCP server.** Any MCP-capable agent — Claude Code, Claude
Desktop, and the growing list of clients — gets the loop as three tools with zero
integration code.

```json
{
  "mcpServers": {
    "doubleoh": {
      "command": "bunx",
      "args": ["doubleoh-mcp"],
      "env": { "DOUBLEOH_API_KEY": "oo_live_…" }
    }
  }
}
```

## The tools

- **`doubleoh_skills_for`** — before attempting a task it has failed at before, the agent
  asks what has been learned and receives step-by-step procedures from past human fixes,
  with each one's track record.
- **`doubleoh_request_fix`** — when stuck, the agent asks for a human. If the fleet
  already knows the wall, the procedure comes back instantly instead and nobody is paged.
  Duplicate walls are answered with "already being fixed, N runs blocked" — an agent in a
  retry loop never spams a team.
- **`doubleoh_report_skill`** — after following a skill, the agent reports whether it
  worked. Skills that keep failing stop being served.

Refusals (a private URL, a quota) come back as readable tool results, not protocol
errors — the model is told what went wrong in a sentence it can act on.

`DOUBLEOH_BASE_URL` points at a self-hosted deployment; it defaults to the hosted service.
