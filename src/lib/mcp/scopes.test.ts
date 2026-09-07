import { describe, it, expect } from "vitest";
import {
  DEFAULT_MINT_SCOPES,
  MCP_SCOPES,
  MCP_SCOPE_LABELS,
  MCP_TOOL_SCOPES,
  READ_ONLY_SCOPES,
  grantCoversTool,
  grantsWrite,
  isPrivilegedScope,
  scopesRequiredBy,
  isWriteScope,
  parseScopes,
} from "./scopes";

describe("parseScopes", () => {
  it("keeps known scopes", () => {
    expect(parseScopes(["bills:read", "budget:read"])).toEqual(["budget:read", "bills:read"]);
  });

  it("drops scopes this build no longer knows about", () => {
    // A scope retired from the code must stop granting access even while it is still sitting
    // in a token row that was minted before the retirement.
    expect(parseScopes(["bills:read", "categories:destroy"])).toEqual(["bills:read"]);
  });

  it("returns declaration order, not the order stored on the row", () => {
    expect(parseScopes([...MCP_SCOPES].reverse())).toEqual([...MCP_SCOPES]);
  });
});

describe("MCP_SCOPE_LABELS", () => {
  it("describes every scope, so the mint form can never render a blank checkbox", () => {
    for (const scope of MCP_SCOPES) {
      expect(MCP_SCOPE_LABELS[scope]).toBeTruthy();
    }
  });
});

describe("grantsWrite", () => {
  it("is false for any combination of read scopes", () => {
    expect(grantsWrite(MCP_SCOPES.filter((s) => !isWriteScope(s)))).toBe(false);
  });

  it("is true as soon as one write scope is present", () => {
    expect(grantsWrite(["bills:read", "transactions:write"])).toBe(true);
  });

  it("is false for an empty grant", () => {
    expect(grantsWrite([])).toBe(false);
  });
});

describe("DEFAULT_MINT_SCOPES", () => {
  it("never pre-selects a write scope", () => {
    // An untouched mint form uses this list. If a write scope were in it, every token created
    // without changing the form would carry write authority, and least privilege would depend on
    // the user noticing a pre-ticked box.
    expect(grantsWrite(DEFAULT_MINT_SCOPES)).toBe(false);
  });

  it("offers every scope that neither writes nor costs anything", () => {
    expect(DEFAULT_MINT_SCOPES).toEqual(MCP_SCOPES.filter((s) => !isPrivilegedScope(s)));
  });

  it("never pre-selects a scope that spends the user's scan allowance", () => {
    // receipts:scan does not end in ":write", so the old definition of read-only filed it as
    // harmless and put it in this list. Every token minted from an untouched form, and the local
    // stdio server which passes no scopes at all, would then have been able to spend real money.
    expect(DEFAULT_MINT_SCOPES).not.toContain("receipts:scan");
    expect(READ_ONLY_SCOPES).not.toContain("receipts:scan");
  });
});

describe("isWriteScope", () => {
  it("counts transactions:write", () => {
    expect(isWriteScope("transactions:write")).toBe(true);
  });

  /**
   * Settling an occurrence is a different authority from adding a row: it advances a schedule
   * cursor, writes a terminal log nothing here can remove, and can switch a bill off. Filing these
   * as writes is what subjects them to the write lease and the 90-day expiry cap; a suffix test on
   * ":write" would happen to get both right today and is exactly how `receipts:scan` was once
   * mis-filed as harmless.
   */
  it("counts the bill and label write scopes", () => {
    expect(isWriteScope("bills:write")).toBe(true);
    expect(isWriteScope("labels:write")).toBe(true);
    expect(grantsWrite(["bills:read", "bills:write"])).toBe(true);
    expect(grantsWrite(["labels:write"])).toBe(true);
  });

  /** Reading bills and settling them are separate grants: a token minted to answer "what is due?"
   *  must not be able to mark one paid. */
  it("keeps reading a bill separate from settling one", () => {
    expect(isWriteScope("bills:read")).toBe(false);
    expect(READ_ONLY_SCOPES).toContain("bills:read");
    expect(READ_ONLY_SCOPES).not.toContain("bills:write");
  });

  it("does not count a scope that only spends money", () => {
    // receipts:scan is privileged but writes nothing, so it must not inherit the write expiry cap.
    expect(isWriteScope("receipts:scan")).toBe(false);
    expect(isPrivilegedScope("receipts:scan")).toBe(true);
  });

  it("keeps every write scope out of the default grant", () => {
    // READ_ONLY_SCOPES is what a caller naming no scopes receives, the local stdio server
    // included. Written over the list so a scope added later is covered without editing this.
    for (const scope of MCP_SCOPES.filter(isWriteScope)) {
      expect(READ_ONLY_SCOPES).not.toContain(scope);
      expect(DEFAULT_MINT_SCOPES).not.toContain(scope);
    }
  });
});

