export const VENDOR_NAMES = ["waitrose", "sainsburys"] as const;

export type VendorName = (typeof VENDOR_NAMES)[number];
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface Product {
  id: string;
  name: string;
  size: string | null;
  price: string;
  price_per_unit: string | null;
  promotion: string | null;
}

export interface CartItem {
  cart_item_id: string;
  product_id: string;
  name: string;
  qty: number;
  price: string;
}

export interface Cart {
  items: CartItem[];
  total: string;
  savings: string | null;
}

export interface Order {
  order_id: string;
  status: string;
  placed_date: string | null;
  delivery_date: string | null;
  total: string | null;
  item_count: number | null;
}

export interface OrderItem {
  line_number: string;
  name: string | null;
  size: string | null;
  qty: number | null;
  unit_price: string | null;
  total_price: string | null;
}

export interface OrderDetail {
  order_id: string;
  status: string;
  placed_date: string | null;
  delivery_date: string | null;
  total: string | null;
  items: OrderItem[];
}

export function isVendorName(value: string | undefined | null): value is VendorName {
  return value === "waitrose" || value === "sainsburys";
}
