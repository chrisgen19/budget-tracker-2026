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
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session cookie");

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
