import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { categorySchema } from "@/lib/validations";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const existing = await prisma.category.findFirst({
      where: { id, userId, isDefault: false },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Category not found or cannot be edited" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validated = categorySchema.parse(body);

    // A category's type may not be flipped out from under rows that already point at it.
    //
    // Nothing stopped this before, and the result was silent: the transactions kept their own
    // type and their category no longer agreed with it. Such a row is internally inconsistent
    // and distorts everything grouping by category, and because `PUT /api/transactions/[id]` is
    // a full replace, the browser re-sends that stale pair on every subsequent edit -- which is
    // why that route has to tolerate it rather than reject it (#229). This removes the state
    // instead of accommodating it.
    //
    // Refusing outright, rather than the 409-then-confirm the sibling label route uses. That
    // flow deletes `TransactionLabel` join rows, which are optional; `transactions.category_id`
    // is NOT NULL, so there is no association to remove here -- something would have to be
    // rewritten instead, either the rows' own `type` (restating spending history) or their
    // category (a destructive move behind a confirm). Neither is worth doing on the user's
    // behalf when they can recategorise the rows themselves, or make a second category.
    //
    // Counts bills as well as transactions: `ScheduledTransaction.categoryId` is the same
    // NOT NULL reference, and a bill left pointing at a mismatched category writes a wrong-typed
    // transaction every time it is paid.
    type Outcome =
      | { conflict: { transactionCount: number; billCount: number }; category?: undefined }
      | { conflict?: undefined; category: Awaited<ReturnType<typeof prisma.category.update>> };

    const outcome: Outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
      if (validated.type !== existing.type) {
        // Lock the category row before counting, and hold it through the write.
        //
        // Counting and then updating are two snapshots, and a transaction or bill inserted
        // between them commits against the old type while the flip commits after it -- exactly
        // the mismatch this guard exists to prevent. Postgres takes `FOR KEY SHARE` on the
        // parent row to enforce the foreign key whenever such a row is inserted, and `FOR
        // UPDATE` conflicts with it, so taking it here makes any concurrent insert wait for
        // this transaction rather than slip between the two statements. Nothing is needed from
        // the writers themselves: the lock they already take is what this conflicts with.
        //
        // The update alone is not enough, even though `UPDATE ... SET type` does take `FOR
        // UPDATE` of its own accord -- `type` sits in the `(name, type, user_id)` unique index,
        // which is what makes it a key update. That lock is acquired when the write runs, which
        // is after the counts have already been read.
        await tx.$queryRaw`SELECT 1 FROM categories WHERE id = ${id} FOR UPDATE`;

        const transactionCount = await tx.transaction.count({ where: { categoryId: id } });
        const billCount = await tx.scheduledTransaction.count({ where: { categoryId: id } });

        if (transactionCount + billCount > 0) {
          return { conflict: { transactionCount, billCount } };
        }
      }

      return {
        category: await tx.category.update({
          where: { id },
          data: {
            name: validated.name,
            type: validated.type,
            icon: validated.icon,
            color: validated.color,
          },
        }),
      };
    });

    if (outcome.conflict) {
      const { transactionCount, billCount } = outcome.conflict;
      const parts = [
        transactionCount > 0 ? `${transactionCount} transaction(s)` : null,
        billCount > 0 ? `${billCount} bill(s)` : null,
      ].filter(Boolean);
      return NextResponse.json(
        {
          error: `Cannot change type: ${parts.join(" and ")} use this category. Move them to another category first.`,
          transactionCount,
          billCount,
        },
        { status: 409 }
      );
    }

    const category = outcome.category;

    return NextResponse.json(category);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.category.findFirst({
    where: { id, userId, isDefault: false },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Category not found or cannot be deleted" },
      { status: 404 }
    );
  }

  // Check if category has transactions
  const transactionCount = await prisma.transaction.count({
    where: { categoryId: id },
  });

  if (transactionCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${transactionCount} transaction(s) use this category` },
      { status: 400 }
    );
  }

  try {
    // The quick-pick arrays are plain String[], not foreign keys, so deleting a category leaves a
    // dangling id behind. That id still counts toward the four-slot limit in QuickCategoryPicker,
    // so a user who deletes a pinned category can never fill the fourth slot again. array_remove
    // strips every occurrence, which also clears a duplicate.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE users
        SET quick_expense_categories = array_remove(quick_expense_categories, ${id}),
            quick_income_categories = array_remove(quick_income_categories, ${id})
        WHERE id = ${userId}
      `;
      await tx.category.delete({ where: { id } });
    });
  } catch {
    // Matches PUT above. Without this the rejection escapes as an unshaped 500, so the client's
    // `{ error }` parse fails and the user sees no reason for the failure.
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }

  return NextResponse.json({ message: "Category deleted" });
}
