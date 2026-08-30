import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTransactionBatch } from "./transaction-writes";
import type { PrismaClient } from "./budget-query-types";
import type { BatchTransactionInput } from "./validations";

const scheduleMock = vi.hoisted(() => ({
  getScheduleContext: vi.fn(async (): Promise<unknown> => null),
  matchScheduledLabel: vi.fn((): string | null => null),
}));

vi.mock("@/lib/schedule-server", () => scheduleMock);

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
  /** Type every stub category reports, so type-mismatch rejection is testable. */
  categoryType?: "INCOME" | "EXPENSE" | "TRANSFER";
  /** Account ids that are the caller's and still active. */
  usableAccountIds?: string[];
}

/** Minimal Prisma stub. Records what was written so the assertions can inspect it. */
const makePrisma = ({
  usableCategoryIds = ["cat_own"],
  ownedLabels = [],
  categoryType = "EXPENSE",
  usableAccountIds = ["acct_own", "acct_other_own"],
}: StubOptions = {}) => {
  const created: Record<string, unknown>[] = [];

  const client = {
    category: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => usableCategoryIds.includes(id))
          .map((id) => ({ id, type: categoryType }))
      ),
    },
    label: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        ownedLabels.filter((l) => where.id.in.includes(l.id))
      ),
    },
    account: {
      count: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => usableAccountIds.includes(id)).length
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

describe("scheduled label auto-application", () => {
  beforeEach(() => {
    // A user who *does* have a matching schedule, so the difference between undefined and []
    // is observable rather than hypothetical.
    scheduleMock.getScheduleContext.mockResolvedValue({ labels: [], timezoneOffset: -480 });
    scheduleMock.matchScheduledLabel.mockReturnValue("lbl_scheduled");
  });

  it("auto-applies a scheduled label when labelIds is undefined", () => {
    // This is what the app's own form relies on, so it must keep working.
    const { client, created } = makePrisma();
    return createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: undefined }],
      createdVia: "APP",
    }).then(() => {
      expect(created[0].labels).toEqual({
        createMany: { data: [{ labelId: "lbl_scheduled" }] },
      });
    });
  });

  it("applies nothing when labelIds is an explicit empty array", async () => {
    // The MCP tool normalises undefined to [] before calling this, because schedules match on
    // time of day and weekday: they describe when the user spent, not when a model typed it in.
    const { client, created } = makePrisma();

    await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: [] }],
      createdVia: "MCP",
    });

    expect(created[0]).not.toHaveProperty("labels");
  });
});

describe("category type consistency", () => {
  it("rejects an expense filed under an income category", async () => {
    // Internally inconsistent, and it would distort every breakdown that groups by category. The
    // app's form cannot produce it because the picker filters by type; a model can.
    const { client, created } = makePrisma({ categoryType: "INCOME" });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, type: "EXPENSE" }],
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: false, reason: "CATEGORIES_NOT_OWNED" });
    expect(created).toHaveLength(0);
  });

  it("accepts a matching type", async () => {
    const { client } = makePrisma({ categoryType: "EXPENSE" });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, type: "EXPENSE" }],
      createdVia: "MCP",
    });

    expect(result.ok).toBe(true);
  });
});

describe("replay beats validation of mutable references", () => {
  it("returns a committed batch even when a label it used has since been deleted", async () => {
    // The batch committed but its response was lost, and the label was deleted before the retry.
    // Validating first would answer LABELS_NOT_OWNED, which the caller reads as "nothing was
    // written", and a resubmit under a fresh key would duplicate the transaction.
    const { client, raw } = makePrisma({ ownedLabels: [] });
    const original = [{ id: "tx_original" }];
    raw.transaction.findMany = vi.fn(async () => original) as typeof raw.transaction.findMany;

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: ["lbl_since_deleted"] }],
      clientBatchId: "b1",
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: true, transactions: original, replayed: true });
    expect(raw.transaction.create).not.toHaveBeenCalled();

    // The outcome alone does not pin the fix: the locked re-check on the rejection path returns
    // the same rows, so the test passed even with the early branch removed. Asserting that the
    // mutable references were never consulted is what makes this fail if replay moves back
    // behind validation.
    expect(raw.label.findMany).not.toHaveBeenCalled();
    expect(raw.category.findMany).not.toHaveBeenCalled();
  });

  it("still rejects an unknown label on a first attempt", async () => {
    // No saved batch under this key, so the rejection is the right answer.
    const { client, created } = makePrisma({ ownedLabels: [] });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: ["lbl_theirs"] }],
      clientBatchId: "b_fresh",
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: false, reason: "LABELS_NOT_OWNED" });
    expect(created).toHaveLength(0);
  });

  it("reports unknown, not a rejection, when the lock cannot be taken", async () => {
    // Returning the 4xx here would tell the caller nothing was written, which we cannot know.
    const { client, raw } = makePrisma({ ownedLabels: [] });
    let call = 0;
    raw.$transaction = vi.fn(async (arg: unknown) => {
      call += 1;
      if (call === 1) throw new Error("lock timeout");
      return Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(raw);
    }) as typeof raw.$transaction;

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: ["lbl_theirs"] }],
      clientBatchId: "b1",
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: false, reason: "UNKNOWN_WHETHER_SAVED" });
  });
});

