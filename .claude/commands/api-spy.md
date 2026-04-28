Reverse-engineer the authentication and JSON API of a website by observing network traffic in a live Chrome session.

---

## Goal
Capture network traffic while the user browses a site, then analyse it to identify auth tokens, session mechanisms, and API endpoints — with the aim of being able to reproduce API calls programmatically.

## Usage
`/api-spy <url>` — target URL is optional; you will ask if not provided.

---

## Phase 1 — Setup

### 1a — Target URL
If `$ARGUMENTS` is provided, use it as the starting URL. Otherwise ask: **"What URL would you like to reverse-engineer?"**

### 1b — Output directory
Create `./api-spy-output/` if it does not exist:
```bash
mkdir -p ./api-spy-output
```

### 1c — Open a clean browser context
Use `new_page` with `isolatedContext: "api-spy"` and `url` set to the target. This gives a fresh context with no pre-existing cookies or storage.

Take a screenshot and confirm the page loaded.

### 1d — Detect site type (SPA vs multi-page)
After the page settles, call `list_network_requests` with `resourceTypes: ["document"]`.
- **1 document request** → likely a **SPA** (single-page app). All XHR/fetch requests accumulate in one capture window. Dump once at the end.
- **Multiple document requests** (or you see full reloads when clicking links) → **multi-page site**. You must dump the network log *before* each navigation, or you will lose requests from previous pages (only the last 3 navigations are preserved).

Tell the user which type you detected.

---

## Phase 2 — Observation

### 2a — Brief the user
Tell the user:

> "The browser is ready at [URL]. Please:
> 1. Log in to the site
> 2. Perform the key actions you want me to analyse (e.g. search, view account, add to cart)
> 3. Tell me when you're done — or, on a multi-page site, tell me *before* you click any link that loads a new page so I can save the log first."

### 2b — Multi-page: checkpoint on each navigation
If this is a multi-page site and the user signals they are about to navigate:
1. Run Phase 3 immediately (dump to file, with a `--append` flag so data accumulates).
2. Confirm the dump completed, then tell the user to proceed.

### 2c — Navigate within the site if needed
You can click links on behalf of the user:
1. Call `take_snapshot` to get element UIDs.
2. Call `click` with the relevant UID.
3. Call `wait_for` with text expected on the next page, then take a screenshot to confirm.

Always dump the network log before clicking a link that will load a new page on a multi-page site.

### 2d — Wait for user signal
Wait for the user to say they are done.

---

## Phase 3 — Dump to files

Run these in parallel:

### 3a — Network request list
Call `list_network_requests` with `resourceTypes: ["document", "xhr", "fetch", "websocket", "prefetch", "other"]`.
Write the full text result to `./api-spy-output/raw_requests.txt`.
If appending (multi-page checkpoint), append with a separator line `\n--- CHECKPOINT ---\n`.

### 3b — Storage and cookies
Call `evaluate_script` with:
```js
() => {
  const local = {}, session = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      local[k] = localStorage.getItem(k);
    }
  } catch(e) {}
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      session[k] = sessionStorage.getItem(k);
    }
  } catch(e) {}
  return {
    cookies: document.cookie,
    localStorage: local,
    sessionStorage: session
  };
}
```
Write the JSON result to `./api-spy-output/storage.json`.

### 3c — Embedded page state
Call `evaluate_script` with:
```js
() => {
  const blobs = {};
  document.querySelectorAll('script[type="application/json"], script[id]').forEach(s => {
    const t = s.textContent.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      blobs[s.id || s.getAttribute('type')] = t.slice(0, 4000);
    }
  });
  return {
    __NEXT_DATA__:      window.__NEXT_DATA__      ?? null,
    __INITIAL_STATE__:  window.__INITIAL_STATE__  ?? null,
    __REDUX_STATE__:    window.__REDUX_STATE__     ?? null,
    __NUXT__:           window.__NUXT__            ?? null,
    scriptBlobs:        blobs
  };
}
```
Write the JSON result to `./api-spy-output/page_state.json`.

---

## Phase 4 — Preprocess with script

Run:
```bash
.conda/python.exe scripts/network_filter.py \
  --input ./api-spy-output/raw_requests.txt \
  --output ./api-spy-output/summary.json \
  --domain <the target domain, e.g. example.com>
```

Read `./api-spy-output/summary.json` into context. This is the compact, filtered view you will reason about. Do **not** bring `raw_requests.txt` into context directly.

---

## Phase 5 — Deep-dive on interesting requests

From the summary, identify the most important requests:
- The **login / token endpoint** (POST that returns a token or sets an auth cookie)
- **API endpoints** returning JSON on the same domain (XHR/fetch, status 200)
- Any **CSRF token fetch** or **session refresh** endpoints
- Any **WebSocket upgrade** requests

For each (typically 5–20 requests), call `get_network_request` with:
- `reqid`: from the summary
- `responseFilePath`: `./api-spy-output/req_<reqid>_response.json`

Do **not** read all the files at once. Read them one at a time, focusing on:
- Request headers: `Authorization`, `X-CSRF-Token`, `x-api-key`, `Cookie`, any `X-*` headers
- Response: token fields, user data, session identifiers
- `Set-Cookie` headers in the response

---

## Phase 6 — Auth pattern identification

Cross-reference what you found across the request files, storage dump, and page state:

| Pattern | Where to look |
|---------|--------------|
| Session cookie | `Set-Cookie` on login response; `Cookie` header on subsequent requests |
| Bearer / JWT | `Authorization: Bearer …` on API requests; login response body or `localStorage` |
| CSRF token | Initial document or dedicated `/csrf` endpoint; `X-CSRF-Token` request header |
| API key | Static value in every request header or embedded in JS globals |
| OAuth / SSO | Redirect chain in document requests; `code` / `state` params |

Decode any JWTs found (split on `.`, base64-decode the middle part) to understand scopes, expiry, and user identifiers.

---

## Phase 7 — Write analysis

Write `./api-spy-output/api_analysis.md` with:

1. **Auth mechanism** — how to obtain credentials from scratch (endpoint, request shape, what is returned)
2. **Required headers** — what every authenticated request must carry
3. **Key endpoints** — method, URL pattern, required headers, brief request/response shape
4. **Token lifecycle** — expiry, refresh mechanism if any
5. **Suggested implementation order** — auth first, then which endpoints to call

Report back to the user with:
- A one-paragraph summary of findings
- The location of `api_analysis.md` for the full details

---

## Rules

- **Write before reasoning.** Never hold a large raw dump in context. Write to file, run the script, read the compact summary.
- **Clicking links is navigation.** Use `take_snapshot` to find link UIDs, then `click`. On multi-page sites, always dump first.
- **Selective reads.** Read response files one at a time, not all at once.
- **Don't guess auth patterns.** Trace tokens through the actual captured data.
- **Binary responses.** If a response body is not JSON or text, note it and skip the body.
- **WebSockets.** Note the WS URL and any message framing visible in the upgrade request; full message capture is not available via these tools.
- **If nothing is captured.** The capture window resets on navigation. If the request list is empty after a multi-page flow, tell the user and offer to repeat with checkpoint dumps.
