import { describe, expect, it } from "vitest";
import { renderCreated, type CreatedBatch } from "@/lib/telegram/created-reply";

const peso = (n: number) => `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const row = (over: Partial<CreatedBatch["transactions"][number]> = {}) => ({
  id: "t1",
  amount: 250,
  description: "Grab",
  type: "EXPENSE",
  date: "2026-09-01",
  categoryName: "Transportation",
  labels: [] as string[],
  ...over,
});

const batch = (transactions: CreatedBatch["transactions"], replayed = false): CreatedBatch => ({
  created: transactions.length,
  replayed,
  transactions,
});

describe("one transaction", () => {
  it("keeps the labelled layout", () => {
    const out = renderCreated(batch([row()]), peso);
    expect(out).toContain("*Transaction Logged!*");
    expect(out).toContain("*Description:* Grab");
    expect(out).toContain("₱250.00");
    expect(out).toContain("*Category:* Transportation");
    expect(out).toContain("*Date:* 2026-09-01");
  });

  it("lists labels only when there are some", () => {
    expect(renderCreated(batch([row()]), peso)).not.toContain("Labels:");
    expect(renderCreated(batch([row({ labels: ["Work"] })]), peso)).toContain("*Labels:* Work");
  });
});

describe("several transactions", () => {
  const two = [
    row({ id: "t1", amount: 250, description: "Grab", categoryName: "Transportation" }),
    row({ id: "t2", amount: 180, description: "Lunch", categoryName: "Food & Dining" }),
  ];

  // The bug: the renderer showed transactions[0] and nothing else, so a message that wrote two
  // rows reported one and looked like the old swallow-the-second-amount behaviour (#204).
  it("names every row, not just the first", () => {
    const out = renderCreated(batch(two), peso);
    expect(out).toContain("Grab");
    expect(out).toContain("Lunch");
    expect(out).toContain("₱250.00");
    expect(out).toContain("₱180.00");
  });

  it("says how many were written", () => {
    expect(renderCreated(batch(two), peso)).toContain("2 transactions logged!");
  });

  it("shows each row's own category, so a fallback to Other is visible", () => {
    const out = renderCreated(
      batch([two[0], row({ id: "t2", description: "Xyz", categoryName: "Other Expense" })]),
      peso
    );
    expect(out).toContain("Transportation");
    expect(out).toContain("Other Expense");
  });

  // The individual rows are small; the number that gets checked against a bank app is the sum.
  it("totals the spending", () => {
    expect(renderCreated(batch(two), peso)).toContain("*Total spent:* ₱430.00");
  });

  // This test used to assert the opposite, and locked in a bug: income was netted into the total,
  // so 1,000 spent alongside 500 received reported "Total spent: 500", and the line disappeared
  // altogether whenever income was the larger. A confident wrong number about your own money is
  // worse than printing none.
  it("reports spending and income separately, never netted", () => {
    const out = renderCreated(
      batch([
        row({ amount: 1000, type: "EXPENSE" }),
        row({ id: "t2", amount: 500, type: "INCOME", description: "Refund" }),
      ]),
      peso
    );
    expect(out).toContain("*Total spent:* ₱1,000.00");
    expect(out).toContain("*Total received:* ₱500.00");
  });

  it("still reports what was spent when income is the larger figure", () => {
    const out = renderCreated(
      batch([
        row({ amount: 100, type: "EXPENSE" }),
        row({ id: "t2", amount: 5000, type: "INCOME", description: "Salary" }),
      ]),
      peso
    );
    expect(out).toContain("*Total spent:* ₱100.00");
    expect(out).toContain("*Total received:* ₱5,000.00");
  });

  it("omits a total nobody needs", () => {
    const allIncome = renderCreated(
      batch([row({ amount: 5000, type: "INCOME", description: "Salary" }), row({ id: "t2", amount: 100, type: "INCOME", description: "Refund" })]),
      peso
    );
    expect(allIncome).not.toContain("Total spent:");
    expect(allIncome).toContain("*Total received:* ₱5,100.00");
  });

  it("marks income and expense differently", () => {
    const out = renderCreated(
      batch([row({ type: "EXPENSE" }), row({ id: "t2", type: "INCOME", description: "Salary" })]),
      peso
    );
    expect(out).toContain("➕");
    expect(out).toContain("➖");
  });
});

describe("a replayed batch", () => {
  // A replay wrote nothing: the same Telegram update was redelivered after a crash. Saying
  // "logged" would imply rows that do not exist.
  it("does not claim anything new was written", () => {
    expect(renderCreated(batch([row()], true), peso)).toContain("Already logged");
    expect(renderCreated(batch([row()], true), peso)).not.toContain("Transaction Logged!");

    const many = renderCreated(batch([row(), row({ id: "t2" })], true), peso);
    expect(many).toContain("Already logged");
    expect(many).not.toContain("transactions logged!");
  });
});
