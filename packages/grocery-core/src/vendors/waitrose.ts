import type { Page } from "playwright-core";
import type { Cart, CartItem, Order, OrderDetail, OrderItem, Product } from "../models.js";
import type { ShoppingVendor } from "./base.js";

type AnyRecord = Record<string, any>;

const BASE = "https://www.waitrose.com";
const GRAPHQL = `${BASE}/api/graphql-prod/graph/live`;
const POUND = "\u00a3";

interface FetchResult extends Record<string, unknown> {
  status: number;
  body: any;
}

export function encodeWaitroseProductId(lineNumber: string, productId: string): string {
  return `${lineNumber}:${productId}`;
}

export function decodeWaitroseProductId(productId: string): [string, string] {
  const splitAt = productId.indexOf(":");
  if (splitAt === -1) {
    return [productId, ""];
  }

  return [productId.slice(0, splitAt), productId.slice(splitAt + 1)];
}

export function encodeWaitroseCartItemId(trolleyItemId: number, uom: string): string {
  return `${trolleyItemId}:${uom}`;
}

export function decodeWaitroseCartItemId(cartItemId: string): [number, string] {
  const splitAt = cartItemId.indexOf(":");
  if (splitAt === -1) {
    return [Number.parseInt(cartItemId, 10), ""];
  }

  return [
    Number.parseInt(cartItemId.slice(0, splitAt), 10),
    cartItemId.slice(splitAt + 1)
  ];
}

export class WaitroseVendor implements ShoppingVendor {
  private customerId = "";
  private orderId = "";
  private token = "";

  constructor(private readonly page: Page) {}

  static _enc_product(lineNumber: string, productId: string): string {
    return encodeWaitroseProductId(lineNumber, productId);
  }

  static _dec_product(productId: string): [string, string] {
    return decodeWaitroseProductId(productId);
  }

  static _enc_cart_item(trolleyItemId: number, uom: string): string {
    return encodeWaitroseCartItemId(trolleyItemId, uom);
  }

  static _dec_cart_item(cartItemId: string): [number, string] {
    return decodeWaitroseCartItemId(cartItemId);
  }

  async initContext(): Promise<void> {
    const ctx = await this.page.evaluate(() => {
      const shopWindow = window as typeof window & {
        __shopmeHooked?: boolean;
        __shopmeToken__?: string;
      };

      if (!shopWindow.__shopmeHooked) {
        shopWindow.__shopmeHooked = true;
        const orig = window.fetch;
        window.fetch = function(input, init) {
          init = init || {};
          const h = (init.headers || {}) as any;
          const auth = (typeof h.get === 'function')
            ? h.get('authorization')
            : (h.authorization || h.Authorization || '');
          if (auth && auth.startsWith('Bearer ')) shopWindow.__shopmeToken__ = auth;
          return orig.call(this, input, init);
        };
      }

      const clean = (value: unknown): string => {
        const text = typeof value === 'string' ? value : '';
        return text === 'undefined' || text === 'null' ? '' : text;
      };

      const ctx = {
        customerId: clean(localStorage.getItem('wtr_customer_id')),
        orderId: clean(localStorage.getItem('wtr_order_id')),
        token: clean(shopWindow.__shopmeToken__)
      };

      for (const script of Array.from(document.querySelectorAll('script'))) {
        const text = script.textContent || '';
        if (!ctx.token) {
          const m = text.match(/"accessToken":"(Bearer [^"]+)"/);
          if (m) ctx.token = clean(m[1]);
        }
        if (!ctx.orderId) {
          const m = text.match(/"customerOrderId":"([^"]+)"/);
          if (m) ctx.orderId = clean(m[1]);
        }
        if (!ctx.customerId) {
          const m = text.match(/"customerId":"([^"]+)"/);
          if (m) ctx.customerId = clean(m[1]);
        }
        if (ctx.token && ctx.orderId && ctx.customerId) break;
      }

