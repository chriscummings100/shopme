# ShopMe

Add groceries to your online basket using natural language. Tell your agent what you want — it searches your chosen supermarket, uses your order history to pick the right products, and adds them to your basket.

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

## Getting started

**1. Start Chrome attached to your supermarket:**

```bash
.conda/python shopme.py --vendor waitrose start
# or
.conda/python shopme.py --vendor sainsburys start
```

This opens Chrome with remote debugging enabled. Log in to your supermarket in the browser window that opens.

**2. Open your agent and use the `/shop` skill:**

```
/shop
```

The agent will ask which supermarket you want, pull your order history, and take a free-form shopping list, then work with you to shop!

---

## CLI reference

You can also drive the CLI directly. All commands output JSON.

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

**Example:**

```bash
# Search for milk
.conda/python shopme.py search "semi skimmed milk 4 pints"

# Add the product using the id from search results
.conda/python shopme.py add <id> 1

# Check the basket
.conda/python shopme.py cart
```

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
