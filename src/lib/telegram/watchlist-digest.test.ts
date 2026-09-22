import { describe, expect, it } from "vitest";
import {
  DIGEST_KINDS,
  DIGEST_MAX_LINES,
  composeDigest,
  isDigestDue,
  selectDigestFindings,
  watchlistLink,
  type KeyedFinding,
} from "@/lib/telegram/watchlist-digest";
import type { AssessmentAnomaly, AssessmentAnomalyKind } from "@/types";

const MANILA = -480;

const finding = (kind: AssessmentAnomalyKind, title = `${kind} title`): AssessmentAnomaly => ({
  kind,
  scope: "outstanding",
  title,
  detail: "",
  severity: "medium",
  current: null,
  baseline: null,
  changePct: null,
});

const keyed = (kind: AssessmentAnomalyKind, hash: string = kind, title?: string): KeyedFinding => ({
  finding: finding(kind, title),
  hash,
});

const none = new Set<string>();

describe("DIGEST_KINDS", () => {
  it("sends the findings that ask for something to be done", () => {
    for (const kind of [
      "missed-bill",
      "bill-due-soon",
      "card-payment-due-soon",
      "card-interest-untracked",
      "recurring-renews-soon",
      "missing-expected-income",
      "cash-shortfall",
      "budget-threshold",
      "budget-forecast",
    ] as const) {
      expect(DIGEST_KINDS[kind], kind).toBe(true);
    }
  });

  /** Observations belong in the app. Pushed to a phone, they teach the owner to mute the chat. */
  it("keeps spending-pattern observations out of the chat", () => {
    for (const kind of ["category-spike", "outlier-transaction", "pace", "recurring-new", "logging-gap"] as const) {
      expect(DIGEST_KINDS[kind], kind).toBe(false);
    }
  });
});

describe("isDigestDue", () => {
  // 08:00 in Manila is 00:00 UTC.
  it("is due at the chosen time in the user's own clock, not the server's", () => {
    expect(isDigestDue({ now: new Date("2026-09-22T00:00:00Z"), timezoneOffset: MANILA, digestTime: "08:00" })).toBe(true);
    expect(isDigestDue({ now: new Date("2026-09-21T23:59:00Z"), timezoneOffset: MANILA, digestTime: "08:00" })).toBe(false);
  });

  /** A tick delayed by a deploy must still send; once a day comes from the log's unique index. */
  it("stays due for the rest of the day rather than inside a window", () => {
    expect(isDigestDue({ now: new Date("2026-09-22T10:00:00Z"), timezoneOffset: MANILA, digestTime: "08:00" })).toBe(true);
  });

  /** Unlike the evening prompt: a card falls due on a Saturday too. */
  it("runs at weekends", () => {
    // Saturday 2026-09-26, 09:00 Manila.
    expect(isDigestDue({ now: new Date("2026-09-26T01:00:00Z"), timezoneOffset: MANILA, digestTime: "08:00" })).toBe(true);
  });
});

describe("selectDigestFindings", () => {
  it("keeps only the actionable kinds", () => {
    const picked = selectDigestFindings([keyed("missed-bill"), keyed("category-spike")], none, none);
    expect(picked.map((k) => k.finding.kind)).toEqual(["missed-bill"]);
  });

  /** Resolving or snoozing in the app is the one way to say "I know"; the chat must honour it. */
  it("drops what the owner resolved or snoozed in the app", () => {
    const picked = selectDigestFindings([keyed("missed-bill", "a"), keyed("bill-due-soon", "b")], new Set(["a"]), none);
    expect(picked.map((k) => k.hash)).toEqual(["b"]);
  });

  /** The whole point of "only what is new": yesterday's overdue bill is not news today. */
  it("drops what an earlier digest already sent", () => {
    const picked = selectDigestFindings([keyed("missed-bill", "a"), keyed("bill-due-soon", "b")], none, new Set(["b"]));
    expect(picked.map((k) => k.hash)).toEqual(["a"]);
  });

  it("keeps the order it was given, which is most urgent first", () => {
    const picked = selectDigestFindings(
      [keyed("cash-shortfall", "1"), keyed("missed-bill", "2"), keyed("bill-due-soon", "3")],
      none,
      none
    );
    expect(picked.map((k) => k.hash)).toEqual(["1", "2", "3"]);
  });
});

describe("composeDigest", () => {
  /** Silence is the answer on a quiet day, not a message saying so. */
  it("is null when nothing is new", () => {
    expect(composeDigest([])).toBeNull();
  });

  it("counts what is new and lists each title", () => {
    const text = composeDigest([
      keyed("missed-bill", "a", "1 bill with no payment recorded"),
      keyed("card-payment-due-soon", "b", "BPI Gold is due tomorrow"),
    ]);
    expect(text).toContain("Watchlist: 2 new");
    expect(text).toContain("1 bill with no payment recorded");
    expect(text).toContain("BPI Gold is due tomorrow");
  });

  /** Titles carry names the user typed. Unescaped, `<` is a broken entity and the send fails. */
  it("escapes the user's text for Telegram HTML", () => {
    const text = composeDigest([keyed("card-payment-due-soon", "a", "R&D <Card> is due today")]);
    expect(text).toContain("R&amp;D &lt;Card&gt; is due today");
    expect(text).not.toContain("<Card>");
  });

  it("says how many more there are past the line limit", () => {
    const many = Array.from({ length: DIGEST_MAX_LINES + 3 }, (_, i) => keyed("missed-bill", `h${i}`, `Finding ${i}`));
    const text = composeDigest(many) ?? "";
    expect(text).toContain(`Watchlist: ${DIGEST_MAX_LINES + 3} new`);
    expect(text).toContain(`Finding ${DIGEST_MAX_LINES - 1}`);
    expect(text.split("\n").filter((line) => line.startsWith("\u2022"))).toHaveLength(DIGEST_MAX_LINES);
    expect(text).toContain("and 3 more in the app.");
  });
});

describe("watchlistLink", () => {
  it("opens the Watchlist tab", () => {
    expect(watchlistLink("https://budget.test")).toBe("https://budget.test/analytics?tab=watchlist");
  });

  it("is null when no app URL is configured", () => {
    expect(watchlistLink(null)).toBeNull();
  });
});
