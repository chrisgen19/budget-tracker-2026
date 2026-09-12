/**
 * End-to-end proof of the label-category restriction against a real Postgres.
 *
 * Exercises the shared write paths directly -- the same functions the app routes, the MCP tools
 * and the Telegram bot all call -- so what passes here is what every surface does. Everything is
 * created under one throwaway user and deleted at the end.
 */
import { PrismaClient } from "@prisma/client";
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
  const user = await prisma.user.create({
    data: { email: `lc-${Date.now()}@test.local`, name: "LC", password: "x" },
  });
  const transport = await prisma.category.create({
    data: { name: "Transportation LC", type: "EXPENSE", icon: "Car", color: "#111", userId: user.id },
  });
  const shopping = await prisma.category.create({
    data: { name: "Shopping LC", type: "EXPENSE", icon: "Bag", color: "#222", userId: user.id },
  });
  const salary = await prisma.category.create({
    data: { name: "Salary LC", type: "INCOME", icon: "Wallet", color: "#333", userId: user.id },
  });

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

  await prisma.transaction.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.category.deleteMany({
    where: { id: { in: [transport.id, shopping.id, salary.id] } },
  });
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
