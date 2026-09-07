import { Prisma, type TransactionSource, type TransactionType } from "@prisma/client";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";
import { isDateOnly, resolveTransactionDate, type BatchTransactionInput } from "@/lib/validations";
import type { PrismaClient } from "@/lib/budget-query-types";

/** Bounds for the keyed batch transaction. Prisma defaults to 5s, which a full
 *  MAX_BATCH_TRANSACTIONS batch can exceed: the keyed path awaits each create in turn, so a
 *  200-row save is 200 sequential round trips plus their label associations. Blowing the
 *  deadline rolls the whole batch back and returns a generic 500, which is precisely the
 *  failure large batches were raised to allow. */
export const BATCH_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/** Shape returned for created and replayed rows alike, so a replay is indistinguishable
 *  from the original response. */
export const TX_INCLUDE = { category: true, labels: { include: { label: true } } } as const;

export type BatchFailureReason =
  /** A label id was not the caller's. */
  | "LABELS_NOT_OWNED"
  /** A category id was neither a default nor the caller's, or its type did not match the item's. */
  | "CATEGORIES_NOT_OWNED"
  /** Permission was withdrawn between the request arriving and the write starting. */
  | "NO_LONGER_PERMITTED"
  /** The advisory lock could not be taken, so whether the batch exists is genuinely unknown. */
  | "UNKNOWN_WHETHER_SAVED";

export type CreateBatchResult =
  | { ok: true; transactions: TransactionWithRelations[]; replayed: boolean }
  | { ok: false; reason: BatchFailureReason };

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof TX_INCLUDE;
}>;

