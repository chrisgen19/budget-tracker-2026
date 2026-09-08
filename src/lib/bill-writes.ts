import {
  Prisma,
  type BillFrequency,
  type TransactionSource,
  type TransactionType,
} from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import {
  advanceToNextUnpaidOccurrence,
  computeNextDueDate,
  settledStatusesFor,
} from "@/lib/bill-utils";
import { addUtcDays, userToday, utcDayStart } from "@/lib/bill-dates";
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

/**
 * How far from its due date a payment may sit and still settle an occurrence.
 *
 * Shared with `GET /api/bills/[id]/candidates`, which offers the browser its shortlist. The two
 * disagreeing is the whole hazard: the list would hide a payment the write then happily accepted,
 * or offer one it refused.
 */
export const PAYMENT_WINDOW_DAYS = 14;

/**
 * The instants bounding a payment window around a due date, in the user's own calendar days.
 *
 * A due date is date-only at UTC midnight; a transaction's `date` is an *instant*. Under UTC+8 a
 * payment made at 00:30 on the boundary day is stored on the previous UTC date, so a window built
 * from UTC days drops it. One formula app-wide: `Date.UTC(y, m, d) + tzOffset * 60000`.
 */
export const paymentWindow = (
  dueDate: Date,
  timezoneOffset: number,
  windowDays = PAYMENT_WINDOW_DAYS,
): { start: Date; dueDayStart: Date; end: Date } => {
  const due = utcDayStart(dueDate);
  const y = due.getUTCFullYear();
  const mo = due.getUTCMonth();
  const d = due.getUTCDate();
  // Date.UTC normalises day over- and underflow, so the offsets need no clamping.
  const localDayStart = (offsetDays: number) =>
    new Date(Date.UTC(y, mo, d + offsetDays) + timezoneOffset * 60_000);

  return {
    start: localDayStart(-windowDays),
    dueDayStart: localDayStart(0),
    // Inclusive of the whole last day, or the window silently loses it.
    end: new Date(localDayStart(windowDays + 1).getTime() - 1),
  };
};

export type BillActionKind = "pay" | "pay_existing" | "skip" | "snooze";

export type BillActionFailureReason =
  /** No bill with that id on this account. */
  | "BILL_NOT_FOUND"
  /** The date given is not an occurrence this bill's schedule ever produced. */
  | "NOT_AN_OCCURRENCE"
  /** This occurrence already carries a terminal log, so acting again would settle it twice. */
  | "ALREADY_SETTLED"
  /** A variable bill was paid without saying what was actually paid. */
  | "AMOUNT_REQUIRED"
  /** `pay_existing` named a transaction that is not this user's. */
  | "TRANSACTION_NOT_FOUND"
  /** `pay_existing` named a transaction of the wrong type for this bill. */
  | "TRANSACTION_TYPE_MISMATCH"
  /** `pay_existing` named a payment too far from the due date to be settling it. */
  | "TRANSACTION_OUTSIDE_WINDOW"
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
  /**
   * Things worth relaying that are not refusals.
   *
   * The one that matters is a `pay_existing` whose payment sits in a different category from the
   * bill. Refusing it would be wrong -- a miscategorised payment is exactly the mess this action
   * exists to clean up, and `GET /api/bills/[id]/candidates` deliberately hides those from its
   * shortlist, so the only way to attach one is by naming its id. But settling a Meralco
   * occurrence with a row filed under Groceries is also how the wrong row gets linked, and there
   * is no unlink anywhere in the app. So it is written, and said.
   */
  warnings: string[];
  /** True when this action found the work already done and wrote nothing. A retry after a lost
   *  response lands here rather than snoozing the occurrence a second time. */
  replayed: boolean;
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
  /**
   * The surface acting. Follows the credential, never the endpoint.
   *
   * Stamped as `created_via` on the transaction `pay` creates, and as `updated_via` on the one
   * `pay_existing` claims -- attaching a payment writes `billId` onto a row that already exists,
   * which is an edit and has to name its author (#256). Omitting it means the app.
   */
  createdVia?: TransactionSource;
  mcpTokenId?: string;
  /**
   * Re-checked inside the transaction, so switching writes off stops work already in flight rather
   * than only refusing the next request. Omitted by the app, which has no lease.
   */
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/**
 * Whether a date is one this bill's schedule actually produces.
 *
 * Walked from `startDate` rather than computed modularly, because `computeNextDueDate` clamps to
 * month length: a bill starting on the 31st falls on the 30th in November and the 28th in
 * February, and no arithmetic on the day-of-month gets that right.
 *
 * The walk stops as soon as it passes the target, so an ordinary monthly bill costs a handful of
 * iterations. `WALK_BUDGET` bounds a daily bill started decades ago.
 */
