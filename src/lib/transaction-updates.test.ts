import { describe, it, expect, vi, type Mock } from "vitest";
import { Prisma } from "@prisma/client";
import { updateTransactions, type TransactionPatch } from "./transaction-writes";
import type { PrismaClient } from "./budget-query-types";

/**
 * A stored row as `TX_INCLUDE` returns it, with only the fields the update path reads.
 *
 * Hand-built rather than fetched, so every test can state the exact starting condition it is
 * about. The trade is that these prove the *rules* and not the SQL, which is why
 * `scripts/verify-transaction-update.ts` exists and drives the same code against a real database.
 */
const row = (over: Record<string, unknown> = {}) => ({
  id: "tx_1",
  amount: 250,
  description: "Grab to office",
  type: "EXPENSE",
  date: new Date("2026-08-25T09:00:00.000Z"),
  categoryId: "cat_transport",
  userId: "user_1",
  billId: null,
  receiptGroupId: null,
  receiptBreakdown: null,
  category: { id: "cat_transport", name: "Transportation", type: "EXPENSE" },
  labels: [] as { labelId: string; label: { name: string; applicableTo: string } }[],
  ...over,
});

interface StubOptions {
  rows?: ReturnType<typeof row>[];
  categories?: { id: string; type: string }[];
  labels?: { id: string; applicableTo: string; name: string }[];
  permitted?: boolean;
  /** Thrown from `$transaction`, to exercise how a failed write is classified. */
  throwOnWrite?: unknown;
}

/**
 * Prisma stubbed down to the six calls the update path makes.
 *
 * `transaction.update` mutates the stub's own row so the post-write re-read reflects it, which is
 * what makes the `changed` assertions meaningful: computing them from the patch instead would let
 * a broken write still report a correct-looking diff.
 */
const makePrisma = ({
  rows = [row()],
  categories = [
    { id: "cat_transport", type: "EXPENSE" },
    { id: "cat_food", type: "EXPENSE" },
    { id: "cat_salary", type: "INCOME" },
  ],
  labels = [],
  permitted = true,
  throwOnWrite,
}: StubOptions = {}) => {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const labelWrites: { deleted: string[]; created: { transactionId: string; labelId: string }[] } = {
    deleted: [],
    created: [],
  };

  const client = {
    transaction: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => store.get(id)).filter(Boolean)
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const current = store.get(where.id)!;
        const next = { ...current, ...data };
        if (data.categoryId) {
          next.category = { ...current.category, id: data.categoryId as string };
        }
        store.set(where.id, next);
        return next;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => store.get(where.id)!),
    },
    transactionLabel: {
      deleteMany: vi.fn(async ({ where }: { where: { transactionId: string } }) => {
        labelWrites.deleted.push(where.transactionId);
        store.get(where.transactionId)!.labels = [];
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: { data: { transactionId: string; labelId: string }[] }) => {
        labelWrites.created.push(...data);
        return { count: data.length };
      }),
    },
    // Both filter on the requested ids, like the real queries: the service decides ownership by
    // comparing how many rows came back against how many it asked for, so a stub that returns
    // everything makes every call look like it named unknown ids.
    category: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        categories.filter((c) => where.id.in.includes(c.id))
      ),
    },
    label: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        labels.filter((l) => where.id.in.includes(l.id))
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      if (throwOnWrite) throw throwOnWrite;
      return fn(client);
    }),
  };

  return {
    prisma: client as unknown as PrismaClient,
    store,
    labelWrites,
    permitted,
  };
};

/** The `transaction.update` spy behind the cast, for the tests that care whether a write happened
 *  at all rather than what it wrote. */
const updateSpy = (stub: { prisma: PrismaClient }) =>
  (stub.prisma as unknown as { transaction: { update: Mock } }).transaction.update;

const run = (patches: TransactionPatch[], opts: StubOptions = {}) => {
  const stub = makePrisma(opts);
  return {
    stub,
    result: updateTransactions({
      prisma: stub.prisma,
      userId: "user_1",
      patches,
      timezoneOffset: -480,
      updatedVia: "MCP",
      updatedByMcpTokenId: "tok_1",
      ...(opts.permitted === false && { assertStillPermitted: async () => false }),
    }),
  };
};

