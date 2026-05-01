from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Product:
    id: str
    name: str
    size: str | None
    price: str
    price_per_unit: str | None
    promotion: str | None


@dataclass
class CartItem:
    cart_item_id: str
    product_id: str
    name: str
    qty: int
    price: str


@dataclass
class Cart:
    items: list[CartItem]
    total: str
    savings: str | None


@dataclass
class Order:
    order_id: str
    status: str
    placed_date: str | None
    delivery_date: str | None
    total: str | None
    item_count: int | None


@dataclass
class OrderItem:
    line_number: str
    name: str | None
    size: str | None
    qty: int | None
    unit_price: str | None
    total_price: str | None


@dataclass
class OrderDetail:
    order_id: str
    status: str
    placed_date: str | None
    delivery_date: str | None
    total: str | None
    items: list[OrderItem]


class ShoppingVendor(ABC):
    @abstractmethod
    async def search(self, term: str, size: int = 10) -> list[Product]: ...

    @abstractmethod
    async def get_cart(self) -> Cart: ...

    @abstractmethod
    async def add(self, product_id: str, qty: int = 1) -> Cart: ...

    @abstractmethod
    async def set_qty(self, cart_item_id: str, qty: int) -> Cart: ...

    @abstractmethod
    async def clear(self) -> Cart: ...

    @abstractmethod
    async def get_orders(self, size: int = 15) -> list[Order]: ...

    @abstractmethod
    async def get_order(self, order_id: str) -> OrderDetail: ...
