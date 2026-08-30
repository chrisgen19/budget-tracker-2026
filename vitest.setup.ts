import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Everything here is DOM setup, and `include` now also covers the pure Node helpers under
// scripts/, which declare `@vitest-environment node`. setupFiles still runs for those, so without
// this guard the whole suite dies on `window is not defined` before a single test is collected.
const hasDom = typeof window !== "undefined";

// jsdom implements neither of these, and Modal calls both on open.
if (hasDom && !window.matchMedia) {
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
if (hasDom) {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

  // RTL does not auto-cleanup without globals enabled, and a leaked mount would let one
  // test's modal keep the body scroll lock held into the next.
  afterEach(cleanup);
}
