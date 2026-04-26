# ShopMe - Project Plan

AI-powered shopping assistant for Waitrose, built as a Chrome/Edge extension that exposes an MCP server.

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

1. **Chrome Extension (Manifest V3)** — Stateless service worker. Provides auth cookies, navigates the browser for visual feedback, relays commands from the host. Holds no state — service workers are terminated by Chrome without warning.

2. **MCP Server / Host (Node.js)** — Single stable process serving MCP over stdio (for Claude) and WebSocket on localhost:18321 (for the extension). Makes direct HTTP/GraphQL calls to Waitrose using auth credentials obtained from the extension.

### Core Principles

- **API-first**: Agent interacts with Waitrose via their JSON/GraphQL APIs directly. Browser navigation is visual feedback only — not a data source.
- **Extension is stateless**: All state lives in the host process. The extension just relays and provides credentials.
- **MCP as the interface**: Any MCP-compatible agent can drive this.
- **WebSocket over Native Messaging**: No host registration needed; avoids stdio conflict with MCP protocol.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension | TypeScript, Manifest V3, Chrome APIs |
| MCP Server / Host | Node.js / TypeScript, `@modelcontextprotocol/sdk`, `ws` |
| Build | esbuild |

## Waitrose API Reference

Discovered via Chrome DevTools HAR export. Base URL: `https://www.waitrose.com`.

All authenticated endpoints require:
- `Authorization: Bearer <jwt>` header
- Customer ID embedded in some URLs (e.g. `705796347`)
- Order ID for trolley/basket operations (e.g. `1066251787`) — this is the current pending order

### Auth Flow

1. `GET /api/token-client-prod/v1/csrf`
   - No auth required
   - Returns a CSRF token

2. `POST /api/token-client-prod/v1/token`
   - Header: `X-CSRF-TOKEN: <token from step 1>`
   - Returns a Bearer JWT (expires ~15 minutes)
   - JWT contains `customerId`, `customerEmail`, `clientId`

JWT is then used as `Authorization: Bearer <jwt>` on all subsequent requests.

### Product Search

`POST /api/content-prod/v2/cms/publish/productcontent/search/{customerId}?clientType=WEB_APP`

Request body:
```json
{
  "customerSearchRequest": {
    "queryParams": {
      "size": 48,
      "searchTerm": "milk",
      "sortBy": "RELEVANCE",
      "searchTags": [],
      "filterTags": [],
      "orderId": "1066251787",
      "categoryLevel": 1
    }
  }
}
```

Sort values: `RELEVANCE`, `MOST_POPULAR`, `A_2_Z`, `PRICE_HIGH_TO_LOW`, `PRICE_LOW_TO_HIGH`

Response includes: product list with `lineNumber`, `productId`, name, price, availability.

Product IDs follow the pattern `{lineNumber}-{variantId1}-{variantId2}` e.g. `085519-43604-43605`.

### Search Autocomplete

`GET /api/term-suggest-prod/v1/term-suggest/terms?term=mil`

No auth required. Returns suggested search terms.

### Trolley — Get

`POST /api/graphql-prod/graph/live?clientType=WEB_APP&tag=get-trolley`

```graphql
query getTrolley($orderId: ID!) {
  getTrolley(orderId: $orderId) { ... }
}
```
Variables: `{ "orderId": "1066251787" }`

Response: full trolley with `trolleyItems[]` (each has `lineNumber`, `productId`, `trolleyItemId`, `quantity`), `trolleyTotals`, `conflicts[]`.

### Trolley — Add Item

`POST /api/graphql-prod/graph/live?clientType=WEB_APP&tag=add-item`

```graphql
mutation addItemToTrolley($orderId: ID!, $trolleyItem: TrolleyItemInput!) {
  addItemToTrolley(orderId: $orderId, trolleyItem: $trolleyItem) { trolley { ... } }
}
```
Variables:
```json
{
  "orderId": "1066251787",
  "trolleyItem": {
    "lineNumber": "085519",
    "productId": "085519-43604-43605",
    "quantity": { "amount": 1, "uom": "C62" },
    "trolleyItemId": -85519
  }
}
```

