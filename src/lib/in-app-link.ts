/**
 * The in-app path a click is heading to, or `null` when the click must be left to the browser.
 *
 * Used to take a waiting app update on a link tap (`UpdateNavigationProvider`), which turns the tap
 * into a full page load. Anything that is not a plain same-tab navigation inside the app is refused:
 * - modifier keys and non-primary buttons open a new tab or window, which the user asked for;
 * - an already-prevented click belongs to someone else;
 * - `download` and a non-`_self` target are not navigations of this tab;
 * - another origin is not the app, `/api/` is a file or JSON rather than a page, and a path
 *   beginning `//` is read back as a host by whoever navigates with it;
 * - a hash-only change scrolls within the current page, and a full load would throw that away.
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
  // `https://app.test//other.test/x` passes the origin check above and leaves `//other.test/x` as
  // the pathname, which `location.assign` reads as another host. Same origin, external destination.
  if (url.pathname.startsWith("//")) return null;
  const hashOnly =
    url.hash !== "" && url.pathname === current.pathname && url.search === current.search;
  if (hashOnly) return null;

  return url.pathname + url.search + url.hash;
};
