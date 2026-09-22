/**
 * Proves card spending leaves the bank exactly once in the cash-flow forecast.
 *
 * A card purchase is an ordinary EXPENSE, so it already lowers the tracked balance the day it is
 * made. Projecting a payment for it as well takes the same money out twice, and the first cut of
 * this feature did exactly that: the forecast reported a lower floor than the account would ever
 * really see, which manufactures cash crunches in the one report whose whole output is "how low
 * does this go, and when".
 *
 * A script against a real database rather than a unit test, because **the fix is a `where` clause**.
 * `cash-flow-forecast.cards.test.ts` feeds `cardPaymentEvents` hand-built rows and proves the
 * arithmetic; nothing in it can see which rows the route actually fetches. Removing both halves of
 * the fix -- the `creditAccountId: null` exclusion and the `credit_payments` subtraction -- leaves
 * all 2,549 unit tests green and type-check clean. That was measured, not assumed. It is the same
 * gap `verify-assessment-facts.ts` exists to cover: pure functions handed rows cannot notice a
 * query that hands them the wrong ones.
 *
 * What it pins, on one throwaway account:
 *
 *   1. A card purchase does not lower the projected balance twice.
 *   2. A payment already made does lower it, though it is in no `transactions` row.
 *   3. `trackedBalanceToday` is cash-like: the identity `cash = tracked + owed - card openings`,
 *      which `.claude/rules/cards.md` states, actually holds against the route's own numbers.
 *   4. The projected floor never dips below the cash the account really ends with.
 *
 * A second account (`cycleAndArchivedScenario`) pins three more read bugs Codex found on #373: an
 * early payment taken again on its due date, an archived card's debt dropped entirely, and a
 * future-dated payment treated as already made.
 *
 * Creates and deletes its own user, so it never touches a real account. It needs the credit cards
 * feature switched on for that user, which it does by making them an ADMIN -- `canUseCreditCards`
 * lets an admin through whatever the site setting says, so the run cannot be broken by an unrelated
 * /admin/settings change.
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://127.0.0.1:3111 pnpm exec tsx --env-file=.env scripts/verify-forecast-card-payments.ts
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const prisma = new PrismaClient();
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";

/**
 * Refuse to send a session over cleartext to anything but this machine.
 *
 * The same guard `verify-telegram-miniapp.ts`, `verify-transaction-update.ts`,
 * `verify-mcp-bill-writes.ts` and `verify-label-removal-stamps.ts` carry. `BASE_URL` is an
 * environment variable, so pointing it at a staging host over plain `http:` is one paste away, and
 * what travels here is worse than theirs: a signed session for an **ADMIN**, valid until the JWT
 * expires. Deleting the throwaway user afterwards does not revoke it. Checked before any fixture is
 * written or token minted, so a refused run leaves nothing behind.
 */
const requireSafeBaseUrl = (raw: string): void => {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return;
  throw new Error(
    `BASE_URL must use https outside this machine; got ${url.protocol}//${url.hostname}`
  );
};

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

const near = (a: number, b: number, tolerance = 0.5) => Math.abs(a - b) <= tolerance;
const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2 });

/** A calendar day `days` from today, as YYYY-MM-DD, in UTC to match how the route stores them. */
const dayFromToday = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

interface ForecastResponse {
  configured: boolean;
  trackedBalanceToday?: number;
  lowestBalance?: { date: string; balance: number } | null;
  daily?: Array<{ date: string; projectedBalance: number; events: Array<{ kind: string; amount: number }> }>;
  assumptions?: string[];
}

async function main() {
  requireSafeBaseUrl(BASE);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session cookie");
  await firstScenario(secret);
  await cycleAndArchivedScenario(secret);
  await preOpeningDebtScenario(secret);
  await unscheduledScenario(secret);
}

