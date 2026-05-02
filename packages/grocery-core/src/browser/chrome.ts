import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium, type Browser } from "playwright-core";
import { ShopMeError } from "../errors.js";
import { isVendorName, type VendorName } from "../models.js";
import { CDP_URL, VENDOR_URLS } from "../vendors/catalog.js";

export const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium"
];

export function findChrome(paths = CHROME_PATHS): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

export function startBrowser(vendorName: VendorName): Record<string, unknown> {
  if (!isVendorName(vendorName)) {
    throw new ShopMeError("Unknown vendor", { choices: Object.keys(VENDOR_URLS) });
  }

  const chrome = findChrome();
  if (!chrome) {
    throw new ShopMeError("Chrome executable not found", { searched: CHROME_PATHS });
  }

  const profileDir = join(homedir(), ".shopme-chrome");
  const url = VENDOR_URLS[vendorName];
  const child = spawn(chrome, [
    "--remote-debugging-port=9222",
    `--user-data-dir=${profileDir}`,
    url
  ], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return {
    ok: true,
    cdp: CDP_URL,
    url
  };
}

export async function connectToChrome(cdpUrl = CDP_URL): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ShopMeError(`Cannot connect to Chrome: ${message}`, {
      hint: "Run: npx -y @chriscummings100/shopme --vendor waitrose start"
    });
  }
}