const isScheduledOccurrence = (
  bill: {
    startDate: Date;
    nextDueDate: Date;
    frequency: BillFrequency;
    customIntervalDays: number | null;
    endDate: Date | null;
  },
  dueDate: Date,
): boolean => {
  const target = utcDayStart(dueDate).getTime();

  /**
   * The bill's own cursor is settleable whatever the recurrence says.
   *
   * `nextDueDate` is not always on the recurrence: reactivating a bill sets it to the user's today
   * so it does not come back already overdue, and `PATCH /api/bills/[id]` has done exactly that on
   * live rows for as long as it has existed. Every reader -- `getUpcomingBills`, the reminder mail,
   * the bills page -- advertises that date as the one that is due. Refusing to settle the date the
   * whole app is asking the user to settle is incoherent, and it would have turned this check into
   * a 400 on a button that works today.
   *
   * Not a hole in the check: this is read off the stored row, so a caller cannot name a date that
   * makes it pass. It admits exactly one extra day, the one already being advertised.
   */

  if (utcDayStart(bill.nextDueDate).getTime() === target) return true;

  const originalStartDay = bill.startDate.getUTCDate();
  let candidate = utcDayStart(bill.startDate);

  for (let i = 0; i < WALK_BUDGET; i++) {
    const ms = candidate.getTime();
    // The end date is tested *before* the equality, not after. The other way round, a candidate
    // that is exactly one step past `endDate` matched the target and returned true without the end
    // date ever being consulted -- so the February occurrence of a bill that ended in January could
    // be paid or skipped, writing history for a month the schedule never produced.
    if (bill.endDate && candidate > bill.endDate) return false;
    if (ms === target) return true;
    if (ms > target) return false;
    candidate = utcDayStart(
      computeNextDueDate(candidate, bill.frequency, originalStartDay, bill.customIntervalDays),
    );
  }

  return false;
};

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
  // The surface performing this action. `createdVia` names the caller rather than the verb, so it
  // stamps `created_via` on the row `pay` creates and `updated_via` on the row `pay_existing`
  // claims. Falling back to APP mirrors the column's own default, which the create path already
  // relies on: a caller that names no source is the app, since every remote one derives its source
  // from the credential and always passes it.
  const actingVia: TransactionSource = createdVia ?? "APP";

  const bill = await prisma.scheduledTransaction.findUnique({
    where: { id: billId },
    include: { category: true, labels: { include: { label: true } } },
  });

  if (!bill || bill.userId !== userId) return { ok: false, reason: "BILL_NOT_FOUND" };

  const originalStartDay = bill.startDate.getUTCDate();

  /**
   * Every log this occurrence already carries.
   *
   * Read for one question only: whether this date is an occurrence at all, where a date the
   * schedule no longer produces is still settleable if it was settled under an older one. That
   * answer cannot change under a concurrent write, so it needs no lock.
   *
   * Everything that decides whether to *write* -- the double-settle guard, the snooze replay --
   * re-reads inside its own transaction behind the row lock, where the answer has to be race-free.
   */
  const existingLogs = await prisma.scheduledTransactionLog.findMany({
    where: { scheduledTransactionId: bill.id, dueDate },
    select: { status: true, snoozeUntil: true },
  });

  /**
   * The date has to name an occurrence this schedule actually produces.
   *
   * Nothing checked this before: `billActionSchema` asks only for a non-empty string, and the MCP
   * layer only asks for a real calendar date. A mistyped or model-invented day therefore wrote a
   * transaction and a PAID log against an occurrence that does not exist -- and because the walk
   * matches candidates by exact timestamp, the phantom log matched nothing, `nextDueDate` never
   * moved, and the reminder kept firing. That is precisely the failure this whole tool exists to
   * prevent, arriving through the front door.
   *
   * A date that already carries a log is accepted regardless. Editing a bill's `startDate` moves
   * the recurrence out from under occurrences that were genuinely settled under the old one, and
   * refusing to act on those would make history unreachable rather than safe.
   */
  if (existingLogs.length === 0 && !isScheduledOccurrence(bill, dueDate)) {
    return { ok: false, reason: "NOT_AN_OCCURRENCE" };
  }

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
      warnings: [],
      replayed: false,
    };
  }

  if (action === "pay_existing") {
    // Verify the target transaction belongs to the authenticated user.
    const existingTx = await prisma.transaction.findFirst({
      where: { id: existingTransactionId ?? "", userId },
      select: { id: true, amount: true, type: true, categoryId: true, date: true },
    });
    if (!existingTx) return { ok: false, reason: "TRANSACTION_NOT_FOUND" };

    /**
     * Ownership alone was the whole check, and it is not enough.
     *
     * `GET /api/bills/[id]/candidates` narrows the browser's shortlist to the bill's type, its
     * category and a fortnight either side of the due date, but that is a *listing*: this write
     * accepted any unlinked row the user happened to own. A human picking from a filtered list
     * could not reach the bad cases; a model naming an id can, and there is no unlink anywhere in
     * the app, so a wrong link is permanent.
     *
     * Type and window are refusals. An income row cannot settle an expense bill under any reading,
     * and a payment two months from the due date is not settling this occurrence.
     */
    if (existingTx.type !== bill.type) {
      return { ok: false, reason: "TRANSACTION_TYPE_MISMATCH" };
    }

    const window = paymentWindow(dueDate, timezoneOffset);
    if (existingTx.date < window.start || existingTx.date > window.end) {
      return { ok: false, reason: "TRANSACTION_OUTSIDE_WINDOW" };
    }

    /**
     * A category mismatch is reported, never refused.
     *
     * The candidates route hides a miscategorised payment from its shortlist and says why: a short
     * list that can be read beats a long one that cannot. But hiding it there makes naming its id
     * the *only* way to attach it, and a payment filed under the wrong category is exactly the
     * mess `pay_existing` exists to clean up. Refusing it here would turn a deliberate display
     * trade-off into a permanent inability to correct the record.
     */
    const warnings: string[] =
      existingTx.categoryId === bill.categoryId
        ? []
        : [
            `The payment is filed under a different category from the bill (${bill.category.name}). ` +
              "It was linked anyway, since a miscategorised payment is still a real one, but check " +
              "it is the row you meant: nothing in the app can unlink it afterwards.",
          ];

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
      //
      // Attaching a payment writes `billId` onto a row that already exists, so it is an edit and
      // names the surface that made it (#256). Without this a row corrected over MCP and then
      // linked from the app went on naming the token as its last editor -- the confidently wrong
      // trail #232 exists to prevent, and worse here than on an ordinary edit: this settles an
      // occurrence, advances the schedule cursor, and nothing in the app can unlink it afterwards.
      //
      // The `billId: null` predicate already restricts this to the row actually claimed, so the
      // "stamp only what moved" rule the app's edit paths had to engineer comes free. The token id
      // is cleared rather than left when the caller is not a token, for the same reason it is
      // everywhere else: a stale id is not a gap in the trail but a wrong answer.
      const claim = await tx.transaction.updateMany({
        where: { id: existingTx.id, userId, billId: null },
        data: {
          billId: bill.id,
          updatedVia: actingVia,
          updatedByMcpTokenId: mcpTokenId ?? null,
        },
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
      warnings,
      replayed: false,
    };
  }

  if (action === "snooze") {
    const days = snoozeDays ?? 1;
    const today = userToday(timezoneOffset);
    // The user's own day, N days on, stored at UTC midnight the way a due date is. Readers
    // therefore take it as date-only and must not convert it back through an offset. Computed from
    // `new Date()` alone, a snooze started at 02:00 in Manila expired the same morning, because
    // the UTC day had not turned over yet.
    const snoozeUntil = addUtcDays(today, days);

    /**
     * A live snooze on this occurrence is the answer, not a reason to write another.
     *
     * Every other action here is guarded by its terminal log, which is what lets `pay_bill` claim
     * `idempotentHint`. Snooze had no guard at all: a retry after a lost response wrote a second
     * SNOOZED row, and one sent on a later calendar day also pushed `snoozeUntil` further out --
     * so the same call twice produced a different state, which is exactly what that annotation
     * promises it will not.
     *
     * Scoped to a snooze that has not yet lapsed. Re-snoozing an occurrence whose deferral has
     * expired is a fresh decision the user is entitled to make, and collapsing it into the old one
     * would silently refuse them.
     */
    const liveSnooze = (logs: { status: string; snoozeUntil: Date | null }[]) =>
      logs.find(
        (log) => log.status === "SNOOZED" && log.snoozeUntil !== null && log.snoozeUntil > today,
      )?.snoozeUntil ?? null;

    // In a transaction for the lease re-check every other branch performs, and for the row lock
    // that makes the guard above race-free. Read outside a transaction the check is only advisory:
    // two overlapping retries both see no live snooze before either insert commits, and both write
    // one. The lock is the transaction's FIRST statement, as everywhere else here -- the log insert
    // takes FOR KEY SHARE through its foreign key, so upgrading to FOR UPDATE afterwards deadlocks.
    const deferred = await prisma.$transaction(async (tx) => {
      await lockBill(tx);
      if (assertStillPermitted && !(await assertStillPermitted(tx))) return "not-permitted" as const;

      const alreadyDeferred = liveSnooze(
        await tx.scheduledTransactionLog.findMany({
          where: { scheduledTransactionId: bill.id, dueDate },
          select: { status: true, snoozeUntil: true },
        }),
      );
      if (alreadyDeferred) return { replayedUntil: alreadyDeferred };

      await tx.scheduledTransactionLog.create({
        data: {
          scheduledTransactionId: bill.id,
          dueDate,
          status: "SNOOZED",
          actionDate: new Date(),
          snoozeUntil,
        },
      });

      return "ok" as const;
    }, SETTLE_TX_OPTIONS);

    if (deferred === "not-permitted") return { ok: false, reason: "NO_LONGER_PERMITTED" };

    if (typeof deferred === "object") {
      return {
        ok: true,
        action,
        billId,
        transactionId: null,
        amountPaid: null,
        nextDueDate: null,
        deactivated: false,
        snoozeUntil: deferred.replayedUntil,
        warnings: [],
        replayed: true,
      };
    }

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
      warnings: [],
      replayed: false,
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
    warnings: [],
    replayed: false,
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
  /**
   * True when this edit left the schedule with nothing valid to be due, so the bill was switched
   * off as a *consequence* rather than because the caller asked.
   *
   * Not visible in `changed`, which compares the patch against the stored row: pulling an end date
   * back before the cursor moves `endDate`, never `isActive`, so a caller reading `changed` alone
   * would never learn the bill had stopped.
   */
  deactivated: boolean;
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
/**
 * The first day the schedule falls on at or after `from`, or null when the end date passes first.
 *
 * Used when a bill is switched back on. Assigning the user's today directly is what a reactivation
 * used to do, and it puts the cursor on a day the recurrence never produces: a monthly bill due on
 * the 5th, reactivated on the 7th, advertised the 7th while `settleBill` walked the recurrence and
 * refused that same date. Active again, and its advertised occurrence unpayable.
 */
const firstOccurrenceOnOrAfter = (
  bill: {
    startDate: Date;
    frequency: BillFrequency;
    customIntervalDays: number | null;
    endDate: Date | null;
  },
  from: Date,
): Date | null => {
  const target = utcDayStart(from).getTime();
  const originalStartDay = bill.startDate.getUTCDate();
  let candidate = utcDayStart(bill.startDate);

  for (let i = 0; i < WALK_BUDGET; i++) {
    if (bill.endDate && candidate > bill.endDate) return null;
    if (candidate.getTime() >= target) return candidate;
    candidate = utcDayStart(
      computeNextDueDate(candidate, bill.frequency, originalStartDay, bill.customIntervalDays),
    );
  }

  return null;
};

/**
 * Take the bill row's write lock. Must be the transaction's FIRST statement.
 *
 * The updates and inserts that follow reference this row, so Postgres takes FOR KEY SHARE on it
 * through those foreign keys; two transactions both holding KEY SHARE and then upgrading to
 * FOR UPDATE deadlock, and one rolls back with a 500.
 */
export const lockBillRow = async (tx: Prisma.TransactionClient, billId: string): Promise<void> => {
  await tx.$queryRaw`SELECT id FROM scheduled_transactions WHERE id = ${billId} FOR UPDATE`;
};

const recalculateNextDueDate = async (
  tx: Prisma.TransactionClient,
  billId: string,
  d: BillDefinition,
): Promise<Date | null> => {
  const logs = await tx.scheduledTransactionLog.findMany({
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

  return { ok: true, bill: created, changed: [], droppedLabels: labels.dropped, deactivated: false };
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

  // The schedule's *shape* changed, so where it points has to be re-derived from the start date. A
  // changed amount or description does not move a due date and must not trigger a walk.
  const shapeMoved =
    effective.frequency !== current.frequency ||
    effective.customIntervalDays !== current.customIntervalDays ||
    effective.startDate.getTime() !== current.startDate.getTime();

  /**
   * An end date is deliberately *not* part of `shapeMoved`.
   *
   * Moving it does not change where the recurrence falls, only where it stops, so re-walking from
   * `startDate` would rewrite a cursor that is already correct -- and the walk only skips terminal
   * logs, so a bill whose cursor sits ahead for any other reason would be dragged backwards by an
   * edit that had nothing to do with it.
   *
   * What an end date *can* do is leave the cursor pointing past the schedule's own end. Nothing
   * downstream filters on `endDate` -- `getUpcomingBills`, `/api/bills/upcoming` and
   * `pending-bills.ts` all select on `isActive` alone -- so such a bill showed as permanently
   * overdue and kept mailing reminders until somebody settled it by hand.
   */
  const endDateMoved =
    (effective.endDate?.getTime() ?? null) !== (current.endDate?.getTime() ?? null);

  const reactivating = effective.isActive && !current.isActive;

  // Read outside the transaction: it depends on the user row, not the bill, so nothing a
  // concurrent settlement does can change it.
  const { timezoneOffset } = (await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  })) ?? { timezoneOffset: 0 };

  /**
   * Everything the schedule decides, derived **under the bill's row lock**.
   *
   * The walk reads occurrence logs and the stored cursor, and the update writes that cursor back.
   * Computed before the transaction it was a read-then-write across an unlocked gap: a `pay_bill`
   * committing in between writes a terminal log and advances the cursor, then this stale value puts
   * it back on the occurrence that was just settled -- which `alreadySettled` then refuses for
   * ever, with reminders stuck on it and only another edit able to shift it.
   */
  const deriveSchedule = async (tx: Prisma.TransactionClient) => {
    const recalculated = shapeMoved
      ? await recalculateNextDueDate(tx, billId, effective)
      : null;

    const cursor = shapeMoved ? recalculated : stored.nextDueDate;
    const ranOut = cursor === null || (effective.endDate !== null && cursor > effective.endDate);

    // Reactivating resets a due date left in the past, or the bill returns already overdue.
    // "Today" is the *user's* calendar day: between their midnight and UTC's, a plain UTC today is
    // still yesterday.
    //
    // The reset lands on the next day the schedule actually falls on, not on today itself. Today
    // is an arbitrary calendar day: a monthly bill due on the 5th and switched back on the 7th
    // would advertise the 7th, and `settleBill` walks the recurrence and refuses it -- active
    // again, with an occurrence nobody can pay, skip or snooze.
    let reactivatedNextDue: Date | null = null;
    if (reactivating) {
      const today = userToday(timezoneOffset ?? 0);
      const from = recalculated ?? stored.nextDueDate;
      const resumeAt = from < today ? firstOccurrenceOnOrAfter(effective, today) : from;
      // A cursor already in the future was taken unchecked, which one patch could exploit by hand:
      // `{ isActive: true, endDate: <before that cursor> }` reactivated the bill past its own end,
      // because the reactivation branch wins over `ranOut`. The end date applies to the day the
      // bill resumes on however that day was chosen.
      reactivatedNextDue =
        resumeAt !== null && effective.endDate !== null && resumeAt > effective.endDate
          ? null
          : resumeAt;
    }

    // Nothing left to be due, so there is nothing to switch back on. Reported through
    // `deactivated` rather than refused: the patch may carry other fields that applied fine.
    return { recalculated, ranOut, reactivatedNextDue, failed: reactivating && reactivatedNextDue === null };
  };

  const changed = (Object.keys(current) as (keyof BillDefinition)[]).filter((key) => {
    const was = current[key];
    const now = effective[key];
    if (was instanceof Date || now instanceof Date) {
      return (was as Date | null)?.getTime() !== (now as Date | null)?.getTime();
    }
    return was !== now;
  }) as string[];
  if (labelsMoved) changed.push("labels");

  const written = await prisma.$transaction(async (tx) => {
    // First statement, as everywhere else here: the update below takes FOR KEY SHARE through its
    // foreign keys, so upgrading to FOR UPDATE afterwards deadlocks. It also serialises this whole
    // edit against `settleBill`, which is what the derivation needs to be sound.
    await lockBillRow(tx, billId);
    if (assertStillPermitted && !(await assertStillPermitted(tx))) return null;

    const schedule = await deriveSchedule(tx);
    const { recalculated, ranOut, reactivatedNextDue, failed: reactivationFailed } = schedule;

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
        // Nothing valid left to be due means the schedule has run out, which switches the bill off
        // -- unless this same patch is switching it back on, where the reactivation rule wins.
        isActive: reactivationFailed ? false : reactivating ? true : ranOut ? false : effective.isActive,
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

    const bill = await tx.scheduledTransaction.findUniqueOrThrow({
      where: { id: billId },
      include: BILL_INCLUDE,
    });

    return { bill, reactivationFailed, ranOut };
  });

  if (written === null) return { ok: false, reason: "NO_LONGER_PERMITTED" };

  return {
    ok: true,
    bill: written.bill,
    // The patch asked for `isActive: true` and the schedule had nothing left to give, so the row
    // did not move. `changed` describes what was written, never what was requested.
    changed: written.reactivationFailed ? changed.filter((f) => f !== "isActive") : changed,
    droppedLabels: labels.dropped,
    deactivated:
      written.reactivationFailed || (!reactivating && written.ranOut && current.isActive),
  };
};
