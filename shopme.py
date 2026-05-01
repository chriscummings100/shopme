#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import subprocess
import sys
from dataclasses import asdict

from playwright.async_api import async_playwright

CDP_URL = 'http://localhost:9222'
VENDOR_URLS = {'waitrose': 'https://www.waitrose.com'}

CHROME_PATHS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
]


def find_chrome() -> str | None:
    for path in CHROME_PATHS:
        if os.path.exists(path):
            return path
    return None


def cmd_start(vendor_name: str):
    chrome = find_chrome()
    if not chrome:
        print(json.dumps({'error': 'Chrome executable not found', 'searched': CHROME_PATHS}))
        sys.exit(1)
    profile_dir = os.path.join(os.path.expanduser('~'), '.shopme-chrome')
    url = VENDOR_URLS[vendor_name]
    subprocess.Popen([chrome, '--remote-debugging-port=9222', f'--user-data-dir={profile_dir}', url])
    print(json.dumps({'ok': True, 'cdp': CDP_URL, 'url': url}))


async def get_vendor(vendor_name: str):
    from vendors.waitrose import WaitroseVendor

    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            print(json.dumps({'error': f'Cannot connect to Chrome: {e}', 'hint': 'Run: python shopme.py start'}))
            sys.exit(1)

        vendor_host = VENDOR_URLS[vendor_name].replace('https://', '').replace('http://', '')
        page = None
        for context in browser.contexts:
            for p in context.pages:
                if vendor_host in p.url:
                    page = p
                    break
            if page:
                break

        if page is None:
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = await context.new_page()
            await page.goto(VENDOR_URLS[vendor_name])

        vendor = WaitroseVendor(page)
        await vendor._init_context()
        yield vendor


async def run(args):
    vendor_name = args.vendor

    if args.command == 'start':
        cmd_start(vendor_name)
        return

    try:
        async for vendor in get_vendor(vendor_name):
            result = await dispatch(args, vendor)
            print(json.dumps(result, indent=2))
    except RuntimeError as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


async def dispatch(args, vendor):
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
        url = f'{VENDOR_URLS[args.vendor]}{args.path}' if args.path.startswith('/') else args.path
        return await vendor._fetch(args.method, url, body)

    raise RuntimeError(f'Unknown command: {args.command}')


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='shopme', description='AI shopping assistant CLI')
    parser.add_argument('--vendor', default='waitrose', choices=list(VENDOR_URLS))

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

    p = sub.add_parser('api', help='Raw authenticated API call (exploration)')
    p.add_argument('method', choices=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    p.add_argument('path', help='API path, e.g. /api/delivery-pass-orchestration-prod/v1/pass/status')
    p.add_argument('body', nargs='?', default=None, help='JSON body string')

    return parser


if __name__ == '__main__':
    args = build_parser().parse_args()
    asyncio.run(run(args))
