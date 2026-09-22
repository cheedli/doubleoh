#!/usr/bin/env node
/** The binary: read the environment, speak stdio. Plain Node — no bun required. */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DoubleOh } from "@doubleoh/sdk";
import { createServer } from "./index.js";

const apiKey = process.env.DOUBLEOH_API_KEY;
if (!apiKey) {
  console.error("DOUBLEOH_API_KEY is required (it starts with oo_).");
  process.exit(1);
}
const client = new DoubleOh({
  apiKey,
  ...(process.env.DOUBLEOH_BASE_URL
    ? { baseUrl: process.env.DOUBLEOH_BASE_URL }
    : {}),
});
await createServer(client).connect(new StdioServerTransport());
