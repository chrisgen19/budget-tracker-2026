import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import {
  createTransactionBatch,
  findSavedBatch,
  type TransactionWithRelations,
} from "@/lib/transaction-writes";
import type {
  TelegramQuickLogInput,
  TelegramQuickTileInput,
  TelegramQuickTilePatchInput,
} from "@/lib/validations";
import {
  MAX_QUICK_TILES,
  SORT_ORDER_GAP,
  nextSortOrder,
  resolveTileCategory,
} from "@/lib/telegram/quick-tiles";
import {
  listTileCategories,
  listTileRows,
  viewTiles,
  type QuickTileView,
} from "@/lib/telegram/tile-queries";

/**
 * Every rule a quick-log button obeys, in one place, behind neither auth gate.
 *
 * There are two doors onto the same rows and there always will be. `/api/tg/*` authenticates a
 * Telegram `initData` payload; `/api/quick-tiles/*` authenticates a NextAuth session. What they
 * are allowed to do once inside is identical, and it is not a short list -- the twelve-tile cap,
 * the duplicate-label refusal, the effective-row category check, the conditional write that makes
 * an edit depend on the world it was judged against, the replay-before-resolve ordering on a tap,
 * the tile being the authority on its own amount, and now the label rules below.
 *
 * Written twice, those drift. This codebase has the receipts: `assess.sql` and
 * `assessment-facts.ts` answered the same nine questions differently within days of each other,
 * and the gap widened while nobody was looking. So the rules live here, injected with `prisma` and
 * a `userId`, and each route is a mapping from the result's `reason` to a status code. That shape
 * is `bill-writes.ts` and `transaction-writes.ts`, for the same reason.
 *
 * The functions return a discriminated result rather than throwing or returning a `NextResponse`.
 * A `NextResponse` would drag `next/server` into the shared layer and hand one caller's error
 * vocabulary to the other; an exception would make the ordinary refusals (a full grid, a duplicate
 * name) indistinguishable from a database falling over.
 */

/**
 * Why a quick-tile operation was refused.
 *
 * Each maps to exactly one status code at each route, and the mapping is the same at both -- see
 * `quickTileStatus`. Split finely enough that a caller never has to read the message to decide
 * what to do: `STALE` means refetch and retry, `NOT_FOUND` means the thing is gone, and
 * `UNKNOWN_WHETHER_SAVED` means do not resubmit under a fresh idempotency key.
 */
export type QuickTileFailureReason =
  /** The grid is already at `MAX_QUICK_TILES`. */
  | "TILE_LIMIT"
  /** `@@unique([userId, label])`: a button already reads that. */
  | "DUPLICATE_LABEL"
  /** The category is not the caller's, or its type disagrees with the tile's. */
  | "CATEGORY_UNUSABLE"
  /** A label is not the caller's, or its `applicableTo` excludes the tile's type. */
  | "LABELS_UNUSABLE"
  /** No such tile for this user. */
  | "NOT_FOUND"
  /** The row moved under the request. Refetch and try again. */
  | "STALE"
  /** A reorder that was not exactly this user's current id set. */
  | "ID_SET_MISMATCH"
  /** Not even an "Other" category exists, so there is nowhere honest to file the row. */
  | "NO_CATEGORY"
  /** The write failed and nothing was committed. */
  | "WRITE_REJECTED"
  /** The write may or may not have committed. Never retry under a *new* key. */
  | "UNKNOWN_WHETHER_SAVED";

export type QuickTileResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: QuickTileFailureReason; message: string };

const fail = (
  reason: QuickTileFailureReason,
  message: string
): { ok: false; reason: QuickTileFailureReason; message: string } => ({ ok: false, reason, message });

/**
 * The one place a refusal becomes a status code.
 *
 * Shared by both route layers rather than written out at each, so the Mini App and the web page
 * cannot come to disagree about whether a full grid is a 409 -- which matters because both
 * clients read a 4xx as proof nothing was written and act on it.
 */
