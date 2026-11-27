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
    act(() => result.current.ref({ complete: true, naturalWidth: 900 } as HTMLImageElement));
    expect(result.current.status).toBe("loaded");
  });

  it("does not treat a broken complete image as loaded", () => {
    const { result } = renderHook(() => useImageLoadState("/a"));
    act(() => result.current.ref({ complete: true, naturalWidth: 0 } as HTMLImageElement));
    expect(result.current.status).toBe("loading");
  });
});
