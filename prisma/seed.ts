import { PrismaClient } from "@prisma/client";
import { DEFAULT_CATEGORIES, findOrphanedDefaults } from "../src/lib/default-categories";

const prisma = new PrismaClient();

const main = async () => {
  // Seeded one at a time rather than as an all-or-nothing batch. The previous version skipped
  // the whole block when any default existed, so a category added to the list later never
  // reached a database that had already been seeded — it was dead code everywhere but a fresh
  // install. @@unique([name, type, userId]) does not constrain defaults, because their userId is
  // NULL and Postgres treats NULLs as distinct; the partial unique index added in
  // 20260828100000_unique_default_categories is what actually prevents a duplicate default, and
  // the check below just avoids relying on a caught error for the ordinary case.
  let created = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: cat.name, type: cat.type, isDefault: true },
    });
    if (existing) continue;

    try {
      await prisma.category.create({
        data: {
          name: cat.name,
          type: cat.type,
          icon: cat.icon,
          color: cat.color,
          isDefault: true,
          userId: null,
        },
      });
      created += 1;
    } catch (e) {
      // The check above and this insert are two statements, so a second seed running
      // concurrently can pass the same check and reach here first. P2002 means it won this
      // race and the row now exists, which is the outcome we wanted: not an error. Enforced by
      // the partial unique index in 20260828100000_unique_default_categories, without which
      // both inserts would simply succeed and leave a duplicate default behind.
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }

  console.log(
    created > 0
      ? `Seeded ${created} default categories (${DEFAULT_CATEGORIES.length - created} already present)`
      : `All ${DEFAULT_CATEGORIES.length} default categories already present`
  );

  // Making a name a shared default does not replace the copies people already created by hand:
  // both rows survive, and `GET /api/categories` returns `OR: [{ isDefault: true }, { userId }]`,
  // so the picker shows two entries with the same name and new transactions land on whichever
  // one happens to be chosen. This is reported rather than merged: reconciling means repointing
  // transactions and bills and then deleting a category, which a seed has no business doing
  // silently to data it did not create.
  const collisions = await prisma.category.findMany({
    where: {
      isDefault: false,
      OR: DEFAULT_CATEGORIES.map((c) => ({ name: c.name, type: c.type })),
    },
    select: { name: true, type: true, userId: true },
  });

  if (collisions.length > 0) {
    const byName = new Map<string, number>();
    for (const c of collisions) {
      const key = `${c.name} (${c.type})`;
      byName.set(key, (byName.get(key) ?? 0) + 1);
    }
    console.warn(
      `\nWARNING: ${collisions.length} user-owned ${collisions.length === 1 ? "category shares" : "categories share"} a name with a default:`
    );
    for (const [key, count] of byName) {
      console.warn(`  ${key} — ${count} user${count === 1 ? "" : "s"}`);
    }
    // The command deliberately carries no --env-file. This warning is printed by whichever run
    // just seeded, and that run may have been pointed at its database by an exported
    // DATABASE_URL rather than by .env — seeding production from a local checkout is the
    // documented fallback when the container has no tsx. Hardcoding --env-file=.env there
    // prints a command aimed at a different database than the one being warned about.
    console.warn(
      "\nBoth copies now appear in the picker with the same name. Merge each one with:\n" +
        "  pnpm exec tsx scripts/merge-custom-category-into-default.ts NAME=<name>\n\n" +
        "Dry run by default; add APPLY=true to write. It resolves DATABASE_URL the same way\n" +
        "this seed did, so make sure that points at the database warned about above.\n" +
        "Locally that usually means adding --env-file=.env; in the container it is already set."
    );
  }

  // A name dropped from DEFAULT_CATEGORIES leaves behind the row it already created, still
  // flagged isDefault. DELETE /api/categories/[id] filters on isDefault: false, so the leftover
  // cannot be removed through the app: it stays in every picker and splits reporting with
  // whatever replaced it. Renaming Education to Fun is what produced this case.
  const storedDefaults = await prisma.category.findMany({
    where: { isDefault: true },
    select: { name: true, type: true },
  });
  const orphans = findOrphanedDefaults(storedDefaults);

  if (orphans.length > 0) {
    console.warn(
      `\nWARNING: ${orphans.length} default categor${orphans.length === 1 ? "y is" : "ies are"} no longer seeded:`
    );
    for (const o of orphans) console.warn(`  ${o.name} (${o.type})`);
    console.warn(
      "\nThese were removed from the seed list but still exist, and a default cannot be deleted\n" +
        "through the app. Rename one in place to keep its transactions, or delete it directly once\n" +
        "nothing references it. Left alone rather than repaired here: renaming relabels real\n" +
        "spending, which is not a call this script should make.\n"
    );
  }

  // Set admin role for the primary admin account (always runs)
  const adminResult = await prisma.user.updateMany({
    where: { email: "chrisgen19@gmail.com" },
    data: { role: "ADMIN" },
  });

  if (adminResult.count > 0) {
    console.log("Set admin role for chrisgen19@gmail.com");
  }

  // Seed default app settings per role
  await prisma.appSettings.upsert({
    where: { role: "FREE" },
    update: {},
    create: { role: "FREE", receiptScanEnabled: false, maxUploadFiles: 5, monthlyScanLimit: 5 },
  });

  await prisma.appSettings.upsert({
    where: { role: "PAID" },
    update: {},
    create: { role: "PAID", receiptScanEnabled: true, maxUploadFiles: 10, monthlyScanLimit: 0 },
  });

  console.log("Seeded default app settings for FREE and PAID roles");
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