describe("MCP_TOOL_SCOPES", () => {
  it("gates both writes behind transactions:write", () => {
    // Editing shares the create scope deliberately, so an already-minted token keeps working.
    // The trade, taken knowingly: such a token can rewrite rows as well as add them.
    expect(MCP_TOOL_SCOPES.create_transactions).toBe("transactions:write");
    expect(MCP_TOOL_SCOPES.update_transactions).toBe("transactions:write");
  });

  /**
   * `bills:write` rather than `transactions:write`, deliberately.
   *
   * A token minted to log fares has no business advancing a schedule cursor or retiring a bill,
   * and folding these into the existing write scope would have granted exactly that to every token
   * already holding it -- the Telegram bot's included -- with no re-mint and no notice.
   */
  it("gates the bill tools behind their own write scope", () => {
    expect(MCP_TOOL_SCOPES.pay_bill).toBe("bills:write");
    expect(MCP_TOOL_SCOPES.create_bill).toBe("bills:write");
    expect(MCP_TOOL_SCOPES.update_bill).toBe("bills:write");
    expect(MCP_TOOL_SCOPES.create_label).toBe("labels:write");
  });

  it("has no delete tool", () => {
    // Editing was added deliberately; deleting was not. A leaked write token can garble rows,
    // which is visible and correctable, but still cannot make them disappear.
    expect(Object.keys(MCP_TOOL_SCOPES).filter((n) => n.includes("delete"))).toEqual([]);
  });

  it("names a known scope for every registered tool", () => {
    for (const tool of Object.keys(MCP_TOOL_SCOPES) as (keyof typeof MCP_TOOL_SCOPES)[]) {
      for (const scope of scopesRequiredBy(tool)) {
        expect(MCP_SCOPES).toContain(scope);
      }
    }
  });

  /**
   * The assessment facts are not aggregates.
   *
   * `MCP_SCOPE_LABELS` promises `budget:read` means "monthly totals, category breakdowns, trends",
   * and this tool's payload carries transaction descriptions, amounts and dates alongside full bill
   * payment history. Serving it on that scope alone made the mint form misleading about what a
   * narrowed token hands over -- the exact failure the labels' own doc comment warns about.
   */
  it("requires every kind of data the assessment facts actually return", () => {
    expect(scopesRequiredBy("get_assessment_facts")).toEqual([
      "budget:read",
      "transactions:read",
      "bills:read",
    ]);
    expect(grantCoversTool(["budget:read"], "get_assessment_facts")).toBe(false);
    expect(grantCoversTool(READ_ONLY_SCOPES, "get_assessment_facts")).toBe(true);
  });

  /** Every scope in a list is required, not any of them. */
  it("refuses a partial grant and accepts a complete one", () => {
    expect(grantCoversTool(["budget:read", "transactions:read"], "get_assessment_facts")).toBe(false);
    expect(
      grantCoversTool(["bills:read", "budget:read", "transactions:read"], "get_assessment_facts")
    ).toBe(true);
    // A single-scope tool still behaves exactly as before.
    expect(grantCoversTool(["bills:read"], "get_upcoming_bills")).toBe(true);
    expect(grantCoversTool(["budget:read"], "get_upcoming_bills")).toBe(false);
  });
});
