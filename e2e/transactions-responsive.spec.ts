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

    const fab = page.locator('button[aria-label="Add Transaction"]');
    await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Add Transaction"]');
      if (!button) throw new Error("Add Transaction button not found");

      document.documentElement.dataset.fabHiddenObserved = "false";
      const recordHiddenState = () => {
        if (button.classList.contains("pointer-events-none")) {
          document.documentElement.dataset.fabHiddenObserved = "true";
          observer.disconnect();
        }
      };
      const observer = new MutationObserver(recordHiddenState);
      observer.observe(button, { attributes: true, attributeFilter: ["class"] });
      recordHiddenState();
    });

    const before = await dateHeading.boundingBox();
    expect(before).not.toBeNull();
    const initialScrollY = await page.evaluate(() => window.scrollY);
    const headingDocumentY = before!.y + initialScrollY;
    const targetScrollY = Math.max(0, headingDocumentY - 40);

    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), targetScrollY);

    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: "The E2E account needs enough transactions for the page to scroll",
      })
      .toBeGreaterThan(initialScrollY);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.dataset.fabHiddenObserved),
      )
      .toBe("true");
    await expect.poll(() => fab.getAttribute("class")).not.toContain("pointer-events-none");

    const box = await dateHeading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(60);
    expect(box!.y).toBeLessThanOrEqual(68);

    const fabBox = await fab.boundingBox();
    expect(fabBox).not.toBeNull();
    expect(fabBox!.width).toBeGreaterThanOrEqual(44);
    expect(fabBox!.width).toBeLessThanOrEqual(48);
    expect(fabBox!.height).toBeGreaterThanOrEqual(44);
    expect(fabBox!.height).toBeLessThanOrEqual(48);

    const filterToggleBox = await page.getByRole("button", { name: "Toggle filters" }).boundingBox();
    expect(filterToggleBox).not.toBeNull();
    expect(filterToggleBox!.width).toBeGreaterThanOrEqual(44);
    expect(filterToggleBox!.height).toBeGreaterThanOrEqual(44);
  });
});
