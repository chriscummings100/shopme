# ShopMe — Agent Guide

ShopMe is a Python CLI that lets an AI agent add items to a Waitrose online grocery basket. It attaches to a running Chrome session via the Chrome DevTools Protocol and drives the retailer's own internal APIs using the session's live authentication tokens.

---

## How it works

### Browser attachment

The user runs Chrome with `--remote-debugging-port=9222` (via `shopme.py start`). The CLI connects using Playwright's `connect_over_cdp`, finds the vendor tab, and calls `page.evaluate()` to run `fetch()` calls inside that tab. Because the requests originate from inside the tab, they carry the real cookies automatically.

### Authentication

Waitrose's SPA uses a short-lived Bearer token. On startup, `_init_context` extracts it from SSR `<script>` elements embedded in the page HTML via regex (`/"accessToken":"(Bearer [^"]+)"/`). It also installs a `window.fetch` hook to capture any fresher token the SPA issues itself. On a 401, the CLI reloads the page, re-runs `_init_context`, and retries once.

### Opaque IDs

Callers never see Waitrose's internal field names. The CLI encodes composite keys:

| Exposed field | Internal encoding |
|---|---|
| `product.id` | `"lineNumber:productId"` |
| `cart_item.cart_item_id` | `"trolleyItemId:uom"` |
| `order.order_id` | `customerOrderId` (opaque, passed through as-is) |

This means agents only ever pass IDs they received back from a prior command — no need to understand the underlying data model.

---

## File structure

```
shopme.py            CLI entry point — all commands, argument parsing, CDP connection
vendors/
  base.py            Abstract ShoppingVendor class + shared dataclasses
  waitrose.py        Waitrose implementation
tests/
  conftest.py        pytest fixtures (vendor, clean_cart)
  test_phase1_env.py Environment checks (no browser needed)
  test_phase2_core.py CDP connection and context extraction
  test_phase3_unit.py ID encoding roundtrips, dataclass fields (no browser)
  test_phase3_int.py  Full integration tests (requires live session)
.claude/
  commands/shop.md       /shop skill — AI shopping assistant
  commands/smoke-test.md /smoke-test skill — 7-step CLI smoke test
  commands/api-spy.md    /api-spy skill — network traffic reverse-engineering
scripts/
  network_filter.py  Preprocessor for api-spy raw network dumps
requirements.txt     playwright, pytest, pytest-asyncio
pytest.ini           asyncio_mode=auto, unit/integration markers
```

---

## CLI reference

Run all commands with `.conda/python shopme.py <command>`. All output is JSON on stdout. Errors print `{"error": "..."}` and exit 1.

| Command | Description |
|---|---|
| `start` | Launch Chrome with `--remote-debugging-port=9222` |
| `search <term> [--size N]` | Search for products. Returns array of `{id, name, size, price, price_per_unit, promotion}` |
| `cart` | Show the basket. Returns `{items, total, savings}` |
| `add <product_id> [qty]` | Add a product. `product_id` from `search`. Returns updated cart |
| `set <cart_item_id> <qty>` | Update quantity. `qty=0` removes the item. Returns updated cart |
| `clear` | Empty the basket. Returns empty cart |
| `orders [--size N]` | List past/active orders. Returns array of `{order_id, status, placed_date, delivery_date, total, item_count}` |
| `order <order_id>` | Full order detail. Returns `{order_id, status, ..., items[]}` |
| `screenshot <url> [--out PATH]` | Open URL in a new tab, screenshot it, close the tab. Saves to `screenshot.png` by default |
| `api <METHOD> <path> [body]` | Raw authenticated API call for exploration |

---

## Vendor abstraction

`vendors/base.py` defines `ShoppingVendor` (abstract base class) and the shared dataclasses.

| Vendor | Module | Site |
|---|---|---|
| Waitrose | `vendors/waitrose.py` | `https://www.waitrose.com` |
| Sainsbury's | `vendors/sainsburys.py` | `https://www.sainsburys.co.uk` |

The correct vendor is auto-detected from whichever vendor site is open in the browser. If both are open, pass `--vendor waitrose` or `--vendor sainsburys` to disambiguate. Only `start` requires `--vendor` explicitly.

To add a new vendor:

1. Create `vendors/<name>.py` with a class inheriting `ShoppingVendor`
2. Implement all seven abstract methods: `search`, `get_cart`, `add`, `set_qty`, `clear`, `get_orders`, `get_order`
3. Add the vendor URL to `VENDOR_URLS` in `shopme.py`
4. Add a branch for it in `get_vendor()` in `shopme.py`

The CLI caller and agent skills never need to change.

---

## Running tests

```bash
# Unit tests only (no browser required)
.conda/python -m pytest -m unit

# All tests (requires Chrome running and logged in to Waitrose)
.conda/python -m pytest

# Integration tests only
.conda/python -m pytest -m integration
```

Integration tests skip automatically if Chrome isn't running or the user isn't logged in.

---

## Claude skills

| Skill | Trigger | What it does |
|---|---|---|
| `/shop` | User wants to add items to their basket | Gathers order history and current cart, takes a free-form shopping list, searches and adds each item decisively |
| `/smoke-test` | Verify the CLI is working end-to-end | Runs 7 steps (cart, search, add, set qty, remove, orders, order detail) and reports PASS/FAIL |
| `/api-spy` | Reverse-engineer a new website's API | Opens an isolated browser context, captures network traffic, analyses auth patterns, writes `api-spy-output/api_analysis.md` |

---

## Prerequisites

- Chrome installed (Windows/Mac/Linux paths auto-detected)
- `.conda/python` — the project's conda environment with `playwright` and `pytest-asyncio` installed
- Playwright browsers: `playwright install chromium` (only needed if not using `connect_over_cdp`)
- For all vendor commands: Chrome must be running with `--remote-debugging-port=9222` and the Waitrose tab logged in
