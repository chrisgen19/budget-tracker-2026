import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useImageLoadState } from "@/hooks/use-image-load-state";

describe("useImageLoadState", () => {
  it("starts loading, then reports loaded or error", () => {
    const { result } = renderHook(() => useImageLoadState("/a"));
    expect(result.current.status).toBe("loading");
    act(() => result.current.onLoad());
    expect(result.current.status).toBe("loaded");
    act(() => result.current.onError());
    expect(result.current.status).toBe("error");
  });

  it("goes back to loading for a new src, with no stale status carried over", () => {
    const { result, rerender } = renderHook(({ src }) => useImageLoadState(src), {
      initialProps: { src: "/a" },
    });
    act(() => result.current.onError());
    rerender({ src: "/b" });
    expect(result.current.status).toBe("loading");
  });

  it("ignores a late event from the previous image", () => {
    const { result, rerender } = renderHook(({ src }) => useImageLoadState(src), {
      initialProps: { src: "/a" },
    });
    const staleOnLoad = result.current.onLoad;
    rerender({ src: "/b" });
    act(() => staleOnLoad());
    expect(result.current.status).toBe("loading");
  });

  it("treats an image already complete when mounted as loaded", () => {
    const { result } = renderHook(() => useImageLoadState("/a"));
    act(() =>
      result.current.ref({
        complete: true,
        naturalWidth: 900,
        currentSrc: "/a",
      } as HTMLImageElement),
    );
    expect(result.current.status).toBe("loaded");
  });

  // A photo that 404s or 503s before React attaches `onError` never fires one, so reading the
  // element is the only chance to say so. Left as `loading` it pulses over nothing forever.
  it("reports an image that failed before mount as an error, not an endless skeleton", () => {
    const { result } = renderHook(() => useImageLoadState("/a"));
    act(() =>
      result.current.ref({ complete: true, naturalWidth: 0, currentSrc: "/a" } as HTMLImageElement),
    );
    expect(result.current.status).toBe("error");
  });

  // `complete` is true for an element the browser has not selected a source for either, and that
  // one has not failed: it has not started.
  it("leaves an image the browser has not started on loading", () => {
    const { result } = renderHook(() => useImageLoadState("/a"));
    act(() =>
      result.current.ref({ complete: true, naturalWidth: 0, currentSrc: "" } as HTMLImageElement),
    );
    expect(result.current.status).toBe("loading");
  });
});
