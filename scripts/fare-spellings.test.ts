// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fareKey, planFareMerges, type SpellingUse } from "./fare-spellings";

const use = (description: string, count: number, day = 1): SpellingUse => ({
  description,
  count,
  lastUsed: new Date(Date.UTC(2026, 10, day)),
});

describe("fareKey", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(fareKey("UV Express")).toBe(fareKey("UV express"));
    expect(fareKey("Mini Bus & UV")).toBe(fareKey("Minibus & UV"));
  });

  it("treats 'and' as '&'", () => {
    expect(fareKey("UV and Jeep")).toBe(fareKey("UV & Jeep"));
  });

  // Order records direction, so these are two trips rather than two spellings.
  it("keeps word order", () => {
    expect(fareKey("Jeep & UV")).not.toBe(fareKey("UV & Jeep"));
  });

  // Only the whole word: "candy" must not lose its "and".
  it("removes 'and' only as a word", () => {
    expect(fareKey("UV candy")).toBe("uvcandy");
  });
});

describe("planFareMerges", () => {
  it("merges variants into the most-used spelling", () => {
    const merges = planFareMerges([use("UV & Jeep", 14), use("Uv & Jeep", 1), use("UV and Jeep", 2)]);
    expect(merges).toHaveLength(1);
    expect(merges[0].canonical).toBe("UV & Jeep");
    expect(merges[0].variants.map((v) => v.description).sort()).toEqual(["UV and Jeep", "Uv & Jeep"]);
  });

  it("breaks a tie in count by the most recent use", () => {
    const [merge] = planFareMerges([use("UV & Mini bus", 2, 3), use("UV & Mini Bus", 2, 20)]);
    expect(merge.canonical).toBe("UV & Mini Bus");
  });

  it("leaves a spelling with no variants alone", () => {
    expect(planFareMerges([use("UV", 42), use("Jeep & UV", 19), use("UV & Jeep", 14)])).toEqual([]);
  });

  it("ignores descriptions that are not fares", () => {
    expect(planFareMerges([use("Hot Choco", 3), use("hot choco", 1)])).toEqual([]);
  });

  // The canonical is the trimmed spelling, so an untrimmed one is a variant of it even alone.
  it("trims an untrimmed canonical", () => {
    const [merge] = planFareMerges([use(" UV Express ", 5)]);
    expect(merge.canonical).toBe("UV Express");
    expect(merge.variants.map((v) => v.description)).toEqual([" UV Express "]);
  });
});
