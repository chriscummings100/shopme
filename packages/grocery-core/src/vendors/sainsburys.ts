import type { Page } from "playwright-core";
import type { Cart, CartItem, Order, OrderDetail, OrderItem, Product } from "../models.js";
import type { ShoppingVendor } from "./base.js";

type AnyRecord = Record<string, any>;

const BASE = "https://www.sainsburys.co.uk";
const BASKET = `${BASE}/groceries-api/gol-services/basket/v2/basket`;
const PRODUCT = `${BASE}/groceries-api/gol-services/product/v1/product`;
const ORDER = `${BASE}/groceries-api/gol-services/order/v1/order`;
const POUND = "\u00a3";

const ENABLED_FLAGS = [
  "add_to_favourites",
  "use_food_basket_service",
  "use_food_basket_service_v3",
  "use_food_basket_service_v4",
  "ads_conditionals",
  "findability_v5",
  "show_static_cnc_messaging",
  "fetch_future_slot_weeks",
  "click_and_collect_promo_banner",
  "cookie_law_link",
  "citrus_banners",
  "citrus_favourites_trio_banners",
  "offers_strategic_magnolia",
  "special_logo",
  "custom_product_messaging",
  "promotional_link",
  "promotion_mechanics_page",
  "findability_search",
  "findability_autosuggest",
  "fto_header_flag",
  "recurring_slot_skip_opt_out",
  "seasonal_favourites",
  "cnc_start_amend_order_modal",
  "favourites_product_cta_alt",
  "get_favourites_from_v2",
  "krang_alternatives",
  "offers_config",
  "alternatives_modal",
  "relevancy_rank",
  "changes_to_trolley",
  "nectar_destination_page",
  "unit_price_legislation",
  "meal_deal_live",
  "browse_pills_nav_type",
  "use_cached_findability_results",
  "event_zone_list",
  "cms_carousel_zone_list",
  "show_ynp_change_slot_banner",
  "recipe_scrapbooks_enabled",
  "event_carousel_skus",
  "split_savings",
  "trolley_nectar_card",
  "favourites_magnolia",
  "homepage",
  "taggstar",
  "meal_deal_cms_template_ids",
  "pdp_accordions",
  "pdp_occasions_pills",
  "pdp_meta_desc_template",
  "grouped_meal_deals",
  "pci_phase_2",
  "meal_deal_builder_nectar_widget",
  "occasions_navigation",
  "slots_event_banner_config",
  "sales_window",
  "resting_search",
  "brands_background",
  "taggstar_config",
  "all_ad_components_enabled",
  "left_align_header",
  "golui_my_addresses",
  "new_global_header",
  "new_filter_pages",
  "spoonguru_disclaimers",
  "recipe_reviews_enabled",
  "sponsored_drawer",
  "frequently_bought_together",
  "show_ynp_opt_in_ui_elements",
  "show_ynp_add_to_basket_toast",
  "show_ynp_card",
  "similar_products_drawer",
  "fetch_ynp_opt_ins",
  "resting_search_v2",
  "bop_enabled",
  "identity_transfer",
  "prop_bar",
  "favourites_boards",
  "slot_confirmation_board",
  "mobile_nav_2",
  "highlight_seasonal_nav_item",
  "show_popular_categories",
  "compact_reviews",
  "track_remove_scroll_experiment",
  "favourites_grouped_by_top_category",
  "track_boards_experiment",
  "ynpoptin_national_launch",
  "favourites_link_on_global_header",
  "hey_sainsburys",
  "heys_resting_state",
  "krang_newness",
  "show_tpr_straplines",
  "track_compact_tile_experiment",
  "use_compact_tile_boards",
  "use_compact_tile_previous_orders",
  "use_compact_tile",
  "retry_your_payments",
  "offers_revamp_2025_rollout",
  "favourites_slot_your_usuals_tracking",
  "product_bundles",
  "fable_search_bar",
  "hard_sku_replacement",
  "track_occasions_available_from",
  "continue_shopping_link",
  "fto_first_available_slot",
  "qualifying_basket_amount",
  "app_banner",
  "bigger_images",
  "call_bcs",
  "catchweight_dropdown",
  "citrus_preview_new",
  "citrus_search_trio_banners",
  "citrus_xsell",
  "compare_seasonal_favourites",
  "constant_commerce_v2",
  "ctt_ynp_products",
  "desktop_interstitial_variant",
  "disable_product_cache_validation",
  "event_dates",
  "favourites_pill_nav",
  "favourites_whole_service",
  "fbt_on_search",
  "foodmaestro_modal",
  "hfss_restricted",
  "krang_recommendations",
  "lp_ab_test_display",
  "lp_interstitial_grid_config",
  "meal_planner",
  "meganav",
  "mobile_interstitial_variant",
  "my_nectar_migration",
  "nectar_card_associated",
  "nectar_prices",
  "new_favourites_filter",
  "new_favourites_service",
  "new_filters",
  "ni_brexit_banner",
  "occasions",
  "offers_mechanics_carousel",
  "optimised_product_tile",
  "promo_lister_page",
  "recipes_ingredients_modal",
  "review_syndication",
  "rokt",
  "search_cms",
  "similar_products",
  "slot_v2",
  "sponsored_featured_tiles",
  "use_op_orchestrator_sde",
  "your_nectar_prices"
].join(",");

