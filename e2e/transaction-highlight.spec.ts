import { expect, test, type Page } from "@playwright/test";
import { PrismaClient, type UserRole } from "@prisma/client";
import { encode } from "next-auth/jwt";

/**
 * `?highlight=<id>` is how bill history and Telegram link into the ledger. The
 * link has to resolve wherever the row lives: the page opens on all time showing
 * the newest rows, so anything older was never in the set being searched.
 *
 * Signs in the same way as `analytics-drilldown.spec.ts` — a session JWT minted
 * with the app's own secret, no password, no writes.
 */
const prisma = new PrismaClient();
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3111";

test.afterAll(() => prisma.$disconnect());

/** `buildTransactionParams` asks for this many rows, so this is page one. */
const PAGE_SIZE = 15;

interface Fixture {
  userId: string;
  role: UserRole;
  /** The oldest row. `rowsAfterOldest` is what proves it is past page one. */
  oldestId: string;
  oldestMonth: string;
  newestMonth: string;
  /**
   * How many rows carry a strictly later date than the oldest.
   *
   * The endpoint sorts by date, then createdAt, then id, and several rows can share
   * the oldest date — so "oldest by date" alone does not say which of them Prisma
   * returns, and a tie could in principle sit inside page one. Counting the rows
   * that sort strictly ahead of it settles that for every tie at once: at 15 or
   * more, no row on the oldest date can be on page one.
   */
  rowsAfterOldest: number;
  total: number;
}

const loadFixture = async (): Promise<Fixture | null> => {
  const user = await prisma.user.findFirst({
    orderBy: { transactions: { _count: "desc" } },
    select: { id: true, name: true, email: true, role: true, timezoneOffset: true },
  });
  if (!user) return null;

  const [oldest] = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { date: "asc" },
    take: 1,
    select: { id: true, date: true },
  });
  const [newest] = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 1,
    select: { date: true },
  });
  const total = await prisma.transaction.count({ where: { userId: user.id } });
  if (!oldest || !newest) return null;
  const rowsAfterOldest = await prisma.transaction.count({
    where: { userId: user.id, date: { gt: oldest.date } },
  });

  // Account-local month, the same convention the page's own period uses.
  const monthOf = (d: Date) =>
    new Date(d.getTime() - user.timezoneOffset * 60_000).toISOString().slice(0, 7);

  return {
    userId: user.id,
    role: user.role,
    oldestId: oldest.id,
    oldestMonth: monthOf(oldest.date),
    newestMonth: monthOf(newest.date),
    rowsAfterOldest,
    total,
  };
};

const signIn = async (page: Page, { userId, role }: Pick<Fixture, "userId" | "role">) => {
  const token = await encode({
    token: { id: userId, role, sub: userId },
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

test.describe("a ?highlight= link", () => {
  test.skip(!process.env.NEXTAUTH_SECRET, "Set NEXTAUTH_SECRET (the dev server's own)");

  let fixture: Fixture | null = null;

  test.beforeEach(async ({ page }) => {
    fixture ??= await loadFixture();
    test.skip(!fixture, "The local database has no transactions to link to");
    // Both properties are load-bearing, and neither is about size alone. The row has
    // to be off page one, or the pre-fix code finds it in the loaded set and this
    // stops being a regression test at all; and it has to be in another month, or the
    // period assertion passes against a page that never moved.
    test.skip(
      fixture!.rowsAfterOldest < PAGE_SIZE,
      `Needs ${PAGE_SIZE}+ rows dated after the oldest, so it cannot be on page one`,
    );
    test.skip(
      fixture!.oldestMonth === fixture!.newestMonth,
      "Needs transactions spanning more than one month",
    );
    await signIn(page, fixture!);
  });

  test("opens the edit modal for a row older than the first page", async ({ page }) => {
    await page.goto(`/transactions?highlight=${fixture!.oldestId}`, {
      waitUntil: "domcontentloaded",
    });

    // The modal is the whole point of the link. Before the fix this never appeared:
    // the row was not in the loaded page and nothing looked any further.
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Edit Transaction/i })).toBeVisible();
  });

  test("lands the period on the row's own month, not the newest one", async ({ page }) => {
    await page.goto(`/transactions?highlight=${fixture!.oldestId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 60_000 });

    // Closing the modal should leave the ledger showing the month that row is in, so
    // the period arrows mean what they look like they mean.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Waited for, not sampled: the parameter goes away on the mirror's next write,
    // so reading the URL the instant the modal closes is a race the test would lose
    // at some speeds and win at others.
    await page.waitForURL((url) => !url.searchParams.has("highlight"));
    const params = new URL(page.url()).searchParams;
    expect(params.get("period")).toBe("monthly");
    expect(params.get("from")?.slice(0, 7), "the month the highlighted row is in").toBe(
      fixture!.oldestMonth,
    );
  });

  test("says so when the link resolves to nothing", async ({ page }) => {
    // A row deleted since the link was made. Silence here reads as the app ignoring
    // the tap, which is the part worth fixing whatever the lookup does.
    await page.goto("/transactions?highlight=cm00000000000000000000000", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText(/not found|could not open/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("dialog")).toBeHidden();
    // Spent even though it resolved to nothing: a failed lookup must not be retried
    // on every render, and a reload should not try it again either.
    await page.waitForURL((url) => !url.searchParams.has("highlight"));
  });
});


test.describe("navigating away while the lookup is in flight", () => {
  test.skip(!process.env.NEXTAUTH_SECRET, "Set NEXTAUTH_SECRET (the dev server's own)");

  test("abandons the lookup instead of opening it afterwards", async ({ page }) => {
    // The nav item for this page is a plain link to bare /transactions and renders as
    // active, so clicking it during a slow lookup is an ordinary thing to do — and it
    // is the one in-app navigation that drops the parameter without remounting. The
    // reply must not then open a modal for a row the user has navigated away from,
    // and must not jump the period to that row's month.
    const fixture = await loadFixture();
    test.skip(!fixture, "The local database has no transactions to link to");
    test.skip(fixture!.rowsAfterOldest < PAGE_SIZE, "Needs a row beyond page one");
    await signIn(page, fixture!);

    await page.route(`**/api/transactions/${fixture!.oldestId}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });

    // Registered before navigating, so the waiter cannot miss a fast reply. The
    // assertion below is a negative one — nothing should happen — and a fixed delay
    // would make it pass whenever the response simply had not arrived yet, which is
    // the falsely-green shape this branch has been deleting tests for.
    const lookup = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith(`/api/transactions/${fixture!.oldestId}`),
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/transactions?highlight=${fixture!.oldestId}`, {
      waitUntil: "domcontentloaded",
    });
    // The list has to settle, or the lookup has not started yet.
    await expect(page.locator("[data-transaction-date-heading]").first()).toBeVisible({
      timeout: 60_000,
    });

    await page
      .getByRole("link", { name: "Transactions", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForURL((url) => !url.searchParams.has("highlight"));

    // The reply has landed and its body has been read, so the stale callback has had
    // its chance. What remains is the microtask and render after it, which is what the
    // short settle covers — the sabotage check confirms that is long enough.
    const response = await lookup;
    await response.finished();
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toBeHidden();

    // And the period is the one a fresh view shows, not the old row's month.
    const params = new URL(page.url()).searchParams;
    expect(params.get("from")?.slice(0, 7), "the period jumped to the abandoned row").not.toBe(
      fixture!.oldestMonth,
    );
  });
});
