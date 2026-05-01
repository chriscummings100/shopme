from playwright.async_api import Page

from .base import (
    Cart, CartItem, Order, OrderDetail, OrderItem, Product, ShoppingVendor,
)

_BASE = 'https://www.waitrose.com'
_GRAPHQL = f'{_BASE}/api/graphql-prod/graph/live'
_ORDER_STATUSES = 'AMENDING%2BFULFIL%2BPAID%2BPAYMENT_FAILED%2BPICKED%2BPLACED'


class WaitroseVendor(ShoppingVendor):
    def __init__(self, page: Page):
        self._page = page
        self._customer_id = ''
        self._order_id = ''

    async def _init_context(self):
        ctx = await self._page.evaluate("""() => ({
            customerId: localStorage.getItem('wtr_customer_id'),
            orderId: localStorage.getItem('wtr_order_id'),
        })""")
        self._customer_id = ctx.get('customerId') or ''
        self._order_id = ctx.get('orderId') or ''

    async def _fetch(self, method: str, url: str, body=None) -> dict:
        return await self._page.evaluate("""async ([method, url, body]) => {
            const opts = { method, headers: { 'Content-Type': 'application/json' } };
            if (body !== null) opts.body = JSON.stringify(body);
            const r = await fetch(url, opts);
            const text = await r.text();
            let data;
            try { data = JSON.parse(text); } catch { data = text; }
            return { status: r.status, body: data };
        }""", [method, url, body])

    async def _gql(self, query: str, variables: dict) -> dict:
        result = await self._fetch('POST', _GRAPHQL, {'query': query, 'variables': variables})
        if result['status'] != 200:
            raise RuntimeError(f'GraphQL HTTP {result["status"]}')
        data = result['body']
        if data.get('errors'):
            raise RuntimeError(', '.join(e['message'] for e in data['errors']))
        return data['data']

    async def _lookup_names(self, line_numbers: list[str]) -> dict[str, dict]:
        encoded = '%2B'.join(line_numbers)
        result = await self._fetch('GET', f'{_BASE}/api/products-prod/v1/products/{encoded}?view=SUMMARY')
        if result['status'] != 200:
            return {}
        return {p['lineNumber']: {'name': p.get('name'), 'size': p.get('size')}
                for p in result['body'].get('products', [])}

    @staticmethod
    def _enc_product(line_number: str, product_id: str) -> str:
        return f'{line_number}:{product_id}'

    @staticmethod
    def _dec_product(product_id: str) -> tuple[str, str]:
        line_number, prod_id = product_id.split(':', 1)
        return line_number, prod_id

    @staticmethod
    def _enc_cart_item(trolley_item_id: int, uom: str) -> str:
        return f'{trolley_item_id}:{uom}'

    @staticmethod
    def _dec_cart_item(cart_item_id: str) -> tuple[int, str]:
        tid, uom = cart_item_id.split(':', 1)
        return int(tid), uom

    async def search(self, term: str, size: int = 10) -> list[Product]:
        if not self._customer_id:
            await self._init_context()
        url = (f'{_BASE}/api/content-prod/v2/cms/publish/productcontent'
               f'/search/{self._customer_id}?clientType=WEB_APP')
        body = {'customerSearchRequest': {'queryParams': {
            'searchTerm': term, 'size': size, 'sortBy': 'MOST_POPULAR',
            'searchTags': [], 'filterTags': [],
            'orderId': self._order_id, 'categoryLevel': 1,
        }}}
        result = await self._fetch('POST', url, body)
        if result['status'] != 200:
            raise RuntimeError(f'Search HTTP {result["status"]}')
        products = []
        for c in result['body'].get('componentsAndProducts', []):
            p = c.get('searchProduct')
            if not p:
                continue
            promo = p.get('promotion')
            products.append(Product(
                id=self._enc_product(p['lineNumber'], p['id']),
                name=p.get('name', ''),
                size=p.get('size'),
                price=p.get('displayPrice', ''),
                price_per_unit=p.get('displayPriceQualifier'),
                promotion=promo.get('promotionDescription') if promo else None,
            ))
        return products

    async def get_cart(self) -> Cart:
        if not self._order_id:
            await self._init_context()
        data = await self._gql("""
            query($orderId: ID!) {
              getTrolley(orderId: $orderId) {
                trolley {
                  trolleyItems {
                    trolleyItemId lineNumber productId
                    quantity { amount uom }
                    totalPrice { amount currencyCode }
                  }
                  trolleyTotals {
                    itemTotalEstimatedCost { amount currencyCode }
                    savingsFromOffers { amount currencyCode }
                  }
                }
              }
            }""", {'orderId': self._order_id})

        trolley = (data.get('getTrolley') or {}).get('trolley') or {}
        raw_items = trolley.get('trolleyItems') or []

        name_map = {}
        if raw_items:
            name_map = await self._lookup_names([i['lineNumber'] for i in raw_items])

        items = []
        for i in raw_items:
            info = name_map.get(i['lineNumber'], {})
            items.append(CartItem(
                cart_item_id=self._enc_cart_item(i['trolleyItemId'], i['quantity']['uom']),
                product_id=self._enc_product(i['lineNumber'], i['productId']),
                name=info.get('name') or '',
                qty=i['quantity']['amount'],
                price=f"£{i['totalPrice']['amount']:.2f}",
            ))

        totals = trolley.get('trolleyTotals') or {}
        total_amt = (totals.get('itemTotalEstimatedCost') or {}).get('amount', 0)
        savings_amt = (totals.get('savingsFromOffers') or {}).get('amount', 0)
        return Cart(
            items=items,
            total=f'£{total_amt:.2f}',
            savings=f'£{savings_amt:.2f}' if savings_amt > 0 else None,
        )

    async def add(self, product_id: str, qty: int = 1) -> Cart:
        if not self._order_id:
            await self._init_context()
        line_number, prod_id = self._dec_product(product_id)
        data = await self._gql("""
            mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
              addItemToTrolley(orderId: $orderId, trolleyItem: $trolleyItem) {
                trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
                failures { message type }
              }
            }""", {
            'orderId': self._order_id,
            'trolleyItem': {
                'lineNumber': line_number,
                'productId': prod_id,
                'quantity': {'amount': qty, 'uom': 'C62'},
                'trolleyItemId': -int(line_number),
            },
        })
        failures = (data.get('addItemToTrolley') or {}).get('failures') or []
        if failures:
            raise RuntimeError(', '.join(f['message'] for f in failures))
        return await self.get_cart()

    async def set_qty(self, cart_item_id: str, qty: int) -> Cart:
        if not self._order_id:
            await self._init_context()
        trolley_item_id, uom = self._dec_cart_item(cart_item_id)

        cart = await self.get_cart()
        item = next((i for i in cart.items if i.cart_item_id == cart_item_id), None)
        if item is None:
            raise RuntimeError(f'Cart item {cart_item_id!r} not found')
        line_number, prod_id = self._dec_product(item.product_id)

        data = await self._gql("""
            mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
              updateTrolleyItem(orderId: $orderId, trolleyItem: $trolleyItem) {
                trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
                failures { message type }
              }
            }""", {
            'orderId': self._order_id,
            'trolleyItem': {
                'trolleyItemId': trolley_item_id,
                'lineNumber': line_number,
                'productId': prod_id,
                'quantity': {'amount': qty, 'uom': uom},
                'canSubstitute': True,
                'personalisedMessage': None,
            },
        })
        failures = (data.get('updateTrolleyItem') or {}).get('failures') or []
        if failures:
            raise RuntimeError(', '.join(f['message'] for f in failures))
        return await self.get_cart()

    async def clear(self) -> Cart:
        if not self._order_id:
            await self._init_context()
        await self._gql(
            'mutation($orderId: ID!) { emptyTrolley(orderId: $orderId) { trolley { orderId } } }',
            {'orderId': self._order_id},
        )
        ctx = await self._page.evaluate("() => localStorage.getItem('wtr_order_id')")
        if ctx:
            self._order_id = ctx
        return await self.get_cart()

    async def get_orders(self, size: int = 15) -> list[Order]:
        url = (f'{_BASE}/api/order-orchestration-prod/v1/orders'
               f'?size={size}&sortBy=%2B&statuses={_ORDER_STATUSES}')
        result = await self._fetch('GET', url)
        if result['status'] != 200:
            raise RuntimeError(f'Orders HTTP {result["status"]}')
        orders = []
        for o in result['body'].get('content', []):
            total = ((o.get('totals') or {}).get('estimated') or {}).get('totalPrice', {}).get('amount')
            slots = o.get('slots') or []
            orders.append(Order(
                order_id=o['customerOrderId'],
                status=o['status'],
                placed_date=o.get('created'),
                delivery_date=slots[0].get('startDateTime') if slots else None,
                total=f'£{float(total):.2f}' if total is not None else None,
                item_count=o.get('numberOfItems'),
            ))
        return orders

    async def get_order(self, order_id: str) -> OrderDetail:
        result = await self._fetch('GET', f'{_BASE}/api/order-orchestration-prod/v1/orders/{order_id}')
        if result['status'] != 200:
            raise RuntimeError(f'Order detail HTTP {result["status"]}')
        order = result['body']
        raw_items = order.get('orderLines') or []

        name_map = {}
        if raw_items:
            name_map = await self._lookup_names([l['lineNumber'] for l in raw_items])

        items = []
        for l in raw_items:
            info = name_map.get(l['lineNumber'], {})
            unit = (l.get('estimatedUnitPrice') or {}).get('amount')
            total = (l.get('estimatedTotalPrice') or {}).get('amount')
            items.append(OrderItem(
                line_number=l['lineNumber'],
                name=info.get('name'),
                size=info.get('size'),
                qty=(l.get('quantity') or {}).get('amount'),
                unit_price=f'£{float(unit):.2f}' if unit is not None else None,
                total_price=f'£{float(total):.2f}' if total is not None else None,
            ))

        grand_total = ((order.get('totals') or {}).get('estimated') or {}).get('totalPrice', {}).get('amount')
        slots = order.get('slots') or []
        return OrderDetail(
            order_id=order.get('customerOrderId', order_id),
            status=order.get('status', ''),
            placed_date=order.get('created'),
            delivery_date=slots[0].get('startDateTime') if slots else None,
            total=f'£{float(grand_total):.2f}' if grand_total is not None else None,
            items=items,
        )
