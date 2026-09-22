# @doubleoh/sdk

**Your agents learn from every fix. Stop failing the same way twice.**

Observability tells you your agent broke. This makes sure it never breaks the same way again.

When your agent gets stuck on a real website — a login wall, a cookie banner, a redesigned page —
one of *your* people fixes it once in a live browser. That fix is recorded and compiled into a skill.
The next time any agent in your fleet hits the same wall, it follows the skill instead of asking a
human.

```bash
npm install @doubleoh/sdk
```

## The loop, in code

Three calls, because the product is three moments.

```ts
import { DoubleOh } from "@doubleoh/sdk";

const doubleoh = new DoubleOh({ apiKey: process.env.DOUBLEOH_API_KEY! });

// 1. Before your agent tries something it has failed at before, ask what has been learned.
const skills = await doubleoh.skillsFor("check out on the supplier portal");
if (skills.length > 0) {
  // Put it in the agent's context. This is the whole point: a past human's fix, applied now.
  systemPrompt += `\n\nA colleague has done this before:\n${skills[0].instructions}`;
}

// 2. Your agent runs. When it gets stuck, ask for a human.
const fix = await doubleoh.requestFix({
  url: page.url(),
  task: "Check out on the supplier portal",
});
await slack.send(`An agent needs a hand: ${fix.fixUrl}`);

// 3. Your teammate opens the link, drives the browser, clicks "I fixed it".
//    Their actions become a skill. Step 1 returns it from now on.
```

You decide what "stuck" means — a timeout, a retry count, a model that says it cannot proceed. Only
you know your agent.

## What your teammate sees

The fix link opens a page with the live browser already under their control and the task written at
the top. They finish it by hand, press **I fixed it**, and are told what their fix became. No account,
no install, no DoubleOh knowledge. The link expires after a few hours and stops working the moment
it is used.

## API

### `new DoubleOh({ apiKey, baseUrl?, fetch? })`

`apiKey` starts with `oo_live_`. `baseUrl` points at your own deployment if you self-host.

### `skillsFor(task: string): Promise<LearnedSkill[]>`

What has been learned that helps with this task. Each skill has `name`, `description`, and
`instructions` — put the instructions in your agent's context.

### `requestFix({ url, task }): Promise<Intervention>`

Ask a human to finish it. Returns `{ id, fixUrl, prepared }`. Send `fixUrl` wherever your team
watches; `prepared` says whether we managed to pre-open the page for them.

**`fixUrl` is null when the same wall is already waiting.** Your retry loop can call this every
attempt without spamming your team — asking twice about the same page and task returns the first
intervention, with `duplicateOf` set. Guard on it:

```ts
const fix = await doubleoh.requestFix({ url, task });
if (fix.fixUrl) await slack.send(`An agent needs a hand: ${fix.fixUrl}`);
```

The URL must be a public http(s) page; private and loopback addresses are refused.

**`deflected: true` means nobody was paged — you already know the answer.** When a learned skill
with a working record matches the task, `requestFix` returns it instead of opening an intervention:
no container, no Slack ping, no waiting on a human. Retry with the skill in your agent's context;
if it still fails, call `requestFix` again — the same wall deflects only once, so the second ask
reaches a human:

```ts
const fix = await doubleoh.requestFix({ url, task });
if (fix.deflected && fix.skill) {
  prompt += fix.skill.instructions;   // retry with what a colleague already taught the fleet
} else if (fix.fixUrl) {
  await slack.send(`An agent needs a hand: ${fix.fixUrl}`);
}
```

On a duplicate, `blockedRuns` says how many runs are stuck on this wall — surface it wherever your
team triages, because the wall blocking fourteen runs deserves a human before the wall blocking one.

### `intervention(id): Promise<InterventionStatus>`

How one fix went. `status` is `open`, `resolved`, `abandoned`, or `expired`; `skillName` is what it
produced, once it has.

### `reportSkill(name, worked): Promise<void>`

Say whether a skill worked. **This is the call that makes the rest trustworthy** — without it a skill
compiled from one recording is served forever with nothing checking it. One boolean, so wire it into
whatever already tells you a run succeeded:

```ts
const [skill] = await doubleoh.skillsFor(task);
if (skill) {
  // Raw counts, not a rate: 5/5 is worth following, 1/1 is a guess that worked once.
  const trusted = skill.timesWorked >= 2 && skill.timesFailed === 0;
  if (trusted) prompt += skill.instructions;
}
// …run the agent…
if (skill) await doubleoh.reportSkill(skill.name, itWorked);
```

A skill followed three times that never works **retires itself**.

### `retireSkill(name, reason): Promise<void>`

Stop serving a learned skill that turned out to be wrong. Your agents stop being told about it
immediately. Wire it to whatever signal tells you a run went badly — a bad compile should cost one
failure, not every future one.

### `interventions(): Promise<InterventionStatus[]>`

Recent fixes across your fleet, newest first.

## Notes

- **No dependencies.** It is `fetch` and types. A reliability tool that drags a build tree into your
  project is a reliability problem.
- **Errors** throw `DoubleOhError` carrying the server's message and the HTTP `status`.
- **What is recorded.** The fix session keeps screenshots and the shape of each action (a click, a
  key). Typed text is never recorded — a fix session is exactly where a password gets typed, so the
  keystrokes stay off this path entirely.
