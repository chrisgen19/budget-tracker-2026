import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

/**
 * Drives the analytics drill-down end to end, which is the half of this feature no
 * unit test can reach: the URL is written by one effect and read by another, and
 * whether those two settle is a runtime property.
 *
 * Signs in by minting a session JWT with the app's own `NEXTAUTH_SECRET` rather
 * than typing a password, the standard NextAuth e2e approach — the session
 * strategy is `jwt`, so a cookie is the whole of the session. Every assertion here
 * is a read; nothing in this file writes to the database.
 */
const prisma = new PrismaClient();

test.afterAll(() => prisma.$disconnect());

/**
 * The account with data in it — a drill-down needs rows behind the number, so an
 * empty database cannot exercise this at all.
 */
const findSeededUser = async () => {
  const [user] = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, _count: { select: { transactions: true } } },
    orderBy: { transactions: { _count: "desc" } },
    take: 1,
  });
  return user && user._count.transactions > 0 ? user : null;
};

const signIn = async (page: Page, user: NonNullable<Awaited<ReturnType<typeof findSeededUser>>>) => {
  const secret = process.env.NEXTAUTH_SECRET!;
  const token = await encode({
    token: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      sub: user.id,
    },
    secret,
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

/** The URL must come to rest: two reads either side of a pause must agree. */
const expectUrlSettles = async (page: Page) => {
  const first = page.url();
  await page.waitForTimeout(700);
  expect(page.url(), "the address bar is still being rewritten").toBe(first);
  return first;
};

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3111";

const queryOf = (url: string) => new URL(url).searchParams;

/** The sidebar also has an "Analytics" link, so the bar is found inside the toolbar
 *  it lives in — which doubles as the assertion that it lives there. */
const returnBar = (page: Page) =>
  page
    .getByRole("region", { name: "Transaction filters" })
    .getByRole("link", { name: /^Analytics/ });

/** The heatmap card. Not located by its footer text, which changes on the first tap. */
const heatmapCard = (page: Page) =>
  page
    .locator("div.card")
    .filter({ has: page.getByRole("heading", { name: "Spending Heatmap" }) });

test.describe("analytics drill-down", () => {
  // Needs the app's own signing secret and a database with spending in it. Skipped
  // rather than failed where either is absent, the way the Telegram spec skips
  // without an allowlisted id.
  test.skip(!process.env.NEXTAUTH_SECRET, "Set NEXTAUTH_SECRET (the dev server's own)");

  test.beforeEach(async ({ page }) => {
    const user = await findSeededUser();
    test.skip(!user, "The local database has no account with transactions to drill into");
    await signIn(page, user!);
  });

  test("the analytics URL settles and carries the view", async ({ page }) => {
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "By Category" })).toBeVisible({
      timeout: 60_000,
    });

    const settled = await expectUrlSettles(page);
    const params = queryOf(settled);
    expect(params.get("period")).toBe("monthly");
    expect(params.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Phase 1 of #277: the Breakdowns card opens on Expenses.
    expect(params.get("type")).toBe("EXPENSE");
    expect(params.get("tab")).toBe("reports");
  });

  test("a category row lands on its own rows, and the way back returns the period", async ({ page }) => {
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "By Category" })).toBeVisible({
      timeout: 60_000,
    });
    const analyticsUrl = await expectUrlSettles(page);
    const analyticsPeriod = queryOf(analyticsUrl);

    const row = page.getByRole("link", { name: /^View \d+ transactions? for / }).first();
    const rowLabel = await row.getAttribute("aria-label");
    await row.click();

    await page.waitForURL(/\/transactions\?/);
    const drilled = queryOf(await expectUrlSettles(page));
    expect(drilled.get("categoryId"), "the category id, not the composite breakdown key")
      .toMatch(/^[a-z0-9]+$/);
    expect(drilled.get("period")).toBe("custom");
    expect(drilled.get("from")).toBe(analyticsPeriod.get("from"));
    expect(drilled.get("to")).toBe(analyticsPeriod.get("to"));
    expect(drilled.get("ret"), "the way back travels with the link").toBeTruthy();

    // Found inside the sticky toolbar, which is what makes it reachable from the
    // bottom of a long list.
    const back = returnBar(page);
    await expect(back).toBeVisible();

    // The count in the row's label is the number of rows the list should show.
    const promised = Number(rowLabel?.match(/View (\d+)/)?.[1]);
    await expect(page.getByText(`${promised} transaction`, { exact: false }).first()).toBeVisible();

    await back.click();
    await page.waitForURL(/\/analytics\?/);
    const returned = queryOf(await expectUrlSettles(page));
    expect(returned.get("from")).toBe(analyticsPeriod.get("from"));
    expect(returned.get("to")).toBe(analyticsPeriod.get("to"));
    expect(returned.get("period")).toBe(analyticsPeriod.get("period"));
  });

  test("the way back survives a filter edit, which rewrites the URL", async ({ page }) => {
    // The ledger mirrors its filters to the address bar on every change, and that
    // serializer writes a fixed set. A return param outside it would vanish here.
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "By Category" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("link", { name: /^View \d+ transactions? for / }).first().click();
    await page.waitForURL(/\/transactions\?/);
    await expect(returnBar(page)).toBeVisible();

    const beforeRet = queryOf(page.url()).get("ret");
    await page.getByRole("button", { name: "Income" }).filter({ visible: true }).first().click();
    await page.waitForTimeout(700);

    expect(queryOf(page.url()).get("ret"), "the mirror write dropped the way back").toBe(beforeRet);
    await expect(returnBar(page)).toBeVisible();
  });

  test("a heatmap day filters one day but returns to the whole period", async ({ page }) => {
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Spending Heatmap" })).toBeVisible({
      timeout: 60_000,
    });
    const analyticsPeriod = queryOf(await expectUrlSettles(page));

    // Tap days until one has spending behind it; an empty day offers no link.
    const card = heatmapCard(page);
    const cells = card.getByRole("button", { name: /^[A-Z][a-z]{2} \d+/ });
    const total = await cells.count();
    expect(total, "no day cells found in the heatmap").toBeGreaterThan(0);

    const dayLink = card.getByRole("link", { name: /^View \d+ transactions? for / });
    let found = false;
    for (let i = 0; i < total; i += 1) {
      await cells.nth(i).click();
      if (await dayLink.count()) {
        found = true;
        break;
      }
    }
    expect(found, "no day in this period had spending to drill into").toBe(true);

    await dayLink.first().click();
    await page.waitForURL(/\/transactions\?/);
    const drilled = queryOf(await expectUrlSettles(page));
    // One day on the ledger, against an analytics period spanning a whole month —
    // which is what makes the two windows distinguishable at all. The day may well
    // be the first of the period, so it is the *width* that matters, not the start.
    expect(drilled.get("from"), "a single day").toBe(drilled.get("to"));
    expect(analyticsPeriod.get("from")).not.toBe(analyticsPeriod.get("to"));

    // The bar must go to the analytics period, not to that one day.
    const back = returnBar(page);
    await expect(back).toBeVisible();
    const backHref = new URL(await back.getAttribute("href") ?? "", page.url()).searchParams;
    expect(backHref.get("from")).toBe(analyticsPeriod.get("from"));
    expect(backHref.get("to")).toBe(analyticsPeriod.get("to"));
    expect(backHref.get("to"), "the bar would be returning to the filtered day")
      .not.toBe(drilled.get("to"));

    await back.click();
    await page.waitForURL(/\/analytics\?/);
    const returned = queryOf(await expectUrlSettles(page));
    expect(returned.get("from")).toBe(analyticsPeriod.get("from"));
    expect(returned.get("to")).toBe(analyticsPeriod.get("to"));
  });

  test("the nav item resets the view rather than leaving the URL lying", async ({ page }) => {
    await page.goto("/analytics?period=custom&from=2026-07-01&to=2026-09-30&type=ALL&tab=reports", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "By Category" })).toBeVisible({
      timeout: 60_000,
    });
    expect(queryOf(await expectUrlSettles(page)).get("from")).toBe("2026-07-01");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole("link", { name: "Analytics", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForTimeout(900);

    const after = queryOf(await expectUrlSettles(page));
    expect(after.get("period"), "a bare nav click should give a fresh view").toBe("monthly");
    expect(after.get("from")).not.toBe("2026-07-01");
    expect(after.get("type")).toBe("EXPENSE");
  });
});
