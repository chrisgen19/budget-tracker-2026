import { PrismaClient } from "@prisma/client";
import { DEFAULT_CATEGORIES } from "../src/lib/default-categories";

const prisma = new PrismaClient();

const main = async () => {
  // Seeded one at a time rather than as an all-or-nothing batch. The previous version skipped
  // the whole block when any default existed, so a category added to the list later never
  // reached a database that had already been seeded — it was dead code everywhere but a fresh
  // install. Checking per category is also the only duplicate protection there is: the
  // @@unique([name, type, userId]) index does not constrain defaults, because their userId is
  // NULL and Postgres treats NULLs as distinct, so the same default can be inserted twice with
  // no error.
  let created = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: cat.name, type: cat.type, isDefault: true },
    });
    if (existing) continue;

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
  }

  console.log(
    created > 0
      ? `Seeded ${created} default categories (${DEFAULT_CATEGORIES.length - created} already present)`
      : `All ${DEFAULT_CATEGORIES.length} default categories already present`
  );

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
