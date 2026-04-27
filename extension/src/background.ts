const WS_URL = 'ws://localhost:18321';

let ws: WebSocket | null = null;
let connected = false;

// --- Cached state for popup ---
let lastPingTime: number | null = null;
let cachedCustomerId = '';
let cachedOrderId = '';
let cachedToken = '';

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
      const msg = JSON.parse(event.data as string);
      console.log('[ShopMe] Message received:', msg.type, msg.id);
      handleMessage(msg);
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
      lastPingTime = Date.now();
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

    case 'get_storage': {
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.waitrose.com/*' });
        if (!tabs.length || tabs[0].id == null) {
          reply(id, 'error', { message: 'No Waitrose tab found' });
          break;
        }
        const [cookies, storage] = await Promise.all([
          chrome.cookies.getAll({ domain: '.waitrose.com' }),
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id! },
            world: 'MAIN',
            func: () => {
              const local: Record<string, string> = {};
              const session: Record<string, string> = {};
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i)!;
                local[k] = localStorage.getItem(k) ?? '';
              }
              for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i)!;
                session[k] = sessionStorage.getItem(k) ?? '';
              }
              // If wtr_order_id was cleared (SPA sets "undefined" after emptyTrolley),
              // fall back to scanning the SSR __PRELOADED_STATE__ script element.
              if (!local['wtr_order_id'] || local['wtr_order_id'] === 'undefined') {
                for (const s of Array.from(document.scripts)) {
                  const t = s.textContent;
                  if (!t.includes('customerOrderId')) continue;
                  const m = t.match(/"customerOrderId"\s*:\s*"(\d+)"/);
                  if (m) { local['wtr_order_id'] = m[1]; break; }
                }
              }
              return { local, session };
            },
          }),
        ]);
        const storageResult = storage[0]?.result as any ?? {};
        cachedCustomerId = storageResult.local?.wtr_customer_id ?? cachedCustomerId;
        cachedOrderId = storageResult.local?.wtr_order_id ?? cachedOrderId;
        reply(id, 'storage', { cookies, ...storageResult });
      } catch (e: any) {
        reply(id, 'error', { message: `get_storage failed: ${e.message}` });
      }
      break;
    }

    case 'fetch_from_tab': {
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.waitrose.com/*' });
        if (!tabs.length || tabs[0].id == null) {
          reply(id, 'error', { message: 'No Waitrose tab found — open waitrose.com first' });
          break;
        }
        const tabId = tabs[0].id!;
        const { method, path, body } = data as { method: string; path: string; body?: string };

        const tabFetchScript = async (method: string, path: string, body: string | null) => {
          try {
            let fromScript: string | null = null;
            for (const s of Array.from(document.scripts)) {
              if (!s.textContent.includes('__PRELOADED_STATE__')) continue;
              const m = s.textContent.match(/"accessToken"\s*:\s*"Bearer ([^"]+)"/);
              if (m) { fromScript = m[1]; break; }
            }
            const token: string | null = fromScript ?? (window as any).__shopmeToken__ ?? null;
            const headers: Record<string, string> = {
              origin: 'https://www.waitrose.com',
              referer: location.href,
              breadcrumb: 'shopme',
              features: 'enAppleWallet',
              graphflags: '{}',
            };
            if (token) headers['authorization'] = `Bearer ${token}`;
            if (body) headers['content-type'] = 'application/json';
            const res = await fetch(path, { method, headers, credentials: 'include', body: body ?? undefined });
            const text = await res.text();
            return { ok: true, status: res.status, body: text, token };
          } catch (e: any) {
            return { ok: false, error: e.message };
          }
        };

        let results = await chrome.scripting.executeScript({ target: { tabId }, func: tabFetchScript, args: [method, path, body ?? null] });
        let result = results[0]?.result as any;

        if (result?.ok && result.status === 401) {
          console.log('[ShopMe] 401 received — reloading tab for fresh token');
          await new Promise<void>((resolve) => {
            chrome.tabs.onUpdated.addListener(function listener(updatedId, info) {
              if (updatedId === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            });
            chrome.tabs.reload(tabId);
          });
          await new Promise(r => setTimeout(r, 1500));
          results = await chrome.scripting.executeScript({ target: { tabId }, func: tabFetchScript, args: [method, path, body ?? null] });
          result = results[0]?.result as any;
          console.log('[ShopMe] Retry after reload, status:', result?.status);
        }

        if (!result) {
          reply(id, 'error', { message: 'executeScript returned no result' });
        } else if (!result.ok) {
          reply(id, 'error', { message: `Tab fetch error: ${result.error}` });
        } else {
          if (result.token) cachedToken = result.token;
          reply(id, 'fetch_result', { status: result.status, body: result.body });
        }
      } catch (e: any) {
        reply(id, 'error', { message: `fetch_from_tab failed: ${e.message}` });
      }
      break;
    }

    default:
      reply(id, 'error', { message: `Unknown message type: ${type}` });
  }
}

// --- Popup status ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'get_status') {
    const tokenPreview = cachedToken
      ? cachedToken.slice(0, 12) + '…'
      : null;
    sendResponse({ connected, customerId: cachedCustomerId, orderId: cachedOrderId, tokenPreview, lastPingTime });
  }
  return false;
});

// --- Keep WebSocket alive across alarm firings ---

chrome.alarms.create('keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && !connected) connect();
});

connect();
