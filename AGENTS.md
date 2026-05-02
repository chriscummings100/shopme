# ShopMe - Agent Guide

ShopMe is a TypeScript npm workspace for controlling a user's online grocery
basket through a live Chrome session. It exposes both a CLI and an MCP server.

The project supports Waitrose and Sainsbury's.

## Current Structure

```text
packages/
  grocery-core/
    src/browser/          Chrome launch, CDP connection, screenshots
    src/memory/           Shopping memory event log and summary builder
    src/vendors/          Vendor abstraction and concrete vendors
    src/models.ts         Shared product/cart/order models
    src/vendor-registry.ts
  cli/
    src/index.ts          `shopme` CLI
  shared/
    src/                  Small JSON/path helpers
servers/
  groceries/
    src/index.ts          `shopme-mcp-groceries` stdio entry point
    src/tools/            MCP tool registration
    src/resources/        MCP resource registration
tests/
  unit/                   Vitest unit tests
```

## Browser Attachment

The user launches Chrome with remote debugging through:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose start
```

or:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme --vendor sainsburys start
```

The CLI and MCP server connect to `http://localhost:9222` using
`playwright-core`, find the supported vendor tab, and evaluate `fetch()` calls
inside that page so requests carry the real browser cookies and tokens.

If exactly one supported vendor tab is open, commands can omit `--vendor`. If
both are open, pass `--vendor waitrose` or `--vendor sainsburys`.

## MCP Server

Local MCP command:

```text
command = "node"
args = ["C:\\dev\\shopme\\servers\\groceries\\dist\\index.js"]
```

Alternative batch launcher:

```text
command = "C:\\Windows\\System32\\cmd.exe"
args = ["/c", "C:\\dev\\shopme\\runmcp.bat"]
```

The groceries MCP server exposes:

- `start_browser`
- `search_products`
- `get_cart`
- `add_to_cart`
- `set_cart_quantity`
- `clear_cart`
- `list_orders`
- `get_order`
- `screenshot_page`
- `memory_summary`
- `memory_explain`
- `memory_record`
- `memory_reject`

It exposes memory resources under `shopme://memory/summary` and
`shopme://memory/summary/{vendor}`.

The raw authenticated API tool is disabled unless `SHOPME_MCP_ENABLE_RAW_API=1`
is set before server startup.

## CLI Reference

Run commands with:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme <command>
```

All output is JSON on stdout. Errors print `{"error":"..."}` and exit non-zero.

| Command | Description |
|---|---|
| `start` | Launch Chrome with remote debugging; requires `--vendor` |
| `search <term> [--size N]` | Search products |
| `cart` | Show current basket |
| `add <product_id> [qty]` | Add a product using an ID from `search` |
| `set <cart_item_id> <qty>` | Update quantity; `qty=0` removes the item |
| `clear` | Empty the basket |
| `orders [--size N]` | List recent and active orders |
| `order <order_id>` | Full order detail |
| `screenshot <url> [--out PATH]` | Screenshot a URL using the live Chrome session |
| `api <METHOD> <path> [body]` | Raw authenticated API call for exploration |
| `memory summary [--vendor V]` | Show compact shopping memory |
| `memory record ...` | Record that a phrase resolved to a product |
| `memory reject ...` | Record a correction |
| `memory explain <phrase>` | Show evidence for one phrase |

## Shopping Memory

Memory is stored in `.shopme-memory/associations.jsonl` and
`.shopme-memory/summary.json`. This is personal household data and is ignored by
git.

Memory is intentionally soft. The shopping workflow should use it as evidence,
not as a permanent definition. Repeated successful resolutions increase score;
corrections push bad associations down and record the preferred product when
known.

## Vendor Abstraction

`packages/grocery-core/src/vendors/base.ts` defines `ShoppingVendor`.

| Vendor | Module | Site |
|---|---|---|
| Waitrose | `packages/grocery-core/src/vendors/waitrose.ts` | `https://www.waitrose.com` |
| Sainsbury's | `packages/grocery-core/src/vendors/sainsburys.ts` | `https://www.sainsburys.co.uk` |

To add a vendor:

1. Create `packages/grocery-core/src/vendors/<name>.ts`.
2. Implement `ShoppingVendor`.
3. Add the vendor to `VENDOR_NAMES` in `models.ts`.
4. Add the vendor URL to `VENDOR_URLS` in `vendors/catalog.ts`.
5. Add a construction branch in `vendor-registry.ts`.

The CLI, MCP server, and shopping skill should not need vendor-specific changes.

## Tests

```bash
npm run typecheck
npm run build
npm run test:unit
```

Live supermarket smoke tests require Chrome to be running and logged in.

## Agent Rules

- Do not read `.shopme-memory/associations.jsonl` unless the task requires
  memory debugging; it contains personal household data.
- Do not empty the basket unless explicitly asked.
- Product and cart item IDs are opaque. Pass back IDs exactly as returned.
- Keep stdout clean for MCP protocol traffic. Diagnostics should go to stderr.
