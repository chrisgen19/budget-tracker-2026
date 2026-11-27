# Update on Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a waiting PWA update on the next safe in-app navigation (link taps and profile-menu items), keep the banner as fallback, and mark sibling tabs stale instead of reloading them.

**Architecture:** `useServiceWorkerUpdate` grows a `status` (`none | waiting | stale`), an intent-aware `controllerchange` handler and `applyOnNavigation(href)`. A new `UpdateNavigationProvider`, mounted once in `AppShell`, owns the hook, a capture-phase click listener (filtered by a pure `getInAppHref`), the scan busy gate, and a context that `UpdatePromptBanner` and `ProfileMenu` read.

**Tech Stack:** Next.js 15.5.12 App Router, React, Serwist, Vitest + React Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-27-update-on-navigation-design.md`

## Global Constraints

- No new packages.
- No em or en dashes in new comments, docs, copy or commit messages.
- Named exports; `function` for components, arrows for utilities; `unknown` over `any`; kebab-case files.
- No `console.log`.
- Tests import from `vitest` explicitly, colocated as `*.test.ts(x)`.
- Banner copy stays exactly `A new version is available.` and button `Reload`.
- Fallback timeout: `NAVIGATION_UPDATE_TIMEOUT_MS = 3000`.
- Busy = `scan.items.length > 0 || scan.isScanning || scan.isSavingAll`.
- Before finishing: `pnpm lint`, `pnpm type-check`, `pnpm test` all pass.
- Serwist is disabled in dev (`next.config.ts:14`), so manual checks need `pnpm build && pnpm start`.

## Review Focus

1. **Double tap while an update is pending:** the second tap must not post `SKIP_WAITING` again or start a client navigation. Expected: returns `true`, nothing new happens. Test in Task 2.
2. **`controllerchange` arrives after the 3s fallback already navigated:** must not assign or reload a second time. Test in Task 2.
3. **A new deploy lands while a tab is `stale`:** the newer waiting worker must win (`status` becomes `waiting`), so Reload posts to it rather than doing a plain refresh. Test in Task 2.
4. **Clicks on non-link targets and links inside the app with modifiers / middle button:** never intercepted (open-in-new-tab must keep working). Test in Task 1.
5. **Busy flips while the listener is mounted:** the gate reads the current value, not the value at mount. Test in Task 3.

Known and accepted: an `<a>` whose own `onClick` calls `preventDefault` cannot be detected from a capture listener. None exist today (checked); a future one should not be an `<a href>`.

---

### Task 1: Pure in-app link filter

**Files:**
- Create: `src/lib/in-app-link.ts`
- Test: `src/lib/in-app-link.test.ts`

**Interfaces:**
- Produces: `export const getInAppHref = (event: MouseEvent, current: URL): string | null` returning `pathname + search + hash` of the target, or `null` when the click must be left alone.

Returns `null` unless all hold: `event.button === 0`; no `metaKey`/`ctrlKey`/`shiftKey`/`altKey`; `!event.defaultPrevented`; `event.target` is an `Element` whose `closest("a[href]")` is an `HTMLAnchorElement`; the anchor has no `download` attribute; its `target` is `""` or `"_self"`; `new URL(anchor.href, current).origin === current.origin`; pathname does not start with `/api/`; and it is not a hash-only change (same pathname and search as `current`, with a hash).

- [ ] **Step 1: Write the failing tests** in `src/lib/in-app-link.test.ts`. Build anchors in `document.body`, dispatch-free: create `new MouseEvent("click", { button, metaKey, ... })` and `Object.defineProperty(event, "target", { value: el })`. `current = new URL("https://app.test/dashboard")`.
  - `it("returns the path for a plain click on an in-app link")`: `<a href="/bills?x=1">` gives `"/bills?x=1"`.
  - `it("finds the anchor from a nested child")`: click on a `<span>` inside `<a href="/goals">` gives `"/goals"`.
  - `it.each(["metaKey","ctrlKey","shiftKey","altKey"])("leaves %s clicks alone")` gives `null`.
  - `it("leaves middle clicks alone")`: `button: 1` gives `null`.
  - `it("leaves already-prevented clicks alone")`: `event.preventDefault()` on a `cancelable: true` event gives `null`.
  - `it("leaves new-tab, download, external and api links alone")`: `target="_blank"`, `download`, `https://other.test/x`, `/api/export` each give `null`.
  - `it("leaves hash-only links on the current page alone")`: `<a href="#top">` gives `null`; `<a href="/bills#top">` gives `"/bills#top"`.
  - `it("ignores clicks that are not on a link")`: a `<button>` gives `null`.

