import type { NextConfig } from "next";
import path from "path";
import { spawnSync } from "node:child_process";
import withSerwistInit from "@serwist/next";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ??
  crypto.randomUUID();

const withSerwist = withSerwistInit({
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname),
  /**
   * `instrumentation.ts` is compiled for the edge runtime as well as node, because middleware
   * exists. The Telegram bot it starts uses `node:https` and `node:dns`, which the edge bundle
   * cannot resolve, and the `NEXT_RUNTIME` guard around the import stops it *running* there
   * without stopping webpack tracing it.
   *
   * Stubbing the module out for edge only lets the trace succeed while the node build keeps the
   * real thing, which is what puts it into `.next/standalone` and removes the need for `tsx` or
   * `scripts/` in the deployed container.
   */
  webpack: (config, { nextRuntime, webpack }) => {
    if (nextRuntime !== "nodejs") {
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /lib[\\/]telegram[\\/]bot/ })
      );
    }
    return config;
  },
  /**
   * Framing rules, and the whole reason they exist now is `/tg`.
   *
   * Telegram Desktop and Telegram Web render a Mini App in a real iframe. That works today only
   * because nothing in this repo sets a framing header at all -- the requirement is met by
   * accident. The day someone adds a blanket `X-Frame-Options: DENY`, which is the first thing any
   * security-headers pass recommends, the Mini App breaks on Desktop and Web while continuing to
   * work on mobile. That is close to the worst failure shape available: it looks like a Telegram
   * bug rather than ours.
   *
   * So the requirement is written down as code. Everything is `DENY` except `/tg`, which names
   * Telegram's origins. `frame-ancestors` rather than `X-Frame-Options` for the Mini App, because
   * `X-Frame-Options` has no allowlist form -- and where both are sent, browsers prefer CSP.
   *
   * A future global CSP must keep this ordering and must not fold `/tg` into it.
   */
  async headers() {
    return [
      {
        source: "/tg/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
          },
        ],
      },
      {
        // `:path*` matches the bare `/tg` as well, so it has to be excluded here too or the two
        // rules both apply and the DENY wins.
        source: "/((?!tg$|tg/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
