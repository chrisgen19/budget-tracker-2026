import { describe, it, expect, vi } from "vitest";
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
  labels?: { id: string; applicableTo: string }[];
  permitted?: boolean;
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
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };

  return {
    prisma: client as unknown as PrismaClient,
    store,
    labelWrites,
    permitted,
  };
};

const run = (patches: TransactionPatch[], opts: StubOptions = {}) => {
  const stub = makePrisma(opts);
  return {
    stub,
    result: updateTransactions({
      prisma: stub.prisma,
      userId: "user_1",
      patches,
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
      labels: [{ id: "lab_food", applicableTo: "BOTH" }],
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
});
