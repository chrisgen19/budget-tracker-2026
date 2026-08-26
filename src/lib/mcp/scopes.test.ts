import { describe, it, expect } from "vitest";
import {
  DEFAULT_MINT_SCOPES,
  MCP_SCOPES,
  MCP_SCOPE_LABELS,
  READ_ONLY_SCOPES,
  grantsWrite,
  isPrivilegedScope,
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