describe("permission re-checked at the moment of the write", () => {
  it("writes nothing when permission is withdrawn mid-flight", async () => {
    // The lease is read when the request arrives, and a batch can hold a transaction for up to a
    // minute. Without this the kill switch would only refuse the *next* request while letting an
    // in-flight one commit, which is a request-admission check rather than a kill switch.
    const { client, created } = makePrisma();

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      clientBatchId: "b1",
      createdVia: "MCP",
      assertStillPermitted: async () => false,
    });

    expect(result).toEqual({ ok: false, reason: "NO_LONGER_PERMITTED" });
    expect(created).toHaveLength(0);
  });

  it("writes normally when permission still holds", async () => {
    const { client, created } = makePrisma();

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      clientBatchId: "b1",
      createdVia: "MCP",
      assertStillPermitted: async () => true,
    });

    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("still replays a committed batch even when permission has been withdrawn", async () => {
    // A replay writes nothing, so the kill switch has nothing to stop. Refusing it would leave
    // the caller unable to resolve an ambiguous outcome, which is how duplicates get made.
    const { client, raw } = makePrisma();
    const original = [{ id: "tx_original" }];
    raw.transaction.findMany = vi.fn(async () => original) as typeof raw.transaction.findMany;

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      clientBatchId: "b1",
      createdVia: "MCP",
      assertStillPermitted: async () => false,
    });

    expect(result).toEqual({ ok: true, transactions: original, replayed: true });
  });

  it("is not consulted at all when the caller supplies no check", async () => {
    // The app route never passes one, and must keep behaving exactly as before.
    const { client, created } = makePrisma();

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      clientBatchId: "b1",
      createdVia: "APP",
    });

    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
  });
});

describe("createTransactionBatch accounts and transfers", () => {
  const transfer: BatchTransactionInput = {
    amount: 255,
    description: "BPI card payment",
    type: "TRANSFER",
    date: "2026-08-05",
    categoryId: "cat_own",
    labelIds: [],
    accountId: "acct_own",
    transferAccountId: "acct_other_own",
  };

  it("writes both sides of a transfer", async () => {
    const { client, created } = makePrisma({ categoryType: "TRANSFER" });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [transfer],
      createdVia: "APP",
    });

    expect(result.ok).toBe(true);
    expect(created[0].accountId).toBe("acct_own");
    expect(created[0].transferAccountId).toBe("acct_other_own");
  });

  it("refuses an account that is not the caller's", async () => {
    // The foreign key proves the account exists, not whose it is. Without the ownership check a
    // caller supplying someone else's id would move a stranger's balance.
    const { client, created } = makePrisma({ usableAccountIds: ["acct_own"] });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, accountId: "acct_someone_else" }],
      createdVia: "MCP",
    });

    expect(result).toEqual({ ok: false, reason: "ACCOUNTS_NOT_OWNED" });
    expect(created).toHaveLength(0);
  });

  it("refuses an archived account", async () => {
    // Archiving is how an account is retired, so writing to one would quietly bring it back into
    // every balance. The stub reports only active accounts, matching the `isActive` filter.
    const { client } = makePrisma({ usableAccountIds: [] });

    const result = await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, accountId: "acct_archived" }],
      createdVia: "APP",
    });

    expect(result).toEqual({ ok: false, reason: "ACCOUNTS_NOT_OWNED" });
  });

  it("never auto-labels a transfer", async () => {
    // Label schedules classify spending by when it happened. A card bill settled on a Tuesday
    // afternoon would land inside a weekday work window and divert half its amount into a
    // spending label via getLabelBreakdown.
    scheduleMock.getScheduleContext.mockResolvedValueOnce({ rules: [] });
    scheduleMock.matchScheduledLabel.mockReturnValue("label_work");

    const { client, created } = makePrisma({ categoryType: "TRANSFER" });
    await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...transfer, labelIds: undefined }],
      createdVia: "APP",
    });

    expect(created[0].labels).toBeUndefined();
    scheduleMock.matchScheduledLabel.mockReturnValue(null);
  });

  it("still auto-labels an ordinary expense", async () => {
    scheduleMock.getScheduleContext.mockResolvedValueOnce({ rules: [] });
    scheduleMock.matchScheduledLabel.mockReturnValue("label_work");

    const { client, created } = makePrisma();
    await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [{ ...ITEM, labelIds: undefined }],
      createdVia: "APP",
    });

    expect(created[0].labels).toBeDefined();
    scheduleMock.matchScheduledLabel.mockReturnValue(null);
  });

  it("does not query accounts when no item names one", async () => {
    const { client, raw } = makePrisma();
    await createTransactionBatch({
      prisma: client,
      userId: "u1",
      items: [ITEM],
      createdVia: "APP",
    });
    expect(raw.account.count).not.toHaveBeenCalled();
  });
});
