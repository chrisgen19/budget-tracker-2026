import { describe, expect, it } from "vitest";
import { isMobileTabActive } from "./mobile-tab-bar";

describe("isMobileTabActive", () => {
  it("matches a destination and its nested routes", () => {
    expect(isMobileTabActive("/transactions", "/transactions")).toBe(true);
    expect(isMobileTabActive("/transactions/import", "/transactions")).toBe(true);
  });

  it("does not match a similarly prefixed route", () => {
    expect(isMobileTabActive("/transaction-settings", "/transactions")).toBe(false);
  });
});
