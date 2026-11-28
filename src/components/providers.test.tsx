import { render, screen } from "@testing-library/react";
import { useReducedMotionConfig } from "framer-motion";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers";

// SessionProvider fetches /api/auth/session on mount, which jsdom cannot answer.
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * framer reads `(prefers-reduced-motion)` once per page and caches it, so the stub has to
 * be in place before the first component asks. `vitest.setup.ts` installs a `matchMedia`
 * that never matches; this file replaces it with one that reports the user asked for less.
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
});

function ReducedMotionProbe() {
  return <span data-testid="probe">{String(useReducedMotionConfig())}</span>;
}

/**
 * framer-motion ignores the OS "reduce motion" setting unless a `MotionConfig` says
 * `reducedMotion="user"`; its default is `"never"`. Without this, the analytics tab pill,
 * modals and toasts all kept sliding for someone who had asked them not to.
 */
describe("Providers", () => {
  it("makes framer-motion honour the OS reduced-motion setting", () => {
    render(
      <Providers>
        <ReducedMotionProbe />
      </Providers>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  /** The control: the same setting is ignored outside the provider, which is what made the fix necessary. */
  it("is what changes the answer, not the stub", () => {
    render(<ReducedMotionProbe />);
    expect(screen.getByTestId("probe").textContent).toBe("false");
  });
});
