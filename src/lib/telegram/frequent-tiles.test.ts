import { describe, expect, it } from "vitest";
import {
  FREQUENT_STABLE_SHARE,
  deriveFrequentTiles,
  type FrequentSource,
} from "@/lib/telegram/frequent-tiles";

const day = (n: number) => new Date(Date.UTC(2026, 8, n, 4, 0, 0));

const row = (over: Partial<FrequentSource> = {}): FrequentSource => ({
  description: "grab",
  amount: 250,
  categoryId: "transportation",
  categoryName: "Transportation",
  date: day(1),
  ...over,
});

/** `n` rows of the same thing, on consecutive days so recency is well defined. */
const repeat = (n: number, over: Partial<FrequentSource> = {}): FrequentSource[] =>
  Array.from({ length: n }, (_, i) => row({ ...over, date: day(i + 1) }));

describe("deriveFrequentTiles", () => {
  it("promotes something logged often enough", () => {
    const tiles = deriveFrequentTiles(repeat(4));

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      key: "grab",
      description: "grab",
      count: 4,
      amount: 250,
      amountIsStable: true,
      categoryId: "transportation",
    });
  });

  it("ignores something logged only twice", () => {
    // Twice is a coincidence. A button is a permanent-looking thing on a grid navigated by muscle
    // memory, so the bar is a habit rather than a repeat.
    expect(deriveFrequentTiles(repeat(2))).toHaveLength(0);
  });

  it("merges the two ways one apostrophe gets typed", () => {
    // iOS substitutes U+2019 as you type, so the same person writes one merchant two ways on one
    // phone. Unfolded, each spelling falls below the threshold and neither appears -- which is
    // exactly the silence #252 was about.
    const tiles = deriveFrequentTiles([
      row({ description: "Angel's Coffee", date: day(1) }),
      row({ description: "Angel’s Coffee", date: day(2) }),
      row({ description: "Angel's Coffee", date: day(3) }),
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].count).toBe(3);
  });

  it("merges spacing variants too", () => {
    const tiles = deriveFrequentTiles([
      row({ description: "hot  choco", date: day(1) }),
      row({ description: " hot choco ", date: day(2) }),
      row({ description: "Hot Choco", date: day(3) }),
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].count).toBe(3);
  });

  it("shows the most recent spelling, not the folded key", () => {
    // The version they currently write is the one they will recognise on a button.
    const tiles = deriveFrequentTiles([
      row({ description: "grab", date: day(1) }),
      row({ description: "grab", date: day(2) }),
      row({ description: "Grab Car", date: day(3), amount: 250 }),
    ]);

    // Three different foldings here, so pick the one group that has three rows instead.
    const merged = deriveFrequentTiles([
      row({ description: "jollibee", date: day(1) }),
      row({ description: "JOLLIBEE", date: day(2) }),
      row({ description: "Jollibee", date: day(3) }),
    ]);

    expect(tiles).toHaveLength(0);
    expect(merged[0].description).toBe("Jollibee");
    expect(merged[0].key).toBe("jollibee");
  });
});

