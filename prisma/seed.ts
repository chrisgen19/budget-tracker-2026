import { PrismaClient, TransactionType } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  // Expense categories
  { name: "Food & Dining", type: TransactionType.EXPENSE, icon: "UtensilsCrossed", color: "#E07C4F" },
  { name: "Transportation", type: TransactionType.EXPENSE, icon: "Car", color: "#5B8DEF" },
  { name: "Housing", type: TransactionType.EXPENSE, icon: "Home", color: "#8B6FC0" },
  { name: "Utilities", type: TransactionType.EXPENSE, icon: "Zap", color: "#F5A623" },
  { name: "Entertainment", type: TransactionType.EXPENSE, icon: "Film", color: "#E05B8D" },
  { name: "Shopping", type: TransactionType.EXPENSE, icon: "ShoppingBag", color: "#4ECDC4" },
  { name: "Healthcare", type: TransactionType.EXPENSE, icon: "Heart", color: "#FF6B6B" },
  { name: "Education", type: TransactionType.EXPENSE, icon: "GraduationCap", color: "#45B7D1" },
  { name: "Personal Care", type: TransactionType.EXPENSE, icon: "Sparkles", color: "#C8702A" },
  { name: "Other Expense", type: TransactionType.EXPENSE, icon: "MoreHorizontal", color: "#8B7E6A" },

  // Income categories
  { name: "Salary", type: TransactionType.INCOME, icon: "Briefcase", color: "#2D8B5A" },
  { name: "Freelance", type: TransactionType.INCOME, icon: "Laptop", color: "#45B7D1" },
  { name: "Investments", type: TransactionType.INCOME, icon: "TrendingUp", color: "#8B6FC0" },
  { name: "Side Business", type: TransactionType.INCOME, icon: "Store", color: "#E07C4F" },
  { name: "Other Income", type: TransactionType.INCOME, icon: "MoreHorizontal", color: "#5B8DEF" },
];

const main = async () => {
  // Check if defaults already exist
  const existingCount = await prisma.category.count({
    where: { isDefault: true },
  });

  if (existingCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`Default categories already seeded (${existingCount} found). Skipping.`);
    return;
  }

  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((cat) => ({
      name: cat.name,
      type: cat.type,
      icon: cat.icon,
      color: cat.color,
      isDefault: true,
      userId: null,
    })),
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
