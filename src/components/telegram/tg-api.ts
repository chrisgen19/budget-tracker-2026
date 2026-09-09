"use client";

/**
 * Talking to `/api/tg/*` from inside the webview.
 *
 * Every request carries `Authorization: tma <initData>`. The existing hooks in
 * `use-categories.ts` and `use-labels.ts` are bare `fetch` relying on the NextAuth cookie, and are
 * deliberately not reused: that cookie is not `SameSite=None`, so it does not survive Telegram's
 * third-party iframe, and `initData` is the only credential this page has.
 */

export interface TileView {
  id: string;
  label: string;
  description: string;
  /** Null means the tile opens the amount pad instead of logging. */
  amount: number | null;
  type: "EXPENSE" | "INCOME";
  categoryId: string | null;
  resolvedCategoryId: string | null;
  resolvedCategoryName: string | null;
  /** True when a tap will not file where the tile says. Rendered as a warning. */
  fallsBack: boolean;
  /**
   * Labels pinned to this button, applied to every transaction it logs.
   *
   * Pinned here means *instead of* the user's auto-apply schedules, not as well as them. Edited
   * from the web app's Quick Log page rather than here: the Mini App's whole premise is that a
   * routine expense costs one tap, and a label picker is a screen this grid does not need.
   */
  labels: { id: string; name: string; color: string; applies: boolean }[];
  sortOrder: number;
}

export interface FrequentTile {
  key: string;
  description: string;
  count: number;
  amount: number | null;
  /** False means the pad opens rather than one tap logging an inferred figure. */
  amountIsStable: boolean;
  categoryId: string;
  categoryName: string;
  lastLoggedAt: string;
}

export interface TgCategory {
  id: string;
  name: string;
  type: "EXPENSE" | "INCOME";
  icon: string;
  color: string;
  isDefault: boolean;
}

export interface Bootstrap {
  user: { currency: string; timezoneOffset: number };
  tiles: TileView[];
  frequent: FrequentTile[];
  categories: TgCategory[];
  limits: { maxTiles: number };
}

export interface LogResult {
  id: string;
  amount: number;
  description: string;
  categoryName: string;
  /** Null on a replay: the decision belongs to the original request, not this one. */
  categoryVia: "tile" | "matched" | "other" | null;
  labels: string[];
  replayed: boolean;
}

/**
 * A failed request, classified by whether anything could have been written.
 *
 * The distinction the retry rests on, and the same one `BatchSaveError` draws in the multi-scan
 * review. A 4xx is raised before the route opens a transaction, so nothing was written and the
 * key may be discarded. Anything else -- a 5xx, or a request that never came back -- is *unknown*,
 * so the key has to be held and replayed.
 */
export class TgRequestError extends Error {
  readonly status: number;
  readonly wrote: "no" | "unknown";

  constructor(message: string, status: number) {
    super(message);
    this.name = "TgRequestError";
    this.status = status;
    this.wrote = status >= 400 && status < 500 ? "no" : "unknown";
  }
}

const request = async <T>(
  initData: string,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `tma ${initData}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    // The request never came back, so whether the server acted on it is unknowable. Status 0
    // classifies as "unknown", which is what keeps the idempotency key pinned.
    throw new TgRequestError("Check your connection and try again.", 0);
  }

  if (!response.ok) {
    // The body is the server's own message where it has one. A parse failure here must not mask
    // the status, which is what the retry decision is actually made on.
    const message = await response
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => undefined);
    throw new TgRequestError(message ?? "Something went wrong.", response.status);
  }

  return response.json() as Promise<T>;
};

export const fetchBootstrap = (initData: string) =>
  request<Bootstrap>(initData, "/api/tg/bootstrap");

export interface LogInput {
  tileId?: string;
  description: string;
  amount: number;
  type?: "EXPENSE" | "INCOME";
  categoryId?: string;
  clientBatchId: string;
}

export const postLog = (initData: string, input: LogInput) =>
  request<LogResult>(initData, "/api/tg/log", {
    method: "POST",
    body: JSON.stringify(input),
  });

export interface TileInput {
  label: string;
  description: string;
  amount: number | null;
  type: "EXPENSE" | "INCOME";
  categoryId: string | null;
}

export const postTile = (initData: string, input: TileInput) =>
  request<{ tile: TileView }>(initData, "/api/tg/tiles", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const patchTile = (initData: string, id: string, patch: Partial<TileInput>) =>
  request<{ tile: TileView }>(initData, `/api/tg/tiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteTile = (initData: string, id: string) =>
  request<{ deleted: true }>(initData, `/api/tg/tiles/${id}`, { method: "DELETE" });

export const reorderTiles = (initData: string, ids: string[]) =>
  request<{ tiles: TileView[] }>(initData, "/api/tg/tiles/reorder", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
