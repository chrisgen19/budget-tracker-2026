import { describe, expect, it, vi } from "vitest";
import { checkCardPayments } from "./card-payment-rule";
import { CARD_PAYMENT_CATEGORY_NAME } from "./default-categories";
import type { PrismaClient } from "./budget-query-types";

interface StubOptions {
  /** Cards the caller owns. Anything else reads as someone else's. */
  accounts?: { id: string; isActive: boolean }[];
  /** Ids the payment-category query matches. */
  paymentCategoryIds?: string[];
}

const stub = ({
  accounts = [{ id: "card-1", isActive: true }],
  paymentCategoryIds = ["cat-pay"],
}: StubOptions = {}) => {
  const client = {
    creditAccount: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        accounts.filter((account) => where.id.in.includes(account.id))
      ),
    },
    category: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => paymentCategoryIds.includes(id)).map((id) => ({ id }))
      ),
    },
  };
  return { db: client as unknown as PrismaClient, client };
};

const payment = { creditAccountId: "card-1", categoryId: "cat-pay", type: "EXPENSE" as const };

describe("checkCardPayments", () => {
  it("queries nothing when no item names a card, so ordinary writes pay nothing for it", async () => {
    const { db, client } = stub();

    const refusal = await checkCardPayments(db, "user-1", [
      { categoryId: "cat-food", type: "EXPENSE" },
      { creditAccountId: null, categoryId: "cat-food", type: "EXPENSE" },
    ]);

    expect(refusal).toBeNull();
    expect(client.creditAccount.findMany).not.toHaveBeenCalled();
    expect(client.category.findMany).not.toHaveBeenCalled();
  });

  it("accepts an expense under the payment category on the caller's own active card", async () => {
    const { db } = stub();

    expect(await checkCardPayments(db, "user-1", [payment])).toBeNull();
  });

  it("refuses income before asking the database anything", async () => {
    const { db, client } = stub();

    expect(await checkCardPayments(db, "user-1", [{ ...payment, type: "INCOME" }])).toBe(
      "NOT_AN_EXPENSE"
    );
    expect(client.creditAccount.findMany).not.toHaveBeenCalled();
  });

  it("refuses a card that is not the caller's, and scopes the lookup to them", async () => {
    const { db, client } = stub({ accounts: [] });

    expect(await checkCardPayments(db, "user-1", [payment])).toBe("ACCOUNT_NOT_FOUND");
    expect(client.creditAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["card-1"] }, userId: "user-1" } })
    );
  });

  it("refuses an archived card", async () => {
    const { db } = stub({ accounts: [{ id: "card-1", isActive: false }] });

    expect(await checkCardPayments(db, "user-1", [payment])).toBe("ACCOUNT_ARCHIVED");
  });

  // Filed under Groceries, the same money would appear twice in category terms: once in the card's
  // breakdown of the charges it settles, and again in the dashboard's.
  it("refuses any category but the default payment category", async () => {
    const { db, client } = stub({ paymentCategoryIds: [] });

    expect(await checkCardPayments(db, "user-1", [{ ...payment, categoryId: "cat-food" }])).toBe(
      "NOT_PAYMENT_CATEGORY"
    );
    expect(client.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: null,
          isDefault: true,
          name: CARD_PAYMENT_CATEGORY_NAME,
          type: "EXPENSE",
        }),
      })
    );
  });

  it("dedupes ids across a batch, so two payments to one card are one lookup of one id", async () => {
    const { db, client } = stub();

    expect(await checkCardPayments(db, "user-1", [payment, payment])).toBeNull();
    expect(client.creditAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["card-1"] } }) })
    );
  });
});
