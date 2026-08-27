import { describe, expect, it } from "vitest";
import { parseReportIntent } from "@/lib/telegram/report-intent";

describe("parseReportIntent", () => {
  it("reads a month comparison", () => {
    expect(parseReportIntent({ action: "SHOW_TRENDS", month: "2026-08" })).toEqual({
      kind: "TRENDS",
      month: "2026-08",
    });
  });

  it("reads a multi-month summary", () => {
    expect(parseReportIntent({ action: "SHOW_MONTHLY", months: 6 })).toEqual({
      kind: "MONTHLY",
      months: 6,
    });
  });

  it("defaults the count when the question was vague", () => {
    // "how have I been doing lately" has no number in it, and refusing would be worse than
    // answering over a sensible window.
    expect(parseReportIntent({ action: "SHOW_MONTHLY" })).toMatchObject({ months: 6 });
    expect(parseReportIntent({ action: "SHOW_MONTHLY", months: "six" })).toMatchObject({ months: 6 });
  });

  it("clamps a count rather than refusing it", () => {
    expect(parseReportIntent({ action: "SHOW_MONTHLY", months: 500 })).toMatchObject({ months: 24 });
    expect(parseReportIntent({ action: "SHOW_MONTHLY", months: 0 })).toMatchObject({ months: 1 });
    expect(parseReportIntent({ action: "SHOW_MONTHLY", months: -5 })).toMatchObject({ months: 1 });
    expect(parseReportIntent({ action: "SHOW_MONTHLY", months: 5.6 })).toMatchObject({ months: 6 });
  });

  it("reads the remaining report kinds", () => {
    expect(parseReportIntent({ action: "SHOW_TOP_EXPENSES", month: "2026-07" })).toEqual({
      kind: "TOP_EXPENSES",
      month: "2026-07",
    });
    expect(parseReportIntent({ action: "SHOW_LABEL_BREAKDOWN" })).toEqual({
      kind: "LABEL_BREAKDOWN",
      month: null,
    });
    expect(parseReportIntent({ action: "SHOW_RECEIPT_ITEMS", search: "south supermarket" })).toEqual({
      kind: "RECEIPT_ITEMS",
      search: "south supermarket",
      month: null,
    });
  });

  // The failure that recurs throughout this bot: a filter the query cannot use does not fail
  // loudly, it reports on the wrong period, and that reads exactly like a real answer.
  it("drops a month it cannot use rather than reporting on the wrong period", () => {
    for (const month of ["August", "2026-8", "2026-13", "", "last month", 42]) {
      expect(parseReportIntent({ action: "SHOW_TRENDS", month }), String(month)).toEqual({
        kind: "TRENDS",
        month: null,
      });
    }
  });

  it("treats a blank receipt search as no filter", () => {
    expect(parseReportIntent({ action: "SHOW_RECEIPT_ITEMS", search: "   " })).toMatchObject({
      search: null,
    });
    expect(parseReportIntent({ action: "SHOW_RECEIPT_ITEMS", search: 42 })).toMatchObject({
      search: null,
    });
  });

  it("ignores actions handled elsewhere", () => {
    for (const action of ["SHOW_SUMMARY", "SEARCH_TRANSACTIONS", "CHECK_BILL", "CREATE_TRANSACTION", "UNSUPPORTED"]) {
      expect(parseReportIntent({ action, month: "2026-08" }), action).toBeNull();
    }
  });

  it("survives junk instead of a result", () => {
    for (const junk of [null, undefined, "nope", 42]) {
      expect(parseReportIntent(junk), String(junk)).toBeNull();
    }
  });
});
