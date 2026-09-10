"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;

/**
 * Keeps a text input responsive while committing the value on a trailing debounce.
 * `value` is the committed filter, so an external change (clear-all, a chip removal,
 * a restored URL) flows back into the field.
 */
export function useDebouncedSearch(
  value: string,
  onCommit: (next: string) => void,
  /**
   * Change this to force the field back in step with `value` even when `value`
   * itself did not change. Needed because "no search before, no search after" is
   * indistinguishable from "nothing happened" to anything watching `value` alone.
   */
  resetKey?: unknown,
) {
  const [input, setInput] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  // Cancel as well as sync. A commit still in flight belongs to the text the
  // external change just replaced, so letting its timer land would re-apply an
  // abandoned search a moment after the field visibly cleared — and the same sync
  // would then put that text back in the box.
  useEffect(() => {
    cancel();
    setInput(value);
  }, [cancel, value, resetKey]);
  useEffect(() => cancel, [cancel]);

  const change = useCallback(
    (next: string) => {
      setInput(next);
      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        onCommit(next);
      }, DEBOUNCE_MS);
    },
    [cancel, onCommit],
  );

  /** Clears the field without committing — the caller owns the filter update. */
  const reset = useCallback(() => {
    cancel();
    setInput("");
  }, [cancel]);

  return { input, change, reset };
}
