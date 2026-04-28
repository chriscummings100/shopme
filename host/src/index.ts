import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { WaitroseClient } from './client.js';

process.on('uncaughtException', (err) => {
  console.error('[shopme] Uncaught exception (keeping process alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[shopme] Unhandled rejection (keeping process alive):', reason);
});

// --- Direct API client ---

const client = new WaitroseClient();
await client.initialize();

// --- Product name cache (lineNumber → {name, size}) ---

const productCache = new Map<string, { name: string; size: string | null }>();

async function lookupProducts(lineNumbers: string[]): Promise<Map<string, { name: string; size: string | null }>> {
  const uncached = lineNumbers.filter(ln => !productCache.has(ln));
  if (uncached.length > 0) {
    const result = await client.fetch('GET', `/api/products-prod/v1/products/${uncached.join('%2B')}?view=SUMMARY`);
    if (result.status === 200) {
      const data = JSON.parse(result.body);
      for (const p of data.products ?? []) {
        productCache.set(p.lineNumber, { name: p.name ?? null, size: p.size ?? null });
      }
    }
  }
  const out = new Map<string, { name: string; size: string | null }>();
  for (const ln of lineNumbers) {
    const hit = productCache.get(ln);
    if (hit) out.set(ln, hit);
  }
  return out;
}

// --- Extension WebSocket (navigate only) ---

const WS_PORT = 18321;
let extensionWs: WebSocket | null = null;
const pendingRequests = new Map<string, { resolve: (d: any) => void; reject: (e: Error) => void }>();

const wss = new WebSocketServer({ port: WS_PORT });
wss.on('error', (err) => console.error('[shopme] WebSocket server error:', err));

setInterval(() => {
  console.error('[shopme] Keepalive tick, ws state:', extensionWs?.readyState ?? 'null');
  if (extensionWs?.readyState === WebSocket.OPEN) {
    sendToExtension('ping').catch((e) => console.error('[shopme] Keepalive ping failed:', e.message));
  }
}, 25_000);

wss.on('connection', (ws) => {
  extensionWs = ws;
  console.error('[shopme] Extension connected');
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id)!;
      pendingRequests.delete(msg.id);
      if (msg.type === 'error') reject(new Error(msg.data?.message ?? 'Unknown extension error'));
      else resolve(msg.data);
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
      reject(new Error('Browser extension not connected.'));
      return;
    }
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Request to extension timed out'));
    }, 30_000);
    pendingRequests.set(id, {
      resolve: (d) => { clearTimeout(timeout); resolve(d); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    extensionWs.send(JSON.stringify({ id, type, data }));
  });
}

// --- MCP Server ---

const server = new McpServer({ name: 'shopme', version: '0.1.0' });

const ORDER_STATUSES = 'AMENDING%2BFULFIL%2BPAID%2BPAYMENT_FAILED%2BPICKED%2BPLACED';

server.registerTool('ping', { description: 'Check if the Waitrose API is reachable and the session is active.' }, async () => {
  try {
    const result = await client.fetch('GET', '/api/order-orchestration-prod/v1/orders?size=1&sortBy=%2B&statuses=PLACED');
    if (result.status === 200) return { content: [{ type: 'text' as const, text: `API reachable. customerId=${client.customerId}, orderId=${client.orderId}` }] };
    throw new Error(`HTTP ${result.status}`);
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `ping failed: ${e.message}` }], isError: true };
  }
});

