import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  billFindUnique: vi.fn(),
  billFindUniqueOrThrow: vi.fn(),
  billUpdate: vi.fn(),
  logFindMany: vi.fn(),
  /** Statement order inside the transaction, so the lock can be shown to come first. */
  statements: [] as string[],
}));

vi.mock("@/lib/prisma", () => {
  const record = <T>(name: string, run: () => T): T => {
    mocks.statements.push(name);
    return run();
  };
  const client = {
    $queryRaw: vi.fn(() => record("lock", () => Promise.resolve([{ id: "bill-1" }]))),
    scheduledTransaction: {
      findUnique: mocks.billFindUnique,
      update: vi.fn((args: unknown) => record("update", () => mocks.billUpdate(args))),
      findUniqueOrThrow: vi.fn((args: unknown) =>
        record("locked-read", () => mocks.billFindUniqueOrThrow(args)),
      ),
    },
    scheduledTransactionLog: {
      findMany: vi.fn((args: unknown) => record("log-read", () => mocks.logFindMany(args))),
    },
    label: { findMany: vi.fn() },
    billLabel: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn((run: (tx: unknown) => unknown) => run(client)),
  };
  return { prisma: client };
});
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { PUT } from "@/app/api/bills/[id]/route";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const context = { params: Promise.resolve({ id: "bill-1" }) };

/** A monthly bill on the 5th, already advanced to October. */
const storedBill = (overrides: Record<string, unknown> = {}) => ({
  id: "bill-1",
  userId: "user-1",
  amount: 1500,
  description: "Internet",
  type: "EXPENSE",
  categoryId: "cat-1",
  frequency: "MONTHLY",
  customIntervalDays: null,
  reminderDaysBefore: 3,
  isVariable: false,
  startDate: day("2026-01-05"),
  endDate: null,
  nextDueDate: day("2026-10-05"),
  isActive: true,
  ...overrides,
});

const body = (overrides: Record<string, unknown> = {}) => ({
  amount: 1500,
  description: "Internet",
  type: "EXPENSE",
  categoryId: "cat-1",
  frequency: "MONTHLY",
  reminderDaysBefore: 3,
  startDate: "2026-01-05",
  ...overrides,
});

const put = (payload: Record<string, unknown>) =>
  PUT(
    new Request("http://localhost/api/bills/bill-1", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
    context,
  );

/** What the route wrote, which is the only place the end-date decision is visible. */
const written = () => mocks.billUpdate.mock.calls[0][0].data as Record<string, unknown>;

describe("PUT /api/bills/[id] end date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.statements.length = 0;
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.billFindUnique.mockResolvedValue(storedBill());
    mocks.billFindUniqueOrThrow.mockResolvedValue(storedBill());
    mocks.logFindMany.mockResolvedValue([]);
    mocks.billUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...storedBill(), ...data }),
    );
  });

  /**
   * An end date pulled back before the cursor used to leave the bill active pointing past its own
   * end. Nothing downstream filters on `endDate` -- `getUpcomingBills`, `/api/bills/upcoming` and
   * `pending-bills.ts` all select on `isActive` alone -- so it showed as permanently overdue and
   * mailed a reminder every day (#240).
   */
  it("switches the bill off when a new end date leaves nothing due", async () => {
    const response = await put(body({ endDate: "2026-09-30" }));

    expect(response.status).toBe(200);
    expect(written().isActive).toBe(false);
  });

  it("leaves the bill running when the new end date is still ahead of the cursor", async () => {
    const response = await put(body({ endDate: "2027-01-31" }));

    expect(response.status).toBe(200);
    expect(written().isActive).toBeUndefined();
  });

  /** The end date falls *on* an occurrence, so that occurrence is still due. */
  it("keeps the bill running when the end date is the due date itself", async () => {
    await put(body({ endDate: "2026-10-05" }));

    expect(written().isActive).toBeUndefined();
  });

  /**
   * An end date says where the recurrence *stops*, never where it falls, so it must not trigger
   * the walk from `startDate`. The walk only skips terminal logs, so a cursor sitting ahead for
   * any other reason would be dragged backwards by an edit that had nothing to do with it.
   */
  it("does not rewrite the cursor when only the end date moved", async () => {
    await put(body({ endDate: "2027-01-31" }));

    expect(written().nextDueDate).toBeUndefined();
    expect(mocks.logFindMany).not.toHaveBeenCalled();
  });

  /**
   * The schema leaves `customIntervalDays` absent on a non-custom bill while the column holds
   * `null`, so comparing them raw made every save look like a frequency change and re-walked the
   * schedule from `startDate` -- pulling a cursor a snooze or a payment had moved back to the
   * first occurrence the walk found.
   */
  it("does not re-walk the schedule when only the amount moved", async () => {
    await put(body({ amount: 1900 }));

    expect(written().nextDueDate).toBeUndefined();
    expect(mocks.logFindMany).not.toHaveBeenCalled();
  });

  /** The pre-existing recalculation path still deactivates when the walk itself runs out. */
  it("switches the bill off when the recalculated walk runs past the end date", async () => {
    mocks.logFindMany.mockResolvedValue([
      { dueDate: day("2026-01-05"), status: "PAID" },
      { dueDate: day("2026-01-12"), status: "PAID" },
    ]);

    await put(body({ frequency: "WEEKLY", endDate: "2026-01-12" }));

    expect(written().isActive).toBe(false);
    expect(written().nextDueDate).toBeUndefined();
  });

  it("still recalculates the cursor when the frequency changes", async () => {
    await put(body({ frequency: "WEEKLY" }));

    expect(written().nextDueDate).toBeInstanceOf(Date);
    expect(written().isActive).toBeUndefined();
  });
});

