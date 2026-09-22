/**
 * doubleoh-mcp — the fix loop as an MCP server.
 *
 * Any MCP-capable agent (Claude Code, Claude Desktop, and the growing list of clients) gets the
 * three tools with zero integration code:
 *
 *   { "mcpServers": { "doubleoh": {
 *       "command": "bunx", "args": ["doubleoh-mcp"],
 *       "env": { "DOUBLEOH_API_KEY": "oo_live_…" } } } }
 *
 * The tools themselves come from @doubleoh/sdk's framework-agnostic definitions — this file is only
 * the MCP shell around them, which is the point: one definition, every framework. The low-level
 * Server API is used on purpose: the definitions already carry JSON Schema, which is what MCP puts
 * on the wire, so translating them through zod would be a round trip to nowhere.
 */

import { type DoubleOh, DoubleOhError } from "@doubleoh/sdk";
import { doubleohTools } from "@doubleoh/sdk/tools";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export function createServer(client: DoubleOh): Server {
  const tools = doubleohTools(client);
  const server = new Server(
    { name: "doubleoh", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find(
      (candidate) => candidate.name === request.params.name,
    );
    if (!tool) {
      return {
        content: [
          { type: "text", text: `No tool named ${request.params.name}.` },
        ],
        isError: true,
      };
    }
    try {
      const text = await tool.execute(request.params.arguments ?? {});
      return { content: [{ type: "text", text }] };
    } catch (error) {
      /*
       * A refusal is an answer the model should read, not a protocol failure: "that address is not
       * reachable for a fix" tells the agent to stop aiming at intranet hosts.
       */
      const text =
        error instanceof DoubleOhError
          ? `DoubleOh refused (${error.status}): ${error.message}`
          : `DoubleOh was unreachable: ${String(error)}`;
      return { content: [{ type: "text", text }], isError: true };
    }
  });

  return server;
}
