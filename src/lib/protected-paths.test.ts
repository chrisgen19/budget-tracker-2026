import { describe, expect, it } from "vitest";
import { PROTECTED_PAGE_PATHS, isProtectedPagePath } from "@/lib/protected-paths";

describe("PROTECTED_PAGE_PATHS", () => {
  it("is exactly this list", () => {
    // Pinned as a literal, the same way `scripts/build-scripts.test.ts` pins the build scripts.
    // The list is a denylist, so forgetting a route fails *open* -- the page is cached to disk and
    // served back stale. Nothing else in the repo would notice, because `sw.ts` cannot be
    // imported under jsdom. Adding a route here should be a deliberate act that updates a test.
    expect([...PROTECTED_PAGE_PATHS]).toEqual([
      "/dashboard",
      "/quick-log",
      "/transactions",
      "/bills",
      "/categories",
      "/profile",
      "/admin",
      "/tg",
    ]);
  });

  it("covers the web app's quick-log grid", () => {
    // The same buttons, amounts and pinned labels `/tg` renders, on the surface that has a
    // NextAuth session -- which is exactly the reason it is easy to assume it is already handled.
    expect(isProtectedPagePath("/quick-log")).toBe(true);
  });

  it("covers the Telegram Mini App and everything under it", () => {
    // `/tg` renders tile labels, amounts and recent spending, and unlike every other entry here
    // it has no NextAuth session to make its sensitivity obvious.
    expect(isProtectedPagePath("/tg")).toBe(true);
    expect(isProtectedPagePath("/tg/edit")).toBe(true);
  });

  it("leaves genuinely public pages cacheable", () => {
    expect(isProtectedPagePath("/")).toBe(false);
    expect(isProtectedPagePath("/login")).toBe(false);
    expect(isProtectedPagePath("/~offline")).toBe(false);
  });
});