interface FetchResult extends Record<string, unknown> {
  status: number;
  body: any;
}

export function encodeSainsburysCartItemId(itemUid: string, productUid: string, uom: string): string {
  return `${itemUid}:${productUid}:${uom}`;
}

export function decodeSainsburysCartItemId(cartItemId: string): [string, string, string] {
  const [itemUid, productUid, uom] = cartItemId.split(":", 3);
  return [itemUid ?? "", productUid ?? "", uom ?? ""];
}

export class SainsburysVendor implements ShoppingVendor {
  private accessToken = "";
  private wcAuthToken = "";
  private storeIdentifier = "0652";
  private flexiStores = "0686";

  constructor(private readonly page: Page) {}

  static _enc_cart_item(itemUid: string, productUid: string, uom: string): string {
    return encodeSainsburysCartItemId(itemUid, productUid, uom);
  }

  static _dec_cart_item(cartItemId: string): [string, string, string] {
    return decodeSainsburysCartItemId(cartItemId);
  }

  async initContext(): Promise<void> {
    const ctx = await this.page.evaluate(() => {
      const oidcRaw = localStorage.getItem('oidc.user:https://account.sainsburys.co.uk:gol');
      const oidc = oidcRaw ? JSON.parse(oidcRaw) : {};
      const wcMatch = document.cookie.match(/WC_AUTHENTICATION_\d+=([^;]+)/);
      const slotRaw = localStorage.getItem('slot-reservation-cached');
      const slot = slotRaw ? JSON.parse(slotRaw) : {};
      return {
        accessToken: oidc.access_token || '',
        wcAuthToken: wcMatch ? wcMatch[1] : '',
        storeIdentifier: slot.storeIdentifier || '0652',
        flexiStores: (slot.flexiStores || [])[0] || '0686'
      };
    }) as AnyRecord;

    this.accessToken = String(ctx.accessToken ?? "");
    this.wcAuthToken = String(ctx.wcAuthToken ?? "");
    this.storeIdentifier = String(ctx.storeIdentifier ?? "0652");
    this.flexiStores = String(ctx.flexiStores ?? "0686");
  }

  async rawFetch(method: string, url: string, body: unknown = null): Promise<Record<string, unknown>> {
    return this.fetchJson(method, url, body);
  }

  async search(term: string, size = 10): Promise<Product[]> {
    if (!this.accessToken) {
      await this.initContext();
    }

    const qs = new URLSearchParams({
      "filter[keyword]": term,
      page_number: "1",
      page_size: String(size),
      sort_order: "FAVOURITES_FIRST",
      store_identifier: this.storeIdentifier,
      region: "England",
      flexi_stores: this.flexiStores,
      salesWindow: "1"
    });
    const result = await this.fetchJson("GET", `${PRODUCT}?${qs}`);
    if (result.status !== 200) {
      throw new Error(`Search HTTP ${result.status}`);
    }

    return arrayOfRecords(result.body?.products).map((product): Product => {
      const retail = product.retail_price ?? {};
      const unit = product.unit_price ?? {};
      const promos = arrayOfRecords(product.promotions);
      const measure = String(unit.measure ?? "");
      const sizeString = measure && measure !== "ea" ? `${unit.measure_amount ?? 1}${measure}` : null;
      const pricePer = unit.price && measure ? `${POUND}${Number(unit.price).toFixed(2)}/${measure}` : null;
      return {
        id: String(product.product_uid),
        name: String(product.name ?? ""),
        size: sizeString,
        price: money(retail.price),
        price_per_unit: pricePer,
        promotion: promos.length > 0 ? stringOrNull(promos[0].strap_line) : null
      };
    });
  }

  async getCart(): Promise<Cart> {
    if (!this.accessToken) {
      await this.initContext();
    }

    const result = await this.fetchJson("GET", `${BASKET}?${this.basketQs()}`);
    if (result.status !== 200) {
      throw new Error(`Cart HTTP ${result.status}`);
    }

    return this.parseCart(result.body ?? {});
  }

  async add(productId: string, qty = 1): Promise<Cart> {
    if (!this.accessToken) {
      await this.initContext();
    }

    const result = await this.fetchJson("POST", `${BASKET}/item?${this.basketQs()}`, {
      product_uid: productId,
      quantity: qty,
      uom: "ea",
      selected_catchweight: ""
    });
    if (![200, 201].includes(result.status)) {
      throw new Error(`Add HTTP ${result.status}`);
    }

    return this.parseCart(result.body ?? {});
  }

