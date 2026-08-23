import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom implements neither of these, and Modal calls both on open.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom's scrollTo throws "Not implemented"; the scroll lock calls it on release.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// RTL does not auto-cleanup without globals enabled, and a leaked mount would let one
// test's modal keep the body scroll lock held into the next.
afterEach(cleanup);
