import { describe, it, expect, vi } from "vitest";
import { settleBill, createBill, updateBill } from "./bill-writes";
import type { PrismaClient } from "./budget-query-types";

const scheduleMock = vi.hoisted(() => ({
  getScheduleContext: vi.fn(async (): Promise<unknown> => null),
  matchScheduledLabel: vi.fn((): string | null => null),
}));

vi.mock("@/lib/schedule-server", () => scheduleMock);

/** A calendar day at UTC midnight, which is how every bill date is stored. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface BillRow {
  id: string;
  userId: string;
  description: string;
  amount: number;
  isVariable: boolean;
  type: "INCOME" | "EXPENSE";
  categoryId: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "ANNUALLY" | "CUSTOM";
  customIntervalDays: number | null;
  reminderDaysBefore: number;
  startDate: Date;
  nextDueDate: Date;
  endDate: Date | null;
  isActive: boolean;
}

const BILL: BillRow = {
  id: "bill_1",
  userId: "user_1",
  description: "Meralco",
  amount: 5500,
  isVariable: false,
  type: "EXPENSE",
  categoryId: "cat_own",
  frequency: "MONTHLY",
  customIntervalDays: null,
  reminderDaysBefore: 3,
  startDate: day("2026-01-05"),
  nextDueDate: day("2026-09-05"),
  endDate: null,
  isActive: true,
};

interface StubOptions {
  bill?: Partial<BillRow>;
  billLabels?: { labelId: string; label: { id: string; name: string; applicableTo: string } }[];
  /** Logs already on the bill: read by the double-settle guard, the occurrence check and the
   *  snooze replay. */
  logs?: { dueDate: Date; status: "PAID" | "SKIPPED" | "SNOOZED"; snoozeUntil?: Date | null }[];
  ownedLabels?: { id: string; name: string; applicableTo: string }[];
  usableCategoryIds?: string[];
  categoryType?: "INCOME" | "EXPENSE";
  /** How many rows `transaction.updateMany` claims — 0 means the payment already had a bill. */
  claimCount?: number;
  existingTransaction?:
    | { id: string; amount: number; type?: "INCOME" | "EXPENSE"; categoryId?: string; date?: Date }
    | null;
  timezoneOffset?: number;
}

/**
 * Minimal Prisma stub over the calls these three functions make.
 *
 * Records what was written so the assertions can inspect it, and keeps a live `nextDueDate` so a
 * schedule advance is observable rather than assumed.
 */
const makePrisma = (options: StubOptions = {}) => {
  const bill: BillRow = { ...BILL, ...options.bill };
  const billLabels = options.billLabels ?? [];
  const logs: { dueDate: Date; status: "PAID" | "SKIPPED" | "SNOOZED"; snoozeUntil: Date | null }[] =
    (options.logs ?? []).map((l) => ({ snoozeUntil: null, ...l }));
  const written: Record<string, unknown>[] = [];
  const billUpdates: Record<string, unknown>[] = [];
  const logWrites: Record<string, unknown>[] = [];
  const billLabelWrites: Record<string, unknown>[] = [];
  let deletedBillLabels = 0;
  let locks = 0;
  /** Whether each occurrence-log read happened before or after the row lock was taken. */
  const logReads: string[] = [];

  const client = {
    scheduledTransaction: {
      findUnique: vi.fn(async () => ({
        ...bill,
        category: { id: bill.categoryId, name: "Utilities", type: bill.type },
        labels: billLabels,
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        ...bill,
        ...Object.assign({}, ...billUpdates),
        category: { id: bill.categoryId, name: "Utilities", type: bill.type },
        labels: billLabels,
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        written.push(data);
        return {
          ...bill,
          ...data,
          id: "bill_new",
          category: { id: bill.categoryId, name: "Utilities", type: bill.type },
          labels: [],
        };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        billUpdates.push(data);
        return bill;
      }),
    },
    scheduledTransactionLog: {
      findFirst: vi.fn(async ({ where }: { where: { dueDate: Date; status: { in: string[] } } }) => {
        const hit = logs.find(
          (l) => l.dueDate.getTime() === where.dueDate.getTime() && where.status.in.includes(l.status)
        );
        return hit ? { id: "log_existing" } : null;
      }),
      // The occurrence and snooze-replay reads narrow by dueDate; the schedule walk does not.
      findMany: vi.fn(async ({ where }: { where?: { dueDate?: Date } } = {}) => {
        if (!where?.dueDate) logReads.push(locks > 0 ? "after-lock" : "before-lock");
        return where?.dueDate
          ? logs.filter((l) => l.dueDate.getTime() === where.dueDate!.getTime())
          : logs;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        logWrites.push(data);
        logs.push({
          dueDate: data.dueDate as Date,
          status: data.status as "PAID" | "SKIPPED" | "SNOOZED",
          snoozeUntil: (data.snoozeUntil as Date | undefined) ?? null,
        });
        return { id: `log_${logWrites.length}` };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    transaction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        written.push(data);
        return { id: "tx_new", ...data };
      }),
      findFirst: vi.fn(async () =>
        options.existingTransaction
          ? {
              // Defaults describe the ordinary case: the bill's own type and category, paid on the
              // due date. Each is overridden by the tests that probe its guard.
              type: bill.type,
              categoryId: bill.categoryId,
              date: new Date("2026-09-04T10:00:00.000Z"),
              ...options.existingTransaction,
            }
          : null
      ),
      updateMany: vi.fn(async () => ({ count: options.claimCount ?? 1 })),
    },
    category: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => (options.usableCategoryIds ?? ["cat_own"]).includes(id))
          .map((id) => ({ id, type: options.categoryType ?? "EXPENSE" }))
      ),
    },
    label: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        (options.ownedLabels ?? []).filter((l) => where.id.in.includes(l.id))
      ),
    },
    billLabel: {
      deleteMany: vi.fn(async () => {
        deletedBillLabels += 1;
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        billLabelWrites.push(...data);
        return { count: data.length };
      }),
    },
    user: {
      findUnique: vi.fn(async () => ({
        timezoneOffset: options.timezoneOffset ?? -480,
        mcpWritesEnabledUntil: new Date(Date.now() + 60_000),
      })),
    },
    $queryRaw: vi.fn(async () => {
      locks += 1;
      return [{ next_due_date: bill.nextDueDate }];
    }),
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)
    ),
  };

  return {
    client: client as unknown as PrismaClient,
    written,
    billUpdates,
    logWrites,
    billLabelWrites,
    deletedBillLabels: () => deletedBillLabels,
    locks: () => locks,
    logReads: () => logReads,
  };
};