  async setQty(cartItemId: string, qty: number): Promise<Cart> {
    if (!this.accessToken) {
      await this.initContext();
    }

    const [itemUid, productUid, uom] = decodeSainsburysCartItemId(cartItemId);
    const result = await this.fetchJson("PUT", `${BASKET}?${this.basketQs()}`, {
      items: [{
        product_uid: productUid,
        quantity: qty,
        uom,
        selected_catchweight: "",
        item_uid: itemUid
      }]
    });
    if (result.status !== 200) {
      throw new Error(`Set qty HTTP ${result.status}`);
    }

    return this.parseCart(result.body ?? {});
  }

  async clear(): Promise<Cart> {
    if (!this.accessToken) {
      await this.initContext();
    }

    const result = await this.fetchJson("DELETE", BASKET);
    if (![200, 204].includes(result.status)) {
      throw new Error(`Clear HTTP ${result.status}`);
    }

    return this.getCart();
  }

  async getOrders(size = 15): Promise<Order[]> {
    if (!this.accessToken) {
      await this.initContext();
    }

    const qs = new URLSearchParams({ page_size: String(size), page_number: "1" });
    const result = await this.fetchJson("GET", `${ORDER}?${qs}`);
    if (result.status !== 200) {
      throw new Error(`Orders HTTP ${result.status}`);
    }

    return arrayOfRecords(result.body?.orders).map((order): Order => {
      const total = order.total;
      return {
        order_id: String(order.order_uid),
        status: String(order.status ?? ""),
        placed_date: null,
        delivery_date: stringOrNull(order.slot_start_time),
        total: total !== undefined && total !== null ? money(total) : null,
        item_count: null
      };
    });
  }

  async getOrder(orderId: string): Promise<OrderDetail> {
    if (!this.accessToken) {
      await this.initContext();
    }

    const qs = new URLSearchParams({ placed: "true", deliveryPass: "false" });
    const result = await this.fetchJson("GET", `${ORDER}/${orderId}?${qs}`);
    if (result.status !== 200) {
      throw new Error(`Order detail HTTP ${result.status}`);
    }

    const order = result.body ?? {};
    const items: OrderItem[] = arrayOfRecords(order.order_items).map((item) => {
      const product = item.product ?? {};
      const subtotal = item.sub_total;
      return {
        product_id: idOrNull(product.product_uid),
        name: stringOrNull(product.name),
        size: null,
        qty: numberOrNull(item.quantity),
        unit_price: null,
        total_price: subtotal !== undefined && subtotal !== null ? money(subtotal) : null
      };
    });

    const total = order.total;
    return {
      order_id: String(order.order_uid ?? orderId),
      status: String(order.status ?? ""),
      placed_date: null,
      delivery_date: stringOrNull(order.slot_start_time),
      total: total !== undefined && total !== null ? money(total) : null,
      items
    };
  }

  private async fetchJson(method: string, url: string, body: unknown = null): Promise<FetchResult> {
    const request: [string, string, unknown, Record<string, string>] = [method, url, body ?? null, this.headers()];
    let result = await this.page.evaluate(fetchInPage, request) as FetchResult;
    if (result.status === 401) {
      await this.page.reload({ waitUntil: "networkidle" });
      await this.initContext();
      const retryRequest: [string, string, unknown, Record<string, string>] = [method, url, body ?? null, this.headers()];
      result = await this.page.evaluate(fetchInPage, retryRequest) as FetchResult;
    }

    return result;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      wcauthtoken: this.wcAuthToken,
      "enabled-feature-flags": ENABLED_FLAGS,
      accept: "application/json"
    };
  }

  private basketQs(): string {
    return new URLSearchParams({
      pick_time: this.pickTime(),
      store_number: this.storeIdentifier,
      slot_booked: "false"
    }).toString();
  }

  private pickTime(): string {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  private parseCart(body: AnyRecord): Cart {
    const items: CartItem[] = arrayOfRecords(body.items).map((item) => {
      const product = item.product ?? {};
      return {
        cart_item_id: encodeSainsburysCartItemId(
          String(item.item_uid),
          String(product.sku ?? ""),
          String(item.uom ?? "ea")
        ),
        product_id: String(product.sku ?? ""),
        name: String(product.name ?? ""),
        qty: Number(item.quantity ?? 0),
        price: money(item.subtotal_price)
      };
    });

    const total = Number(body.total_price ?? 0);
    const savings = Number(body.savings ?? 0);
    return {
      items,
      total: money(total),
      savings: savings ? money(Math.abs(savings)) : null
    };
  }
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object") as AnyRecord[] : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function idOrNull(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function money(value: unknown): string {
  return `${POUND}${Number(value ?? 0).toFixed(2)}`;
}

async function fetchInPage(
  [method, url, body, headers]: [string, string, unknown, Record<string, string>]
): Promise<FetchResult> {
  const opts: RequestInit = {
    method,
    headers: { ...headers }
  };
  if (body !== null) {
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const response = await fetch(url, opts);
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: response.status, body: data };
}
