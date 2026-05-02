import type { VendorName } from "../models.js";

export const CDP_URL = "http://localhost:9222";

export const VENDOR_URLS: Record<VendorName, string> = {
  waitrose: "https://www.waitrose.com",
  sainsburys: "https://www.sainsburys.co.uk"
};

export function vendorHost(vendorName: VendorName): string {
  return VENDOR_URLS[vendorName].replace(/^https?:\/\//, "");
}
