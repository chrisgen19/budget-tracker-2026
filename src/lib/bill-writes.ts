import {
  Prisma,
  type BillFrequency,
  type TransactionSource,
  type TransactionType,
} from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import { advanceToNextUnpaidOccurrence, settledStatusesFor } from "@/lib/bill-utils";
import { addUtcDays, userToday } from "@/lib/bill-dates";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";
import { categoriesAreUsable } from "@/lib/transaction-writes";

/**
 * The single write path for settling a recurring bill, shared by the app's route and the MCP tool.
 *
 * Settling an occurrence is not "write a transaction". It locks the bill row, refuses a second
 * terminal log on the same occurrence, walks the schedule forward to the earliest occurrence
 * nobody has settled, and switches the bill off when the walk runs past `endDate` -- four
 * properties that took three issues to get right (#158, #184, #216) and that a second copy would
 * lose one at a time. `create_transactions` deliberately cannot set `billId`, so before this
 * existed a bill paid over MCP left the schedule stalled, kept firing its reminder, and was later
 * reported by `findUnlinkedBillPayments` as an integrity problem (#237).
 *
 * `prisma` is injected for the same reason `transaction-writes.ts` injects it: the stdio MCP
 * server, the HTTP route and the app each supply their own client.
 */

/** Bounds for the settle transaction. The Prisma default of 5s covers it comfortably, but the walk
 *  over a daily bill's logs plus a label lookup is enough round trips to be worth a margin. */
const SETTLE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/**
 * How far the occurrence walk may run before it gives up.
 *
 * `advanceToNextUnpaidOccurrence` returns null both when the walk passes `endDate` and when it
 * exhausts this budget, and null switches the bill off. The default of 500 would deactivate a
 * daily bill with 500 consecutive settled occurrences, so it is raised until exhaustion is
 * implausible and null means `endDate` in practice.
 */
const WALK_BUDGET = 20_000;

export type BillActionKind = "pay" | "pay_existing" | "skip" | "snooze";

export type BillActionFailureReason =
  /** No bill with that id on this account. */
  | "BILL_NOT_FOUND"
  /** This occurrence already carries a terminal log, so acting again would settle it twice. */
  | "ALREADY_SETTLED"
  /** A variable bill was paid without saying what was actually paid. */
  | "AMOUNT_REQUIRED"
  /** `pay_existing` named a transaction that is not this user's. */
  | "TRANSACTION_NOT_FOUND"
  /** `pay_existing` named a transaction that already belongs to another bill. */
  | "PAYMENT_ALREADY_LINKED"
  /** The write lease lapsed between the request arriving and the write. Nothing was written. */
  | "NO_LONGER_PERMITTED";

export interface BillActionSuccess {
  ok: true;
  action: BillActionKind;
  billId: string;
  /** The transaction that settled the occurrence: created by `pay`, named by `pay_existing`, null
   *  for `skip` and `snooze`, which settle without money moving. */
  transactionId: string | null;
  /** What actually reached the ledger, so a caller never has to guess whether a variable bill took
   *  its fallback figure. Null when no transaction was involved. */
  amountPaid: number | null;
  /** Where the schedule now points. Null for a snooze, which deliberately does not advance it, and
   *  null when the walk found nothing further -- see `deactivated`. */
  nextDueDate: Date | null;
  /** True when the walk found no further occurrence, so the bill was switched off. */
  deactivated: boolean;
  /** For a snooze: the user's own calendar day the reminder returns on, at UTC midnight. */
  snoozeUntil: Date | null;
}

export type BillActionResult = BillActionSuccess | { ok: false; reason: BillActionFailureReason };

