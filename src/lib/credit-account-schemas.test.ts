import { describe, expect, it } from "vitest";
import {
  batchTransactionSchema,
  cardPurchaseLineSchema,
  creditAccountPatchSchema,
  creditPaymentPatchSchema,
  creditPaymentSchema,
  transactionSchema,
} from "./validations";

const TX = { amount: 1111, description: "Google One", type: "EXPENSE", date: "2026-08-25", categoryId: "cat-subs" };

describe("creditAccountId on transactions", () => {
  it("is accepted by the single-row schema, as a string or an explicit null", () => {
    expect(transactionSchema.parse({ ...TX, creditAccountId: "card-1" }).creditAccountId).toBe("card-1");
    expect(transactionSchema.parse({ ...TX, creditAccountId: null }).creditAccountId).toBeNull();
    expect(transactionSchema.parse(TX)).not.toHaveProperty("creditAccountId");
  });

  // The card page adds a statement's purchases through the batch route, so the field has to survive it.
  it("is kept by the batch schema", () => {
    expect(batchTransactionSchema.parse({ ...TX, creditAccountId: "card-1" }).creditAccountId).toBe("card-1");
  });
});

describe("creditPaymentSchema", () => {
  it("defaults to a payment with an empty note", () => {
    expect(creditPaymentSchema.parse({ amount: 5000, date: "2026-09-05" })).toEqual({
      kind: "PAYMENT",
      amount: 5000,
      description: "",
      date: "2026-09-05",
    });
  });

  it("refuses a day that does not exist rather than rolling it into March", () => {
    expect(creditPaymentSchema.safeParse({ amount: 1, date: "2026-02-31" }).success).toBe(false);
  });

  // `.partial()` over fields with defaults must not re-apply them, or correcting an amount would
  // quietly turn a refund back into a payment.
  it("does not fill defaults into a patch", () => {
    expect(creditPaymentPatchSchema.parse({ amount: 10 })).toEqual({ amount: 10 });
    expect(creditPaymentPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe("cardPurchaseLineSchema", () => {
  it("needs a category and an amount above 0", () => {
    expect(cardPurchaseLineSchema.safeParse({ date: "2026-08-25", categoryId: "", amount: 0 }).success).toBe(false);
  });

  it("defaults to no labels", () => {
    expect(cardPurchaseLineSchema.parse({ date: "2026-08-25", categoryId: "cat-subs", amount: 1 }).labelIds).toEqual([]);
  });
});

describe("creditAccountPatchSchema", () => {
  it("refuses an empty patch and fills no defaults into one", () => {
    expect(creditAccountPatchSchema.safeParse({}).success).toBe(false);
    expect(creditAccountPatchSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });
});
