import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

/**
 * The measurements jsdom cannot take.
 *
 * `Modal` positions itself `fixed inset-0`, which reads as immune to an ancestor. Any
 * ancestor with a transform becomes the containing block for `position: fixed`
 * descendants, so left inside the transactions toolbar — `overflow-hidden`, and
 * transformed even at rest, because Tailwind's `translate-y-0` emits an identity
 * matrix — the overlay resolved against the toolbar's box and the dialog was clipped
 * away above it. The unit tests assert the DOM position that makes the CSS moot; this
 * asserts the geometry that was actually wrong.
 *
 * There is deliberately no "the dialog is clickable" case here. It reads like the
 * sharpest assertion — the clipping's real cost was that the page content won the hit
 * test — but at mobile width the dialog is bottom-anchored and lands inside the
 * toolbar's box anyway, so it passes with the portal removed. The overlay's measured
 * size is what actually distinguishes the two.
 */
const prisma = new PrismaClient();
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3111";

test.afterAll(() => prisma.$disconnect());

const signIn = async (page: Page) => {
  const user = await prisma.user.findFirst({
    orderBy: { transactions: { _count: "desc" } },
    select: { id: true, role: true },
  });
  if (!user) return false;
  const token = await encode({
    token: { id: user.id, role: user.role, sub: user.id },
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
  return true;
};

test.describe("a modal opened from inside the filter toolbar", () => {
  test.skip(!process.env.NEXTAUTH_SECRET, "Set NEXTAUTH_SECRET (the dev server's own)");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await signIn(page)), "The local database has no account to sign in as");
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Transaction filters" })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("the toolbar really is the hazard this fix is about", async ({ page }) => {
    // If this ever stops being true the portal is still correct, but the regression it
    // guards no longer has a live example — worth knowing rather than assuming.
    const toolbar = page.getByRole("region", { name: "Transaction filters" });
    const computed = await toolbar.evaluate((el) => {
      const style = getComputedStyle(el);
      return { transform: style.transform, overflow: style.overflow };
    });

    expect(computed.transform, "an identity matrix still creates a containing block")
      .not.toBe("none");
    expect(computed.overflow).toContain("hidden");
  });

  test("fills the viewport instead of the toolbar's box", async ({ page }) => {
    // The period trigger lives inside the toolbar, so its dialog is the one that was
    // clipped. Below `sm` it is the only presentation; at this width it is a popover,
    // so drive the mobile layout where the Modal is used.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /^Choose period/ }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const overlay = page.locator("div.fixed.inset-0.z-50").first();
    const box = await overlay.boundingBox();
    const viewport = page.viewportSize()!;

    // Was 878×113 — the toolbar's box — against a 1200×827 viewport.
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(box!.height).toBeGreaterThanOrEqual(viewport.height * 0.9);

    // And the dialog is on screen rather than at a negative top.
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  });

});