export interface CreateTransactionBatchParams {
  /** Injected rather than imported, matching `budget-queries.ts` and `createBudgetMcpServer`,
   *  so the MCP server and the route can each supply their own client. */
  prisma: PrismaClient;
  userId: string;
  items: BatchTransactionInput[];
  /** Makes the write replay-safe. Optional for the app, required by the MCP tool: an agent loop
   *  retries on its own, with no human deciding whether to resubmit. */
  clientBatchId?: string;
  createdVia: TransactionSource;
  /** Recorded for any token-carried source, so an incident can be traced to one credential. */
  mcpTokenId?: string;
  /**
   * Re-checked inside the write transaction, immediately before any row is created. Returning
   * false aborts without writing.
   *
   * The MCP path reads its write lease once, when the request arrives. A batch can then sit in a
   * database transaction for up to a minute, so a user who hits the kill switch during one would
   * watch it commit anyway, and a client that pipelined several requests would have them all
   * commit after the switch. Re-reading at the moment of the write closes that window, which is
   * the difference between a kill switch and a request-admission check.
   */
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/** Look for an already-committed batch under this key, without taking the lock. */
export const findSavedBatch = (
  prisma: PrismaClient,
  userId: string,
  clientBatchId: string
): Promise<TransactionWithRelations[]> =>
  prisma.transaction.findMany({ where: { userId, clientBatchId }, include: TX_INCLUDE });

/**
 * Look for an already-committed batch under this key, *under the advisory lock*.
 *
 * The unlocked read cannot see a concurrent attempt that holds the lock and has not committed
 * yet. Taking the lock blocks until any in-flight attempt on this key finishes, turning "no rows
 * yet" into a decision rather than a guess.
 *
 * Returns `null` when the lock could not be taken in time, which callers must render as *unknown*
 * rather than as a rejection: a 4xx tells the client nothing was written, so it drops its
 * idempotency pin and a corrected resubmit would create the batch a second time.
 */
export const findSavedBatchUnderLock = async (
  prisma: PrismaClient,
  userId: string,
  clientBatchId: string
): Promise<TransactionWithRelations[] | null> => {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientBatchId}))`;
      return tx.transaction.findMany({ where: { userId, clientBatchId }, include: TX_INCLUDE });
    }, BATCH_TX_OPTIONS);
  } catch {
    return null;
  }
};

/**
 * Verify every item's category is usable by this caller *and* matches the item's type.
 *
 * Two checks the create paths never made. Categories are either defaults (`userId: null`, shared
 * by everyone) or owned by one user, and only labels used to be checked, so the foreign key alone
 * accepted any category that exists, including another user's. Separately, an EXPENSE filed under
 * an INCOME category is internally inconsistent and would distort every breakdown that groups by
 * category; the app's form never allows it because it filters the picker by type, but nothing
 * enforced it server-side.
 *
 * Both were latent while the sole caller was the user's own browser session. Neither is latent
 * once a model supplies `categoryId` over an internet-facing endpoint.
 *
 * Typed on the two fields it reads rather than on `BatchTransactionInput`, so the update path can
 * hand it merged patch-over-row pairs. Those carry no `amount` or `date` of their own -- an edit
 * that changes only the category has neither -- and widening here beat inventing them at the call
 * site to satisfy a signature that never looks at them.
 *
 * Exported because `PUT /api/transactions/[id]` needs the identical pair and had neither (#229).
 * That route checked the transaction's owner and its labels' owner, then wrote `categoryId`
 * straight through, so the create path refused what the edit path accepted -- the same row, one
 * request later. Calling this rather than restating the rule is the point: a predicate written
 * twice is one that disagrees with itself the first time either copy is touched. Note the route
 * passes its *validated body*, not a merge, because `transactionSchema` requires `categoryId` and
 * `type` on every PUT -- it is a full replace, so the body already is the effective row.
 */
export const categoriesAreUsable = async (
  prisma: PrismaClient,
  userId: string,
  items: readonly { categoryId: string; type: TransactionType }[]
): Promise<boolean> => {
  const categoryIds = [...new Set(items.map((t) => t.categoryId))];
  if (categoryIds.length === 0) return true;

  const usable = await prisma.category.findMany({
    where: { id: { in: categoryIds }, OR: [{ userId }, { userId: null }] },
    select: { id: true, type: true },
  });
  if (usable.length !== categoryIds.length) return false;

  const typeById = new Map(usable.map((c) => [c.id, c.type]));
  return items.every((t) => typeById.get(t.categoryId) === t.type);
};

/**
 * Create many transactions in one atomic write, optionally idempotent under `clientBatchId`.
 *
 * Extracted from `POST /api/transactions/batch` so the MCP tool and the route share one
 * implementation. A second copy would drift the moment label resolution or the idempotency
 * contract changed, and nothing would catch it.
 */
export const createTransactionBatch = async ({
  prisma,
  userId,
  items,
  clientBatchId,
  createdVia,
  mcpTokenId,
  assertStillPermitted,
}: CreateTransactionBatchParams): Promise<CreateBatchResult> => {
  // A replay creates nothing, so it must not be judged on references it will never use. Labels
  // and categories are mutable: if the original write committed but its response was lost, and a
  // label was deleted before the retry, validating first would reject a batch that is already
  // saved. The caller reads that as "nothing was written", and a corrected resubmit under a fresh
  // key duplicates it. The HTTP route has always guarded this with `rejectUnlessAlreadySaved`;
  // the guard lives here now so the MCP tool, which calls this directly, is covered too.
  if (clientBatchId) {
    const alreadySaved = await findSavedBatch(prisma, userId, clientBatchId);
    if (alreadySaved.length > 0) {
      return { ok: true, transactions: alreadySaved, replayed: true };
    }
  }

  /** Re-check under the lock before rejecting, so a concurrent in-flight attempt is not mistaken
   *  for "never written". A lock we cannot take means genuinely unknown, never a rejection. */
  const rejectUnlessSaved = async (reason: BatchFailureReason): Promise<CreateBatchResult> => {
    if (!clientBatchId) return { ok: false, reason };
    const existing = await findSavedBatchUnderLock(prisma, userId, clientBatchId);
    if (existing === null) return { ok: false, reason: "UNKNOWN_WHETHER_SAVED" };
    if (existing.length > 0) return { ok: true, transactions: existing, replayed: true };
    return { ok: false, reason };
  };

  // Collect all explicitly-provided label IDs for a single ownership query
  const allExplicitLabelIds = [...new Set(items.flatMap((t) => t.labelIds ?? []))];

  let ownedLabelMap = new Map<string, string>();
  if (allExplicitLabelIds.length > 0) {
    const ownedLabels = await prisma.label.findMany({
      where: { id: { in: allExplicitLabelIds }, userId },
      select: { id: true, applicableTo: true },
    });
    if (ownedLabels.length !== allExplicitLabelIds.length) {
      return rejectUnlessSaved("LABELS_NOT_OWNED");
    }
    ownedLabelMap = new Map(ownedLabels.map((l) => [l.id, l.applicableTo]));
  }

  if (!(await categoriesAreUsable(prisma, userId, items))) {
    return rejectUnlessSaved("CATEGORIES_NOT_OWNED");
  }

  // Fetch schedule context only when at least one item needs auto-tagging
  const needsAutoLabel = items.some((t) => t.labelIds === undefined);
  const ctx = needsAutoLabel ? await getScheduleContext(userId) : null;

  const buildCreates = (tx: Prisma.TransactionClient) =>
    items.map((t) => {
      const txDate = new Date(t.date);

      // Resolve labels per item:
      // - labelIds === undefined → auto-apply from schedules
      // - labelIds === [] → user opted out, no labels
      // - labelIds === ['id1', ...] → use explicit labels (type-filtered)
      let resolvedLabelIds: string[] = [];
      if (t.labelIds === undefined) {
        const scheduledLabelId = ctx ? matchScheduledLabel(txDate, ctx, t.type) : null;
        if (scheduledLabelId) resolvedLabelIds = [scheduledLabelId];
      } else if (t.labelIds.length > 0) {
        const seen = new Set<string>();
        resolvedLabelIds = t.labelIds.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          const applicableTo = ownedLabelMap.get(id);
          return applicableTo === "BOTH" || applicableTo === t.type;
        });
      }

      return tx.transaction.create({
        data: {
          amount: t.amount,
          description: t.description,
          type: t.type,
          date: txDate,
          categoryId: t.categoryId,
          userId,
          createdVia,
          ...(mcpTokenId && { mcpTokenId }),
          ...(clientBatchId && { clientBatchId }),
          ...(t.receiptGroupId && { receiptGroupId: t.receiptGroupId }),
          ...(t.receiptBreakdown && { receiptBreakdown: t.receiptBreakdown }),
          ...(resolvedLabelIds.length > 0 && {
            labels: { createMany: { data: resolvedLabelIds.map((labelId) => ({ labelId })) } },
          }),
        },
        include: TX_INCLUDE,
      });
    });

  // Without a key this stays exactly as it was: one atomic multi-create.
  if (!clientBatchId) {
    if (assertStillPermitted && !(await assertStillPermitted(prisma as Prisma.TransactionClient))) {
      return { ok: false, reason: "NO_LONGER_PERMITTED" };
    }
    const created = await prisma.$transaction(buildCreates(prisma as Prisma.TransactionClient));
    return { ok: true, transactions: created, replayed: false };
  }

  // With a key the write is replay-safe. A batch that commits but whose response is lost is
  // indistinguishable from one that never ran, and both the review modal and an agent retry
  // would post the same rows again. The advisory lock serialises attempts on the key so the
  // existence check cannot be raced by a double submit (see also src/lib/scan-quota.ts).
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientBatchId}))`;

      const existing = await tx.transaction.findMany({
        where: { userId, clientBatchId },
        include: TX_INCLUDE,
      });
      if (existing.length > 0) {
        return { ok: true as const, transactions: existing, replayed: true };
      }

      // Checked here, under the lock and inside the transaction, so the answer cannot go stale
      // between the decision and the write. A replay is already handled above and writes
      // nothing, so it is deliberately not gated on this.
      if (assertStillPermitted && !(await assertStillPermitted(tx))) {
        return { ok: false as const, reason: "NO_LONGER_PERMITTED" as const };
      }

      const rows: TransactionWithRelations[] = [];
      for (const create of buildCreates(tx)) rows.push(await create);
      return { ok: true as const, transactions: rows, replayed: false };
    }, BATCH_TX_OPTIONS);
  } catch {
    // The write itself failed under the lock, so whether anything committed is unknown.
    return { ok: false, reason: "UNKNOWN_WHETHER_SAVED" };
  }
};

