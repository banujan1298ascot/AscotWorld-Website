import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /**
     * The integration suites share one database, and batch numbering is a
     * global sequence — run two of them at once and their confirmations
     * interleave, so a gap-free numbering assertion fails for reasons that
     * have nothing to do with the code under test. The whole suite takes a
     * few seconds, so serialising files is cheaper than the flakiness.
     */
    fileParallelism: false,
  },
});
