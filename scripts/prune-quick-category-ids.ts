/**
 * Remove quick-pick category ids that no longer name a category.
 *
 * `users.quick_expense_categories` / `quick_income_categories` are plain `String[]` columns with no
 * foreign key, so deleting a category leaves its id stranded in every user's list that pinned it.
 * The quick row on the categories page drops such an id when it renders, which hides the problem,
 * but `QuickCategoryPicker` counts the stored list against its four-slot limit: a list of four
 * holding one dead id makes the picker believe it is full, disables every unselected tile, and puts
 * the fourth slot permanently out of reach. Saving from that picker writes the dead id straight
 * back, so it never clears on its own.
 *
 * `DELETE /api/categories/[id]` now strips the id as part of the same transaction as the delete, so
 * this script is a one-off repair for ids stranded before that fix, not an ongoing chore.
 *
 * Dry run by default; APPLY=true writes.
 *
 *   pnpm exec tsx --env-file=.env scripts/prune-quick-category-ids.ts
 *   pnpm exec tsx --env-file=.env scripts/prune-quick-category-ids.ts APPLY=true
 *
 * tsx does not read .env on its own, so DATABASE_URL has to reach it somehow: `--env-file=.env`
 * locally, already-set variables inside the container, or an explicit `DATABASE_URL=...` prefix
 * when running against production from a local checkout. Check which database it printed before
 * passing APPLY=true.
 */
import { PrismaClient } from "@prisma/client";
import { describeDatabaseUrl } from "../src/lib/database-identity";

const prisma = new PrismaClient();

const arg = (key: string) =>
  process.argv.slice(2).find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1) ??
  process.env[key];

const APPLY = (arg("APPLY") ?? "").toLowerCase() === "true";

const main = async () => {
  // Announced before any query so it covers every exit, including "Nothing to do" — the output an
  // operator pointed at the wrong database would otherwise read as proof production was clean.
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} on ${describeDatabaseUrl(process.env.DATABASE_URL)}\n`);

  const [users, categories] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        quickExpenseCategories: true,
        quickIncomeCategories: true,
      },
    }),
    prisma.category.findMany({ select: { id: true } }),
  ]);

  const live = new Set(categories.map((c) => c.id));
  let repaired = 0;

  for (const user of users) {
    const expense = user.quickExpenseCategories.filter((id) => live.has(id));
    const income = user.quickIncomeCategories.filter((id) => live.has(id));

    const deadExpense = user.quickExpenseCategories.filter((id) => !live.has(id));
    const deadIncome = user.quickIncomeCategories.filter((id) => !live.has(id));
    if (deadExpense.length === 0 && deadIncome.length === 0) continue;

    repaired += 1;
    console.log(`  ${user.email}`);
    if (deadExpense.length > 0) {
      console.log(`    expense  drops ${deadExpense.join(", ")} (${user.quickExpenseCategories.length} -> ${expense.length})`);
    }
    if (deadIncome.length > 0) {
      console.log(`    income   drops ${deadIncome.join(", ")} (${user.quickIncomeCategories.length} -> ${income.length})`);
    }

    if (!APPLY) continue;

    // Filtered against the ids read above rather than re-read here: these are whole-array writes,
    // so a user editing their quick-picks concurrently would lose that edit. The window is a few
    // milliseconds on a repair that runs once, and narrowing it further would mean locking the
    // row; worst case the operator re-runs the dry run and sees nothing left to do.
    await prisma.user.update({
      where: { id: user.id },
      data: { quickExpenseCategories: expense, quickIncomeCategories: income },
    });
    console.log(`    repaired`);
  }

  if (repaired === 0) {
    console.log("Nothing to do: no quick-pick list holds a dead category id.");
    return;
  }

  console.log(
    APPLY
      ? `\nDone. Repaired ${repaired} user(s).`
      : `\nDry run only. Re-run with APPLY=true to repair ${repaired} user(s).`
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
