Run a quick smoke test of the shopme CLI against the live Waitrose session.

Execute each step in order. Report PASS or FAIL for each, then a final summary.

Prerequisites: Chrome must be running with `--remote-debugging-port=9222` and a Waitrose tab open and logged in. If not, tell the user to run `.conda/python shopme.py start`.

---

1. **Cart** — `.conda/python shopme.py cart` — JSON with `items` and `total` fields, no `error` key
2. **Search** — `.conda/python shopme.py search "milk" --size 3` — non-empty array, each item has `id`, `name`, `price`
3. **Add** — take first result `id` from step 2, `.conda/python shopme.py add <id> 1` — cart JSON containing the new item
4. **Set qty** — take `cart_item_id` from step 3, `.conda/python shopme.py set <cart_item_id> 2` — cart with qty 2
5. **Remove** — `.conda/python shopme.py set <cart_item_id> 0` — cart with item absent
6. **Orders** — `.conda/python shopme.py orders --size 3` — non-empty array with `order_id` and `status`
7. **Order detail** — take first `order_id` from step 6, `.conda/python shopme.py order <order_id>` — JSON with non-empty `items`

Report overall PASS if all 7 steps pass, FAIL otherwise.