      return ctx;
    }) as AnyRecord;

    this.customerId = String(ctx.customerId ?? "");
    this.orderId = String(ctx.orderId ?? "");
    this.token = String(ctx.token ?? "");

    if (!this.orderId && this.token) {
      const result = await this.fetchJson(
        "GET",
        `${BASE}/api/order-orchestration-prod/v1/orders?size=1&sortBy=%2B&statuses=AMENDING`,
        null
      );
      if (result.status === 200) {
        const content = Array.isArray(result.body?.content) ? result.body.content : [];
        if (content.length > 0) {
          this.orderId = String(content[0]?.customerOrderId ?? "");
        }
      }
    }
  }

  async rawFetch(method: string, url: string, body: unknown = null): Promise<Record<string, unknown>> {
    return this.fetchJson(method, url, body);
  }

  async search(term: string, size = 10): Promise<Product[]> {
    if (!this.customerId) {
      await this.initContext();
    }

    const url = `${BASE}/api/content-prod/v2/cms/publish/productcontent/search/${this.customerId}?clientType=WEB_APP`;
    const params: AnyRecord = {
      searchTerm: term,
      size,
      sortBy: "MOST_POPULAR",
      searchTags: [],
      filterTags: [],
      categoryLevel: 1
    };
    if (this.orderId) {
      params.orderId = this.orderId;
    }

    const result = await this.fetchJson("POST", url, {
      customerSearchRequest: { queryParams: params }
    });
    if (result.status !== 200) {
      throw new Error(`Search HTTP ${result.status}`);
    }

    const products: Product[] = [];
    for (const component of arrayOfRecords(result.body?.componentsAndProducts)) {
      const product = component.searchProduct;
      if (!product) {
        continue;
      }
      const promo = product.promotion;
      products.push({
        id: encodeWaitroseProductId(String(product.lineNumber), String(product.id)),
        name: String(product.name ?? ""),
        size: stringOrNull(product.size),
        price: String(product.displayPrice ?? ""),
        price_per_unit: stringOrNull(product.displayPriceQualifier),
        promotion: promo ? stringOrNull(promo.promotionDescription) : null
      });
    }

    return products;
  }

  async getCart(): Promise<Cart> {
    if (!this.orderId) {
      await this.initContext();
    }

    const data = await this.gql(`
      query($orderId: ID!) {
        getTrolley(orderId: $orderId) {
          trolley {
            trolleyItems {
              trolleyItemId lineNumber productId
              quantity { amount uom }
              totalPrice { amount currencyCode }
            }
            trolleyTotals {
              itemTotalEstimatedCost { amount currencyCode }
              savingsFromOffers { amount currencyCode }
            }
          }
        }
      }`, { orderId: this.orderId });

    const trolley = data?.getTrolley?.trolley ?? {};
    const rawItems = arrayOfRecords(trolley.trolleyItems);
    const nameMap = rawItems.length > 0
      ? await this.lookupNames(rawItems.map((item) => String(item.lineNumber)))
      : {};

    const items: CartItem[] = rawItems.map((item) => {
      const info = nameMap[String(item.lineNumber)] ?? {};
      return {
        cart_item_id: encodeWaitroseCartItemId(Number(item.trolleyItemId), String(item.quantity?.uom ?? "")),
        product_id: encodeWaitroseProductId(String(item.lineNumber), String(item.productId)),
        name: String(info.name ?? ""),
        qty: Number(item.quantity?.amount ?? 0),
        price: money(item.totalPrice?.amount)
      };
    });

    const totals = trolley.trolleyTotals ?? {};
    const totalAmount = Number(totals.itemTotalEstimatedCost?.amount ?? 0);
    const savingsAmount = Number(totals.savingsFromOffers?.amount ?? 0);

    return {
      items,
      total: money(totalAmount),
      savings: savingsAmount > 0 ? money(savingsAmount) : null
    };
  }

  async add(productId: string, qty = 1): Promise<Cart> {
    if (!this.orderId) {
      await this.initContext();
    }

    const [lineNumber, prodId] = decodeWaitroseProductId(productId);
    const data = await this.gql(`
      mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
        addItemToTrolley(orderId: $orderId, trolleyItem: $trolleyItem) {
          trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
          failures { message type }
        }
      }`, {
      orderId: this.orderId,
      trolleyItem: {
        lineNumber,
        productId: prodId,
        quantity: { amount: qty, uom: "C62" },
        trolleyItemId: -Number.parseInt(lineNumber, 10)
      }
    });

    const failures = arrayOfRecords(data?.addItemToTrolley?.failures);
    if (failures.length > 0) {
      throw new Error(failures.map((failure) => failure.message).join(", "));
    }

    return this.getCart();
  }

  async setQty(cartItemId: string, qty: number): Promise<Cart> {
    if (!this.orderId) {
      await this.initContext();
    }

    const [trolleyItemId, uom] = decodeWaitroseCartItemId(cartItemId);
    const cart = await this.getCart();
    const item = cart.items.find((candidate) => candidate.cart_item_id === cartItemId);
    if (!item) {
      throw new Error(`Cart item ${JSON.stringify(cartItemId)} not found`);
    }

    const [lineNumber, prodId] = decodeWaitroseProductId(item.product_id);
    const data = await this.gql(`
      mutation($orderId: ID!, $trolleyItem: TrolleyItemInput) {
        updateTrolleyItem(orderId: $orderId, trolleyItem: $trolleyItem) {
          trolley { trolleyTotals { itemTotalEstimatedCost { amount currencyCode } } }
          failures { message type }
        }
      }`, {
      orderId: this.orderId,
      trolleyItem: {
        trolleyItemId,
        lineNumber,
        productId: prodId,
        quantity: { amount: qty, uom },
        canSubstitute: true,
        personalisedMessage: null
      }
    });

    const failures = arrayOfRecords(data?.updateTrolleyItem?.failures);
    if (failures.length > 0) {
      throw new Error(failures.map((failure) => failure.message).join(", "));
    }

    return this.getCart();
  }

  async clear(): Promise<Cart> {
    if (!this.orderId) {
      await this.initContext();
    }

    await this.gql(
      "mutation($orderId: ID!) { emptyTrolley(orderId: $orderId) { trolley { orderId } } }",
      { orderId: this.orderId }
    );
    const ctx = await this.page.evaluate(() => localStorage.getItem("wtr_order_id")) as string | null;
    if (ctx) {
      this.orderId = ctx;
    }

    return this.getCart();
  }

  async getOrders(size = 15): Promise<Order[]> {
    const result = await this.fetchJson("GET", `${BASE}/api/order-orchestration-prod/v1/orders?size=${size}&sortBy=%2B`);
    if (result.status !== 200) {
      throw new Error(`Orders HTTP ${result.status}`);
    }

    return arrayOfRecords(result.body?.content).map((order): Order => {
      const total = order.totals?.estimated?.totalPrice?.amount;
      const slots = arrayOfRecords(order.slots);
      return {
        order_id: String(order.customerOrderId),
        status: String(order.status ?? ""),
        placed_date: stringOrNull(order.created),
        delivery_date: slots.length > 0 ? stringOrNull(slots[0].startDateTime) : null,
        total: total !== undefined && total !== null ? money(Number(total)) : null,
        item_count: numberOrNull(order.numberOfItems)
      };
    });
  }

  async getOrder(orderId: string): Promise<OrderDetail> {
    const result = await this.fetchJson("GET", `${BASE}/api/order-orchestration-prod/v1/orders/${orderId}`);
    if (result.status !== 200) {
      throw new Error(`Order detail HTTP ${result.status}`);
    }

    const order = result.body ?? {};
    const rawItems = arrayOfRecords(order.orderLines);
    const nameMap = rawItems.length > 0
      ? await this.lookupNames(rawItems.map((line) => idOrNull(line.lineNumber)).filter(isString))
      : {};

    const items: OrderItem[] = rawItems.map((line) => {
      const lineNumber = idOrNull(line.lineNumber);
      const rawProductId = idOrNull(line.productId);
      const info = lineNumber ? nameMap[lineNumber] ?? {} : {};
      const unit = line.estimatedUnitPrice?.amount;
      const total = line.estimatedTotalPrice?.amount;
      return {
        product_id: lineNumber && rawProductId ? encodeWaitroseProductId(lineNumber, rawProductId) : lineNumber,
        name: stringOrNull(info.name),
        size: stringOrNull(info.size),
        qty: numberOrNull(line.quantity?.amount),
        unit_price: unit !== undefined && unit !== null ? money(Number(unit)) : null,
        total_price: total !== undefined && total !== null ? money(Number(total)) : null
      };
    });

    const grandTotal = order.totals?.estimated?.totalPrice?.amount;
    const slots = arrayOfRecords(order.slots);

    return {
      order_id: String(order.customerOrderId ?? orderId),
      status: String(order.status ?? ""),
      placed_date: stringOrNull(order.created),
      delivery_date: slots.length > 0 ? stringOrNull(slots[0].startDateTime) : null,
      total: grandTotal !== undefined && grandTotal !== null ? money(Number(grandTotal)) : null,
      items
    };
  }

  private async fetchJson(method: string, url: string, body: unknown = null): Promise<FetchResult> {
    const fresh = await this.page.evaluate(() => {
      const shopWindow = window as typeof window & { __shopmeToken__?: string };
      return shopWindow.__shopmeToken__ || "";
    }) as string;
    if (fresh) {
      this.token = fresh;
    }

    const request: [string, string, unknown, string] = [method, url, body ?? null, this.token];
    let result = await this.page.evaluate(fetchInPage, request) as FetchResult;
    if (result.status === 401) {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.initContext();
      const retryRequest: [string, string, unknown, string] = [method, url, body ?? null, this.token];
      result = await this.page.evaluate(fetchInPage, retryRequest) as FetchResult;
    }

    return result;
  }

  private async gql(query: string, variables: Record<string, unknown>): Promise<any> {
    const result = await this.fetchJson("POST", GRAPHQL, { query, variables });
    if (result.status !== 200) {
      throw new Error(`GraphQL HTTP ${result.status}`);
    }

    if (Array.isArray(result.body?.errors) && result.body.errors.length > 0) {
      throw new Error(result.body.errors.map((error: AnyRecord) => error.message).join(", "));
    }

    return result.body?.data;
  }

  private async lookupNames(lineNumbers: string[]): Promise<Record<string, { name?: string; size?: string }>> {
    const encoded = lineNumbers.join("%2B");
    const result = await this.fetchJson("GET", `${BASE}/api/products-prod/v1/products/${encoded}?view=SUMMARY`);
    if (result.status !== 200) {
      return {};
    }

    return Object.fromEntries(
      arrayOfRecords(result.body?.products).map((product) => [
        String(product.lineNumber),
        {
          name: stringOrNull(product.name) ?? undefined,
          size: stringOrNull(product.size) ?? undefined
        }
      ])
    );
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

function isString(value: string | null): value is string {
  return value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function money(value: unknown): string {
  return `${POUND}${Number(value ?? 0).toFixed(2)}`;
}

async function fetchInPage([method, url, body, token]: [string, string, unknown, string]): Promise<FetchResult> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" }
  };
  if (token) {
    (opts.headers as Record<string, string>).Authorization = token;
  }
  if (body !== null) {
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