The `trolleyItemId` for a **new** item is the **negative of its `lineNumber`**. The server assigns a real positive ID on success, returned in the response.

### Trolley — Update / Remove Item

`POST /api/graphql-prod/graph/live?clientType=WEB_APP&tag=update-trolley-item`

Same shape as add-item, but:
- `trolleyItemId` is the **real positive ID** from the server (from getTrolley response)
- Set `quantity.amount: 0` to remove the item

### Order History

Active/upcoming orders:
`GET /api/order-orchestration-prod/v1/orders?size=15&sortBy=%2B&statuses=AMENDING%2BFULFIL%2BPAID%2BPAYMENT_FAILED%2BPICKED%2BPLACED`

Past orders:
`GET /api/order-orchestration-prod/v1/orders?size=15&statuses=COMPLETED%2BCANCELLED%2BREFUND_PENDING`

### Favourites

`GET /api/favourites2-prod/v2/favourites?includes=bought-online%2Cuser-selected&lastPurchase=gte%3A2025-03-26`

Favourites for current order (used for "shop from favourites" view):
`GET /api/favourites-experience-prod/v1/favourites/{orderId}?includes=bought-online%2Cuser-selected&size=48&sortBy=CATEGORY`

### Other Endpoints Observed

- `GET /api/delivery-pass-orchestration-prod/v1/pass/status` — delivery pass status
- `GET /api/slot-orchestration-prod/v1/slot-reservations?customerOrderId={orderId}` — delivery slot
- `GET /api/memberships-prod/v2/memberships` — MyWaitrose membership
- `GET /api/shopping-context-prod/v1/shopping-context` — current shopping context (includes orderId)

---

## Progress

### Phase 1: Scaffold, Messaging & API Discovery — COMPLETE

- Chrome extension (MV3): stateless service worker, connects to host via WebSocket, navigates browser, provides cookies
- MCP host: stdio MCP server + WebSocket bridge, launched automatically by Claude Code via `.mcp.json`
- `load_har` / `query_har` tools for analysing DevTools HAR exports
- API fully mapped via HAR capture (see above)
- Build pipeline: esbuild for extension (iife) + host (esm with CJS shim for `ws`)
- Key fix: esbuild CJS-in-ESM shim needed for `ws` package

### Phase 2: Auth & Direct API Access — NEXT

Goals:
- `get_session` tool: CSRF → Bearer JWT, returns ready-to-use auth headers
- `get_shopping_context` tool: returns current `customerId`, `orderId`
- `api_call` tool: generic authenticated request (for exploration/debugging)
- Store session in host memory, auto-refresh when JWT expires (~15 min)

### Phase 3: Product Search

- `search_products` — full pagination, all results via direct API
- `get_autocomplete` — term suggestions
- Browser navigates to search page as visual confirmation

### Phase 4: Basket Management

- `get_trolley` — current basket contents and totals
- `add_to_basket` — add by lineNumber + productId + quantity
- `update_quantity` — change quantity of existing item
- `remove_from_basket` — set quantity to 0
- Browser navigates to trolley page as visual confirmation

### Phase 5: Order History

- `get_orders` — active and past orders
- `get_order_details` — items from a specific order
- `reorder` — add all items from a past order to current basket

### Phase 6: Shopping List OCR

- `parse_shopping_list` — photo → structured item list using Claude vision
- Feeds directly into search → add_to_basket workflow

### Phase 7: Agent Workflow Integration

- Composed workflows: "do my weekly shop from this photo"
- Smart matching: preferred brands, usual quantities from order history
- Confirmation gates before any checkout action
- Error recovery: out of stock → suggest alternatives

## Testing Strategy

- **Extension**: Load unpacked in `chrome://extensions`, inspect service worker via DevTools
- **Host**: Run standalone (`npm run dev:host`), test tools directly from Claude Code
- **MCP**: Claude Code is the test client — call tools directly in conversation
- **HAR regression**: Re-export HAR after Waitrose updates to detect API changes
- **E2E**: Playwright with `--load-extension` for full chain verification
