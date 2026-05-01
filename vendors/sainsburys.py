from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

from playwright.async_api import Page

from .base import Cart, CartItem, Order, OrderDetail, OrderItem, Product, ShoppingVendor

_BASE = 'https://www.sainsburys.co.uk'
_BASKET = f'{_BASE}/groceries-api/gol-services/basket/v2/basket'
_PRODUCT = f'{_BASE}/groceries-api/gol-services/product/v1/product'
_ORDER = f'{_BASE}/groceries-api/gol-services/order/v1/order'

_ENABLED_FLAGS = (
    'add_to_favourites,use_food_basket_service,use_food_basket_service_v3,'
    'use_food_basket_service_v4,ads_conditionals,findability_v5,'
    'show_static_cnc_messaging,fetch_future_slot_weeks,'
    'click_and_collect_promo_banner,cookie_law_link,citrus_banners,'
    'citrus_favourites_trio_banners,offers_strategic_magnolia,special_logo,'
    'custom_product_messaging,promotional_link,promotional_link2,'
    'promotion_mechanics_page,findability_search,findability_autosuggest,'
    'fto_header_flag,recurring_slot_skip_opt_out,seasonal_favourites,'
    'cnc_start_amend_order_modal,favourites_product_cta_alt,'
    'get_favourites_from_v2,krang_alternatives,offers_config,'
    'alternatives_modal,relevancy_rank,changes_to_trolley,'
    'nectar_destination_page,unit_price_legislation,meal_deal_live,'
    'browse_pills_nav_type,use_cached_findability_results,event_zone_list,'
    'cms_carousel_zone_list,show_ynp_change_slot_banner,'
    'recipe_scrapbooks_enabled,event_carousel_skus,split_savings,'
    'trolley_nectar_card,favourites_magnolia,homepage,taggstar,'
    'meal_deal_cms_template_ids,pdp_accordions,pdp_occasions_pills,'
    'pdp_meta_desc_template,grouped_meal_deals,pci_phase_2,'
    'meal_deal_builder_nectar_widget,occasions_navigation,'
    'slots_event_banner_config,sales_window,resting_search,'
    'brands_background,brands_background_config,taggstar_config,'
    'all_ad_components_enabled,left_align_header,golui_my_addresses,'
    'new_global_header,new_filter_pages,spoonguru_disclaimers,'
    'recipe_reviews_enabled,sponsored_drawer,frequently_bought_together,'
    'show_ynp_opt_in_ui_elements,show_ynp_add_to_basket_toast,show_ynp_card,'
    'similar_products_drawer,fetch_ynp_opt_ins,resting_search_v2,bop_enabled,'
    'identity_transfer,prop_bar,favourites_boards,slot_confirmation_board,'
    'mobile_nav_2,highlight_seasonal_nav_item,should_not_scroll_into_view_fbt,'
    'show_popular_categories,compact_reviews,track_remove_scroll_experiment,'
    'favourites_grouped_by_top_category,track_boards_experiment,'
    'ynpoptin_national_launch,favourites_link_on_global_header,hey_sainsburys,'
    'heys_resting_state,krang_newness,show_tpr_straplines,'
    'track_compact_tile_experiment,track_pdp_occasions_pills_experiment,'
    'use_compact_tile_boards,use_compact_tile_previous_orders,use_compact_tile,'
    'occasions_closure_end_date_2025,favourites_view_all_AB_test,'
    'retry_your_payments,offers_revamp_2025_rollout,'
    'favourites_slot_your_usuals_tracking,product_bundles,fable_search_bar,'
    'hard_sku_replacement,track_occasions_available_from,continue_shopping_link,'
    'fto_first_available_slot,drip_pricing_phase_2_homepage,'
    'drip_pricing_phase_3_header,qualifying_basket_amount,app_banner,'
    'bigger_images,call_bcs,catchweight_dropdown,citrus_preview_new,'
    'citrus_search_trio_banners,citrus_xsell,compare_seasonal_favourites,'
    'constant_commerce_v2,ctt_ynp_products,desktop_interstitial_variant,'
    'disable_product_cache_validation,event_dates,favourites_pill_nav,'
    'favourites_whole_service,favourites_your_usuals_tracking,fbt_on_search,'
    'fbt_on_search_tracking,ff_abc_test_display,first_favourites_static,'
    'foodmaestro_modal,hfss_restricted,interstitial_variant,kg_price_label,'
    'krang_recommendations,lp_ab_test_display,lp_interstitial_grid_config,'
    'meal_planner,meganav,mobile_interstitial_variant,my_nectar_migration,'
    'nectar_card_associated,nectar_prices,new_favourites_filter,'
    'new_favourites_service,new_filters,ni_brexit_banner,occasions,'
    'offers_mechanics_carousel,optimised_product_tile,promo_lister_page,'
    'recipes_ingredients_modal,review_syndication,rokt,sale_january,'
    'search_cms,show_hd_xmas_slots_banner,similar_products,slot_v2,'
    'sponsored_featured_tiles,use_op_orchestrator_sde,xmas_dummy_skus,'
    'your_nectar_prices'
)

