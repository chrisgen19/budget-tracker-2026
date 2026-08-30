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
    //
    // scripts/ is included for its *pure* helpers only -- the .env parser, the connection-string
    // host check and the Prisma error classifier, which have subtle rules and no other way to be
    // checked. The operational scripts there are named verify-*.ts and need a real database, so
    // this glob never picks them up. Those tests each declare `@vitest-environment node`: they run
    // under tsx in Node, and jsdom would be both the wrong global scope and ~1s of setup apiece.
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
});
