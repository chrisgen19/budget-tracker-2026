import type { PrismaClient } from "@/lib/budget-query-types";
import { getCategoryList } from "@/lib/budget-queries";
import type { BotCategory } from "@/lib/telegram/category-match";
import { resolveTileCategory, tileFallsBack } from "@/lib/telegram/quick-tiles";

/**
 * Reading the configured half of the quick-log grid.
 *
 * One function, shared by `GET /api/tg/bootstrap` and `GET /api/tg/tiles`, because the resolved
 * category has to be computed identically in both. If the grid and the editor disagreed about
 * where a tile files, the one place the user would find out is the ledger.
 */

export interface QuickTileView {
  id: string;
  label: string;
  description: string;
  /** Null means the tile opens the numeric pad instead of logging. */
  amount: number | null;
  type: "EXPENSE" | "INCOME";
  /** What the user chose, which may no longer exist. */
  categoryId: string | null;
  /**
   * Where a tap would **actually** file right now, which is not always what the user chose.
   *
   * Sent on every read for the reason the receipt year repair and the caption hint are both
   * surfaced: an inference the user cannot see is one they cannot undo. A tile whose category was
   * deleted while the app was closed shows its fallback in the grid rather than revealing it on
   * the next tap.
   */
  resolvedCategoryId: string | null;
  resolvedCategoryName: string | null;
  /** True when the tap will not file where the tile says. Rendered as a warning. */
  fallsBack: boolean;
  /**
   * Labels pinned to this button.
   *
   * `applies` is recomputed on **every** read rather than trusted from the edit that saved it,
   * for the same reason `resolveTileCategory` re-checks the category on every read:
   * `PUT /api/labels/[id]` can narrow a label's `applicableTo` underneath a button that was valid
   * when it was pinned -- it runs a 409 confirmation for the *transactions* an incompatible label
   * is on, and knows nothing about buttons. A pin that will no longer be written shows as
   * degraded in the grid instead of going missing on the next tap.
   */
  labels: QuickTileLabelView[];
  sortOrder: number;
}

/** One pinned label, as the grid and the editor render it. */
export interface QuickTileLabelView {
  id: string;
  name: string;
  color: string;
  /** False when this label's type no longer allows it on this button, so it will not be written. */
  applies: boolean;
}

/** The row shape this module needs, so a caller can pass rows it already has. */
export interface QuickTileRow {
  id: string;
  label: string;
  description: string;
  amount: number | null;
  type: string;
  categoryId: string | null;
  sortOrder: number;
  /** The pinned label ids. Resolved against the user's real list by `viewTiles`. */
  labels: { labelId: string }[];
}

/** A user's label, in the shape the tile view needs to render and judge a pin. */
export interface TileLabel {
  id: string;
  name: string;
  color: string;
  applicableTo: string;
}

/**
 * Resolve stored tiles against the categories that exist right now.
 *
 * Pure, so the resolution is testable without a database. `categories` is passed in rather than
 * fetched because every caller already needs the list for its own response, and fetching it twice
 * would let the two copies disagree within one request.
 */
export const viewTiles = (
  rows: QuickTileRow[],
  categories: BotCategory[],
  labels: TileLabel[] = []
): QuickTileView[] => {
  const labelsById = new Map(labels.map((l) => [l.id, l]));

  return rows.map((row) => {
    const type = row.type === "INCOME" ? "INCOME" : "EXPENSE";
    const resolved = resolveTileCategory(
      { description: row.description, type, categoryId: row.categoryId },
      categories
    );

    return {
      id: row.id,
      label: row.label,
      description: row.description,
      amount: row.amount,
      type,
      categoryId: row.categoryId,
      resolvedCategoryId: resolved?.categoryId ?? null,
      resolvedCategoryName: resolved?.categoryName ?? null,
      fallsBack: tileFallsBack(resolved),
      // A pin naming a label that is no longer in the list is dropped rather than rendered as a
      // stranger: the FK is `Cascade`, so the only way to get here is a list read that did not
      // include it, and inventing a name for it would be worse than the button showing one pin
      // fewer.
      labels: row.labels.flatMap((pin) => {
        const label = labelsById.get(pin.labelId);
        if (!label) return [];
        return [
          {
            id: label.id,
            name: label.name,
            color: label.color,
            applies: label.applicableTo === "BOTH" || label.applicableTo === type,
          },
        ];
      }),
      sortOrder: row.sortOrder,
    };
  });
};

/** The user's tiles, in grid order. */
export const listTileRows = async (
  prisma: PrismaClient,
  userId: string
): Promise<QuickTileRow[]> =>
  prisma.telegramQuickTile.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      label: true,
      description: true,
      amount: true,
      type: true,
      categoryId: true,
      sortOrder: true,
      labels: { select: { labelId: true } },
    },
  });

/** The categories a tile may file into, in the shape `resolveTileCategory` wants. */
export const listTileCategories = async (
  prisma: PrismaClient,
  userId: string
): Promise<BotCategory[]> =>
  (await getCategoryList(prisma, userId)).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
  }));
