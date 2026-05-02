# ShopMe CLI Smoke Test

Run this against a live Waitrose session.

Prerequisites: Chrome must be running with `--remote-debugging-port=9222` and a
Waitrose tab open and logged in. If not, run:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose start
```

Execute each step in order and report PASS or FAIL.

1. **Cart** - `npm exec --workspace @chriscummings100/shopme -- shopme cart`
   - Assert JSON has `items` and `total`, with no `error`.
2. **Search** - `npm exec --workspace @chriscummings100/shopme -- shopme search "milk" --size 3`
   - Assert a non-empty array; each item has `id`, `name`, and `price`.
3. **Add** - use the first search result ID:
   `npm exec --workspace @chriscummings100/shopme -- shopme add <id> 1`
   - Assert cart contains the new item.
4. **Set qty** - use the new `cart_item_id`:
   `npm exec --workspace @chriscummings100/shopme -- shopme set <cart_item_id> 2`
   - Assert cart shows quantity 2.
5. **Remove**:
   `npm exec --workspace @chriscummings100/shopme -- shopme set <cart_item_id> 0`
   - Assert the item is absent.
6. **Orders** - `npm exec --workspace @chriscummings100/shopme -- shopme orders --size 3`
   - Assert an array with `order_id` and `status`.
7. **Order detail** - use the first order ID:
   `npm exec --workspace @chriscummings100/shopme -- shopme order <order_id>`
   - Assert JSON contains an `items` array.

Overall PASS requires all seven steps to pass.
