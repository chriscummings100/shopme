#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import {
  VENDOR_NAMES,
  buildSummary,
  errorPayload,
  explain,
  isVendorName,
  recordAssociation,
  recordRejection,
  resolveVendor,
  screenshotUrl,
  startBrowser,
  type HttpMethod,
  type VendorName
} from "@chriscummings100/shopme-grocery-core";
import { printJson } from "@chriscummings100/shopme-shared";

type GlobalOptions = {
  vendor?: string;
};

const program = new Command()
  .name("shopme")
  .description("AI shopping assistant CLI")
  .option("--vendor <vendor>", `Vendor to use (${VENDOR_NAMES.join(", ")})`);

program
  .command("start")
  .description("Launch Chrome with debug port and open vendor site")
  .action(() => {
    const vendor = requireVendor(globalVendor(), "--vendor is required for start");
    printJson(startBrowser(vendor));
  });

program
  .command("search")
  .description("Search for products")
  .argument("<term>")
  .option("--size <size>", "Number of results", parseInteger, 10)
  .action(async (term: string, options: { size: number }) => {
    await withVendor(async (_, vendor) => vendor.search(term, options.size));
  });

program
  .command("cart")
  .description("Show current basket")
  .action(async () => {
    await withVendor(async (_, vendor) => vendor.getCart());
  });

program
  .command("add")
  .description("Add a product to the basket")
  .argument("<product_id>")
  .argument("[qty]", "Quantity", parseInteger, 1)
  .action(async (productId: string, qty: number) => {
    await withVendor(async (_, vendor) => vendor.add(productId, qty));
  });

program
  .command("set")
  .description("Set quantity of a basket item; qty=0 removes it")
  .argument("<cart_item_id>")
  .argument("<qty>", "Quantity", parseInteger)
  .action(async (cartItemId: string, qty: number) => {
    await withVendor(async (_, vendor) => vendor.setQty(cartItemId, qty));
  });

program
  .command("clear")
  .description("Empty the basket")
  .action(async () => {
    await withVendor(async (_, vendor) => vendor.clear());
  });

program
  .command("orders")
  .description("List past and active orders")
  .option("--size <size>", "Number of orders", parseInteger, 15)
  .action(async (options: { size: number }) => {
    await withVendor(async (_, vendor) => vendor.getOrders(options.size));
  });

program
  .command("order")
  .description("Get full details for a past order")
  .argument("<order_id>")
  .action(async (orderId: string) => {
    await withVendor(async (_, vendor) => vendor.getOrder(orderId));
  });

program
  .command("screenshot")
  .description("Screenshot a URL using the live Chrome session")
  .argument("<url>")
  .option("--out <path>", "Output file path", "screenshot.png")
  .action(async (url: string, options: { out: string }) => {
    printJson(await screenshotUrl(url, options.out));
  });

program
  .command("api")
  .description("Raw authenticated API call for exploration")
  .argument("<method>", "HTTP method")
  .argument("<path>", "API path or absolute URL")
  .argument("[body]", "JSON body string")
  .action(async (method: string, path: string, body?: string) => {
    const normalizedMethod = method.toUpperCase() as HttpMethod;
    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(normalizedMethod)) {
      throw new InvalidArgumentError("method must be one of GET, POST, PUT, DELETE, PATCH");
    }

    const parsedBody = body ? JSON.parse(body) : null;
    await withVendor(async (resolvedName, vendor) => {
      const base = resolvedName === "sainsburys"
        ? "https://www.sainsburys.co.uk"
        : "https://www.waitrose.com";
      const url = path.startsWith("/") ? `${base}${path}` : path;
      return vendor.rawFetch(normalizedMethod, url, parsedBody);
    });
  });

const memory = program
  .command("memory")
  .description("Read and write soft shopping associations");

memory
  .command("summary")
  .description("Show compact shopping memory for the agent")
  .option("--vendor <vendor>", `Only include associations for one vendor (${VENDOR_NAMES.join(", ")})`)
  .option("--limit <limit>", "Candidates per phrase", parseInteger, 3)
  .action((options: { vendor?: string; limit: number }) => {
    const vendor = optionalVendor(options.vendor ?? globalVendor());
    printJson(buildSummary({ vendor, limit: options.limit }));
  });

