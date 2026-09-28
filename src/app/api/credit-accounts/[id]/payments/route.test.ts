// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * Recording a card payment. The rules live in `credit-account-writes.ts` and are tested there; what
 * is this layer's own is the status a replay gets, and that a replay is answered **before** the body
 * is validated, so a retry is never refused over inputs it will not use.
 */

const mocks = vi.hoisted(() => ({
  requireCreditCardsUser: vi.fn(),
  findSavedCreditPayment: vi.fn(),
  createCreditPayment: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/credit-account-queries", () => ({ readTimezoneOffset: vi.fn(async () => -480) }));
vi.mock("@/lib/credit-account-writes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-account-writes")>()),
  findSavedCreditPayment: mocks.findSavedCreditPayment,
  createCreditPayment: mocks.createCreditPayment,
}));
vi.mock("@/lib/credit-account-http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-account-http")>()),
  requireCreditCardsUser: mocks.requireCreditCardsUser,
}));

const { POST } = await import("./route");

const KEY = "0b7c5d7e-6a0f-4d8e-9a55-3c1f2e4d5b6a";
const payment = { kind: "PAYMENT", amount: 5000, description: "BPI app", date: "2026-09-14" };
const saved = { id: "pay-1", ...payment, date: "2026-09-13T16:00:00.000Z", accountId: "card-1" };

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/credit-accounts/card-1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "card-1" }) }
  );

beforeEach(() => {
  mocks.requireCreditCardsUser.mockResolvedValue("user-1");
  mocks.findSavedCreditPayment.mockResolvedValue(null);
  mocks.createCreditPayment.mockResolvedValue({ ok: true, payment: saved, replayed: false });
});

describe("POST /api/credit-accounts/[id]/payments", () => {
  it("answers 201 for a payment this request saved, passing the key through", async () => {
    const res = await post({ ...payment, clientRequestId: KEY });

    expect(res.status).toBe(201);
    expect(mocks.createCreditPayment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", accountId: "card-1", input: payment, clientRequestId: KEY })
    );
  });

  it("answers a key that already saved a payment with that payment, before validating the body", async () => {
    mocks.findSavedCreditPayment.mockResolvedValue(saved);

    // An amount the schema refuses: a retry must not be judged on inputs it will never use.
    const res = await post({ ...payment, amount: 0, clientRequestId: KEY });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(saved);
    expect(mocks.findSavedCreditPayment).toHaveBeenCalledWith({}, "user-1", KEY);
    expect(mocks.createCreditPayment).not.toHaveBeenCalled();
  });

  it("answers 200 when the write lost a race on the key and returned the winner", async () => {
    mocks.createCreditPayment.mockResolvedValue({ ok: true, payment: saved, replayed: true });

    expect((await post({ ...payment, clientRequestId: KEY })).status).toBe(200);
  });

  it("still records a payment sent with no key, as a tab open from before the key existed does", async () => {
    const res = await post(payment);

    expect(res.status).toBe(201);
    expect(mocks.findSavedCreditPayment).not.toHaveBeenCalled();
    expect(mocks.createCreditPayment).toHaveBeenCalledWith(expect.objectContaining({ clientRequestId: undefined }));
  });

  it("refuses a key that is not a UUID rather than storing it", async () => {
    const res = await post({ ...payment, clientRequestId: "not-a-key" });

    expect(res.status).toBe(400);
    expect(mocks.createCreditPayment).not.toHaveBeenCalled();
  });

  it("maps an archived card to its 409", async () => {
    mocks.createCreditPayment.mockResolvedValue({ ok: false, reason: "ACCOUNT_ARCHIVED" });

    expect((await post({ ...payment, clientRequestId: KEY })).status).toBe(409);
  });

  it("checks the credit cards switch before anything else", async () => {
    mocks.requireCreditCardsUser.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));

    expect((await post({ ...payment, clientRequestId: KEY })).status).toBe(403);
    expect(mocks.findSavedCreditPayment).not.toHaveBeenCalled();
  });
});
