import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/modal";

/**
 * The virtual keyboard half of `Modal`, which only runs at mobile width.
 *
 * On Android Chrome the layout viewport does not change when the keyboard opens (the
 * default `interactive-widget: resizes-visual`), so the modal lifts clear of the keyboard
 * only because `Modal` resizes its own container from the `visualViewport` resize event.
 * Shrinking a scroll port leaves its `scrollTop` where it was, so the focused field ends
 * up below the fold - which is exactly the reported bug: the amount you are typing is
 * invisible behind the keyboard. iOS Safari hides this by scrolling the page itself.
 *
 * Both cases below fail against the previous implementation, which corrected the scroll
 * position once, on a `focusin` listener attached too late to ever see `autoFocus`.
 */

/** jsdom's `innerHeight` is a plain getter, so a mode that moves it has to be forced. */
const setLayoutHeight = (height: number) => {
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
    writable: true,
  });
};

/** jsdom implements neither, and both are load-bearing here. */
class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;

  /** What the keyboard opening looks like: the visual viewport loses its height. */
  shrinkTo(height: number) {
    this.height = height;
    act(() => {
      this.dispatchEvent(new Event("resize"));
    });
  }
}

describe("Modal keeps the focused field visible as the keyboard opens", () => {
  let viewport: FakeVisualViewport;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  const originalMatchMedia = window.matchMedia;
  const originalRaf = window.requestAnimationFrame;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    // One case moves this, and the sheet-height case asserts on it.
    setLayoutHeight(originalInnerHeight);

    // `useIsMobile` gates the whole feature on `(max-width: 639px)`.
    window.matchMedia = ((query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

    viewport = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
      writable: true,
    });

    // Run the reflow callback inline so the assertions do not depend on a real frame.
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
  });

  afterEach(() => {
    setLayoutHeight(originalInnerHeight);
    window.matchMedia = originalMatchMedia;
    window.requestAnimationFrame = originalRaf;
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.useRealTimers();
  });

  /**
   * `autoFocus` focuses during React's commit phase, before any `useEffect` has run, so a
   * `focusin` listener attached in an effect never sees it. The amount field on a new
   * transaction is autofocused, so this was the path where nothing was corrected at all.
   */
  it("reveals a field autoFocus focused before the listeners existed", () => {
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );

    expect(document.activeElement).toBe(document.querySelector("input"));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  /**
   * Android reports the keyboard's height more than once as it and its suggestion strip
   * animate in. Each report shrinks the modal again under a scroll position that was
   * correct a moment earlier, so a one-shot timer is undone by whichever resize lands
   * after it.
   */
  it("re-reveals the focused field on every viewport resize", () => {
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );

    scrollIntoView.mockClear();

    // The key area animates in, then the toolbar strip above it.
    viewport.shrinkTo(400);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    viewport.shrinkTo(350);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  /**
   * Without a keyboard the sheet gives the top tenth of the viewport back to the dimmed
   * page, so it reads as a sheet rather than a screen. With one open that strip costs
   * about 40px of the ~360px left, and the field being typed into is what loses it.
   */
  it("gives the sheet the whole viewport once the keyboard is open", () => {
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );

    const dialog = screen.getByRole("dialog");

    // jsdom's layout viewport is 768 tall and, like a real one, does not move for a keyboard.
    expect(window.innerHeight).toBe(768);
    viewport.shrinkTo(700);
    expect(dialog.style.maxHeight).toBe("630px"); // 700 * 0.9, no keyboard

    viewport.shrinkTo(400);
    expect(dialog.style.maxHeight).toBe("400px"); // keyboard open, nothing given away

    // ...and the strip comes back when the keyboard goes.
    viewport.shrinkTo(700);
    expect(dialog.style.maxHeight).toBe("630px");
  });

  /**
   * Under `interactive-widget: resizes-content` the layout viewport shrinks along with the
   * visual one. Detecting the keyboard by comparing the two would then read "no keyboard"
   * for as long as the keyboard is up. The app does not set it today, but measuring
   * against the tallest the viewport has been holds under either behaviour.
   */
  it("still detects the keyboard when the layout viewport shrinks with it", () => {
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );

    const dialog = screen.getByRole("dialog");

    // resizes-content: window.innerHeight moves in step with the visual viewport.
    setLayoutHeight(400);
    viewport.shrinkTo(400);

    expect(dialog.style.maxHeight).toBe("400px");
  });

  it("ignores a resize once focus has left the modal", () => {
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );

    act(() => {
      (document.activeElement as HTMLElement).blur();
    });
    scrollIntoView.mockClear();

    viewport.shrinkTo(400);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
