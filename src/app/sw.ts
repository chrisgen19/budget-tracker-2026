/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkOnly } from "serwist";
import { isProtectedPagePath } from "@/lib/protected-paths";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // All /api/* routes — never cache authenticated responses
    {
      matcher({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) {
        return sameOrigin && url.pathname.startsWith("/api/");
      },
      handler: new NetworkOnly(),
    },
    // Authenticated page routes — HTML/RSC payloads contain user data via UserProvider, or (for
    // the Telegram Mini App) via initData-authenticated fetches. The list lives in
    // src/lib/protected-paths.ts so a test can assert it: this file cannot be imported under
    // jsdom, so an omission here was previously invisible, and the list fails open.
    {
      matcher({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) {
        return sameOrigin && isProtectedPagePath(url.pathname);
      },
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
