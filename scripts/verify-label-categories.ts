/**
 * End-to-end proof of the label-category restriction against a real Postgres.
 *
 * Exercises the shared write paths directly -- the same functions the MCP tools and the Telegram
 * bot call -- and then, when a dev server is running, the three **browser** routes over real HTTP.
 *
 * The second half is not redundant. `POST /api/transactions`, `PUT /api/transactions/[id]` and the
 * bulk-label branch of `PATCH /api/transactions/batch` deliberately do not share
 * `createTransactionBatch`, so each carries its own copy of the label rules -- and each shipped
 * enforcing only `applicableTo`, which made the restriction hold everywhere except the app's own
 * primary write path. A test against the shared writer cannot see that, because the routes never
 * call it. Set `BASE_URL` to run it: `BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env
 * scripts/verify-label-categories.ts`.
 *
 * Everything is created under one throwaway user and deleted at the end.
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { createLabel } from "../src/lib/label-writes";
import { createTransactionBatch } from "../src/lib/transaction-writes";
import { getLabelList } from "../src/lib/budget-queries";

const prisma = new PrismaClient();
let failures = 0;

const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  // Everything the run creates, so cleanup can tolerate a half-built fixture. The `try` opens
  // before the first insert rather than after the last: a category creation that throws would
  // otherwise skip `finally` entirely and leave the user and whatever came before it behind.
  let user: Awaited<ReturnType<typeof prisma.user.create>> | null = null;
  const createdCategoryIds: string[] = [];

  const makeCategory = async (
    name: string,
    type: "EXPENSE" | "INCOME",
    icon: string,
    color: string,
    userId: string
  ) => {
    const category = await prisma.category.create({
      data: { name, type, icon, color, userId },
    });
    createdCategoryIds.push(category.id);
    return category;
  };

  try {
    user = await prisma.user.create({
      data: { email: `lc-${Date.now()}@test.local`, name: "LC", password: "x" },
    });
    const transport = await makeCategory("Transportation LC", "EXPENSE", "Car", "#111", user.id);
    const shopping = await makeCategory("Shopping LC", "EXPENSE", "Bag", "#222", user.id);
    const salary = await makeCategory("Salary LC", "INCOME", "Wallet", "#333", user.id);

    const args = { prisma: prisma as never, userId: user.id, color: "#A8763E" as const };
    // --- createLabel ---
    const tnvs = await createLabel({ ...args, name: "TNVS", applicableTo: "EXPENSE", categoryIds: [transport.id] });
    check("creates a label restricted to a category", tnvs.ok);

    const open = await createLabel({ ...args, name: "Anywhere", applicableTo: "EXPENSE" });
    check("creates an unrestricted label", open.ok);

    const wrongType = await createLabel({ ...args, name: "Bad", applicableTo: "EXPENSE", categoryIds: [salary.id] });
    check(
      "refuses an income category on an expense-only label",
      !wrongType.ok && wrongType.reason === "INVALID_CATEGORIES",
      !wrongType.ok && "message" in wrongType ? wrongType.message : ""
    );

    const notMine = await createLabel({ ...args, name: "Bad2", applicableTo: "EXPENSE", categoryIds: ["cat_nope"] });
    check("refuses an unknown category", !notMine.ok && notMine.reason === "INVALID_CATEGORIES");

    if (!tnvs.ok || !open.ok) throw new Error("setup failed");

    // --- createTransactionBatch ---
    const item = { amount: 100, description: "Fare", type: "EXPENSE" as const, date: "2026-09-12" };

    const allowed = await createTransactionBatch({
      prisma: prisma as never,
      userId: user.id,
      items: [{ ...item, categoryId: transport.id, labelIds: [tnvs.label.id] }],
      createdVia: "APP",
    });
    check("writes a label into a category it allows", allowed.ok);

    const refused = await createTransactionBatch({
      prisma: prisma as never,
      userId: user.id,
      items: [{ ...item, categoryId: shopping.id, labelIds: [tnvs.label.id] }],
      createdVia: "APP",
    });
    check(
      "refuses a label outside the row's category",
      !refused.ok && refused.reason === "LABELS_NOT_IN_CATEGORY",
      !refused.ok ? refused.reason : ""
    );

    const unrestricted = await createTransactionBatch({
      prisma: prisma as never,
      userId: user.id,
      items: [{ ...item, categoryId: shopping.id, labelIds: [open.label.id] }],
      createdVia: "APP",
    });
    check("still writes an unrestricted label anywhere", unrestricted.ok);

    // --- getLabelList, the MCP read ---
    const forTransport = await getLabelList(prisma as never, user.id, { categoryId: transport.id });
    check(
      "get_label_list for Transportation offers TNVS and Anywhere",
      forTransport.map((l) => l.name).sort().join(",") === "Anywhere,TNVS",
      forTransport.map((l) => l.name).join(",")
    );

    const forShopping = await getLabelList(prisma as never, user.id, { categoryId: shopping.id });
    check(
      "get_label_list for Shopping offers only Anywhere",
      forShopping.map((l) => l.name).join(",") === "Anywhere",
      forShopping.map((l) => l.name).join(",")
    );

    const all = await getLabelList(prisma as never, user.id, {});
    check("get_label_list unfiltered still returns both", all.length === 2);
    check(
      "an unrestricted label reports an empty categoryIds",
      all.find((l) => l.name === "Anywhere")?.categoryIds.length === 0
    );

    // --- the cascade documented on the migration ---
    //
    // On a category with no transactions, which is the only kind that can be deleted:
    // `transactions.category_id` is `onDelete: Restrict`, so a category in use refuses outright.
    // That is what bounds the blast radius of the widening below to a category nobody is using.
    const spare = await prisma.category.create({
      data: { name: "Spare LC", type: "EXPENSE", icon: "Tag", color: "#444", userId: user.id },
    });
    const scoped = await createLabel({
      ...args,
      name: "Scoped",
      applicableTo: "EXPENSE",
      categoryIds: [spare.id],
    });
    if (!scoped.ok) throw new Error("setup failed");

    const inUse = await prisma.category
      .delete({ where: { id: transport.id } })
      .then(() => false)
      .catch(() => true);
    check("a category with transactions cannot be deleted at all", inUse);

    await prisma.category.delete({ where: { id: spare.id } });
    const afterDelete = await prisma.label.findUnique({
      where: { id: scoped.label.id },
      include: { categories: true },
    });
    check(
      "deleting the last linked category leaves the label unrestricted, not unusable",
      afterDelete?.categories.length === 0
    );

    // --- the browser routes, over real HTTP ---
    //
    // Skipped without a BASE_URL so the database half still runs unattended, and announced rather
    // than silently passing: a skipped check that prints nothing is how a regression reaches main.
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      console.log("\nSKIP  browser routes -- set BASE_URL to a running dev server to include them");
    } else {
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session cookie");
      const token = await encode({
        token: { id: user.id, role: user.role, sub: user.id, email: user.email, name: "LC" },
        secret,
      });
      const send = (path: string, method: string, body: unknown) =>
        fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            cookie: `next-auth.session-token=${token}`,
          },
          body: JSON.stringify(body),
        });

      // `check` records a failure and carries on, which is right for independent assertions and
      // wrong for a chain: reading `.id` off a refusal yields undefined, and the next call then
      // fails for a reason that has nothing to do with what it was testing. Every dependent step
      // goes through this instead.
      const createdIdOf = async (res: Response): Promise<string | null> => {
        if (res.status !== 201) return null;
        const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
        return typeof body?.id === "string" ? body.id : null;
      };

      const row = (categoryId: string, labelIds?: string[]) => ({
        amount: 100,
        description: "Fare",
        type: "EXPENSE" as const,
        date: "2026-09-12",
        categoryId,
        ...(labelIds && { labelIds }),
      });

      const ok = await send("/api/transactions", "POST", row(transport.id, [tnvs.label.id]));
      check("POST /api/transactions writes a label its category allows", ok.status === 201, String(ok.status));

      const bad = await send("/api/transactions", "POST", row(shopping.id, [tnvs.label.id]));
      check("POST /api/transactions refuses a label out of category", bad.status === 400, String(bad.status));

      // The edit path has to grandfather what is already on the row, or narrowing a label makes
      // every older transaction carrying it unsaveable -- down to fixing a typo in its description.
      const createdId = await createdIdOf(ok);
      if (!createdId) {
        check("the row the edit checks depend on was created", false, "skipping the rest");
        return;
      }
      await prisma.transaction.update({
        where: { id: createdId },
        data: { categoryId: shopping.id },
      });
      const grandfathered = await send(`/api/transactions/${createdId}`, "PUT", {
        ...row(shopping.id, [tnvs.label.id]),
        description: "Fare, corrected",
      });
      check(
        "PUT /api/transactions/[id] re-accepts a label already on the row",
        grandfathered.status === 200,
        String(grandfathered.status)
      );

      const adding = await send(`/api/transactions/${createdId}`, "PUT", {
        ...row(shopping.id, [tnvs.label.id, open.label.id]),
      });
      check(
        "PUT /api/transactions/[id] still accepts adding an unrestricted label",
        adding.status === 200,
        String(adding.status)
      );

      // The path that needed this most: a bulk add meets transactions the user never opened,
      // spanning every category the selection covers.
      const other = await send("/api/transactions", "POST", row(shopping.id));
      const otherId = await createdIdOf(other);
      if (!otherId) {
        check("the second row the bulk checks depend on was created", false, "skipping the rest");
        return;
      }
      const bulk = await send("/api/transactions/batch", "PATCH", {
        ids: [createdId, otherId],
        action: "labels",
        operation: "add",
        labelIds: [tnvs.label.id],
      });
      check(
        "PATCH /api/transactions/batch refuses a bulk add outside the label's categories",
        bulk.status === 409,
        String(bulk.status)
      );

      const bulkOk = await send("/api/transactions/batch", "PATCH", {
        ids: [createdId, otherId],
        action: "labels",
        operation: "add",
        labelIds: [open.label.id],
      });
      check(
        "PATCH /api/transactions/batch still adds an unrestricted label in bulk",
        bulkOk.status === 200,
        String(bulkOk.status)
      );

      // The grandfather clause on the bulk path. `createdId` sits in Shopping and already carries
      // TNVS from the edit above; `otherId` is also Shopping. Judging the whole selection refused
      // this outright, even though the only pair the write would insert is the one on `otherId`
      // -- so a legitimate add was blocked by a link that already existed.
      await prisma.transaction.update({
        where: { id: otherId },
        data: { categoryId: transport.id },
      });
      const mixed = await send("/api/transactions/batch", "PATCH", {
        ids: [createdId, otherId],
        action: "labels",
        operation: "add",
        labelIds: [tnvs.label.id],
      });
      check(
        "PATCH /api/transactions/batch grandfathers a link that already exists",
        mixed.status === 200,
        String(mixed.status)
      );

      // The same ownership question on the transaction create path, which had no category check
      // at all: `createTransactionBatch` and the sibling PUT both run `categoriesAreUsable`, and
      // this route wrote the id it was given. Its response includes `category` too.
      const foreign = await prisma.user.create({
        data: { email: `lc-foreign-${Date.now()}@test.local`, name: "LC Foreign", password: "x" },
      });
      const foreignCategory = await prisma.category.create({
        data: {
          name: "Foreign Only",
          type: "EXPENSE",
          icon: "Lock",
          color: "#666",
          userId: foreign.id,
        },
      });
      try {
        const stolenTx = await send("/api/transactions", "POST", row(foreignCategory.id));
        check(
          "POST /api/transactions refuses a category belonging to another account",
          stolenTx.status === 400,
          String(stolenTx.status)
        );
        const leakedTx = JSON.stringify(await stolenTx.json().catch(() => ({})));
        check(
          "and does not echo that category's name back",
          !leakedTx.includes("Foreign Only"),
          leakedTx.slice(0, 80)
        );
      } finally {
        await prisma.transaction.deleteMany({ where: { categoryId: foreignCategory.id } });
        await prisma.user.delete({ where: { id: foreign.id } });
        await prisma.category.deleteMany({ where: { id: foreignCategory.id } });
      }

      // --- the bill edit route's category ownership (CWE-639) ---
      //
      // The bill is ownership-checked and the category was not, so a caller could point their own
      // bill at somebody else's category id -- and `billInclude` returns `category`, so the
      // response handed back that category's name. Proved with a real second account rather than
      // a made-up id, since a nonexistent id fails the foreign key and would pass this check for
      // the wrong reason.
      const stranger = await prisma.user.create({
        data: { email: `lc-other-${Date.now()}@test.local`, name: "LC Other", password: "x" },
      });
      const strangerCategory = await prisma.category.create({
        data: {
          name: "Stranger Only",
          type: "EXPENSE",
          icon: "Lock",
          color: "#555",
          userId: stranger.id,
        },
      });
      try {
        const billBody = {
          amount: 100,
          description: "Rent",
          type: "EXPENSE" as const,
          categoryId: transport.id,
          frequency: "MONTHLY" as const,
          reminderDaysBefore: 3,
          startDate: "2026-10-01",
          isActive: true,
        };
        const madeBill = await send("/api/bills", "POST", billBody);
        const billId = ((await madeBill.json().catch(() => null)) as { id?: string } | null)?.id;
        if (!billId) {
          check("the bill the ownership check depends on was created", false, String(madeBill.status));
        } else {
          const stolen = await send(`/api/bills/${billId}`, "PUT", {
            ...billBody,
            categoryId: strangerCategory.id,
          });
          check(
            "PUT /api/bills/[id] refuses a category belonging to another account",
            stolen.status === 400,
            String(stolen.status)
          );
          const leaked = JSON.stringify(await stolen.json().catch(() => ({})));
          check(
            "and does not echo that category's name back",
            !leaked.includes("Stranger Only"),
            leaked.slice(0, 80)
          );
        }
      } finally {
        await prisma.scheduledTransaction.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: stranger.id } });
        await prisma.category.deleteMany({ where: { id: strangerCategory.id } });
      }
    }

  } finally {
    // Tolerates a fixture that never finished being built: `user` is null if its own insert threw,
    // and `createdCategoryIds` holds only what really landed.
    if (user) {
      await prisma.transaction.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    if (createdCategoryIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
