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

  it("honours a zero, negative or fractional cap", () => {
    // The cap was `.slice(0, limit)`, which absorbed all three quietly. Moving it into the
    // suppression loop as `=== limit` meant none of them ever matched, so a limit of 0 returned the
    // entire list -- the opposite of what was asked for.
    const rows = ["a", "b", "c", "d"].flatMap((d) => repeat(3, { description: d }));

    expect(deriveFrequentTiles(rows, { limit: 0 })).toHaveLength(0);
    expect(deriveFrequentTiles(rows, { limit: -1 })).toHaveLength(0);
    expect(deriveFrequentTiles(rows, { limit: 2.5 })).toHaveLength(2);
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

describe("deriveFrequentTiles: one habit, one slot (#268)", () => {
  it("deduplicates order variants through the superset that contains them", () => {
    // How the real ledger's three spellings of one commute collapse, now that sorting is gone.
    // `uv & jeep` and `jeep & uv` are each contained by `uv express & jeep fare`, so containment
    // does the work the sorted key was added for -- and does it without ever having to decide
    // whether word order carries meaning.
    const tiles = deriveFrequentTiles([
      ...repeat(9, { description: "UV Express & Jeep fare", amount: 38 }),
      ...repeat(6, { description: "UV & Jeep", amount: 38 }),
      ...repeat(3, { description: "Jeep & UV", amount: 38 }),
    ]);

    expect(tiles.map((t) => t.description)).toEqual(["UV Express & Jeep fare"]);
  });

  it("leaves two bare order variants each holding a slot", () => {
    // The accepted residual, pinned so it is a recorded limit rather than a surprise. With no
    // containing superset there is nothing to suppress them under, and the alternative -- deciding
    // they are the same by sorting -- is what merged two fares twice. A duplicate button costs a
    // slot on the grid; that merge cost a wrong fare in the ledger.
    const tiles = deriveFrequentTiles([
      ...repeat(4, { description: "UV & Jeep", amount: 38 }),
      ...repeat(3, { description: "Jeep & UV", amount: 38 }),
    ]);

    expect(tiles.map((t) => t.description)).toEqual(["UV & Jeep", "Jeep & UV"]);
  });

  it("gives the slot to whichever variant is logged more, and keeps its count honest", () => {
    // `uv express & jeep fare` (4x) outranks `uv & jeep` (3x), so it survives. The suppressed
    // group's occurrences stay where they were -- they were never the survivor's, and reporting 7x
    // would be a figure nothing paid.
    const tiles = deriveFrequentTiles([
      ...repeat(4, { description: "UV Express & Jeep fare", amount: 38 }),
      ...repeat(3, { description: "UV & Jeep", amount: 38 }),
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ description: "UV Express & Jeep fare", count: 4 });
  });

  it("suppresses the longer variant when the shorter one is logged more", () => {
    // Both directions, because ranking is by count and not by length. On real data `gsm green`
    // (13x) outranked `gsm green ride` (4x), so the survivor was the shorter description.
    const tiles = deriveFrequentTiles([
      ...repeat(5, { description: "GSM Green", amount: 231.5 }),
      ...repeat(3, { description: "GSM Green ride", amount: 247 }),
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ description: "GSM Green", count: 5, amount: 231.5 });
  });

  it("hands a suppressed slot to the next real habit rather than leaving a hole", () => {
    // The bug this closes. Suppression runs before the cap, so a variant of a button already on
    // the grid cannot push a genuine sixth habit off the bottom -- which is how `Pandesal` was
    // lost.
    const tiles = deriveFrequentTiles([
      ...repeat(9, { description: "UV Express & Jeep fare", amount: 38 }),
      ...repeat(6, { description: "UV & Jeep", amount: 38 }),
      ...repeat(5, { description: "Jeep & UV fare", amount: 38 }),
      ...repeat(4, { description: "a", amount: 10 }),
      ...repeat(4, { description: "b", amount: 10 }),
      ...repeat(4, { description: "c", amount: 10 }),
      ...repeat(4, { description: "d", amount: 10 }),
      ...repeat(3, { description: "pandesal", amount: 40 }),
    ]);

    expect(tiles.map((t) => t.description)).toEqual([
      "UV Express & Jeep fare",
      "a",
      "b",
      "c",
      "d",
      "pandesal",
    ]);
  });

  it("clears a configured tile's variants, not just its exact spelling", () => {
    // The layer that makes the grid self-heal. Exact-matching the exclusion list left a variant
    // sitting in Frequent underneath the very tile configured to replace it, so the redundancy
    // survived the one action a user would take to fix it.
    const tiles = deriveFrequentTiles(
      [
        ...repeat(4, { description: "UV & Jeep", amount: 38 }),
        ...repeat(3, { description: "pandesal", amount: 40 }),
      ],
      { excludeKeys: ["UV Express & Jeep fare"] }
    );

    expect(tiles.map((t) => t.description)).toEqual(["pandesal"]);
  });

  it("suppresses a genuinely distinct trip that happens to share every word", () => {
    // The accepted cost, pinned so it is recorded here rather than discovered on someone's grid.
    // An airport run is not a `Grab` to the office, but its words contain the shorter one's, so it
    // loses the slot. Deliberate: a lost button is visible and configurable, where a merge would
    // have offered 250 under "Grab to airport" and written it on one tap.
    const tiles = deriveFrequentTiles([
      ...repeat(5, { description: "Grab", amount: 250 }),
      ...repeat(3, { description: "Grab to airport", amount: 3000 }),
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ description: "Grab", amount: 250 });
  });

  it("picks the same survivor however the rows arrive", () => {
    // Ranking used to decide only the order of two tiles that both appeared, so a tie could fall
    // back to the caller's row order harmlessly. Suppression made a tie decide which tile *exists*:
    // equal counts and an equal `lastLoggedAt` here, so without a final tie-break reversing the
    // input swapped a 100 tile for a 900 one.
    const rows = [
      ...repeat(3, { description: "grab", amount: 100 }),
      ...repeat(3, { description: "grab to airport", amount: 900 }),
    ];

    const forward = deriveFrequentTiles(rows);
    const reversed = deriveFrequentTiles([...rows].reverse());

    expect(forward).toHaveLength(1);
    expect(forward).toEqual(reversed);
  });

  it("does not let a dash count as a word", () => {
    // `UV Express - Office to House` is a real configured tile description. A bare "-" in its token
    // set would stop it containing the variant it should.
    const tiles = deriveFrequentTiles(repeat(3, { description: "Office - To House" }), {
      excludeKeys: ["Office To House"],
    });

    expect(tiles).toHaveLength(0);
  });

  it("keeps a hyphenated word and a non-ASCII one whole", () => {
    // Splitting on punctuation generally would cut `Piñata` in half on a non-ASCII-blind rule, and
    // would make `e-load` two words that a bare `load` then contains.
    const tiles = deriveFrequentTiles([
      ...repeat(3, { description: "e-load", amount: 100 }),
      ...repeat(3, { description: "Piñata", amount: 500 }),
    ]);

    expect(tiles.map((t) => t.description).sort()).toEqual(["Piñata", "e-load"]);
  });

  it("never merges two directions of one trip", () => {
    // The P1 raised on #269, and the reason sorting is gated. Six 38 trips out and three 80 trips
    // back merge to nine rows whose modal amount is 38 at a 67% share -- over
    // `FREQUENT_STABLE_SHARE` -- while `description` is the most recent spelling. The tile read
    // "House to Office" and one-tapped 38: a wrong fare written with no confirmation, which is the
    // exact failure this module argues against for merging, committed by the grouping step.
    const tiles = deriveFrequentTiles([
      ...[1, 2, 3, 4, 5, 6].map((d) =>
        row({ description: "UV Express - Office to House", amount: 38, date: day(d) })
      ),
      ...[7, 8, 9].map((d) =>
        row({ description: "UV Express - House to Office", amount: 80, date: day(d) })
      ),
    ]);

    expect(tiles).toEqual([
      expect.objectContaining({
        description: "UV Express - Office to House",
        amount: 38,
        count: 6,
      }),
      expect.objectContaining({
        description: "UV Express - House to Office",
        amount: 80,
        count: 3,
      }),
    ]);
  });

  it("keeps two directions apart at the suppression step too", () => {
    // Gating the sort is not sufficient on its own: suppression compares token *sets*, and
    // `{office, to, house}` equals `{house, to, office}`, so the two would survive grouping and be
    // collapsed here instead -- suppressing one real trip in favour of the other.
    const tiles = deriveFrequentTiles([
      ...repeat(4, { description: "Astra to Mirea", amount: 213 }),
      ...repeat(3, { description: "Mirea to Astra", amount: 390 }),
    ]);

    expect(tiles.map((t) => t.description)).toEqual(["Astra to Mirea", "Mirea to Astra"]);
  });

  it("never merges a direction written with a conjunction instead of a preposition", () => {
    // The second review round's P1, and the reason sorting was removed rather than gated harder.
    // `Office & House fare` carries no `to`/`from`, so a rule that sorted "across a conjunction"
    // treated it as commutative and merged it with `House & Office fare` -- nine rows, modal 38 at
    // a 67% share, captioned as the return trip and one-tapping the outbound fare. Commutativity
    // is not readable from the text, so it is no longer guessed at.
    const tiles = deriveFrequentTiles([
      ...[1, 2, 3, 4, 5, 6].map((d) =>
        row({ description: "Office & House fare", amount: 38, date: day(d) })
      ),
      ...[7, 8, 9].map((d) =>
        row({ description: "House & Office fare", amount: 80, date: day(d) })
      ),
    ]);

    expect(tiles).toEqual([
      expect.objectContaining({ description: "Office & House fare", amount: 38, count: 6 }),
      expect.objectContaining({ description: "House & Office fare", amount: 80, count: 3 }),
    ]);
  });

  it("leaves two habits that merely share a word alone", () => {
    // Containment, not overlap. `lunch` is in both, but neither word set contains the other, so
    // both keep their slot -- the rule is a set relation and not a similarity score.
    const tiles = deriveFrequentTiles([
      ...repeat(4, { description: "lunch at work", amount: 150 }),
      ...repeat(3, { description: "lunch with mom", amount: 400 }),
    ]);

    expect(tiles.map((t) => t.description)).toEqual(["lunch at work", "lunch with mom"]);
  });
});
