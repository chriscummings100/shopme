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

1. **Chrome Extension (Manifest V3)** — Service worker + content scripts. Provides auth/cookies, intercepts network traffic, and navigates the browser for visual feedback. Connects to the host via WebSocket.

2. **MCP Server / Host (Node.js)** — Single process that serves both the MCP protocol (stdio, for Claude) and a WebSocket server (localhost:18321, for the extension). Makes direct API calls to Waitrose using captured auth credentials.

### Core Principles

- **API-first**: The agent interacts with Waitrose primarily through their JSON APIs, using session credentials from the browser. This avoids limitations of DOM scraping (pagination, scroll-to-load, etc.).
- **Browser as visual feedback**: The browser navigates in parallel to show the user what's happening — a dashboard, not the primary data path.
- **MCP as the interface**: Any MCP-compatible AI agent can drive this.
- **WebSocket for extension ↔ host**: Simpler than Native Messaging (no host registration), avoids the stdio conflict (MCP already uses stdio). Localhost-only, single-client.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension | TypeScript, Manifest V3, Chrome APIs |
| MCP Server / Host | Node.js / TypeScript, `@modelcontextprotocol/sdk`, `ws` |
| Build | esbuild |
| Testing | Vitest + Playwright |

## Phases

### Phase 1: Scaffold, Messaging & API Discovery

Extension skeleton:
- Manifest V3 with permissions for `*.waitrose.com`
- Service worker connects to host via WebSocket (localhost:18321)
- Basic popup showing connection status

MCP host process:
- Node.js process serving MCP over stdio and WebSocket for the extension
- Bidirectional request/response messaging with the extension
- MCP tools: `ping`, `navigate`, `start_capture`, `stop_capture`, `get_captured_traffic`, `get_cookies`

API discovery tools (built into the extension from day one):
- Network interception via `chrome.webRequest` — observe all requests to Waitrose
- `start_capture` / `stop_capture` — toggle traffic recording
- `get_captured_traffic` — return captured API calls (URLs, methods, headers, response shapes)
- `navigate` — navigate the Waitrose tab to a URL (for driving discovery)

This phase gives us the research tool for understanding Waitrose's API, which informs everything that follows.

### Phase 2: Auth & Direct API Access

- `get_auth_status` — check if user is logged in (from cookies/page state)
- `get_session` — extract cookies and auth tokens needed for direct API calls
- Proxy mechanism in the native host: make `fetch` calls to Waitrose APIs using captured auth headers
- `api_call` — generic tool for making authenticated requests to discovered endpoints

### Phase 3: Product Search & Details

- `search_products` — hit Waitrose search API directly, full pagination support
- `get_product_details` — get details for a specific product
- Browser navigates to search results page as visual feedback
- Map out product data model (IDs, prices, availability, images)

### Phase 4: Basket Management

- `add_to_basket` — add a product with quantity via API
- `remove_from_basket` — remove item via API
- `view_basket` — return current basket contents
- `update_quantity` — change quantity of an item
- Browser reflects basket state visually
- `checkout_summary` — totals, delivery slot info (read-only, no auto-checkout)

### Phase 5: Order History

- `get_previous_orders` — list past orders with dates
- `get_order_details` — items from a specific past order
- `reorder_items` — add items from a previous order to current basket

### Phase 6: Shopping List OCR

- `parse_shopping_list` — accepts an image, extracts items using Claude's vision
- Returns structured list of items with quantities
- Feeds directly into search → add-to-basket workflow

### Phase 7: Agent Workflow Integration

- Higher-level composed workflows ("do my weekly shop from this photo")
- Confirmation gates before checkout
- Error recovery: item not found → suggest alternatives from search results
- Smart matching: fuzzy product matching, preferred brands, usual quantities from order history

## Testing Strategy

- **Extension debugging**: Load unpacked via `chrome://extensions`, service worker DevTools console
- **Host process**: Run standalone with mocked WebSocket messages for unit tests
- **MCP server**: Claude Code itself as the test client — we're building tools it can call
- **API discovery**: The capture tools double as our research and regression tool — if Waitrose changes an API, we can re-capture and diff
- **E2E**: Playwright with `--load-extension` to verify the full chain
- **VS Code**: Launch configs for debugging the native host with breakpoints
