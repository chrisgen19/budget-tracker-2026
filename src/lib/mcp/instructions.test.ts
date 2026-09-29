import { describe, it, expect } from "vitest";
import { buildInstructions } from "./server";
import { READ_ONLY_SCOPES } from "./scopes";

describe("buildInstructions", () => {
  it("calls a read-only grant read-only and names no write tools", () => {
    const text = buildInstructions(READ_ONLY_SCOPES);
    expect(text).toMatch(/^Read-only access/);
    expect(text).not.toContain("create_transactions");
    expect(text).not.toContain("pay_bill");
  });

  it("does not point a transactions-only writer at pay_bill", () => {
    const text = buildInstructions([...READ_ONLY_SCOPES, "transactions:write"]);
    expect(text).toMatch(/^Access/);
    expect(text).toContain("`create_transactions`");
    expect(text).not.toContain("`pay_bill`");
    expect(text).toContain("cannot settle bills");
  });

  it("routes paid bills to pay_bill when bills:write is granted", () => {
    const text = buildInstructions([...READ_ONLY_SCOPES, "transactions:write", "bills:write"]);
    expect(text).toContain("use `pay_bill`, not `create_transactions`");
    expect(text).not.toContain("cannot settle bills");
  });

  it("omits get_assessment_facts guidance when the grant lacks it", () => {
    expect(buildInstructions(["budget:read"])).not.toContain("get_assessment_facts");
  });

  it("names only the subjects a narrowed read grant covers", () => {
    const text = buildInstructions(["bills:read"]);
    expect(text).toContain("recurring bills");
    expect(text).not.toContain("transactions");
    expect(text).not.toContain("monthly totals");
    expect(text).not.toContain("labels");
  });

  it("tells a grant with no read scopes that it cannot read the budget", () => {
    const text = buildInstructions(["labels:write"]);
    expect(text).toMatch(/^This connection cannot read the user's budget/);
    expect(text).toContain("`create_label`");
    expect(text).not.toContain("recurring bills");
    expect(text).not.toContain("monthly");
  });

  it("lists every subject for the default read-only grant", () => {
    const text = buildInstructions(READ_ONLY_SCOPES);
    for (const subject of [
      "monthly totals",
      "individual transactions",
      "recurring bills",
      "labels",
      "receipt line items",
    ]) {
      expect(text).toContain(subject);
    }
  });
});
