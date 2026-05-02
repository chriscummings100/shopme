export class ShopMeError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ShopMeError";
    this.details = details;
  }

  asError(): Record<string, unknown> {
    return {
      error: this.message,
      ...this.details
    };
  }
}

export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ShopMeError) {
    return error.asError();
  }

  if (error instanceof Error) {
    return { error: error.message };
  }

  return { error: String(error) };
}
