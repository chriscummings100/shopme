# ShopMe

ShopMe is a TypeScript MCP server and CLI for adding groceries to your online
basket with an AI agent. It attaches to your live Chrome session over the Chrome
DevTools Protocol, finds a logged-in Waitrose or Sainsbury's tab, and runs the
retailer's own API calls inside that tab so your normal cookies and tokens are
used.

Supports **Waitrose** and **Sainsbury's**.

## Prerequisites

- Chrome installed
- Node.js and npm
- Dependencies installed and packages built:

```bash
npm install
npm run build
```

## Repository Structure

```text
packages/
  grocery-core/     Shared browser, vendor, cart/order, screenshot, and memory behavior
  cli/              `shopme` CLI bin
  shared/           JSON/path helpers
servers/
  groceries/        `shopme-mcp-groceries` MCP server bin
tests/
  unit/             Vitest unit tests
```

## MCP Setup

For local development, point your MCP client at the built Node server:

```json
{
  "mcpServers": {
    "shopme": {
      "command": "node",
      "args": ["C:\\dev\\shopme\\servers\\groceries\\dist\\index.js"]
    }
  }
}
```

`runmcp.bat` is equivalent:

```json
{
  "mcpServers": {
    "shopme": {
      "command": "C:\\Windows\\System32\\cmd.exe",
      "args": ["/c", "C:\\dev\\shopme\\runmcp.bat"]
    }
  }
}
```

Once published to npm, the MCP server can be launched with:

```json
{
  "mcpServers": {
    "shopme": {
      "command": "npx",
      "args": ["-y", "@chriscummings100/shopme-mcp-groceries"]
    }
  }
}
```

The MCP server exposes: `start_browser`, `search_products`, `get_cart`,
`add_to_cart`, `set_cart_quantity`, `clear_cart`, `list_orders`, `get_order`,
`screenshot_page`, and shopping memory tools/resources. The raw authenticated
API tool is disabled unless `SHOPME_MCP_ENABLE_RAW_API=1` is set before the
server starts.

## CLI

Start Chrome for a supermarket login session:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose start
npm exec --workspace @chriscummings100/shopme -- shopme --vendor sainsburys start
```

After Chrome is open and logged in, vendor commands can auto-detect the active
supermarket tab when exactly one supported vendor is open:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme search "semi skimmed milk" --size 5
npm exec --workspace @chriscummings100/shopme -- shopme cart
npm exec --workspace @chriscummings100/shopme -- shopme add <product_id> 1
```

All CLI output is JSON. Errors print `{"error":"..."}` and exit non-zero.

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
| `memory summary [--vendor V]` | Show shopping memory associations |
| `memory record ...` | Record that a phrase resolved to a product |
| `memory reject ...` | Record a correction |
| `memory explain <phrase>` | Show evidence for one phrase |

## Shopping Memory

Shopping memory is stored in `.shopme-memory/associations.jsonl` and
`.shopme-memory/summary.json`. This is local household preference data and is
ignored by git.

```bash
npm exec --workspace @chriscummings100/shopme -- shopme memory summary --vendor waitrose
npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose memory record --phrase "milk" --product-id "<id>" --product-name "<name>"
npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose memory reject --phrase "cuke" --wrong-product-name "Coca-Cola" --correct-product-name "Essential Cucumber Each"
```

## Development

```bash
npm run typecheck
npm run build
npm run test:unit
npm run dev:cli -- cart
npm run dev:mcp:grocery
```

Some build/test commands spawn esbuild helpers. In restricted sandboxes they may
need to run outside the sandbox.

## Publishing

Packages are published under the `@chriscummings100` npm scope:

- `@chriscummings100/shopme-shared`
- `@chriscummings100/shopme-grocery-core`
- `@chriscummings100/shopme`
- `@chriscummings100/shopme-mcp-groceries`

Publish in dependency order:

```bash
npm login
npm whoami

npm run typecheck
npm run build
npm run test:unit

npm pack --dry-run --workspace @chriscummings100/shopme-shared
npm publish --workspace @chriscummings100/shopme-shared --access public

npm pack --dry-run --workspace @chriscummings100/shopme-grocery-core
npm publish --workspace @chriscummings100/shopme-grocery-core --access public

npm pack --dry-run --workspace @chriscummings100/shopme
npm publish --workspace @chriscummings100/shopme --access public

npm pack --dry-run --workspace @chriscummings100/shopme-mcp-groceries
npm publish --workspace @chriscummings100/shopme-mcp-groceries --access public
```

After publish:

```bash
npx -y @chriscummings100/shopme --vendor waitrose start
npx -y @chriscummings100/shopme cart
npx -y @chriscummings100/shopme-mcp-groceries
```

## How It Works

ShopMe connects to Chrome at `http://localhost:9222`. Browser-backed calls run
`fetch()` inside the supermarket tab, so the requests carry the live browser
session. Product IDs and cart item IDs are opaque strings; callers should pass
back only IDs returned by previous ShopMe commands.
