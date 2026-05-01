import os
import urllib.request

import pytest

CHROME_PATHS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
]


@pytest.mark.unit
def test_chrome_executable_found():
    found = any(os.path.exists(p) for p in CHROME_PATHS)
    assert found, f'Chrome not found at any of:\n' + '\n'.join(CHROME_PATHS)


@pytest.mark.unit
def test_playwright_importable():
    # We use connect_over_cdp so Playwright's bundled chromium is not needed;
    # just confirm the package is installed and the CDP connector is present.
    from playwright.async_api import async_playwright
    assert hasattr(async_playwright().__aenter__.__self__, '__class__')


@pytest.mark.integration
def test_cdp_endpoint_reachable():
    try:
        with urllib.request.urlopen('http://localhost:9222/json', timeout=3) as r:
            assert r.status == 200, f'CDP returned HTTP {r.status}'
    except Exception as e:
        pytest.fail(f'CDP endpoint not reachable: {e}\nRun: python shopme.py start')
