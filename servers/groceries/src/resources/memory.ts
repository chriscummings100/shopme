import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VENDOR_NAMES, buildSummary, isVendorName } from "@shopme/grocery-core";

export function registerMemoryResources(server: McpServer): void {
  server.registerResource(
    "memory_summary",
    "shopme://memory/summary",
    {
      title: "Shopping Memory Summary",
      description: "Compact phrase-to-product shopping memory.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(buildSummary(), null, 2)
      }]
    })
  );

  server.registerResource(
    "vendor_memory_summary",
    new ResourceTemplate("shopme://memory/summary/{vendor}", { list: undefined }),
    {
      title: "Vendor Shopping Memory Summary",
      description: "Vendor-specific phrase-to-product shopping memory.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const vendor = String(variables.vendor ?? "");
      if (!isVendorName(vendor)) {
        throw new Error(`Unknown vendor. Choices: ${VENDOR_NAMES.join(", ")}`);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(buildSummary({ vendor }), null, 2)
        }]
      };
    }
  );
}
