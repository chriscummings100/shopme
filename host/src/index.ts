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

// Traffic accumulated in the host — stable, unlike the service worker
let capturedTraffic: any[] = [];
let capturedBodies: Map<string, { requestBody?: string; responseBody?: string; status: number }> = new Map();
let capturing = false;

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  extensionWs = ws;
  console.error('[shopme] Extension connected');

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    // Streamed traffic event from extension — accumulate if capturing
    if (msg.type === 'traffic_event') {
      if (capturing) capturedTraffic.push(msg.data);
      return;
    }

    // Request/response bodies from fetch/XHR interceptor
    if (msg.type === 'body_event') {
      if (capturing) {
        const key = `${msg.data.method}:${msg.data.url}`;
        capturedBodies.set(key, {
          requestBody: msg.data.requestBody,
          responseBody: msg.data.responseBody,
          status: msg.data.status,
        });
      }
      return;
    }

    // Response to a pending request
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve } = pendingRequests.get(msg.id)!;
      pendingRequests.delete(msg.id);
      resolve(msg.data);
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
      resolve: (data) => {
        clearTimeout(timeout);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    extensionWs.send(JSON.stringify({ id, type, data }));
  });
}

// --- MCP Server ---

const server = new McpServer({
  name: 'shopme',
  version: '0.1.0',
});

server.tool(
  'ping',
  'Check if the browser extension is connected and responding',
  {},
  async () => {
    try {
      await sendToExtension('ping');
      return { content: [{ type: 'text' as const, text: 'Extension is connected and responding.' }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Extension error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'navigate',
  'Navigate the browser to a URL on waitrose.com. Opens an existing Waitrose tab or creates a new one.',
  { url: z.string().describe('Full URL to navigate to, e.g. https://www.waitrose.com/') },
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
  'start_capture',
  'Start capturing XHR/fetch traffic streamed from the browser. Clears any previously captured traffic.',
  {},
  async () => {
    capturing = true;
    capturedTraffic = [];
    capturedBodies = new Map();
    return { content: [{ type: 'text' as const, text: 'Capture started. Browse Waitrose and traffic will stream in automatically. Call get_captured_traffic when done.' }] };
  }
);

server.tool(
  'stop_capture',
  'Stop accumulating captured traffic.',
  {},
  async () => {
    capturing = false;
    return { content: [{ type: 'text' as const, text: `Capture stopped. ${capturedTraffic.length} request(s) recorded.` }] };
  }
);

server.tool(
  'get_captured_traffic',
  'Return traffic captured since the last start_capture. Use filter to narrow by URL substring.',
  {
    filter: z.string().optional().describe('Optional substring to filter URLs (e.g. "api" or "search")'),
    resource_type: z.string().optional().describe('Filter by resource type: xmlhttprequest, fetch, main_frame'),
  },
  async ({ filter, resource_type }) => {
    let results = [...capturedTraffic];
    if (filter) results = results.filter((r: any) => r.url.includes(filter));
    if (resource_type) results = results.filter((r: any) => r.resourceType === resource_type);
    // Merge in request/response bodies captured by the page interceptor
    results = results.map((r: any) => {
      const key = `${r.method}:${r.url}`;
      const bodies = capturedBodies.get(key);
      return bodies ? { ...r, ...bodies } : r;
    });
    const summary = `${results.length} request(s)${filter ? ` matching "${filter}"` : ''}${resource_type ? ` of type "${resource_type}"` : ''}`;
    return {
      content: [
        { type: 'text' as const, text: summary },
        { type: 'text' as const, text: JSON.stringify(results, null, 2) },
      ],
    };
  }
);

server.tool(
  'get_cookies',
  'Get all cookies for .waitrose.com from the browser. Useful for understanding auth state and making direct API calls.',
  {},
  async () => {
    try {
      const cookies = await sendToExtension('get_cookies');
      return { content: [{ type: 'text' as const, text: JSON.stringify(cookies, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Failed: ${e.message}` }], isError: true };
    }
  }
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[shopme] MCP server running, WebSocket listening on port ${WS_PORT}`);