export interface SettleBillParams {
  prisma: PrismaClient;
  userId: string;
  billId: string;
  action: BillActionKind;
  /** The occurrence being acted on, as stored: a date-only value at UTC midnight. */
  dueDate: Date;
  /** What was actually paid. Required for a variable bill's `pay`, ignored otherwise. */
  amount?: number;
  /** The payment to attach, for `pay_existing`. */
  transactionId?: string;
  /** Days to defer, for `snooze`. Defaults to 1. */
  snoozeDays?: number;
  /** Minutes, `getTimezoneOffset()` convention. Decides which calendar day a snooze starts from. */
  timezoneOffset: number;
  /** Provenance for a transaction this creates. Follows the credential, never the endpoint. */
  createdVia?: TransactionSource;
  mcpTokenId?: string;
  /**
   * Re-checked inside the transaction, so switching writes off stops work already in flight rather
   * than only refusing the next request. Omitted by the app, which has no lease.
   */
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/**
 * Settle (or defer) one occurrence of a bill.
 *
 * Lifted out of `POST /api/bills/[id]/action`, which now delegates here. Every comment below
 * describes a failure that actually happened; none of them is hypothetical.
 */
export const settleBill = async ({
  prisma,
  userId,
  billId,
  action,
  dueDate,
  amount: paidAmount,
  transactionId: existingTransactionId,
  snoozeDays,
  timezoneOffset,
  createdVia,
  mcpTokenId,
  assertStillPermitted,
}: SettleBillParams): Promise<BillActionResult> => {
  const bill = await prisma.scheduledTransaction.findUnique({
    where: { id: billId },
    include: { category: true, labels: { include: { label: true } } },
  });

  if (!bill || bill.userId !== userId) return { ok: false, reason: "BILL_NOT_FOUND" };

  const originalStartDay = bill.startDate.getUTCDate();

  /**
   * Lock the bill row. Must be a transaction's FIRST statement.
   *
   * The transaction and log inserts below reference this row, so Postgres takes a FOR KEY SHARE
   * lock on it via those foreign keys. If two overlapping actions both hold KEY SHARE and then try
   * to upgrade to FOR UPDATE, they deadlock and one rolls back with a 500. Taking FOR UPDATE
   * before any referencing insert means the second transaction simply waits.
   *
   * Returns the locked row's nextDueDate, which is the value to walk from -- the copy read before
   * the transaction may already be stale.
   */
  const lockBill = async (tx: Prisma.TransactionClient) => {
    const [locked] = await tx.$queryRaw<{ next_due_date: Date }[]>`
      SELECT next_due_date FROM scheduled_transactions WHERE id = ${billId} FOR UPDATE
    `;
    return locked?.next_due_date ?? bill.nextDueDate;
  };

  /**
   * Whether this occurrence already has a terminal log.
   *
   * There is no unique constraint on (scheduledTransactionId, dueDate), so a resubmit -- a double
   * click, or a click against a stale reminder list that has not refetched yet -- would otherwise
   * write a second transaction and pay the same occurrence twice. Only race-free after lockBill.
   */
  const alreadySettled = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.scheduledTransactionLog.findFirst({
      where: {
        scheduledTransactionId: bill.id,
        dueDate,
        // Which statuses count as terminal depends on the action: pay_existing may supersede a
        // SKIPPED occurrence, since correcting a wrongly skipped month is the whole point of it.
        status: { in: settledStatusesFor(action) },
      },
      select: { id: true },
    });
    return existing !== null;
  };

  /**
   * Resolve the bill's next due date after a terminal log has been written.
   *
   * Advancing from the *acted-on* occurrence loses data: occurrences earlier than the result are
   * never regenerated by getPendingRemindersForUser (it only walks forward from nextDueDate), so
   * paying or skipping an occurrence out of order silently discarded every unpaid one before it.
   * Walk from the locked nextDueDate to the earliest occurrence with no terminal log instead.
   *
   * Call after inserting this action's log so the walk counts it too.
   */
  const resolveNextDueDate = async (tx: Prisma.TransactionClient, lockedNextDueDate: Date) => {
    const logs = await tx.scheduledTransactionLog.findMany({
      where: { scheduledTransactionId: bill.id },
      select: { dueDate: true, status: true },
    });

    return advanceToNextUnpaidOccurrence(
      lockedNextDueDate,
      bill.frequency,
      originalStartDay,
      bill.customIntervalDays,
      logs,
      { endDate: bill.endDate, maxIterations: WALK_BUDGET },
    );
  };

  /** Apply the walk's answer. Null means no valid occurrence is left, which switches the bill off. */
  const applyNextDue = async (tx: Prisma.TransactionClient, nextDue: Date | null) => {
    await tx.scheduledTransaction.update({
      where: { id: billId },
      data: {
        ...(nextDue && { nextDueDate: nextDue }),
        ...(nextDue === null && { isActive: false }),
      },
    });
  };

