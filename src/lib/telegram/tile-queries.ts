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
  sortOrder: number;
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
}

/**
 * Resolve stored tiles against the categories that exist right now.
 *
 * Pure, so the resolution is testable without a database. `categories` is passed in rather than
 * fetched because every caller already needs the list for its own response, and fetching it twice
 * would let the two copies disagree within one request.
 */
export const viewTiles = (rows: QuickTileRow[], categories: BotCategory[]): QuickTileView[] =>
  rows.map((row) => {
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
      sortOrder: row.sortOrder,
    };
  });

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
