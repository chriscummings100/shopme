// Runs in MAIN world at document_start — hooks fetch before the SPA loads
// so we capture the Bearer token as soon as the SPA makes its first API call.

const _origFetch = window.fetch.bind(window);
(window as any).__shopmeToken__ = null;

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.headers) {
    const auth =
      (init.headers as Record<string, string>)['Authorization'] ??
      (init.headers as Record<string, string>)['authorization'];
    if (auth?.startsWith('Bearer ')) {
      (window as any).__shopmeToken__ = auth.slice(7);
    }
  }
  return _origFetch(input, init);
};
