<div align="center">

<img src="site/brand/logo.svg" alt="DoubleOh" width="96">

# DoubleOh

**The fix desk for AI agents.**

When an agent reaches something it cannot do alone, a login, an approval, a rule nobody wrote down,
one of your people takes over its screen for a minute. The fix compiles into a procedure with an
explicit boundary of what the fleet may now do and what still needs a person. The next agent that
hits the same wall follows the procedure, and you keep the record of who allowed what.

[**doubleoh.ai**](https://doubleoh.ai) · [**Docs**](https://doubleoh.ai/docs/) · [**Security**](https://doubleoh.ai/security/)

</div>

## Run it yourself

One container. It carries the app, the API, the browser the agents drive, and its own PostgreSQL.
Free for your own business under the [Sustainable Use License](LICENSE).

```sh
git clone https://github.com/cheedli/doubleoh.git && cd doubleoh
cp .env.example .env        # fill it: every secret has its command next to it
docker compose up -d
open http://localhost:3001  # sign in with DOUBLEOH_ADMIN_EMAIL / DOUBLEOH_ADMIN_PASSWORD
```

Needs Docker, 4 GB of memory and an Anthropic key for the skill compiler. First pull is about 5 GB.
Nothing leaves your network except the model calls you configure.

Putting it behind a domain, an external database, sizing and platform notes: [docs/deployment.md](docs/deployment.md).
Every variable: [docs/configuration.md](docs/configuration.md).

## What it does

1. **An agent reaches its limit.** It calls `requestFix({ url, task })`. If the fleet already knows this
   wall, the learned skill comes back instantly with its authority boundary and nobody is paged.
2. **A person takes the wheel.** A fix link opens the agent's live screen, browser or desktop, in the
   fixer's hands. Typed text is never recorded; credentials and one-time codes stay with the person.
3. **The fix becomes a bounded skill.** A vision model reads the recording and writes a procedure, not a
   transcript: numbered steps, a "Done when" line, and an `authority` field naming what still requires a
   human and what the agent must never do.
4. **The record stays.** Every fix has an exportable oversight record: who asked, who intervened, under
   what authority, before and after, what the fleet learned.

Skills are scoped to the customer and to the site they were learned on, stored in the open
[Agent Skills format](docs/agent-skills-format.md), and retire themselves when they stop working.

## Integrate in three calls

```ts
import { DoubleOh } from "@doubleoh/sdk";
const oo = new DoubleOh({ apiKey: process.env.DOUBLEOH_API_KEY, baseUrl: "http://localhost:3001" });

const skills = await oo.skillsFor(task, { url });   // what the fleet already knows here
const fix = await oo.requestFix({ url, task });      // a known wall, or a person
await oo.reportSkill(skill.name, worked);            // keeps the library honest
```

`npm i @doubleoh/sdk` · `pip install doubleoh` · MCP server: `npx doubleoh-mcp`.

Adapters for LangChain, LangGraph, CrewAI, LlamaIndex, the OpenAI Agents SDK, AutoGen, Pydantic AI,
Browser Use and Mastra live in [packages/](packages/). Any MCP-capable agent gets the three calls as
tools with no code. Two complete example agents are in [examples/](examples/).

## Fixes on your own machines

The container covers public web pages. For an ERP, a Windows client or a staging portal, run the
runtime natively on the machine that has them. It opens one outbound connection and listens on
nothing. See [docs/native-runtime.md](docs/native-runtime.md).

## What is in this repository

| Path | | License |
|---|---|---|
| `docker-compose.yml`, `.env.example` | Run DoubleOh on your own machine | Sustainable Use |
| `packages/sdk`, `packages/sdk-python`, `packages/mcp` | The SDKs and the MCP server, published to npm and PyPI | MIT |
| `examples/` | Example agents and a tenant package | MIT |
| `docs/` | Deployment, configuration, the skill format, the native runtime | |

The server, app and runtime source are not in this repository. The image at `ghcr.io/cheedli/doubleoh`
is what runs.

## Security

Public targets only, unless you allowlist a host for your own runtime. Private, loopback and metadata
addresses are refused. Typed text is never recorded. Every intervention is in the audit trail. The
skill-poisoning threat model is at [doubleoh.ai/security/threat-model](https://doubleoh.ai/security/threat-model/).
Responsible disclosure: [security@doubleoh.ai](mailto:security@doubleoh.ai).

## License

Source available under the [Sustainable Use License](LICENSE): free to self-host and modify for your
own business, not for hosting it as a service for others. The SDKs, the MCP server and the examples
are MIT so they can live inside your code. A commercial license is available for anything the
Sustainable Use License does not cover: hello@doubleoh.ai.
