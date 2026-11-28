import { act, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "@/hooks/use-long-press";

const pointer = (overrides: Partial<{ pointerType: string; clientX: number; clientY: number }>) =>
  ({ pointerType: "touch", clientX: 0, clientY: 0, ...overrides }) as unknown as PointerEvent;

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after a touch is held for 450ms", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.handlers.onPointerDown(pointer({})));
    act(() => vi.advanceTimersByTime(449));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire when released early", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.handlers.onPointerDown(pointer({})));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.handlers.onPointerUp());
    act(() => vi.advanceTimersByTime(500));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("cancels when the finger moves, so scrolling the list never selects a row", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.handlers.onPointerDown(pointer({ clientX: 100, clientY: 100 })));
    act(() => result.current.handlers.onPointerMove(pointer({ clientX: 100, clientY: 111 })));
    act(() => vi.advanceTimersByTime(500));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("tolerates a small wobble", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.handlers.onPointerDown(pointer({ clientX: 100, clientY: 100 })));
    act(() => result.current.handlers.onPointerMove(pointer({ clientX: 104, clientY: 106 })));
    act(() => vi.advanceTimersByTime(450));
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("ignores a mouse, which has checkboxes and a context menu instead", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));
    act(() => result.current.handlers.onPointerDown(pointer({ pointerType: "mouse" })));
    act(() => vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("swallows exactly the one click that ends a long-press", () => {
    const { result } = renderHook(() => useLongPress(vi.fn()));
    expect(result.current.consumeClick()).toBe(false);
    act(() => result.current.handlers.onPointerDown(pointer({})));
    act(() => vi.advanceTimersByTime(450));
    expect(result.current.consumeClick()).toBe(true);
    expect(result.current.consumeClick()).toBe(false);
  });

  it("blocks the context menu after a touch but not after a mouse", () => {
    const { result } = renderHook(() => useLongPress(vi.fn()));
    const touchMenu = { preventDefault: vi.fn() };
    act(() => result.current.handlers.onPointerDown(pointer({})));
    act(() => result.current.handlers.onContextMenu(touchMenu));
    expect(touchMenu.preventDefault).toHaveBeenCalled();

    const mouseMenu = { preventDefault: vi.fn() };
    act(() => result.current.handlers.onPointerDown(pointer({ pointerType: "mouse" })));
    act(() => result.current.handlers.onContextMenu(mouseMenu));
    expect(mouseMenu.preventDefault).not.toHaveBeenCalled();
  });
});