server.registerTool(
  'navigate',
  { description: 'Navigate the browser to a URL on waitrose.com (requires browser extension).', inputSchema: { url: z.string() } },
  async ({ url }) => {
    try {
      await sendToExtension('navigate', { url });
      return { content: [{ type: 'text' as const, text: `Navigated to ${url}` }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `navigate failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'get_shopping_context',
  { description: 'Get customerId and active orderId for the current session.' },
  async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ customerId: client.customerId, orderId: client.orderId }, null, 2) }],
  })
);

server.registerTool(
  'search_products',
  {
    description: 'Search for products on Waitrose. Returns id, lineNumber, name, size, price, and any active promotions.',
    inputSchema: {
      searchTerm: z.string().describe('Search query, e.g. "semi-skimmed milk"'),
      size: z.number().int().min(1).max(48).default(10),
      sortBy: z.enum(['MOST_POPULAR', 'PRICE_LOW_TO_HIGH', 'PRICE_HIGH_TO_LOW', 'RATING']).default('MOST_POPULAR'),
    },
  },
  async ({ searchTerm, size, sortBy }) => {
    try {
      const result = await client.fetch(
        'POST',
        `/api/content-prod/v2/cms/publish/productcontent/search/${client.customerId}?clientType=WEB_APP`,
        JSON.stringify({ customerSearchRequest: { queryParams: { searchTerm, size, sortBy, searchTags: [], filterTags: [], orderId: client.orderId, categoryLevel: 1 } } }),
      );
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
      const data = JSON.parse(result.body);
      const products = (data.componentsAndProducts ?? [])
        .filter((c: any) => c.searchProduct)
        .map((c: any) => {
          const p = c.searchProduct;
          return { id: p.id, lineNumber: p.lineNumber, name: p.name, size: p.size, price: p.displayPrice, pricePerUnit: p.displayPriceQualifier, promotion: p.promotion?.promotionDescription ?? null, uom: p.defaultQuantity?.uom ?? 'C62' };
        });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ totalMatches: data.totalMatches, products }, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `search_products failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'get_trolley',
  { description: 'Get current basket contents including trolleyItemId (needed for remove/update), product names, quantity, price, and totals.' },
  async () => {
    try {
      const data = await client.gql(`
        query($orderId: ID!) {
          getTrolley(orderId: $orderId) {
            trolley {
              trolleyItems {
                trolleyItemId lineNumber productId
                quantity { amount uom }
                totalPrice { amount currencyCode }
              }
              trolleyTotals {
                itemTotalEstimatedCost { amount currencyCode }
                savingsFromOffers { amount currencyCode }
              }
            }
          }
        }`, { orderId: client.orderId });

      const trolley = data?.getTrolley?.trolley;
      if (!trolley) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ items: [], itemTotal: '£0.00', savings: null }, null, 2) }] };
      }

      const trolleyItems = trolley.trolleyItems ?? [];
      const nameMap = await lookupProducts(trolleyItems.map((i: any) => i.lineNumber));

      const items = trolleyItems.map((i: any) => {
        const p = nameMap.get(i.lineNumber);
        return { trolleyItemId: i.trolleyItemId, lineNumber: i.lineNumber, productId: i.productId, name: p?.name ?? null, size: p?.size ?? null, quantity: i.quantity.amount, uom: i.quantity.uom, totalPrice: `£${i.totalPrice.amount.toFixed(2)}` };
      });

      const totals = trolley.trolleyTotals;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ items, itemTotal: `£${totals.itemTotalEstimatedCost.amount.toFixed(2)}`, savings: totals.savingsFromOffers.amount > 0 ? `£${totals.savingsFromOffers.amount.toFixed(2)}` : null }, null, 2) }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `get_trolley failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'add_to_basket',
  {
    description: 'Add a product to the Waitrose basket. Use lineNumber and id from search_products.',
    inputSchema: {
      lineNumber: z.string(),
      productId: z.string(),
      quantity: z.number().int().min(1).default(1),
      uom: z.string().default('C62'),
    },
  },
  async ({ lineNumber, productId, quantity, uom }) => {
    try {
      const data = await client.gql(`
        mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
          addItemToTrolley(orderId: $orderId, trolleyItem: $trolleyItem) {
            trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
            failures { message type }
          }
        }`, { orderId: client.orderId, trolleyItem: { lineNumber, productId, quantity: { amount: quantity, uom }, trolleyItemId: -parseInt(lineNumber, 10) } });

      const failures = data?.addItemToTrolley?.failures ?? [];
      if (failures.length) throw new Error(failures.map((f: any) => f.message).join(', '));
      const total = data?.addItemToTrolley?.trolley?.trolleyTotals?.itemTotalEstimatedCost;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, basketTotal: total ? `£${total.amount.toFixed(2)}` : null }) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `add_to_basket failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'update_quantity',
  {
    description: 'Change the quantity of an item already in the basket. Get trolleyItemId, lineNumber, productId and uom from get_trolley.',
    inputSchema: {
      trolleyItemId: z.number().int(),
      lineNumber: z.string(),
      productId: z.string(),
      quantity: z.number().int().min(1),
      uom: z.string().default('C62'),
    },
  },
  async ({ trolleyItemId, lineNumber, productId, quantity, uom }) => {
    try {
      const data = await client.gql(`
        mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
          updateTrolleyItem(orderId: $orderId, trolleyItem: $trolleyItem) {
            trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
            failures { message type }
          }
        }`, { orderId: client.orderId, trolleyItem: { trolleyItemId, lineNumber, productId, quantity: { amount: quantity, uom }, canSubstitute: true, personalisedMessage: null } });

      const failures = data?.updateTrolleyItem?.failures ?? [];
      if (failures.length) throw new Error(failures.map((f: any) => f.message).join(', '));
      const total = data?.updateTrolleyItem?.trolley?.trolleyTotals?.itemTotalEstimatedCost;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, basketTotal: total ? `£${total.amount.toFixed(2)}` : null }) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `update_quantity failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'remove_from_basket',
  {
    description: 'Remove an item from the basket. Get trolleyItemId, lineNumber, productId and uom from get_trolley.',
    inputSchema: {
      trolleyItemId: z.number().int(),
      lineNumber: z.string(),
      productId: z.string(),
      uom: z.string().default('C62'),
    },
  },
  async ({ trolleyItemId, lineNumber, productId, uom }) => {
    try {
      const data = await client.gql(`
        mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
          updateTrolleyItem(orderId: $orderId, trolleyItem: $trolleyItem) {
            trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
            failures { message type }
          }
        }`, { orderId: client.orderId, trolleyItem: { trolleyItemId, lineNumber, productId, quantity: { amount: 0, uom }, canSubstitute: true, personalisedMessage: null } });

      const failures = data?.updateTrolleyItem?.failures ?? [];
      if (failures.length) throw new Error(failures.map((f: any) => f.message).join(', '));
      const total = data?.updateTrolleyItem?.trolley?.trolleyTotals?.itemTotalEstimatedCost;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, basketTotal: total ? `£${total.amount.toFixed(2)}` : null }) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `remove_from_basket failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'empty_trolley',
  { description: 'Remove all items from the basket at once.' },
  async () => {
    try {
      const data = await client.gql(
        `mutation($orderId: ID!) { emptyTrolley(orderId: $orderId) { trolley { orderId } } }`,
        { orderId: client.orderId }
      );
      if (data?.errors?.length) throw new Error(data.errors.map((e: any) => e.message).join(', '));
      // Sync new orderId from session after empty
      await client.syncOrderId();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `empty_trolley failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'get_orders',
  {
    description: 'List past and active Waitrose orders, most recent first.',
    inputSchema: { size: z.number().int().min(1).max(50).default(15) },
  },
  async ({ size }) => {
    try {
      const result = await client.fetch('GET', `/api/order-orchestration-prod/v1/orders?size=${size}&sortBy=%2B&statuses=${ORDER_STATUSES}`);
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
      const data = JSON.parse(result.body);
      const orders = (data.content ?? []).map((o: any) => ({
        orderId: o.customerOrderId,
        status: o.status,
        placedDate: o.created,
        deliveryDate: o.slots?.[0]?.startDateTime ?? null,
        itemCount: o.numberOfItems ?? null,
        total: o.totals?.estimated?.totalPrice?.amount != null ? `£${Number(o.totals.estimated.totalPrice.amount).toFixed(2)}` : null,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify({ orders }, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `get_orders failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'get_order_details',
  {
    description: 'Get full item list for a specific past order, with product names. Use orderId from get_orders.',
    inputSchema: { orderId: z.string() },
  },
  async ({ orderId }) => {
    try {
      const result = await client.fetch('GET', `/api/order-orchestration-prod/v1/orders/${orderId}`);
      if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
      const order = JSON.parse(result.body);
      const rawItems = order.orderLines ?? [];
      const nameMap = await lookupProducts(rawItems.map((l: any) => l.lineNumber));
      const items = rawItems.map((l: any) => {
        const p = nameMap.get(l.lineNumber);
        return { lineNumber: l.lineNumber, name: p?.name ?? null, size: p?.size ?? null, quantity: l.quantity?.amount ?? null, uom: l.quantity?.uom ?? 'C62', unitPrice: l.estimatedUnitPrice?.amount != null ? `£${Number(l.estimatedUnitPrice.amount).toFixed(2)}` : null, totalPrice: l.estimatedTotalPrice?.amount != null ? `£${Number(l.estimatedTotalPrice.amount).toFixed(2)}` : null };
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ orderId: order.customerOrderId ?? orderId, status: order.status, placedDate: order.created, deliveryDate: order.slots?.[0]?.startDateTime ?? null, total: order.totals?.estimated?.totalPrice?.amount != null ? `£${Number(order.totals.estimated.totalPrice.amount).toFixed(2)}` : null, items }, null, 2) }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `get_order_details failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'api_call',
  {
    description: 'Make an authenticated HTTP request to any Waitrose API endpoint. Use for exploration or endpoints not covered by a dedicated tool.',
    inputSchema: {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
      path: z.string().describe('API path, e.g. /api/delivery-pass-orchestration-prod/v1/pass/status'),
      body: z.string().optional(),
    },
  },
  async ({ method, path, body }) => {
    try {
      const result = await client.fetch(method, path, body);
      let parsed: any;
      try { parsed = JSON.parse(result.body); } catch { parsed = result.body; }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: result.status, body: parsed }, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `api_call failed: ${e.message}` }], isError: true };
    }
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[shopme] MCP server running, WebSocket on port ${WS_PORT}`);
