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
  // `false`, so a new worker waits instead of taking over the moment it installs. That wait is
  // what makes an update *promptable*: with `skipWaiting: true` there is no waiting worker for a
  // page to find, the swap happens silently, and the open tab keeps running the old bundle against
  // the new API anyway -- the skew #306 is about. The page now offers a reload and applies the
  // update by posting `SKIP_WAITING` below. `clientsClaim` stays: once the user accepts and the new
  // worker activates, it should take the open pages with it.
  skipWaiting: false,
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

// The other half of `skipWaiting: false`: the waiting worker activates only when a page asks it
// to, which `useServiceWorkerUpdate` does after the user accepts the prompt.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

serwist.addEventListeners();
