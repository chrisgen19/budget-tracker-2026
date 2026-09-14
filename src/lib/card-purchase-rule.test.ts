import { describe, expect, it, vi } from "vitest";
import { checkCardPurchases } from "./card-purchase-rule";
import type { PrismaClient } from "./budget-query-types";

const stub = (accounts: { id: string; isActive: boolean }[] = [{ id: "card-1", isActive: true }]) => {
  const client = {
    creditAccount: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        accounts.filter((account) => where.id.in.includes(account.id))
      ),
    },
  };
  return { db: client as unknown as PrismaClient, client };
};

const purchase = { creditAccountId: "card-1", type: "EXPENSE" as const };

describe("checkCardPurchases", () => {
  it("queries nothing when no item names a card, so ordinary writes pay nothing for it", async () => {
    const { db, client } = stub();

    const refusal = await checkCardPurchases(db, "user-1", [
      { type: "EXPENSE" },
      { creditAccountId: null, type: "INCOME" },
    ]);

    expect(refusal).toBeNull();
    expect(client.creditAccount.findMany).not.toHaveBeenCalled();
  });

  it("accepts an expense on the caller's own active card", async () => {
    const { db } = stub();

    expect(await checkCardPurchases(db, "user-1", [purchase])).toBeNull();
  });

  it("refuses income before asking the database anything", async () => {
    const { db, client } = stub();

    expect(await checkCardPurchases(db, "user-1", [{ ...purchase, type: "INCOME" }])).toBe(
      "NOT_AN_EXPENSE"
    );
    expect(client.creditAccount.findMany).not.toHaveBeenCalled();
  });

  it("refuses a card that is not the caller's, and scopes the lookup to them", async () => {
    const { db, client } = stub([]);

    expect(await checkCardPurchases(db, "user-1", [purchase])).toBe("ACCOUNT_NOT_FOUND");
    expect(client.creditAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["card-1"] }, userId: "user-1" } })
    );
  });

  it("refuses a new purchase on an archived card", async () => {
    const { db } = stub([{ id: "card-1", isActive: false }]);

    expect(await checkCardPurchases(db, "user-1", [purchase])).toBe("ACCOUNT_ARCHIVED");
  });

  // A card archived later must not lock its past purchases out of being corrected.
  it("keeps an existing purchase on an archived card editable", async () => {
    const { db } = stub([{ id: "card-1", isActive: false }]);

    expect(
      await checkCardPurchases(db, "user-1", [{ ...purchase, storedCreditAccountId: "card-1" }])
    ).toBeNull();
  });
});
