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
};

export default withSerwist(nextConfig);
