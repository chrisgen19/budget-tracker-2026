import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  createCreditCharges,
  deleteCreditAccount,
  localDayStart,
  localTodayKey,
  updateCreditAccount,
} from "./credit-account-writes";
import type { PrismaClient } from "./budget-query-types";
import type { CreditChargeInput } from "./validations";

const MANILA = -480;

const CHARGE: CreditChargeInput = {
  kind: "CHARGE",
  amount: 1424.15,
  description: "Anthropic* Claude Sub",
  date: "2026-08-25",
  categoryId: "cat-subs",
  originalAmount: 22.4,
  originalCurrency: "USD",
};

interface StubOptions {
  account?: { id?: string; name?: string; isActive: boolean } | null;
  usableCategoryIds?: string[];
  chargeCount?: number;
  paymentCount?: number;
  deleteError?: unknown;
  nameClash?: boolean;
}

/** Prisma stubbed down to what the card writes call. `$transaction` runs the callback on itself. */
const stub = ({
  account = { id: "card-1", name: "BPI", isActive: true },
  usableCategoryIds = ["cat-subs"],
  chargeCount = 0,
  paymentCount = 0,
  deleteError,
  nameClash = false,
}: StubOptions = {}) => {
  const client = {
    creditAccount: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        "isActive" in where ? (nameClash ? { id: "card-2" } : null) : account
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...account, ...data })),
      delete: vi.fn(async () => {
        if (deleteError) throw deleteError;
        return account;
      }),
    },
    creditCharge: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "charge-1", ...data })),
      count: vi.fn(async () => chargeCount),
    },
    transaction: { count: vi.fn(async () => paymentCount) },
    // The locking category read inside `categoriesAreUsableForWrite`: (sql, ids, userId).
    $queryRaw: vi.fn(async (_sql: unknown, ids: string[]) =>
      ids.filter((id) => usableCategoryIds.includes(id)).map((id) => ({ id, type: "EXPENSE" }))
    ),
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(client)),
  };
  return { prisma: client as unknown as PrismaClient, client };
};

describe("date helpers", () => {
  it("stores a statement day as the start of that day in the user's timezone", () => {
    expect(localDayStart("2026-08-25", MANILA).toISOString()).toBe("2026-08-24T16:00:00.000Z");
  });

  it("reads today as the user's calendar day, not UTC's", () => {
    expect(localTodayKey(MANILA, new Date("2026-09-13T17:00:00.000Z"))).toBe("2026-09-14");
  });
});

describe("createCreditCharges", () => {
  const create = (prisma: PrismaClient, items = [CHARGE]) =>
    createCreditCharges({ prisma, userId: "user-1", accountId: "card-1", items, timezoneOffset: MANILA });

  it("writes each line against the card with the user's calendar day and APP provenance", async () => {
    const { prisma, client } = stub();

    const result = await create(prisma);

    expect(result.ok).toBe(true);
    expect(client.creditCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: "card-1",
          userId: "user-1",
          createdVia: "APP",
          date: new Date("2026-08-24T16:00:00.000Z"),
          originalAmount: 22.4,
          originalCurrency: "USD",
        }),
      })
    );
  });

  it("refuses a card that is not the caller's, and writes nothing", async () => {
    const { prisma, client } = stub({ account: null });

    expect(await create(prisma)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(client.creditCharge.create).not.toHaveBeenCalled();
  });

  it("refuses new charges on an archived card", async () => {
    const { prisma, client } = stub({ account: { isActive: false } });

    expect(await create(prisma)).toEqual({ ok: false, reason: "ACCOUNT_ARCHIVED" });
    expect(client.creditCharge.create).not.toHaveBeenCalled();
  });

  it("refuses the whole statement when one line's category is unusable", async () => {
    const { prisma, client } = stub({ usableCategoryIds: ["cat-subs"] });

    const result = await create(prisma, [CHARGE, { ...CHARGE, categoryId: "someone-elses" }]);

    expect(result).toEqual({ ok: false, reason: "CATEGORIES_NOT_USABLE" });
    expect(client.creditCharge.create).not.toHaveBeenCalled();
  });
});

describe("deleteCreditAccount", () => {
  const remove = (prisma: PrismaClient) =>
    deleteCreditAccount({ prisma, userId: "user-1", accountId: "card-1" });

  it("deletes a card with no history", async () => {
    const { prisma, client } = stub();

    expect(await remove(prisma)).toEqual({ ok: true, outcome: "deleted" });
    expect(client.creditAccount.update).not.toHaveBeenCalled();
  });

  it("archives a card with a payment, so the payment never claims to pay nothing", async () => {
    const { prisma, client } = stub({ paymentCount: 1 });

    expect(await remove(prisma)).toEqual({ ok: true, outcome: "archived" });
    expect(client.creditAccount.delete).not.toHaveBeenCalled();
    expect(client.creditAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } })
    );
  });

  it("archives when a charge lands between the count and the delete", async () => {
    const { prisma } = stub({
      deleteError: new Prisma.PrismaClientKnownRequestError("foreign key", {
        code: "P2003",
        clientVersion: "6.19.2",
      }),
    });

    expect(await remove(prisma)).toEqual({ ok: true, outcome: "archived" });
  });

  it("rethrows a failure that is not the foreign key", async () => {
    const { prisma } = stub({ deleteError: new Error("connection lost") });

    await expect(remove(prisma)).rejects.toThrow("connection lost");
  });
});

describe("updateCreditAccount", () => {
  const update = (prisma: PrismaClient, patch: Record<string, unknown>) =>
    updateCreditAccount({ prisma, userId: "user-1", accountId: "card-1", patch, timezoneOffset: MANILA });

  it("refuses a rename onto another active card's name", async () => {
    const { prisma, client } = stub({ nameClash: true });

    expect(await update(prisma, { name: "Metrobank" })).toEqual({
      ok: false,
      reason: "DUPLICATE_NAME",
    });
    expect(client.creditAccount.update).not.toHaveBeenCalled();
  });

  it("does not look for a clash when the name only changes case", async () => {
    const { prisma } = stub({ nameClash: true });

    expect((await update(prisma, { name: "bpi" })).ok).toBe(true);
  });

  it("resolves a new opening balance date to the user's day", async () => {
    const { prisma, client } = stub();

    await update(prisma, { openingBalanceDate: "2026-09-01" });

    expect(client.creditAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { openingBalanceDate: new Date("2026-08-31T16:00:00.000Z") },
      })
    );
  });
});
