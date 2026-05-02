import { expect, test } from "vitest";
import {
  WaitroseVendor,
  decodeSainsburysCartItemId,
  decodeWaitroseCartItemId,
  decodeWaitroseProductId,
  encodeSainsburysCartItemId,
  encodeWaitroseCartItemId,
  encodeWaitroseProductId
} from "@chriscummings100/shopme-grocery-core";

test("Waitrose product id round trips", () => {
  const encoded = encodeWaitroseProductId("123456", "prod-789abc");
  expect(decodeWaitroseProductId(encoded)).toEqual(["123456", "prod-789abc"]);
  expect(WaitroseVendor._dec_product(WaitroseVendor._enc_product("123456", "prod-789abc"))).toEqual([
    "123456",
    "prod-789abc"
  ]);
});

test("Waitrose cart item id round trips", () => {
  const encoded = encodeWaitroseCartItemId(987654, "C62");
  expect(decodeWaitroseCartItemId(encoded)).toEqual([987654, "C62"]);
});

test("Waitrose weighted cart item id round trips", () => {
  const encoded = encodeWaitroseCartItemId(111, "KGM");
  expect(decodeWaitroseCartItemId(encoded)).toEqual([111, "KGM"]);
});

test("Sainsburys cart item id round trips", () => {
  const encoded = encodeSainsburysCartItemId("item-1", "sku-2", "ea");
  expect(decodeSainsburysCartItemId(encoded)).toEqual(["item-1", "sku-2", "ea"]);
});
