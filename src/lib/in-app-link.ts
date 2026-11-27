/**
 * The in-app path a click is heading to, or `null` when the click must be left to the browser.
 *
 * Used to take a waiting app update on a link tap (`UpdateNavigationProvider`), which turns the tap
 * into a full page load. Anything that is not a plain same-tab navigation inside the app is refused:
 * - modifier keys and non-primary buttons open a new tab or window, which the user asked for;
 * - an already-prevented click belongs to someone else;
 * - `download` and a non-`_self` target are not navigations of this tab;
 * - another origin is not the app, and `/api/` is a file or JSON, not a page;
 * - a hash-only change scrolls within the current page, and a full load would throw that away.
 *
 * Known limit: the caller listens in the capture phase, before any React `onClick`, so the
 * `defaultPrevented` check only sees an earlier capture listener. An `<a href>` whose own `onClick`
 * cancels the click to do something else (open a modal, guard unsaved changes) would still be
 * taken over while an update waits. Don't build that on an `<a href>`; use a `<button>`, or add an
 * explicit opt-out here when the first such link is needed.
 *
 * The `href` attribute is resolved against `current` rather than read from `anchor.href`, so the
 * result follows the URL the caller says the page is on.
 */
export const getInAppHref = (event: MouseEvent, current: URL): string | null => {
  if (event.button !== 0 || event.defaultPrevented) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (!(event.target instanceof Element)) return null;

  const anchor = event.target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.target !== "" && anchor.target !== "_self") return null;

  const url = new URL(anchor.getAttribute("href") ?? "", current);
  if (url.origin !== current.origin) return null;
  if (url.pathname.startsWith("/api/")) return null;
  const hashOnly =
    url.hash !== "" && url.pathname === current.pathname && url.search === current.search;
  if (hashOnly) return null;

  return url.pathname + url.search + url.hash;
};
