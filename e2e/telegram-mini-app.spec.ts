import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * The Mini App driven as a real page in a real browser.
 *
 * A Telegram webview cannot be automated, but the page in it can: `window.Telegram` is stubbed
 * with a *genuinely signed* `initData`, and everything below that -- the fetch wrapper, the routes,
 * the database -- is the real thing. That covers the half jsdom cannot reach: that the SDK script
 * loads from Telegram's CDN without blocking hydration, that the grid renders against real rows,
 * and that a tap actually writes.
 *
 * Signed from Telegram's published algorithm rather than by calling `verifyInitData`, so a green
 * run means the server agrees with the spec rather than with itself.
 *
 * Needs `TELEGRAM_BOT_TOKEN` and the test id in `TELEGRAM_ALLOWED_IDS` **in the server's
 * environment**, since the allowlist is read by the process serving the request:
 *
 *   TELEGRAM_ALLOWED_IDS="<yours>,999000999" pnpm dev -p 3311
 *   E2E_BASE_URL=http://localhost:3311 pnpm exec playwright test e2e/telegram-mini-app.spec.ts
 */

const TELEGRAM_ID = "999000999";
const prisma = new PrismaClient();

const signInitData = (botToken: string, fields: Record<string, string>): string => {
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
};

let userId: string;
let initData: string;

test.beforeAll(async () => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  test.skip(!botToken, "TELEGRAM_BOT_TOKEN is required to sign init data");

  initData = signInitData(botToken!, {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAF_e2e",
    user: JSON.stringify({ id: Number(TELEGRAM_ID), first_name: "E2E" }),
  });

  const category = await prisma.category.findFirstOrThrow({
    where: { isDefault: true, type: "EXPENSE", name: "Transportation" },
    select: { id: true },
  });

  // Its own throwaway account, so the run never touches a real one.
  const user = await prisma.user.create({
    data: {
      email: `tg-e2e-${randomUUID()}@example.test`,
      name: "Mini App E2E",
      password: "x",
      telegramUserId: TELEGRAM_ID,
      timezoneOffset: -480,
    },
    select: { id: true },
  });
  userId = user.id;

  await prisma.telegramQuickTile.createMany({
    data: [
      {
        userId,
        label: "To office",
        description: "fare to office",
        amount: 38,
        type: "EXPENSE",
        categoryId: category.id,
        sortOrder: 10,
      },
      {
        userId,
        label: "Lunch at work",
        description: "lunch at work",
        amount: null,
        type: "EXPENSE",
        categoryId: category.id,
        sortOrder: 20,
      },
    ],
  });
});

test.afterAll(async () => {
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

/** The stub, served *as* Telegram's own script. See `asTelegramClient` below. */
const telegramStub = (raw: string) => `
  window.Telegram = {
    WebApp: {
      initData: ${JSON.stringify(raw)},
      version: "7.0",
      colorScheme: "light",
      viewportHeight: 800,
      viewportStableHeight: 800,
      isExpanded: true,
      ready() {}, expand() {}, close() {},
      isVersionAtLeast: () => true,
      setHeaderColor() {}, setBackgroundColor() {}, disableVerticalSwipes() {},
      onEvent() {}, offEvent() {},
      MainButton: {
        text: "", isVisible: false, isActive: true,
        show() { this.isVisible = true; }, hide() { this.isVisible = false; },
        enable() { this.isActive = true; }, disable() { this.isActive = false; },
        setText(t) { this.text = t; }, setParams() {},
        onClick(h) { window.__mainClick = h; }, offClick() {},
      },
      BackButton: { isVisible: false, show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    },
  };
`;

/**
 * Intercept `telegram-web-app.js` and answer with the stub.
 *
 * Not `addInitScript`, which was the first attempt and is wrong for a reason worth recording: the
 * real script installs its own `window.Telegram.WebApp` on *any* page, so it overwrites anything
 * set beforehand, and outside a Telegram client the object it installs carries an empty
 * `initData`. That is exactly the state that made the app hang on a spinner, so the test has to
 * reproduce the ordering rather than sidestep it.
 *
 * Serving the stub in the script's place is also closer to reality -- the SDK is what defines the
 * global -- and removes a network dependency from the run.
 */
const asTelegramClient = async (page: Page, raw: string) => {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: telegramStub(raw) })
  );
};

test("loads the grid and logs a fixed tile on one tap", async ({ page }) => {
  await asTelegramClient(page, initData);
  await page.goto("/tg");

  await expect(page.getByText("Routine")).toBeVisible();
  await expect(page.getByText("To office")).toBeVisible();
  await expect(page.getByText("Custom amount")).toBeVisible();

  const before = await prisma.transaction.count({ where: { userId } });

  await page.getByText("To office").click();

  // The confirmation names the category, because the button's label is not proof of where the row
  // landed.
  await expect(page.getByText(/to Transportation/)).toBeVisible();

  const after = await prisma.transaction.count({ where: { userId } });
  expect(after).toBe(before + 1);

  const row = await prisma.transaction.findFirstOrThrow({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { amount: true, description: true, createdVia: true, mcpTokenId: true },
  });
  expect(row.amount).toBe(38);
  expect(row.description).toBe("fare to office");
  expect(row.createdVia).toBe("TELEGRAM");
  expect(row.mcpTokenId).toBeNull();
});

test("opens the pad for a tile that asks, and logs what is typed", async ({ page }) => {
  await asTelegramClient(page, initData);
  await page.goto("/tg");

  await page.getByText("Lunch at work").click();

  // A custom keypad, so no OS keyboard: the digits are buttons.
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "8", exact: true }).click();
  await page.getByRole("button", { name: "0", exact: true }).click();

  // MainButton is Telegram's, so the commit is fired the way Telegram fires it.
  await page.evaluate(() => (window as unknown as { __mainClick?: () => void }).__mainClick?.());

  await expect(page.getByText(/Logged/)).toBeVisible();

  const row = await prisma.transaction.findFirstOrThrow({
    where: { userId, description: "lunch at work" },
    orderBy: { createdAt: "desc" },
    select: { amount: true },
  });
  expect(row.amount).toBe(180);
});

test("refuses to render a grid outside Telegram", async ({ page }) => {
  // No `window.Telegram` at all, which is what a stranger opening the URL in a browser sees.
  await page.goto("/tg");

  await expect(page.getByText("Open this from Telegram")).toBeVisible();
});