  if (action === "pay") {
    // A variable bill's stored amount is a fallback for *forecasting*, not a claim about what was
    // paid. Writing it as a transaction would put a guess in the ledger, and the estimator reads
    // the ledger back as history -- so one wrong click compounds into every future estimate.
    if (bill.isVariable && paidAmount === undefined) return { ok: false, reason: "AMOUNT_REQUIRED" };

    // Bill labels take priority over scheduled auto-labels.
    const billLabelIds = (bill.labels ?? [])
      .filter((bl) => bl.label.applicableTo === "BOTH" || bl.label.applicableTo === bill.type)
      .map((bl) => bl.labelId);
    let transactionLabelIds: string[] = [];

    if (billLabelIds.length > 0) {
      transactionLabelIds = billLabelIds;
    } else {
      const paymentDate = new Date();
      const ctx = await getScheduleContext(userId);
      const scheduledLabelId = ctx ? matchScheduledLabel(paymentDate, ctx, bill.type) : null;
      if (scheduledLabelId) transactionLabelIds = [scheduledLabelId];
    }

    // Only a variable bill takes the caller's figure. For a fixed one the stored amount *is* the
    // asserted payment, and honouring an amount here would let a stale client write a transaction
    // that silently disagrees with the bill. Pay & Edit remains the way to record a one-off
    // different figure on any bill.
    const amountToWrite = bill.isVariable ? (paidAmount ?? bill.amount) : bill.amount;

    // Atomic: create transaction, log payment, advance bill. Prevents partial writes that leave
    // nextDueDate stale or logs orphaned.
    const paid = await prisma.$transaction(async (tx) => {
      const lockedNextDue = await lockBill(tx);
      if (assertStillPermitted && !(await assertStillPermitted(tx))) return "not-permitted" as const;
      if (await alreadySettled(tx)) return "settled" as const;

      const transaction = await tx.transaction.create({
        data: {
          amount: amountToWrite,
          description: bill.description,
          type: bill.type,
          date: new Date(),
          categoryId: bill.categoryId,
          userId,
          billId: bill.id,
          // Provenance follows the credential, not the endpoint. Omitted by the app, where the
          // column's own default (APP) is the right answer and is not mintable over MCP.
          ...(createdVia && { createdVia }),
          ...(mcpTokenId && { mcpTokenId }),
          ...(transactionLabelIds.length > 0 && {
            labels: { create: transactionLabelIds.map((labelId) => ({ labelId })) },
          }),
        },
      });

      await tx.scheduledTransactionLog.create({
        data: {
          scheduledTransactionId: bill.id,
          dueDate,
          status: "PAID",
          actionDate: new Date(),
          transactionId: transaction.id,
        },
      });

      // Earliest still-unpaid occurrence, not simply the one just paid.
      const nextDue = await resolveNextDueDate(tx, lockedNextDue);
      await applyNextDue(tx, nextDue);

      return { transactionId: transaction.id, nextDue };
    }, SETTLE_TX_OPTIONS);

    if (paid === "settled") return { ok: false, reason: "ALREADY_SETTLED" };
    if (paid === "not-permitted") return { ok: false, reason: "NO_LONGER_PERMITTED" };

    return {
      ok: true,
      action,
      billId,
      transactionId: paid.transactionId,
      amountPaid: amountToWrite,
      nextDueDate: paid.nextDue,
      deactivated: paid.nextDue === null,
      snoozeUntil: null,
    };
  }

