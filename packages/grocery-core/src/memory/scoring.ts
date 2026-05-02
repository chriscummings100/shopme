export const MEMORY_ENV = "SHOPME_MEMORY_DIR";
export const EVENTS_FILE = "associations.jsonl";
export const SUMMARY_FILE = "summary.json";

export const POSITIVE_WEIGHTS = {
  auto_added: 0.5,
  accepted_suggestion: 1.5,
  user_selected: 2.0,
  correction: 2.5,
  manual: 1.0
} as const;

export type MemorySource = keyof typeof POSITIVE_WEIGHTS;

export const REJECTION_WEIGHT = -3.0;

export function phraseKey(phrase: string): string {
  const key = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return key.replace(/\s+/g, " ").trim();
}

export function productKey(productId?: string | null, productName?: string | null): string {
  if (productId) {
    return `id:${productId}`;
  }

  if (productName) {
    return `name:${phraseKey(productName)}`;
  }

  throw new Error("product_id or product_name is required");
}
