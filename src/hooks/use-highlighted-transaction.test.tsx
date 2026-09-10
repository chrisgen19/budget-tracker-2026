import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHighlightedTransaction } from "@/hooks/use-highlighted-transaction";
import type { TransactionWithCategory } from "@/types";

const row = (id: string) => ({ id }) as TransactionWithCategory;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface Props {
  highlightId: string | null;
  loadedRows: TransactionWithCategory[];
  loading: boolean;
}

/**
 * Render the hook with spies. `loadTransaction` hands out one deferred per call, so a test
 * can settle an earlier request after a later one and see which reply is allowed to land.
 */
function setup(initialProps: Props, options: { reactStrictMode?: boolean } = {}) {
  const requests: ReturnType<typeof deferred<TransactionWithCategory>>[] = [];
  const onOpen = vi.fn();
  const onError = vi.fn();
  const loadTransaction = vi.fn(() => {
    const request = deferred<TransactionWithCategory>();
    requests.push(request);
    return request.promise;
  });

  const hook = renderHook(
    (props: Props) =>
      useHighlightedTransaction({ ...props, onOpen, onError, loadTransaction }),
    { initialProps, ...options },
  );
  return { ...hook, requests, onOpen, onError, loadTransaction };
}

/** Settle a request and let its callbacks and the resulting render run. */
const settle = async (run: () => void) => {
  await act(async () => {
    run();
  });
};