// --- Updating existing transactions ---

/** Fields an edit may change: exactly the six the app's own edit modal exposes.
 *
 *  `createdVia`, `mcpTokenId`, `clientBatchId`, `billId`, `receiptGroupId` and `receiptBreakdown`
 *  are deliberately absent. The first two describe how the row came to exist and overwriting them
 *  would falsify provenance; re-pointing `billId` would silently settle a different bill's
 *  occurrence. None of them is a correction anyone makes by hand. */
export const UPDATABLE_FIELDS = [
  "amount",
  "description",
  "type",
  "date",
  "categoryId",
  "labelIds",
] as const;

export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export interface TransactionPatch {
  id: string;
  amount?: number;
  description?: string;
  type?: TransactionType;
  /**
   * An account-local date or datetime, resolved *here* rather than by the caller.
   *
   * Deliberately not pre-resolved. `resolveTransactionDate` fills a bare `YYYY-MM-DD` with the
   * current wall clock, which is the only sane choice when creating a row and the wrong one when
   * editing an existing one: the row already has a time, and a model correcting an amount will
   * plausibly echo the date back from a read tool, silently moving a 17:00 purchase to whenever
   * the request happened to arrive. The service holds the stored row, so only it can preserve it.
   */
  date?: string;
  categoryId?: string;
  /** Explicit ids replace the row's labels. Omitted preserves what it already carries. */
  labelIds?: string[];
}

