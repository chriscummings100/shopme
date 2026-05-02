import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  VENDOR_NAMES,
  buildSummary,
  errorPayload,
  explain,
  recordAssociation,
  recordRejection,
  resolveVendor,
  screenshotUrl,
  startBrowser,
  type VendorName
} from "@chriscummings100/shopme-grocery-core";

const vendorSchema = z.enum(VENDOR_NAMES);
const httpMethodSchema = z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const memorySourceSchema = z.enum([
  "auto_added",
  "accepted_suggestion",
  "user_selected",
  "correction",
  "manual"
]);

export function registerShoppingTools(server: McpServer): void {
  server.registerTool(
    "start_browser",
    {
      description: "Launch Chrome with remote debugging for a supermarket login session.",
      inputSchema: {
        vendor: vendorSchema
      }
    },
    async ({ vendor }) => jsonResult(startBrowser(vendor))
  );

  server.registerTool(
    "search_products",
    {
      description: "Search products at the active supermarket and return opaque product IDs.",
      inputSchema: {
        term: z.string(),
        size: z.number().int().positive().default(10),
        vendor: vendorSchema.optional()
      }
    },
    async ({ term, size, vendor }) => withVendor(vendor, async (_, client) => client.search(term, size))
  );

  server.registerTool(
    "get_cart",
    {
      description: "Return the current basket contents, totals, and opaque cart item IDs.",
      inputSchema: {
        vendor: vendorSchema.optional()
      }
    },
    async ({ vendor }) => withVendor(vendor, async (_, client) => client.getCart())
  );

  server.registerTool(
    "add_to_cart",
    {
      description: "Add a product returned by search_products to the basket.",
      inputSchema: {
        product_id: z.string(),
        qty: z.number().int().positive().default(1),
        vendor: vendorSchema.optional()
      }
    },
    async ({ product_id: productId, qty, vendor }) =>
      withVendor(vendor, async (_, client) => client.add(productId, qty))
  );

  server.registerTool(
    "set_cart_quantity",
    {
      description: "Set a basket item's quantity. Passing qty=0 removes the item.",
      inputSchema: {
        cart_item_id: z.string(),
        qty: z.number().int().min(0),
        vendor: vendorSchema.optional()
      }
    },
    async ({ cart_item_id: cartItemId, qty, vendor }) =>
      withVendor(vendor, async (_, client) => client.setQty(cartItemId, qty))
  );

  server.registerTool(
    "clear_cart",
    {
      description: "Empty the current basket.",
      inputSchema: {
        vendor: vendorSchema.optional()
      }
    },
    async ({ vendor }) => withVendor(vendor, async (_, client) => client.clear())
  );

  server.registerTool(
    "list_orders",
    {
      description: "List recent and active orders.",
      inputSchema: {
        size: z.number().int().positive().default(15),
        vendor: vendorSchema.optional()
      }
    },
    async ({ size, vendor }) => withVendor(vendor, async (_, client) => client.getOrders(size))
  );

  server.registerTool(
    "get_order",
    {
      description: "Return full detail for an order ID returned by list_orders.",
      inputSchema: {
        order_id: z.string(),
        vendor: vendorSchema.optional()
      }
    },
    async ({ order_id: orderId, vendor }) => withVendor(vendor, async (_, client) => client.getOrder(orderId))
  );

  server.registerTool(
    "screenshot_page",
    {
      description: "Open a URL in the live Chrome session, save a screenshot, and close the tab.",
      inputSchema: {
        url: z.string().url(),
        output: z.string().default("screenshot.png")
      }
    },
    async ({ url, output }) => jsonResult(await screenshotUrl(url, output))
  );

  server.registerTool(
    "memory_summary",
    {
      description: "Return compact phrase-to-product shopping memory.",
      inputSchema: {
        vendor: vendorSchema.optional(),
        limit: z.number().int().positive().default(3)
      }
    },
    async ({ vendor, limit }) => jsonResult(buildSummary({ vendor, limit }))
  );

  server.registerTool(
    "memory_explain",
    {
      description: "Return memory evidence for one shopping phrase.",
      inputSchema: {
        phrase: z.string(),
        vendor: vendorSchema.optional(),
        limit: z.number().int().positive().default(5)
      }
    },
    async ({ phrase, vendor, limit }) => jsonResult(explain(phrase, { vendor, limit }))
  );

  server.registerTool(
    "memory_record",
    {
      description: "Record that a shopping phrase resolved to a product.",
      inputSchema: {
        phrase: z.string(),
        product_id: z.string(),
        product_name: z.string(),
        vendor: vendorSchema,
        search_term: z.string().optional(),
        source: memorySourceSchema.default("user_selected"),
        size: z.string().optional(),
        price: z.string().optional()
      }
    },
    async (input) => jsonResult({
      ok: true,
      event: recordAssociation(input)
    })
  );

  server.registerTool(
    "memory_reject",
    {
      description: "Record that a shopping phrase did not mean a product.",
      inputSchema: {
        phrase: z.string(),
        vendor: vendorSchema,
        wrong_product_id: z.string().optional(),
        wrong_product_name: z.string().optional(),
        correct_product_id: z.string().optional(),
        correct_product_name: z.string().optional()
      }
    },
    async (input) => jsonResult({
      ok: true,
      event: recordRejection(input)
    })
  );

  if (process.env.SHOPME_MCP_ENABLE_RAW_API === "1") {
    server.registerTool(
      "raw_api",
      {
        description: "Make a raw authenticated vendor API call. Disabled unless explicitly enabled.",
        inputSchema: {
          method: httpMethodSchema,
          path: z.string(),
          body: z.unknown().optional(),
          vendor: vendorSchema.optional()
        }
      },
      async ({ method, path, body, vendor }) => withVendor(vendor, async (resolvedName, client) => {
        const base = resolvedName === "sainsburys"
          ? "https://www.sainsburys.co.uk"
          : "https://www.waitrose.com";
        const url = path.startsWith("/") ? `${base}${path}` : path;
        return client.rawFetch(method, url, body ?? null);
      })
    );
  }
}

async function withVendor<T>(
  vendor: VendorName | undefined,
  action: (vendorName: VendorName, client: Awaited<ReturnType<typeof resolveVendor>>["vendor"]) => Promise<T>
): Promise<ReturnType<typeof jsonResult>> {
  const resolved = await resolveVendor(vendor);
  try {
    return jsonResult(await action(resolved.vendorName, resolved.vendor));
  } catch (error) {
    throw new Error(JSON.stringify(errorPayload(error), null, 2));
  } finally {
    await resolved.browser.close({ reason: "shopme MCP tool call completed" });
  }
}

function jsonResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
