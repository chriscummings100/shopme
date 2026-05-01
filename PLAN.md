# ShopMe - Project Plan

AI-powered shopping assistant for Waitrose, driven by a Python CLI and Playwright.

## Architecture

```
Claude (shop skill)
  → Bash: python shopme.py <command>
    → Playwright (connect_over_cdp)
      → Chrome (--remote-debugging-port=9222, persistent profile)
        → waitrose.com tab (real cookies, authenticated)
          → page.evaluate(fetch(...))   ← looks like user-typed JS to server
```

### Why this approach

- **No MCP server**: Claude invokes the CLI directly via Bash — simpler, no long-running process to manage.
- **No Chrome extension**: Playwright's `page.evaluate()` does exactly what the extension's `fetch_from_tab` did, with no reconnect issues.
- **No API key / credentials file**: The browser tab's real cookie session handles auth. Same-origin fetches include cookies automatically — no JWT extraction or Android API key needed.
- **Persistent Chrome profile** (`~/.shopme-chrome`): login survives between sessions; doesn't conflict with the user's normal Chrome.

## File Structure

```
shopme.py              ← CLI entry point: argument parsing, vendor dispatch
requirements.txt       ← playwright
vendors/
  base.py              ← abstract vendor interface + shared data models
  waitrose.py          ← Waitrose implementation
  sainsburys.py        ← future
.claude/
  commands/
    shop.md            ← skill: instructs Claude to use shopme.py via Bash
    api-spy.md         ← unchanged, still useful for adding new vendors
api-spy-output/        ← API reference docs, keep
```

## CLI Commands

All commands output JSON to stdout. Claude parses and acts on this.
Select vendor with `--vendor <name>` (default: `waitrose`).

| Command | Description |
|---|---|
| `shopme.py start` | Launch Chrome with debug port, open vendor homepage |
| `shopme.py search <term> [--size N]` | Search products → list with opaque `id` |
| `shopme.py cart` | Current basket → items with opaque `cart_item_id` |
| `shopme.py add <product_id> [qty]` | Add item (id from search results) |
| `shopme.py set <cart_item_id> <qty>` | Update quantity; qty=0 removes the item |
| `shopme.py clear` | Empty basket |
| `shopme.py orders [--size N]` | List past/active orders |
| `shopme.py order <order_id>` | Full item list for a past order |
| `shopme.py api <METHOD> <path> [body]` | Raw vendor API call (exploration) |

### Design principle: opaque IDs

IDs returned by the CLI are opaque strings. Claude passes them back as-is — it never
needs to understand their internal structure. Vendor implementations encode whatever
the underlying API needs into a single string:

- `search` returns `product.id` — Waitrose encodes `"lineNumber:productId"` internally
- `cart` returns `item.cart_item_id` — Waitrose uses `trolleyItemId`
- `add <product_id>` unpacks the encoded ID internally; no extra API lookup needed
- `set <cart_item_id> <qty>` similarly resolves lineNumber/productId from the cart lookup

## Implementation Plan

### Test structure

```
tests/
  conftest.py          ← fixtures shared across all phases
  test_phase1_env.py   ← gates Phase 1
  test_phase2_core.py  ← gates Phase 2
  test_phase3_unit.py  ← gates Phase 3 (no browser)
  test_phase3_int.py   ← gates Phase 3 (browser + login required)
```

**Markers** (configured in `pytest.ini`):
- `unit` — no browser needed, always fast
- `integration` — requires Chrome running and logged in to Waitrose

Run unit only: `pytest -m unit`
Run all (including integration): `pytest -m "unit or integration"`

**Key fixtures** (`conftest.py`):
- `vendor` — async fixture: connects via CDP, finds Waitrose page, returns a
  `WaitroseVendor` instance ready to use
- `clean_cart` — depends on `vendor`; yields, then calls `vendor.clear()` on
  teardown. Apply to any test that modifies the basket.

---

### Phase 1 — Environment setup

- Create `requirements.txt` with `playwright` and `pytest-asyncio`
- `pip install -r requirements.txt && playwright install chromium`
- Verify Chrome can launch with `--remote-debugging-port=9222`
- Confirm `connect_over_cdp` can attach

**Gate tests** (`test_phase1_env.py`) — all `unit`, no browser needed:

| Test | Asserts |
|---|---|
| `test_chrome_executable_found` | Chrome binary exists at the detected path |
| `test_playwright_chromium_installed` | Playwright's chromium executable path exists on disk |
| `test_cdp_endpoint_reachable` | `GET http://localhost:9222/json` returns HTTP 200 (needs Chrome already running) |

---

### Phase 2 — `shopme.py` core infrastructure

**2a. `start` command**
Find Chrome executable (standard Windows/Mac/Linux paths), launch with
`--remote-debugging-port=9222 --user-data-dir=~/.shopme-chrome`, open waitrose.com.
Print `{"ok": true}` and exit.

