#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import subprocess
import sys
from dataclasses import asdict
from typing import Any

from playwright.async_api import async_playwright

import shopping_memory

CDP_URL = 'http://localhost:9222'
VENDOR_URLS = {
    'waitrose': 'https://www.waitrose.com',
    'sainsburys': 'https://www.sainsburys.co.uk',
}

CHROME_PATHS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
]


class ShopMeError(RuntimeError):
    def __init__(self, message: str, **details: Any):
        super().__init__(message)
        self.details = details

    def as_error(self) -> dict[str, Any]:
        return {'error': str(self), **self.details}


def find_chrome() -> str | None:
    for path in CHROME_PATHS:
        if os.path.exists(path):
            return path
    return None


def start_browser(vendor_name: str) -> dict[str, Any]:
    if vendor_name not in VENDOR_URLS:
        raise ShopMeError('Unknown vendor', choices=list(VENDOR_URLS))
    chrome = find_chrome()
    if not chrome:
        raise ShopMeError('Chrome executable not found', searched=CHROME_PATHS)
    profile_dir = os.path.join(os.path.expanduser('~'), '.shopme-chrome')
    url = VENDOR_URLS[vendor_name]
    subprocess.Popen([chrome, '--remote-debugging-port=9222', f'--user-data-dir={profile_dir}', url])
    return {'ok': True, 'cdp': CDP_URL, 'url': url}


def cmd_start(vendor_name: str):
    result = start_browser(vendor_name)
    print(json.dumps(result))


async def get_vendor(vendor_name: str | None):
    if vendor_name and vendor_name not in VENDOR_URLS:
        raise ShopMeError('Unknown vendor', choices=list(VENDOR_URLS))

    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            raise ShopMeError(f'Cannot connect to Chrome: {e}', hint='Run: python shopme.py start <vendor>')

        if vendor_name:
            host = VENDOR_URLS[vendor_name].replace('https://', '').replace('http://', '')
            page = None
            for context in browser.contexts:
                for p in context.pages:
                    if host in p.url:
                        page = p
                        break
                if page:
                    break
            if page is None:
                context = browser.contexts[0] if browser.contexts else await browser.new_context()
                page = await context.new_page()
                await page.goto(VENDOR_URLS[vendor_name])
        else:
            matches = []
            for context in browser.contexts:
                for p in context.pages:
                    for name, url in VENDOR_URLS.items():
                        host = url.replace('https://', '').replace('http://', '')
                        if host in p.url:
                            matches.append((name, p))
            if not matches:
                raise ShopMeError(
                    'No vendor site found in open tabs',
                    hint=f'Open one of {list(VENDOR_URLS)} or run: python shopme.py start <vendor>',
                )
            if len(matches) > 1:
                raise ShopMeError(
                    f'Multiple vendor tabs open: {[m[0] for m in matches]}',
                    hint='Use --vendor to specify which one',
                )
            vendor_name, page = matches[0]

        if vendor_name == 'sainsburys':
            from vendors.sainsburys import SainsburysVendor
            vendor = SainsburysVendor(page)
        else:
            from vendors.waitrose import WaitroseVendor
            vendor = WaitroseVendor(page)

        await vendor._init_context()
        yield vendor_name, vendor


async def screenshot_url(url: str, output: str) -> dict[str, str]:
    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            raise ShopMeError(f'Cannot connect to Chrome: {e}')

        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = await context.new_page()
        try:
            await page.goto(url, wait_until='load', timeout=15000)
            await page.screenshot(path=output, full_page=False)
        finally:
            await page.close()

    return {'path': os.path.abspath(output)}


async def cmd_screenshot(url: str, output: str):
    print(json.dumps(await screenshot_url(url, output)))


async def run(args):
    vendor_name = args.vendor

    if args.command == 'start':
        if not vendor_name:
            print(json.dumps({'error': '--vendor is required for start', 'choices': list(VENDOR_URLS)}))
            sys.exit(1)
        try:
            cmd_start(vendor_name)
        except ShopMeError as e:
            print(json.dumps(e.as_error()))
            sys.exit(1)
        return

    if args.command == 'memory':
        try:
            result = dispatch_memory(args)
            print(json.dumps(result, indent=2))
        except (RuntimeError, ValueError) as e:
            print(json.dumps({'error': str(e)}))
            sys.exit(1)
        return

    if args.command == 'screenshot':
        try:
            await cmd_screenshot(args.url, args.out)
        except ShopMeError as e:
            print(json.dumps(e.as_error()))
            sys.exit(1)
        return

    try:
        async for resolved_name, vendor in get_vendor(vendor_name):
            result = await dispatch(args, resolved_name, vendor)
            print(json.dumps(result, indent=2))
    except ShopMeError as e:
        print(json.dumps(e.as_error()))
        sys.exit(1)
    except RuntimeError as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


async def dispatch(args, resolved_name: str, vendor):
    if args.command == 'search':
        products = await vendor.search(args.term, size=args.size)
        return [asdict(p) for p in products]

    if args.command == 'cart':
        return asdict(await vendor.get_cart())

    if args.command == 'add':
        return asdict(await vendor.add(args.product_id, qty=args.qty))

    if args.command == 'set':
        return asdict(await vendor.set_qty(args.cart_item_id, qty=args.qty))

    if args.command == 'clear':
        return asdict(await vendor.clear())

    if args.command == 'orders':
        orders = await vendor.get_orders(size=args.size)
        return [asdict(o) for o in orders]

    if args.command == 'order':
        return asdict(await vendor.get_order(args.order_id))

    if args.command == 'api':
        body = json.loads(args.body) if args.body else None
        base = VENDOR_URLS[resolved_name]
        url = f'{base}{args.path}' if args.path.startswith('/') else args.path
        return await vendor._fetch(args.method, url, body)

    raise RuntimeError(f'Unknown command: {args.command}')


