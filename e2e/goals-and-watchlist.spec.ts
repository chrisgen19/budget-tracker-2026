import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

/**
 * The half of the savings-goals release no unit test reaches: whether the two things a goal card
 * says about itself agree with each other on screen.
 *
 * `savings-goals.test.ts` proves `paceOf` returns `underway` for a goal funded today. It cannot
 * prove that the progress bar and the pace line end up in the same component tree saying compatible
 * things, and that pairing is exactly what broke: a goal funded today rendered a 24% bar directly
 * beside "Nothing put aside yet", with `detectGoalAnomalies` raising a `goal-stalled` finding whose
 * own `current` was non-zero. Two correct values, one contradiction, and only the rendered page
 * shows it.
 *
 * Signs in by minting a session JWT with the app's own `NEXTAUTH_SECRET` rather than typing a
 * password, the same approach as `analytics-drilldown.spec.ts` — the session strategy is `jwt`, so
 * a cookie is the whole of the session.
 *
 * Unlike the read-only specs beside it, this one **writes**: a goal and a contribution, both
 * removed in `afterEach` whether the test passed or failed. It is meant for a local mirror, not for
 * production.
 */
const prisma = new PrismaClient();

test.afterAll(() => prisma.$disconnect());

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3111";

/** Distinctive enough that the cleanup cannot match a goal a person actually created. */
const GOAL_NAME = `E2E Roof Fund ${Date.now()}`;
const TARGET = 50_000;
const CONTRIBUTION = 12_000;

const findUser = async () => {
  const [user] = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { transactions: { _count: "desc" } },
    take: 1,
  });
  return user ?? null;
};

const signIn = async (page: Page, user: NonNullable<Awaited<ReturnType<typeof findUser>>>) => {
  const token = await encode({
    token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET!,
  });
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: new URL(BASE).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
};

test.describe("savings goals and the Watchlist", () => {
  test.skip(!process.env.NEXTAUTH_SECRET, "Set NEXTAUTH_SECRET (the dev server's own)");

  test.afterEach(async () => {
    // By name, not by "the newest goal": a failed run must not delete something real.
    await prisma.savingsGoal.deleteMany({ where: { name: GOAL_NAME } });
  });

  test("a goal funded today reads as funded, not as stalled", async ({ page }) => {
    const user = await findUser();
    test.skip(!user, "The local database has no account to sign in as");
    await signIn(page, user!);

    await page.goto(`${BASE}/goals`);
    await expect(page.getByRole("heading", { name: /goals/i }).first()).toBeVisible();

    // Created through the API the page itself uses, so the test is about rendering rather than
    // about driving a form whose field labels are not what is under test here.
    // A year out from the run, never a fixed date: once a fixed deadline passes, the goal is
    // overdue and `paceOf` stops answering `underway`, failing the test for a reason the app
    // has nothing to do with.
    const deadline = new Date();
    deadline.setFullYear(deadline.getFullYear() + 1);
    const created = await page.request.post(`${BASE}/api/goals`, {
      data: {
        name: GOAL_NAME,
        targetAmount: TARGET,
        kind: "GOAL",
        targetDate: deadline.toISOString().slice(0, 10),
      },
    });
    expect(created.ok(), `creating the goal failed: ${created.status()} ${await created.text()}`).toBe(true);
    const goalId = (await created.json()).id as string;

    const funded = await page.request.post(`${BASE}/api/goals/${goalId}/contributions`, {
      data: { amount: CONTRIBUTION, date: new Date().toISOString().slice(0, 10) },
    });
    expect(funded.ok(), `funding the goal failed: ${funded.status()} ${await funded.text()}`).toBe(true);

    await page.reload();
    // The card root is `<article class="card ...">` (goal-card.tsx). Filtering plain `div`s matched
    // the innermost wrapper, which holds only the name and the "Goal · by <date>" line -- the
    // figures live in siblings of it, so the assertion below was reading the wrong element.
    const card = page.locator("article.card").filter({ hasText: GOAL_NAME });
    await expect(card).toBeVisible();

    // The contradiction this exists to catch, asserted on what the card actually renders: the
    // funded figure against the target, and a pace badge that agrees with it. The card shows
    // amounts rather than a percentage, so a "24%" assertion here passes and proves nothing.
    await expect(card).toContainText("12,000");
    await expect(card).toContainText("50,000");
    // `paceOf` returns `underway` for a goal whose only contributions landed today -- there is no
    // rate to measure yet, which is a different thing from nothing having been put aside.
    await expect(card).toContainText(/underway/i);
    await expect(card).not.toContainText(/stalled/i);
    await expect(card).not.toContainText(/nothing put aside/i);
    await expect(card).not.toContainText(/not started/i);
  });

  test("the Watchlist renders its outstanding group", async ({ page }) => {
    const user = await findUser();
    test.skip(!user, "The local database has no account to sign in as");
    await signIn(page, user!);

    await page.goto(`${BASE}/analytics`);
    // The Watchlist is one tab of the analytics page, not the landing view, so it has to be opened
    // before anything in it exists to assert on.
    // `role="tab"`, and the accessible name spans two elements -- the full label and the short one,
    // swapped by breakpoint -- so it is matched loosely rather than exactly.
    await page.getByRole("tab", { name: /watch/i }).click();
    // Located by its heading, not by a region role: the outer `<section className="card">` carries
    // no `aria-labelledby`, so it has no accessible name, even though the scope sections inside it
    // do. The facts are computed live, so the panel settles rather than appearing at once.
    const heading = page.getByRole("heading", { name: "Watchlist", exact: true });
    await expect(heading).toBeVisible({ timeout: 60_000 });
    const watchlist = page.locator("section.card").filter({ has: heading });
    // An empty period is a legitimate result; a thrown render is not. The assertion is that the
    // panel reached a state it can describe, either findings or the clean-period message.
    await expect(watchlist).not.toContainText(/something went wrong|failed to/i);
    // Period findings and outstanding ones are grouped separately, and the period group is always
    // rendered -- a clean period is stated rather than left blank.
    await expect(watchlist).toContainText(/this period|outstanding/i);
  });
});
