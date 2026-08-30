import { describe, expect, it } from "vitest";
import {
  mentionsLabel,
  readLabelDirective,
  renderLabelNotice,
  type BotLabel,
} from "@/lib/telegram/caption-labels";

const LABELS: BotLabel[] = [
  { id: "lbl_pickleball", name: "Pickleball" },
  { id: "lbl_sports", name: "Sports" },
  { id: "lbl_work", name: "Work" },
  { id: "lbl_work_lunch", name: "Work Lunch" },
];

describe("readLabelDirective", () => {
  it("reads the directive that started this, and keeps the rest of the caption", () => {
    // The caption from the receipt that was saved unlabelled.
    const result = readLabelDirective(
      "Tiendesitas Yosh's Pickleball fee, category fun, label it in pickleball",
      LABELS
    );

    expect(result.ids).toEqual(["lbl_pickleball"]);
    expect(result.names).toEqual(["Pickleball"]);
    expect(result.unresolved).toEqual([]);
    // The description survives whole, including the venue and the category hint Gemini still uses.
    expect(result.rest).toBe("Tiendesitas Yosh's Pickleball fee, category fun");
  });

  it.each([
    "label it pickleball",
    "label it in pickleball",
    "label it as pickleball",
    "label as pickleball",
    "label pickleball",
    "label: pickleball",
    "labels: pickleball",
    "tag it pickleball",
    "tag as pickleball",
    "tag it as pickleball",
    "tag: pickleball",
    "#pickleball",
  ])("recognises %j", (directive) => {
    expect(readLabelDirective(`150 court fee, ${directive}`, LABELS).ids).toEqual([
      "lbl_pickleball",
    ]);
  });

  it("is case-insensitive on the label name", () => {
    expect(readLabelDirective("label it PICKLEBALL", LABELS).names).toEqual(["Pickleball"]);
  });

  it("takes a list of labels", () => {
    const result = readLabelDirective("court fee, label it pickleball and sports", LABELS);
    expect(result.names).toEqual(["Pickleball", "Sports"]);
    expect(result.rest).toBe("court fee");
  });

  it("removes only what it matched, not a connector belonging to the next clause", () => {
    // A connector is part of the directive only when a name follows it. Consuming it regardless
    // deletes a word from the sentence left behind.
    const result = readLabelDirective("label it pickleball and Yosh will pay me back", LABELS);
    expect(result.names).toEqual(["Pickleball"]);
    expect(result.rest).toBe("and Yosh will pay me back");
  });

  it("keeps the clause after the directive intact", () => {
    const result = readLabelDirective("label it pickleball, category fun", LABELS);
    expect(result.names).toEqual(["Pickleball"]);
    expect(result.rest).toBe("category fun");
  });

  it("prefers the longest label name, so a two-word label is not cut in half", () => {
    // "Work" also matches at that position; stopping there would leave "lunch" unmatched and
    // report it back as a label the user does not have.
    const result = readLabelDirective("label it work lunch", LABELS);
    expect(result.names).toEqual(["Work Lunch"]);
    expect(result.unresolved).toEqual([]);
  });

  it("matches whole words only", () => {
    // "Work" must not match inside "workout".
    expect(readLabelDirective("label it workout", LABELS).ids).toEqual([]);
  });

  it("reports a label the user does not have instead of dropping it", () => {
    const result = readLabelDirective("court fee, label it badminton", LABELS);
    expect(result.ids).toEqual([]);
    expect(result.unresolved).toEqual(["badminton"]);
    // The keyword carried a filler word, so this is unambiguously an instruction and comes out
    // of the description even though the name resolved to nothing. Leaving it in put "label it
    // badminton" on the transaction as its description.
    expect(result.rest).toBe("court fee");
  });

  it("keeps parsing after a resolved name, so the rest of the list is not lost", () => {
    // The loop used to break on the first miss and skip the unresolved branch entirely, so this
    // applied Pickleball, said nothing about badminton, and left "and badminton" behind as the
    // description of the purchase.
    const result = readLabelDirective("court fee, label it pickleball and badminton", LABELS);

    expect(result.names).toEqual(["Pickleball"]);
    expect(result.unresolved).toEqual(["badminton"]);
    expect(result.rest).toBe("court fee");
  });

  it("resolves a real label named after an unknown one", () => {
    // Order used to decide whether anything resolved at all: with the unknown name first,
    // nothing was applied and "badminton and pickleball" came back as one invented label.
    const result = readLabelDirective("label it badminton and pickleball", LABELS);

    expect(result.names).toEqual(["Pickleball"]);
    expect(result.unresolved).toEqual(["badminton"]);
  });

  it("reports a bare directive that names nothing", () => {
    // "label pickleball" applies the label, so "label badminton" saying nothing was an
    // asymmetry the user could not explain. A single-word tail is name-shaped enough to report.
    const result = readLabelDirective("label badminton", LABELS);

    expect(result.unresolved).toEqual(["badminton"]);
    // But not removed: with no colon, no filler word and nothing resolved, the evidence that
    // this is an instruction rather than prose is too thin to cut it out of the description.
    expect(result.rest).toBe("label badminton");
  });

  it("does not carry an unknown name across a comma", () => {
    // A comma separates clauses as often as it separates names. Treating this one as a list
    // would report "category fun" as a missing label and delete it from the description.
    const result = readLabelDirective("label it pickleball, category fun", LABELS);

    expect(result.names).toEqual(["Pickleball"]);
    expect(result.unresolved).toEqual([]);
    expect(result.rest).toBe("category fun");
  });

  it("resolves what it can and reports what it cannot", () => {
    const result = readLabelDirective("label it pickleball, label it badminton", LABELS);
    expect(result.names).toEqual(["Pickleball"]);
    expect(result.unresolved).toEqual(["badminton"]);
  });

  it("dedupes a label named twice", () => {
    const result = readLabelDirective("#pickleball label it pickleball", LABELS);
    expect(result.ids).toEqual(["lbl_pickleball"]);
  });

  it("resolves a hyphenated hashtag against a two-word label", () => {
    expect(readLabelDirective("#work-lunch", LABELS).names).toEqual(["Work Lunch"]);
  });

  it.each([
    ["labelled with care", "labelled with care"],
    ["price tag 150", "price tag 150"],
    ["price tag for the shoes", "price tag for the shoes"],
    ["a tagging system", "a tagging system"],
  ])("does not read a directive out of %j", (text, rest) => {
    const result = readLabelDirective(text, LABELS);
    expect(result.ids).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.rest).toBe(rest);
  });

  it("ignores #1 and other non-name hashtags", () => {
    const result = readLabelDirective("table #1", LABELS);
    expect(result.ids).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("finds nothing when the user has no labels", () => {
    const result = readLabelDirective("court fee, label it pickleball", []);
    expect(result.ids).toEqual([]);
    expect(result.unresolved).toEqual(["pickleball"]);
    expect(result.rest).toBe("court fee");
  });

  it("returns the text unchanged when there is no directive at all", () => {
    const result = readLabelDirective("Yosh's pickleball fee", LABELS);
    expect(result.ids).toEqual([]);
    // A bare mention is not a directive: labelling on it would tag "lunch with the pickleball
    // crew" as a game.
    expect(result.rest).toBe("Yosh's pickleball fee");
  });

  it("handles an empty caption", () => {
    expect(readLabelDirective("", LABELS)).toEqual({
      ids: [],
      names: [],
      unresolved: [],
      incompatible: [],
      rest: "",
    });
  });
});

describe("label type compatibility", () => {
  const TYPED: BotLabel[] = [
    { id: "lbl_pickleball", name: "Pickleball", applicableTo: "EXPENSE" },
    { id: "lbl_work", name: "Work", applicableTo: "BOTH" },
    { id: "lbl_salary", name: "Salary", applicableTo: "INCOME" },
  ];

  it("refuses a label that cannot apply to this transaction type", () => {
    // createTransactionBatch type-filters explicit ids *silently*, so a review that promised an
    // income-only label on a receipt showed it and then quietly did not write it.
    const result = readLabelDirective("court fee, label it salary", TYPED, "EXPENSE");

    expect(result.ids).toEqual([]);
    expect(result.incompatible).toEqual(["Salary"]);
    // Not "unresolved": the label exists, and telling them to create it sends them to a screen
    // where it is already sitting.
    expect(result.unresolved).toEqual([]);
  });

  it("applies the same label to the type it does fit", () => {
    const result = readLabelDirective("bonus, label it salary", TYPED, "INCOME");
    expect(result.names).toEqual(["Salary"]);
    expect(result.incompatible).toEqual([]);
  });

  it("always applies a BOTH label", () => {
    expect(readLabelDirective("label it work", TYPED, "EXPENSE").names).toEqual(["Work"]);
    expect(readLabelDirective("label it work", TYPED, "INCOME").names).toEqual(["Work"]);
  });

  it("checks a hashtag too", () => {
    expect(readLabelDirective("#salary", TYPED, "EXPENSE").incompatible).toEqual(["Salary"]);
  });

  it("keeps the compatible half of a list", () => {
    const result = readLabelDirective("label it pickleball and salary", TYPED, "EXPENSE");
    expect(result.names).toEqual(["Pickleball"]);
    expect(result.incompatible).toEqual(["Salary"]);
  });

  it("skips the check when no type is given", () => {
    // The search path has no transaction to be compatible with.
    expect(readLabelDirective("label it salary", TYPED).names).toEqual(["Salary"]);
  });
});

describe("mentionsLabel", () => {
  it.each(["label it pickleball", "tag as work", "#pickleball", "Labels: work"])(
    "is true for %j",
    (text) => expect(mentionsLabel(text)).toBe(true)
  );

  it.each(["100 breakfast", "350 groceries at SM", "table #1"])("is false for %j", (text) =>
    expect(mentionsLabel(text)).toBe(false)
  );
});

describe("renderLabelNotice", () => {
  it("names the labels it applied", () => {
    const notice = renderLabelNotice({ names: ["Pickleball", "Sports"], unresolved: [] });
    expect(notice).toContain("Pickleball, Sports");
  });

  it("names a label the user does not have rather than staying silent", () => {
    // A label that silently went nowhere is the bug this whole module exists for, and the bot
    // cannot create one: create_transactions is its only write.
    const notice = renderLabelNotice({ names: [], unresolved: ["badminton"] });
    expect(notice).toContain("badminton");
    expect(notice).toContain("Create");
  });

  it("admits the lookup failed instead of claiming the label does not exist", () => {
    // An empty label list means two different things and the reply used to pick the wrong one:
    // "you don't have a label called pickleball, create it in the app" is confidently false when
    // the list could not be read, and sends the user to the wrong fix. The cause is a token
    // minted without labels:read.
    const notice = renderLabelNotice({ names: [], unresolved: ["pickleball"] }, false);

    expect(notice).toContain("couldn't read your labels");
    expect(notice).toContain("pickleball");
    expect(notice).toContain("labels:read");
    // And it must not tell them to create something they may well already have.
    expect(notice).not.toContain("Create");
    expect(notice).not.toContain("You don't have");
  });

  it("says nothing about readability when every label resolved", () => {
    // The warning is about names that went nowhere. A directive that fully resolved cannot have
    // come from an unreadable list, so there is nothing to caveat.
    expect(renderLabelNotice({ names: ["Pickleball"], unresolved: [] }, false)).not.toContain(
      "couldn't read"
    );
  });

  it("says a mismatched label exists rather than telling them to create it", () => {
    const notice = renderLabelNotice({ names: [], unresolved: [], incompatible: ["Salary"] });

    expect(notice).toContain("Salary");
    expect(notice).toContain("doesn't apply to this kind of transaction");
    expect(notice).toContain('"Both"');
    // They have it. "Create it in the app" would send them somewhere it already is.
    expect(notice).not.toContain("Create");
  });

  it("says nothing when no label was mentioned at all", () => {
    expect(renderLabelNotice({ names: [], unresolved: [] })).toBe("");
  });
});
