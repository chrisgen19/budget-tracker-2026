import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getUpcomingBills, getBillHistory } from "./budget-queries";

/** Asia/Manila, UTC+8. */
const MANILA = -480;
/** New York, UTC-4. The direction that breaks a naively shifted due date. */
const NEW_YORK = 240;

/** A bill due "the 5th": date-only, stored at midnight UTC, meaning the same day everywhere. */
const DUE_5TH = new Date("2026-08-05T00:00:00.000Z");

describe("bill due dates are calendar days, not instants", () => {
  const prismaWithBill = () =>
    ({
      scheduledTransaction: {
        findMany: vi.fn(async () => [
          {
            id: "b1",
            description: "Meralco",
            amount: 8350,
            nextDueDate: DUE_5TH,
            category: { name: "Utilities", icon: "Zap", color: "#F5A623" },
          },
        ]),
      },
    }) as unknown as PrismaClient;

  it("reports the 5th for a user east of UTC", async () => {
    const result = await getUpcomingBills(prismaWithBill(), "u1", {
      days: 3650,
      timezoneOffset: MANILA,
    });

    expect(result.bills[0].localDueDate).toBe("2026-08-05");
  });

  it("still reports the 5th west of UTC, where a shift would say the 4th", async () => {
    // This is the case the whole rule exists for: converting a date-only value into a zone
    // behind UTC moves it a day earlier, which turns every on-time payment into a day late.
    const result = await getUpcomingBills(prismaWithBill(), "u1", {
      days: 3650,
      timezoneOffset: NEW_YORK,
    });

    expect(result.bills[0].localDueDate).toBe("2026-08-05");
  });

  it("keeps the raw instant alongside it", async () => {
    const result = await getUpcomingBills(prismaWithBill(), "u1", { days: 3650 });

    expect(result.bills[0].dueDate).toBe("2026-08-05T00:00:00.000Z");
  });
});

describe("bill history separates the date-only fields from the real instant", () => {
  // Paid at 22:30 UTC on the 4th, which is 06:30 on the 5th in Manila.
  const PAID_AT = new Date("2026-08-04T22:30:00.000Z");

  const prisma = () =>
    ({
      scheduledTransaction: {
        findMany: vi.fn(async () => [
          {
            id: "b1",
            description: "Meralco",
            amount: 8350,
            nextDueDate: DUE_5TH,
            category: { name: "Utilities", icon: "Zap", color: "#F5A623" },
          },
        ]),
      },
      scheduledTransactionLog: {
        findMany: vi.fn(async () => [
          {
            scheduledTransactionId: "b1",
            dueDate: DUE_5TH,
            status: "PAID",
            actionDate: PAID_AT,
            transactionId: null,
            snoozeUntil: null,
          },
        ]),
      },
      transaction: { findMany: vi.fn(async () => []) },
    }) as unknown as PrismaClient;

  it("does not shift the due date but does shift the action date", async () => {
    const result = await getBillHistory(prisma(), "u1", { timezoneOffset: MANILA, months: 24 });
    const [occurrence] = result.occurrences;

    // Same calendar day for everyone: it is a due date.
    expect(occurrence.localDueDate).toBe("2026-08-05");
    // Converted, because settling a bill happens at a moment: 22:30Z on the 4th is the 5th here.
    expect(occurrence.localActionDate).toBe("2026-08-05");
    expect(occurrence.actionDate).toBe("2026-08-04T22:30:00.000Z");
  });

  const snoozePrisma = () =>
      ({
        scheduledTransaction: {
          findMany: vi.fn(async () => [
            {
              id: "b1",
              description: "Meralco",
              amount: 8350,
              nextDueDate: DUE_5TH,
              category: { name: "Utilities", icon: "Zap", color: "#F5A623" },
            },
          ]),
        },
        scheduledTransactionLog: {
          findMany: vi.fn(async () => [
            {
              scheduledTransactionId: "b1",
              dueDate: DUE_5TH,
              status: "SNOOZED",
              actionDate: new Date("2026-08-04T22:30:00.000Z"),
              transactionId: null,
              // Written server-side as "now + 1 day", truncated. Read as date-only it would tell
              // a UTC-4 user their one-day snooze runs to the 31st.
              snoozeUntil: new Date("2026-08-31T00:00:00.000Z"),
            },
          ]),
        },
        transaction: { findMany: vi.fn(async () => []) },
      }) as unknown as PrismaClient;

  it("converts the snooze day too, since it is derived from a clock and not a calendar", async () => {
    const result = await getBillHistory(snoozePrisma(), "u1", {
      timezoneOffset: NEW_YORK,
      months: 24,
    });

    expect(result.occurrences[0].localSnoozeUntil).toBe("2026-08-30");
    // The due date beside it is still untouched.
    expect(result.occurrences[0].localDueDate).toBe("2026-08-05");
  });

  it("reports the snooze time in localActionDate while an occurrence is outstanding", async () => {
    // `record` is `settled ?? latestSnooze`, so an unsettled occurrence carries the snooze's
    // action time here -- not null, and not a settlement. A reader that assumes otherwise
    // reports a snoozed bill as paid.
    const result = await getBillHistory(snoozePrisma(), "u1", {
      timezoneOffset: NEW_YORK,
      months: 24,
    });
    const [occurrence] = result.occurrences;

    expect(occurrence.status).toBe("SNOOZED");
    expect(occurrence.localActionDate).toBe("2026-08-04");
    expect(occurrence.actionDate).toBe("2026-08-04T22:30:00.000Z");
  });

  it("reports the action date in the user's own zone, not UTC", async () => {
    const result = await getBillHistory(prisma(), "u1", { timezoneOffset: 0, months: 24 });

    // The same instant is still 4 August in UTC, which is exactly the divergence the field exists
    // to make visible rather than leaving each client to derive.
    expect(result.occurrences[0].localActionDate).toBe("2026-08-04");
    expect(result.occurrences[0].localDueDate).toBe("2026-08-05");
  });
});