export const quickTileStatus = (reason: QuickTileFailureReason): number => {
  switch (reason) {
    case "TILE_LIMIT":
    case "DUPLICATE_LABEL":
    case "STALE":
    case "NO_CATEGORY":
      return 409;
    case "NOT_FOUND":
      return 404;
    case "CATEGORY_UNUSABLE":
    case "LABELS_UNUSABLE":
    case "ID_SET_MISMATCH":
    case "WRITE_REJECTED":
      return 400;
    case "UNKNOWN_WHETHER_SAVED":
      return 500;
  }
};

/** The columns every tile read here selects, kept in one place so the view never sees a partial row. */
const TILE_SELECT = {
  id: true,
  label: true,
  description: true,
  amount: true,
  type: true,
  categoryId: true,
  sortOrder: true,
  labels: { select: { labelId: true } },
} as const;

/** A label as the rules need to see it: enough to decide whether it may be pinned. */
interface OwnedLabel {
  id: string;
  name: string;
  color: string;
  applicableTo: string;
}

/** Whether a label may be written onto a transaction of this type. */
const labelApplies = (label: { applicableTo: string }, type: "EXPENSE" | "INCOME"): boolean =>
  label.applicableTo === "BOTH" || label.applicableTo === type;

const listOwnedLabels = (prisma: PrismaClient, userId: string): Promise<OwnedLabel[]> =>
  prisma.label.findMany({
    where: { userId },
    select: { id: true, name: true, color: true, applicableTo: true },
  });

/**
 * Check a pinned label set against what the user actually owns and what the tile's type allows.
 *
 * Both halves are refusals here, at the edit, rather than filters at the write, and the second
 * half is the one worth explaining. `createTransactionBatch` type-filters explicit label ids
 * **silently** (`transaction-writes.ts`), so a tile pinned with an income-only label on an expense
 * button would save without complaint, show the label in the editor, and then quietly not write
 * it. That is exactly the failure `caption-labels.ts` reports back as `incompatible` rather than
 * dropping: a missing label is visible and correctable, a wrongly-promised one is neither.
 */
const checkPinnedLabels = (
  labelIds: string[],
  type: "EXPENSE" | "INCOME",
  owned: OwnedLabel[]
): { ok: true; ids: string[] } | { ok: false; reason: QuickTileFailureReason; message: string } => {
  const unique = [...new Set(labelIds)];
  const byId = new Map(owned.map((l) => [l.id, l]));

  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return fail("LABELS_UNUSABLE", "One or more labels do not exist or do not belong to you.");
  }

  const mismatched = unique.map((id) => byId.get(id)!).filter((l) => !labelApplies(l, type));
  if (mismatched.length > 0) {
    const names = mismatched.map((l) => l.name).join(", ");
    return fail(
      "LABELS_UNUSABLE",
      `${names} cannot be used on ${type === "INCOME" ? "an income" : "an expense"} button. Change the label's type, or pick another.`
    );
  }

  return { ok: true, ids: unique };
};

/** Read the whole grid, resolved against the categories and labels that exist right now. */
export const listQuickTiles = async (
  prisma: PrismaClient,
  userId: string
): Promise<{ tiles: QuickTileView[] }> => {
  const [categories, labels, rows] = await Promise.all([
    listTileCategories(prisma, userId),
    listOwnedLabels(prisma, userId),
    listTileRows(prisma, userId),
  ]);

  return { tiles: viewTiles(rows, categories, labels) };
};

/**
 * Add a button.
 *
 * The cap and the category check both run before the insert so the refusal names a cause the user
 * can act on, rather than surfacing as a write-time rejection on the first tap -- which is a
 * confusing place to learn that a category no longer matches.
 */
