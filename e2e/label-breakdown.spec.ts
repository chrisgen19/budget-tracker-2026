import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

/**
 * Drives the By Label breakdown against a real database, the half no stubbed unit test reaches:
 * that `/api/analytics` counts a multi-labelled transaction in full under each label, that the card
 * shows those figures, and that a row's drill-down lands on the same rows it summed.
 *
 * Every assertion is a read. Non-GET API calls are aborted, and hide-amounts is lifted by rewriting
 * the one `GET /api/preferences` response in the browser, never by writing the preference.
 */
const prisma = new PrismaClient();

test.afterAll(() => prisma.$disconnect());

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3111";
const FROM = "2026-01-01";
const TO = "2026-12-31";
const SHOT_DIR = process.env.E2E_SHOT_DIR;

interface AnalyticsLabel {
  id: string;
  name: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

const findSeededUser = async () => {
  const [user] = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      currency: true,
      timezoneOffset: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { transactions: { _count: "desc" } },
    take: 1,
  });
  return user && user._count.transactions > 0 ? user : null;
};

type SeededUser = NonNullable<Awaited<ReturnType<typeof findSeededUser>>>;

/** The same window `/api/analytics` resolves: whole local days, shifted by the user's offset. */
const windowFor = (tz: number) => ({
  gte: new Date(Date.parse(`${FROM}T00:00:00.000Z`) + tz * 60_000),
  lte: new Date(Date.parse(`${TO}T23:59:59.999Z`) + tz * 60_000),
});

const signIn = async (page: Page, user: SeededUser) => {
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

/** Read-only guardrail, plus hide-amounts lifted in this browser only. */
const guardAndRevealAmounts = async (page: Page) => {
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? route.fallback() : route.abort()
  );
  await page.route("**/api/preferences", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, hideAmounts: false } });
  });
};

/** The label carried by the most multi-labelled rows in the window, with its full-amount totals. */
const mostOverlappingLabel = async (user: SeededUser) => {
  const rows = await prisma.transaction.findMany({
    where: { userId: user.id, type: "EXPENSE", date: windowFor(user.timezoneOffset) },
    select: { amount: true, labels: { select: { labelId: true, label: { select: { name: true } } } } },
  });
  const overlap = new Map<string, { name: string; shared: number; amount: number; count: number }>();
  for (const row of rows) {
    for (const tl of row.labels) {
      const entry = overlap.get(tl.labelId) ?? { name: tl.label.name, shared: 0, amount: 0, count: 0 };
      entry.amount += row.amount;
      entry.count += 1;
      if (row.labels.length > 1) entry.shared += 1;
      overlap.set(tl.labelId, entry);
    }
  }
  const [best] = [...overlap.entries()].sort((a, b) => b[1].shared - a[1].shared);
  return best && best[1].shared > 0 ? { id: best[0], ...best[1] } : null;
};

const byLabelCard = (page: Page) =>
  page.locator("div.card").filter({ has: page.getByRole("heading", { name: "By Label" }) });

const FOOTNOTE = "A transaction with more than one label counts in full under each";

test.describe("label breakdown counts multi-labelled transactions in full", () => {
  test.skip(!process.env.NEXTAUTH_SECRET, "Set NEXTAUTH_SECRET (the dev server's own)");

  let user: SeededUser | null = null;

  test.beforeEach(async ({ page }) => {
    user = await findSeededUser();
    test.skip(!user, "The local database has no account with transactions");
    await guardAndRevealAmounts(page);
    await signIn(page, user!);
  });

  test("the API gives every label the full amount of its transactions", async ({ page }) => {
    const u = user!;
    const date = windowFor(u.timezoneOffset);
    const res = await page.request.get(
      `/api/analytics?granularity=monthly&from=${FROM}&to=${TO}&tz=${u.timezoneOffset}&type=EXPENSE`
    );
    expect(res.ok()).toBe(true);
    const labels: AnalyticsLabel[] = (await res.json()).labelBreakdown;
    const named = labels.filter((l) => l.id !== "unlabeled");
    expect(named.length, "no labelled spending in the window").toBeGreaterThan(0);

    for (const label of named) {
      const agg = await prisma.transaction.aggregate({
        where: { userId: u.id, type: "EXPENSE", date, labels: { some: { labelId: label.id } } },
        _sum: { amount: true },
        _count: true,
      });
      expect(label.amount, `${label.name} amount`).toBeCloseTo(agg._sum.amount ?? 0, 2);
      expect(label.transactionCount, `${label.name} count`).toBe(agg._count);
    }

    const total = await prisma.transaction.aggregate({
      where: { userId: u.id, type: "EXPENSE", date },
      _sum: { amount: true },
    });
    const listed = labels.reduce((sum, l) => sum + l.amount, 0);
    if (await mostOverlappingLabel(u)) {
      expect(listed, "overlapping labels should add past the period total").toBeGreaterThan(
        (total._sum.amount ?? 0) + 0.005
      );
    }
  });

  test("the card shows the full amount, the note, and a drill-down to the same rows", async ({ page }) => {
    const u = user!;
    const target = await mostOverlappingLabel(u);
    test.skip(!target, "No multi-labelled transactions in the window");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/analytics?period=custom&from=${FROM}&to=${TO}&type=EXPENSE&tab=reports`, {
      waitUntil: "domcontentloaded",
    });
    const card = byLabelCard(page);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText(FOOTNOTE)).toBeVisible();

    const plural = target!.count === 1 ? "transaction" : "transactions";
    const row = card.getByRole("link", { name: `View ${target!.count} ${plural} for ${target!.name}` });
    await expect(row).toBeVisible();
    const money = new Intl.NumberFormat("en", { style: "currency", currency: u.currency }).format(
      target!.amount
    );
    await expect(row).toContainText(money);

    if (SHOT_DIR) await card.screenshot({ path: `${SHOT_DIR}/by-label-desktop.png` });

    await row.click();
    await page.waitForURL(/\/transactions\?/);
    expect(new URL(page.url()).searchParams.get("labelId")).toBe(target!.id);
    await expect(page.getByText(`${target!.count} transaction`, { exact: false }).first()).toBeVisible();
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/drilldown-desktop.png` });
  });

  test("the card fits a phone without scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/analytics?period=custom&from=${FROM}&to=${TO}&type=EXPENSE&tab=reports`, {
      waitUntil: "domcontentloaded",
    });
    const card = byLabelCard(page);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText(FOOTNOTE)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(0);
    // Centred in the viewport, since the bill reminder banner is fixed over the bottom of the screen.
    await card.getByText(FOOTNOTE).evaluate((el) => el.scrollIntoView({ block: "center" }));
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/by-label-mobile.png` });
  });
});