  if (action === "pay_existing") {
    // Verify the target transaction belongs to the authenticated user.
    const existingTx = await prisma.transaction.findFirst({
      where: { id: existingTransactionId ?? "", userId },
      select: { id: true, amount: true },
    });
    if (!existingTx) return { ok: false, reason: "TRANSACTION_NOT_FOUND" };

    // Atomic: log payment, link txn to bill, advance bill -- one commit.
    const linked = await prisma.$transaction(async (tx) => {
      const lockedNextDue = await lockBill(tx);
      if (assertStillPermitted && !(await assertStillPermitted(tx))) return "not-permitted" as const;
      if (await alreadySettled(tx)) return "settled" as const;

      // Claim the payment conditionally, and do it before anything else is written. A candidate
      // list can go stale -- two panels open, or one left sitting while the transaction is linked
      // elsewhere -- and an unconditional update would silently re-point a payment that already
      // belongs to another bill, leaving that bill's log referencing a transaction it no longer
      // owns. Returning early here commits nothing, since only reads and a row lock have happened.
      const claim = await tx.transaction.updateMany({
        where: { id: existingTx.id, userId, billId: null },
        data: { billId: bill.id },
      });
      if (claim.count === 0) return "taken" as const;

      // Remove a superseded skip instead of leaving two terminal logs on one occurrence. The
      // due-date walk dedupes, so it would still advance correctly, but the bill's history would
      // list the month twice -- once as skipped and once as paid -- which is the record this is
      // correcting.
      await tx.scheduledTransactionLog.deleteMany({
        where: { scheduledTransactionId: bill.id, dueDate, status: "SKIPPED" },
      });

      await tx.scheduledTransactionLog.create({
        data: {
          scheduledTransactionId: bill.id,
          dueDate,
          status: "PAID",
          actionDate: new Date(),
          transactionId: existingTx.id,
        },
      });

      const nextDue = await resolveNextDueDate(tx, lockedNextDue);
      await applyNextDue(tx, nextDue);

      return { nextDue };
    }, SETTLE_TX_OPTIONS);

    if (linked === "settled") return { ok: false, reason: "ALREADY_SETTLED" };
    if (linked === "not-permitted") return { ok: false, reason: "NO_LONGER_PERMITTED" };
    if (linked === "taken") return { ok: false, reason: "PAYMENT_ALREADY_LINKED" };

    return {
      ok: true,
      action,
      billId,
      transactionId: existingTx.id,
      amountPaid: existingTx.amount,
      nextDueDate: linked.nextDue,
      deactivated: linked.nextDue === null,
      snoozeUntil: null,
    };
  }

  if (action === "snooze") {
    const days = snoozeDays ?? 1;
    // The user's own day, N days on, stored at UTC midnight the way a due date is. Readers
    // therefore take it as date-only and must not convert it back through an offset. Computed from
    // `new Date()` alone, a snooze started at 02:00 in Manila expired the same morning, because
    // the UTC day had not turned over yet.
    const snoozeUntil = addUtcDays(userToday(timezoneOffset), days);

    await prisma.scheduledTransactionLog.create({
      data: {
        scheduledTransactionId: bill.id,
        dueDate,
        status: "SNOOZED",
        actionDate: new Date(),
        snoozeUntil,
      },
    });

    // Deliberately does NOT advance nextDueDate: a snooze defers the reminder, it does not settle
    // the occurrence.
    return {
      ok: true,
      action,
      billId,
      transactionId: null,
      amountPaid: null,
      nextDueDate: null,
      deactivated: false,
      snoozeUntil,
    };
  }

  // Atomic: log skip + advance bill together.
  const skipped = await prisma.$transaction(async (tx) => {
    const lockedNextDue = await lockBill(tx);
    if (assertStillPermitted && !(await assertStillPermitted(tx))) return "not-permitted" as const;
    if (await alreadySettled(tx)) return "settled" as const;

    await tx.scheduledTransactionLog.create({
      data: {
        scheduledTransactionId: bill.id,
        dueDate,
        status: "SKIPPED",
        actionDate: new Date(),
      },
    });

    const nextDue = await resolveNextDueDate(tx, lockedNextDue);
    await applyNextDue(tx, nextDue);

    return { nextDue };
  }, SETTLE_TX_OPTIONS);

  if (skipped === "settled") return { ok: false, reason: "ALREADY_SETTLED" };
  if (skipped === "not-permitted") return { ok: false, reason: "NO_LONGER_PERMITTED" };

  return {
    ok: true,
    action,
    billId,
    transactionId: null,
    amountPaid: null,
    nextDueDate: skipped.nextDue,
    deactivated: skipped.nextDue === null,
    snoozeUntil: null,
  };
};

/* ------------------------------------------------------------------ */
/*  Defining a bill: create and patch                                  */
/* ------------------------------------------------------------------ */

/** What every bill row is fetched with, so the app and MCP see the same shape. */
export const BILL_INCLUDE = { category: true, labels: { include: { label: true } } } as const;

export type BillWithRelations = Prisma.ScheduledTransactionGetPayload<{
  include: typeof BILL_INCLUDE;
}>;