export const createQuickTile = async (
  prisma: PrismaClient,
  userId: string,
  input: TelegramQuickTileInput
): Promise<QuickTileResult<{ tile: QuickTileView }>> => {
  const [categories, labels] = await Promise.all([
    listTileCategories(prisma, userId),
    listOwnedLabels(prisma, userId),
  ]);

  // A category the user does not own, or one whose type disagrees with the tile's, would be
  // rejected later by `categoriesAreUsable` inside the write -- but only when a tap is logged,
  // which is a confusing place to find out. Refusing at the edit is where the user can act on it.
  if (input.categoryId) {
    const usable = categories.some((c) => c.id === input.categoryId && c.type === input.type);
    if (!usable) {
      return fail(
        "CATEGORY_UNUSABLE",
        "That category does not exist, or does not match the button's type."
      );
    }
  }

  const pinned = checkPinnedLabels(input.labelIds ?? [], input.type, labels);
  if (!pinned.ok) return pinned;

  try {
    // The cap and the sort order are read **under a per-user advisory lock**, in the same
    // transaction as the insert.
    //
    // A bare count-then-insert cannot enforce a limit under READ COMMITTED, which is the rule
    // `scan-quota.ts` already states for scan credits. Measured here rather than assumed: four
    // concurrent creates against eleven existing tiles all read eleven, all passed a cap of
    // twelve, and left fifteen -- three of them sharing one `sortOrder`, since
    // `@@index([userId, sortOrder])` is not unique and every one of them computed the same
    // maximum plus a gap.
    //
    // Neither consequence is severe -- an oversized grid and an unstable order between two
    // buttons, both fixed by deleting one -- but the guard is the pattern this codebase already
    // uses and costs one statement.
    //
    // Keyed on `quick-tile:<userId>` rather than the bare `userId` that `scan-quota.ts` locks on,
    // so creating a button and reserving a scan credit do not queue behind each other. They bound
    // different resources and have no reason to contend.
    //
    // Only the tile list moves inside. `categories` and `labels` are reference data for checks
    // the caller has already failed or passed; re-reading them under the lock would widen it for
    // nothing.
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quick-tile:${userId}`}))`;

      const existing = await tx.telegramQuickTile.findMany({
        where: { userId },
        select: { sortOrder: true },
      });

      if (existing.length >= MAX_QUICK_TILES) return "TILE_LIMIT" as const;

      return tx.telegramQuickTile.create({
        data: {
          userId,
          label: input.label,
          description: input.description,
          amount: input.amount,
          type: input.type,
          categoryId: input.categoryId,
          sortOrder: nextSortOrder(existing),
          labels: { create: pinned.ids.map((labelId) => ({ labelId })) },
        },
        select: TILE_SELECT,
      });
    });

    if (created === "TILE_LIMIT") {
      return fail(
        "TILE_LIMIT",
        `You can have at most ${MAX_QUICK_TILES} buttons. Delete one first.`
      );
    }

    // Returned through the same view as the list, so the editor is told immediately where this
    // button will actually file -- including when that is not what was asked for.
    return { ok: true, tile: viewTiles([created], categories, labels)[0] };
  } catch (error) {
    // `@@unique([userId, label])`. Two buttons reading the same thing are indistinguishable in a
    // grid, so this is a named refusal rather than a silent second tile.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("DUPLICATE_LABEL", "You already have a button with that label.");
    }
    throw error;
  }
};

/**
 * Edit one button.
 *
 * Every check runs against the **effective** row -- the patch merged over what is stored -- never
 * against the patch alone. That is what catches a bare `type` flip: `categoryId` and `labelIds`
 * are absent from the request, so nothing about them looks wrong, and the button would be left an
 * income button filed under a food category and carrying an expense-only label. Same rule
 * `updateTransactions` and `updateBill` both apply.
 */
