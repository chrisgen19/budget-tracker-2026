import { describe, expect, it } from "vitest";
import { LABEL_SHOW, renderLabelBreakdown, type LabelShare } from "@/lib/telegram/label-reply";

const money = (n: number) => `P${n.toFixed(2)}`;

const shares = (n: number): LabelShare[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Label ${i + 1}`,
    amount: 100,
    percentage: 100 / n,
    transactionCount: 2,
  }));

describe("renderLabelBreakdown", () => {
  it("lists the labels with their shares", () => {
    const out = renderLabelBreakdown("2026-08", shares(3), 300, money);
    expect(out).toContain("Label 1");
    expect(out).toContain("Total: *P300.00*");
  });

  it("says so when there is nothing labelled", () => {
    expect(renderLabelBreakdown("2026-08", [], 0, money)).toBe("No labelled spending in 2026-08.");
  });

  it("claims 100% only when every label is shown", () => {
    const out = renderLabelBreakdown("2026-08", shares(4), 400, money);
    expect(out).toContain("so these add to 100%");
    expect(out).not.toContain("other label");
  });

  // The bug this covers: the list was capped at ten while the total covered the whole month and
  // the note asserted the percentages "add to 100%". For anyone with more than ten labels in use
  // that is simply false, and the difference was left unexplained.
  it("does not claim 100% when labels were omitted", () => {
    const out = renderLabelBreakdown("2026-08", shares(14), 1400, money);
    expect(out).not.toContain("add to 100%");
  });

  it("summarises the omitted labels so the figures still reconcile", () => {
    const out = renderLabelBreakdown("2026-08", shares(14), 1400, money);
    // 14 labels, ten shown, four folded into one line worth 400.
    expect(out).toContain("4 other labels");
    expect(out).toContain("P400.00");
  });

  it("uses the singular for a single omitted label", () => {
    const out = renderLabelBreakdown("2026-08", shares(LABEL_SHOW + 1), 1100, money);
    expect(out).toContain("_1 other label_:");
    expect(out).not.toContain("other labels");
  });

  it("shows exactly the cap without an others line", () => {
    const out = renderLabelBreakdown("2026-08", shares(LABEL_SHOW), 1000, money);
    expect(out).toContain(`Label ${LABEL_SHOW}`);
    expect(out).not.toContain("other label");
  });

  it("keeps the split explanation in both cases, since it explains the search discrepancy", () => {
    for (const n of [3, 14]) {
      expect(renderLabelBreakdown("2026-08", shares(n), n * 100, money)).toContain(
        "counts half to each"
      );
    }
  });
});
