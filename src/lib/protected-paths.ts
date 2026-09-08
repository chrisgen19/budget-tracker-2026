/**
 * Page prefixes whose HTML and RSC payloads carry user data.
 *
 * The service worker refuses to cache anything under these (`src/app/sw.ts`). Everything else
 * falls through to Serwist's `defaultCache`, whose Next.js strategies are `NetworkFirst` --
 * network when it can, **disk** when it cannot. For a page rendering somebody's spending that is
 * not a nicety: a stale copy is written to the device and served back later.
 *
 * Extracted out of `sw.ts` so it can be asserted. Inside the worker it was unreachable from a
 * test -- `sw.ts` declares `self` as a `ServiceWorkerGlobalScope` and imports `@serwist/next/worker`,
 * neither of which exists under jsdom -- so a new route that forgot to add itself here failed
 * silently and invisibly. That is exactly what happened to `/tg`, and the list is a denylist, which
 * is the shape that fails open.
 *
 * The list stays a denylist rather than becoming an allowlist of public paths only because
 * inverting it is a behaviour change to every existing route and belongs in its own PR. Until
 * then, `protected-paths.test.ts` is what makes an omission loud.
 */
export const PROTECTED_PAGE_PATHS = [
  "/dashboard",
  "/transactions",
  "/bills",
  "/categories",
  "/profile",
  "/admin",
  // The Telegram Mini App. It has no NextAuth session -- it authenticates with `initData` -- so
  // nothing above notices that it is every bit as user-specific as `/transactions`.
  "/tg",
] as const;

/** Whether a same-origin pathname is one the service worker must never cache. */
export const isProtectedPagePath = (pathname: string): boolean =>
  PROTECTED_PAGE_PATHS.some((prefix) => pathname.startsWith(prefix));
