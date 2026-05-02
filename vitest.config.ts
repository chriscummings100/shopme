import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@chriscummings100/shopme-shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@chriscummings100/shopme-grocery-core": fileURLToPath(new URL("./packages/grocery-core/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts"
    ]
  }
});