const settle = (client: PrismaClient, overrides: Record<string, unknown> = {}) =>
  settleBill({
    prisma: client,
    userId: "user_1",
    billId: "bill_1",
    action: "pay",
    dueDate: day("2026-09-05"),
    timezoneOffset: -480,
    ...overrides,
  } as Parameters<typeof settleBill>[0]);

describe("settleBill — paying", () => {
  /**
   * The property the whole tool exists for.
   *
   * `create_transactions` cannot set `billId`, so a bill paid over MCP used to leave the schedule
   * un-advanced, the reminder still firing, and the payment later reported by
   * `findUnlinkedBillPayments` as an integrity problem.
   */
  it("links the payment to the bill and advances the schedule", async () => {
    const { client, written, billUpdates } = makePrisma();

    const result = await settle(client);

    expect(result.ok).toBe(true);
    expect(written[0].billId).toBe("bill_1");
    // MONTHLY from a 5 September occurrence.
    expect((billUpdates[0].nextDueDate as Date).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  /**
   * A variable bill's stored amount is a *forecast* fallback, never a claim about what was paid.
   * Writing it would put a guess in the ledger, which the estimator then reads back as history and
   * compounds into every future forecast.
   */
  it("refuses a variable bill with no amount, and writes nothing", async () => {
    const { client, written } = makePrisma({ bill: { isVariable: true } });

    const result = await settle(client);

    expect(result).toEqual({ ok: false, reason: "AMOUNT_REQUIRED" });
    expect(written).toHaveLength(0);
  });

  it("writes the caller's figure for a variable bill", async () => {
    const { client, written } = makePrisma({ bill: { isVariable: true } });

    const result = await settle(client, { amount: 14126 });

    expect(result.ok).toBe(true);
    expect(written[0].amount).toBe(14126);
  });

  /**
   * For a fixed bill the stored amount *is* the asserted payment. Honouring an amount here would
   * let a stale caller write a transaction that silently disagrees with the bill it settles.
   */
  it("ignores a caller's amount on a fixed bill", async () => {
    const { client, written } = makePrisma();

    await settle(client, { amount: 99 });

    expect(written[0].amount).toBe(5500);
  });

  /** Provenance follows the credential, not the endpoint. */
  it("stamps the configured source and token onto the payment", async () => {
    const { client, written } = makePrisma();

    await settle(client, { createdVia: "TELEGRAM", mcpTokenId: "tok_1" });

    expect(written[0].createdVia).toBe("TELEGRAM");
    expect(written[0].mcpTokenId).toBe("tok_1");
  });

  /** There is no unique constraint on (bill, dueDate), so this guard is the only thing standing
   *  between a resubmit and a second payment for the same month. */
  it("refuses an occurrence that already has a terminal log", async () => {
    const { client, written } = makePrisma({
      logs: [{ dueDate: day("2026-09-05"), status: "PAID" }],
    });

    const result = await settle(client);

    expect(result).toEqual({ ok: false, reason: "ALREADY_SETTLED" });
    expect(written).toHaveLength(0);
  });

  it("refuses a bill belonging to somebody else", async () => {
    const { client } = makePrisma({ bill: { userId: "user_2" } });

    expect(await settle(client)).toEqual({ ok: false, reason: "BILL_NOT_FOUND" });
  });

  /** The lease is re-read at the moment of the write, so "Turn off now" stops work already in
   *  flight rather than only refusing the next request. */
  it("refuses when the write lease lapses mid-flight, writing nothing", async () => {
    const { client, written } = makePrisma();

    const result = await settle(client, { assertStillPermitted: async () => false });

    expect(result).toEqual({ ok: false, reason: "NO_LONGER_PERMITTED" });
    expect(written).toHaveLength(0);
  });
});

describe("settleBill — the date must name a real occurrence", () => {
  /**
   * Nothing checked this before, in the route or over MCP.
   *
   * A real but wrong calendar date wrote a transaction and a PAID log against an occurrence that
   * does not exist -- and because the walk matches candidates by exact timestamp, the phantom log
   * matched nothing, the cursor never moved, and the reminder kept firing. That is the failure the
   * whole tool exists to prevent, arriving through the front door.
   */
  it("refuses a date the schedule does not fall on, and writes nothing", async () => {
    const { client, written, logWrites } = makePrisma();

    // The bill is monthly on the 5th; the 8th is a real date and not an occurrence.
    const result = await settle(client, { dueDate: day("2026-09-08") });

    expect(result).toEqual({ ok: false, reason: "NOT_AN_OCCURRENCE" });
    expect(written).toHaveLength(0);
    expect(logWrites).toHaveLength(0);
  });

  it("accepts an occurrence the schedule really produces", async () => {
    const { client } = makePrisma();

    expect((await settle(client, { dueDate: day("2026-10-05") })).ok).toBe(true);
  });

  /** Month lengths, not arithmetic on the day-of-month: a bill starting on the 31st falls on the
   *  30th in November, which no modular rule gets right. */
  it("follows the clamp for a short month", async () => {
    const { client } = makePrisma({
      bill: { startDate: day("2026-01-31"), nextDueDate: day("2026-11-30") },
    });

    expect((await settle(client, { dueDate: day("2026-11-30") })).ok).toBe(true);
    expect(await settle(client, { dueDate: day("2026-11-31") })).toEqual({
      ok: false,
      reason: "NOT_AN_OCCURRENCE",
    });
  });

  /**
   * Editing a bill's start date moves the recurrence out from under occurrences settled under the
   * old one. Refusing to act on those would make history unreachable rather than safe, so a date
   * that already carries a log is accepted whatever the current schedule says.
   */
  /**
   * The end date has to be tested before the equality, not after.
   *
   * The other way round, a candidate exactly one step past `endDate` matched the target and
   * returned true without the end date ever being consulted, so the February occurrence of a bill
   * that ended in January was settleable.
   */
  it("refuses an occurrence one step past the end date", async () => {
    const { client, written, logWrites } = makePrisma({
      bill: { endDate: day("2026-01-31") },
    });

    const result = await settle(client, { dueDate: day("2026-02-05") });

    expect(result).toEqual({ ok: false, reason: "NOT_AN_OCCURRENCE" });
    expect(written).toHaveLength(0);
    expect(logWrites).toHaveLength(0);
  });

  it("still accepts the occurrence that falls on the end date itself", async () => {
    const { client } = makePrisma({ bill: { endDate: day("2026-01-05") } });

    expect((await settle(client, { dueDate: day("2026-01-05") })).ok).toBe(true);
  });

  /**
   * The bill's own cursor is settleable whatever the recurrence says.
   *
   * `nextDueDate` is not always on the recurrence: reactivating sets it to the user's today, and
   * `PATCH /api/bills/[id]` has done that on live rows for as long as it has existed. Every reader
   * advertises that date as due, so refusing to settle it would be a 400 on a button that works.
   */
  it("accepts the cursor the bill itself advertises, off-recurrence or not", async () => {
    // Monthly on the 5th, but reactivated onto the 7th by the app's own PATCH route.
    const { client } = makePrisma({ bill: { nextDueDate: day("2026-09-07") } });

    expect((await settle(client, { dueDate: day("2026-09-07") })).ok).toBe(true);
  });

  it("does not let that admit any other off-recurrence day", async () => {
    const { client } = makePrisma({ bill: { nextDueDate: day("2026-09-07") } });

    expect(await settle(client, { dueDate: day("2026-09-08") })).toEqual({
      ok: false,
      reason: "NOT_AN_OCCURRENCE",
    });
  });

  it("still accepts a date that already carries a log", async () => {
    const { client } = makePrisma({
      logs: [{ dueDate: day("2026-09-08"), status: "SNOOZED", snoozeUntil: day("2020-01-01") }],
    });

    expect((await settle(client, { dueDate: day("2026-09-08"), action: "skip" })).ok).toBe(true);
  });
});

describe("settleBill — linking a payment the user already logged", () => {
  it("attaches the transaction and advances without writing a new one", async () => {
    const { client, written, billUpdates } = makePrisma({
      existingTransaction: { id: "tx_existing", amount: 5990 },
    });

    const result = await settle(client, { action: "pay_existing", transactionId: "tx_existing" });

    expect(result).toMatchObject({ ok: true, transactionId: "tx_existing", amountPaid: 5990 });
    expect(written).toHaveLength(0);
    expect(billUpdates[0].nextDueDate).toBeInstanceOf(Date);
  });

  /**
   * A skip asserts "this month was not paid", and correcting that is the entire reason
   * `pay_existing` exists: Skip is what people press when they have *already* paid and want the
   * reminder gone (#216). `pay` keeps SKIPPED terminal, since it would write a duplicate.
   */
  it("supersedes a skipped occurrence, where `pay` would refuse it", async () => {
    const skipped = [{ dueDate: day("2026-09-05"), status: "SKIPPED" as const }];

    const linking = makePrisma({
      logs: [...skipped],
      existingTransaction: { id: "tx_existing", amount: 5990 },
    });
    const linked = await settle(linking.client, {
      action: "pay_existing",
      transactionId: "tx_existing",
    });
    expect(linked.ok).toBe(true);

    const paying = makePrisma({ logs: [...skipped] });
    expect(await settle(paying.client)).toEqual({ ok: false, reason: "ALREADY_SETTLED" });
  });

  /**
   * The claim is conditional on `billId: null` and happens before anything else is written. An
   * unconditional update would re-point a payment that already belongs to another bill, leaving
   * that bill's log referencing a transaction it no longer owns.
   */
  it("refuses a payment already claimed by another bill", async () => {
    const { client, logWrites } = makePrisma({
      existingTransaction: { id: "tx_existing", amount: 5990 },
      claimCount: 0,
    });

    const result = await settle(client, { action: "pay_existing", transactionId: "tx_existing" });

    expect(result).toEqual({ ok: false, reason: "PAYMENT_ALREADY_LINKED" });
    expect(logWrites).toHaveLength(0);
  });

  it("refuses a transaction that is not this user's", async () => {
    const { client } = makePrisma({ existingTransaction: null });

    const result = await settle(client, { action: "pay_existing", transactionId: "tx_theirs" });

    expect(result).toEqual({ ok: false, reason: "TRANSACTION_NOT_FOUND" });
  });

  /**
   * Ownership alone was the whole check, and the browser never depended on it: its candidate list
   * is already narrowed to the bill's type, category and a fortnight either side. A model naming
   * an id has no such list, and there is no unlink anywhere in the app, so a wrong link is
   * permanent.
   */
  it("refuses a payment of the opposite type", async () => {
    const { client, logWrites } = makePrisma({
      existingTransaction: { id: "tx_salary", amount: 40000, type: "INCOME" },
    });

    const result = await settle(client, { action: "pay_existing", transactionId: "tx_salary" });

    expect(result).toEqual({ ok: false, reason: "TRANSACTION_TYPE_MISMATCH" });
    expect(logWrites).toHaveLength(0);
  });

  it("refuses a payment too far from the due date", async () => {
    const { client, logWrites } = makePrisma({
      // Two months before a 5 September occurrence.
      existingTransaction: { id: "tx_old", amount: 5990, date: new Date("2026-07-04T10:00:00Z") },
    });

    const result = await settle(client, { action: "pay_existing", transactionId: "tx_old" });

    expect(result).toEqual({ ok: false, reason: "TRANSACTION_OUTSIDE_WINDOW" });
    expect(logWrites).toHaveLength(0);
  });

  it("accepts a payment at the far edge of the window", async () => {
    const { client } = makePrisma({
      existingTransaction: { id: "tx_edge", amount: 5990, date: new Date("2026-09-19T10:00:00Z") },
    });

    expect((await settle(client, { action: "pay_existing", transactionId: "tx_edge" })).ok).toBe(
      true
    );
  });

  /**
   * A category mismatch is reported, never refused.
   *
   * `GET /api/bills/[id]/candidates` hides a miscategorised payment from its shortlist, which
   * makes naming its id the *only* way to attach one -- and a payment filed under the wrong
   * category is exactly the mess this action exists to clean up. Refusing here would turn a
   * display trade-off into a permanent inability to correct the record.
   */
  it("links a payment from another category, and says so", async () => {
    const { client } = makePrisma({
      existingTransaction: { id: "tx_misfiled", amount: 5990, categoryId: "cat_groceries" },
    });

    const result = await settle(client, {
      action: "pay_existing",
      transactionId: "tx_misfiled",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings).toHaveLength(1);
    expect(result.ok && result.warnings[0]).toContain("different category");
  });

  it("says nothing when the categories agree", async () => {
    const { client } = makePrisma({ existingTransaction: { id: "tx_ok", amount: 5990 } });

    const result = await settle(client, { action: "pay_existing", transactionId: "tx_ok" });

    expect(result.ok && result.warnings).toEqual([]);
  });
});

describe("settleBill — skipping and snoozing", () => {
  it("advances the schedule on a skip without writing a transaction", async () => {
    const { client, written, billUpdates } = makePrisma();

    const result = await settle(client, { action: "skip" });

    expect(result).toMatchObject({ ok: true, transactionId: null, amountPaid: null });
    expect(written).toHaveLength(0);
    expect((billUpdates[0].nextDueDate as Date).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  /** A snooze defers the *reminder*. Advancing the cursor would settle an occurrence nobody paid. */
  it("leaves the due date alone on a snooze", async () => {
    const { client, billUpdates } = makePrisma();

    const result = await settle(client, { action: "snooze", snoozeDays: 3 });

    expect(result).toMatchObject({ ok: true, nextDueDate: null });
    expect(billUpdates).toHaveLength(0);
  });

  /**
   * "Snooze for a day" means a day in the *user's* calendar. Computed from a plain UTC today, a
   * snooze started at 02:00 in Manila expired the same morning, because the UTC day had not turned
   * over yet.
   */
  it("counts snooze days from the user's own calendar day", async () => {
    // 2026-09-07T02:00 in Manila (UTC+8) is still 2026-09-06 in UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client } = makePrisma();
      const result = await settle(client, { action: "snooze", snoozeDays: 1 });

      expect(result.ok).toBe(true);
      expect(result.ok && result.snoozeUntil?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The guard that makes `pay_bill`'s `idempotentHint` honest.
   *
   * Snooze had none: a retry after a lost response wrote a second SNOOZED row, and one sent on a
   * later calendar day pushed `snoozeUntil` further out -- so the same call twice produced a
   * different state, which is exactly what that annotation promises it will not.
   */
  it("resolves a retry to the deferral already in place", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client, logWrites } = makePrisma({
        logs: [
          { dueDate: day("2026-09-05"), status: "SNOOZED", snoozeUntil: day("2026-09-09") },
        ],
      });

      const result = await settle(client, { action: "snooze", snoozeDays: 1 });

      expect(result).toMatchObject({ ok: true, replayed: true });
      expect(result.ok && result.snoozeUntil?.toISOString()).toBe("2026-09-09T00:00:00.000Z");
      expect(logWrites).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Re-snoozing an occurrence whose deferral has lapsed is a fresh decision the user is entitled
   *  to make, so the replay guard is scoped to a snooze that is still live. */
  it("writes a new snooze once the old one has lapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client, logWrites } = makePrisma({
        logs: [
          { dueDate: day("2026-09-05"), status: "SNOOZED", snoozeUntil: day("2026-09-01") },
        ],
      });

      const result = await settle(client, { action: "snooze", snoozeDays: 2 });

      expect(result).toMatchObject({ ok: true, replayed: false });
      expect(logWrites).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The replay guard has to run behind the row lock, not ahead of the transaction.
   *
   * Read outside it the check is only advisory: two overlapping retries both see no live snooze
   * before either insert commits, and both write one -- so `pay_bill` still would not satisfy its
   * `idempotentHint` under concurrent retries, which is the whole claim the guard exists to make
   * good. A stub cannot run two transactions at once, so what is pinned is the lock being taken.
   */
  it("takes the bill lock before deciding whether to write a snooze", async () => {
    const { client, locks, logWrites } = makePrisma();

    const result = await settle(client, { action: "snooze", snoozeDays: 1 });

    expect(result.ok).toBe(true);
    expect(logWrites).toHaveLength(1);
    expect(locks()).toBe(1);
  });

  /** Every other branch re-reads the lease inside its transaction; this one used to skip it, so
   *  switching writes off mid-request stopped a payment and not a snooze. */
  it("refuses a snooze when the write lease lapses mid-flight", async () => {
    const { client, logWrites } = makePrisma();

    const result = await settle(client, {
      action: "snooze",
      assertStillPermitted: async () => false,
    });

    expect(result).toEqual({ ok: false, reason: "NO_LONGER_PERMITTED" });
    expect(logWrites).toHaveLength(0);
  });
});

describe("createBill", () => {
  const INPUT = {
    amount: 1900,
    description: "PLDT",
    type: "EXPENSE" as const,
    categoryId: "cat_own",
    frequency: "MONTHLY" as const,
    customIntervalDays: null,
    reminderDaysBefore: 3,
    isVariable: false,
    startDate: day("2026-10-01"),
    endDate: null,
    isActive: true,
  };

  const create = (client: PrismaClient, overrides: Record<string, unknown> = {}) =>
    createBill({ prisma: client, userId: "user_1", input: INPUT, ...overrides });

  it("creates the bill with its first occurrence on the start date", async () => {
    const { client, written } = makePrisma();

    const result = await create(client);

    expect(result.ok).toBe(true);
    expect(written[0].nextDueDate).toEqual(day("2026-10-01"));
  });

  /**
   * The route this replaced trusted whatever `categoryId` it was handed, which was survivable
   * while the only caller was a form that can offer nothing but the user's own categories. A tool
   * a model calls with an inferred id is not that caller.
   */
  it("refuses a category that is not usable by this account", async () => {
    const { client, written } = makePrisma({ usableCategoryIds: [] });

    expect(await create(client)).toEqual({ ok: false, reason: "CATEGORY_NOT_USABLE" });
    expect(written).toHaveLength(0);
  });

  it("refuses a category whose type does not match the bill's", async () => {
    const { client } = makePrisma({ categoryType: "INCOME" });

    expect(await create(client)).toEqual({ ok: false, reason: "CATEGORY_NOT_USABLE" });
  });

  it("refuses a CUSTOM frequency with no interval", async () => {
    const { client } = makePrisma();

    const result = await create(client, {
      input: { ...INPUT, frequency: "CUSTOM" as const, customIntervalDays: null },
    });

    expect(result).toEqual({ ok: false, reason: "INVALID_SCHEDULE" });
  });

  it("refuses an end date before the start date", async () => {
    const { client } = makePrisma();

    const result = await create(client, {
      input: { ...INPUT, endDate: day("2026-09-01") },
    });

    expect(result).toEqual({ ok: false, reason: "INVALID_SCHEDULE" });
  });

  /**
   * A label excluded by type is neither applied nor an error. Reporting it is the point: silently
   * writing nothing is what made a receipt review promise a label and then not write it.
   */
  it("reports a type-incompatible label instead of applying or refusing it", async () => {
    const { client } = makePrisma({
      ownedLabels: [{ id: "lab_1", name: "Salary", applicableTo: "INCOME" }],
    });

    const result = await create(client, { labelIds: ["lab_1"] });

    expect(result.ok).toBe(true);
    expect(result.ok && result.droppedLabels).toEqual([
      { labelId: "lab_1", name: "Salary", reason: "TYPE_MISMATCH" },
    ]);
  });

  it("refuses a label that is not this user's", async () => {
    const { client } = makePrisma({ ownedLabels: [] });

    expect(await create(client, { labelIds: ["lab_theirs"] })).toEqual({
      ok: false,
      reason: "LABELS_NOT_OWNED",
    });
  });
});

describe("updateBill", () => {
  const update = (client: PrismaClient, patch: Record<string, unknown>) =>
    updateBill({ prisma: client, userId: "user_1", billId: "bill_1", patch });

  it("changes only what the patch names", async () => {
    const { client, billUpdates } = makePrisma();

    const result = await update(client, { amount: 1900 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changed).toEqual(["amount"]);
    expect(billUpdates[0].amount).toBe(1900);
    // Everything else is written back as it was stored, not lost.
    expect(billUpdates[0].description).toBe("Meralco");
    expect(billUpdates[0].frequency).toBe("MONTHLY");
  });

  /**
   * The effective-row check. `categoryId` is absent from the patch, so nothing about it looks
   * wrong on its own, and the bill would end up an income bill filed under a utilities category --
   * distorting every breakdown that groups by one.
   */
  it("refuses a bare type flip that leaves the category behind", async () => {
    const { client, billUpdates } = makePrisma({ categoryType: "EXPENSE" });

    const result = await update(client, { type: "INCOME" });

    expect(result).toEqual({ ok: false, reason: "CATEGORY_NOT_USABLE" });
    expect(billUpdates).toHaveLength(0);
  });

  it("accepts a type flip that brings a matching category with it", async () => {
    const { client } = makePrisma({ usableCategoryIds: ["cat_income"], categoryType: "INCOME" });

    const result = await update(client, { type: "INCOME", categoryId: "cat_income" });

    expect(result.ok).toBe(true);
  });

  /**
   * Judging an unchanged pair prevents nothing -- re-sending it writes what is already there --
   * and would lock the caller out of bills that were *already* mismatched, which is reachable with
   * no MCP involvement: `PUT /api/categories/[id]` lets a custom category's type be flipped under
   * the rows that use it.
   */
  it("does not re-judge a category pair the patch never moved", async () => {
    const { client } = makePrisma({ categoryType: "INCOME" });

    const result = await update(client, { amount: 1900 });

    expect(result.ok).toBe(true);
  });

  /** A changed amount does not move a due date, so nothing should be recalculated. */
  it("leaves the due date alone when the schedule's shape did not change", async () => {
    const { client, billUpdates } = makePrisma();

    await update(client, { amount: 1900 });

    expect(billUpdates[0].nextDueDate).toBeUndefined();
  });

  /**
   * The walk reads occurrence logs and the stored cursor; the update writes that cursor back.
   *
   * Derived before the transaction it was a read-then-write across an unlocked gap: a `pay_bill`
   * committing in between writes a terminal log and advances the cursor, and the stale value then
   * puts it back on the occurrence that was just settled -- which `alreadySettled` refuses for ever
   * after, with reminders stuck on it. A stub cannot interleave two transactions, so what is pinned
   * is that the row is locked and the walk happens after it.
   */
  it("takes the bill lock before recalculating the schedule", async () => {
    const { client, locks, logReads } = makePrisma();

    const result = await update(client, { frequency: "WEEKLY" });

    expect(result.ok).toBe(true);
    expect(locks()).toBe(1);
    // The occurrence-log read that feeds the walk happened after the lock, not before it.
    expect(logReads()).toEqual(["after-lock"]);
  });

  it("takes no lock at all when the schedule did not move", async () => {
    const { client, locks } = makePrisma();

    await update(client, { amount: 1900 });

    // Still locked: the update writes the row either way, and the lock has to be the transaction's
    // first statement, so it cannot be made conditional on what the patch happens to contain.
    expect(locks()).toBe(1);
  });

  it("recalculates the due date when the frequency changes", async () => {
    const { client, billUpdates } = makePrisma();

    const result = await update(client, { frequency: "WEEKLY" });

    expect(result.ok).toBe(true);
    expect(billUpdates[0].nextDueDate).toBeInstanceOf(Date);
  });

  /** Walking past terminal logs is what keeps payment progress: editing a bill used to reset the
   *  cursor outright and resurrect occurrences that had already been paid. */
  it("walks the recalculated due date past occurrences already settled", async () => {
    const { client, billUpdates } = makePrisma({
      logs: [
        { dueDate: day("2026-09-05"), status: "PAID" },
        { dueDate: day("2026-10-05"), status: "PAID" },
      ],
    });

    // Moving the start date is what triggers the walk. Without walking past the two settled
    // occurrences it would land back on 5 September and resurrect a month already paid.
    await update(client, { startDate: day("2026-09-05") });

    expect((billUpdates[0].nextDueDate as Date).toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  /**
   * An end date pulled back before the cursor used to leave the bill active pointing past its own
   * end. Nothing downstream filters on `endDate` -- `getUpcomingBills`, `/api/bills/upcoming` and
   * `pending-bills.ts` all select on `isActive` alone -- so it showed as permanently overdue and
   * kept mailing reminders.
   */
  it("switches the bill off when a new end date leaves nothing due", async () => {
    const { client, billUpdates } = makePrisma();

    const result = await update(client, { endDate: day("2026-08-31") });

    expect(result.ok).toBe(true);
    expect(result.ok && result.deactivated).toBe(true);
    expect(billUpdates[0].isActive).toBe(false);
  });

  it("leaves the bill running when the new end date is still ahead of it", async () => {
    const { client, billUpdates } = makePrisma();

    const result = await update(client, { endDate: day("2027-01-31") });

    expect(result.ok && result.deactivated).toBe(false);
    expect(billUpdates[0].isActive).toBe(true);
  });

  /**
   * An end date says where the recurrence *stops*, never where it falls, so it must not trigger the
   * walk from `startDate`. The walk only skips terminal logs, so a cursor sitting ahead for any
   * other reason would be dragged backwards by an edit that had nothing to do with it.
   */
  it("does not rewrite the cursor when only the end date moved", async () => {
    const { client, billUpdates } = makePrisma();

    await update(client, { endDate: day("2027-01-31") });

    expect(billUpdates[0].nextDueDate).toBeUndefined();
  });

  /** A finite bill has to be able to become open-ended again, or setting an end date once is a
   *  one-way door for every caller that cannot reach the app. */
  it("clears the end date when the patch sends null", async () => {
    const { client, billUpdates } = makePrisma({ bill: { endDate: day("2026-12-31") } });

    const result = await update(client, { endDate: null });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changed).toEqual(["endDate"]);
    expect(billUpdates[0].endDate).toBeNull();
    expect(billUpdates[0].isActive).toBe(true);
  });

  it("refuses a patch that names nothing", async () => {
    const { client, billUpdates } = makePrisma();

    expect(await update(client, {})).toEqual({ ok: false, reason: "NO_FIELDS" });
    expect(billUpdates).toHaveLength(0);
  });

  it("refuses a bill belonging to somebody else", async () => {
    const { client } = makePrisma({ bill: { userId: "user_2" } });

    expect(await update(client, { amount: 1 })).toEqual({ ok: false, reason: "BILL_NOT_FOUND" });
  });

  /** Omitting `labelIds` preserves what is there. Same rule as `updateTransactions`. */
  it("leaves labels untouched when the patch does not name them", async () => {
    const { client, deletedBillLabels } = makePrisma({
      billLabels: [
        { labelId: "lab_1", label: { id: "lab_1", name: "Utilities", applicableTo: "BOTH" } },
      ],
      ownedLabels: [{ id: "lab_1", name: "Utilities", applicableTo: "BOTH" }],
    });

    await update(client, { amount: 1900 });

    expect(deletedBillLabels()).toBe(0);
  });

  it("clears labels when the patch sends an empty array", async () => {
    const { client, deletedBillLabels, billLabelWrites } = makePrisma({
      billLabels: [
        { labelId: "lab_1", label: { id: "lab_1", name: "Utilities", applicableTo: "BOTH" } },
      ],
      ownedLabels: [{ id: "lab_1", name: "Utilities", applicableTo: "BOTH" }],
    });

    const result = await update(client, { labelIds: [] });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changed).toContain("labels");
    expect(deletedBillLabels()).toBe(1);
    expect(billLabelWrites).toHaveLength(0);
  });

  /**
   * A label already on the bill that the *new* type excludes leaves, and says why. `changed` shows
   * it going but never the reason, and an unexplained disappearance reads as a bug in the tool.
   */
  it("reports a stored label dropped by a changed type", async () => {
    const { client } = makePrisma({
      usableCategoryIds: ["cat_income"],
      categoryType: "INCOME",
      billLabels: [
        { labelId: "lab_1", label: { id: "lab_1", name: "Groceries", applicableTo: "EXPENSE" } },
      ],
      ownedLabels: [{ id: "lab_1", name: "Groceries", applicableTo: "EXPENSE" }],
    });

    const result = await update(client, { type: "INCOME", categoryId: "cat_income" });

    expect(result.ok).toBe(true);
    expect(result.ok && result.droppedLabels).toEqual([
      { labelId: "lab_1", name: "Groceries", reason: "TYPE_MISMATCH" },
    ]);
  });

  /** Switching a bill off is the only retirement there is, and it must stay reversible: bringing
   *  it back with a due date left in the past would return it already overdue. */
  it("moves a stale due date up to today when a bill is switched back on", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client, billUpdates } = makePrisma({
        bill: { isActive: false, nextDueDate: day("2026-05-05") },
      });

      const result = await update(client, { isActive: true });

      expect(result.ok).toBe(true);
      expect(billUpdates[0].isActive).toBe(true);
      // The next day the schedule actually falls on at or after the user's today (2026-09-07 in
      // Manila), not today itself: a monthly bill due on the 5th resumes on 5 October.
      expect((billUpdates[0].nextDueDate as Date).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Today is an arbitrary calendar day, and assigning it directly put the cursor on a day the
   * recurrence never produces: the bill came back active advertising an occurrence that
   * `settleBill` then refused as NOT_AN_OCCURRENCE, so it could not be paid, skipped or snoozed.
   */
  it("resumes on a day the schedule really falls on", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client, billUpdates } = makePrisma({
        bill: { isActive: false, nextDueDate: day("2026-05-05") },
      });

      await update(client, { isActive: true });
      const resumed = billUpdates[0].nextDueDate as Date;

      // The proof that matters: whatever day it picked, settleBill will accept it.
      const settling = makePrisma({ bill: { nextDueDate: resumed, isActive: true } });
      expect((await settle(settling.client, { dueDate: resumed })).ok).toBe(true);
      expect(resumed.getUTCDate()).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * One patch doing both is the case that slipped through.
   *
   * A cursor already in the future skipped the "resume from today" branch and was taken unchecked,
   * and the reactivation branch wins over `ranOut` -- so `{ isActive: true, endDate: <before that
   * cursor> }` brought the bill back past its own end, overdue and mailing reminders, which is the
   * exact state the end-date fix was supposed to have closed.
   */
  it("will not reactivate past an end date set in the same patch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client, billUpdates } = makePrisma({
        // Inactive, and its cursor is already in the future, so no resume-from-today walk happens.
        bill: { isActive: false, nextDueDate: day("2026-12-05") },
      });

      const result = await update(client, { isActive: true, endDate: day("2026-10-31") });

      expect(result.ok).toBe(true);
      expect(result.ok && result.deactivated).toBe(true);
      expect(billUpdates[0].isActive).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still reactivates onto a future cursor the end date allows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client, billUpdates } = makePrisma({
        bill: { isActive: false, nextDueDate: day("2026-12-05") },
      });

      const result = await update(client, { isActive: true, endDate: day("2027-06-30") });

      expect(result.ok && result.deactivated).toBe(false);
      expect(billUpdates[0].isActive).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  /** A bill whose end date has already passed has nothing left to be due, so there is nothing to
   *  switch back on. Reported rather than refused: the rest of the patch may have applied fine. */
  it("cannot resume a bill whose schedule has already ended", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T18:00:00.000Z"));
    try {
      const { client, billUpdates } = makePrisma({
        bill: { isActive: false, nextDueDate: day("2026-05-05"), endDate: day("2026-06-30") },
      });

      const result = await update(client, { isActive: true });

      expect(result.ok).toBe(true);
      expect(result.ok && result.deactivated).toBe(true);
      expect(billUpdates[0].isActive).toBe(false);
      // `changed` describes what was written, never what was asked for.
      expect(result.ok && result.changed).not.toContain("isActive");
    } finally {
      vi.useRealTimers();
    }
  });
});
