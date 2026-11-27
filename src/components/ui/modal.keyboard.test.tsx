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
 * The first two cases fail against the previous implementation, which corrected the scroll
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

/**
 * The layout viewport's width, which `Modal` watches for a rotation. jsdom reports 0 for
 * every `clientWidth`, so a case that rotates has to force it.
 */
const setLayoutWidth = (width: number) => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: width,
    configurable: true,
  });
};

/** jsdom implements neither, and both are load-bearing here. */
class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;

  /** What a pinch-zoom looks like: the same screen holds fewer CSS pixels. */
  zoomTo(scale: number) {
    this.scale = scale;
    this.shrinkTo(800 / scale);
  }

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
  // jsdom has no `scrollIntoView`, so this is `undefined`, and that is what goes back.
  const originalScrollIntoView = Element.prototype.scrollIntoView;

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
    // Drops the instance override so the prototype's own getter answers again.
    Reflect.deleteProperty(document.documentElement, "clientWidth");
    Element.prototype.scrollIntoView = originalScrollIntoView;
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

  /**
   * Android Chrome focuses a button when it is tapped, and the old handler only ever acted
   * on form fields. Re-centring the form under a category chip as it is tapped moves the
   * control before the finger lifts, and no keyboard is coming to justify it.
   */
  it("does not scroll when a button inside the modal takes focus", () => {
    vi.useFakeTimers();
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
        <button type="button">Food</button>
        <input type="checkbox" aria-label="Recurring" />
      </Modal>,
    );
    act(() => {
      vi.advanceTimersByTime(400);
    });
    scrollIntoView.mockClear();

    act(() => {
      screen.getByRole("button", { name: "Food" }).focus();
    });
    act(() => {
      screen.getByRole("checkbox", { name: "Recurring" }).focus();
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    viewport.shrinkTo(400);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * With no autofocused field the dialog lifecycle focuses the content container itself,
   * with `preventScroll: true`. Scrolling it into view from `focusin` would undo exactly
   * the thing that option asked for.
   */
  it("does not scroll when the modal focuses its own content as a fallback", () => {
    vi.useFakeTimers();
    render(
      <Modal open onClose={() => {}} title="Edit Category">
        <button type="button">Save</button>
      </Modal>,
    );

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * iOS ignores `maximumScale: 1` for a user's own pinch, and every frame of one is a
   * `visualViewport` resize. Zoom shrinks the viewport in CSS pixels just as a keyboard
   * does, so it must neither yank the content back to the field nor read as a keyboard.
   */
  it("treats a pinch-zoom as neither a keyboard nor a reason to scroll", () => {
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    scrollIntoView.mockClear();

    viewport.zoomTo(2);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(dialog.style.maxHeight).toBe("360px"); // 400 * 0.9: still a sheet
  });

  /** A keyboard raised while zoomed in still takes its share of the screen. */
  it("still detects a keyboard opened while zoomed in", () => {
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");

    viewport.scale = 2;
    viewport.shrinkTo(200); // 400 unzoomed pixels of an 800 screen

    expect(dialog.style.maxHeight).toBe("200px");
  });

  /**
   * The tallest height is a portrait figure once the phone turns. A landscape phone that
   * stays under 640px wide, or an Android split-screen resize, would otherwise compare a
   * short landscape viewport against it and read a keyboard that is not there.
   */
  it("forgets the tallest height when the viewport is rotated", () => {
    setLayoutWidth(390);
    render(
      <Modal open onClose={() => {}} title="New Transaction">
        <input aria-label="Amount" autoFocus />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");

    setLayoutWidth(568);
    setLayoutHeight(320);
    viewport.shrinkTo(320);

    expect(dialog.style.maxHeight).toBe("288px"); // 320 * 0.9: no keyboard
  });
});
