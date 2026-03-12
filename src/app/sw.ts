/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkOnly } from "serwist";

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
    // Authenticated page routes — HTML/RSC payloads contain user data via UserProvider
    {
      matcher({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) {
        if (!sameOrigin) return false;
        const protectedPaths = ["/dashboard", "/transactions", "/bills", "/categories", "/profile", "/admin"];
        return protectedPaths.some((p) => url.pathname.startsWith(p));
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
