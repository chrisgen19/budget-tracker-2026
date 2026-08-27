import { describe, expect, it } from "vitest";
import { RECEIPT_ITEM_SHOW, renderReceiptItems } from "@/lib/telegram/receipt-reply";

const money = (n: number) => `P${n.toFixed(2)}`;
const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Item ${i + 1}`, amount: 10 }));

const render = (over: Partial<Parameters<typeof renderReceiptItems>[0]> = {}) =>
  renderReceiptItems(
    { heading: "Receipt items", items: items(3), itemCount: 3, total: 30, partial: false, ...over },
    money
  );

describe("renderReceiptItems", () => {
  it("lists the items and the total", () => {
    const out = render();
    expect(out).toContain("Item 1");
    expect(out).toContain("Total: *P30.00* across 3 items");
  });

  it("uses the singular for one item", () => {
    expect(render({ items: items(1), itemCount: 1, total: 10 })).toContain("across 1 item");
  });

  it("truncates the list but reports the real count", () => {
    const out = render({ items: items(40), itemCount: 40, total: 400 });
    expect(out).toContain(`Showing ${RECEIPT_ITEM_SHOW} of 40`);
    expect(out).toContain(`Item ${RECEIPT_ITEM_SHOW}`);
    expect(out).not.toContain(`Item ${RECEIPT_ITEM_SHOW + 1} `);
    // The count is the full match set even though the list is cut.
    expect(out).toContain("across 40 items");
  });

  // The bug this covers: the caveat was attached to every reply, including direct tool queries.
  // get_receipt_items computes itemCount and totalAmount over the full match set and slices only
  // the returned list, so that total is complete even when `truncated` is set. Calling it partial
  // made a correct financial figure look untrustworthy.
  it("does not call a complete total partial", () => {
    const out = render({ items: items(40), itemCount: 40, total: 400, partial: false });
    expect(out).not.toContain("older receipts were not searched");
  });

  it("says so when the total really was computed from a capped page", () => {
    // Only the locally filtered merchant fallback recomputes a total from what it could see.
    const out = render({ partial: true });
    expect(out).toContain("older receipts were not searched");
  });

  it("shows the subheading only when there is one", () => {
    expect(render({ subheading: "Matched on the shop" })).toContain("_Matched on the shop_");
    expect(render()).not.toContain("__");
  });

  it("handles an empty list without claiming anything", () => {
    const out = render({ items: [], itemCount: 0, total: 0 });
    expect(out).toContain("across 0 items");
    expect(out).not.toContain("Showing");
  });
});
