import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { readFileSync } from 'fs';

const WS_PORT = 18321;

// --- Extension connection ---

let extensionWs: WebSocket | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: Error) => void }
>();

const wss = new WebSocketServer({ port: WS_PORT });

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

// --- HAR store ---

interface HarEntry {
  url: string;
  method: string;
  status: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  mimeType: string;
  time: number;
}

let harEntries: HarEntry[] = [];

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

server.tool('get_storage', 'Get all browser storage for the Waitrose tab: cookies, localStorage, and sessionStorage.', {}, async () => {
  try {
    const result = await sendToExtension('get_storage');
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Failed: ${e.message}` }], isError: true };
  }
});

server.tool(
  'get_token',
  'Read the Bearer JWT captured by the content script from the Waitrose tab. Reload the Waitrose page first to let the content script hook the SPA fetch calls.',
  {},
  async () => {
    try {
      const result = await sendToExtension('get_tab_token');
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Failed: ${e.message}` }], isError: true };
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

server.tool(
  'load_har',
  'Load a HAR file exported from Chrome DevTools (Network tab → right-click → Save all as HAR with content). Replaces any previously loaded HAR.',
  { path: z.string().describe('Absolute path to the .har file') },
  async ({ path }) => {
    try {
      const raw = readFileSync(path, 'utf8');
      const har = JSON.parse(raw);
      const entries: HarEntry[] = har.log.entries
        .filter((e: any) => e.request.url.includes('waitrose.com'))
        .map((e: any) => {
          const toHeaders = (arr: any[]) =>
            Object.fromEntries(arr.map((h: any) => [h.name, h.value]));
          return {
            url: e.request.url,
            method: e.request.method,
            status: e.response.status,
            requestHeaders: toHeaders(e.request.headers),
            responseHeaders: toHeaders(e.response.headers),
            requestBody: e.request.postData?.text,
            responseBody: e.response.content?.text,
            mimeType: e.response.content?.mimeType ?? '',
            time: e.time,
          };
        });
      harEntries = entries;
      return { content: [{ type: 'text' as const, text: `Loaded ${entries.length} Waitrose requests from HAR.` }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Failed to load HAR: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'query_har',
  'Query the loaded HAR entries. Filter by URL substring, HTTP method, or resource type. Returns matching entries including request/response bodies.',
  {
    filter: z.string().optional().describe('URL substring filter (e.g. "graphql", "search", "trolley")'),
    method: z.string().optional().describe('HTTP method filter (e.g. "POST", "GET")'),
    mime: z.string().optional().describe('Response MIME type filter (e.g. "application/json")'),
  },
  async ({ filter, method, mime }) => {
    let results = [...harEntries];
    if (filter) results = results.filter(r => r.url.includes(filter));
    if (method) results = results.filter(r => r.method.toUpperCase() === method.toUpperCase());
    if (mime) results = results.filter(r => r.mimeType.includes(mime));
    const summary = `${results.length} entries${filter ? ` matching "${filter}"` : ''}`;
    return {
      content: [
        { type: 'text' as const, text: summary },
        { type: 'text' as const, text: JSON.stringify(results, null, 2) },
      ],
    };
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[shopme] MCP server running, WebSocket on port ${WS_PORT}`);
