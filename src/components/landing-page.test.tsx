import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { LandingPage } from "@/components/landing-page";

/**
 * framer reads `(prefers-reduced-motion)` once per page and caches it, so the stub has to
 * be in place before the first component asks. `vitest.setup.ts` installs a `matchMedia`
 * that never matches; this file replaces it with one that reports the user asked for less.
 * jsdom also has no `IntersectionObserver`, which the page's `whileInView` sections need.
 */
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

/**
 * The landing page renders outside `Providers`, so the `MotionConfig` there never reached
 * it and its hero kept sliding up 24px for people who had asked for less motion. The
 * heading's slide is 0.6s; under reduced motion it must already be in place a moment after
 * mount, where without the config it is still offset.
 */
describe("LandingPage", () => {
  it("drops the hero's slide-in when the OS asks for reduced motion", async () => {
    render(<LandingPage />);
    const heading = screen.getByRole("heading", { level: 1 });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(heading.style.transform).toBe("none");
  });
});