**2b. CDP connection + page finder**
`async def get_waitrose_page(playwright)` — connect via `connect_over_cdp`,
scan all contexts/pages for one whose URL contains `waitrose.com`.
If none found, open a new tab and navigate there.

**2c. Session context extraction**
`async def get_context(page)` — evaluate `localStorage.getItem('wtr_customer_id')`
and `localStorage.getItem('wtr_order_id')` in the Waitrose tab.

**2d. Generic fetch wrapper**
`async def page_fetch(page, method, url, body=None)` — `page.evaluate()` with a JS
async function that calls `fetch(url, {method, headers, body})` in the tab context.
Same-origin cookies are included automatically.

> **Auth open question:** Test early whether cookies alone are sufficient for the
> GraphQL and REST endpoints, or whether a Bearer token also needs to be extracted
> from the page (e.g. from `window.__PRELOADED_STATE__`). The old extension
> extracted a JWT — the web context may not need it.

**Gate tests** (`test_phase2_core.py`):

| Test | Marker | Asserts |
|---|---|---|
| `test_connect_over_cdp` | integration | Playwright connects without raising |
| `test_find_waitrose_page` | integration | Returns a page object whose URL contains `waitrose.com` |
| `test_get_context_returns_ids` | integration | `customerId` and `orderId` are non-empty strings |
| `test_page_fetch_returns_200` | integration | Authenticated GET to `/api/order-orchestration-prod/v1/orders?size=1` returns status 200 |

---

### Phase 3 — Vendor base class + Waitrose implementation

**`vendors/base.py`** — abstract interface all vendors implement:

```python
class ShoppingVendor:
    async def search(self, term: str, size: int) -> list[Product]
    async def get_cart(self) -> Cart
    async def add(self, product_id: str, qty: int) -> Cart
    async def set_qty(self, cart_item_id: str, qty: int) -> Cart  # qty=0 = remove
    async def clear(self) -> Cart
    async def get_orders(self, size: int) -> list[Order]
    async def get_order(self, order_id: str) -> Order

@dataclass class Product:
    id: str; name: str; size: str | None; price: str
    price_per_unit: str | None; promotion: str | None

@dataclass class CartItem:
    cart_item_id: str; product_id: str; name: str; qty: int; price: str

@dataclass class Cart:
    items: list[CartItem]; total: str; savings: str | None
```

**`vendors/waitrose.py`** — port each operation from `host/src/index.ts`:

- `search` — POST to search endpoint; encode `"lineNumber:productId"` as `product.id`
- `get_cart` — GraphQL `getTrolley` + products lookup; `trolleyItemId` as `cart_item_id`
- `add` — unpack `lineNumber:productId` from product_id; GraphQL `addItemToTrolley`
- `set_qty` — fetch cart internally to resolve lineNumber/productId for the given
  trolleyItemId, then GraphQL `updateTrolleyItem`
- `clear` — GraphQL `emptyTrolley`, re-read localStorage for new orderId
- `get_orders` — `GET /api/order-orchestration-prod/v1/orders`
- `get_order` — `GET /api/order-orchestration-prod/v1/orders/{id}` + products lookup

**Gate tests — unit** (`test_phase3_unit.py`), no browser:

| Test | Asserts |
|---|---|
| `test_product_id_roundtrip` | Encoding then decoding `lineNumber:productId` recovers both values |
| `test_product_fields` | `Product` dataclass has `id`, `name`, `size`, `price`, `price_per_unit`, `promotion` |
| `test_cart_item_fields` | `CartItem` has `cart_item_id`, `product_id`, `name`, `qty`, `price` |
| `test_cart_fields` | `Cart` has `items`, `total`, `savings` |
| `test_vendor_interface` | `WaitroseVendor` implements all abstract methods of `ShoppingVendor` |

**Gate tests — integration** (`test_phase3_int.py`), needs logged-in browser:

| Test | Uses `clean_cart` | Asserts |
|---|---|---|
| `test_search_returns_products` | no | Non-empty list; each item has `id`, `name`, `price` as non-empty strings |
| `test_search_id_is_opaque_string` | no | `product.id` is a non-empty string (internals not visible to caller) |
| `test_cart_returns_shape` | no | `Cart` with `items` list and non-empty `total` string |
| `test_add_item` | yes | After `add`, product appears in `get_cart()` results |
| `test_add_returns_updated_cart` | yes | `add` return value is a `Cart` with the new item present |
| `test_set_qty_changes_quantity` | yes | After `set_qty(id, 2)`, item qty is 2 in `get_cart()` |
| `test_set_qty_zero_removes_item` | yes | After `set_qty(id, 0)`, item absent from `get_cart()` |
| `test_orders_returns_list` | no | Non-empty list; each order has `order_id`, `status`, `total` |
| `test_order_detail_has_items` | no | Fetch first order from history; `items` list is non-empty with `name` and `price` |

