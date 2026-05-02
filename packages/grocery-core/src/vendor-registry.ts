import type { Browser, Page } from "playwright-core";
import { connectToChrome } from "./browser/chrome.js";
import { ShopMeError } from "./errors.js";
import { isVendorName, VENDOR_NAMES, type VendorName } from "./models.js";
import type { ShoppingVendor } from "./vendors/base.js";
import { CDP_URL, VENDOR_URLS, vendorHost } from "./vendors/catalog.js";
import { SainsburysVendor } from "./vendors/sainsburys.js";
import { WaitroseVendor } from "./vendors/waitrose.js";

export interface ResolvedVendor {
  browser: Browser;
  vendorName: VendorName;
  vendor: ShoppingVendor;
}

export async function resolveVendor(vendorName?: VendorName | null): Promise<ResolvedVendor> {
  if (vendorName && !isVendorName(vendorName)) {
    throw new ShopMeError("Unknown vendor", { choices: [...VENDOR_NAMES] });
  }

  const browser = await connectToChrome(CDP_URL);
  try {
    let resolvedName = vendorName ?? null;
    let page: Page | null = null;

    if (vendorName) {
      const host = vendorHost(vendorName);
      page = findVendorPage(browser, host);
      if (!page) {
        const context = browser.contexts()[0] ?? await browser.newContext();
        page = await context.newPage();
        await page.goto(VENDOR_URLS[vendorName]);
      }
    } else {
      const matches: Array<{ name: VendorName; page: Page }> = [];
      for (const context of browser.contexts()) {
        for (const candidate of context.pages()) {
          for (const name of VENDOR_NAMES) {
            if (candidate.url().includes(vendorHost(name))) {
              matches.push({ name, page: candidate });
            }
          }
        }
      }

      if (matches.length === 0) {
        throw new ShopMeError("No vendor site found in open tabs", {
          hint: `Open one of ${JSON.stringify([...VENDOR_NAMES])} or run: npm exec --workspace @chriscummings100/shopme -- shopme --vendor waitrose start`
        });
      }

      if (matches.length > 1) {
        throw new ShopMeError(`Multiple vendor tabs open: ${JSON.stringify(matches.map((match) => match.name))}`, {
          hint: "Use --vendor to specify which one"
        });
      }

      resolvedName = matches[0].name;
      page = matches[0].page;
    }

    if (!resolvedName || !page) {
      throw new ShopMeError("Vendor connection closed unexpectedly");
    }

    const vendor = resolvedName === "sainsburys"
      ? new SainsburysVendor(page)
      : new WaitroseVendor(page);

    await vendor.initContext();

    return {
      browser,
      vendorName: resolvedName,
      vendor
    };
  } catch (error) {
    await browser.close({ reason: "shopme vendor resolution failed" }).catch(() => undefined);
    throw error;
  }
}

function findVendorPage(browser: Browser, host: string): Page | null {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes(host)) {
        return page;
      }
    }
  }

  return null;
}