_FETCH_JS = """async ([method, url, body, headers]) => {
    const opts = { method, headers: { ...headers } };
    if (body !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, body: data };
}"""


class SainsburysVendor(ShoppingVendor):
    def __init__(self, page: Page):
        self._page = page
        self._access_token = ''
        self._wc_auth_token = ''
        self._store_identifier = '0652'
        self._flexi_stores = '0686'

    async def _init_context(self):
        ctx = await self._page.evaluate("""() => {
            const oidcRaw = localStorage.getItem('oidc.user:https://account.sainsburys.co.uk:gol');
            const oidc = oidcRaw ? JSON.parse(oidcRaw) : {};
            const wcMatch = document.cookie.match(/WC_AUTHENTICATION_\\d+=([^;]+)/);
            const slotRaw = localStorage.getItem('slot-reservation-cached');
            const slot = slotRaw ? JSON.parse(slotRaw) : {};
            return {
                accessToken: oidc.access_token || '',
                wcAuthToken: wcMatch ? wcMatch[1] : '',
                storeIdentifier: slot.storeIdentifier || '0652',
                flexiStores: (slot.flexiStores || [])[0] || '0686',
            };
        }""")
        self._access_token = ctx.get('accessToken') or ''
        self._wc_auth_token = ctx.get('wcAuthToken') or ''
        self._store_identifier = ctx.get('storeIdentifier') or '0652'
        self._flexi_stores = ctx.get('flexiStores') or '0686'

    def _pick_time(self) -> str:
        t = datetime.now(timezone.utc) + timedelta(days=1)
        return t.strftime('%Y-%m-%dT%H:%M:%SZ')

    def _headers(self) -> dict:
        return {
            'Authorization': f'Bearer {self._access_token}',
            'wcauthtoken': self._wc_auth_token,
            'enabled-feature-flags': _ENABLED_FLAGS,
            'accept': 'application/json',
        }

    async def _fetch(self, method: str, url: str, body=None) -> dict:
        result = await self._page.evaluate(_FETCH_JS, [method, url, body, self._headers()])
        if result['status'] == 401:
            await self._page.reload(wait_until='networkidle')
            await self._init_context()
            result = await self._page.evaluate(_FETCH_JS, [method, url, body, self._headers()])
        return result

    @staticmethod
    def _enc_cart_item(item_uid: str, product_uid: str, uom: str) -> str:
        return f'{item_uid}:{product_uid}:{uom}'

    @staticmethod
    def _dec_cart_item(cart_item_id: str) -> tuple[str, str, str]:
        item_uid, product_uid, uom = cart_item_id.split(':', 2)
        return item_uid, product_uid, uom

    def _basket_qs(self) -> str:
        return urlencode({
            'pick_time': self._pick_time(),
            'store_number': self._store_identifier,
            'slot_booked': 'false',
        })

    def _parse_cart(self, body: dict) -> Cart:
        items = []
        for i in body.get('items', []):
            product = i.get('product', {})
            items.append(CartItem(
                cart_item_id=self._enc_cart_item(
                    i['item_uid'], product.get('sku', ''), i.get('uom', 'ea')
                ),
                product_id=product.get('sku', ''),
                name=product.get('name', ''),
                qty=i.get('quantity', 0),
                price=f"£{i.get('subtotal_price', 0):.2f}",
            ))
        total = body.get('total_price', 0)
        savings = body.get('savings', 0)
        return Cart(
            items=items,
            total=f'£{total:.2f}',
            savings=f'£{abs(savings):.2f}' if savings else None,
        )

    async def search(self, term: str, size: int = 10) -> list[Product]:
        if not self._access_token:
            await self._init_context()
        qs = urlencode({
            'filter[keyword]': term,
            'page_number': 1,
            'page_size': size,
            'sort_order': 'FAVOURITES_FIRST',
            'store_identifier': self._store_identifier,
            'region': 'England',
            'flexi_stores': self._flexi_stores,
            'salesWindow': 1,
        })
        result = await self._fetch('GET', f'{_PRODUCT}?{qs}')
        if result['status'] != 200:
            raise RuntimeError(f'Search HTTP {result["status"]}')
        products = []
        for p in result['body'].get('products', []):
            retail = p.get('retail_price') or {}
            unit = p.get('unit_price') or {}
            promos = p.get('promotions') or []
            measure = unit.get('measure', '')
            size_str = f"{unit.get('measure_amount', 1)}{measure}" if measure and measure != 'ea' else None
            price_per = (f"£{unit['price']:.2f}/{measure}" if unit.get('price') and measure else None)
            products.append(Product(
                id=p['product_uid'],
                name=p.get('name', ''),
                size=size_str,
                price=f"£{retail.get('price', 0):.2f}",
                price_per_unit=price_per,
                promotion=promos[0].get('strap_line') if promos else None,
            ))
        return products

    async def get_cart(self) -> Cart:
        if not self._access_token:
            await self._init_context()
        result = await self._fetch('GET', f'{_BASKET}?{self._basket_qs()}')
        if result['status'] != 200:
            raise RuntimeError(f'Cart HTTP {result["status"]}')
        return self._parse_cart(result['body'])

    async def add(self, product_id: str, qty: int = 1) -> Cart:
        if not self._access_token:
            await self._init_context()
        body = {'product_uid': product_id, 'quantity': qty, 'uom': 'ea', 'selected_catchweight': ''}
        result = await self._fetch('POST', f'{_BASKET}/item?{self._basket_qs()}', body)
        if result['status'] not in (200, 201):
            raise RuntimeError(f'Add HTTP {result["status"]}')
        return self._parse_cart(result['body'])

    async def set_qty(self, cart_item_id: str, qty: int) -> Cart:
        if not self._access_token:
            await self._init_context()
        item_uid, product_uid, uom = self._dec_cart_item(cart_item_id)
        body = {'items': [{
            'product_uid': product_uid,
            'quantity': qty,
            'uom': uom,
            'selected_catchweight': '',
            'item_uid': item_uid,
        }]}
        result = await self._fetch('PUT', f'{_BASKET}?{self._basket_qs()}', body)
        if result['status'] != 200:
            raise RuntimeError(f'Set qty HTTP {result["status"]}')
        return self._parse_cart(result['body'])

    async def clear(self) -> Cart:
        if not self._access_token:
            await self._init_context()
        result = await self._fetch('DELETE', _BASKET)
        if result['status'] not in (200, 204):
            raise RuntimeError(f'Clear HTTP {result["status"]}')
        return await self.get_cart()

    async def get_orders(self, size: int = 15) -> list[Order]:
        if not self._access_token:
            await self._init_context()
        qs = urlencode({'page_size': size, 'page_number': 1})
        result = await self._fetch('GET', f'{_ORDER}?{qs}')
        if result['status'] != 200:
            raise RuntimeError(f'Orders HTTP {result["status"]}')
        orders = []
        for o in result['body'].get('orders', []):
            total = o.get('total')
            orders.append(Order(
                order_id=o['order_uid'],
                status=o.get('status', ''),
                placed_date=None,
                delivery_date=o.get('slot_start_time'),
                total=f'£{total:.2f}' if total is not None else None,
                item_count=None,
            ))
        return orders

    async def get_order(self, order_id: str) -> OrderDetail:
        if not self._access_token:
            await self._init_context()
        qs = urlencode({'placed': 'true', 'deliveryPass': 'false'})
        result = await self._fetch('GET', f'{_ORDER}/{order_id}?{qs}')
        if result['status'] != 200:
            raise RuntimeError(f'Order detail HTTP {result["status"]}')
        order = result['body']
        items = []
        for i in order.get('order_items', []):
            product = i.get('product', {})
            sub = i.get('sub_total')
            items.append(OrderItem(
                line_number=product.get('product_uid', ''),
                name=product.get('name'),
                size=None,
                qty=i.get('quantity'),
                unit_price=None,
                total_price=f'£{sub:.2f}' if sub is not None else None,
            ))
        total = order.get('total')
        return OrderDetail(
            order_id=order.get('order_uid', order_id),
            status=order.get('status', ''),
            placed_date=None,
            delivery_date=order.get('slot_start_time'),
            total=f'£{total:.2f}' if total is not None else None,
            items=items,
        )
