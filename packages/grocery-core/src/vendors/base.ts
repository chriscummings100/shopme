import type { Cart, Order, OrderDetail, Product } from "../models.js";

export interface ShoppingVendor {
  search(term: string, size?: number): Promise<Product[]>;
  getCart(): Promise<Cart>;
  add(productId: string, qty?: number): Promise<Cart>;
  setQty(cartItemId: string, qty: number): Promise<Cart>;
  clear(): Promise<Cart>;
  getOrders(size?: number): Promise<Order[]>;
  getOrder(orderId: string): Promise<OrderDetail>;
  initContext(): Promise<void>;
  rawFetch(method: string, url: string, body?: unknown): Promise<Record<string, unknown>>;
}
