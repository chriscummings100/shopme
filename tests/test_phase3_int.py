import pytest

SEARCH_TERM = 'milk'


@pytest.mark.integration
async def test_search_returns_products(vendor):
    products = await vendor.search(SEARCH_TERM, size=5)
    assert len(products) > 0, 'Search returned no products'
    for p in products:
        assert p.id, 'Product.id is empty'
        assert p.name, 'Product.name is empty'
        assert p.price, 'Product.price is empty'


@pytest.mark.integration
async def test_search_id_is_opaque_string(vendor):
    products = await vendor.search(SEARCH_TERM, size=3)
    assert products
    for p in products:
        assert isinstance(p.id, str) and len(p.id) > 0


@pytest.mark.integration
async def test_cart_returns_shape(vendor):
    cart = await vendor.get_cart()
    assert isinstance(cart.items, list)
    assert isinstance(cart.total, str)
    assert cart.total.startswith('£')


@pytest.mark.integration
async def test_add_item(clean_cart):
    products = await clean_cart.search(SEARCH_TERM, size=5)
    assert products, 'No products found to add'
    cart = await clean_cart.add(products[0].id, qty=1)
    assert any(i.product_id == products[0].id for i in cart.items), (
        'Added product not found in cart'
    )


@pytest.mark.integration
async def test_add_returns_updated_cart(clean_cart):
    products = await clean_cart.search(SEARCH_TERM, size=5)
    cart = await clean_cart.add(products[0].id, qty=1)
    assert len(cart.items) > 0
    assert cart.total != '£0.00'


@pytest.mark.integration
async def test_set_qty_changes_quantity(clean_cart):
    products = await clean_cart.search(SEARCH_TERM, size=5)
    await clean_cart.add(products[0].id, qty=1)
    cart = await clean_cart.get_cart()
    item = next(i for i in cart.items if i.product_id == products[0].id)
    updated = await clean_cart.set_qty(item.cart_item_id, qty=2)
    updated_item = next(i for i in updated.items if i.cart_item_id == item.cart_item_id)
    assert updated_item.qty == 2


@pytest.mark.integration
async def test_set_qty_zero_removes_item(clean_cart):
    products = await clean_cart.search(SEARCH_TERM, size=5)
    await clean_cart.add(products[0].id, qty=1)
    cart = await clean_cart.get_cart()
    item_id = next(i.cart_item_id for i in cart.items if i.product_id == products[0].id)
    updated = await clean_cart.set_qty(item_id, qty=0)
    assert not any(i.cart_item_id == item_id for i in updated.items), (
        'Item still present after set_qty to 0'
    )


@pytest.mark.integration
async def test_orders_returns_list(vendor):
    orders = await vendor.get_orders(size=5)
    assert len(orders) > 0, 'No orders found — account may have no history'
    for o in orders:
        assert o.order_id, 'Order.order_id is empty'
        assert o.status, 'Order.status is empty'


@pytest.mark.integration
async def test_order_detail_has_items(vendor):
    orders = await vendor.get_orders(size=1)
    assert orders, 'No orders to fetch detail for'
    detail = await vendor.get_order(orders[0].order_id)
    assert detail.items, 'Order detail has no items'
    assert detail.items[0].name, 'First order item has no name'
