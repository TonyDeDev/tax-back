import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/tax-engine/**"], exclude: ["**/*.test.ts", "**/test-helpers.ts", "**/types.ts"] },
  },
});