- [ ] **Step 2: Run to verify failure**
  Run: `pnpm exec vitest run src/lib/in-app-link.test.ts`
  Expected: FAIL, cannot resolve `./in-app-link`.

- [ ] **Step 3: Implement `getInAppHref` in `src/lib/in-app-link.ts`** with a JSDoc saying why each rule exists (open-in-new-tab, downloads, API routes, in-page anchors).

- [ ] **Step 4: Run to verify pass**
  Run: `pnpm exec vitest run src/lib/in-app-link.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/in-app-link.ts src/lib/in-app-link.test.ts
  git commit -m "feat(pwa): add a pure filter for interceptable in-app link clicks"
  ```

---

### Task 2: Hook status, stale siblings and applyOnNavigation

**Files:**
- Modify: `src/hooks/use-service-worker-update.ts` (whole file; keep the existing comments that still apply)
- Test: `src/hooks/use-service-worker-update.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UpdateStatus = "none" | "waiting" | "stale";
  export const NAVIGATION_UPDATE_TIMEOUT_MS = 3000;
  export function useServiceWorkerUpdate(): {
    status: UpdateStatus;
    updateAvailable: boolean;            // status !== "none"
    applyUpdate: () => void;             // waiting: SKIP_WAITING, reload on controllerchange; stale: location.reload()
    applyOnNavigation: (href: string) => boolean; // true = this hook took over the navigation
  };
  ```

Behaviour (from the spec):
- An intent ref, `{ kind: "none" } | { kind: "reload" } | { kind: "navigate"; href: string }`, set by `applyUpdate` / `applyOnNavigation`.
- `controllerchange`: first claim of an uncontrolled page is ignored (unchanged). Otherwise, if `reloading` is already set, return. Intent `reload` calls `location.reload()`. Intent `navigate` calls `location.assign(href)`. Intent `none` sets `status = "stale"`, clears `waitingRef`, and does not reload.
- `note(worker)` sets `status = "waiting"` even when currently `stale` (Review Focus 3).
- `applyOnNavigation(href)`: `false` when `status === "none"` or `!navigator.onLine`. If an intent is already pending, return `true` and do nothing (Review Focus 1). `stale`: set `reloading`, `location.assign(href)`, return `true`. `waiting`: set the navigate intent, post `{ type: "SKIP_WAITING" }`, start a `NAVIGATION_UPDATE_TIMEOUT_MS` timer that does the same `reloading` guard then `location.assign(href)`, return `true`. Clear the timer on unmount.
- `applyUpdate` with `stale` calls `location.reload()` directly.

- [ ] **Step 1: Update the test harness.** In `beforeEach`, add `assign = vi.fn()` to the stubbed `window.location` next to `reload`, and set `Object.defineProperty(navigator, "onLine", { configurable: true, value: true })`.

- [ ] **Step 2: Replace the sibling test and add new ones**
  - Replace `"reloads a sibling tab when another tab accepts the update"` with `it("marks a sibling tab stale instead of reloading it")`: after `controllerchange`, `reload` and `assign` not called, `result.current.status === "stale"`, `updateAvailable === true`.
  - `it("refreshes a stale tab when its banner Reload is tapped")`: make stale, `applyUpdate()`, `reload` called once.
  - `it("takes a waiting update on navigation and loads the target once the worker is in charge")`: waiting worker; `applyOnNavigation("/bills")` returns `true`, `postMessage` called with `{ type: "SKIP_WAITING" }`, `assign` not yet called; dispatch `controllerchange`; `assign` called once with `"/bills"`, `reload` not called.
  - `it("falls back to loading the target if the worker never takes over")`: fake timers; `applyOnNavigation("/goals")`; advance `NAVIGATION_UPDATE_TIMEOUT_MS`; `assign` called with `"/goals"`.
  - `it("does not load twice when the worker takes over after the fallback")` (Review Focus 2): as above, then dispatch `controllerchange`; `assign` called once, `reload` not called.
  - `it("ignores a second tap while an update is pending")` (Review Focus 1): two `applyOnNavigation` calls both return `true`, `postMessage` called once.
  - `it("loads the target straight away from a stale tab")`: make stale; `applyOnNavigation("/labels")` returns `true`, `assign` called with `"/labels"`.
  - `it("lets the navigation through when there is no update or the tab is offline")`: `status "none"` returns `false`; with a waiting worker and `navigator.onLine = false` returns `false` and posts nothing.
  - `it("prefers a newer waiting worker over a stale state")` (Review Focus 3): make stale, then a new worker reaches `installed` via `updatefound`; `status === "waiting"`; `applyUpdate()` posts `SKIP_WAITING` to the new worker.
  - Keep every other existing test as is.

