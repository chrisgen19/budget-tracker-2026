import { describe, it, expect } from "vitest";
import {
  DEFAULT_MINT_SCOPES,
  MCP_SCOPES,
  MCP_SCOPE_LABELS,
  grantsWrite,
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

  it("offers every read scope by default", () => {
    expect(DEFAULT_MINT_SCOPES).toEqual(MCP_SCOPES.filter((s) => !isWriteScope(s)));
  });
});