---

### Phase 4 — Skill rewrite (`shop.md`)

Shopping logic unchanged (decisiveness, order history, confirmations).
Replace each MCP tool call with `Bash: python shopme.py <command>`.
Add startup check: if `shopme.py context` fails, tell user to run `shopme.py start`.

---

### Phase 5 — Cleanup

- Delete `host/`, `extension/`, `scripts/build.mjs`, `tsconfig.json`, `credentials.json`
- Remove shopme entry from `.claude/mcp.json`
- Swap MCP tool permissions in `settings.local.json` for Bash `python shopme.py *`
- Retire or rewrite `smoke-test.md`

## Waitrose API Reference

Discovered via Chrome DevTools Network capture. Base URL: `https://www.waitrose.com`.

### Auth (web context)

All authenticated requests are made inside the Waitrose browser tab, so cookies
are applied automatically. Custom headers the web app sends:

- `Content-Type: application/json`
- `features: enAppleWallet`
- `breadcrumb` (value varies — may not be required)

orderId: read from `localStorage.wtr_order_id`.
customerId: read from `localStorage.wtr_customer_id`.

After `emptyTrolley`, re-read `localStorage.wtr_order_id` — a new orderId is issued.

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
      "orderId": "<orderId>",
      "categoryLevel": 1
    }
  }
}
```

Sort values: `MOST_POPULAR`, `PRICE_LOW_TO_HIGH`, `PRICE_HIGH_TO_LOW`, `RATING`

Response: `componentsAndProducts[]` — filter to entries with `searchProduct`.
Key fields: `id`, `lineNumber`, `name`, `size`, `displayPrice`, `displayPriceQualifier`,
`promotion.promotionDescription`, `defaultQuantity.uom`.

### Trolley — Get

`POST /api/graphql-prod/graph/live`

```graphql
query($orderId: ID!) {
  getTrolley(orderId: $orderId) {
    trolley {
      trolleyItems {
        trolleyItemId lineNumber productId
        quantity { amount uom }
        totalPrice { amount currencyCode }
      }
      trolleyTotals {
        itemTotalEstimatedCost { amount currencyCode }
        savingsFromOffers { amount currencyCode }
      }
    }
  }
}
```

### Trolley — Add Item

```graphql
mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
  addItemToTrolley(orderId: $orderId, trolleyItem: $trolleyItem) {
    trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
    failures { message type }
  }
}
```

Variables: `trolleyItem: { lineNumber, productId, quantity: { amount, uom }, trolleyItemId: -parseInt(lineNumber) }`

`trolleyItemId` for a **new** item is the **negative of its lineNumber** as an integer.
Adding an existing item (by lineNumber) resets its quantity rather than incrementing.

### Trolley — Update / Remove Item

Same mutation as Add but `updateTrolleyItem`, using the real positive `trolleyItemId`
from getTrolley. Also requires `canSubstitute: true, personalisedMessage: null`.
Set `quantity.amount: 0` to remove. The CLI resolves `lineNumber` and `productId`
from the trolley internally — callers only need to supply `trolleyItemId`.

### Trolley — Empty

```graphql
mutation($orderId: ID!) {
  emptyTrolley(orderId: $orderId) { trolley { orderId } }
}
```

### Products Lookup (for enriching trolley/order items with names)

`GET /api/products-prod/v1/products/{lineNumbers}?view=SUMMARY`

`lineNumbers` is a `+`-separated list (URL-encoded as `%2B`).
Response: `products[]` with `lineNumber`, `name`, `size`.

### Other Endpoints

- `GET /api/order-orchestration-prod/v1/orders?size=15&sortBy=%2B&statuses=AMENDING%2BFULFIL%2BPAID%2BPAYMENT_FAILED%2BPICKED%2BPLACED` — order history
- `GET /api/order-orchestration-prod/v1/orders/{orderId}` — order detail (`.orderLines[]`)
- `GET /api/delivery-pass-orchestration-prod/v1/pass/status` — delivery pass status
- `GET /api/slot-orchestration-prod/v1/slot-reservations?customerOrderId={orderId}` — delivery slot
- `GET /api/memberships-prod/v2/memberships` — MyWaitrose membership
- `GET /api/favourites2-prod/v2/favourites?includes=bought-online%2Cuser-selected` — favourites

## Known Gotchas

- **Adding existing item**: `addItemToTrolley` resets quantity rather than incrementing. Use `updateTrolleyItem` to change an existing item's quantity.
- **orderId after emptyTrolley**: New orderId appears in `localStorage.wtr_order_id` after the mutation completes — re-read it.
- **Chrome profile**: Always use `--user-data-dir=~/.shopme-chrome` so login persists. Do not use the default profile (Chrome ≥ v136 may not support CDP on it).
- **Page not open**: If no waitrose.com tab is found, the CLI should navigate to it and wait for the user to log in before proceeding.