export const updateQuickTile = async (
  prisma: PrismaClient,
  userId: string,
  id: string,
  patch: TelegramQuickTilePatchInput
): Promise<QuickTileResult<{ tile: QuickTileView }>> => {
  const [categories, labels, stored] = await Promise.all([
    listTileCategories(prisma, userId),
    listOwnedLabels(prisma, userId),
    prisma.telegramQuickTile.findFirst({ where: { id, userId }, select: TILE_SELECT }),
  ]);

  // 404 rather than 403 on a tile belonging to someone else: a 403 confirms it exists.
  if (!stored) return fail("NOT_FOUND", "Tile not found");

  const storedType = stored.type === "INCOME" ? "INCOME" : "EXPENSE";
  const storedLabelIds = stored.labels.map((l) => l.labelId);
  const effective = {
    type: patch.type ?? storedType,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : stored.categoryId,
    // An absent `labelIds` preserves the pins.
    labelIds: patch.labelIds ?? storedLabelIds,
  };

  // What actually **moved**, compared against the stored row rather than merely present in the
  // patch. The difference is the whole rule, and presence is not a proxy for it: the Mini App's
  // editor submits its complete draft, so `type` and `categoryId` are always present and always
  // equal to what is stored. A presence test therefore fires on every edit it makes.
  const typeMoved = patch.type !== undefined && patch.type !== storedType;
  const categoryMoved =
    patch.categoryId !== undefined && patch.categoryId !== stored.categoryId;

  // Judged only where the pair moves. Judging an unchanged pair prevents nothing -- re-sending it
  // writes what is already there -- and locks the caller out of a button that was *already*
  // mismatched, which needs no edit to reach: `PUT /api/categories/[id]` lets a custom category's
  // type be flipped underneath the buttons filing into it. `resolveTileCategory` and `viewTiles`
  // are built to tolerate exactly that state, so refusing to let it be edited is the one response
  // that leaves the user stuck. Same rule `updateTransactions` and `updateBill` both apply.
  if (effective.categoryId && (categoryMoved || typeMoved)) {
    const usable = categories.some(
      (c) => c.id === effective.categoryId && c.type === effective.type
    );
    if (!usable) {
      return fail(
        "CATEGORY_UNUSABLE",
        "That category does not exist, or does not match the button's type."
      );
    }
  }

  // Pins are judged when the caller names a set, or when a `type` flip invalidates the one that
  // is there -- and `typeMoved`, not the mere presence of `type`, is what says so. The Mini App
  // sends no `labelIds` and has no picker, so a presence test blocked every edit it made to a
  // button carrying a pin that a later `PUT /api/labels/[id]` had narrowed, with no way to clear
  // the pin from inside Telegram.
  //
  // A pin left behind is not lost: `viewTiles` reports it as not applying and the tap filters it
  // out, so the button keeps working and the web page shows why.
  const pinsMoved = patch.labelIds !== undefined || typeMoved;
  const pinned = pinsMoved
    ? checkPinnedLabels(effective.labelIds, effective.type, labels)
    : ({ ok: true, ids: effective.labelIds } as const);
  if (!pinned.ok) return pinned;

  const labelsMoved = !sameIdSet(pinned.ids, storedLabelIds);

  const scalars = {
    // Only the keys actually sent. `amount` is spread explicitly because `null` is a real value
    // here -- it means "make this button ask" -- and dropping it as falsy would make that
    // edit impossible.
    ...(patch.label !== undefined && { label: patch.label }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.amount !== undefined && { amount: patch.amount }),
    ...(patch.type !== undefined && { type: patch.type }),
    ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
  };

  try {
    // One transaction for the whole edit, and the row lock is its **first** statement.
    //
    // Two things go wrong when the scalar write and the pin replacement commit separately. A
    // failure in between leaves the new `type` beside the old pins -- exactly the combination the
    // check above refuses to accept from a caller. And two concurrent edits that move only
    // `labelIds` can interleave their delete and create, leaving the union of both sets: a pin
    // configuration neither request submitted.
    //
    // The lock goes first because of the foreign key, not despite it. Inserting a
    // `telegram_quick_tile_labels` row takes a `FOR KEY SHARE` lock on the parent tile, and
    // `FOR UPDATE` conflicts with it, so taking the lock *after* the insert deadlocks. Same
    // ordering `settleBill` and `updateTransactions` both document, and for the same reason.
    const outcome = await prisma.$transaction(async (tx) => {
      // Judged under the lock, against the pair that was *validated* rather than against the id
      // alone. The checks above ran on `stored`, read outside any transaction: two edits in
      // flight can each be valid on their own -- one moving `type` and `categoryId` to an income
      // pair, the other moving only `categoryId` to an expense one -- and applied blindly the
      // second lands on a row the first already changed, storing a combination neither asked for
      // and no constraint forbids.
      //
      // This is a `SELECT` and not the old `updateMany` predicate because an edit that moves only
      // `labelIds` has no scalar fields to write: Prisma emits no statement at all for an empty
      // `data` and reports `count: 0`, which the staleness branch then read as "the row moved".
      // Changing only a button's labels was refused with a spurious 409 and wrote nothing.
      const locked = await tx.$queryRaw<{ type: string; category_id: string | null }[]>`
        SELECT "type"::text, "category_id"
        FROM "telegram_quick_tiles"
        WHERE "id" = ${id} AND "user_id" = ${userId}
        FOR UPDATE
      `;

      // The pins are part of what was judged, so they are part of what is re-checked. Read after
      // the lock, so it sees whatever committed in the gap.
      //
      // Without this the conditional write was only half conditional. Two overlapping edits:
      // one swaps a BOTH pin for an EXPENSE-only pin, the other flips the tile to INCOME having
      // been validated against the *original* pin. The second passed a check that looked only at
      // type and category, and `labelsMoved` was false because it compared the pre-lock set with
      // itself -- so the flip landed and left an EXPENSE-only pin on an INCOME button, the exact
      // combination `checkPinnedLabels` refuses from any caller. Reproduced deterministically.
      const lockedPins = await tx.telegramQuickTileLabel.findMany({
        where: { tileId: id },
        select: { labelId: true },
      });

      const current = locked[0];
      if (
        !current ||
        current.type !== stored.type ||
        current.category_id !== stored.categoryId ||
        !sameIdSet(
          lockedPins.map((l) => l.labelId),
          storedLabelIds
        )
      ) {
        return "STALE" as const;
      }

      if (Object.keys(scalars).length > 0) {
        await tx.telegramQuickTile.update({ where: { id }, data: scalars });
      }

      // Replaced wholesale rather than diffed, and only when the set actually moved. A patch
      // restating the same pins writes nothing, which keeps `created_at` on the link rows honest
      // -- the same "stamp only what moved" rule the app's transaction edit paths follow.
      if (labelsMoved) {
        await tx.telegramQuickTileLabel.deleteMany({ where: { tileId: id } });
        await tx.telegramQuickTileLabel.createMany({
          data: pinned.ids.map((labelId) => ({ tileId: id, labelId })),
        });
      }

      return tx.telegramQuickTile.findFirstOrThrow({ where: { id, userId }, select: TILE_SELECT });
    });

    if (outcome === "STALE") {
      return fail(
        "STALE",
        "That button changed while you were editing it. Reload and try again."
      );
    }

    return { ok: true, tile: viewTiles([outcome], categories, labels)[0] };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("DUPLICATE_LABEL", "You already have a button with that label.");
    }
    throw error;
  }
};

