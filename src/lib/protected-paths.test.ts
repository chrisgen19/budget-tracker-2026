import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_PAGE_PATHS, isProtectedPagePath } from "@/lib/protected-paths";

/** Every route under `src/app/(app)`, which is the authenticated segment, as URL paths. */
const authenticatedRoutes = (): string[] => {
  const root = join(process.cwd(), "src", "app", "(app)");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const segments = full
          .slice(root.length + 1)
          .split(sep)
          .slice(0, -1)
          // Route groups are directories only -- `(app)/(marketing)/x` serves at `/x`.
          .filter((segment) => !segment.startsWith("("));
        found.push("/" + segments.join("/"));
      }
    }
  };
  walk(root);
  return found.sort();
};

describe("PROTECTED_PAGE_PATHS", () => {
  it("is exactly this list", () => {
    // Pinned as a literal, the same way `scripts/build-scripts.test.ts` pins the build scripts.
    // The list is a denylist, so forgetting a route fails *open* -- the page is cached to disk and
    // served back stale. Nothing else in the repo would notice, because `sw.ts` cannot be
    // imported under jsdom. Adding a route here should be a deliberate act that updates a test.
    expect([...PROTECTED_PAGE_PATHS]).toEqual([
      "/dashboard",
      "/analytics",
      "/quick-log",
      "/transactions",
      "/bills",
      "/categories",
      "/labels",
      "/profile",
      "/preferences",
      "/admin",
      "/tg",
    ]);
  });

  it("covers every page under (app), including ones added later", () => {
    // The assertion above pins the list against *edits*. It cannot see an omission: it compares the
    // list to a copy of itself, so a page that exists and was never added passes silently. That is
    // how `/analytics`, `/labels` and `/preferences` sat outside the denylist -- each arrived with
    // its own feature, and nothing ever asked whether it was covered.
    //
    // This reads the routes off disk instead, so the next page added under `(app)` fails on the
    // commit that adds it rather than whenever someone next audits the service worker.
    const routes = authenticatedRoutes();

    // Guards against the walk silently matching nothing -- a rename of the segment directory would
    // otherwise leave this passing over an empty list, which is the failure mode it exists to object
    // to.
    expect(routes.length).toBeGreaterThan(5);
    expect(routes).toContain("/dashboard");

    const uncovered = routes.filter((route) => !isProtectedPagePath(route));
    expect(uncovered).toEqual([]);
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
