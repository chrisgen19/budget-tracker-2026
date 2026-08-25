import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTransactionBatch } from "./transaction-writes";
import type { PrismaClient } from "./budget-query-types";
import type { BatchTransactionInput } from "./validations";

vi.mock("@/lib/schedule-server", () => ({
  // No scheduled labels in these tests: a null context is the short-circuit the real helper
  // returns for a user with none, so auto-labelling resolves to nothing.
  getScheduleContext: vi.fn(async () => null),
  matchScheduledLabel: vi.fn(() => null),
}));

const ITEM: BatchTransactionInput = {
  amount: 100,
  description: "Coffee",
  type: "EXPENSE",
  date: "2026-08-25",
  categoryId: "cat_own",
  labelIds: [],
};

interface StubOptions {
  /** Category ids the caller may use: their own plus the shared defaults. */
  usableCategoryIds?: string[];
  ownedLabels?: { id: string; applicableTo: string }[];
}

/** Minimal Prisma stub. Records what was written so the assertions can inspect it. */
const makePrisma = ({ usableCategoryIds = ["cat_own"], ownedLabels = [] }: StubOptions = {}) => {
  const created: Record<string, unknown>[] = [];

  const client = {
    category: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => usableCategoryIds.includes(id)).map((id) => ({ id }))
      ),
    },
    label: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        ownedLabels.filter((l) => where.id.in.includes(l.id))
      ),
    },
    transaction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `tx_${created.length}`, ...data };
      }),
      findMany: vi.fn(async () => []),
    },
    // Array form is the unkeyed path; the callback form is only used by the keyed path.
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)
    ),
    $executeRaw: vi.fn(async () => 1),
  };

  return { client: client as unknown as PrismaClient, created, raw: client };
};

beforeEach(() => vi.clearAllMocks());

describe("createTransactionBatch", () => {
  it("stamps the provenance it was told, not anything from the caller's input", async () => {
    const { client, created } = makePrisma();

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      createdVia: "MCP",
      mcpTokenId: "tok_1",
    });

    expect(result.ok).toBe(true);
    expect(created[0].createdVia).toBe("MCP");
    expect(created[0].mcpTokenId).toBe("tok_1");
  });

  it("records APP with no token id for app writes", async () => {
    const { client, created } = makePrisma();

    await createTransactionBatch({ prisma: client, userId: "u1", items: [ITEM], createdVia: "APP" });

    expect(created[0].createdVia).toBe("APP");
    expect(created[0]).not.toHaveProperty("mcpTokenId");
  });

  it("rejects a category that is not the caller's and writes nothing", async () => {
    // The foreign key alone is satisfied by any category that exists, including another user's,
    // so ownership has to be checked explicitly. This matters most for MCP, where the id comes
    // from a model over an internet-facing endpoint.
    const { client, created, raw } = makePrisma({ usableCategoryIds: ["cat_own"] });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, categoryId: "cat_someone_else" }],
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
    expect(created).toHaveLength(0);
    expect(raw.transaction.create).not.toHaveBeenCalled();
  });

  it("accepts a shared default category", async () => {
    // Defaults have `userId: null` and belong to everyone; the query ORs them in.
    const { client } = makePrisma({ usableCategoryIds: ["cat_own", "cat_default"] });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, categoryId: "cat_default" }],
      createdVia: "MCP",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a label that is not the caller's and writes nothing", async () => {
    const { client, created } = makePrisma({ ownedLabels: [] });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: ["lbl_theirs"] }],
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: false, reason: "LABELS_NOT_OWNED" });
    expect(created).toHaveLength(0);
  });

  it("drops an owned label whose type does not apply, without failing the write", async () => {
    const { client, created } = makePrisma({
      ownedLabels: [{ id: "lbl_income_only", applicableTo: "INCOME" }],
    });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, type: "EXPENSE", labelIds: ["lbl_income_only"] }],
      createdVia: "MCP",
    });

    expect(result.ok).toBe(true);
    expect(created[0]).not.toHaveProperty("labels");
  });

  it("attaches an owned label that applies to both types", async () => {
    const { client, created } = makePrisma({
      ownedLabels: [{ id: "lbl_both", applicableTo: "BOTH" }],
    });

    await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: ["lbl_both", "lbl_both"] }],
      createdVia: "MCP",
    });

    // Deduped: the same id twice must not violate the unique constraint on TransactionLabel.
    expect(created[0].labels).toEqual({ createMany: { data: [{ labelId: "lbl_both" }] } });
  });

  it("takes the advisory lock only when a key is supplied", async () => {
    const unkeyed = makePrisma();
    await createTransactionBatch({
      prisma: unkeyed.client,
      userId: "u1",
      items: [ITEM],
      createdVia: "APP",
    });
    expect(unkeyed.raw.$executeRaw).not.toHaveBeenCalled();

    const keyed = makePrisma();
    await createTransactionBatch({
      prisma: keyed.client,
      userId: "u1",
      items: [ITEM],
      clientBatchId: "b1",
      createdVia: "APP",
    });
    expect(keyed.raw.$executeRaw).toHaveBeenCalled();
  });

  it("returns the original rows as a replay rather than writing again", async () => {
    const { client, raw } = makePrisma();
    const original = [{ id: "tx_original" }];
    raw.transaction.findMany = vi.fn(async () => original) as typeof raw.transaction.findMany;

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      clientBatchId: "b1",
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: true, transactions: original, replayed: true });
    expect(raw.transaction.create).not.toHaveBeenCalled();
  });

  it("reports UNKNOWN_WHETHER_SAVED when the keyed write fails", async () => {
    // A caller must not read this as "nothing was written": the correct response is to retry with
    // the same key, which replays, rather than a fresh one, which would duplicate.
    const { client, raw } = makePrisma();
    raw.$transaction = vi.fn(async () => {
      throw new Error("lock timeout");
    }) as typeof raw.$transaction;

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      clientBatchId: "b1",
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: false, reason: "UNKNOWN_WHETHER_SAVED" });
  });
});