export type UpdateFailureReason =
  /** An id was not this user's, or does not exist. The two are not distinguished on purpose. */
  | "NOT_FOUND"
  /** A patch named no field to change. */
  | "NO_FIELDS"
  /** The same id appeared twice in one batch, so the outcome would depend on ordering. */
  | "DUPLICATE_ID"
  | "LABELS_NOT_OWNED"
  | "CATEGORIES_NOT_OWNED"
  /** Permission was withdrawn between the request arriving and the write starting. */
  | "NO_LONGER_PERMITTED"
  /** The write failed for a reason retrying cannot change -- a category or label deleted between
   *  the ownership checks and the write, say. Every row is exactly as it was. */
  | "WRITE_REJECTED"
  /** The write failed and rolled back for a reason that may not recur. Every row is as it was. */
  | "WRITE_FAILED";

/** One row's result: what it is now, and what actually moved. */
export interface UpdatedTransaction {
  transaction: TransactionWithRelations;
  /** Only the fields whose stored value genuinely differs from what was there before. */
  changed: UpdatableField[];
  /**
   * Labels the caller named explicitly that were not applied, because the label's `applicableTo`
   * excludes the transaction's (possibly just-changed) type. Names, not ids.
   *
   * Neither an error nor a change, so it fits in neither field above, and it must not be inferred
   * from `changed`: asking for a label the row already carries plus one that does not fit produces
   * no change at all, and the reply would be a clean success that quietly ignored half the request.
   */
  droppedLabels: string[];
  /** The previous values of exactly those fields, so a caller can show the edit rather than
   *  assert it. Labels are names, matching how they are rendered everywhere else. */
  previous: Partial<{
    amount: number;
    description: string;
    type: TransactionType;
    date: Date;
    categoryName: string;
    labels: string[];
  }>;
}

export type UpdateTransactionsResult =
  | { ok: true; updated: UpdatedTransaction[] }
  | { ok: false; reason: UpdateFailureReason };

