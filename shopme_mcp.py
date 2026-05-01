#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from dataclasses import asdict
from typing import Any, Awaitable, Callable, Literal

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as e:
    raise SystemExit(
        'The MCP SDK is not installed. Run: pip install -r requirements.txt'
    ) from e

import shopping_memory
from shopme import (
    ShopMeError,
    VENDOR_URLS,
    get_vendor,
    screenshot_url,
    start_browser as launch_browser,
)


VendorName = Literal['waitrose', 'sainsburys']
HttpMethod = Literal['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

INSTRUCTIONS = """
ShopMe exposes shopping tools for the user's live grocery browser session.
Chrome must be running with remote debugging enabled and the user must already
be logged in to the chosen supermarket. Product, cart, and order IDs are opaque:
pass back IDs returned by previous ShopMe tool calls rather than inventing IDs.
The clear_cart and set_cart_quantity tools change the user's basket.
"""

mcp = FastMCP('ShopMe', instructions=INSTRUCTIONS)


def _raise_mcp_error(error: ShopMeError) -> None:
    raise RuntimeError(json.dumps(error.as_error(), sort_keys=True)) from error


def _validate_vendor(vendor: str | None) -> None:
    if vendor is not None and vendor not in VENDOR_URLS:
        raise RuntimeError(
            json.dumps({'error': 'Unknown vendor', 'choices': list(VENDOR_URLS)}, sort_keys=True)
        )


async def _with_vendor(
    vendor_name: VendorName | None,
    action: Callable[[str, Any], Awaitable[Any]],
) -> Any:
    try:
        async for resolved_name, vendor in get_vendor(vendor_name):
            return await action(resolved_name, vendor)
    except ShopMeError as e:
        _raise_mcp_error(e)
    raise RuntimeError('Vendor connection closed unexpectedly')


@mcp.tool()
def start_browser(vendor: VendorName) -> dict[str, Any]:
    """Launch Chrome with remote debugging for a supermarket login session."""
    try:
        return launch_browser(vendor)
    except ShopMeError as e:
        _raise_mcp_error(e)


@mcp.tool()
async def search_products(
    term: str,
    size: int = 10,
    vendor: VendorName | None = None,
) -> list[dict[str, Any]]:
    """Search products at the active supermarket and return opaque product IDs."""

    async def action(_: str, client: Any) -> list[dict[str, Any]]:
        products = await client.search(term, size=size)
        return [asdict(product) for product in products]

    return await _with_vendor(vendor, action)


@mcp.tool()
async def get_cart(vendor: VendorName | None = None) -> dict[str, Any]:
    """Return the current basket contents, totals, and opaque cart item IDs."""

    async def action(_: str, client: Any) -> dict[str, Any]:
        return asdict(await client.get_cart())

    return await _with_vendor(vendor, action)


@mcp.tool()
async def add_to_cart(
    product_id: str,
    qty: int = 1,
    vendor: VendorName | None = None,
) -> dict[str, Any]:
    """Add a product returned by search_products to the basket."""

    async def action(_: str, client: Any) -> dict[str, Any]:
        return asdict(await client.add(product_id, qty=qty))

    return await _with_vendor(vendor, action)


@mcp.tool()
async def set_cart_quantity(
    cart_item_id: str,
    qty: int,
    vendor: VendorName | None = None,
) -> dict[str, Any]:
    """Set a basket item's quantity. Passing qty=0 removes the item."""

    async def action(_: str, client: Any) -> dict[str, Any]:
        return asdict(await client.set_qty(cart_item_id, qty=qty))

    return await _with_vendor(vendor, action)


@mcp.tool()
async def clear_cart(vendor: VendorName | None = None) -> dict[str, Any]:
    """Empty the current basket."""

    async def action(_: str, client: Any) -> dict[str, Any]:
        return asdict(await client.clear())

    return await _with_vendor(vendor, action)


@mcp.tool()
async def list_orders(
    size: int = 15,
    vendor: VendorName | None = None,
) -> list[dict[str, Any]]:
    """List recent and active orders."""

    async def action(_: str, client: Any) -> list[dict[str, Any]]:
        orders = await client.get_orders(size=size)
        return [asdict(order) for order in orders]

    return await _with_vendor(vendor, action)


@mcp.tool()
async def get_order(
    order_id: str,
    vendor: VendorName | None = None,
) -> dict[str, Any]:
    """Return full detail for an order ID returned by list_orders."""

    async def action(_: str, client: Any) -> dict[str, Any]:
        return asdict(await client.get_order(order_id))

    return await _with_vendor(vendor, action)


@mcp.tool()
async def screenshot_page(url: str, output: str = 'screenshot.png') -> dict[str, str]:
    """Open a URL in the live Chrome session, save a screenshot, and close the tab."""
    try:
        return await screenshot_url(url, output)
    except ShopMeError as e:
        _raise_mcp_error(e)


@mcp.tool()
def memory_summary(vendor: VendorName | None = None, limit: int = 3) -> dict[str, Any]:
    """Return compact phrase-to-product shopping memory."""
    _validate_vendor(vendor)
    return shopping_memory.build_summary(vendor=vendor, limit=limit)


@mcp.tool()
def memory_explain(
    phrase: str,
    vendor: VendorName | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    """Return memory evidence for one shopping phrase."""
    _validate_vendor(vendor)
    return shopping_memory.explain(phrase, vendor=vendor, limit=limit)


@mcp.tool()
def memory_record(
    phrase: str,
    product_id: str,
    product_name: str,
    vendor: VendorName,
    search_term: str | None = None,
    source: Literal['auto_added', 'accepted_suggestion', 'user_selected', 'correction', 'manual'] = 'user_selected',
    size: str | None = None,
    price: str | None = None,
) -> dict[str, Any]:
    """Record that a shopping phrase resolved to a product."""
    return {
        'ok': True,
        'event': shopping_memory.record_association(
            phrase=phrase,
            vendor=vendor,
            product_id=product_id,
            product_name=product_name,
            search_term=search_term,
            source=source,
            size=size,
            price=price,
        ),
    }


@mcp.tool()
def memory_reject(
    phrase: str,
    vendor: VendorName,
    wrong_product_id: str | None = None,
    wrong_product_name: str | None = None,
    correct_product_id: str | None = None,
    correct_product_name: str | None = None,
) -> dict[str, Any]:
    """Record that a shopping phrase did not mean a product."""
    return {
        'ok': True,
        'event': shopping_memory.record_rejection(
            phrase=phrase,
            vendor=vendor,
            wrong_product_id=wrong_product_id,
            wrong_product_name=wrong_product_name,
            correct_product_id=correct_product_id,
            correct_product_name=correct_product_name,
        ),
    }


@mcp.resource('shopme://memory/summary')
def memory_summary_resource() -> str:
    """Shopping memory summary as a JSON resource."""
    return json.dumps(shopping_memory.build_summary(), indent=2)


@mcp.resource('shopme://memory/summary/{vendor}')
def vendor_memory_summary_resource(vendor: str) -> str:
    """Vendor-specific shopping memory summary as a JSON resource."""
    _validate_vendor(vendor)
    return json.dumps(shopping_memory.build_summary(vendor=vendor), indent=2)


if os.environ.get('SHOPME_MCP_ENABLE_RAW_API') == '1':

    @mcp.tool()
    async def raw_api(
        method: HttpMethod,
        path: str,
        body: dict[str, Any] | None = None,
        vendor: VendorName | None = None,
    ) -> dict[str, Any]:
        """Make a raw authenticated vendor API call. Disabled unless explicitly enabled."""

        async def action(resolved_name: str, client: Any) -> dict[str, Any]:
            base = VENDOR_URLS[resolved_name]
            url = f'{base}{path}' if path.startswith('/') else path
            return await client._fetch(method, url, body)

        return await _with_vendor(vendor, action)


def main() -> None:
    mcp.run()


if __name__ == '__main__':
    main()
