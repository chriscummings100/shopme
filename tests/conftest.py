import pytest
import pytest_asyncio
from playwright.async_api import async_playwright

from vendors.waitrose import WaitroseVendor

CDP_URL = 'http://localhost:9222'
WAITROSE_URL = 'https://www.waitrose.com'


@pytest_asyncio.fixture
async def vendor():
    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            pytest.skip(f'Chrome not running on port 9222 ({e}). Run: python shopme.py start')

        page = None
        for context in browser.contexts:
            for p in context.pages:
                if 'waitrose.com' in p.url:
                    page = p
                    break
            if page:
                break

        if page is None:
            pytest.skip('No waitrose.com tab open. Navigate to waitrose.com and log in.')

        v = WaitroseVendor(page)
        await v._init_context()

        if not v._customer_id:
            pytest.skip('Not logged in to Waitrose. Please log in and try again.')

        yield v


@pytest_asyncio.fixture
async def clean_cart(vendor):
    yield vendor
    await vendor.clear()
