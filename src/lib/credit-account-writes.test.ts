import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  createCreditPayment,
  deleteCreditAccount,
  localDayStart,
  localTodayKey,
  updateCreditAccount,
  updateCreditPayment,
} from "./credit-account-writes";
import type { PrismaClient } from "./budget-query-types";

const MANILA = -480;

interface StubOptions {
  account?: { id?: string; name?: string; isActive: boolean } | null;
  purchaseCount?: number;
  paymentCount?: number;
  updatedPayments?: number;
  deleteError?: unknown;
  nameClash?: boolean;
}

/** Prisma stubbed down to what the card writes call. */
const stub = ({
  account = { id: "card-1", name: "BPI", isActive: true },
  purchaseCount = 0,
  paymentCount = 0,
  updatedPayments = 1,
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
    creditPayment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pay-1", ...data })),
      count: vi.fn(async () => paymentCount),
      updateMany: vi.fn(async () => ({ count: updatedPayments })),
      findUniqueOrThrow: vi.fn(async () => ({ id: "pay-1" })),
    },
    transaction: { count: vi.fn(async () => purchaseCount) },
  };
  return { prisma: client as unknown as PrismaClient, client };
};

describe("date helpers", () => {
  it("stores a calendar day as the start of that day in the user's timezone", () => {
    expect(localDayStart("2026-08-25", MANILA).toISOString()).toBe("2026-08-24T16:00:00.000Z");
  });

  it("reads today as the user's calendar day, not UTC's", () => {
    expect(localTodayKey(MANILA, new Date("2026-09-13T17:00:00.000Z"))).toBe("2026-09-14");
  });
});

describe("createCreditPayment", () => {
  const pay = (prisma: PrismaClient) =>
    createCreditPayment({
      prisma,
      userId: "user-1",
      accountId: "card-1",
      input: { kind: "PAYMENT", amount: 5000, description: "BPI app", date: "2026-09-05" },
      timezoneOffset: MANILA,
    });

  it("records the payment on the user's calendar day with APP provenance", async () => {
    const { prisma, client } = stub();

    expect((await pay(prisma)).ok).toBe(true);
    expect(client.creditPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "PAYMENT",
        amount: 5000,
        accountId: "card-1",
        userId: "user-1",
        createdVia: "APP",
        date: new Date("2026-09-04T16:00:00.000Z"),
      }),
    });
  });

  it("refuses a card that is not the caller's", async () => {
    const { prisma, client } = stub({ account: null });

    expect(await pay(prisma)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(client.creditPayment.create).not.toHaveBeenCalled();
  });

  it("refuses a payment on an archived card", async () => {
    const { prisma, client } = stub({ account: { isActive: false } });

    expect(await pay(prisma)).toEqual({ ok: false, reason: "ACCOUNT_ARCHIVED" });
    expect(client.creditPayment.create).not.toHaveBeenCalled();
  });
});

describe("updateCreditPayment", () => {
  it("scopes the edit to the caller's own payment on that card", async () => {
    const { prisma, client } = stub({ updatedPayments: 0 });

    const result = await updateCreditPayment({
      prisma,
      userId: "user-1",
      accountId: "card-1",
      paymentId: "someone-elses",
      patch: { amount: 1 },
      timezoneOffset: MANILA,
    });

    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(client.creditPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses", accountId: "card-1", userId: "user-1" } })
    );
  });

  it("resolves a corrected date to the user's day", async () => {
    const { prisma, client } = stub();

    await updateCreditPayment({
      prisma,
      userId: "user-1",
      accountId: "card-1",
      paymentId: "pay-1",
      patch: { date: "2026-09-06" },
      timezoneOffset: MANILA,
    });

    expect(client.creditPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { date: new Date("2026-09-05T16:00:00.000Z") } })
    );
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

  it("archives a card with a purchase, so the purchase keeps its card", async () => {
    const { prisma, client } = stub({ purchaseCount: 1 });

    expect(await remove(prisma)).toEqual({ ok: true, outcome: "archived" });
    expect(client.creditAccount.delete).not.toHaveBeenCalled();
  });

  it("archives a card with a payment", async () => {
    const { prisma } = stub({ paymentCount: 1 });

    expect(await remove(prisma)).toEqual({ ok: true, outcome: "archived" });
  });

  it("archives when a purchase lands between the count and the delete", async () => {
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

    expect(await update(prisma, { name: "Metrobank" })).toEqual({ ok: false, reason: "DUPLICATE_NAME" });
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
      expect.objectContaining({ data: { openingBalanceDate: new Date("2026-08-31T16:00:00.000Z") } })
    );
  });
});
