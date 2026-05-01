# ShopMe

ShopMe is both an MCP server and a Python CLI for adding groceries to your
online basket with an AI agent. The recommended setup is to connect your agent
to ShopMe over MCP, then let the agent use ShopMe's tools to search products,
read your basket, use order history and shopping memory, and add the right
items for you.

The CLI remains available for smoke tests, debugging, scripting, and direct
manual use.

Supports **Waitrose** and **Sainsbury's**.

---

## Prerequisites

- Chrome installed
- Python (tested with 3.12), with dependencies installed:
  ```
  pip install -r requirements.txt
  playwright install chromium
  ```

---

## Recommended setup: MCP with agents

**1. Configure your agent's MCP client**

Point your MCP client at `runmcp.bat`:

```json
{
  "mcpServers": {
    "shopme": {
      "command": "C:\\dev\\shopme\\runmcp.bat",
      "cwd": "C:\\dev\\shopme"
    }
  }
}
```

`runmcp.bat` starts the MCP server over stdio:

```bat
.conda/python shopme_mcp.py
```

**2. Start Chrome attached to your supermarket**

```bash
.conda/python shopme.py --vendor waitrose start
# or
.conda/python shopme.py --vendor sainsburys start
```

This opens Chrome with remote debugging enabled. Log in to your supermarket in the browser window that opens.

**3. Open your agent and shop naturally**

Once the MCP server is configured, your agent can call ShopMe tools directly.
For agents that use this repo's skill, start with:

```
/shop
```

The agent will ask which supermarket you want, pull your order history and shopping memory, and take a free-form shopping list, then work with you to shop!

---

## MCP server

ShopMe's MCP server is the preferred interface for AI agents. It exposes the
safe shopping surface as MCP tools: start the browser, search products, read the
basket, add items, set quantities, clear the basket, list orders, read order
detail, take screenshots, and read/write shopping memory.

Run it directly over stdio:

```bash
runmcp.bat
```

Equivalent direct command:

```bash
.conda/python shopme_mcp.py
```

Use `.conda/python shopme.py --vendor waitrose start` first, then log in in the
Chrome window. The MCP tools use that live browser session, just like the CLI.
The raw authenticated `api` command is not exposed by default; set
`SHOPME_MCP_ENABLE_RAW_API=1` before starting the MCP server if you deliberately
want that exploration tool available.

---

## CLI reference

The CLI is the lower-level interface behind the MCP server. Use it when you want
to test the integration directly, run smoke checks, debug vendor behavior, or
script a specific action. All commands output JSON.

```bash
.conda/python shopme.py <command>
```

| Command | Description |
|---|---|
| `start` | Launch Chrome (requires `--vendor waitrose` or `--vendor sainsburys`) |
| `search <term> [--size N]` | Search for products |
| `cart` | Show current basket |
| `add <product_id> [qty]` | Add a product (use ID from `search`) |
| `set <cart_item_id> <qty>` | Update quantity; `qty=0` removes the item |
| `clear` | Empty the basket |
| `orders [--size N]` | List past orders |
| `order <order_id>` | Full detail for one order |
| `memory summary [--vendor V]` | Show soft phrase-to-product associations |
| `memory record ...` | Record that a phrase resolved to a product |
| `memory reject ...` | Record that a phrase did not mean a product |
| `memory explain <phrase>` | Show memory evidence for one phrase |

**Example:**

```bash
# Search for milk
.conda/python shopme.py search "semi skimmed milk 4 pints"

# Add the product using the id from search results
.conda/python shopme.py add <id> 1

# Check the basket
.conda/python shopme.py cart
```

**Memory examples:**

```bash
# Show the agent's compact memory briefing
.conda/python shopme.py memory summary --vendor waitrose

# Record that an ambiguous phrase ended up as a specific product
.conda/python shopme.py memory record --vendor waitrose --phrase "d.yogurts" --product-id "<id>" --product-name "Little Yeos Strawberry Yogurts 6x45g" --search-term "kids strawberry yogurts"

# Record a correction so the agent avoids repeating a bad association
.conda/python shopme.py memory reject --vendor waitrose --phrase "cuke" --wrong-product-name "Coca-Cola Original Taste 2L" --correct-product-name "Essential Cucumber Each"
```

Memory is stored locally in `.shopme-memory/`. It is ignored by git because it contains personal household preferences.

---

## Skills

| Skill | What it does |
|---|---|
| `/shop` | AI shopping assistant — takes a natural-language list and adds items to your basket |
| `/smoke-test` | Verifies the CLI is working end-to-end against a live session |

---

## How it works

ShopMe connects to your Chrome session via the Chrome DevTools Protocol. It runs API calls inside the browser tab so they carry your real login cookies automatically — no credentials stored, no separate auth needed.

See [AGENTS.md](AGENTS.md) for the full technical reference (vendor abstraction, adding new supermarkets, running tests).
