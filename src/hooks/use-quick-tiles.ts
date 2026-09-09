import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analyticsKeys } from "@/hooks/use-analytics";
import type { FrequentTile } from "@/lib/telegram/frequent-tiles";
import type { QuickTileView } from "@/lib/telegram/tile-queries";
import type { TelegramQuickTileInput, TelegramQuickTilePatchInput } from "@/lib/validations";

/**
 * Talking to `/api/quick-tiles/*` from the web app.
 *
 * These are the same rows the Telegram Mini App's grid renders. It has its own client
 * (`src/components/telegram/tg-api.ts`) rather than sharing this one, and deliberately: it
 * authenticates with `initData` because the NextAuth cookie is not `SameSite=None` and does not
 * survive Telegram's third-party iframe. Two transports, one server-side rule set.
 */

export const quickTileKeys = {
  all: ["quick-tiles"] as const,
  frequent: ["quick-tiles", "frequent"] as const,
};

export interface QuickTilesResponse {
  tiles: QuickTileView[];
  limits: { maxTiles: number };
}

/** What a tap wrote, as the confirmation renders it. */
export interface QuickLogResponse {
  id: string;
  amount: number;
  description: string;
  categoryName: string;
  /** How the category was decided. Null on a replay -- that decision was another request's. */
  categoryVia: "tile" | "matched" | "other" | null;
  labels: string[];
  replayed: boolean;
}

/**
 * Unwrap the server's own message, or fall back to something that names the request.
 *
 * Every refusal here carries a cause the user can act on ("You already have a button with that
 * label", "Reload and try again"), and dropping it for a generic string would throw away the only
 * part of the response that says what to do next.
 */
const readError = async (res: Response, fallback: string): Promise<never> => {
  const body = await res.json().catch(() => ({}));
  throw new Error(typeof body?.error === "string" ? body.error : fallback);
};

const fetchQuickTiles = async (): Promise<QuickTilesResponse> => {
  const res = await fetch("/api/quick-tiles");
  if (!res.ok) await readError(res, "Failed to load your buttons");
  return res.json();
};

const fetchFrequent = async (): Promise<FrequentTile[]> => {
  const res = await fetch("/api/quick-tiles/frequent");
  if (!res.ok) await readError(res, "Failed to load suggestions");
  return (await res.json()).frequent;
};

export function useQuickTilesQuery() {
  return useQuery({ queryKey: quickTileKeys.all, queryFn: fetchQuickTiles });
}

/**
 * What the ledger says is worth a button, minus what already has one.
 *
 * Its own query because it is a much heavier read than the grid, and the grid must render without
 * waiting on it. Invalidated whenever the tiles change, since the exclusion list is derived from
 * their descriptions server-side -- making a button really should make its variants disappear
 * from here, and that is the whole reason this section is worth showing.
 */
export function useFrequentTilesQuery() {
  return useQuery({ queryKey: quickTileKeys.frequent, queryFn: fetchFrequent });
}

export function useCreateQuickTile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TelegramQuickTileInput): Promise<QuickTileView> => {
      const res = await fetch("/api/quick-tiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) await readError(res, "Failed to create the button");
      return (await res.json()).tile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quickTileKeys.all });
    },
  });
}

export function useUpdateQuickTile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: TelegramQuickTilePatchInput;
    }): Promise<QuickTileView> => {
      const res = await fetch(`/api/quick-tiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) await readError(res, "Failed to save the button");
      return (await res.json()).tile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quickTileKeys.all });
    },
  });
}

export function useDeleteQuickTile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/quick-tiles/${id}`, { method: "DELETE" });
      if (!res.ok) await readError(res, "Failed to delete the button");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quickTileKeys.all });
    },
  });
}

export function useReorderQuickTiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]): Promise<QuickTileView[]> => {
      const res = await fetch("/api/quick-tiles/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) await readError(res, "Failed to save the new order");
      return (await res.json()).tiles;
    },
    onSuccess: (tiles) => {
      // The server returns the whole grid in its new order, so write it straight into the cache
      // rather than refetching. A reorder is the one edit where a round trip is visible: the rows
      // would jump back to their old positions until it lands.
      queryClient.setQueryData<QuickTilesResponse>(quickTileKeys.all, (previous) =>
        previous ? { ...previous, tiles } : previous
      );
    },
  });
}

/** A tap. Distinguishes a refusal that wrote nothing from one where that is unknown. */
export class QuickLogError extends Error {
  /** "no" = a 4xx, raised before anything was written, so the idempotency key may be dropped. */
  readonly wrote: "no" | "unknown";

  constructor(message: string, wrote: "no" | "unknown") {
    super(message);
    this.name = "QuickLogError";
    this.wrote = wrote;
  }
}

export function useLogQuickTile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: {
      tileId?: string;
      description: string;
      amount: number;
      type?: "EXPENSE" | "INCOME";
      categoryId?: string;
      clientBatchId: string;
    }): Promise<QuickLogResponse> => {
      let res: Response;
      try {
        res = await fetch("/api/quick-tiles/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // The request never came back, so whether it was written is genuinely unknown. The caller
        // must keep the same key and replay it rather than posting again under a fresh one.
        throw new QuickLogError("Could not reach the server. Check your connection.", "unknown");
      }

      if (!res.ok) {
        const parsed = await res.json().catch(() => ({}));
        const message = typeof parsed?.error === "string" ? parsed.error : "Failed to log";
        // A 4xx is raised before the route opens a transaction, so nothing was written and the
        // key can be discarded. A 5xx may have committed, so the key is held and replayed --
        // the rule the multi-scan review already follows for a batch save.
        throw new QuickLogError(message, res.status >= 500 ? "unknown" : "no");
      }

      return res.json();
    },
    onSuccess: () => {
      // A tap really did write a transaction, so everything that reads transactions is stale.
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      // And the Frequent list, since a logged row moves the counts it is derived from.
      queryClient.invalidateQueries({ queryKey: quickTileKeys.frequent });
    },
  });
}
