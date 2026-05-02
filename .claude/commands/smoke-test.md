Run a quick smoke test of the TypeScript ShopMe CLI against the live Waitrose
session.

Prerequisites: Chrome must be running with `--remote-debugging-port=9222` and a
Waitrose tab open and logged in. If not, tell the user to run:

```bash
npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose start
```

Execute each step in order. Report PASS or FAIL for each, then a final summary.

1. **Cart** - `npm exec --workspace @chriscummings100/shopme -- shopme cart` - JSON with `items` and `total`, no `error`.
2. **Search** - `npm exec --workspace @chriscummings100/shopme -- shopme search "milk" --size 3` - non-empty array; each item has `id`, `name`, and `price`.
3. **Add** - take the first result `id`, then run `npm exec --workspace @chriscummings100/shopme -- shopme add <id> 1` - cart contains the new item.
4. **Set qty** - take `cart_item_id`, then run `npm exec --workspace @chriscummings100/shopme -- shopme set <cart_item_id> 2` - cart shows quantity 2.
5. **Remove** - `npm exec --workspace @chriscummings100/shopme -- shopme set <cart_item_id> 0` - cart no longer contains the item.
6. **Orders** - `npm exec --workspace @chriscummings100/shopme -- shopme orders --size 3` - array with `order_id` and `status`.
7. **Order detail** - take the first `order_id`, then run `npm exec --workspace @chriscummings100/shopme -- shopme order <order_id>` - JSON with an `items` array.

Report overall PASS if all 7 steps pass, FAIL otherwise.
