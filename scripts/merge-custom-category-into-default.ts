/**
 * Merge a user-owned category into the seeded default of the same name, then delete it.
 *
 * Needed whenever a category that people had already created by hand becomes a default: seeding
 * it does not replace the custom copy, it sits beside it, and `GET /api/categories` returns
 * `OR: [{ isDefault: true }, { userId }]`, so both show up with identical names in every picker.
 *
 * Three places hold a category id, and only the first two are foreign keys:
 *   - `transactions.category_id`          (FK, onDelete: Restrict)
 *   - `scheduled_transactions.category_id` (FK, onDelete: Restrict — recurring bills)
 *   - `users.quick_expense_categories` / `quick_income_categories` (plain String[], no FK, so a
 *     stale id here dangles silently instead of blocking the delete)
 *
 * `transactions.receipt_breakdown` is deliberately not touched: `receiptBreakdownMetaSchema` is
 * `.strict()` and stores only `total` and `items`, so no category id is buried in that JSON.
 *
 * The Restrict rules are the safety net. If this script missed a referencing row the final
 * delete would fail and the whole transaction would roll back, rather than leaving orphans.
 *
 * Dry run by default; APPLY=true writes.
 *
 *   pnpm exec tsx scripts/merge-custom-category-into-default.ts NAME=Subscriptions
 *   pnpm exec tsx scripts/merge-custom-category-into-default.ts NAME=Subscriptions APPLY=true
 *
 * tsx does not read .env on its own, so DATABASE_URL has to reach it somehow: `--env-file=.env`
 * locally, already-set variables inside the container, or an explicit `DATABASE_URL=...` prefix
 * when running against production from a local checkout. Check which database it printed before
 * passing APPLY=true — the dry run names the category and user ids it is about to move.
 */
import { PrismaClient, TransactionType } from "@prisma/client";

const prisma = new PrismaClient();

const arg = (key: string) =>
  process.argv.slice(2).find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1) ??
  process.env[key];

const NAME = arg("NAME");
const TYPE = (arg("TYPE") ?? "EXPENSE") as TransactionType;
const APPLY = (arg("APPLY") ?? "").toLowerCase() === "true";

const main = async () => {
  if (!NAME) throw new Error("NAME is required, e.g. NAME=Subscriptions");

  const target = await prisma.category.findFirst({
    where: { name: NAME, type: TYPE, isDefault: true },
  });
  if (!target) {
    throw new Error(
      `No default "${NAME}" (${TYPE}) exists yet. Run "pnpm db:seed" first, then re-run this.`
    );
  }

  const customs = await prisma.category.findMany({
    where: { name: NAME, type: TYPE, isDefault: false },
  });
  if (customs.length === 0) {
    console.log(`Nothing to do: no custom "${NAME}" (${TYPE}) remains.`);
    return;
  }

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — merging into default ${target.id}\n`);

  for (const custom of customs) {
    const [txns, bills, quickExpense, quickIncome] = await Promise.all([
      prisma.transaction.count({ where: { categoryId: custom.id } }),
      prisma.scheduledTransaction.count({ where: { categoryId: custom.id } }),
      prisma.user.findMany({
        where: { quickExpenseCategories: { has: custom.id } },
        select: { id: true, quickExpenseCategories: true },
      }),
      prisma.user.findMany({
        where: { quickIncomeCategories: { has: custom.id } },
        select: { id: true, quickIncomeCategories: true },
      }),
    ]);

    console.log(`  custom ${custom.id} (user ${custom.userId})`);
    console.log(`    transactions      ${txns}`);
    console.log(`    recurring bills   ${bills}`);
    console.log(`    quick-pick lists  ${quickExpense.length + quickIncome.length}`);

    if (!APPLY) continue;

    // One transaction: a partial merge would leave rows pointing at a category that is gone.
    await prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({
        where: { categoryId: custom.id },
        data: { categoryId: target.id },
      });
      await tx.scheduledTransaction.updateMany({
        where: { categoryId: custom.id },
        data: { categoryId: target.id },
      });

      // Swap the id in place and dedupe, in case the user already had both pinned.
      const swap = (ids: string[]) => [...new Set(ids.map((i) => (i === custom.id ? target.id : i)))];

      // Re-read inside the transaction rather than reusing the arrays counted above. Those were
      // fetched before it opened, and a user editing their quick-picks in between would have the
      // change silently overwritten by a stale array: these are plain String[] columns, so the
      // write replaces the whole list rather than touching one element.
      const expenseNow = await tx.user.findMany({
        where: { quickExpenseCategories: { has: custom.id } },
        select: { id: true, quickExpenseCategories: true },
      });
      for (const u of expenseNow) {
        await tx.user.update({
          where: { id: u.id },
          data: { quickExpenseCategories: swap(u.quickExpenseCategories) },
        });
      }

      const incomeNow = await tx.user.findMany({
        where: { quickIncomeCategories: { has: custom.id } },
        select: { id: true, quickIncomeCategories: true },
      });
      for (const u of incomeNow) {
        await tx.user.update({
          where: { id: u.id },
          data: { quickIncomeCategories: swap(u.quickIncomeCategories) },
        });
      }

      // Restrict on both FKs means this throws, and rolls everything back, if anything was missed.
      await tx.category.delete({ where: { id: custom.id } });
    });

    console.log(`    merged and deleted\n`);
  }

  console.log(
    APPLY ? "Done." : "\nDry run only. Re-run with APPLY=true to make these changes."
  );
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
