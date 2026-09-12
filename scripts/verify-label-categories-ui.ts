/**
 * Drives the label-category restriction in a real browser.
 *
 * The server rules are covered by unit tests and by `verify-label-categories.ts` against a real
 * Postgres. Neither can see the picker, and three of its behaviours look identical in a snapshot
 * of the database: a restricted label being absent from the list, one the user picked and then
 * stranded by switching category being cleared, and one already attached to a saved row staying
 * put and saying why. Those are the cases here.
 *
 * A script rather than a Playwright spec, matching the fourteen `verify-*.ts` beside it. The spec
 * form was tried first and the runner hung on the first test while this same sequence ran in
 * seconds; the repo's e2e specs cover a deliberately narrow set and this is not one of them.
 *
 * Signs in by minting a session JWT with the app's own `NEXTAUTH_SECRET`, so no password is
 * handled. It creates its own throwaway user, categories and labels and deletes them afterwards,
 * so it never touches a real account.
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://127.0.0.1:3111 pnpm exec tsx --env-file=.env scripts/verify-label-categories-ui.ts
 */
import { chromium, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const prisma = new PrismaClient();
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Every button's visible text, which is how the picker's contents are read here. */
const buttonText = (page: Page) =>
  page
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim()));

const ours = (all: string[]) => all.filter((n) => n.startsWith("E2E ")).join("|");

/**
 * Picks a category by name.
 *
 * The form shows four quick categories and hides the rest behind "More categories...", so a
 * freshly created one is never on the first screen. The sheet closes itself on selection.
 */
const pickCategory = async (page: Page, name: string) => {
  const more = page.getByRole("button", { name: /more categories/i });
  if (await more.isVisible().catch(() => false)) {
    await more.click();
    await page.waitForTimeout(600);
  }
  await page.getByRole("button", { name }).first().click();
  await page.waitForTimeout(900);
};

async function main() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session cookie");

  const user = await prisma.user.create({
    data: { email: `lcui-${Date.now()}@test.local`, name: "LC UI", password: "x" },
  });
  const transport = await prisma.category.create({
    data: { name: "E2E Transport", type: "EXPENSE", icon: "Car", color: "#C8702A", userId: user.id },
  });
  const shopping = await prisma.category.create({
    data: {
      name: "E2E Shopping",
      type: "EXPENSE",
      icon: "ShoppingBag",
      color: "#C8702A",
      userId: user.id,
    },
  });
  const tnvs = await prisma.label.create({
    data: {
      name: "E2E TNVS",
      color: "#E07C4F",
      applicableTo: "EXPENSE",
      userId: user.id,
      categories: { create: [{ categoryId: transport.id }] },
    },
  });
  await prisma.label.create({
    data: {
      name: "E2E Shopee",
      color: "#5B8DEF",
      applicableTo: "EXPENSE",
      userId: user.id,
      categories: { create: [{ categoryId: shopping.id }] },
    },
  });
  await prisma.label.create({
    data: { name: "E2E Anywhere", color: "#2D8B5A", applicableTo: "EXPENSE", userId: user.id },
  });

  const token = await encode({
    token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
    secret,
  });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: new URL(BASE).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/transactions`);
    await page.getByRole("button", { name: /add transaction/i }).first().click();
    await page.waitForTimeout(2500);

    // Before a category is chosen there is nothing to restrict against, so everything is offered.
    let visible = await buttonText(page);
    check(
      "with no category chosen, every label is offered",
      ["E2E TNVS", "E2E Shopee", "E2E Anywhere"].every((n) => visible.includes(n)),
      ours(visible)
    );

    await pickCategory(page, "E2E Transport");
    visible = await buttonText(page);
    check(
      "the chosen category offers its own label and the unrestricted one",
      visible.includes("E2E TNVS") && visible.includes("E2E Anywhere"),
      ours(visible)
    );
    check(
      "and hides a label scoped to a different category",
      !visible.includes("E2E Shopee"),
      ours(visible)
    );

    // Nothing to grandfather on a label picked in this session, and keeping it would leave the
    // form holding a pairing the write refuses.
    await page.getByRole("button", { name: "E2E TNVS" }).first().click();
    await page.waitForTimeout(400);
    await pickCategory(page, "E2E Shopping");
    visible = await buttonText(page);
    check(
      "switching category drops a label the user had picked",
      !visible.includes("E2E TNVS"),
      ours(visible)
    );
    check("and offers the new category's own label", visible.includes("E2E Shopee"), ours(visible));

    // A saved row re-filed under a category its label excludes -- the shape a restriction narrowed
    // after the fact leaves behind. It must stay and say why, not vanish from a saved transaction.
    const row = await prisma.transaction.create({
      data: {
        amount: 120,
        description: "E2E stranded row",
        type: "EXPENSE",
        date: new Date(),
        categoryId: transport.id,
        userId: user.id,
        labels: { create: [{ labelId: tnvs.id }] },
      },
    });
    await prisma.transaction.update({
      where: { id: row.id },
      data: { categoryId: shopping.id },
    });

    await page.goto(`${BASE}/transactions?highlight=${row.id}`);
    await page.waitForTimeout(3500);
    const body = await page.locator("body").innerText();
    check(
      "a label already on a saved row stays, marked out of category",
      body.includes("Not in this category"),
      body.includes("E2E TNVS") ? "label present" : "label MISSING"
    );

    // The label form's own control.
    await page.goto(`${BASE}/labels`);
    await page.getByRole("button", { name: /new label/i }).first().click();
    await page.waitForTimeout(1500);

    const all = page.getByRole("button", { name: "All categories" });
    check(
      "a new label defaults to All categories",
      (await all.getAttribute("aria-pressed")) === "true"
    );

    await page.getByRole("button", { name: "Specific categories" }).click();
    await page.waitForTimeout(600);
    check(
      "choosing Specific leaves All unpressed",
      (await all.getAttribute("aria-pressed")) === "false"
    );
    const chips = await buttonText(page);
    check(
      "and lands on a real selection rather than an unsavable empty one",
      chips.some((n) => n.startsWith("E2E ")),
      ours(chips)
    );
  } finally {
    await browser.close();
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.category.deleteMany({ where: { id: { in: [transport.id, shopping.id] } } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
