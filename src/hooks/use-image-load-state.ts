import { useCallback, useState } from "react";

export type ImageLoadStatus = "loading" | "loaded" | "error";

/**
 * Load status of one `<img>`, keyed by its `src`, for a skeleton and a fade-in.
 *
 * The status belongs to the `src` it was reported for, so choosing a different photo goes back
 * to `loading` with no effect to reset it, and a late event from the previous image cannot mark
 * the new one loaded or failed.
 *
 * `ref` covers an image the browser already had: one served from cache can finish before React
 * attaches `onLoad`, and the skeleton would then pulse over a visible photo forever.
 */
export function useImageLoadState(src: string) {
  const [settled, setSettled] = useState<{ src: string; status: ImageLoadStatus } | null>(null);
  const status: ImageLoadStatus = settled?.src === src ? settled.status : "loading";

  const onLoad = useCallback(() => setSettled({ src, status: "loaded" }), [src]);
  const onError = useCallback(() => setSettled({ src, status: "error" }), [src]);
  const ref = useCallback(
    (node: HTMLImageElement | null) => {
      if (node?.complete && node.naturalWidth > 0) setSettled({ src, status: "loaded" });
    },
    [src],
  );

  return { status, onLoad, onError, ref };
}
