/**
 * Proof that a category's type cannot be flipped out from under a write that is validating it.
 *
 * `PUT /api/categories/[id]` refuses a type flip while anything references the category, and it
 * takes `FOR UPDATE` on the row so a concurrent insert cannot slip between its count and its
 * update. That closes the race against writers that have already *inserted*. It does nothing about
 * a writer that has validated and not yet inserted: such a writer is invisible to the count, so the
 * flip commits, the insert follows, and the pair disagrees -- exactly the state the guard exists to
 * prevent, reached from the other side.
 *
 * `categoriesAreUsableForWrite` closes it by taking `FOR KEY SHARE` as part of the validating read.
 *
 * A stubbed Prisma cannot show any of this. It can assert the statement is issued, and
 * `transaction-writes.schema.test.ts` does; what it cannot show is that the statement *blocks*,
 * which is the entire claim. That needs two real connections against a real Postgres.
 *
 * The interleaving is deterministic rather than timing-lucky: each side waits until the other is
 * provably blocked, read out of `pg_locks`, the same shape `verify-batch-idempotency.ts` and
 * `verify-label-removal-stamps.ts` use. Sleeping instead lets whichever side is faster win and the
 * check passes against the unfixed code too.
 *
 *   pnpm exec tsx --env-file=.env scripts/verify-category-lock.ts
 */
import { PrismaClient } from "@prisma/client";
import { categoriesAreUsableForWrite } from "../src/lib/transaction-writes";

const prisma = new PrismaClient();
/** A second client, so the two transactions really are two connections. */
const other = new PrismaClient();

let failures = 0;

const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Resolves once some backend is waiting on a lock. */
const someoneIsBlocked = async (): Promise<boolean> => {
  const [{ count }] = await other.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM pg_locks WHERE NOT granted
  `;
  return Number(count) > 0;
};

/**
 * Waits until the flipper has either blocked on our lock or finished without one.
 *
 * Both outcomes are the cue to carry on, and accepting either is what makes this script fail
 * *informatively* against the unfixed code rather than by timing out. Waiting only for a blocked
 * backend would hang for the whole transaction timeout when no lock is taken, and the run would
 * die with "transaction already closed" -- a failure that proves nothing about the race.
 */
const waitForFlipper = async (settled: () => boolean, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (settled() || (await someoneIsBlocked())) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** Room for the deliberate stalls above, well clear of Prisma's 5s default. */
const TX = { maxWait: 10_000, timeout: 20_000 };

async function main() {
  const user = await prisma.user.create({
    data: { email: `cl-${Date.now()}@test.local`, name: "CL", password: "x" },
  });
  const category = await prisma.category.create({
    data: { name: "Lock Probe", type: "EXPENSE", icon: "Car", color: "#111", userId: user.id },
  });

  try {
    // The race, run for real: a writer validates the category, a flipper tries to change its type
    // in the gap before the insert, and we look at what the database is left holding.
    //
    // With the lock the flipper waits, then counts the committed row and refuses. Without it the
    // flipper sees zero references, commits the flip, and the insert lands afterwards -- leaving an
    // EXPENSE transaction filed under a category that is now INCOME.
    let validated = false;
    let flipperSettled = false;

    const writer = prisma.$transaction(async (tx) => {
      validated = await categoriesAreUsableForWrite(tx, user.id, [
        { categoryId: category.id, type: "EXPENSE" },
      ]);
      await waitForFlipper(() => flipperSettled);
      await tx.transaction.create({
        data: {
          amount: 10,
          description: "Lock probe",
          type: "EXPENSE",
          date: new Date(),
          categoryId: category.id,
          userId: user.id,
        },
      });
    }, TX);

    // Long enough for the writer to have taken its lock, if it takes one at all.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const flipper = other
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM categories WHERE id = ${category.id} FOR UPDATE`;
        const count = await tx.transaction.count({ where: { categoryId: category.id } });
        if (count > 0) return "refused" as const;
        await tx.category.update({ where: { id: category.id }, data: { type: "INCOME" } });
        return "flipped" as const;
      }, TX)
      .finally(() => {
        flipperSettled = true;
      });

    const [, flipOutcome] = await Promise.all([writer, flipper]);

    check("the writer validated the category", validated);
    check(
      "the flip waited for the writer and then refused, having seen its row",
      flipOutcome === "refused",
      flipOutcome
    );

    // The assertion that actually names the bug, rather than describing the mechanism: nothing in
    // the database disagrees with itself.
    const mismatched = await prisma.transaction.count({
      where: { userId: user.id, category: { type: { not: "EXPENSE" } }, type: "EXPENSE" },
    });
    check("no transaction was left filed under a category of the wrong type", mismatched === 0);

    // The other direction: with the flipper holding the row first, a validating read must wait and
    // then see the committed type. An unlocked read returns the stale one and lets the write past.
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.category.update({ where: { id: category.id }, data: { type: "EXPENSE" } });

    let usableDuringFlip: boolean | null = null;
    let readerSettled = false;

    const flipFirst = other.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM categories WHERE id = ${category.id} FOR UPDATE`;
      await waitForFlipper(() => readerSettled);
      await tx.category.update({ where: { id: category.id }, data: { type: "INCOME" } });
    }, TX);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const reader = prisma
      .$transaction(async (tx) => {
        usableDuringFlip = await categoriesAreUsableForWrite(tx, user.id, [
          { categoryId: category.id, type: "EXPENSE" },
        ]);
      }, TX)
      .finally(() => {
        readerSettled = true;
      });

    await Promise.all([flipFirst, reader]);

    check(
      "a writer arriving mid-flip reads the committed type and refuses",
      usableDuringFlip === false,
      `usable=${usableDuringFlip}`
    );
  } finally {
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.category.deleteMany({ where: { id: category.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await Promise.all([prisma.$disconnect(), other.$disconnect()]);
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
