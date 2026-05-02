import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shopme/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@shopme/grocery-core": fileURLToPath(new URL("./packages/grocery-core/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts"
    ]
  }
});
