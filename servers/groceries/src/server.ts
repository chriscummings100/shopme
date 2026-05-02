import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryResources } from "./resources/memory.js";
import { registerShoppingTools } from "./tools/index.js";

export const INSTRUCTIONS = [
  "ShopMe exposes shopping tools for the user's live grocery browser session.",
  "Chrome must be running with remote debugging enabled and the user must already be logged in.",
  "Product, cart, and order IDs are opaque: pass back IDs returned by earlier ShopMe tool calls.",
  "The clear_cart and set_cart_quantity tools change the user's basket."
].join(" ");

export function createGroceriesServer(): McpServer {
  const server = new McpServer({
    name: "ShopMe Groceries",
    version: "0.1.0"
  });

  registerShoppingTools(server);
  registerMemoryResources(server);

  return server;
}
