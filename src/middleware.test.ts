/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { config } from "@/middleware";

describe("middleware matcher", () => {
  it("is exactly this list", () => {
    // Pinned as a literal so a change here is a deliberate act, not a side effect.
    //
    // Two things depend on it, and they pull in opposite directions. The six entries below are
    // NextAuth-gated pages, and each is *also* guarded by the `getServerSession` redirect in
    // `(app)/layout.tsx` -- the matcher is a convenience, not the boundary.
    //
    // What matters more is what is absent. `/tg` and `/api/tg` are the Telegram Mini App, which
    // authenticates with a signed `initData` header and has no NextAuth session at all. Adding
    // either to this matcher would bounce Telegram's webview to `/login`, where it can do nothing
    // -- the login form needs a cookie that a third-party iframe will not carry. Their exclusion
    // is deliberate, they gate themselves through `getTelegramUserId`, and this test is what stops
    // someone tidying the omission away later.
    expect(config.matcher).toEqual([
      "/dashboard/:path*",
      "/transactions/:path*",
      "/bills/:path*",
      "/categories/:path*",
      "/profile/:path*",
      "/admin/:path*",
    ]);
  });

  it("does not match the Telegram Mini App", () => {
    const matches = (pathname: string) =>
      config.matcher.some((pattern) =>
        // The matcher's own syntax, reduced to the one form it uses: a literal prefix followed by
        // `/:path*`, which matches the prefix and anything under it.
        new RegExp(`^${pattern.replace("/:path*", "(/.*)?$")}`).test(pathname)
      );

    expect(matches("/tg")).toBe(false);
    expect(matches("/api/tg/log")).toBe(false);
    // A control, so the helper above is proven to match something.
    expect(matches("/dashboard")).toBe(true);
  });
});
