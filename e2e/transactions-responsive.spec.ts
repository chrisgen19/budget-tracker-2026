import { expect, test, type Page, type TestInfo } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@example.com").fill(email!);
  await page.getByPlaceholder("Enter your password").fill(password!);
  await page.getByRole("button", { name: /Sign In/ }).click();
  await page.waitForURL(/\/(dashboard|transactions)/);
};

const assertNoHorizontalOverflow = async (page: Page, width: number) => {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `${width}px document width`).toBeLessThanOrEqual(
    dimensions.innerWidth,
  );
};

const capture = async (page: Page, testInfo: TestInfo, width: number) => {
  if (![390, 768, 1024, 1440].includes(width)) return;
  await page.screenshot({
    path: testInfo.outputPath(`transactions-${width}.png`),
    fullPage: true,
    animations: "disabled",
  });
};

test.describe("transactions responsive layout", () => {
  test.skip(!email || !password, "Set E2E_EMAIL and E2E_PASSWORD for an authenticated account");

  test("has no horizontal overflow at supported widths", async ({ page }, testInfo) => {
    await login(page);
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
    await expect(page.locator("[data-transaction-date-heading]").first()).toBeVisible({
      timeout: 120_000,
    });

    for (const width of [320, 390, 640, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      await assertNoHorizontalOverflow(page, width);

      const compactFilters = page.getByRole("button", { name: "Toggle filters" });
      if (width < 1440) {
        await expect(compactFilters).toBeVisible();
      } else {
        await expect(compactFilters).toBeHidden();
      }

      await capture(page, testInfo, width);
    }
  });

  test("keeps mobile sticky headings and the FAB clear during scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });

    const dateHeading = page.locator("[data-transaction-date-heading]").first();
    await expect(dateHeading, "The E2E account needs at least one transaction").toBeVisible({
      timeout: 120_000,
    });

    await dateHeading.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 300);

    const fab = page.locator('button[aria-label="Add Transaction"]');
    await expect(fab).toHaveClass(/pointer-events-none/);
    await expect.poll(() => fab.getAttribute("class")).not.toContain("pointer-events-none");

    await dateHeading.scrollIntoViewIfNeeded();
    const box = await dateHeading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(64);

    const fabBox = await fab.boundingBox();
    expect(fabBox).not.toBeNull();
    expect(fabBox!.width).toBeLessThanOrEqual(48);
  });
});
