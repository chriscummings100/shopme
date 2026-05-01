import inspect
from dataclasses import fields

import pytest

from vendors.base import Cart, CartItem, Order, OrderDetail, OrderItem, Product, ShoppingVendor
from vendors.waitrose import WaitroseVendor


@pytest.mark.unit
def test_product_id_roundtrip():
    encoded = WaitroseVendor._enc_product('123456', 'prod-789abc')
    line_number, prod_id = WaitroseVendor._dec_product(encoded)
    assert line_number == '123456'
    assert prod_id == 'prod-789abc'


@pytest.mark.unit
def test_cart_item_id_roundtrip():
    encoded = WaitroseVendor._enc_cart_item(987654, 'C62')
    trolley_item_id, uom = WaitroseVendor._dec_cart_item(encoded)
    assert trolley_item_id == 987654
    assert uom == 'C62'


@pytest.mark.unit
def test_cart_item_id_roundtrip_weighted():
    encoded = WaitroseVendor._enc_cart_item(111, 'KGM')
    trolley_item_id, uom = WaitroseVendor._dec_cart_item(encoded)
    assert trolley_item_id == 111
    assert uom == 'KGM'


@pytest.mark.unit
def test_product_fields():
    field_names = {f.name for f in fields(Product)}
    assert {'id', 'name', 'size', 'price', 'price_per_unit', 'promotion'} <= field_names


@pytest.mark.unit
def test_cart_item_fields():
    field_names = {f.name for f in fields(CartItem)}
    assert {'cart_item_id', 'product_id', 'name', 'qty', 'price'} <= field_names


@pytest.mark.unit
def test_cart_fields():
    field_names = {f.name for f in fields(Cart)}
    assert {'items', 'total', 'savings'} <= field_names


@pytest.mark.unit
def test_order_fields():
    field_names = {f.name for f in fields(Order)}
    assert {'order_id', 'status', 'placed_date', 'delivery_date', 'total', 'item_count'} <= field_names


@pytest.mark.unit
def test_order_detail_fields():
    field_names = {f.name for f in fields(OrderDetail)}
    assert {'order_id', 'status', 'placed_date', 'delivery_date', 'total', 'items'} <= field_names


@pytest.mark.unit
def test_order_item_fields():
    field_names = {f.name for f in fields(OrderItem)}
    assert {'line_number', 'name', 'size', 'qty', 'unit_price', 'total_price'} <= field_names


@pytest.mark.unit
def test_vendor_interface_implemented():
    abstract = {
        name for name, method in inspect.getmembers(ShoppingVendor, predicate=inspect.isfunction)
        if getattr(method, '__isabstractmethod__', False)
    }
    concrete = {
        name for name, _ in inspect.getmembers(WaitroseVendor, predicate=inspect.isfunction)
    }
    missing = abstract - concrete
    assert not missing, f'WaitroseVendor is missing: {missing}'