/** Order-insensitive set comparison, so a reordered but unchanged pin list is not a change. */
const sameIdSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/** Remove one button. The link rows go with it through the FK's `Cascade`. */
export const deleteQuickTile = async (
  prisma: PrismaClient,
  userId: string,
  id: string
): Promise<QuickTileResult<{ deleted: true }>> => {
  // Scoped by `userId` in the same statement rather than checked first, so there is no window
  // between the ownership read and the delete.
  const result = await prisma.telegramQuickTile.deleteMany({ where: { id, userId } });

  if (result.count === 0) return fail("NOT_FOUND", "Tile not found");

  // The gaps a delete leaves in `sortOrder` are harmless: order is read, never computed from, and
  // `nextSortOrder` reads the maximum rather than counting rows.
  return { ok: true, deleted: true };
};

/**
 * Rewrite the grid order.
 *
 * Takes the **whole** set of ids rather than a moved id and a position. A partial reorder has to
 * be interpreted against whatever the server currently holds, and two drags in flight would be
 * interpreted differently. Sending the full intended order makes the request self-describing:
 * whatever arrives last is what the user last saw.
 */
export const reorderQuickTiles = async (
  prisma: PrismaClient,
  userId: string,
  ids: string[]
): Promise<QuickTileResult<{ tiles: QuickTileView[] }>> => {
  const owned = await prisma.telegramQuickTile.findMany({
    where: { userId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((t) => t.id));

  // Exactly this user's tiles, no more and no fewer. A foreign id spliced in must not be written,
  // and an id left out would keep its old `sortOrder` and land somewhere the user did not put it.
  // Both are refusals rather than partial applications: a reorder that half-applies leaves a grid
  // nobody arranged.
  const sameSet = ids.length === ownedIds.size && ids.every((id) => ownedIds.has(id));

  if (!sameSet) {
    return fail(
      "ID_SET_MISMATCH",
      "Send exactly your current tile ids, in the order you want them."
    );
  }

  // One transaction, so a failure partway leaves the previous order intact rather than a grid
  // half in the old arrangement and half in the new one.
  try {
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.telegramQuickTile.update({
          where: { id },
          data: { sortOrder: (i + 1) * SORT_ORDER_GAP },
        })
      )
    );
  } catch (error) {
    // The set was read before the transaction opened, so a tile deleted in between is named here
    // and no longer exists. `update` raises P2025 and the whole transaction rolls back, which is
    // the right outcome -- the order the client sent describes a grid that no longer exists, so
    // the honest answer is to say so and let it refetch, not to guess which position the missing
    // tile freed up.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return fail(
        "STALE",
        "Your buttons changed while you were reordering them. Reload and try again."
      );
    }
    throw error;
  }

  return { ok: true, ...(await listQuickTiles(prisma, userId)) };
};

