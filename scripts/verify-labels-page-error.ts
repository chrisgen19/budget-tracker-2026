/**
 * Drives the labels page's failed-read state in a real browser.
 *
 * The page used to destructure `data: labels = []` and check only `isLoading`, so a request that
 * threw fell straight through to "No labels yet" -- a broken read and an account with no labels
 * rendered identically. That is not hypothetical: a dev server holding a Prisma client generated
 * before a migration threw on every label query, the page answered that the account was empty, and
 * that is exactly how it was read. Eight labels carrying 730 transactions were untouched the whole
 * time.
 *
 * A browser check rather than a unit test because the only natural trigger is a broken server, so
 * the failure is forced here with `page.route`. Confirmed failable: with the error branch disabled
 * both checks below reproduce the original illusion.
 *
 * A script rather than a Playwright spec, matching the `verify-*.ts` scripts beside it.
 *
 * Signs in by minting a session JWT with the app's own `NEXTAUTH_SECRET`, so no password is
 * handled. It creates a throwaway user and deletes it afterwards, so it never touches a real
 * account.
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://127.0.0.1:3111 pnpm exec tsx --env-file=.env scripts/verify-labels-page-error.ts
 */
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const prisma = new PrismaClient();
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session cookie");

  const user = await prisma.user.create({
    data: { email: `lperr-${Date.now()}@test.local`, name: "LP Err", password: "x" },
  });

  // Everything after the user exists goes inside the guard, so a throw in setup -- label
  // creation, JWT encoding, a browser that will not launch -- still deletes the user. Leaving it
  // behind is how a local database accumulates a throwaway account per failed run.
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    // One real label, so a passing run cannot be the empty state being correct by accident.
    await prisma.label.create({
      data: { name: "E2E Anywhere", color: "#2D8B5A", applicableTo: "EXPENSE", userId: user.id },
    });

    const token = await encode({
      token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
      secret,
    });

    browser = await chromium.launch();
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

    await page.route("**/api/labels", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto(`${BASE}/labels`);
    await page.waitForTimeout(2500);
    const failed = await page.locator("body").innerText();
    check(
      "a failed label read says so rather than claiming the account is empty",
      failed.includes("Couldn't load your labels") && !failed.includes("No labels yet"),
      failed.includes("No labels yet") ? "rendered the empty state" : ""
    );
    check(
      "and offers a retry",
      await page.getByRole("button", { name: /retry/i }).isVisible().catch(() => false)
    );
    await page.unroute("**/api/labels");
  } finally {
    await browser?.close();
    await prisma.user.delete({ where: { id: user.id } });
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
