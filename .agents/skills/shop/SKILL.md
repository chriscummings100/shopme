---
name: shop
description: Help the user build a shopping list and add items to their online grocery basket at Waitrose or Sainsbury's. Activate when the user asks to go shopping, add groceries, fill their basket, or mentions a list of food/household items they want to buy.
---

Help the user build and add a shopping list to their online grocery basket.

## Invoking ShopMe

Use the ShopMe MCP server tools. Do not run shell commands for shopping
operations.

Available MCP tools:
- `start_browser(vendor)`
- `memory_summary(vendor, limit)`
- `memory_explain(phrase, vendor, limit)`
- `memory_record(...)`
- `memory_reject(...)`
- `list_orders(size, vendor)`
- `get_order(order_id, vendor)`
- `get_cart(vendor)`
- `search_products(term, size, vendor)`
- `add_to_cart(product_id, qty, vendor)`
- `set_cart_quantity(cart_item_id, qty, vendor)`
- `clear_cart(vendor)`

Always pass the selected `vendor` to ShopMe MCP tools. IDs are opaque strings;
pass product IDs and cart item IDs back exactly as the tools returned them.

If a browser-backed MCP tool returns an error containing `Cannot connect to Chrome`
or `No vendor site found`, call `start_browser(vendor=<VENDOR>)`, then tell the
user:
> "I've opened Chrome for <VENDOR>. Please log in there, then come back and say ready."

Pause the shopping flow until the user confirms they are logged in.

## Your goal

Take a natural-language shopping list from the user and add each item to their
basket, using memory and past order history to resolve ambiguities without
unnecessary back-and-forth.

## Step 0 - Choose a vendor

Before doing anything else, ask the user:
> "Which supermarket would you like to shop at - **Waitrose** or **Sainsbury's**?"

Wait for their answer. Use it to set `VENDOR` to either `waitrose` or
`sainsburys`.

## Step 1 - Get context silently

Before asking for the shopping list, gather context in parallel:
- `memory_summary(vendor=VENDOR, limit=3)`
- `list_orders(size=5, vendor=VENDOR)`
- `get_cart(vendor=VENDOR)`

Then for each of the most recent 1-2 orders, call:
- `get_order(order_id=<order_id>, vendor=VENDOR)`

Keep this history in mind throughout; it tells you which brands, sizes and
products this user actually buys.

Do not empty the basket. Items may already be there.

Keep the memory summary in mind. It contains soft household associations between
the user's original phrases and products that previously ended up being ordered.
Treat it as evidence, not a permanent definition.

## Step 2 - Ask for the list

Ask the user: **"What would you like to add to your basket?"**

Accept free-form input. Examples:
- "milk, bread, cheese, some apples, washing up liquid"
- "the usual weekly shop plus some beers for the weekend"
- "2 pints of semi skimmed, a bag of pasta, tuna"

## Step 3 - Process each item

Work through items one at a time, in order. For each item:

Before rewriting or expanding the item, remember the user's original phrase.
This original phrase is what gets recorded back to memory after the final
product is added.

### 3m - Memory

Check the memory summary for the original phrase or a close normalized match.

Use remembered associations like this:
- High confidence (score >= 4 or repeated evidence with no recent correction): search for the remembered product name first and add the matching result if it is still clearly available.
- Medium confidence: show the remembered product as the first option, then show current search results.
- Low confidence or no match: proceed with normal search and order-history reasoning.

Never let memory override an explicit correction from the user. If memory says a
phrase previously led to the wrong product, avoid that product unless the user
explicitly asks for it.

### 3a - Search

Call:
- `search_products(term=<term>, size=5, vendor=VENDOR)`

Use quantity/size hints from the user's phrasing if present, such as "4 pints"
or "500g".

The response is an array of products. Each product has:
- `id` - opaque string; pass it back as-is to `add_to_cart`
- `name`, `size`, `price`, `price_per_unit`, `promotion`

### 3b - Decide

Add without asking if:
- The top result is an obvious match and matches what the user has bought before.
- There is only one plausible match.
- A high-confidence memory association still clearly matches the current search results.

Ask the user to choose if:
- Multiple products are plausible and meaningfully different, such as different brands, sizes, or types.
- Nothing in the results is a good match.
- Memory has only weak or medium confidence.

When asking, show a short numbered list with at most 3 options, including name,
size and price. Put a remembered association first when relevant. Ask in one
line: *"Which did you mean? (1/2/3 or describe it differently)"*

### 3c - Add

Call:
- `add_to_cart(product_id=<product_id>, qty=<qty>, vendor=VENDOR)`

Use the quantity the user specified, defaulting to 1. The response is the
updated cart.

### 3d - Confirm lightly

Say one line, for example:
*"Added Essential Semi-Skimmed Milk 4 Pints (GBP 1.75)."*

Do not ask for confirmation before adding when the match is clear.

### 3e - Remember

After the final product is added, record the association between the original
phrase and the product that actually went into the basket:

- `memory_record(phrase=<original phrase>, product_id=<product id>, product_name=<product name>, vendor=VENDOR, search_term=<successful search term>, source=<source>, size=<size>, price=<price>)`

Use `source="accepted_suggestion"` when the user accepts a remembered suggestion.
Use `source="auto_added"` only when you added from high-confidence memory without
asking. Use `source="user_selected"` when the user picked from options or gave a
clarifying description.

If the user corrects a wrong product, remove or fix the basket item as needed
with `set_cart_quantity`, then record the correction:

- `memory_reject(phrase=<original phrase>, vendor=VENDOR, wrong_product_id=<wrong product id>, wrong_product_name=<wrong product name>, correct_product_id=<correct product id>, correct_product_name=<correct product name>)`

Do not ask the user whether to record memory. It is part of finishing the
shopping task.

## Step 4 - Summary

Once all items are processed, call:
- `get_cart(vendor=VENDOR)`

Show a clean summary:
- List every item added with quantity and price.
- Show the basket total.
- Note any items you couldn't find or that were skipped.

## Other operations

Change quantity of a basket item:
- `set_cart_quantity(cart_item_id=<cart_item_id>, qty=<qty>, vendor=VENDOR)`

`cart_item_id` comes from the `get_cart` response. `qty=0` removes the item.

Clear the basket only when the user explicitly asks:
- `clear_cart(vendor=VENDOR)`

Explain memory for one phrase:
- `memory_explain(phrase=<phrase>, vendor=VENDOR, limit=5)`

## Rules

- Be decisive. Use memory and order history to avoid asking about things the user clearly buys regularly.
- Be brief. One-line confirmations, short clarification questions.
- Never add an item you're not confident about without asking first.
- If the user says a quantity ("two", "a couple of", "x3"), use it.
- If a search returns nothing useful, tell the user and move on.
- Do not empty the basket before starting; items may already be there.
- IDs in ShopMe MCP responses are opaque strings; always pass them back exactly as received.