async function firstScenario(secret: string) {
  const user = await prisma.user.create({
    data: {
      email: `fcp-${Date.now()}@test.local`,
      name: "Forecast Cards",
      password: "x",
      // Admins always pass `canUseCreditCards`, so an unrelated /admin/settings value cannot
      // silently turn this run into a no-op that reports PASS.
      role: "ADMIN",
      timezoneOffset: 0,
      forecastOpeningBalance: 100_000,
      forecastOpeningBalanceDate: at(dayFromToday(-30)),
    },
  });

  try {
    const category = await prisma.category.create({
      data: { name: `FCP Spend ${Date.now()}`, type: "EXPENSE", icon: "ShoppingBag", color: "#E07C4F", userId: user.id },
    });

    // Due in three days, well inside a 30-day horizon and after "today", so the payment lands in
    // the window rather than on its very first day.
    const dueDay = Number(dayFromToday(3).slice(8, 10));
    const account = await prisma.creditAccount.create({
      data: {
        name: "FCP Card",
        userId: user.id,
        openingBalance: 0,
        openingBalanceDate: at(dayFromToday(-30)),
        dueDay,
        plannedPayment: 20_000,
      },
    });

    // 20,000 bought on the card, and 5,000 of it already paid off from the bank.
    await prisma.transaction.create({
      data: {
        amount: 20_000, type: "EXPENSE", description: "FCP card purchase",
        date: at(dayFromToday(-10)), categoryId: category.id, userId: user.id,
        creditAccountId: account.id,
      },
    });
    await prisma.creditPayment.create({
      data: { amount: 5_000, kind: "PAYMENT", description: "FCP part payment", date: at(dayFromToday(-5)), accountId: account.id, userId: user.id },
    });
    // One ordinary cash expense, so a passing run cannot be the route ignoring transactions wholesale.
    await prisma.transaction.create({
      data: {
        amount: 1_000, type: "EXPENSE", description: "FCP groceries",
        date: at(dayFromToday(-8)), categoryId: category.id, userId: user.id,
      },
    });

    const token = await encode({
      token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
      secret,
    });
    const response = await fetch(`${BASE}/api/cash-flow-forecast?days=30&tz=0`, {
      headers: { cookie: `next-auth.session-token=${token}` },
    });
    if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`);
    const forecast = (await response.json()) as ForecastResponse;
    if (!forecast.configured) throw new Error("Forecast reported itself unconfigured");

    // Cash really left: 100,000 opening, less the 1,000 groceries, less the 5,000 card payment
    // already made. The 20,000 card purchase has NOT left the bank yet.
    const expectedToday = 100_000 - 1_000 - 5_000;
    check(
      "tracked balance is cash-like: the card purchase has not left the bank",
      near(forecast.trackedBalanceToday ?? 0, expectedToday),
      `expected ${money(expectedToday)}, got ${money(forecast.trackedBalanceToday ?? 0)}`
    );

    const cardEvents = (forecast.daily ?? []).flatMap((day) => day.events.filter((event) => event.kind === "card-payment"));
    check(
      "the card's remaining 15,000 is projected as one payment",
      cardEvents.length === 1 && near(cardEvents[0].amount, 15_000),
      `events: ${JSON.stringify(cardEvents)}`
    );

    // The account ends holding cash minus what is still owed on the card. If the purchase were
    // counted twice this lands 15,000 lower.
    const expectedEnd = expectedToday - 15_000;
    const end = forecast.daily?.at(-1)?.projectedBalance ?? 0;
    check(
      "card spending is subtracted exactly once across the horizon",
      near(end, expectedEnd),
      `expected ${money(expectedEnd)}, got ${money(end)}`
    );

    check(
      "the projected floor never dips below the cash really left",
      near(forecast.lowestBalance?.balance ?? 0, expectedEnd),
      `floor ${money(forecast.lowestBalance?.balance ?? 0)} vs ${money(expectedEnd)}`
    );

    // The identity `.claude/rules/cards.md` states, checked against the route's own figures rather
    // than restated: tracked cash, less what the cards still owe, is what the account ends with.
    check(
      "cash = tracked - owed on cards holds on the route's own numbers",
      near((forecast.trackedBalanceToday ?? 0) - 15_000, end)
    );

    check(
      "it says a bill written for a card payment is counted separately",
      (forecast.assumptions ?? []).some((line) => line.includes("counted twice here"))
    );
  } finally {
    // Ordered by dependency: payments and transactions reference the card, which references the user.
    await prisma.creditPayment.deleteMany({ where: { userId: user.id } });
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.creditAccount.deleteMany({ where: { userId: user.id } });
    await prisma.category.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

/**
 * Three ways the forecast's reads lost or duplicated a payment, each a `where` clause no unit test
 * sees (Codex, on #373):
 *
 *   - A payment made before the due date was subtracted from cash today and then taken again on
 *     the due date, because nothing credited it against that cycle.
 *   - An **archived** card that still owes was left out of the forecast while its purchases were
 *     still dropped from cash, so its balance was never paid back at all.
 *   - A **future-dated** payment lowered what the card owes today, though the money had not left
 *     the bank and no event carried it.
 *
 * Numbers, on a 60-day horizon: 50,000 opening cash. Card A bought 10,000, paid 4,000 two days ago
 * toward a due date three days out, and has 3,000 dated ten days ahead; planned 4,000. Archived
 * card B bought 3,000, due in five days, planned 3,000. Cash today is 46,000. A's next due date is
 * already paid, so A pays 4,000 once, a month later, against a balance of 6,000 (not 3,000: the
 * future payment has not happened). B pays 3,000. The account ends at 39,000.
 */
async function cycleAndArchivedScenario(secret: string) {
  const user = await prisma.user.create({
    data: {
      email: `fcp2-${Date.now()}@test.local`, name: "Forecast Cards 2", password: "x", role: "ADMIN",
      timezoneOffset: 0, forecastOpeningBalance: 50_000, forecastOpeningBalanceDate: at(dayFromToday(-30)),
    },
  });

  try {
    const category = await prisma.category.create({
      data: { name: `FCP2 Spend ${Date.now()}`, type: "EXPENSE", icon: "ShoppingBag", color: "#E07C4F", userId: user.id },
    });
    const cardA = await prisma.creditAccount.create({
      data: {
        name: "FCP2 Card A", userId: user.id, openingBalance: 0, openingBalanceDate: at(dayFromToday(-30)),
        dueDay: Number(dayFromToday(3).slice(8, 10)), plannedPayment: 4_000,
      },
    });
    const cardB = await prisma.creditAccount.create({
      data: {
        name: "FCP2 Card B", userId: user.id, openingBalance: 0, openingBalanceDate: at(dayFromToday(-30)),
        dueDay: Number(dayFromToday(5).slice(8, 10)), plannedPayment: 3_000, isActive: false,
      },
    });
    const purchase = (accountId: string, amount: number, day: number) =>
      prisma.transaction.create({
        data: {
          amount, type: "EXPENSE", description: "FCP2 purchase", date: at(dayFromToday(day)),
          categoryId: category.id, userId: user.id, creditAccountId: accountId,
        },
      });
    await purchase(cardA.id, 10_000, -10);
    await purchase(cardB.id, 3_000, -12);
    await prisma.creditPayment.createMany({
      data: [
        { amount: 4_000, kind: "PAYMENT", description: "FCP2 early", date: at(dayFromToday(-2)), accountId: cardA.id, userId: user.id },
        { amount: 3_000, kind: "PAYMENT", description: "FCP2 future", date: at(dayFromToday(10)), accountId: cardA.id, userId: user.id },
      ],
    });

    const token = await encode({
      token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
      secret,
    });
    const response = await fetch(`${BASE}/api/cash-flow-forecast?days=60&tz=0`, {
      headers: { cookie: `next-auth.session-token=${token}` },
    });
    if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`);
    const forecast = (await response.json()) as ForecastResponse;

    const eventsFor = (id: string) =>
      (forecast.daily ?? []).flatMap((day) =>
        day.events.filter((event) => event.kind === "card-payment" && (event as { sourceId?: string }).sourceId === id)
      );

    check("[cycle] cash today counts the early payment once", near(forecast.trackedBalanceToday ?? 0, 46_000),
      `got ${money(forecast.trackedBalanceToday ?? 0)}`);
    const aAmounts = eventsFor(cardA.id).map((event) => event.amount);
    // Checked by date, not by count. A count of one also comes out of the *broken* route whenever
    // another bug has already shrunk the balance -- measured: with the future-payment bug present
    // too, the broken route made one payment, on the wrong date, and a count check passed it.
    const firstDue = dayFromToday(3);
    const aDates = eventsFor(cardA.id).map((event) => (event as { date?: string }).date);
    check("[cycle] an already-paid due date is not paid again", !aDates.includes(firstDue) && aDates.length === 1,
      `card A paid on ${JSON.stringify(aDates)}; ${firstDue} was already paid`);
    check("[cycle] a future-dated payment does not shrink today's balance", near(aAmounts[0] ?? 0, 4_000),
      `card A paid ${aAmounts[0]} (3,000 means the future payment was counted as made)`);
    check("[cycle] an archived card that still owes is paid off", near(eventsFor(cardB.id)[0]?.amount ?? 0, 3_000),
      `card B events: ${JSON.stringify(eventsFor(cardB.id).map((event) => event.amount))}`);
    const end = forecast.daily?.at(-1)?.projectedBalance ?? 0;
    check("[cycle] the account ends where the real payments leave it", near(end, 39_000),
      `expected 39,000.00, got ${money(end)}`);
  } finally {
    await prisma.creditPayment.deleteMany({ where: { userId: user.id } });
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.creditAccount.deleteMany({ where: { userId: user.id } });
    await prisma.category.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

/**
 * The opening balance is **what the bank held**, and a card debt older than it is paid exactly once.
 *
 * A reviewer proposed adding the card debt that existed on the opening date back into cash, which
 * is right only if the opening figure had that debt already taken off. It is decided otherwise: the
 * form asks for the bank balance, the number a banking app shows, and a purchase made before the
 * opening date has not left the bank until the card is paid. This pins that decision, so the
 * proposed change fails here instead of shipping: it would end this account at 50,000, not 40,000.
 */
async function preOpeningDebtScenario(secret: string) {
  const user = await prisma.user.create({
    data: {
      email: `fcp3-${Date.now()}@test.local`, name: "Forecast Cards 3", password: "x", role: "ADMIN",
      timezoneOffset: 0, forecastOpeningBalance: 50_000, forecastOpeningBalanceDate: at(dayFromToday(-30)),
    },
  });

  try {
    const category = await prisma.category.create({
      data: { name: `FCP3 Spend ${Date.now()}`, type: "EXPENSE", icon: "ShoppingBag", color: "#E07C4F", userId: user.id },
    });
    const card = await prisma.creditAccount.create({
      data: {
        name: "FCP3 Card", userId: user.id, openingBalance: 0, openingBalanceDate: at(dayFromToday(-90)),
        dueDay: Number(dayFromToday(3).slice(8, 10)), plannedPayment: 10_000,
      },
    });
    // Bought forty days ago: ten days *before* the opening balance was taken, never paid since.
    await prisma.transaction.create({
      data: {
        amount: 10_000, type: "EXPENSE", description: "FCP3 old purchase", date: at(dayFromToday(-40)),
        categoryId: category.id, userId: user.id, creditAccountId: card.id,
      },
    });

    const token = await encode({
      token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
      secret,
    });
    const response = await fetch(`${BASE}/api/cash-flow-forecast?days=30&tz=0`, {
      headers: { cookie: `next-auth.session-token=${token}` },
    });
    if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`);
    const forecast = (await response.json()) as ForecastResponse;

    check("[opening] cash today is the bank balance entered", near(forecast.trackedBalanceToday ?? 0, 50_000),
      `got ${money(forecast.trackedBalanceToday ?? 0)}`);
    const end = forecast.daily?.at(-1)?.projectedBalance ?? 0;
    check("[opening] a card debt older than the opening balance is paid once", near(end, 40_000),
      `expected 40,000.00, got ${money(end)}`);
  } finally {
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.creditAccount.deleteMany({ where: { userId: user.id } });
    await prisma.category.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

/**
 * A card the forecast cannot schedule keeps its debt in the forecast (Codex, on #373).
 *
 * The cash rebase drops a card's purchases from cash on the understanding that its payment events
 * pay them back. A card with no due day, or with a due day but no plan, history or minimum -- the
 * state every new card starts in -- gets no events, so its debt used to vanish and the forecast
 * ended too high by exactly its balance. Such a card now stays on the old footing: its purchases
 * count against cash on the day they were made.
 *
 * 50,000 opening cash. Card U (no due day) bought 7,000; card N (due day, no terms) bought 5,000.
 * Neither is scheduled, so both purchases come off cash now: 38,000, and it stays there.
 */
async function unscheduledScenario(secret: string) {
  const user = await prisma.user.create({
    data: {
      email: `fcp4-${Date.now()}@test.local`, name: "Forecast Cards 4", password: "x", role: "ADMIN",
      timezoneOffset: 0, forecastOpeningBalance: 50_000, forecastOpeningBalanceDate: at(dayFromToday(-30)),
    },
  });

  try {
    const category = await prisma.category.create({
      data: { name: `FCP4 Spend ${Date.now()}`, type: "EXPENSE", icon: "ShoppingBag", color: "#E07C4F", userId: user.id },
    });
    const undated = await prisma.creditAccount.create({
      data: { name: "FCP4 Undated", userId: user.id, openingBalance: 0, openingBalanceDate: at(dayFromToday(-60)) },
    });
    const noTerms = await prisma.creditAccount.create({
      data: {
        name: "FCP4 No Terms", userId: user.id, openingBalance: 0, openingBalanceDate: at(dayFromToday(-60)),
        dueDay: Number(dayFromToday(3).slice(8, 10)),
      },
    });
    for (const [accountId, amount] of [[undated.id, 7_000], [noTerms.id, 5_000]] as const) {
      await prisma.transaction.create({
        data: {
          amount, type: "EXPENSE", description: "FCP4 purchase", date: at(dayFromToday(-10)),
          categoryId: category.id, userId: user.id, creditAccountId: accountId,
        },
      });
    }

    const token = await encode({
      token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
      secret,
    });
    const response = await fetch(`${BASE}/api/cash-flow-forecast?days=30&tz=0`, {
      headers: { cookie: `next-auth.session-token=${token}` },
    });
    if (!response.ok) throw new Error(`Forecast request failed: ${response.status}`);
    const forecast = (await response.json()) as ForecastResponse;

    const end = forecast.daily?.at(-1)?.projectedBalance ?? 0;
    check("[unscheduled] unscheduled cards' spending still leaves the forecast", near(end, 38_000),
      `expected 38,000.00, got ${money(end)} (50,000 means both debts vanished)`);
    const cardEvents = (forecast.daily ?? []).flatMap((day) => day.events.filter((event) => event.kind === "card-payment"));
    check("[unscheduled] and no payment is invented for them", cardEvents.length === 0,
      `events: ${JSON.stringify(cardEvents.map((event) => event.amount))}`);
    const said = (forecast.assumptions ?? []).join(" ");
    check("[unscheduled] both cards are named, with what happened to their spending",
      said.includes("FCP4 Undated") && said.includes("FCP4 No Terms") && said.includes("on the day they were made"));
  } finally {
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.creditAccount.deleteMany({ where: { userId: user.id } });
    await prisma.category.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
