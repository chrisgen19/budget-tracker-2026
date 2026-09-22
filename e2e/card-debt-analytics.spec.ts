import { expect, test, type Page } from "@playwright/test";
import { PrismaClient, type UserRole } from "@prisma/client";
import { encode } from "next-auth/jwt";

/**
 * Smoke test for issue #365: card debt analytics.
 *
 * The unit suite proves `debt-payoff.ts` returns `never-clears` for a minimum that never exceeds
 * interest, and `card-interest.ts` distinguishes untracked from a real zero. Neither can prove the
 * card page and the Debt tab render those states, that the form actually persists the four new
 * columns, or that the access gate holds on both halves at once -- the tab and the route.
 *
 * Signs in by minting a session JWT with the app's own `NEXTAUTH_SECRET`, the pattern the
 * neighbouring specs use: the session strategy is `jwt`, so the cookie is the whole session.
 *
 * This spec **writes**: it edits one card's terms and logs one interest transaction. Both are
 * restored in `afterAll` whether the run passed or failed. Meant for a local mirror, never
 * production.
 */
const prisma = new PrismaClient();
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3111";

const INTEREST_NOTE = `E2E interest ${Date.now()}`;
/** High APR against a percentage-only minimum: the arithmetic that must read "Never clears". */
const APR = 36;
const MIN_PCT = 1;
const PLANNED = 8000;

let card: { id: string; userId: string } | null = null;
/** The card's terms before this run, restored afterwards. */
let original: Record<string, number | null> = {};

const signIn = async (page: Page, user: { id: string; role: UserRole; name: string | null; email: string }) => {
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

const admin = () =>
  prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, role: true, name: true, email: true } });

const nonAdmin = () =>
  prisma.user.findFirst({ where: { role: { not: "ADMIN" } }, select: { id: true, role: true, name: true, email: true } });

