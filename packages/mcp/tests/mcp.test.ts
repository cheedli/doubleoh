/**
 * The MCP server over a real protocol round-trip — an actual MCP Client on an in-memory transport,
 * not handler functions called directly, because what this package owns is the protocol shell.
 * The DoubleOh wire is stubbed at fetch, the same seam the SDK's own tests use.
 */

import { describe, expect, test } from "bun:test";
import { DoubleOh } from "@doubleoh/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index";

function stubbedClient(
  answer: (
    path: string,
    init: RequestInit,
  ) => { status: number; body: unknown },
): DoubleOh {
  return new DoubleOh({
    apiKey: "oo_test_1",
    baseUrl: "http://stub",
    fetch: (async (url: string, init: RequestInit) => {
      const { status, body } = answer(
        String(url).replace("http://stub", ""),
        init,
      );
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });
}

async function connected(client: DoubleOh) {
  const server = createServer(client);
  const mcp = new Client({ name: "test-agent", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  return mcp;
}

describe("doubleoh-mcp", () => {
  test("lists the three tools with JSON-schema parameters", async () => {
    const mcp = await connected(
      stubbedClient(() => ({ status: 200, body: {} })),
    );
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "doubleoh_report_skill",
      "doubleoh_request_fix",
      "doubleoh_skills_for",
    ]);
    const fix = tools.find((tool) => tool.name === "doubleoh_request_fix");
    expect(fix?.inputSchema.required).toEqual(["url", "task"]);
  });

  test("skills_for renders skills as context a model can follow", async () => {
    const mcp = await connected(
      stubbedClient(() => ({
        status: 200,
        body: {
          skills: [
            {
              name: "checkout-finish-2afd60",
              description: "Use when finishing checkout.",
              instructions: "1. Click checkout.",
              timesWorked: 5,
              timesFailed: 0,
            },
          ],
        },
      })),
    );
    const result = await mcp.callTool({
      name: "doubleoh_skills_for",
      arguments: { task: "finish checkout" },
    });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain("A colleague has done this before");
    expect(text).toContain("worked 5×");
    expect(text).toContain("1. Click checkout.");
  });

  test("a deflection tells the agent to retry with the skill, not wait for a human", async () => {
    const mcp = await connected(
      stubbedClient(() => ({
        status: 200,
        body: {
          intervention: {
            id: null,
            fixUrl: null,
            prepared: false,
            deflected: true,
            skill: {
              name: "s",
              description: "d",
              instructions: "1. Dismiss the wall.",
              timesWorked: 2,
              timesFailed: 0,
            },
          },
        },
      })),
    );
    const result = await mcp.callTool({
      name: "doubleoh_request_fix",
      arguments: { url: "https://shop.example", task: "a known wall" },
    });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain("No human was needed");
    expect(text).toContain("1. Dismiss the wall.");
  });

  test("a refusal arrives as a readable answer, not a protocol error", async () => {
    const mcp = await connected(
      stubbedClient(() => ({
        status: 400,
        body: { error: "That address is not reachable for a fix." },
      })),
    );
    const result = await mcp.callTool({
      name: "doubleoh_request_fix",
      arguments: { url: "http://localhost:3001/admin", task: "reach inside" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text).toContain("DoubleOh refused (400)");
    expect(text).toContain("not reachable");
  });

  test("report_skill posts the boolean and thanks the agent", async () => {
    let posted: unknown;
    const mcp = await connected(
      stubbedClient((path, init) => {
        if (path.endsWith("/outcome")) posted = JSON.parse(String(init.body));
        return { status: 200, body: { recorded: true, retired: false } };
      }),
    );
    const result = await mcp.callTool({
      name: "doubleoh_report_skill",
      arguments: { name: "checkout-finish-2afd60", worked: true },
    });
    expect(posted).toEqual({ worked: true });
    expect((result.content as { text: string }[])[0]?.text).toContain(
      "Recorded",
    );
  });
});
