import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';

const WS_PORT = 18321;

// --- Extension connection ---

let extensionWs: WebSocket | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: Error) => void }
>();

const wss = new WebSocketServer({ port: WS_PORT });

setInterval(() => {
  if (extensionWs?.readyState === WebSocket.OPEN) extensionWs.ping();
}, 25_000);

wss.on('connection', (ws) => {
  extensionWs = ws;
  console.error('[shopme] Extension connected');

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id)!;
      pendingRequests.delete(msg.id);
      if (msg.type === 'error') {
        reject(new Error(msg.data?.message ?? 'Unknown extension error'));
      } else {
        resolve(msg.data);
      }
    }
  });

  ws.on('close', () => {
    extensionWs = null;
    console.error('[shopme] Extension disconnected');
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('Extension disconnected'));
      pendingRequests.delete(id);
    }
  });
});

function sendToExtension(type: string, data?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Extension not connected. Make sure the ShopMe extension is installed and a Waitrose tab is open.'));
      return;
    }
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Request to extension timed out'));
    }, 30_000);
    pendingRequests.set(id, {
      resolve: (data) => { clearTimeout(timeout); resolve(data); },
      reject: (err) => { clearTimeout(timeout); reject(err); },
    });
    extensionWs.send(JSON.stringify({ id, type, data }));
  });
}

// Make an API call via the Waitrose tab — session cookies applied automatically
async function tabFetch(method: string, path: string, body?: string): Promise<{ status: number; body: string }> {
  return sendToExtension('fetch_from_tab', { method, path, body: body ?? null });
}

// --- MCP Server ---

const server = new McpServer({ name: 'shopme', version: '0.1.0' });

server.tool('ping', 'Check if the browser extension is connected and responding', {}, async () => {
  try {
    await sendToExtension('ping');
    return { content: [{ type: 'text' as const, text: 'Extension is connected and responding.' }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Extension error: ${e.message}` }], isError: true };
  }
});

server.tool(
  'navigate',
  'Navigate the browser to a URL on waitrose.com.',
  { url: z.string().describe('Full URL to navigate to') },
  async ({ url }) => {
    try {
      await sendToExtension('navigate', { url });
      return { content: [{ type: 'text' as const, text: `Navigated to ${url}` }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Navigate failed: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'get_shopping_context',
  'Get customerId and active orderId from the Waitrose tab localStorage. Call this before basket or search operations.',
  {},
  async () => {
    try {
      const result = await sendToExtension('get_storage');
      const customerId: string = result.local?.wtr_customer_id ?? '';
      const orderId: string = result.local?.wtr_order_id ?? '';
      if (!customerId) throw new Error('Not logged in — wtr_customer_id not found in localStorage');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ customerId, orderId }, null, 2),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Failed: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'search_products',
  'Search for products on Waitrose. Returns id, lineNumber, name, size, price, and any active promotions.',
  {
    searchTerm: z.string().describe('Search query, e.g. "semi-skimmed milk"'),
    size: z.number().int().min(1).max(48).default(10).describe('Number of results to return'),
    sortBy: z.enum(['MOST_POPULAR', 'PRICE_LOW_TO_HIGH', 'PRICE_HIGH_TO_LOW', 'RATING']).default('MOST_POPULAR'),
  },
  async ({ searchTerm, size, sortBy }) => {
    try {
      const ctx = await sendToExtension('get_storage');
      const customerId: string = ctx.local?.wtr_customer_id ?? '';
      const orderId: string = ctx.local?.wtr_order_id ?? '';
      if (!customerId) throw new Error('Not logged in');

      const result = await tabFetch(
        'POST',
        `/api/content-prod/v2/cms/publish/productcontent/search/${customerId}?clientType=WEB_APP`,
        JSON.stringify({ customerSearchRequest: { queryParams: { searchTerm, size, sortBy, searchTags: [], filterTags: [], orderId, categoryLevel: 1 } } }),
      );
      if (result.status !== 200) throw new Error(`Search failed: HTTP ${result.status}`);

      const data = JSON.parse(result.body);
      const products = (data.componentsAndProducts ?? [])
        .filter((c: any) => c.searchProduct)
        .map((c: any) => {
          const p = c.searchProduct;
          return {
            id: p.id,
            lineNumber: p.lineNumber,
            name: p.name,
            size: p.size,
            price: p.displayPrice,
            pricePerUnit: p.displayPriceQualifier,
            promotion: p.promotion?.promotionDescription ?? null,
            uom: p.defaultQuantity?.uom ?? 'C62',
          };
        });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ totalMatches: data.totalMatches, products }, null, 2),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `search_products failed: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'add_to_basket',
  'Add a product to the Waitrose basket. Use lineNumber and id from search_products results.',
  {
    lineNumber: z.string().describe('Product line number, e.g. "053457"'),
    productId: z.string().describe('Product id, e.g. "053457-26759-26760"'),
    quantity: z.number().int().min(1).default(1),
    uom: z.string().default('C62').describe('Unit of measure from search results'),
  },
  async ({ lineNumber, productId, quantity, uom }) => {
    try {
      const ctx = await sendToExtension('get_storage');
      const orderId: string = ctx.local?.wtr_order_id ?? '';
      if (!orderId) throw new Error('No active order — not logged in or no order started');

      const trolleyItemId = -parseInt(lineNumber, 10);
      const body = JSON.stringify({
        query: `mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
          addItemToTrolley(orderId: $orderId, trolleyItem: $trolleyItem) {
            trolley {
              trolleyTotals { itemTotalEstimatedCost { amount currencyCode } }
            }
            failures { message type }
          }
        }`,
        variables: { orderId, trolleyItem: { lineNumber, productId, quantity: { amount: quantity, uom }, trolleyItemId } },
      });

      const result = await tabFetch('POST', '/api/graphql-prod/graph/live?clientType=WEB_APP&tag=add-item', body);
      const data = JSON.parse(result.body);
      const failures = data?.data?.addItemToTrolley?.failures ?? [];
      if (failures.length) throw new Error(failures.map((f: any) => f.message).join(', '));

      const total = data?.data?.addItemToTrolley?.trolley?.trolleyTotals?.itemTotalEstimatedCost;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: true, basketTotal: total ? `£${total.amount.toFixed(2)}` : null }),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `add_to_basket failed: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'api_call',
  'Make a cookie-authenticated HTTP request to any Waitrose API endpoint via the browser tab. Use for exploration or endpoints not covered by a dedicated tool.',
  {
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
    path: z.string().describe('API path, e.g. /api/delivery-pass-orchestration-prod/v1/pass/status'),
    body: z.string().optional().describe('JSON request body (for POST/PUT)'),
  },
  async ({ method, path, body }) => {
    try {
      const result = await tabFetch(method, path, body);
      let parsed: any;
      try { parsed = JSON.parse(result.body); } catch { parsed = result.body; }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status: result.status, body: parsed }, null, 2),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `api_call failed: ${e.message}` }], isError: true };
    }
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[shopme] MCP server running, WebSocket on port ${WS_PORT}`);
