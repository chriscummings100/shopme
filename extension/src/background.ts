const WS_URL = 'ws://localhost:18321';

let ws: WebSocket | null = null;
let connected = false;

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

// --- Message handling ---

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

// --- Popup status ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'get_status') {
    sendResponse({ connected });
  }
  return false;
});

// --- Keep WebSocket alive across alarm firings ---

chrome.alarms.create('keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && !connected) connect();
});

connect();
