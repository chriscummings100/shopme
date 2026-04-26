const WS_URL = 'ws://localhost:18321';

// Resource types worth streaming — skip images, fonts, stylesheets, scripts
const STREAM_TYPES = new Set(['xmlhttprequest', 'fetch', 'main_frame', 'sub_frame']);

let ws: WebSocket | null = null;
let connected = false;

interface InflightRequest {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  requestBody?: chrome.webRequest.WebRequestBody | null;
  timestamp: number;
}

const inflightRequests = new Map<string, InflightRequest>();

// --- WebSocket ---

function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    console.log('[ShopMe] Connected to host');
  };

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data as string));
    } catch (e) {
      console.error('[ShopMe] Bad message:', e);
    }
  };

  ws.onclose = () => {
    const wasConnected = connected;
    connected = false;
    ws = null;
    if (wasConnected) console.log('[ShopMe] Disconnected from host');
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose fires next */ };
}

function scheduleReconnect() {
  setTimeout(connect, 3000);
}

function send(msg: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function reply(id: string, type: string, data: unknown) {
  send({ id, type, data });
}

// --- Request handling ---

async function handleMessage(msg: { id: string; type: string; data?: any }) {
  const { id, type, data } = msg;

  switch (type) {
    case 'ping':
      reply(id, 'pong', { ok: true });
      break;

    case 'navigate': {
      const tabs = await chrome.tabs.query({ url: '*://*.waitrose.com/*' });
      if (tabs.length > 0 && tabs[0].id != null) {
        await chrome.tabs.update(tabs[0].id, { url: data.url, active: true });
      } else {
        await chrome.tabs.create({ url: data.url });
      }
      reply(id, 'navigate_result', { ok: true });
      break;
    }

    case 'get_cookies': {
      const cookies = await chrome.cookies.getAll({ domain: '.waitrose.com' });
      reply(id, 'cookies', cookies);
      break;
    }

    default:
      reply(id, 'error', { message: `Unknown message type: ${type}` });
  }
}

// --- Internal messages ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'get_status') {
    sendResponse({ connected });
    return false;
  }
  if (message.type === 'body_capture') {
    send({ type: 'body_event', data: message.data });
  }
  return false;
});

// --- Traffic streaming ---
// The extension is stateless — it streams all XHR/fetch traffic immediately to the host.
// The host decides what to accumulate. No capturing flag, no buffer here.

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!STREAM_TYPES.has(details.type)) return;
    inflightRequests.set(details.requestId, {
      id: details.requestId,
      url: details.url,
      method: details.method,
      resourceType: details.type,
      requestBody: details.requestBody,
      timestamp: Date.now(),
    });
  },
  { urls: ['*://*.waitrose.com/*'] },
  ['requestBody']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const req = inflightRequests.get(details.requestId);
    if (req && details.requestHeaders) {
      req.requestHeaders = {};
      for (const h of details.requestHeaders) {
        req.requestHeaders[h.name] = h.value ?? '';
      }
    }
  },
  { urls: ['*://*.waitrose.com/*'] },
  ['requestHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const req = inflightRequests.get(details.requestId);
    if (!req) return;
    inflightRequests.delete(details.requestId);

    const responseHeaders: Record<string, string> = {};
    for (const h of details.responseHeaders ?? []) {
      responseHeaders[h.name] = h.value ?? '';
    }

    send({
      type: 'traffic_event',
      data: { ...req, statusCode: details.statusCode, responseHeaders },
    });
  },
  { urls: ['*://*.waitrose.com/*'] },
  ['responseHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => { inflightRequests.delete(details.requestId); },
  { urls: ['*://*.waitrose.com/*'] }
);

// --- Keep WebSocket alive across alarm firings ---

chrome.alarms.create('keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && !connected) connect();
});

connect();
