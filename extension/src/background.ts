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
              return { local, session };
            },
          }),
        ]);
        reply(id, 'storage', { cookies, ...storage[0]?.result });
      } catch (e: any) {
        reply(id, 'error', { message: `get_storage failed: ${e.message}` });
      }
      break;
    }

    case 'get_tab_token': {
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.waitrose.com/*' });
        if (!tabs.length || tabs[0].id == null) {
          reply(id, 'error', { message: 'No Waitrose tab found' });
          break;
        }
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id! },
          world: 'MAIN',
          func: () => {
            // Token is baked into SSR HTML as inline <script> text — __PRELOADED_STATE__
            // gets overwritten with `true` by the SPA later, so read the raw script text.
            let fromScript: string | null = null;
            for (const s of Array.from(document.scripts)) {
              if (!s.textContent.includes('__PRELOADED_STATE__')) continue;
              const m = s.textContent.match(/"accessToken"\s*:\s*"(Bearer [^"]+)"/);
              if (m) { fromScript = m[1]; break; }
            }
            // Fall back to content script hook (for refreshed tokens)
            const fromHook = (window as any).__shopmeToken__
              ? `Bearer ${(window as any).__shopmeToken__}`
              : null;
            return fromScript ?? fromHook ?? null;
          },
        });
        const token: string | null = results[0]?.result ?? null;
        if (token) {
          // Strip "Bearer " prefix if present — callers add it themselves
          const jwt = token.startsWith('Bearer ') ? token.slice(7) : token;
          reply(id, 'token', { accessToken: jwt });
        } else {
          reply(id, 'error', { message: 'No token found — reload the Waitrose tab' });
        }
      } catch (e: any) {
        reply(id, 'error', { message: `get_tab_token failed: ${e.message}` });
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
        const { method, path, body } = data as { method: string; path: string; body?: string };
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id! },
          func: async (method: string, path: string, body: string | null) => {
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
              return { ok: true, status: res.status, body: text };
            } catch (e: any) {
              return { ok: false, error: e.message };
            }
          },
          args: [method, path, body ?? null],
        });
        const result = results[0]?.result as any;
        if (!result) {
          reply(id, 'error', { message: 'executeScript returned no result' });
        } else if (!result.ok) {
          reply(id, 'error', { message: `Tab fetch error: ${result.error}` });
        } else {
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
