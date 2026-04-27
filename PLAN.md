# ShopMe - Project Plan

AI-powered shopping assistant for Waitrose, built as a Chrome extension that exposes an MCP server.

## Architecture

```
┌─────────────┐       stdio        ┌──────────────────┐   WebSocket (localhost)  ┌─────────────────┐
│  AI Agent   │ ◄─────────────────► │  MCP Server      │ ◄─────────────────────► │ Chrome Extension│
│  (Claude)   │                     │  (Node.js host)  │       port 18321        │ (Manifest V3)   │
└─────────────┘                     └──────────────────┘                         └────────┬────────┘
                                                                                          │
                                                                                ┌─────────▼────────┐
                                                                                │  Waitrose.com    │
                                                                                │  (live browser)  │
                                                                                └──────────────────┘
```

### Components

1. **Chrome Extension (Manifest V3)** — Stateless service worker. Executes fetch requests inside the Waitrose tab (bypassing CORS and bot detection), navigates the browser, reads storage. Popup shows live connection status, customer ID, order ID, token preview, and last ping time.

2. **MCP Server / Host (Node.js)** — Single stable process serving MCP over stdio (for Claude) and WebSocket on localhost:18321 (for the extension). Translates MCP tool calls into WebSocket messages to the extension. Sends an application-level keepalive ping every 25s to keep the MV3 service worker alive.

3. **Content Script** — Runs at `document_start` in MAIN world on all waitrose.com pages. Hooks `window.fetch` to capture refreshed JWTs into `window.__shopmeToken__` as the SPA refreshes its auth.

### Core Principles

- **Fetch from tab**: All API calls are executed inside the live Waitrose browser tab via `chrome.scripting.executeScript`. This means session cookies and auth headers are applied automatically, and Akamai bot detection sees a real browser request.
- **JWT from SSR**: The Bearer token is extracted from the inline `<script>` element that sets `window.__PRELOADED_STATE__`, via regex on the script text. The SPA overwrites this global with `true` after boot, but the script element text remains.
- **Extension is stateless**: All durable state lives in the host process. The extension caches key values (customerId, orderId, token preview) in memory for the popup only.
- **MCP as the interface**: Any MCP-compatible agent can drive this.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension | TypeScript, Manifest V3, Chrome APIs |
| Content script | TypeScript, IIFE, injected at document_start in MAIN world |
| MCP Server / Host | Node.js / TypeScript, `@modelcontextprotocol/sdk`, `ws` |
| Build | esbuild |

## Waitrose API Reference

Discovered via Chrome DevTools Network capture. Base URL: `https://www.waitrose.com`.

### Auth

**JWT source**: Extracted from the SSR-rendered `<script>` tag that contains `window.__PRELOADED_STATE__ = JSON.parse('...')`. The token lives at `"accessToken": "Bearer eyJ..."` inside that JSON blob. Falls back to `window.__shopmeToken__` (captured by content script hook) for refreshed tokens.

All authenticated requests require:
- `Authorization: Bearer <jwt>` — extracted as above
- Session cookies — applied automatically via `credentials: 'include'` on all tab fetches
- Custom headers: `breadcrumb`, `features: enAppleWallet`, `graphflags: {}`

JWT expires after ~15 minutes. On 401, the extension automatically reloads the Waitrose tab to get a fresh SSR token and retries the request.

**Token refresh endpoint** (not yet implemented — optimization over current reload approach):
`POST /api/token-client-prod/v1/token?clientType=WEB_APP`
Headers: `Authorization: Bearer unauthenticated`, `x-csrf-token: <csrf>`
The `x-csrf-token` is a page-specific token — likely sourced from a cookie or localStorage (not yet identified). Implementing this would allow token refresh without a full page reload.

**Order ID source**: Read from `localStorage.wtr_order_id`. If the SPA clears this (e.g. after `emptyTrolley`), falls back to scanning script elements for `"customerOrderId": "<id>"`.

### Product Search

`POST /api/content-prod/v2/cms/publish/productcontent/search/{customerId}?clientType=WEB_APP`

```json
{
  "customerSearchRequest": {
    "queryParams": {
      "size": 10,
      "searchTerm": "milk",
      "sortBy": "MOST_POPULAR",
      "searchTags": [],
      "filterTags": [],
      "orderId": "1066251787",
      "categoryLevel": 1
    }
  }
}
```

Sort values: `MOST_POPULAR`, `PRICE_LOW_TO_HIGH`, `PRICE_HIGH_TO_LOW`, `RATING`

Response: `componentsAndProducts[]` — mix of `searchProduct` and `aemComponent` items. Filter to `searchProduct` entries. Key fields: `id`, `lineNumber`, `name`, `size`, `displayPrice`, `displayPriceQualifier`, `promotion`, `defaultQuantity.uom`.

### Trolley — Get

`POST /api/graphql-prod/graph/live?clientType=WEB_APP&tag=get-trolley`

```graphql
query($orderId: ID!) {
  getTrolley(orderId: $orderId) {
    trolley {
      orderId
      trolleyItems { trolleyItemId lineNumber productId quantity { amount uom } totalPrice { amount currencyCode } }
      trolleyTotals { itemTotalEstimatedCost { amount currencyCode } savingsFromOffers { amount currencyCode } }
    }
  }
}
```

