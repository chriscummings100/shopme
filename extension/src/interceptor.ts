// Runs in MAIN (page) world — can patch native fetch and XHR.
// Sends captured bodies to the isolated content script via postMessage.

const MSG_TYPE = '__shopme_body__';

function postCapture(data: {
  url: string;
  method: string;
  requestBody?: string;
  responseBody?: string;
  status: number;
}) {
  window.postMessage({ type: MSG_TYPE, data }, '*');
}

function isWaitrose(url: string) {
  return url.includes('waitrose.com');
}

function bodyToString(body: BodyInit | null | undefined): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return '[binary]';
}

// --- Patch fetch ---

const _fetch = window.fetch.bind(window);
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (!isWaitrose(url)) return _fetch(input, init);

  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const requestBody = bodyToString(init?.body ?? (input instanceof Request ? input.body as any : undefined));

  const response = await _fetch(input, init);

  let responseBody: string | undefined;
  try {
    const ct = response.headers.get('content-type') ?? '';
    if (ct.includes('application/json') || ct.includes('text/')) {
      responseBody = await response.clone().text();
    }
  } catch { /* ignore */ }

  postCapture({ url, method, requestBody, responseBody, status: response.status });
  return response;
};

// --- Patch XMLHttpRequest ---

const _XHR = window.XMLHttpRequest;
class PatchedXHR extends _XHR {
  private _url = '';
  private _method = '';
  private _reqBody: string | undefined;

  open(method: string, url: string | URL, async = true, user?: string | null, password?: string | null) {
    this._method = method;
    this._url = url.toString();
    super.open(method, url, async, user ?? null, password ?? null);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    if (isWaitrose(this._url)) {
      if (body && typeof body === 'string') this._reqBody = body;

      this.addEventListener('load', () => {
        const ct = this.getResponseHeader('content-type') ?? '';
        let responseBody: string | undefined;
        if (ct.includes('application/json') || ct.includes('text/')) {
          try { responseBody = this.responseText; } catch { /* ignore */ }
        }
        postCapture({
          url: this._url,
          method: this._method.toUpperCase(),
          requestBody: this._reqBody,
          responseBody,
          status: this.status,
        });
      });
    }
    super.send(body as any);
  }
}
(window as any).XMLHttpRequest = PatchedXHR;
