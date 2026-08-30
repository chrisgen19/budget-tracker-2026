import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getAccountBalances } from "./account-balances";

const CHECKING = {
  id: "checking",
  userId: "u1",
  name: "BPI Checking",
  type: "BANK" as const,
  openingBalance: 10_000,
  creditLimit: null,
  isActive: true,
  color: "#000000",
  icon: "Landmark",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const CARD = {
  ...CHECKING,
  id: "bpi-card",
  name: "BPI Amore Cashback",
  type: "CREDIT_CARD" as const,
  openingBalance: 0,
  creditLimit: 50_000,
  icon: "CreditCard",
};

interface Group {
  accountId?: string | null;
  transferAccountId?: string | null;
  type?: string;
  amount: number;
  count?: number;
}

/**
 * Stub Prisma with the two grouped reads `getAccountBalances` makes: spending and transfers *out*
 * keyed on `accountId`, and transfers *in* keyed on `transferAccountId`.
 */
const stub = (accounts: unknown[], bySource: Group[], inbound: Group[]) =>
  ({
    account: { findMany: vi.fn(async () => accounts) },
    transaction: {
      groupBy: vi.fn(async ({ by }: { by: string[] }) =>
        by.includes("transferAccountId")
          ? inbound.map((g) => ({
              transferAccountId: g.transferAccountId,
              _sum: { amount: g.amount },
              _count: { _all: g.count ?? 1 },
            }))
          : bySource.map((g) => ({
              accountId: g.accountId,
              type: g.type,
              _sum: { amount: g.amount },
              _count: { _all: g.count ?? 1 },
            }))
      ),
    },
  }) as unknown as PrismaClient;

describe("getAccountBalances", () => {
  it("counts an expense on a credit card as debt, not as a lower cash balance", async () => {
    const [card] = await getAccountBalances(
      stub([CARD], [{ accountId: "bpi-card", type: "EXPENSE", amount: 255 }], []),
      "u1"
    );

    expect(card.balance).toBe(-255);
    expect(card.outstanding).toBe(255);
    expect(card.availableCredit).toBe(49_745);
  });

  it("settles a card with a transfer without touching either side twice", async () => {
    // The scenario the feature exists for: a 255 ride charged to the card in July, then the card
    // bill paid from checking in August. Checking is down 255 exactly once, and the card is clear.
    const balances = await getAccountBalances(
      stub(
        [CHECKING, CARD],
        [
          { accountId: "bpi-card", type: "EXPENSE", amount: 255 },
          { accountId: "checking", type: "TRANSFER", amount: 255 },
        ],
        [{ transferAccountId: "bpi-card", amount: 255 }]
      ),
      "u1"
    );

    const checking = balances.find((b) => b.id === "checking")!;
    const card = balances.find((b) => b.id === "bpi-card")!;

    expect(checking.balance).toBe(9_745);
    expect(card.balance).toBe(0);
    expect(card.outstanding).toBe(0);
  });

  it("reads a fully paid card as 0 owed rather than -0", async () => {
    // `-(0)` is negative zero, which formats as "-0.00": a paid-off card appearing to owe a
    // negative amount.
    const [card] = await getAccountBalances(stub([CARD], [], []), "u1");
    expect(Object.is(card.outstanding, -0)).toBe(false);
    expect(card.outstanding).toBe(0);
  });

  it("leaves `outstanding` null for accounts that are not liabilities", async () => {
    const [checking] = await getAccountBalances(stub([CHECKING], [], []), "u1");
    expect(checking.outstanding).toBeNull();
    expect(checking.availableCredit).toBeNull();
  });

  it("adds transfers in and subtracts transfers out for the same account", async () => {
    const [checking] = await getAccountBalances(
      stub(
        [CHECKING],
        [{ accountId: "checking", type: "TRANSFER", amount: 3_000 }],
        [{ transferAccountId: "checking", amount: 500 }]
      ),
      "u1"
    );

    expect(checking.balance).toBe(10_000 - 3_000 + 500);
    expect(checking.inflow).toBe(500);
    expect(checking.outflow).toBe(3_000);
  });

  it("includes the whole local day when a window ends on one", async () => {
    // A `to` resolved to midnight would drop everything that happened on the day asked for.
    const prisma = stub([CHECKING], [], []);
    await getAccountBalances(prisma, "u1", { asOf: "2026-08-30", timezoneOffset: -480 });

    const groupBy = (prisma.transaction.groupBy as unknown as ReturnType<typeof vi.fn>);
    const where = groupBy.mock.calls[0][0].where as { date: { lte: Date } };
    // 23:59:59.999 on 30 August in Manila is 15:59:59.999Z the same day.
    expect(where.date.lte.toISOString()).toBe("2026-08-30T15:59:59.999Z");
  });

  it("queries nothing when the user has no accounts", async () => {
    const prisma = stub([], [], []);
    expect(await getAccountBalances(prisma, "u1")).toEqual([]);
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
  });
});
