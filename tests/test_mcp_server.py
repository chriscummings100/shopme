import pytest

from shopme_mcp import mcp


@pytest.mark.unit
async def test_mcp_core_tools_registered():
    tools = {tool.name for tool in await mcp.list_tools()}

    assert {
        'start_browser',
        'search_products',
        'get_cart',
        'add_to_cart',
        'set_cart_quantity',
        'clear_cart',
        'list_orders',
        'get_order',
        'screenshot_page',
        'memory_summary',
        'memory_explain',
        'memory_record',
        'memory_reject',
    } <= tools


@pytest.mark.unit
async def test_mcp_memory_resources_registered():
    resources = {str(resource.uri) for resource in await mcp.list_resources()}
    templates = {template.uriTemplate for template in await mcp.list_resource_templates()}

    assert 'shopme://memory/summary' in resources
    assert 'shopme://memory/summary/{vendor}' in templates