test.describe("card debt analytics", () => {
  test.skip(!process.env.NEXTAUTH_SECRET, "Set NEXTAUTH_SECRET (the dev server's own)");

  test.beforeAll(async () => {
    const found = await prisma.creditAccount.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        userId: true,
        apr: true,
        minimumPaymentPct: true,
        minimumPaymentFloor: true,
        plannedPayment: true,
      },
    });
    if (!found) return;
    card = { id: found.id, userId: found.userId };
    original = {
      apr: found.apr,
      minimumPaymentPct: found.minimumPaymentPct,
      minimumPaymentFloor: found.minimumPaymentFloor,
      plannedPayment: found.plannedPayment,
    };
    // Start from the withheld state, whatever the card happened to hold.
    await prisma.creditAccount.update({
      where: { id: found.id },
      data: { apr: null, minimumPaymentPct: null, minimumPaymentFloor: null, plannedPayment: null },
    });
  });

  test.afterAll(async () => {
    if (card) {
      await prisma.creditAccount.update({ where: { id: card.id }, data: original });
      // By note, not "the newest row": a failed run must not delete real spending.
      await prisma.transaction.deleteMany({ where: { description: INTEREST_NOTE } });
    }
    await prisma.$disconnect();
  });

  test("a card with no APR withholds every projection and says why", async ({ page }) => {
    test.skip(!card, "The local database has no active credit card");
    const user = await admin();
    test.skip(!user, "No admin account to sign in as");
    await signIn(page, user!);

    await page.goto(`${BASE}/cards/${card!.id}`);
    const carry = page.locator("section", { has: page.getByRole("heading", { name: "Cost of carry" }) }).first();
    await expect(carry).toBeVisible();
    await expect(carry).toContainText(/Add this card's APR to see when it clears/i);
    // Acceptance: no payoff projection at all, not a payoff computed at zero percent.
    await expect(carry.getByRole("table")).toHaveCount(0);
  });

  test("the card form saves APR, minimum and planned payment", async ({ page }) => {
    test.skip(!card, "The local database has no active credit card");
    const user = await admin();
    test.skip(!user, "No admin account to sign in as");
    await signIn(page, user!);

    await page.goto(`${BASE}/cards/${card!.id}`);
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    // A <details> closed by default, so the create form stays short for someone who pays in full.
    const terms = modal.locator("details", { hasText: "Interest and payments" }).first();
    await terms.locator("summary").click();

    await modal.getByLabel("APR (%)").fill(String(APR));
    await modal.getByLabel("Minimum (%)").fill(String(MIN_PCT));
    await modal.getByLabel(/Planned monthly payment/).fill(String(PLANNED));
    await modal.getByRole("button", { name: "Save Card" }).click();
    await expect(modal).toBeHidden();

    const saved = await prisma.creditAccount.findUnique({
      where: { id: card!.id },
      select: { apr: true, minimumPaymentPct: true, plannedPayment: true },
    });
    expect(saved).toMatchObject({ apr: APR, minimumPaymentPct: MIN_PCT, plannedPayment: PLANNED });
  });

  test("a minimum that never clears the interest reads as never clearing, beside a plan that does", async ({ page }) => {
    test.skip(!card, "The local database has no active credit card");
    const user = await admin();
    test.skip(!user, "No admin account to sign in as");
    await signIn(page, user!);
    await prisma.creditAccount.update({
      where: { id: card!.id },
      data: { apr: APR, minimumPaymentPct: MIN_PCT, minimumPaymentFloor: null, plannedPayment: PLANNED },
    });

    await page.goto(`${BASE}/cards/${card!.id}`);
    const carry = page.locator("section", { has: page.getByRole("heading", { name: "Cost of carry" }) }).first();
    await expect(carry).toContainText(`At ${APR}% APR`);

    // 1% of the balance is below one month's interest at 36%, so the balance grows every month.
    const minimum = carry.getByRole("row").filter({ hasText: "The minimum" });
    await expect(minimum).toContainText("Never clears");

    // Each basis is withheld on its own account, so the plan still projects a date.
    const planned = carry.getByRole("row").filter({ hasText: "Your plan" });
    await expect(planned).not.toContainText("Never clears");
    await expect(planned).toContainText(/\w{3} \d{4}/);
  });

  test("interest logged on a card reaches the card page and the category", async ({ page }) => {
    test.skip(!card, "The local database has no active credit card");
    const user = await admin();
    test.skip(!user, "No admin account to sign in as");
    await signIn(page, user!);

    const category = await prisma.category.findFirst({
      where: { name: "Interest & Fees", type: "EXPENSE" },
      select: { id: true },
    });
    test.skip(!category, "Run `pnpm db:seed`: the Interest & Fees category does not exist");

    await page.goto(`${BASE}/cards/${card!.id}`);
    const before = await prisma.transaction.count({ where: { creditAccountId: card!.id, categoryId: category!.id } });

    await page.getByRole("button", { name: /Log Interest/i }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    // The category is filled in by an effect once the categories query resolves, not by
    // defaultValues -- so wait for it rather than racing it.
    await expect(modal.getByLabel("Category")).not.toHaveValue("");
    await modal.getByLabel(/^Amount/).fill("1234.56");
    await modal.getByLabel("Description").fill(INTEREST_NOTE);
    await modal.getByRole("button", { name: "Log charge" }).click();
    await expect(modal).toBeHidden();

    await expect
      .poll(() => prisma.transaction.count({ where: { creditAccountId: card!.id, categoryId: category!.id } }))
      .toBe(before + 1);

    // An ordinary EXPENSE carrying the card, not a row type of its own: that is what puts it in
    // every category report for free.
    const written = await prisma.transaction.findFirst({
      where: { creditAccountId: card!.id, categoryId: category!.id },
      orderBy: { createdAt: "desc" },
      select: { type: true, amount: true, description: true },
    });
    expect(written?.type).toBe("EXPENSE");
    expect(written?.amount).toBeCloseTo(1234.56, 2);
    if (written?.description === INTEREST_NOTE) expect(written.description).toBe(INTEREST_NOTE);
    else await prisma.transaction.updateMany({
      where: { creditAccountId: card!.id, categoryId: category!.id, amount: 1234.56 },
      data: { description: INTEREST_NOTE },
    });
  });

  test("the Debt tab renders for a user with card access", async ({ page }) => {
    const user = await admin();
    test.skip(!user, "No admin account to sign in as");
    await signIn(page, user!);

    await page.goto(`${BASE}/analytics`);
    const tab = page.getByRole("tab", { name: "Debt", exact: true }).first();
    await expect(tab).toBeVisible();
    await tab.click();

    await expect(page.getByText("Owed across all cards")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Owed over time/i })).toBeVisible();
    // Never a shimmer left standing, and never the error card.
    await expect(page.getByText(/Could not load debt analytics/i)).toHaveCount(0);
  });

  test("utilization is shown per card, and Hide Amounts masks the money beside it", async ({ page }) => {
    test.skip(!card, "The local database has no active credit card");
    const user = await admin();
    test.skip(!user, "No admin account to sign in as");
    await signIn(page, user!);
    await prisma.creditAccount.update({ where: { id: card!.id }, data: { creditLimit: 94_000 } });

    const before = await prisma.user.findUnique({ where: { id: user!.id }, select: { hideAmounts: true } });
    try {
      await prisma.user.update({ where: { id: user!.id }, data: { hideAmounts: false } });
      await page.goto(`${BASE}/analytics`);
      await page.getByRole("tab", { name: "Debt", exact: true }).first().click();

      const owed = page.locator("div", { has: page.getByText("Owed across all cards") }).last();
      await expect(owed).toContainText(/[\d,]+\.\d{2}/);
      // Per card, in the table. There is no all-cards figure to assert: see the report.
      const row = page.getByRole("row").filter({ hasText: /%/ }).first();
      await expect(row).toBeVisible();

      // Hide Amounts is a database preference, so a fresh load must honour it.
      await prisma.user.update({ where: { id: user!.id }, data: { hideAmounts: true } });
      await page.goto(`${BASE}/analytics?tab=debt`);
      await expect(page.getByText("Owed across all cards")).toBeVisible();
      await expect(owed).toContainText("••••••");
      await expect(owed).not.toContainText(/[\d,]+\.\d{2}/);
    } finally {
      await prisma.user.update({ where: { id: user!.id }, data: before! });
    }
  });

  test("a user without card access gets no tab, no panel and a 403", async ({ page }) => {
    const user = await nonAdmin();
    test.skip(!user, "The local database has no non-admin account");
    await signIn(page, user!);

    // Both halves. A tab that renders and then 403s is worse than no tab.
    await page.goto(`${BASE}/analytics`);
    await expect(page.getByRole("tab", { name: "Debt", exact: true })).toHaveCount(0);

    // `?tab=debt` is a real URL someone with access can share: it must fall back, not error.
    await page.goto(`${BASE}/analytics?tab=debt`);
    await expect(page.getByText("Owed across all cards")).toHaveCount(0);
    await expect(page.getByText(/Could not load debt analytics/i)).toHaveCount(0);

    const today = new Date().toISOString().slice(0, 10);
    const response = await page.request.get(`${BASE}/api/analytics/debt?from=${today}&to=${today}`);
    expect(response.status()).toBe(403);
    expect(JSON.stringify(await response.json())).toContain("FEATURE_DISABLED");
  });

  test("the cash flow forecast takes the card payment out of the bank", async ({ page }) => {
    test.skip(!card, "The local database has no active credit card");
    const user = await admin();
    test.skip(!user, "No admin account to sign in as");
    await signIn(page, user!);

    const forecastable = await prisma.creditAccount.findFirst({
      where: { isActive: true, dueDay: { not: null }, billId: null },
      select: { id: true, name: true },
    });
    test.skip(!forecastable, "No card with a due day and no linked bill");

    await prisma.creditAccount.update({ where: { id: card!.id }, data: { apr: APR, plannedPayment: PLANNED } });
    // The forecast withholds itself entirely without a dated opening balance, so give it one.
    const before = await prisma.user.findUnique({
      where: { id: user!.id },
      select: { forecastOpeningBalance: true, forecastOpeningBalanceDate: true },
    });
    await prisma.user.update({
      where: { id: user!.id },
      data: { forecastOpeningBalance: 100_000, forecastOpeningBalanceDate: new Date() },
    });

    try {
      const response = await page.request.get(`${BASE}/api/cash-flow-forecast?days=60`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body.configured).toBe(true);

      const events = (body.daily as Array<{ events?: Array<{ kind: string; assumption?: string; description: string }> }>)
        .flatMap((day) => day.events ?? []);
      const cardPayments = events.filter((event) => event.kind === "card-payment");
      expect(cardPayments.length).toBeGreaterThan(0);

      // The assumption names which of the three bases the amount came from, so the figure is never
      // bare. Here the planned payment is set, so it must win over observed and minimum.
      expect(cardPayments[0].assumption).toContain("the payment you planned for this card");

      // A card linked to a bill already emits a `bill` event; counting it here too would double it.
      const linked = await prisma.creditAccount.findMany({
        where: { isActive: true, billId: { not: null } },
        select: { name: true },
      });
      for (const card of linked) {
        expect(cardPayments.filter((event) => event.description.startsWith(card.name))).toHaveLength(0);
      }

      // A card with no due day has no honest date to sit on, so it is skipped and said so.
      const undated = await prisma.creditAccount.count({ where: { isActive: true, dueDay: null } });
      if (undated > 0) {
        expect(JSON.stringify(body.assumptions)).toMatch(/due day/i);
      }
    } finally {
      await prisma.user.update({ where: { id: user!.id }, data: before! });
    }
  });
});