describe("useHighlightedTransaction", () => {
  it("does nothing, and holds nothing up, without a highlight", () => {
    const { result, onOpen, loadTransaction } = setup({
      highlightId: null,
      loadedRows: [row("a")],
      loading: false,
    });

    expect(result.current.pending).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(loadTransaction).not.toHaveBeenCalled();
  });

  it("opens a loaded row without a request, and reports it spent", () => {
    const { result, onOpen, loadTransaction } = setup({
      highlightId: "a",
      loadedRows: [row("b"), row("a")],
      loading: false,
    });

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("a"));
    expect(loadTransaction).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("waits for the list to settle before deciding", () => {
    const { result, rerender, onOpen, loadTransaction } = setup({
      highlightId: "a",
      loadedRows: [],
      loading: true,
    });

    expect(result.current.pending).toBe(true);
    expect(loadTransaction).not.toHaveBeenCalled();

    rerender({ highlightId: "a", loadedRows: [row("a")], loading: false });

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("a"));
    expect(loadTransaction).not.toHaveBeenCalled();
  });

  it("fetches a row that is not loaded, and stays pending until it lands", async () => {
    const { result, requests, onOpen, loadTransaction } = setup({
      highlightId: "old",
      loadedRows: [row("new")],
      loading: false,
    });

    expect(loadTransaction).toHaveBeenCalledExactlyOnceWith("old");
    expect(result.current.pending).toBe(true);

    await settle(() => requests[0].resolve(row("old")));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("old"));
    expect(result.current.pending).toBe(false);
  });

  it("keeps a lookup alive while the loaded rows change underneath it", async () => {
    // The second bug in #289: the request shared an effect with the rows, which change on their
    // own as the infinite layout appends a page, and that effect's cleanup dropped the reply.
    const { result, rerender, requests, onOpen, loadTransaction } = setup({
      highlightId: "old",
      loadedRows: [row("new")],
      loading: false,
    });

    rerender({ highlightId: "old", loadedRows: [row("new"), row("newer")], loading: false });
    rerender({ highlightId: "old", loadedRows: [row("new"), row("newer")], loading: false });

    expect(loadTransaction).toHaveBeenCalledTimes(1);

    await settle(() => requests[0].resolve(row("old")));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("old"));
    expect(result.current.pending).toBe(false);
  });

  it("reports a failed lookup once, marks it spent, and does not retry", async () => {
    const { result, rerender, requests, onOpen, onError, loadTransaction } = setup({
      highlightId: "gone",
      loadedRows: [],
      loading: false,
    });
    const failure = new Error("Transaction not found");

    await settle(() => requests[0].reject(failure));

    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(onOpen).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);

    rerender({ highlightId: "gone", loadedRows: [row("other")], loading: false });

    expect(loadTransaction).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("abandons a lookup when the parameter is dropped mid-flight", async () => {
    // The third bug in #289: the nav item drops `?highlight=` without remounting, and a late
    // reply opened a modal for a row the user had just navigated away from.
    const { result, rerender, requests, onOpen, onError } = setup({
      highlightId: "old",
      loadedRows: [],
      loading: false,
    });

    rerender({ highlightId: null, loadedRows: [], loading: false });
    expect(result.current.pending).toBe(false);

    await settle(() => requests[0].resolve(row("old")));
    expect(onOpen).not.toHaveBeenCalled();

    rerender({ highlightId: null, loadedRows: [], loading: false });
    expect(onError).not.toHaveBeenCalled();
  });

  it("abandons a failed lookup without saying so when the parameter is dropped", async () => {
    const { rerender, requests, onError } = setup({
      highlightId: "old",
      loadedRows: [],
      loading: false,
    });

    rerender({ highlightId: null, loadedRows: [], loading: false });
    await settle(() => requests[0].reject(new Error("offline")));

    expect(onError).not.toHaveBeenCalled();
  });

  it("drops a superseded reply and opens the newer one", async () => {
    const { result, rerender, requests, onOpen } = setup({
      highlightId: "first",
      loadedRows: [],
      loading: false,
    });

    rerender({ highlightId: "second", loadedRows: [], loading: false });
    expect(requests).toHaveLength(2);

    await settle(() => requests[0].resolve(row("first")));
    expect(onOpen).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(true);

    await settle(() => requests[1].resolve(row("second")));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("second"));
    expect(result.current.pending).toBe(false);
  });

  it("drops an in-flight lookup when the newer highlight is already loaded", async () => {
    const { result, rerender, requests, onOpen } = setup({
      highlightId: "first",
      loadedRows: [row("second")],
      loading: false,
    });

    rerender({ highlightId: "second", loadedRows: [row("second")], loading: false });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("second"));

    await settle(() => requests[0].resolve(row("first")));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  it("opens the same row again once the parameter has come and gone", () => {
    const { rerender, onOpen } = setup({
      highlightId: "a",
      loadedRows: [row("a")],
      loading: false,
    });

    rerender({ highlightId: null, loadedRows: [row("a")], loading: false });
    rerender({ highlightId: "a", loadedRows: [row("a")], loading: false });

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("lets only the second of two requests for the same id land", async () => {
    // Dropped and then asked for again while the first request is still out. Tracking staleness
    // by id alone would let the first reply through as if it were the second.
    const { result, rerender, requests, onOpen, onError } = setup({
      highlightId: "a",
      loadedRows: [],
      loading: false,
    });

    rerender({ highlightId: null, loadedRows: [], loading: false });
    rerender({ highlightId: "a", loadedRows: [], loading: false });
    expect(requests).toHaveLength(2);

    await settle(() => requests[0].reject(new Error("offline")));
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(true);

    await settle(() => requests[1].resolve(row("a")));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("a"));
    expect(result.current.pending).toBe(false);
  });

  it("makes one request and opens once under Strict Mode", async () => {
    // Strict Mode mounts, unmounts and remounts every effect in development. The ref this
    // replaced existed partly to survive that; the reducer has to make it a no-op instead.
    const { result, requests, onOpen, loadTransaction } = setup(
      { highlightId: "old", loadedRows: [], loading: false },
      { reactStrictMode: true },
    );

    expect(loadTransaction).toHaveBeenCalledTimes(1);

    await settle(() => requests[0].resolve(row("old")));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(row("old"));
    expect(result.current.pending).toBe(false);
  });
});