- [ ] **Step 3: Run to verify failure**
  Run: `pnpm exec vitest run src/hooks/use-service-worker-update.test.ts`
  Expected: the new tests FAIL (`status` undefined, `applyOnNavigation` not a function); the old tests still pass.

- [ ] **Step 4: Implement the behaviour above** in `use-service-worker-update.ts`. Update the header and `controllerchange` comments: siblings are now marked stale rather than reloaded, and why (a sibling may be mid-scan or mid-form).

- [ ] **Step 5: Run to verify pass**
  Run: `pnpm exec vitest run src/hooks/use-service-worker-update.test.ts`
  Expected: PASS, all tests.

- [ ] **Step 6: Commit**
  ```bash
  git add src/hooks/use-service-worker-update.ts src/hooks/use-service-worker-update.test.ts
  git commit -m "feat(pwa): apply updates on navigation and mark sibling tabs stale"
  ```

---

### Task 3: Provider, banner and AppShell wiring

**Files:**
- Create: `src/components/pwa/update-navigation-provider.tsx`
- Test: `src/components/pwa/update-navigation-provider.test.tsx`
- Modify: `src/components/pwa/update-prompt-banner.tsx` (read the context instead of the hook)
- Modify: `src/components/pwa/update-prompt-banner.test.tsx` (mock the context hook)
- Modify: `src/components/app-shell.tsx` (wrap in the provider; `UpdatePromptBanner` at `:181` must sit inside it)

**Interfaces:**
- Consumes: `useServiceWorkerUpdate()` from Task 2; `getInAppHref(event, current)` from Task 1.
- Produces:
  ```ts
  export function UpdateNavigationProvider(props: { busy: boolean; children: React.ReactNode }): JSX.Element;
  export function useUpdateNavigation(): {
    status: UpdateStatus;
    updateAvailable: boolean;
    applyUpdate: () => void;
    navigate: (href: string) => void;
  };
  ```

Behaviour:
- Provider calls `useServiceWorkerUpdate()` once, keeps `busy` in a ref updated every render (Review Focus 5), and registers `document.addEventListener("click", handler, { capture: true })`. Handler: `href = getInAppHref(event, new URL(location.href))`; if `href && !busyRef.current && applyOnNavigation(href)`, call `event.preventDefault()`.
- `navigate(href)`: `if (busyRef.current || !applyOnNavigation(href)) router.push(href)`.
- `useUpdateNavigation()` outside a provider returns `{ status: "none", updateAvailable: false, applyUpdate: () => {}, navigate: router.push }`, so components rendered without `AppShell` (tests, `/tg`) keep plain navigation.
- `AppShell` passes `busy={scan.items.length > 0 || scan.isScanning || scan.isSavingAll}` and wraps the tree inside `InstallBannerProvider`.

- [ ] **Step 1: Write the failing provider tests** in `update-navigation-provider.test.tsx`. Mock `@/hooks/use-service-worker-update` (return `{ status, updateAvailable, applyUpdate, applyOnNavigation }` from a `vi.fn`) and `next/navigation` (`useRouter: () => ({ push })`). Render the provider around `<a href="/bills">Bills</a>` and a button calling `useUpdateNavigation().navigate("/goals")`.
  - `it("hands a plain link tap to the update and cancels the client navigation")`: `applyOnNavigation` returns `true`; `fireEvent.click(link)` returns `false` (default prevented); `applyOnNavigation` called with `"/bills"`.
  - `it("leaves the link alone when the update declines")`: returns `false`; click not prevented.
  - `it("leaves the link alone while a scan is busy")`: `busy` true; `applyOnNavigation` not called; click not prevented.
  - `it("reads busy as it changes")` (Review Focus 5): render `busy={true}`, `rerender` with `busy={false}`, click; `applyOnNavigation` called.
  - `it("routes navigate through the update, falling back to router.push")`: returns `true` gives `push` not called; returns `false` gives `push("/goals")`; `busy` gives `push("/goals")` and `applyOnNavigation` not called.
  - `it("falls back to router.push without a provider")`: render the button alone; `push("/goals")`.
  - `it("removes the click listener on unmount")`: unmount, click a detached link; `applyOnNavigation` not called.

