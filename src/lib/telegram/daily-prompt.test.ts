import { afterAll, describe, expect, it } from "vitest";
import { composePrompt, isPromptDue } from "@/lib/telegram/daily-prompt";

const ORIGINAL_TZ = process.env.TZ;

const restoreTimeZone = () => {
  // Assigning `undefined` stores the string "undefined", which is not a zone: Node drops to UTC
  // and every later test in the worker reads a different clock.
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
};

afterAll(restoreTimeZone);

const inTimeZone = <T>(timeZone: string, fn: () => T): T => {
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    restoreTimeZone();
  }
};

/** West of UTC, east of UTC, and UTC itself. The process zone must not matter at all. */
const ZONES = ["America/Los_Angeles", "Asia/Manila", "UTC"];

/** Asia/Manila. `getTimezoneOffset()` convention, so UTC+8 is negative. */
const MANILA = -480;

describe("isPromptDue", () => {
  // The case the whole design turns on. 20:00 in Manila is 12:00 UTC, and the container runs in
  // UTC, so anything reading the host clock asks the question eight hours off.
  it("fires at 20:00 Manila, which is midday UTC", () => {
    for (const zone of ZONES) {
      inTimeZone(zone, () => {
        // Tuesday 2026-09-01, 12:00Z = Tuesday 20:00 in Manila.
        const due = isPromptDue({
          now: new Date("2026-09-01T12:00:00.000Z"),
          timezoneOffset: MANILA,
          promptTime: "20:00",
        });
        expect(due, zone).toBe(true);
      });
    }
  });

  it("stays quiet a minute before the time", () => {
    for (const zone of ZONES) {
      inTimeZone(zone, () => {
        // 11:59Z = 19:59 in Manila.
        expect(
          isPromptDue({
            now: new Date("2026-09-01T11:59:00.000Z"),
            timezoneOffset: MANILA,
            promptTime: "20:00",
          }),
          zone
        ).toBe(false);
      });
    }
  });

  // Not a 15-minute window on purpose. A tick delayed by a slow run or a restart would otherwise
  // drop the day silently, and a prompt that never arrives is indistinguishable from a quiet day.
  it("still fires when the cron tick is late", () => {
    expect(
      isPromptDue({
        now: new Date("2026-09-01T14:37:00.000Z"), // 22:37 Manila, hours past due
        timezoneOffset: MANILA,
        promptTime: "20:00",
      })
    ).toBe(true);
  });

  describe("weekdays are the user's weekdays, not the container's", () => {
    // Saturday 00:30 in Manila is still Friday 16:30 UTC. A host-clock check sends on a Saturday.
    it("does not fire early on a Manila Saturday that is still Friday in UTC", () => {
      expect(
        isPromptDue({
          now: new Date("2026-09-05T16:30:00.000Z"), // Sat 00:30 Manila
          timezoneOffset: MANILA,
          promptTime: "20:00",
        })
      ).toBe(false);
    });

    // Monday 07:00 in Manila is Sunday 23:00 UTC. The mirror image: a host-clock check would
    // treat a genuine Monday as a Sunday and skip it.
    it("treats Monday morning in Manila as a Monday, not the UTC Sunday", () => {
      expect(
        isPromptDue({
          now: new Date("2026-09-06T23:00:00.000Z"), // Mon 07:00 Manila
          timezoneOffset: MANILA,
          promptTime: "00:00",
        })
      ).toBe(true);
    });

    it("never fires on a weekend", () => {
      for (const iso of [
        "2026-09-05T13:00:00.000Z", // Sat 21:00 Manila
        "2026-09-06T13:00:00.000Z", // Sun 21:00 Manila
      ]) {
        expect(
          isPromptDue({ now: new Date(iso), timezoneOffset: MANILA, promptTime: "20:00" }),
          iso
        ).toBe(false);
      }
    });
  });

  // Why the stored value is validated as zero-padded. The comparison is a string compare, and
  // "8:00" sorts *after* "20:00", so an unpadded 8am is treated as later than any evening and
  // the prompt simply never fires - a silent no-op, not a visible error. This pins the 400 in
  // PATCH /api/preferences that keeps such a value out of the column.
  it("is broken by an unpadded time, which is why the column rejects one", () => {
    const eveningManila = {
      now: new Date("2026-09-01T12:00:00.000Z"), // 20:00 Manila, well past 8am
      timezoneOffset: MANILA,
    };
    expect(isPromptDue({ ...eveningManila, promptTime: "08:00" })).toBe(true);
    expect(isPromptDue({ ...eveningManila, promptTime: "8:00" })).toBe(false);
  });

  it("handles a user west of UTC", () => {
    // Los Angeles is UTC-7 in September, so offset 420. 20:00 local is 03:00Z the next day.
    expect(
      isPromptDue({
        now: new Date("2026-09-02T03:00:00.000Z"), // Tue 20:00 LA
        timezoneOffset: 420,
        promptTime: "20:00",
      })
    ).toBe(true);
  });
});

describe("composePrompt", () => {
  // Silence is a real answer. A prompt that arrives when everything is already logged trains the
  // reader to ignore it, and an ignored prompt is worth less than no prompt at all.
  it("says nothing when both are already logged", () => {
    expect(composePrompt({ hasFare: true, hasLunch: true })).toBeNull();
  });

  it("asks about both when neither is logged", () => {
    const msg = composePrompt({ hasFare: false, hasLunch: false });
    expect(msg).toContain("Fare today?");
    expect(msg).toContain("Lunch?");
  });

  it("asks only about what is missing", () => {
    expect(composePrompt({ hasFare: true, hasLunch: false })).toContain("lunch");
    expect(composePrompt({ hasFare: true, hasLunch: false })).not.toContain("Fare today?");
    expect(composePrompt({ hasFare: false, hasLunch: true })).toContain("fare");
    expect(composePrompt({ hasFare: false, hasLunch: true })).not.toContain("Lunch?");
  });

  // The question has two halves, so the example answers both in one message. That only became
  // honest once the shorthand path could split it (#204); before, this exact text would have
  // logged a single wrong row.
  it("shows an example that answers both halves at once", () => {
    const msg = composePrompt({ hasFare: false, hasLunch: false });
    expect(msg).toContain("250 grab, 180 lunch");
  });
});