describe("deriveFrequentTiles: the amount", () => {
  it("takes the mode, not the mean", () => {
    // Three fares and one airport trip. The mean is 778, which is not a fare and is not anything.
    const tiles = deriveFrequentTiles([
      row({ amount: 38, date: day(1) }),
      row({ amount: 38, date: day(2) }),
      row({ amount: 38, date: day(3) }),
      row({ amount: 3000, date: day(4) }),
    ]);

    expect(tiles[0].amount).toBe(38);
  });

  it("takes the mode, not the median", () => {
    // Deliberately shaped so the median is a different number, or the assertion would pass under
    // either rule and prove nothing. Sorted these are 38, 38, 38, 80, 90, 100, 110: the mode is
    // 38, paid three times, and the median is 80, paid once.
    //
    // The case that rules the median out entirely is an even-sized bimodal commute -- 38 out and
    // 80 home under one description gives a median of 59, a figure nobody ever paid and which
    // would be written straight into the ledger.
    const tiles = deriveFrequentTiles([
      row({ amount: 38, date: day(1) }),
      row({ amount: 38, date: day(2) }),
      row({ amount: 38, date: day(3) }),
      row({ amount: 80, date: day(4) }),
      row({ amount: 90, date: day(5) }),
      row({ amount: 100, date: day(6) }),
      row({ amount: 110, date: day(7) }),
    ]);

    expect(tiles[0].amount).toBe(38);
  });

  it("breaks a tie by recency", () => {
    // Equally often means the habit is changing, and the newer amount is the better guess at what
    // the next tap means.
    const tiles = deriveFrequentTiles([
      row({ amount: 38, date: day(1) }),
      row({ amount: 38, date: day(2) }),
      row({ amount: 45, date: day(3) }),
      row({ amount: 45, date: day(4) }),
    ]);

    expect(tiles[0].amount).toBe(45);
  });

  it("does not offer one tap when the amount barely repeats", () => {
    // The rule: the user may assert a fixed amount, the system may never infer one. The tile still
    // appears -- not typing the description is still worth something -- but the pad asks.
    const tiles = deriveFrequentTiles([
      row({ amount: 120, date: day(1) }),
      row({ amount: 250, date: day(2) }),
      row({ amount: 480, date: day(3) }),
      row({ amount: 310, date: day(4) }),
    ]);

    expect(tiles[0].amountIsStable).toBe(false);
    expect(tiles[0].amount).not.toBeNull();
  });

  it("offers one tap exactly at the stability threshold", () => {
    // 3 of 5 is 0.6. Pinned so the boundary is a decision rather than an accident of rounding.
    expect(FREQUENT_STABLE_SHARE).toBe(0.6);

    const tiles = deriveFrequentTiles([
      row({ amount: 38, date: day(1) }),
      row({ amount: 38, date: day(2) }),
      row({ amount: 38, date: day(3) }),
      row({ amount: 80, date: day(4) }),
      row({ amount: 95, date: day(5) }),
    ]);

    expect(tiles[0].amountIsStable).toBe(true);
  });

  it("treats float noise as the same amount", () => {
    // `transactions.amount` is a Float, so two rows both entered as 38.00 can differ in the last
    // bits. Ungrouped, these split two-and-two: the share drops to 0.5 and a perfectly stable
    // fare is reported as needing the pad. Four rows rather than three on purpose, so the
    // unrounded reading really does fall below the threshold instead of scraping over it.
    const tiles = deriveFrequentTiles([
      row({ amount: 38, date: day(1) }),
      row({ amount: 38.000000000000004, date: day(2) }),
      row({ amount: 38.000000000000004, date: day(3) }),
      row({ amount: 38, date: day(4) }),
    ]);

    expect(tiles[0].amount).toBe(38);
    expect(tiles[0].amountIsStable).toBe(true);
  });
});

describe("deriveFrequentTiles: selection", () => {
  it("drops anything already configured as a tile", () => {
    // The grid would otherwise show the same thing twice, and the derived copy carries no
    // configured category.
    const tiles = deriveFrequentTiles(
      [...repeat(4), ...repeat(3, { description: "lunch at work" })],
      { excludeKeys: ["Lunch At Work"] }
    );

    expect(tiles.map((t) => t.key)).toEqual(["grab"]);
  });

  it("folds the exclusion list the same way it folds the rows", () => {
    // Otherwise a configured tile written with a curly apostrophe fails to exclude the rows
    // written with a straight one, and the grid shows both.
    const tiles = deriveFrequentTiles(repeat(3, { description: "Angel's Coffee" }), {
      excludeKeys: ["Angel’s  Coffee"],
    });

    expect(tiles).toHaveLength(0);
  });

  it("orders by count, then by recency", () => {
    const tiles = deriveFrequentTiles([
      ...repeat(5, { description: "grab" }),
      ...repeat(3, { description: "old thing" }).map((r) => ({ ...r, date: day(1) })),
      ...repeat(3, { description: "new thing" }).map((r) => ({ ...r, date: day(20) })),
    ]);

    expect(tiles.map((t) => t.key)).toEqual(["grab", "new thing", "old thing"]);
  });

  it("caps the list", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g", "h"].flatMap((d) =>
      repeat(3, { description: d })
    );

    expect(deriveFrequentTiles(rows)).toHaveLength(6);
    expect(deriveFrequentTiles(rows, { limit: 2 })).toHaveLength(2);
  });

  it("uses the category most of the rows were filed under", () => {
    const tiles = deriveFrequentTiles([
      row({ date: day(1), categoryId: "food", categoryName: "Food & Dining" }),
      row({ date: day(2), categoryId: "food", categoryName: "Food & Dining" }),
      row({ date: day(3), categoryId: "other", categoryName: "Other Expense" }),
    ]);

    expect(tiles[0].categoryName).toBe("Food & Dining");
  });

  it("ignores a blank description rather than making a nameless button", () => {
    // `transactionSchema` defaults description to "", so empty rows are reachable.
    expect(deriveFrequentTiles(repeat(4, { description: "   " }))).toHaveLength(0);
  });

  it("does not depend on the caller's row order", () => {
    const rows = [
      row({ description: "grab", date: day(3), amount: 250 }),
      row({ description: "grab", date: day(1), amount: 250 }),
      row({ description: "Grab", date: day(2), amount: 250 }),
    ];

    expect(deriveFrequentTiles(rows)[0].lastLoggedAt).toEqual(day(3));
  });
});
