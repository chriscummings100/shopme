import { resolve } from "node:path";
import { ShopMeError } from "../errors.js";
import { connectToChrome } from "./chrome.js";

export async function screenshotUrl(url: string, output = "screenshot.png"): Promise<Record<string, string>> {
  const browser = await connectToChrome();
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.screenshot({ path: output, fullPage: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ShopMeError(message);
  } finally {
    await page.close();
    await browser.close({ reason: "shopme screenshot completed" });
  }

  return { path: resolve(output) };
}