- [ ] **Step 2: Update the banner tests.** Mock `@/components/pwa/update-navigation-provider` (`useUpdateNavigation: () => swUpdate()`) instead of the hook. Keep the three tests. Add `it("offers a reload to a stale tab too")`: `{ status: "stale", updateAvailable: true, applyUpdate }`; the banner renders and Reload calls `applyUpdate`.

- [ ] **Step 3: Run to verify failure**
  Run: `pnpm exec vitest run src/components/pwa`
  Expected: FAIL, cannot resolve `./update-navigation-provider`.

- [ ] **Step 4: Implement the provider, switch the banner to `useUpdateNavigation()`, and wire `AppShell`.**

- [ ] **Step 5: Run to verify pass**
  Run: `pnpm exec vitest run src/components/pwa src/hooks/use-service-worker-update.test.ts`
  Expected: PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add src/components/pwa src/components/app-shell.tsx
  git commit -m "feat(pwa): take waiting updates on in-app link taps when no scan is busy"
  ```

---

### Task 4: Profile menu through navigate, docs and final checks

**Files:**
- Modify: `src/components/profile-menu.tsx:205-215` (`ProfileMenu` only; `buildMenuItems` signature stays `router: Pick<..., "push">`, so `mobile-tab-bar.test.ts` is untouched)
- Create: `src/components/profile-menu.test.tsx`
- Modify: `CHANGELOG.md` (new entry at the top, matching the existing format)
- Modify: `AGENTS.md` (one line under **Key Patterns** for `UpdateNavigationProvider`)

**Interfaces:**
- Consumes: `useUpdateNavigation().navigate` from Task 3.

- [ ] **Step 1: Write the failing test** `it("sends menu items through the update-aware navigate")` in `profile-menu.test.tsx`. Mock `@/components/pwa/update-navigation-provider` (`useUpdateNavigation: () => ({ navigate })`), `@/components/privacy-provider` (`usePrivacy: () => ({ hideAmounts: false, toggleHideAmounts: vi.fn() })`), `@/components/user-provider` (`useUser: () => ({ user: { creditCardsEnabled: false } })`), `next-auth/react` (`signOut: vi.fn()`), and `next/navigation` (`useRouter: () => ({ push })`). Render `<ProfileMenu variant="desktop" name="A" email="a@test" isAdmin={false} />`, open the trigger, click "My Profile". Assert `navigate` called with `"/profile"` and `push` not called. Check the real import paths of those providers in `profile-menu.tsx` before writing the mocks.

- [ ] **Step 2: Run to verify failure**
  Run: `pnpm exec vitest run src/components/profile-menu.test.tsx`
  Expected: FAIL, `push` called instead of `navigate`.

- [ ] **Step 3: In `ProfileMenu`, pass `router: { push: navigate }` to `buildMenuItems`,** with `navigate` from `useUpdateNavigation()`. Drop the `useRouter` import if nothing else uses it.

- [ ] **Step 4: Run to verify pass**
  Run: `pnpm exec vitest run src/components/profile-menu.test.tsx src/components/mobile-tab-bar.test.ts`
  Expected: PASS.

- [ ] **Step 5: Docs.** CHANGELOG entry: updates now apply on the next in-app link tap or profile-menu item when no receipt scan is pending, sibling tabs show the banner instead of reloading, and the banner stays as fallback. AGENTS.md Key Patterns line naming `UpdateNavigationProvider`, the busy gate and the stale-sibling rule.

- [ ] **Step 6: Full checks**
  Run: `pnpm lint`, then `pnpm type-check`, then `pnpm test`
  Expected: all three exit 0.

- [ ] **Step 7: Manual check on a production build** (record results in the PR):
  1. `pnpm build && pnpm start`, open the app in two tabs, log in.
  2. Change any visible string, `pnpm build && pnpm start` again (the SW file changes).
  3. Bring a tab to the front (triggers `update()`); the banner appears in both tabs.
  4. In tab A, tap a sidebar link: one full load of the target, no banner afterwards. Tab B does not reload and still shows the banner; tapping a link there full-loads the target.
  5. Repeat with a scanned receipt sitting in the review queue: the link tap is a normal client navigation and the queue survives.
  6. At 375px, open the profile menu and pick Bills while an update is waiting: one full load of `/bills`.

- [ ] **Step 8: Commit**
  ```bash
  git add src/components/profile-menu.tsx src/components/profile-menu.test.tsx CHANGELOG.md AGENTS.md
  git commit -m "feat(pwa): route profile menu items through update-aware navigation"
  ```
