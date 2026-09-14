import { describe, expect, it } from "vitest";
import {
  batchTransactionSchema,
  creditAccountPatchSchema,
  creditChargePatchSchema,
  creditChargeSchema,
  transactionSchema,
} from "./validations";

const TX = { amount: 5000, description: "BPI payment", type: "EXPENSE", date: "2026-09-05", categoryId: "cat-pay" };

describe("creditAccountId on transactions", () => {
  it("is accepted by the single-row schema, as a string or an explicit null", () => {
    expect(transactionSchema.parse({ ...TX, creditAccountId: "card-1" }).creditAccountId).toBe("card-1");
    expect(transactionSchema.parse({ ...TX, creditAccountId: null }).creditAccountId).toBeNull();
    expect(transactionSchema.parse(TX)).not.toHaveProperty("creditAccountId");
  });

  // The batch schema feeds the batch route, the MCP tool and Telegram, none of which may link a
  // payment to a card. Stripped here, no writer behind it can be handed one.
  it("is stripped by the batch schema", () => {
    expect(batchTransactionSchema.parse({ ...TX, creditAccountId: "card-1" })).not.toHaveProperty(
      "creditAccountId"
    );
  });
});

describe("creditChargeSchema", () => {
  const charge = { amount: 385, date: "2026-08-25", categoryId: "cat-shop" };

  it("defaults to a charge with an empty description", () => {
    expect(creditChargeSchema.parse(charge)).toMatchObject({ kind: "CHARGE", description: "" });
  });

  it("refuses a day that does not exist rather than rolling it into March", () => {
    expect(creditChargeSchema.safeParse({ ...charge, date: "2026-02-31" }).success).toBe(false);
  });

  it("refuses a time of day, since a statement line has none", () => {
    expect(creditChargeSchema.safeParse({ ...charge, date: "2026-08-25T10:00" }).success).toBe(false);
  });

  it("upper-cases the foreign currency", () => {
    const parsed = creditChargeSchema.parse({ ...charge, originalAmount: 22.4, originalCurrency: "usd" });
    expect(parsed.originalCurrency).toBe("USD");
  });

  it("refuses a foreign amount without its currency", () => {
    expect(creditChargeSchema.safeParse({ ...charge, originalAmount: 22.4 }).success).toBe(false);
  });
});

describe("patch schemas", () => {
  it("refuses an empty card patch", () => {
    expect(creditAccountPatchSchema.safeParse({}).success).toBe(false);
  });

  // `.partial()` over fields with defaults must not re-apply them, or archiving a card would also
  // reset its colour and opening balance.
  it("does not fill defaults into a card patch", () => {
    expect(creditAccountPatchSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it("refuses a charge patch naming only half the foreign amount", () => {
    expect(creditChargePatchSchema.safeParse({ originalCurrency: "USD" }).success).toBe(false);
    expect(
      creditChargePatchSchema.safeParse({ originalAmount: null, originalCurrency: null }).success
    ).toBe(true);
  });
});
