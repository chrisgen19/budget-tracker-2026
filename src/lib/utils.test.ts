import { describe, expect, it } from "vitest";
import { formatCurrency, getCurrencySymbol, maskCurrency } from "@/lib/utils";

describe("maskCurrency", () => {
  it("formats the amount when nothing is hidden", () => {
    expect(maskCurrency(1234.5, "PHP", false)).toBe(formatCurrency(1234.5, "PHP"));
  });

  /** One spelling app-wide: the bills page used `***` while everything else used bullets, so
   *  switching hiding on produced two different-looking redactions on the same screen. */
  it("masks with the currency symbol and bullets", () => {
    expect(maskCurrency(1234.5, "PHP", true)).toBe(`${getCurrencySymbol("PHP")} ••••••`);
    expect(maskCurrency(1234.5, "USD", true)).toBe("$ ••••••");
  });

  it("leaks no digits of the amount it hides", () => {
    expect(maskCurrency(98765, "PHP", true)).not.toMatch(/\d/);
  });
});
