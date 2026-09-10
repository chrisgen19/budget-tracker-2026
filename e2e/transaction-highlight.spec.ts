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

interface Fixture {
  userId: string;
  role: UserRole;
  /** The oldest row, which is the one a single page of newest rows cannot contain. */
  oldestId: string;
  oldestMonth: string;
  newestMonth: string;
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

  // Account-local month, the same convention the page's own period uses.
  const monthOf = (d: Date) =>
    new Date(d.getTime() - user.timezoneOffset * 60_000).toISOString().slice(0, 7);

  return {
    userId: user.id,
    role: user.role,
    oldestId: oldest.id,
    oldestMonth: monthOf(oldest.date),
    newestMonth: monthOf(newest.date),
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
    // The point of the test is a row that one page of newest rows cannot hold, and
    // a month away from the one the ledger would land on by itself.
    test.skip(
      fixture!.total <= 15 || fixture!.oldestMonth === fixture!.newestMonth,
      "Needs more than one page of transactions spanning more than one month",
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