export type BillWriteFailureReason =
  /** No bill with that id on this account. */
  | "BILL_NOT_FOUND"
  /** The category is neither a default nor the caller's, or its type does not match the bill's. */
  | "CATEGORY_NOT_USABLE"
  /** A label id was not the caller's. */
  | "LABELS_NOT_OWNED"
  /** CUSTOM without an interval, or an end date before the start date. */
  | "INVALID_SCHEDULE"
  /** A patch that names nothing to change. */
  | "NO_FIELDS"
  /** The write lease lapsed between the request arriving and the write. Nothing was written. */
  | "NO_LONGER_PERMITTED";

/** A label the caller does not get, and why. Reported rather than dropped in silence: `changed`
 *  shows a label leaving but never why, and an unexplained disappearance reads as a bug. */
export interface DroppedBillLabel {
  labelId: string;
  name: string | null;
  reason: "TYPE_MISMATCH";
}

export interface BillWriteSuccess {
  ok: true;
  bill: BillWithRelations;
  /** Fields whose stored value actually moved. Empty for a create, where everything is new. */
  changed: string[];
  droppedLabels: DroppedBillLabel[];
}

export type BillWriteResult = BillWriteSuccess | { ok: false; reason: BillWriteFailureReason };

/** The fields that define a bill, independent of who is setting them. */
export interface BillDefinition {
  amount: number;
  description: string;
  type: TransactionType;
  categoryId: string;
  frequency: BillFrequency;
  customIntervalDays: number | null;
  reminderDaysBefore: number;
  isVariable: boolean;
  /** A calendar day at UTC midnight. Bill dates are date-only values, never instants. */
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
}

/** Every field of a `BillDefinition` is optional in a patch, plus the labels to replace. */
export type BillPatch = Partial<BillDefinition> & { labelIds?: string[] };

/**
 * Resolve the labels a bill may carry, type-filtered against the bill's *effective* type.
 *
 * Same rule as the transaction write path: ownership is a refusal, an incompatible type is a
 * report. A label whose `applicableTo` excludes the bill's type is neither applied nor an error --
 * silently writing nothing is what made a receipt review promise a label and then not write it.
 */
const resolveBillLabels = async (
  prisma: PrismaClient,
  userId: string,
  labelIds: string[],
  type: TransactionType,
): Promise<{ ok: false } | { ok: true; ids: string[]; dropped: DroppedBillLabel[] }> => {
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return { ok: true, ids: [], dropped: [] };

  const owned = await prisma.label.findMany({
    where: { id: { in: unique }, userId },
    select: { id: true, name: true, applicableTo: true },
  });
  if (owned.length !== unique.length) return { ok: false };

  const ids: string[] = [];
  const dropped: DroppedBillLabel[] = [];
  for (const label of owned) {
    if (label.applicableTo === "BOTH" || label.applicableTo === type) ids.push(label.id);
    else dropped.push({ labelId: label.id, name: label.name, reason: "TYPE_MISMATCH" });
  }
  return { ok: true, ids, dropped };
};

/** CUSTOM needs an interval, and an end date cannot precede the start. Checked against the
 *  *effective* row rather than the patch, so flipping frequency to CUSTOM without supplying an
 *  interval is caught even though nothing about `customIntervalDays` looks wrong on its own. */
const scheduleIsValid = (d: BillDefinition): boolean => {
  if (d.frequency === "CUSTOM" && (d.customIntervalDays == null || d.customIntervalDays < 1)) {
    return false;
  }
  if (d.endDate && d.endDate.getTime() < d.startDate.getTime()) return false;
  return true;
};

/**
 * Where the schedule should point after its shape changed.
 *
 * Walks forward from the new `startDate` past any terminal log, so payment progress survives an
 * edit. Editing a bill used to reset `nextDueDate` outright, which resurrected occurrences that
 * had already been paid.
 */
const recalculateNextDueDate = async (
  prisma: PrismaClient,
  billId: string,
  d: BillDefinition,
): Promise<Date | null> => {
  const logs = await prisma.scheduledTransactionLog.findMany({
    where: { scheduledTransactionId: billId },
    select: { dueDate: true, status: true },
  });

  return advanceToNextUnpaidOccurrence(
    d.startDate,
    d.frequency,
    d.startDate.getUTCDate(),
    d.customIntervalDays,
    logs,
    { endDate: d.endDate, maxIterations: WALK_BUDGET },
  );
};