/** What a confirmation says about a tap. */
export interface QuickLogResult {
  id: string;
  amount: number;
  description: string;
  categoryName: string;
  /** How the category was decided, or null on a replay -- see `replayResponse`. */
  categoryVia: "tile" | "matched" | "other" | null;
  labels: string[];
  replayed: boolean;
}

/**
 * What a confirmation says about a row that was already written.
 *
 * `categoryVia` is null rather than re-derived. It describes a decision the *original* request
 * made, and this one did not make it: resolving again could disagree with what was actually
 * stored, which would be a confident answer about an inference that never happened. The category
 * *name* comes off the row and is the truth either way, which is what the confirmation is for.
 */
const replayResponse = (transaction: TransactionWithRelations): QuickLogResult => ({
  id: transaction.id,
  amount: transaction.amount,
  description: transaction.description,
  categoryName: transaction.category.name,
  categoryVia: null,
  labels: transaction.labels.map((l) => l.label.name),
  replayed: true,
});

/**
 * One tap.
 *
 * Writes through `createTransactionBatch`, the app's single create path, so the label resolution
 * rules, the category-ownership check and the advisory-lock idempotency all apply unchanged.
 *
 * `createdVia` names the surface that was tapped -- `TELEGRAM` for the Mini App grid, `APP` for
 * the web page -- because provenance follows the caller and not the code path. Neither carries an
 * `mcpTokenId`: no token was involved either way, and a stale id is not a gap in the trail but a
 * confidently wrong answer about who wrote the row.
 */
