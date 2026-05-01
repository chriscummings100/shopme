---
name: shop
description: Help the user build a shopping list and add items to their online grocery basket at Waitrose or Sainsbury's. Activate when the user asks to go shopping, add groceries, fill their basket, or mentions a list of food/household items they want to buy.
---

Help the user build and add a shopping list to their online grocery basket.

## Invoking the CLI

All operations go through `shopme.py`. Run it with:
```
.conda/python shopme.py <command>
```
All commands print JSON to stdout. Parse it and act on the result.

**If any command returns `{"error": "Cannot connect to Chrome..."}`,** stop and tell the user:
> "Please run `.conda/python shopme.py --vendor <vendor> start` in a terminal, then log in and try again."

## Your goal
Take a natural-language shopping list from the user and add each item to their basket, using past order history to resolve ambiguities without unnecessary back-and-forth.

## Step 0 — Choose a vendor

Before doing anything else, ask the user:
> "Which supermarket would you like to shop at — **Waitrose** or **Sainsbury's**?"

Wait for their answer. Use it to set `VENDOR` to either `waitrose` or `sainsburys`.

**If Chrome isn't already running** (i.e. the first CLI command returns a connect error), tell the user:
> "Please run `.conda/python shopme.py --vendor <VENDOR> start` in a terminal, then log in and come back."

All subsequent CLI commands are run without `--vendor` — the vendor is auto-detected from the open tab.

## Step 1 — Get context (silently before talking to the user)

Run these in parallel:
```
.conda/python shopme.py orders --size 5
```
Then for each of the most recent 1–2 orders, run:
```
.conda/python shopme.py order <order_id>
```
Keep this history in mind throughout — it tells you which brands, sizes and products this user actually buys.

Also run:
```
.conda/python shopme.py cart
```
to see what's already in the basket (don't empty it — items may already be there).

## Step 2 — Ask for the list
Ask the user: **"What would you like to add to your basket?"**

Accept free-form input. Examples:
- "milk, bread, cheese, some apples, washing up liquid"
- "the usual weekly shop plus some beers for the weekend"
- "2 pints of semi skimmed, a bag of pasta, tuna"

## Step 3 — Process each item

Work through items one at a time, in order. For each item:

### 3a — Search
```
.conda/python shopme.py search "<term>" --size 5
```
Use quantity/size hints from the user's phrasing if present (e.g. "4 pints", "500g").

The response is a JSON array of products. Each product has:
- `id` — opaque string; pass it back as-is to `add`
- `name`, `size`, `price`, `price_per_unit`, `promotion`

### 3b — Decide

**Add without asking** if:
- The top result is an obvious match AND matches what the user has bought before, OR
- There is only one plausible match

**Ask the user to choose** if:
- Multiple products are plausible and meaningfully different (different brands, sizes, types), OR
- Nothing in the results is a good match

When asking, show a short numbered list (max 3 options) with name, size and price. Ask in one line: *"Which did you mean? (1/2/3 or describe it differently)"*

### 3c — Add
```
.conda/python shopme.py add <product_id> <qty>
```
Use the quantity the user specified, defaulting to 1. The response is the updated cart JSON.

### 3d — Confirm lightly
Say one line, e.g. *"Added Essential Semi-Skimmed Milk 4 Pints (£1.75)."* Do not ask for confirmation before adding.

## Step 4 — Summary
Once all items are processed, run:
```
.conda/python shopme.py cart
```
Show a clean summary:
- List every item added with quantity and price
- Show the basket total
- Note any items you couldn't find or that were skipped

## Other operations

**Change quantity of a basket item:**
```
.conda/python shopme.py set <cart_item_id> <qty>
```
`cart_item_id` comes from the `cart` response. `qty=0` removes the item.

**Clear the basket:**
```
.conda/python shopme.py clear
```

## Rules
- Be decisive. Use order history to avoid asking about things the user clearly buys regularly.
- Be brief. One-line confirmations, short clarification questions.
- Never add an item you're not confident about without asking first.
- If the user says a quantity ("two", "a couple of", "x3"), use it.
- If a search returns nothing useful, tell the user and move on.
- Do not empty the basket before starting — items may already be there.
- IDs in the JSON output are opaque strings — always pass them back exactly as received.
