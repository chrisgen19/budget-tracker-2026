"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;

/**
 * Keeps a text input responsive while committing the value on a trailing debounce.
 * `value` is the committed filter, so an external change (clear-all, a chip removal,
 * a restored URL) flows back into the field.
 */
export function useDebouncedSearch(value: string, onCommit: (next: string) => void) {
  const [input, setInput] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  useEffect(() => setInput(value), [value]);
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