export interface UpdateTransactionsParams {
  prisma: PrismaClient;
  userId: string;
  patches: TransactionPatch[];
  /** Minutes, `getTimezoneOffset()` convention (UTC+8 is -480). Needed to resolve a patch's
   *  account-local date, and to read a stored row's local time-of-day when preserving it. */
  timezoneOffset: number;
  /** Stamped onto `updated_via`. Set by the caller from its own surface, never from input. */
  updatedVia: TransactionSource;
  /**
   * Stamped onto `updated_by_mcp_token_id`. This names the row's *last* editor, so a surface that
   * is not a token passes `null` explicitly rather than leaving the field alone: a row edited over
   * MCP and later corrected elsewhere must stop naming the token, or the trail is not merely
   * missing but confidently wrong.
   */
  updatedByMcpTokenId: string | null;
  /** Re-checked inside the write transaction, for the same reason and in the same shape as on
   *  the create path: a kill switch has to stop work already in flight, not only the next call. */
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/** Labels to keep when the caller sent none: everything already there that still fits the type.
 *
 *  Scheduled labels are deliberately *not* re-matched on an edit. A schedule's premise is a real
 *  clock at the moment of spending, so re-running it here would let correcting a typo in a
 *  description silently re-tag the row, overwriting a choice the user made by hand. */
const preservedLabelIds = (
  current: TransactionWithRelations["labels"],
  effectiveType: TransactionType
): string[] =>
  current
    .filter((l) => l.label.applicableTo === "BOTH" || l.label.applicableTo === effectiveType)
    .map((l) => l.labelId);

/** The other side of that filter: labels the row already carried that a changed type excludes.
 *
 *  Reported for the same reason an explicitly named one is. `changed` and `previous.labels` do
 *  show the label leaving, but not *why*, and "I flipped this to income and its label vanished"
 *  is the kind of unexplained side effect that gets read as a bug in the tool. */
const typeExcludedLabels = (
  current: TransactionWithRelations["labels"],
  effectiveType: TransactionType
): string[] =>
  current
    .filter((l) => l.label.applicableTo !== "BOTH" && l.label.applicableTo !== effectiveType)
    .map((l) => l.label.name);

/**
 * The instant a patched date should store, given the row it is editing.
 *
 * A value carrying a time (or a zone) means what it says. A bare `YYYY-MM-DD` does not: it names a
 * calendar day and is silent about the time, so the row's existing time-of-day is carried onto it.
 *
 * `resolveTransactionDate` would instead fill it with the current clock, which is right for a
 * create -- there is no prior value to keep -- and wrong here twice over. Re-dating a 17:00 dinner
 * to the previous day would stamp it with whenever the request arrived, and, worse, *restating the
 * day a row already has* would rewrite its time while reporting `changed: ["date"]` with an
 * identical before and after. Read tools return `localDate`, so a model correcting an amount
 * echoing the date back is the expected case, not an exotic one.
 */
const resolvePatchDate = (value: string, stored: Date, timezoneOffset: number): Date => {
  if (!isDateOnly(value)) return new Date(resolveTransactionDate(value, timezoneOffset));

  // The row's exact offset into its own local day, carried onto the day being asked for.
  //
  // Taken as a millisecond count rather than rebuilt as an `HH:mm:ss` string handed back to
  // `resolveTransactionDate`: that round trip drops sub-second precision, because the parser
  // captures the seconds but leaves the fractional part non-capturing and rebuilds through
  // `Date.UTC`, which is never given a millisecond argument. Rows carrying milliseconds are
  // ordinary -- `POST /api/bills/[id]/action` stamps bill payments with a bare `new Date()` -- so
  // truncating would shift the instant by up to 999ms and re-introduce exactly the phantom
  // `changed: ["date"]`, with an identical before and after, that this function exists to prevent.
  //
  // Still the one `Date.UTC(y, m, d) + tzOffset * 60000` formula the rest of the app uses for day
  // boundaries, just applied here directly.
  const local = new Date(stored.getTime() - timezoneOffset * 60_000);
  const localDayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const msIntoDay = local.getTime() - localDayStart;

  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + msIntoDay + timezoneOffset * 60_000);
};

/**
 * Apply partial edits to existing transactions, atomically.
 *
 * The edit path behind the MCP `update_transactions` tool, and currently its only caller.
 *
 * Deliberately *not* wired into `PUT /api/transactions/[id]`, which keeps its own implementation.
 * Sharing it is the obvious next step and was tried: it hands the browser a stricter server than
 * the form was written against -- the form posts a stale `categoryId` across a type change, which
 * the effective-row check below rejects -- so the form work that has to come with it belongs in
 * its own change. Shaped for two callers regardless (`updatedVia` and `updatedByMcpTokenId` are
 * parameters, not constants), so wiring the route up later is a call site rather than a rewrite.
 *
 * All-or-nothing across the batch. Unlike a create there is no idempotency key to replay with, so
 * a half-applied batch would leave the caller unable to say which rows moved and unable to safely
 * resubmit.
 */