memory
  .command("explain")
  .description("Show memory for one phrase")
  .argument("<phrase>")
  .option("--vendor <vendor>", `Only include associations for one vendor (${VENDOR_NAMES.join(", ")})`)
  .option("--limit <limit>", "Candidates to show", parseInteger, 5)
  .action((phrase: string, options: { vendor?: string; limit: number }) => {
    const vendor = optionalVendor(options.vendor ?? globalVendor());
    printJson(explain(phrase, { vendor, limit: options.limit }));
  });

memory
  .command("record")
  .description("Record that a phrase resolved to a product")
  .requiredOption("--phrase <phrase>", "Original user phrase")
  .requiredOption("--product-id <product_id>", "Opaque product id from search results")
  .requiredOption("--product-name <product_name>", "Product name")
  .option("--vendor <vendor>", `Vendor for this association (${VENDOR_NAMES.join(", ")})`)
  .option("--search-term <term>", "Search term that found the product")
  .option("--source <source>", "How the association was resolved", "user_selected")
  .option("--size <size>")
  .option("--price <price>")
  .action((options: {
    phrase: string;
    productId: string;
    productName: string;
    vendor?: string;
    searchTerm?: string;
    source: string;
    size?: string;
    price?: string;
  }) => {
    const vendor = requireVendor(options.vendor ?? globalVendor(), "--vendor is required for memory record");
    printJson({
      ok: true,
      event: recordAssociation({
        phrase: options.phrase,
        vendor,
        product_id: options.productId,
        product_name: options.productName,
        search_term: options.searchTerm,
        source: options.source as never,
        size: options.size,
        price: options.price
      })
    });
  });

memory
  .command("reject")
  .description("Record that a phrase did not mean a product")
  .requiredOption("--phrase <phrase>", "Original user phrase")
  .option("--vendor <vendor>", `Vendor for this correction (${VENDOR_NAMES.join(", ")})`)
  .option("--wrong-product-id <id>")
  .option("--wrong-product-name <name>")
  .option("--correct-product-id <id>")
  .option("--correct-product-name <name>")
  .action((options: {
    phrase: string;
    vendor?: string;
    wrongProductId?: string;
    wrongProductName?: string;
    correctProductId?: string;
    correctProductName?: string;
  }) => {
    const vendor = requireVendor(options.vendor ?? globalVendor(), "--vendor is required for memory reject");
    printJson({
      ok: true,
      event: recordRejection({
        phrase: options.phrase,
        vendor,
        wrong_product_id: options.wrongProductId,
        wrong_product_name: options.wrongProductName,
        correct_product_id: options.correctProductId,
        correct_product_name: options.correctProductName
      })
    });
  });

async function main(): Promise<void> {
  await program.parseAsync();
}

async function withVendor<T>(
  action: (vendorName: VendorName, vendor: Awaited<ReturnType<typeof resolveVendor>>["vendor"]) => Promise<T>
): Promise<void> {
  const resolved = await resolveVendor(optionalVendor(globalVendor()));
  try {
    printJson(await action(resolved.vendorName, resolved.vendor));
  } finally {
    await resolved.browser.close({ reason: "shopme CLI command completed" });
  }
}

function globalVendor(): string | undefined {
  return (program.opts<GlobalOptions>()).vendor;
}

function optionalVendor(value: string | undefined): VendorName | undefined {
  if (!value) {
    return undefined;
  }

  if (!isVendorName(value)) {
    throw new InvalidArgumentError(`Unknown vendor. Choices: ${VENDOR_NAMES.join(", ")}`);
  }

  return value;
}

function requireVendor(value: string | undefined, message: string): VendorName {
  const vendor = optionalVendor(value);
  if (!vendor) {
    throw new InvalidArgumentError(message);
  }

  return vendor;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError("Expected an integer");
  }

  return parsed;
}

main().catch((error) => {
  printJson(errorPayload(error), 0);
  process.exitCode = 1;
});