### Trolley — Add Item

`POST /api/graphql-prod/graph/live?clientType=WEB_APP&tag=add-item`

```graphql
mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
  addItemToTrolley(orderId: $orderId, trolleyItem: $trolleyItem) {
    trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
    failures { message type }
  }
}
```

Variables: `trolleyItem: { lineNumber, productId, quantity: { amount, uom }, trolleyItemId: -parseInt(lineNumber) }`

`trolleyItemId` for a **new** item is the **negative of its lineNumber** as an integer. Adding an existing item (by lineNumber) resets its quantity to the specified amount rather than incrementing.

### Trolley — Update / Remove Item

`POST /api/graphql-prod/graph/live?clientType=WEB_APP&tag=updateTrolleyItem`

Same mutation shape but uses the real positive `trolleyItemId` from getTrolley. Also requires `canSubstitute: true, personalisedMessage: null`. Set `quantity.amount: 0` to remove.

### Trolley — Empty

`POST /api/graphql-prod/graph/live?clientType=WEB_APP&tag=empty-trolley`

```graphql
mutation($orderId: ID!) { emptyTrolley(orderId: $orderId) { trolley { orderId } } }
```

### Other Endpoints

- `GET /api/delivery-pass-orchestration-prod/v1/pass/status` — delivery pass status
- `GET /api/slot-orchestration-prod/v1/slot-reservations?customerOrderId={orderId}` — delivery slot
- `GET /api/memberships-prod/v2/memberships` — MyWaitrose membership
- `GET /api/order-orchestration-prod/v1/orders?size=15&sortBy=%2B&statuses=...` — order history
- `GET /api/favourites2-prod/v2/favourites?includes=bought-online%2Cuser-selected` — favourites

---

## Progress

### Phase 1: Scaffold & Messaging — COMPLETE

- Chrome extension (MV3): stateless service worker, WebSocket bridge to host
- MCP host: stdio MCP server + WebSocket bridge, launched via `.mcp.json`
- Build pipeline: esbuild for extension (iife) + host (esm with CJS shim for `ws`)

### Phase 2: Auth & Direct API Access — COMPLETE

- JWT extracted from SSR `<script>` element text (not `window.__PRELOADED_STATE__` which the SPA overwrites)
- Content script hooks `window.fetch` to capture refreshed tokens into `window.__shopmeToken__`
- All API calls executed inside the Waitrose tab via `chrome.scripting.executeScript` with `credentials: 'include'`
- orderId read from `localStorage.wtr_order_id` with fallback to `customerOrderId` in script elements
- HAR tools removed (served their purpose, no longer needed)
- Extension popup shows: connection status, customerId, orderId, token preview, last ping time
- Application-level keepalive ping every 25s keeps MV3 service worker alive

### Phase 3: Product Search — COMPLETE

- `search_products` tool: returns clean list of products with id, lineNumber, name, size, price, promotion, uom

### Phase 4: Basket Management — COMPLETE

- `get_trolley` — current basket contents with product names, sizes, prices, totals, savings
- `add_to_basket` — add by lineNumber + productId + quantity (quantity works for new items)
- `update_quantity` — change quantity of existing item using real trolleyItemId
- `remove_from_basket` — set quantity to 0
- `empty_trolley` — clear all items at once (useful for resetting to a known state)

### Current MCP Tools

| Tool | Description |
|---|---|
| `ping` | Check extension is connected |
| `navigate` | Navigate browser to a Waitrose URL |
| `get_shopping_context` | Get customerId and orderId |
| `search_products` | Search for products |
| `get_trolley` | Read current basket (includes product names) |
| `add_to_basket` | Add item to basket |
| `update_quantity` | Update quantity of basket item |
| `remove_from_basket` | Remove item from basket |
| `empty_trolley` | Clear entire basket |
| `api_call` | Raw authenticated API call (exploration) |

### Phase 5: Order History — IN PROGRESS

- `get_orders` — list past and active orders (COMPLETE)
- `get_order_details` — items from a specific past order (COMPLETE)
- `reorder` — add all items from a past order to current basket

### Phase 6: Shopping List

- `parse_shopping_list` — photo or text → structured item list using Claude vision
- Feeds directly into search → add_to_basket workflow

### Phase 7: Agent Workflow Integration

- Composed workflows: "do my weekly shop from this photo"
- Smart matching: preferred brands, usual quantities from order history
- Confirmation gates before any checkout action
- Error recovery: out of stock → suggest alternatives

## Known Limitations / Gotchas

- **JWT expiry**: Token from SSR page expires ~15 min. The content script hook captures refreshed tokens automatically during SPA navigation, but if the tab is idle a page reload is needed.
- **orderId after emptyTrolley**: SPA sets `wtr_order_id` to the string `"undefined"` in localStorage. Fallback reads `customerOrderId` from script element.
- **Adding existing item**: `addItemToTrolley` resets quantity rather than incrementing. Use `update_quantity` to change an existing item's quantity.
- **navigate + immediate API call**: The page reload during navigation invalidates the current token until the new SSR loads. Wait for the page to settle before making API calls after `navigate`.