export const updateTransactions = async ({
  prisma,
  userId,
  patches,
  timezoneOffset,
  updatedVia,
  updatedByMcpTokenId,
  assertStillPermitted,
}: UpdateTransactionsParams): Promise<UpdateTransactionsResult> => {
  const ids = patches.map((p) => p.id);
  // Two patches for one row would apply in array order and the loser would vanish silently, which
  // is a worse answer than refusing: the caller believes both edits landed.
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "DUPLICATE_ID" };

  // A patch naming nothing still stamps the audit columns and moves `updated_at`, so it is not a
  // free no-op and is refused rather than quietly accepted.
  if (patches.some((p) => !UPDATABLE_FIELDS.some((f) => p[f] !== undefined))) {
    return { ok: false, reason: "NO_FIELDS" };
  }

  // Scoped to `userId`, so another user's id is simply not found. Deliberately indistinguishable
  // from a nonexistent one: telling them apart would let a token probe for ids it does not own.
  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids }, userId },
    include: TX_INCLUDE,
  });
  if (rows.length !== ids.length) return { ok: false, reason: "NOT_FOUND" };
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Every check below runs against the row as it *will be*, never against the patch alone. The
  // case that makes the difference is a patch that flips `type` and sends no `categoryId`: the
  // stored category is untouched by the patch and is exactly what has to be re-examined, or an
  // EXPENSE turned INCOME keeps a food category and distorts every breakdown that groups by one.
  const effective = patches.map((patch) => {
    const row = rowById.get(patch.id)!;
    return {
      patch,
      row,
      type: patch.type ?? row.type,
      categoryId: patch.categoryId ?? row.categoryId,
    };
  });

  // Only the rows whose pair actually *moves*. Testing whether the patch mentioned the fields is
  // not the same thing and does not work: `transactionSchema` requires `categoryId`, and the app's
  // edit form posts the whole object, so every edit from the browser names it and would be judged
  // regardless.
  //
  // The state this must not punish is reachable with no MCP involvement. `PUT /api/categories/[id]`
  // lets a custom category's `type` be flipped while its transactions keep pointing at it, leaving
  // rows whose stored pair no longer agrees. Re-sending that pair unchanged writes exactly what is
  // already there, so rejecting it prevents nothing and merely locks the row out of being edited
  // at all -- down to fixing a typo in its description. Comparing against the stored row skips
  // those and still catches every genuine reclassification, the bare `type` flip included.
  const reclassified = effective.filter(
    (e) => e.categoryId !== e.row.categoryId || e.type !== e.row.type
  );
  if (!(await categoriesAreUsable(prisma, userId, reclassified))) {
    return { ok: false, reason: "CATEGORIES_NOT_OWNED" };
  }

  // One ownership query for every explicitly named label across the batch, as on the create path.
  const explicitLabelIds = [...new Set(patches.flatMap((p) => p.labelIds ?? []))];
  let ownedLabelMap = new Map<string, { applicableTo: string; name: string }>();
  if (explicitLabelIds.length > 0) {
    const owned = await prisma.label.findMany({
      where: { id: { in: explicitLabelIds }, userId },
      // `name` is selected so a label the type filter removes can be named back. An id would be
      // useless to the person being told about it.
      select: { id: true, applicableTo: true, name: true },
    });
    if (owned.length !== explicitLabelIds.length) return { ok: false, reason: "LABELS_NOT_OWNED" };
    ownedLabelMap = new Map(owned.map((l) => [l.id, { applicableTo: l.applicableTo, name: l.name }]));
  }

  const resolved = effective.map((e) => {
    // The same three-way rule as the create path, minus its schedule branch: explicit ids are
    // deduped and type-filtered, `[]` clears them, and omitting the field preserves what is there.
    const requested = e.patch.labelIds === undefined ? null : [...new Set(e.patch.labelIds)];
    const fits = (id: string) => {
      const owned = ownedLabelMap.get(id);
      return owned?.applicableTo === "BOTH" || owned?.applicableTo === e.type;
    };

    const labelIds = requested === null ? preservedLabelIds(e.row.labels, e.type) : requested.filter(fits);

    // A label the caller asked for and did not get, from either direction: named by id and
    // filtered out, or already on the row and excluded by a changed type. Silently dropping the
    // first is the exact failure AGENTS.md records on the create path -- a review promising a
    // label it then did not write -- and it is worse on an edit, where the reply otherwise reads
    // as an unqualified success. The second was reported only as an unexplained disappearance
    // from `previous.labels`, which is the same problem wearing different clothes.
    const droppedLabels =
      requested === null
        ? typeExcludedLabels(e.row.labels, e.type)
        : requested.filter((id) => !fits(id)).map((id) => ownedLabelMap.get(id)!.name);

    return { ...e, labelIds, droppedLabels };
  });

  try {
    return await prisma.$transaction(async (tx) => {
      if (assertStillPermitted && !(await assertStillPermitted(tx))) {
        return { ok: false as const, reason: "NO_LONGER_PERMITTED" as const };
      }

      const updated: UpdatedTransaction[] = [];

      for (const { patch, row, type, categoryId, labelIds, droppedLabels } of resolved) {
        const labelsBefore = row.labels.map((l) => l.label.name).sort();
        const labelIdsBefore = row.labels.map((l) => l.labelId).sort();
        const labelsMoved = [...labelIds].sort().join(" ") !== labelIdsBefore.join(" ");

        const scalars = {
          ...(patch.amount !== undefined && { amount: patch.amount }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.type !== undefined && { type }),
          ...(patch.date !== undefined && {
            date: resolvePatchDate(patch.date, row.date, timezoneOffset),
          }),
          ...(patch.categoryId !== undefined && { categoryId }),
        };

        // Whether any scalar genuinely differs from what is stored. The keys the patch carried are
        // not the question: read tools hand back every field, so a model correcting one of them
        // routinely echoes the other four straight back, naming five and moving one. A caller that
        // posts the whole object on every save -- the app's edit form, were it ever wired up here
        // -- names all five and can move none.
        const scalarsMoved = Object.entries(scalars).some(([key, value]) => {
          const current = row[key as keyof typeof row];
          return value instanceof Date && current instanceof Date
            ? value.getTime() !== current.getTime()
            : value !== current;
        });

        // Stamped only when the row actually moves. An unchanged row must keep the trail it has:
        // opening the edit modal and pressing Update with no edits would otherwise rewrite
        // `updated_via` to APP and null the token id, erasing a genuine MCP trail for something
        // that never happened -- the same fabricated trail the bulk route goes out of its way not
        // to write, and the reason this column exists at all.
        const moved = scalarsMoved || labelsMoved;

        // Nothing moved means nothing to write. Writing the scalars anyway would store the values
        // already there -- but `updatedAt` carries `@updatedAt`, so Prisma bumps it on any update
        // at all, and a no-op patch would go on looking freshly edited in the one column left that
        // still says when. Skipping also spares a round trip per row of a batch that changes none.
        if (moved) {
          await tx.transaction.update({
            where: { id: patch.id },
            data: { ...scalars, updatedVia, updatedByMcpTokenId },
          });
        }

        // Replaced wholesale rather than diffed. `transaction_labels` holds nothing but the
        // pairing, so there is no per-row state a diff would preserve, and delete-then-create is
        // the shape the app's route has always used.
        if (labelsMoved) {
          await tx.transactionLabel.deleteMany({ where: { transactionId: patch.id } });
          if (labelIds.length > 0) {
            await tx.transactionLabel.createMany({
              data: labelIds.map((labelId) => ({ transactionId: patch.id, labelId })),
            });
          }
        }

        const after = await tx.transaction.findUniqueOrThrow({
          where: { id: patch.id },
          include: TX_INCLUDE,
        });

        // Reported by comparing stored values, not by which keys the patch carried. Sending an
        // amount identical to the one already there changed nothing, and listing it anyway would
        // have the caller tell the user about an edit that did not happen.
        const changed: UpdatableField[] = [];
        const previous: UpdatedTransaction["previous"] = {};
        if (after.amount !== row.amount) {
          changed.push("amount");
          previous.amount = row.amount;
        }
        if (after.description !== row.description) {
          changed.push("description");
          previous.description = row.description;
        }
        if (after.type !== row.type) {
          changed.push("type");
          previous.type = row.type;
        }
        if (after.date.getTime() !== row.date.getTime()) {
          changed.push("date");
          previous.date = row.date;
        }
        if (after.categoryId !== row.categoryId) {
          changed.push("categoryId");
          previous.categoryName = row.category.name;
        }
        if (labelsMoved) {
          changed.push("labelIds");
          previous.labels = labelsBefore;
        }

        updated.push({ transaction: after, changed, previous, droppedLabels });
      }

      return { ok: true as const, updated };
    }, BATCH_TX_OPTIONS);
  } catch (error) {
    // The whole batch is one transaction, so a throw rolled all of it back. Unlike the create path
    // there is no ambiguity to report: there are no new rows to hunt for and every row is exactly
    // as it was. What the caller should *do* about it still splits two ways, though, and telling
    // it to retry unconditionally is how an agent ends up looping.
    //
    // The ownership checks above run on `prisma`, outside this transaction, so a category or label
    // deleted in the window between them and the write surfaces here as a constraint violation.
    // Retrying replays the same doomed request forever. A deadlock or a lost connection is the
    // opposite and is worth another attempt, so the two get different reasons and different advice.
    const permanent =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      // P2003 foreign key, P2025 required record missing: both mean the request refers to
      // something that is no longer there.
      (error.code === "P2003" || error.code === "P2025");
    return { ok: false, reason: permanent ? "WRITE_REJECTED" : "WRITE_FAILED" };
  }
};