export interface CreateBillParams {
  prisma: PrismaClient;
  userId: string;
  input: BillDefinition;
  labelIds?: string[];
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/**
 * Create a recurring bill.
 *
 * The category check is new relative to the route this replaces, which trusted whatever
 * `categoryId` it was handed. That was survivable while the only caller was the app's own form,
 * which can offer nothing but the user's own categories; it is not survivable for a tool a model
 * calls with an id it inferred. Reuses `categoriesAreUsable` so "usable" means the same thing for
 * a bill as it does for a transaction: a default or the caller's own, and of the matching type.
 */
export const createBill = async ({
  prisma,
  userId,
  input,
  labelIds,
  assertStillPermitted,
}: CreateBillParams): Promise<BillWriteResult> => {
  if (!scheduleIsValid(input)) return { ok: false, reason: "INVALID_SCHEDULE" };

  const usable = await categoriesAreUsable(prisma, userId, [
    { categoryId: input.categoryId, type: input.type },
  ]);
  if (!usable) return { ok: false, reason: "CATEGORY_NOT_USABLE" };

  const labels = await resolveBillLabels(prisma, userId, labelIds ?? [], input.type);
  if (!labels.ok) return { ok: false, reason: "LABELS_NOT_OWNED" };

  const created = await prisma.$transaction(async (tx) => {
    if (assertStillPermitted && !(await assertStillPermitted(tx))) return null;

    return tx.scheduledTransaction.create({
      data: {
        amount: input.amount,
        isVariable: input.isVariable,
        description: input.description,
        type: input.type,
        frequency: input.frequency,
        customIntervalDays: input.customIntervalDays,
        reminderDaysBefore: input.reminderDaysBefore,
        startDate: input.startDate,
        endDate: input.endDate,
        // A new bill's first occurrence is its start date. Nothing has been settled yet, so there
        // is nothing to walk past.
        nextDueDate: input.startDate,
        isActive: input.isActive,
        categoryId: input.categoryId,
        userId,
        ...(labels.ids.length > 0 && {
          labels: { create: labels.ids.map((labelId) => ({ labelId })) },
        }),
      },
      include: BILL_INCLUDE,
    });
  });

  if (created === null) return { ok: false, reason: "NO_LONGER_PERMITTED" };

  return { ok: true, bill: created, changed: [], droppedLabels: labels.dropped };
};

export interface UpdateBillParams {
  prisma: PrismaClient;
  userId: string;
  billId: string;
  patch: BillPatch;
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/**
 * Change an existing bill, merging a patch over what is stored.
 *
 * A *patch*, not the full replacement `PUT /api/bills/[id]` takes, and deliberately so: "PLDT went
 * up to 1,900" is one field, and a tool demanding every other field back would lose whichever one
 * the caller failed to echo. That is also why this is not wired into the PUT route -- there, an
 * absent `endDate` means "cleared" while an absent `labelIds` means "leave alone", two readings of
 * the same absence that one function cannot hold at once.
 *
 * Every check runs against the **effective** row -- the patch merged over what is stored -- never
 * against the patch alone. A bare `type` flip is the case that motivates it: `categoryId` is
 * absent, so nothing about it looks wrong, and the bill would end up an income bill filed under a
 * food category, distorting every breakdown that groups by one.
 */
export const updateBill = async ({
  prisma,
  userId,
  billId,
  patch,
  assertStillPermitted,
}: UpdateBillParams): Promise<BillWriteResult> => {
  const stored = await prisma.scheduledTransaction.findUnique({
    where: { id: billId },
    include: BILL_INCLUDE,
  });
  if (!stored || stored.userId !== userId) return { ok: false, reason: "BILL_NOT_FOUND" };

  const named = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (named.length === 0) return { ok: false, reason: "NO_FIELDS" };

  const current: BillDefinition = {
    amount: stored.amount,
    description: stored.description,
    type: stored.type,
    categoryId: stored.categoryId,
    frequency: stored.frequency,
    customIntervalDays: stored.customIntervalDays,
    reminderDaysBefore: stored.reminderDaysBefore,
    isVariable: stored.isVariable,
    startDate: stored.startDate,
    endDate: stored.endDate,
    isActive: stored.isActive,
  };

  const effective: BillDefinition = {
    ...current,
    ...Object.fromEntries(named.filter(([key]) => key !== "labelIds")),
  };

  if (!scheduleIsValid(effective)) return { ok: false, reason: "INVALID_SCHEDULE" };

  // Only when the pair actually moves. Judging an unchanged pair prevents nothing -- re-sending it
  // writes what is already there -- and would lock the caller out of bills that were *already*
  // mismatched, which is reachable with no MCP involvement: `PUT /api/categories/[id]` lets a
  // custom category's type be flipped under the rows that use it.
  const categoryPairMoved =
    effective.categoryId !== current.categoryId || effective.type !== current.type;
  if (categoryPairMoved) {
    const usable = await categoriesAreUsable(prisma, userId, [
      { categoryId: effective.categoryId, type: effective.type },
    ]);
    if (!usable) return { ok: false, reason: "CATEGORY_NOT_USABLE" };
  }

  // Omitting `labelIds` preserves what is there, dropping only what the effective type now
  // excludes. Passing `[]` clears them. Same rule as `updateTransactions`.
  const requestedLabelIds = patch.labelIds ?? stored.labels.map((bl) => bl.labelId);
  const labels = await resolveBillLabels(prisma, userId, requestedLabelIds, effective.type);
  if (!labels.ok) return { ok: false, reason: "LABELS_NOT_OWNED" };

  const before = stored.labels.map((bl) => bl.labelId).sort();
  const after = [...labels.ids].sort();
  const labelsMoved = before.length !== after.length || before.some((id, i) => id !== after[i]);

  // The schedule's *shape* changed, so where it points has to be re-derived. A changed amount or
  // description does not move a due date and must not trigger a walk.
  const shapeMoved =
    effective.frequency !== current.frequency ||
    effective.customIntervalDays !== current.customIntervalDays ||
    effective.startDate.getTime() !== current.startDate.getTime();

  const recalculated = shapeMoved ? await recalculateNextDueDate(prisma, billId, effective) : null;

  // Reactivating resets a due date left in the past, or the bill returns already overdue. "Today"
  // is the *user's* calendar day: between their midnight and UTC's, a plain UTC today is still
  // yesterday.
  const reactivating = effective.isActive && !current.isActive;
  let reactivatedNextDue: Date | null = null;
  if (reactivating) {
    const { timezoneOffset } = (await prisma.user.findUnique({
      where: { id: userId },
      select: { timezoneOffset: true },
    })) ?? { timezoneOffset: 0 };
    const today = userToday(timezoneOffset ?? 0);
    const from = recalculated ?? stored.nextDueDate;
    reactivatedNextDue = from < today ? today : from;
  }

  const changed = (Object.keys(current) as (keyof BillDefinition)[]).filter((key) => {
    const was = current[key];
    const now = effective[key];
    if (was instanceof Date || now instanceof Date) {
      return (was as Date | null)?.getTime() !== (now as Date | null)?.getTime();
    }
    return was !== now;
  }) as string[];
  if (labelsMoved) changed.push("labels");

  const updated = await prisma.$transaction(async (tx) => {
    if (assertStillPermitted && !(await assertStillPermitted(tx))) return null;

    await tx.scheduledTransaction.update({
      where: { id: billId },
      data: {
        amount: effective.amount,
        isVariable: effective.isVariable,
        description: effective.description,
        type: effective.type,
        frequency: effective.frequency,
        customIntervalDays: effective.customIntervalDays,
        reminderDaysBefore: effective.reminderDaysBefore,
        startDate: effective.startDate,
        endDate: effective.endDate,
        categoryId: effective.categoryId,
        // A walk that finds nothing left means the schedule has run out, which switches the bill
        // off -- unless this same patch is switching it back on, where the reactivation rule wins.
        isActive: reactivating ? true : shapeMoved && !recalculated ? false : effective.isActive,
        ...(reactivatedNextDue && { nextDueDate: reactivatedNextDue }),
        ...(!reactivating && shapeMoved && recalculated && { nextDueDate: recalculated }),
      },
    });

    if (labelsMoved) {
      await tx.billLabel.deleteMany({ where: { scheduledTransactionId: billId } });
      if (labels.ids.length > 0) {
        await tx.billLabel.createMany({
          data: labels.ids.map((labelId) => ({ scheduledTransactionId: billId, labelId })),
        });
      }
    }

    return tx.scheduledTransaction.findUniqueOrThrow({
      where: { id: billId },
      include: BILL_INCLUDE,
    });
  });

  if (updated === null) return { ok: false, reason: "NO_LONGER_PERMITTED" };

  return { ok: true, bill: updated, changed, droppedLabels: labels.dropped };
};