describe("updateTransactions", () => {
  it("changes only the fields the patch names", async () => {
    const { stub, result } = run([{ id: "tx_1", amount: 320 }]);
    const r = await result;

    expect(r.ok).toBe(true);
    const after = stub.store.get("tx_1")!;
    expect(after.amount).toBe(320);
    // The whole premise of a partial patch: everything unnamed survives untouched. A handler that
    // spread the patch over a default-filled object would blank the description here.
    expect(after.description).toBe("Grab to office");
    expect(after.categoryId).toBe("cat_transport");
    expect(after.date).toEqual(new Date("2026-08-25T09:00:00.000Z"));
  });

  it("reports what moved and what it was, not what the patch listed", async () => {
    // A patch restating a value that was already there changed nothing, and saying otherwise
    // would have the caller report an edit the user cannot find.
    const { result } = run([{ id: "tx_1", amount: 250, description: "Grab home" }]);
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated[0].changed).toEqual(["description"]);
    expect(r.updated[0].previous).toEqual({ description: "Grab to office" });
  });

  it("stamps the audit columns on every edited row", async () => {
    const { stub, result } = run([{ id: "tx_1", amount: 320 }]);
    await result;

    const after = stub.store.get("tx_1")! as unknown as Record<string, unknown>;
    expect(after.updatedVia).toBe("MCP");
    expect(after.updatedByMcpTokenId).toBe("tok_1");
    // Creation provenance is not a thing an edit may rewrite: a row typed into the app and later
    // corrected over MCP is both, and overwriting createdVia would erase the first half.
    expect(after).not.toHaveProperty("createdVia", "MCP");
  });

  // --- The effective-row rule ---

  it("refuses a bare type flip that leaves the category behind", async () => {
    // The case a patch-only check misses entirely. `categoryId` is not in the patch, so nothing
    // about it looks suspicious; it is the *stored* category that no longer matches the new type.
    // Letting this through files income under an expense category and distorts every breakdown.
    const { result } = run([{ id: "tx_1", type: "INCOME" }]);
    expect(await result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
  });

  it("accepts a type flip that brings a matching category with it", async () => {
    const { stub, result } = run([{ id: "tx_1", type: "INCOME", categoryId: "cat_salary" }]);
    const r = await result;

    expect(r.ok).toBe(true);
    expect(stub.store.get("tx_1")!.type).toBe("INCOME");
  });

  it("refuses a category the user does not own", async () => {
    const { result } = run([{ id: "tx_1", categoryId: "cat_someone_else" }], {
      // The ownership query returns only what it found, so an unowned id is simply absent.
      categories: [{ id: "cat_transport", type: "EXPENSE" }],
    });
    expect(await result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
  });

  it("refuses a category whose type does not match the row's", async () => {
    const { result } = run([{ id: "tx_1", categoryId: "cat_salary" }]);
    expect(await result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
  });

  // --- Labels ---

  it("preserves existing labels when labelIds is omitted", async () => {
    const { stub, result } = run([
      { id: "tx_1", amount: 320 },
    ], {
      rows: [
        row({
          labels: [{ labelId: "lab_work", label: { name: "Work", applicableTo: "BOTH" } }],
        }),
      ],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Nothing was deleted and nothing recreated: an untouched label set must not churn, or every
    // amount correction would rewrite the row's labels for no reason.
    expect(stub.labelWrites.deleted).toEqual([]);
    expect(r.updated[0].changed).toEqual(["amount"]);
  });

  it("drops a preserved label the new type excludes", async () => {
    const { stub, result } = run([{ id: "tx_1", type: "INCOME", categoryId: "cat_salary" }], {
      rows: [
        row({
          labels: [{ labelId: "lab_exp", label: { name: "Expenses only", applicableTo: "EXPENSE" } }],
        }),
      ],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stub.labelWrites.deleted).toEqual(["tx_1"]);
    expect(stub.labelWrites.created).toEqual([]);
    expect(r.updated[0].previous.labels).toEqual(["Expenses only"]);
  });

  it("replaces labels wholesale when explicit ids are sent", async () => {
    const { stub, result } = run([{ id: "tx_1", labelIds: ["lab_food"] }], {
      rows: [row({ labels: [{ labelId: "lab_work", label: { name: "Work", applicableTo: "BOTH" } }] })],
      labels: [{ id: "lab_food", applicableTo: "BOTH", name: "Food" }],
    });

    expect((await result).ok).toBe(true);
    expect(stub.labelWrites.created).toEqual([{ transactionId: "tx_1", labelId: "lab_food" }]);
  });

  it("clears labels on an explicit empty array", async () => {
    const { stub, result } = run([{ id: "tx_1", labelIds: [] }], {
      rows: [row({ labels: [{ labelId: "lab_work", label: { name: "Work", applicableTo: "BOTH" } }] })],
    });

    expect((await result).ok).toBe(true);
    expect(stub.labelWrites.deleted).toEqual(["tx_1"]);
    expect(stub.labelWrites.created).toEqual([]);
  });

  it("refuses a label the user does not own", async () => {
    const { result } = run([{ id: "tx_1", labelIds: ["lab_someone_else"] }], { labels: [] });
    expect(await result).toEqual({ ok: false, reason: "LABELS_NOT_OWNED" });
  });

  // --- Batch integrity ---

  it("changes nothing when one row in the batch is rejected", async () => {
    // All-or-nothing is the contract. There is no idempotency key on an update, so a half-applied
    // batch leaves the caller unable to say which rows moved or safely resubmit.
    const { stub, result } = run(
      [
        { id: "tx_1", amount: 320 },
        { id: "tx_2", categoryId: "cat_salary" },
      ],
      { rows: [row(), row({ id: "tx_2" })] }
    );

    expect(await result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
    expect(stub.store.get("tx_1")!.amount).toBe(250);
    expect(stub.store.get("tx_2")!.amount).toBe(250);
  });

  it("refuses an id that is not this user's without saying whether it exists", async () => {
    // Scoped by userId, so someone else's row simply is not found. Distinguishing "not yours"
    // from "no such row" would turn this into an id oracle.
    // Both patches name a field, so this reaches the ownership query rather than stopping at the
    // cheaper NO_FIELDS check that runs first.
    const { result } = run([
      { id: "tx_other", amount: 99 },
      { id: "tx_1", amount: 1 },
    ], { rows: [row()] });
    expect(await result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("refuses a patch that names no field to change", async () => {
    const { result } = run([{ id: "tx_1" }]);
    expect(await result).toEqual({ ok: false, reason: "NO_FIELDS" });
  });

  it("refuses the same id twice in one call", async () => {
    // Two patches for one row would apply in array order and the loser would vanish silently,
    // which reads to the caller as though both landed.
    const { result } = run([
      { id: "tx_1", amount: 100 },
      { id: "tx_1", amount: 200 },
    ]);
    expect(await result).toEqual({ ok: false, reason: "DUPLICATE_ID" });
  });

  it("aborts without writing when the lease lapses mid-request", async () => {
    const { stub, result } = run([{ id: "tx_1", amount: 320 }], { permitted: false });

    expect(await result).toEqual({ ok: false, reason: "NO_LONGER_PERMITTED" });
    expect(stub.store.get("tx_1")!.amount).toBe(250);
  });

  // --- Dates (review #1) ---
  //
  // `resolveTransactionDate` fills a bare YYYY-MM-DD with the current clock, which is correct on
  // the create path and destructive here: the row already has a time. Read tools return
  // `localDate`, so a model correcting an amount and echoing the date back is the expected shape
  // of a call, not an exotic one.

  it("keeps the stored time when a bare date restates the day the row already has", async () => {
    const { stub, result } = run([{ id: "tx_1", amount: 320, date: "2026-08-25" }]);
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 09:00Z is 17:00 for a UTC+8 account. Filling it with the current clock would move a 17:00
    // purchase to whenever the request happened to arrive.
    expect(stub.store.get("tx_1")!.date).toEqual(new Date("2026-08-25T09:00:00.000Z"));
    // And the report would have claimed a change while printing an identical before and after,
    // since both render as the same local day.
    expect(r.updated[0].changed).toEqual(["amount"]);
  });

  it("carries the stored time onto a new day when a bare date re-dates the row", async () => {
    const { stub, result } = run([{ id: "tx_1", date: "2026-08-26" }]);
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The day moves, the time of day does not: a 17:00 dinner moved to the 26th is still 17:00.
    expect(stub.store.get("tx_1")!.date).toEqual(new Date("2026-08-26T09:00:00.000Z"));
    expect(r.updated[0].changed).toEqual(["date"]);
  });

  it("uses a supplied time as given", async () => {
    // A caller that names a time means it. Only the silent case is inferred.
    const { stub, result } = run([{ id: "tx_1", date: "2026-08-25T21:00" }]);
    await result;
    // 21:00 local at UTC+8 is 13:00Z.
    expect(stub.store.get("tx_1")!.date).toEqual(new Date("2026-08-25T13:00:00.000Z"));
  });

  it("preserves an absolute instant, which is what the app's own form sends", async () => {
    const { stub, result } = run([{ id: "tx_1", date: "2026-08-25T15:45:00.000Z" }]);
    await result;
    expect(stub.store.get("tx_1")!.date).toEqual(new Date("2026-08-25T15:45:00.000Z"));
  });

  // --- The category check only judges what the patch touches (review #2) ---

  it("lets an untouched row with a mismatched category still be edited", async () => {
    // Reachable without any MCP involvement: `PUT /api/categories/[id]` allows flipping a custom
    // category's type while its transactions keep pointing at it. Judging the stored pair on every
    // edit made those rows permanently uneditable -- a user could not fix a typo in the
    // description -- while preventing nothing, since the row is already in that state.
    const { stub, result } = run([{ id: "tx_1", description: "Fixed typo" }], {
      rows: [row({ categoryId: "cat_flipped" })],
      categories: [{ id: "cat_flipped", type: "INCOME" }],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    expect(stub.store.get("tx_1")!.description).toBe("Fixed typo");
  });

  it("still refuses a bare type flip on a row whose category was already mismatched", async () => {
    // The relaxation above must not reach the case the check exists for. `type` is in the patch,
    // so the pair is judged.
    const { result } = run([{ id: "tx_1", type: "INCOME" }]);
    expect(await result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
  });

  // --- Explicitly named labels that do not fit are reported (review #6) ---

  it("names an explicit label the type filter removed", async () => {
    const { result } = run([{ id: "tx_1", labelIds: ["lab_income_only"] }], {
      labels: [{ id: "lab_income_only", applicableTo: "INCOME", name: "Freelance" }],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated[0].droppedLabels).toEqual(["Freelance"]);
  });

  it("reports a dropped label even when nothing else changed", async () => {
    // The case that makes silence dangerous: the row already carries the label that fits, so
    // `changed` is empty and the reply is an unqualified success that ignored half the request.
    const { result } = run([{ id: "tx_1", labelIds: ["lab_work", "lab_income_only"] }], {
      rows: [row({ labels: [{ labelId: "lab_work", label: { name: "Work", applicableTo: "BOTH" } }] })],
      labels: [
        { id: "lab_work", applicableTo: "BOTH", name: "Work" },
        { id: "lab_income_only", applicableTo: "INCOME", name: "Freelance" },
      ],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated[0].changed).toEqual([]);
    expect(r.updated[0].droppedLabels).toEqual(["Freelance"]);
  });

  it("reports nothing dropped when every named label fits", async () => {
    const { result } = run([{ id: "tx_1", labelIds: ["lab_food"] }], {
      labels: [{ id: "lab_food", applicableTo: "BOTH", name: "Food" }],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated[0].droppedLabels).toEqual([]);
  });

  // --- Sub-second precision survives (review round 2, #2) ---

  it("preserves milliseconds when a bare date restates the stored day", async () => {
    // Rows carrying milliseconds are ordinary: `POST /api/bills/[id]/action` stamps bill payments
    // with a bare `new Date()`. Rebuilding the preserved time as an HH:mm:ss string and handing it
    // back to `resolveTransactionDate` silently truncates them, because the parser leaves the
    // fractional part non-capturing and rebuilds through `Date.UTC`, which takes no ms argument.
    // The instant then shifts by up to 999ms and reports a date change with an identical before
    // and after -- the exact failure preserving the time was meant to prevent.
    const stored = new Date("2026-09-05T14:23:45.678Z");
    const { stub, result } = run([{ id: "tx_1", amount: 14126, date: "2026-09-05" }], {
      rows: [row({ date: stored })],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(stub.store.get("tx_1")!.date).toEqual(stored);
    expect(r.updated[0].changed).toEqual(["amount"]);
  });

  it("carries milliseconds onto a new day too", async () => {
    const { stub, result } = run([{ id: "tx_1", date: "2026-09-06" }], {
      rows: [row({ date: new Date("2026-09-05T14:23:45.678Z") })],
    });
    await result;
    expect(stub.store.get("tx_1")!.date).toEqual(new Date("2026-09-06T14:23:45.678Z"));
  });

  // --- The category carve-out keys on movement, not on mention (review round 2, #3) ---

  it("lets the app resubmit an unchanged mismatched pair", async () => {
    // `transactionSchema` requires `categoryId` and the edit form posts the whole object, so every
    // browser edit *names* both fields. A carve-out testing whether they were mentioned therefore
    // never fired for the one path it was written for; only comparing against the stored row does.
    const { stub, result } = run(
      [{ id: "tx_1", description: "Typo fixed", type: "EXPENSE", categoryId: "cat_flipped" }],
      {
        rows: [row({ categoryId: "cat_flipped" })],
        categories: [{ id: "cat_flipped", type: "INCOME" }],
      }
    );
    const r = await result;

    expect(r.ok).toBe(true);
    expect(stub.store.get("tx_1")!.description).toBe("Typo fixed");
  });

  it("still checks a pair that genuinely moves", async () => {
    const { result } = run([{ id: "tx_1", categoryId: "cat_salary" }]);
    expect(await result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
  });

  // --- A label removed by a changed type is explained (review round 2, #4) ---

  it("names a label a changed type removed, even though nobody listed it", async () => {
    // The implicit half of the same event. `changed` and `previous.labels` show the label leaving
    // but never why, and an unexplained disappearance reads as a bug in the tool.
    const { result } = run([{ id: "tx_1", type: "INCOME", categoryId: "cat_salary" }], {
      rows: [
        row({
          labels: [{ labelId: "lab_exp", label: { name: "Groceries", applicableTo: "EXPENSE" } }],
        }),
      ],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated[0].droppedLabels).toEqual(["Groceries"]);
  });

  it("says nothing about preserved labels that still fit", async () => {
    const { result } = run([{ id: "tx_1", type: "INCOME", categoryId: "cat_salary" }], {
      rows: [row({ labels: [{ labelId: "lab_both", label: { name: "Work", applicableTo: "BOTH" } }] })],
    });
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated[0].droppedLabels).toEqual([]);
  });

  // --- A doomed request is not advertised as retryable (review round 4) ---

  it("reports a vanished reference as rejected, not as worth retrying", async () => {
    // The ownership checks run on `prisma`, outside the write transaction, so a category deleted
    // in the window between them and the write surfaces as a foreign-key violation. Reporting it
    // as WRITE_FAILED tells an agent to "try the same request again", which can only ever fail
    // the same way -- a loop rather than an error.
    const fk = new Prisma.PrismaClientKnownRequestError("FK violation", {
      code: "P2003",
      clientVersion: "6.19.2",
    });
    const { result } = run([{ id: "tx_1", amount: 320 }], { throwOnWrite: fk });
    expect(await result).toEqual({ ok: false, reason: "WRITE_REJECTED" });
  });

  it("still reports an unrecognised failure as retryable", async () => {
    // A dropped connection or a deadlock is the opposite case and deserves another attempt.
    const { result } = run([{ id: "tx_1", amount: 320 }], {
      throwOnWrite: new Error("connection reset"),
    });
    expect(await result).toEqual({ ok: false, reason: "WRITE_FAILED" });
  });

  // --- The audit stamp follows the change, not the request (review round 5) ---

  it("leaves the trail alone when nothing actually moved", async () => {
    // The app's form posts every field on every save, so pressing Update with no edits names all
    // five and moves none. Stamping on the request rather than the change rewrote `updated_via`
    // to APP and nulled the token id, erasing a genuine MCP trail for something that never
    // happened -- the fabricated trail the bulk route goes out of its way not to write.
    const { stub, result } = run(
      [
        {
          id: "tx_1",
          amount: 250,
          description: "Grab to office",
          type: "EXPENSE",
          categoryId: "cat_transport",
        },
      ],
      { rows: [row({ updatedVia: "MCP", updatedByMcpTokenId: "tok_old" })] }
    );
    const r = await result;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated[0].changed).toEqual([]);

    const after = stub.store.get("tx_1")! as unknown as Record<string, unknown>;
    expect(after.updatedVia).toBe("MCP");
    expect(after.updatedByMcpTokenId).toBe("tok_old");

    // No write at all, not merely no stamp. `updatedAt` carries `@updatedAt`, so any `update()`
    // bumps it whatever the data says, and a no-op patch would go on looking freshly edited in
    // the one column left that records when.
    expect(updateSpy(stub)).not.toHaveBeenCalled();
  });

  it("stamps as soon as one field does move", async () => {
    const { stub, result } = run([{ id: "tx_1", amount: 320 }], {
      rows: [row({ updatedVia: "MCP", updatedByMcpTokenId: "tok_old" })],
    });
    await result;

    const after = stub.store.get("tx_1")! as unknown as Record<string, unknown>;
    expect(after.updatedVia).toBe("MCP");
    expect(after.updatedByMcpTokenId).toBe("tok_1");
  });

  it("stamps when only the labels moved", async () => {
    // A label-only edit writes no scalar at all, so a stamp keyed on the scalar write would miss
    // it and the row would keep naming whoever last touched its amount.
    const { stub, result } = run([{ id: "tx_1", labelIds: [] }], {
      rows: [
        row({
          updatedVia: "APP",
          updatedByMcpTokenId: null,
          labels: [{ labelId: "lab_work", label: { name: "Work", applicableTo: "BOTH" } }],
        }),
      ],
    });
    await result;

    const after = stub.store.get("tx_1")! as unknown as Record<string, unknown>;
    expect(after.updatedVia).toBe("MCP");
    expect(after.updatedByMcpTokenId).toBe("tok_1");
  });
});
