import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (initial = "") => {
  const onCommit = vi.fn();
  const view = renderHook(({ value }) => useDebouncedSearch(value, onCommit), {
    initialProps: { value: initial },
  });
  return { ...view, onCommit };
};

describe("useDebouncedSearch", () => {
  it("commits typed text once the pause elapses", () => {
    const { result, onCommit } = setup();

    act(() => result.current.change("grab"));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenCalledWith("grab");
  });

  it("drops a pending commit when the committed value changes underneath it", () => {
    // Clearing a chip, or a navigation that resets the filters, replaces the text
    // the pending commit belongs to. Letting the timer land would re-apply an
    // abandoned search a moment after the field cleared, and the sync would then
    // put that text back in the box.
    const { result, rerender, onCommit } = setup("grab");

    act(() => result.current.change("mango"));
    rerender({ value: "" });

    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.input).toBe("");
  });

  it("does not fight the commit it just made", () => {
    // The committed value flowing back in is the normal path, not an external
    // change, and must not look like one.
    const { result, rerender, onCommit } = setup();

    act(() => result.current.change("grab"));
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenCalledWith("grab");

    rerender({ value: "grab" });
    expect(result.current.input).toBe("grab");
  });

  it("reset clears the field without committing", () => {
    const { result, onCommit } = setup();

    act(() => result.current.change("grab"));
    act(() => result.current.reset());
    act(() => vi.advanceTimersByTime(300));

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.input).toBe("");
  });
});