export const logQuickTile = async (
  prisma: PrismaClient,
  userId: string,
  input: TelegramQuickLogInput,
  createdVia: "TELEGRAM" | "APP"
): Promise<QuickTileResult<QuickLogResult>> => {
  const categories = await listTileCategories(prisma, userId);

  // A tile the request names is the authority on its own amount and category. Loaded rather than
  // trusted from the payload, and scoped to this user, so a stale or hostile client cannot log a
  // figure that disagrees with the button it came from -- the same rule `settleBill` applies to a
  // fixed bill, and for the same reason: the stored value is the one the user actually chose.
  const tile = input.tileId
    ? await prisma.telegramQuickTile.findFirst({
        where: { id: input.tileId, userId },
        select: {
          description: true,
          amount: true,
          type: true,
          categoryId: true,
          labels: { select: { label: { select: { id: true, applicableTo: true } } } },
        },
      })
    : null;

  if (input.tileId && !tile) {
    // 404 rather than 403: confirming that somebody else's tile exists is itself an answer.
    return fail("NOT_FOUND", "Tile not found");
  }

  const type = tile ? (tile.type === "INCOME" ? "INCOME" : "EXPENSE") : input.type;
  const description = tile?.description ?? input.description;
  // A tile carrying a fixed amount ignores whatever the client sent. `null` means the tile asks,
  // so there the pad's figure is the only one there is.
  const amount = tile?.amount ?? input.amount;

  const resolved = resolveTileCategory(
    { description, type, categoryId: tile ? tile.categoryId : (input.categoryId ?? null) },
    categories
  );

  if (!resolved) {
    // `resolveTileCategory` returns null only when even an "Other" category is missing, which
    // means the defaults were never seeded. Refusing is right: the alternative is picking
    // `categories[0]`, which is how every unrecognised expense once landed under Education.
    return fail(
      "NO_CATEGORY",
      "No category to file this under. Seed your categories in the app first."
    );
  }

  // Pinned labels win, and the filter is applied *here* rather than left to the downstream one.
  //
  // `createTransactionBatch` type-filters explicit ids silently, so a pin that no longer applies
  // -- `PUT /api/labels/[id]` can narrow a label's `applicableTo` underneath a button that was
  // valid when it was saved -- would vanish with no sign it was ever promised. Filtering here
  // means the tap still writes the labels that do apply and the confirmation names only those.
  const pinnedLabelIds = (tile?.labels ?? [])
    .map((l) => l.label)
    .filter((l) => labelApplies(l, type))
    .map((l) => l.id);

  const result = await createTransactionBatch({
    prisma,
    userId,
    items: [
      {
        amount,
        description,
        type,
        // The server's clock, never the client's. A tap happens now, the client's clock is not
        // ours, and a real timestamp is what lets the user's label schedules run against it.
        date: new Date().toISOString(),
        categoryId: resolved.categoryId,
        // Present only when the button carries pins. Sending them is an explicit opt-out from
        // auto-apply schedules, which is the wanted reading: the user named these labels on this
        // button, and a schedule guessing over a named one moves money in `getLabelBreakdown`.
        //
        // With no pins the key is **absent**, not `[]`. The distinction is load-bearing --
        // `undefined` lets schedules run, `[]` opts out of them -- and this is the behaviour every
        // tile had before pins existed.
        ...(pinnedLabelIds.length > 0 && { labelIds: pinnedLabelIds }),
      },
    ],
    clientBatchId: input.clientBatchId,
    createdVia,
  });

  if (!result.ok) {
    // `UNKNOWN_WHETHER_SAVED` and `NO_LONGER_PERMITTED` have to be 5xx. The client reads a 4xx as
    // proof nothing was written and drops its idempotency pin, so a retry would write a second row.
    const reason: QuickTileFailureReason =
      result.reason === "UNKNOWN_WHETHER_SAVED" || result.reason === "NO_LONGER_PERMITTED"
        ? "UNKNOWN_WHETHER_SAVED"
        : "WRITE_REJECTED";
    return fail(reason, "Failed to log");
  }

  const [transaction] = result.transactions;

  // The pre-check the caller runs can miss a replay that the advisory-locked check inside
  // `createTransactionBatch` then catches, which is what a genuine double submit looks like. That
  // row was written by the other request, so this one's `resolved.via` describes a decision it
  // made and did not apply -- reported through the same shape, and equally null.
  if (result.replayed) {
    return { ok: true, ...replayResponse(transaction) };
  }

  return {
    ok: true,
    id: transaction.id,
    amount: transaction.amount,
    description: transaction.description,
    categoryName: transaction.category.name,
    // Named on every reply, not only when it surprised us: the tile's own label is not proof of
    // where the row landed, and the confirmation is the only place the user sees the difference.
    categoryVia: resolved.via,
    labels: transaction.labels.map((l) => l.label.name),
    replayed: false,
  };
};

/**
 * The replay check every tap runs *before* anything else.
 *
 * A replay creates nothing, so it must not be judged on references it will never use. If the first
 * write committed but its response was lost, and the tile was deleted before the retry, resolving
 * the tile first would 404 a batch that is already saved -- and the client reads a 4xx as proof
 * nothing was written, drops its idempotency pin, and a corrected resubmit under a fresh key
 * duplicates a real transaction.
 *
 * Exposed separately rather than folded into `logQuickTile` because it is read off the **raw**
 * body, ahead of `safeParse`, for the same reason `POST /api/transactions/batch` does it there:
 * any later tightening of the payload schema would otherwise reject a replay of a batch accepted
 * under the previous one, which is the identical failure a step further out.
 */
export const findReplayedQuickLog = async (
  prisma: PrismaClient,
  userId: string,
  clientBatchId: string
): Promise<QuickLogResult | null> => {
  const alreadySaved = await findSavedBatch(prisma, userId, clientBatchId);
  return alreadySaved.length > 0 ? replayResponse(alreadySaved[0]) : null;
};
