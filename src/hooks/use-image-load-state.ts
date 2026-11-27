import { useCallback, useState } from "react";

export type ImageLoadStatus = "loading" | "loaded" | "error";

/**
 * Load status of one `<img>`, keyed by its `src`, for a skeleton and a fade-in.
 *
 * The status belongs to the `src` it was reported for, so choosing a different photo goes back
 * to `loading` with no effect to reset it, and a late event from the previous image cannot mark
 * the new one loaded or failed.
 *
 * `ref` covers an image the browser already settled before React attached its handlers: one served
 * from cache would leave the skeleton pulsing over a visible photo forever, and one that failed --
 * which the 503 from a disabled photo store does at once -- would pulse over nothing, since `error`
 * is never fired twice. A `complete` image with no `naturalWidth` is a failed one; `currentSrc`
 * separates that from an element the browser has not started on, which is `complete` too.
 */
export function useImageLoadState(src: string) {
  const [settled, setSettled] = useState<{ src: string; status: ImageLoadStatus } | null>(null);
  const status: ImageLoadStatus = settled?.src === src ? settled.status : "loading";

  const onLoad = useCallback(() => setSettled({ src, status: "loaded" }), [src]);
  const onError = useCallback(() => setSettled({ src, status: "error" }), [src]);
  const ref = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node?.complete || node.currentSrc === "") return;
      setSettled({ src, status: node.naturalWidth > 0 ? "loaded" : "error" });
    },
    [src],
  );

  return { status, onLoad, onError, ref };
}
