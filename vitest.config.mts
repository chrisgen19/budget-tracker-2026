import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Colocated with the code they cover. mcp-server has its own package and is excluded
    // from the root tsconfig, so it stays out of here too.
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true,
  },
});