/**
 * The derivation used to run on the row read *before* the transaction, which is a read-then-write
 * across an unlocked gap. `settleBill` locks the row and advances the cursor, so both halves of
 * the derivation were wrong under a concurrent settlement -- review of #241.
 */
describe("PUT /api/bills/[id] concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.statements.length = 0;
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.billFindUnique.mockResolvedValue(storedBill());
    mocks.billFindUniqueOrThrow.mockResolvedValue(storedBill());
    mocks.logFindMany.mockResolvedValue([]);
    mocks.billUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...storedBill(), ...data }),
    );
  });

  /** The lock has to be the transaction's first statement: the update takes FOR KEY SHARE through
   *  its foreign keys, so upgrading to FOR UPDATE afterwards deadlocks. */
  it("takes the bill lock before reading anything the schedule depends on", async () => {
    await put(body({ frequency: "WEEKLY" }));

    expect(mocks.statements).toEqual(["lock", "locked-read", "log-read", "update"]);
  });

  /**
   * A payment committing between the two reads advances the cursor past the end date being set.
   * Judged on the stale cursor, the edit writes the end date and leaves the bill active past its
   * own end -- exactly the state this route was fixed to prevent.
   */
  it("deactivates on the cursor a concurrent settlement left, not the one it read first", async () => {
    mocks.billFindUnique.mockResolvedValue(storedBill({ nextDueDate: day("2026-10-05") }));
    mocks.billFindUniqueOrThrow.mockResolvedValue(storedBill({ nextDueDate: day("2026-11-05") }));

    await put(body({ endDate: "2026-10-31" }));

    expect(written().isActive).toBe(false);
  });

  /** The mirror case: a settlement that moved the cursor *back* inside the end date must not have
   *  the edit switch the bill off on a stale reading. */
  it("leaves the bill running when the locked cursor is inside the new end date", async () => {
    mocks.billFindUnique.mockResolvedValue(storedBill({ nextDueDate: day("2026-11-05") }));
    mocks.billFindUniqueOrThrow.mockResolvedValue(storedBill({ nextDueDate: day("2026-10-05") }));

    await put(body({ endDate: "2026-10-31" }));

    expect(written().isActive).toBeUndefined();
  });

  /** The walk reads occurrence logs, so a payment invisible to it puts the cursor back on the
   *  occurrence just settled -- which `alreadySettled` then refuses for ever. */
  it("walks the schedule from inside the lock", async () => {
    await put(body({ startDate: "2026-02-05" }));

    expect(mocks.statements.indexOf("log-read")).toBeGreaterThan(mocks.statements.indexOf("lock"));
  });
});
