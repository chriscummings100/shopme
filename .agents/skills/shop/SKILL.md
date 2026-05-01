---
name: shop
description: Help the user build a shopping list and add items to their online grocery basket at Waitrose or Sainsbury's. Activate when the user asks to go shopping, add groceries, fill their basket, or mentions a list of food/household items they want to buy.
---

Help the user build and add a shopping list to their online grocery basket.

## Invoking the CLI

All operations go through `shopme.py`. Run it with:
```
python shopme.py <command>
```
All commands print JSON to stdout. Parse it and act on the result.

**If any command returns `{"error": "Cannot connect to Chrome..."}`,** stop and tell the user:
> "Please run `python shopme.py --vendor <vendor> start` in a terminal, then log in and try again."

## Your goal
Take a natural-language shopping list from the user and add each item to their basket, using memory and past order history to resolve ambiguities without unnecessary back-and-forth.

## Step 0 - Choose a vendor

Before doing anything else, ask the user:
> "Which supermarket would you like to shop at - **Waitrose** or **Sainsbury's**?"

Wait for their answer. Use it to set `VENDOR` to either `waitrose` or `sainsburys`.

Run `python shopme.py --vendor <VENDOR> start`.

All subsequent basket/order/search commands are run without `--vendor`; the vendor is auto-detected from the open tab. Memory commands should include `--vendor <VENDOR>`.

## Step 1 - Get context (silently before talking to the user)

Run these in parallel:
```
python shopme.py memory summary --vendor <VENDOR>
python shopme.py orders --size 5
```
Then for each of the most recent 1-2 orders, run:
```
python shopme.py order <order_id>
```
Keep this history in mind throughout; it tells you which brands, sizes and products this user actually buys.

Also run:
```
python shopme.py cart
```
to see what's already in the basket. Do not empty it; items may already be there.

Keep the memory summary in mind. It contains soft household associations between the user's original phrases and products that previously ended up being ordered. Treat it as evidence, not a permanent definition.

## Step 2 - Ask for the list
Ask the user: **"What would you like to add to your basket?"**

Accept free-form input. Examples:
- "milk, bread, cheese, some apples, washing up liquid"
- "the usual weekly shop plus some beers for the weekend"
- "2 pints of semi skimmed, a bag of pasta, tuna"

## Step 3 - Process each item

Work through items one at a time, in order. For each item:

Before rewriting or expanding the item, remember the user's original phrase. This original phrase is what gets recorded back to memory after the final product is added.

### 3m - Memory

Check the memory summary for the original phrase or a close normalized match.

Use remembered associations like this:
- High confidence (score >= 4 or repeated evidence with no recent correction): search for the remembered product name first and add the matching result if it is still clearly available.
- Medium confidence: show the remembered product as the first option, then show current search results.
- Low confidence or no match: proceed with normal search and order-history reasoning.

Never let memory override an explicit correction from the user. If memory says a phrase previously led to the wrong product, avoid that product unless the user explicitly asks for it.

### 3a - Search
```
python shopme.py search "<term>" --size 5
```
Use quantity/size hints from the user's phrasing if present (e.g. "4 pints", "500g").

The response is a JSON array of products. Each product has:
- `id` - opaque string; pass it back as-is to `add`
- `name`, `size`, `price`, `price_per_unit`, `promotion`

### 3b - Decide

**Add without asking** if:
- The top result is an obvious match and matches what the user has bought before, or
- There is only one plausible match, or
- A high-confidence memory association still clearly matches the current search results.

**Ask the user to choose** if:
- Multiple products are plausible and meaningfully different (different brands, sizes, types), or
- Nothing in the results is a good match, or
- Memory has only weak/medium confidence.

When asking, show a short numbered list (max 3 options) with name, size and price. Put a remembered association first when relevant. Ask in one line: *"Which did you mean? (1/2/3 or describe it differently)"*

### 3c - Add
```
python shopme.py add <product_id> <qty>
```
Use the quantity the user specified, defaulting to 1. The response is the updated cart JSON.

### 3d - Confirm lightly
Say one line, e.g. *"Added Essential Semi-Skimmed Milk 4 Pints (GBP 1.75)."* Do not ask for confirmation before adding.

### 3e - Remember

After the final product is added, record the association between the original phrase and the product that actually went into the basket:

```
python shopme.py memory record --vendor <VENDOR> --phrase "<original phrase>" --product-id "<product id>" --product-name "<product name>" --search-term "<successful search term>" --source user_selected --size "<size>" --price "<price>"
```

Use `--source accepted_suggestion` when the user accepts a remembered suggestion. Use `--source auto_added` only when you added from high-confidence memory without asking. Use `--source user_selected` when the user picked from options or gave a clarifying description.

If the user corrects a wrong product, remove or fix the basket item as needed and record the correction:

```
python shopme.py memory reject --vendor <VENDOR> --phrase "<original phrase>" --wrong-product-id "<wrong product id>" --wrong-product-name "<wrong product name>" --correct-product-id "<correct product id>" --correct-product-name "<correct product name>"
```

Do not ask the user whether to record memory. It is part of finishing the shopping task.

## Step 4 - Summary
Once all items are processed, run:
```
python shopme.py cart
```
Show a clean summary:
- List every item added with quantity and price
- Show the basket total
- Note any items you couldn't find or that were skipped

## Other operations

**Change quantity of a basket item:**
```
python shopme.py set <cart_item_id> <qty>
```
`cart_item_id` comes from the `cart` response. `qty=0` removes the item.

**Clear the basket:**
```
python shopme.py clear
```

**Explain memory for one phrase:**
```
python shopme.py memory explain "<phrase>" --vendor <VENDOR>
```

## Rules
- Be decisive. Use memory and order history to avoid asking about things the user clearly buys regularly.
- Be brief. One-line confirmations, short clarification questions.
- Never add an item you're not confident about without asking first.
- If the user says a quantity ("two", "a couple of", "x3"), use it.
- If a search returns nothing useful, tell the user and move on.
- Do not empty the basket before starting; items may already be there.
- IDs in the JSON output are opaque strings; always pass them back exactly as received.
