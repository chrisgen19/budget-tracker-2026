# Apply app updates on the next safe navigation

Status: draft, awaiting approval (2026-11-27)

## Intent

After a deploy, users should pick up the new build without tapping "Reload". Today the waiting
service worker is only applied when someone taps the banner (`src/components/pwa/update-prompt-banner.tsx`,
`src/hooks/use-service-worker-update.ts`). Most people never do, so open tabs keep running the old bundle
against the new API, which is the client/server skew #306 exists to close.

## Goals

- When an update is ready and nothing is in progress, an in-app link tap or a profile-menu item does a
  full load of the **target** page on the new build. One load, no flash.
- The banner stays as the fallback for every case this does not cover.
- A sibling tab whose worker was swapped by another tab is marked **stale** instead of reloading on the
  spot. It shows the banner (Reload = plain refresh) and also updates on its own next safe navigation.

## Non-goals

- Back/forward, and `router.push` calls outside the profile menu (e.g. after creating a card). They keep
  the banner.
- Applying updates on visibility change, on a timer, or with no navigation at all.
- Changing the hourly poll or how a waiting worker is detected.

## Anti-goals (a failure even if it technically works)

- Losing the multi-scan queue: scanned receipts whose credits are already spent.
- Any tab reloading without the user navigating or tapping Reload in **that** tab.
- A double load (new page renders, then reloads).

## Approaches

- **A. Intercept before navigating (picked).** Capture-phase click listener in `AppShell` for in-app
  links, plus a `navigate(href)` helper for the profile menu. One clean load. Only wired-up navigations
  count, and the banner covers the rest.
- **B. React after navigating.** Watch `usePathname` and reload when it changes. Tiny and covers
  everything, but every post-deploy navigation shows a visible double load. Rejected: that glitch is the
  opposite of the "invisible update" goal.
- A + B combined: rejected as extra code for edge cases nobody asked for.

## Design

**Update state** (`use-service-worker-update.ts`): replace the boolean with
`status: "none" | "waiting" | "stale"`.
- `waiting`: a waiting worker was found (the existing three detection paths, unchanged).
- `stale`: this tab's controller changed because another tab applied the update. There is no waiting
  worker left to message, so the tab just needs a full load.
- `updateAvailable` stays as a derived `status !== "none"` so the banner's existing contract holds.

**`controllerchange` handling**, decided by what this tab asked for:
- First claim of an uncontrolled page: ignore (unchanged).
- This tab tapped Reload: `location.reload()` (unchanged).
- This tab started a navigation update: `location.assign(target)`.
- Anything else (a sibling swap): set `status = "stale"` and do **not** reload. This flips the existing
  test at `use-service-worker-update.test.ts:118`.

**Applying on navigation**: the hook exposes `applyOnNavigation(href): boolean`.
- Returns `false` (let the normal client navigation happen) when `status` is `none`, the tab is offline,
  or the caller reports busy.
- `waiting`: post `SKIP_WAITING`, remember `href`, and full-load it on `controllerchange`. If no
  `controllerchange` arrives within 3s, `location.assign(href)` anyway so a tap never goes dead.
- `stale`: `location.assign(href)` immediately.

**Busy gate**: `AppShell` computes
`busy = scan.items.length > 0 || scan.isScanning || scan.isSavingAll` from the `useMultiScan()` it
already owns (`src/components/app-shell.tsx:100`).

The gate is read **twice**: when the tap is handled, and again when the hand-off finishes, which is
up to 3s later. A scan started inside that window would otherwise be lost, because the hand-off ends
in a full load. An ordinary client navigation does *not* cost the queue the way a full load does --
`useMultiScan()` lives in `AppShell` (`src/components/app-shell.tsx:101`), inside the `(app)` layout,
so it survives any navigation that keeps the document -- which is what makes the second read worth
taking.

Busy at that point, the hook does not defer the load: deferring would strand the tab on a page it
was told to leave, with nothing on screen saying why. It falls back to `router.push` instead, so the
tap still goes where it was aimed, and marks the tab `stale`. The update is then taken on a later
navigation or from the banner, exactly as in a sibling tab that never accepted it.

**Wiring** (new `src/components/pwa/update-navigation-provider.tsx`):
- `AppShell` calls the hook once and passes `status` and `applyUpdate` down to `UpdatePromptBanner`
  as props, so the hook is not mounted twice.
- Capture-phase `click` listener on `document`. It intercepts only a plain left click
  (`button === 0`, no meta/ctrl/shift/alt, not `defaultPrevented`) on an `<a href>` that is same-origin,
  has no `download`, has `target` empty or `_self`, is not under `/api/`, and is not a hash-only change
  on the current path. When `applyOnNavigation` returns `true` it calls `preventDefault()` so
  `next/link` never starts the client navigation.
- A context exposes `navigate(href)`: `applyOnNavigation(href) || router.push(href)`.
  `src/components/profile-menu.tsx` uses it in place of `router.push` for its items. `ProfileMenu` is
  rendered inside `AppShell` both directly (`app-shell.tsx:278`) and via `MobileTabBar`, so the context
  reaches both.

**Banner**: unchanged copy. Reload calls `applyUpdate` for `waiting` (as today) and `location.reload()`
for `stale`. Still hidden while offline.

## Tests

- Hook: a sibling swap sets `stale` and does not reload; a navigation update full-loads the target on
  `controllerchange`; the 3s fallback; `stale` assigns straight away; returns `false` when busy, offline
  or `none`.
- Link filter as a pure function: modifier keys, `target=_blank`, `download`, external origin, `/api/`,
  hash-only.
- Banner: renders for `stale`, and its Reload refreshes.
- Profile menu: items go through `navigate`.

## Left to the builder

- Exact file split, as long as the click filter is a pure, tested function.
- Whether the 3s fallback is a constant in the hook file (suggested `NAVIGATION_UPDATE_TIMEOUT_MS`).

## My calls (not discussed, check these)

- Offline taps are never intercepted (a full load offline could land on the offline fallback).
- The banner's own Reload is not blocked by the busy gate. It is an explicit choice.
- A 3s fallback timeout.
