# ShopMe MCP Smoke Test

Run this as a sub-agent to verify all MCP tools are working correctly.
Execute each step in order. After every tool call, check the stated assertion — if it fails, report the step name and the actual response, then continue with remaining steps. At the end, produce a summary table of PASS / FAIL for each step.

---

## Step 1 — ping
**Tool:** `ping`  
**Assert:** Response contains "API reachable" with no error.

---

## Step 2 — get_shopping_context
**Tool:** `get_shopping_context`  
**Assert:** Response contains a non-empty `customerId` and a non-empty `orderId`.

---

## Step 3 — empty_trolley (reset to known state)
**Tool:** `empty_trolley`  
**Assert:** Response is `{"ok":true}` with no error.

---

## Step 4 — get_trolley (verify empty)
**Tool:** `get_trolley`  
**Assert:** `items` array is empty, `itemTotal` is `£0.00`.

---

## Step 5 — search_products
**Tool:** `search_products`  
**Input:** `searchTerm: "semi-skimmed milk"`, `size: 5`  
**Assert:** Response contains at least 1 product with non-empty `lineNumber`, `name`, `price`, and `uom` fields. Save the first product's `lineNumber`, `productId`, and `uom` for use in subsequent steps.

---

## Step 6 — add_to_basket (single item)
**Tool:** `add_to_basket`  
**Input:** `lineNumber`, `productId`, `uom` from Step 5, `quantity: 1`  
**Assert:** Response is `{"ok":true,...}` with no error. `basketTotal` should be non-null.

---

## Step 7 — get_trolley (verify item added)
**Tool:** `get_trolley`  
**Assert:** `items` has exactly 1 entry. Its `lineNumber` matches the product from Step 5. `name` is non-empty. `quantity` is `1`. Save `trolleyItemId` for Step 9.

---

## Step 8 — add_to_basket (second product, quantity 2)
**Tool:** `search_products`  
**Input:** `searchTerm: "cheddar cheese"`, `size: 5`  
Then call `add_to_basket` with the first result, `quantity: 2`.  
**Assert:** `add_to_basket` returns `{"ok":true,...}` with no error.

---

## Step 9 — get_trolley (verify two items)
**Tool:** `get_trolley`  
**Assert:** `items` has exactly 2 entries. The cheddar item has `quantity: 2`.

---

## Step 10 — update_quantity
**Tool:** `update_quantity`  
**Input:** `trolleyItemId`, `lineNumber`, `productId`, `uom` for the milk item from Step 7. Set `quantity: 3`.  
**Assert:** Response is `{"ok":true,...}` with no error.

---

## Step 11 — get_trolley (verify quantity updated)
**Tool:** `get_trolley`  
**Assert:** The milk item now has `quantity: 3`.

---

## Step 12 — remove_from_basket
**Tool:** `remove_from_basket`  
**Input:** `trolleyItemId`, `lineNumber`, `productId`, `uom` for the milk item.  
**Assert:** Response is `{"ok":true,...}` with no error.

---

## Step 13 — get_trolley (verify item removed)
**Tool:** `get_trolley`  
**Assert:** `items` has exactly 1 entry (cheddar only). Milk item is gone.

---

## Step 14 — empty_trolley (cleanup)
**Tool:** `empty_trolley`  
**Assert:** Response is `{"ok":true}` with no error.

---

## Step 15 — get_trolley (verify clean state)
**Tool:** `get_trolley`  
**Assert:** `items` is empty, `itemTotal` is `£0.00`.

---

## Expected Summary

| Step | Tool | Description |
|------|------|-------------|
| 1 | ping | Extension reachable |
| 2 | get_shopping_context | Auth context present |
| 3 | empty_trolley | Reset state |
| 4 | get_trolley | Basket is empty |
| 5 | search_products | Search returns results |
| 6 | add_to_basket | Add single item |
| 7 | get_trolley | Item present with name |
| 8 | search + add_to_basket | Add second item qty 2 |
| 9 | get_trolley | Two items, correct qtys |
| 10 | update_quantity | Change qty to 3 |
| 11 | get_trolley | Qty reflects update |
| 12 | remove_from_basket | Remove one item |
| 13 | get_trolley | One item remains |
| 14 | empty_trolley | Cleanup |
| 15 | get_trolley | Clean state confirmed |
