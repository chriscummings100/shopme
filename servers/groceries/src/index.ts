#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGroceriesServer } from "./server.js";

async function main(): Promise<void> {
  const server = createGroceriesServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
