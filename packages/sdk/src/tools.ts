/**
 * The loop as agent tools, framework-agnostic.
 *
 * Every current tool-calling convention (MCP, Vercel AI SDK, Mastra, OpenAI function calling) wants
 * the same three things: a name, a JSON schema for the arguments, and something to execute. So that
 * is what this exports, and each framework wraps it in one line instead of this package depending
 * on all of them.
 *
 * The executors return STRINGS, written for a model to read: a tool result is context, not an API
 * payload. Each result ends by naming the next tool to call, because the model that reads it is
 * deciding what to do next, and the descriptions teach the whole loop, not one call.
 */

import type { DoubleOh, LearnedSkill } from "./index.js";

export type DoubleOhTool = {
  name: string;
  description: string;
  /** JSON Schema for the arguments, the lingua franca every framework accepts. */
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<string>;
};

const LOOP =
  "The loop: doubleoh_skills_for before a task you have failed at before; doubleoh_request_fix once " +
  "when stuck; doubleoh_wait_for_fix while a person works; doubleoh_report_skill after following any skill.";

/** The skill as context: the server's hint when it has one (boundary first), else the same shape built here. */
function skillLines(skill: LearnedSkill): string {
  if (skill.systemHint) return skill.systemHint;
  const authority = skill.authority;
  const boundary = authority
    ? `Requires a human: ${authority.requiresHuman.join("; ") || "nothing stated"}. Never: ${authority.never.join("; ") || "nothing stated"}.`
    : "Boundary not stated: stop and ask a person before any credential, payment or approval.";
  return (
    `Skill "${skill.name}" (worked ${skill.timesWorked}, failed ${skill.timesFailed}). ${skill.description}\n` +
    `Authority. ${boundary}\nSteps:\n${skill.instructions}`
  );
}

/**
 * The four tools, bound to one client.
 *
 * Vercel AI SDK:  aisdk `tool({ description, inputSchema: jsonSchema(t.parameters), execute: t.execute })`
 * OpenAI:         `{ type: "function", function: { name: t.name, description: …, parameters: … } }`
 * MCP:            served directly by doubleoh-mcp.
 */
export function doubleohTools(client: DoubleOh): DoubleOhTool[] {
  return [
    {
      name: "doubleoh_skills_for",
      description:
        "BEFORE attempting a task you have failed at before, ask what the fleet has learned about it " +
        "on this page. Returns procedures compiled from past human fixes, each with its record and " +
        "its authority boundary: what still needs a person, what you must never do. Follow a returned " +
        `procedure instead of improvising, and stay inside its boundary. ${LOOP}`,
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "The task, in one sentence. Phrase it the same way each time; the phrasing is part of the skill's identity.",
          },
          url: {
            type: "string",
            description:
              "The page you are on. Scopes the answer to the site the skill was learned on. Pass it whenever you have it.",
          },
        },
        required: ["task"],
      },
      execute: async (args) => {
        const url = typeof args.url === "string" ? args.url : undefined;
        const skills = await client.skillsFor(String(args.task ?? ""), { url });
        if (skills.length === 0) {
          return (
            "Nothing has been learned about this task on this site yet. Attempt it. " +
            "If you hit a login, a code, a dialog or an approval you cannot pass, call doubleoh_request_fix once."
          );
        }
        return `A colleague has done this before. Follow the first procedure, inside its boundary:\n\n${skills
          .map(skillLines)
          .join(
            "\n\n",
          )}\n\nWhen done, call doubleoh_report_skill with the skill's name and whether it worked.`;
      },
    },
    {
      name: "doubleoh_request_fix",
      description:
        "When you are STUCK on a page (a login wall, a one-time code, a consent dialog, an approval, a " +
        "changed layout) ask for a person. Call it ONCE per wall; retrying the action first, or asking " +
        "repeatedly, locks accounts and pages people for nothing. If the fleet already knows this wall, " +
        "the learned procedure is returned instantly instead and nobody is paged: follow it and retry. " +
        `Otherwise a person takes over the live session; call doubleoh_wait_for_fix to know when. ${LOOP}`,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The page you are stuck on. Public http(s), or a host your team allowlisted for its own runtime.",
          },
          task: {
            type: "string",
            description:
              "What you were trying to do, in one sentence (max 500 characters), phrased as in doubleoh_skills_for.",
          },
        },
        required: ["url", "task"],
      },
      execute: async (args) => {
        const fix = await client.requestFix({
          url: String(args.url ?? ""),
          task: String(args.task ?? ""),
        });
        if (fix.deflected && fix.skill) {
          return (
            "No person was needed: this wall is already known. Follow this procedure inside its boundary and retry:\n\n" +
            skillLines(fix.skill) +
            "\n\nThen call doubleoh_report_skill. If it still fails, call doubleoh_request_fix again; the second ask reaches a person."
          );
        }
        if (fix.duplicateOf) {
          return (
            `A person has already been asked about this exact wall (${fix.blockedRuns ?? "several"} runs are blocked on it; wall ${fix.wallId ?? fix.duplicateOf}). ` +
            `Do not ask again. Call doubleoh_wait_for_fix with id ${fix.duplicateOf}, or move to other work.`
          );
        }
        return (
          `A person has been asked (intervention ${fix.id}, wall ${fix.wallId ?? "unknown"}). ` +
          `Fix link, already sent to the team if a webhook is configured: ${fix.fixUrl}. ` +
          `Typical time: about ${Math.round((fix.expectedSeconds ?? 300) / 60)} minutes. ` +
          `Call doubleoh_wait_for_fix with id ${fix.id} to be told when it is done, and do other work meanwhile.`
        );
      },
    },
    {
      name: "doubleoh_wait_for_fix",
      description:
        "After doubleoh_request_fix returned an intervention id, wait for the person to finish. One " +
        "call holds up to 55 seconds and returns as soon as the status changes; call it again while " +
        "the answer says still open. When resolved, call doubleoh_skills_for with the same task and " +
        `url to get the procedure the fix produced. ${LOOP}`,
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The intervention id from doubleoh_request_fix.",
          },
        },
        required: ["id"],
      },
      execute: async (args) => {
        const status = await client.intervention(String(args.id ?? ""), {
          waitSeconds: 55,
        });
        if (status.status === "open") {
          return `Still open; a person has not finished yet. Call doubleoh_wait_for_fix again with id ${status.id}, or continue other work.`;
        }
        if (status.status === "resolved") {
          return (
            `Resolved by a person.${status.skillName ? ` A skill was compiled: "${status.skillName}".` : " No skill was compiled from it."} ` +
            "Retry the task now; call doubleoh_skills_for with the same task and url first to get the procedure, and stay inside its boundary."
          );
        }
        return `The fix ended as "${status.status}" without a result. Call doubleoh_request_fix again with the same url and task to reach a person.`;
      },
    },
    {
      name: "doubleoh_report_skill",
      description:
        "AFTER following a skill from doubleoh_skills_for or a deflection, report whether it worked. " +
        "This keeps the skill's track record honest; a skill that keeps failing stops being served. " +
        `Always call this when you used a skill, whether it worked or not. ${LOOP}`,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The skill's name, exactly as returned.",
          },
          worked: {
            type: "boolean",
            description: "true if following the skill completed the task.",
          },
        },
        required: ["name", "worked"],
      },
      execute: async (args) => {
        await client.reportSkill(String(args.name ?? ""), Boolean(args.worked));
        return "Recorded. The skill's track record is what the next agent trusts. Continue with your task.";
      },
    },
  ];
}