def dispatch_memory(args):
    vendor = getattr(args, 'memory_vendor', None) or args.vendor
    limit = getattr(args, 'limit', 3)

    if args.memory_command == 'summary':
        return shopping_memory.build_summary(vendor=vendor, limit=limit)

    if args.memory_command == 'explain':
        return shopping_memory.explain(args.phrase, vendor=vendor, limit=limit)

    if args.memory_command == 'record':
        if not vendor:
            raise RuntimeError('--vendor is required for memory record')
        return {
            'ok': True,
            'event': shopping_memory.record_association(
                phrase=args.phrase,
                vendor=vendor,
                product_id=args.product_id,
                product_name=args.product_name,
                search_term=args.search_term,
                source=args.source,
                size=args.size,
                price=args.price,
            ),
        }

    if args.memory_command == 'reject':
        if not vendor:
            raise RuntimeError('--vendor is required for memory reject')
        return {
            'ok': True,
            'event': shopping_memory.record_rejection(
                phrase=args.phrase,
                vendor=vendor,
                wrong_product_id=args.wrong_product_id,
                wrong_product_name=args.wrong_product_name,
                correct_product_id=args.correct_product_id,
                correct_product_name=args.correct_product_name,
            ),
        }

    raise RuntimeError(f'Unknown memory command: {args.memory_command}')


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='shopme', description='AI shopping assistant CLI')
    parser.add_argument('--vendor', default=None, choices=list(VENDOR_URLS),
                        help='Vendor to use (auto-detected from open tabs if omitted)')

    sub = parser.add_subparsers(dest='command', required=True)

    sub.add_parser('start', help='Launch Chrome with debug port and open vendor site')

    p = sub.add_parser('search', help='Search for products')
    p.add_argument('term')
    p.add_argument('--size', type=int, default=10)

    sub.add_parser('cart', help='Show current basket')

    p = sub.add_parser('add', help='Add a product to the basket')
    p.add_argument('product_id', help='Opaque product id from search results')
    p.add_argument('qty', type=int, nargs='?', default=1)

    p = sub.add_parser('set', help='Set quantity of a basket item (0 removes it)')
    p.add_argument('cart_item_id', help='Opaque cart item id from cart results')
    p.add_argument('qty', type=int)

    sub.add_parser('clear', help='Empty the basket')

    p = sub.add_parser('orders', help='List past and active orders')
    p.add_argument('--size', type=int, default=15)

    p = sub.add_parser('order', help='Get full details for a past order')
    p.add_argument('order_id')

    p = sub.add_parser('screenshot', help='Screenshot a URL using the live Chrome session')
    p.add_argument('url')
    p.add_argument('--out', default='screenshot.png', help='Output file path (default: screenshot.png)')

    p = sub.add_parser('api', help='Raw authenticated API call (exploration)')
    p.add_argument('method', choices=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    p.add_argument('path', help='API path, e.g. /api/delivery-pass-orchestration-prod/v1/pass/status')
    p.add_argument('body', nargs='?', default=None, help='JSON body string')

    memory = sub.add_parser('memory', help='Read and write soft shopping associations')
    memory_sub = memory.add_subparsers(dest='memory_command', required=True)

    p = memory_sub.add_parser('summary', help='Show compact shopping memory for the agent')
    p.add_argument('--vendor', dest='memory_vendor', choices=list(VENDOR_URLS),
                   help='Only include associations for one vendor')
    p.add_argument('--limit', type=int, default=3, help='Candidates per phrase (default: 3)')

    p = memory_sub.add_parser('explain', help='Show memory for one phrase')
    p.add_argument('phrase')
    p.add_argument('--vendor', dest='memory_vendor', choices=list(VENDOR_URLS),
                   help='Only include associations for one vendor')
    p.add_argument('--limit', type=int, default=5, help='Candidates to show (default: 5)')

    p = memory_sub.add_parser('record', help='Record that a phrase resolved to a product')
    p.add_argument('--phrase', required=True, help='Original user phrase, e.g. "d.yogurts"')
    p.add_argument('--product-id', required=True, help='Opaque product id from search results')
    p.add_argument('--product-name', required=True)
    p.add_argument('--vendor', dest='memory_vendor', choices=list(VENDOR_URLS),
                   help='Vendor for this association')
    p.add_argument('--search-term', default=None, help='Search term that found the product')
    p.add_argument('--source', default='user_selected',
                   choices=list(shopping_memory.POSITIVE_WEIGHTS),
                   help='How the association was resolved')
    p.add_argument('--size', default=None)
    p.add_argument('--price', default=None)

    p = memory_sub.add_parser('reject', help='Record that a phrase did not mean a product')
    p.add_argument('--phrase', required=True, help='Original user phrase')
    p.add_argument('--vendor', dest='memory_vendor', choices=list(VENDOR_URLS),
                   help='Vendor for this correction')
    p.add_argument('--wrong-product-id', default=None)
    p.add_argument('--wrong-product-name', default=None)
    p.add_argument('--correct-product-id', default=None)
    p.add_argument('--correct-product-name', default=None)

    return parser


if __name__ == '__main__':
    args = build_parser().parse_args()
    asyncio.run(run(args))
