import pytest
from playwright.async_api import async_playwright

CDP_URL = 'http://localhost:9222'


@pytest.mark.integration
async def test_connect_over_cdp():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(CDP_URL)
        assert browser is not None


@pytest.mark.integration
async def test_find_waitrose_page():
    async with async_playwright() as p:
        try:
            browser = await p.chromium.connect_over_cdp(CDP_URL)
        except Exception as e:
            pytest.skip(f'Chrome not running: {e}')

        page = None
        for context in browser.contexts:
            for pg in context.pages:
                if 'waitrose.com' in pg.url:
                    page = pg
                    break

        assert page is not None, (
            'No waitrose.com tab found. Open Chrome and navigate to waitrose.com.'
        )


@pytest.mark.integration
async def test_get_context_returns_customer_id(vendor):
    assert vendor._customer_id, 'customerId is empty — are you logged in to Waitrose?'


@pytest.mark.integration
async def test_get_context_returns_order_id(vendor):
    if not vendor._order_id:
        pytest.skip('orderId not available — no active basket on this account')
    assert vendor._order_id


@pytest.mark.integration
async def test_page_fetch_returns_200(vendor):
    url = ('https://www.waitrose.com/api/order-orchestration-prod/v1/orders'
           '?size=1&sortBy=%2B&statuses=PLACED')
    result = await vendor._fetch('GET', url)
    assert result['status'] == 200, (
        f'Expected 200, got {result["status"]}. Response: {result["body"]}'
    )
