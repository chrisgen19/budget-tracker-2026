import { TransactionType } from "@prisma/client";

/**
 * The categories every account starts with, seeded by `prisma/seed.ts` as `isDefault: true`
 * with a null `userId` so they are shared rather than owned.
 *
 * This lives outside the seed script because the receipt-scan prompts hardcode routing rules by
 * category *name*, and a rule naming a category that is not seeded here does not fail loudly:
 * the prompt's fallback matches by name similarity instead. That is how "Household" resolved to
 * "Housing" and filed cleaning supplies beside rent. `receipt-scan.test.ts` asserts every
 * category the prompt names is either seeded here or listed as deliberately deployment-specific,
 * which is only possible if both sides can import this list.
 */
export const DEFAULT_CATEGORIES = [
  // Expense categories
  { name: "Food & Dining", type: TransactionType.EXPENSE, icon: "UtensilsCrossed", color: "#E07C4F" },
  { name: "Groceries", type: TransactionType.EXPENSE, icon: "ShoppingCart", color: "#2D8B5A" },
  { name: "Transportation", type: TransactionType.EXPENSE, icon: "Car", color: "#5B8DEF" },
  { name: "Housing", type: TransactionType.EXPENSE, icon: "Home", color: "#8B6FC0" },
  { name: "Home Supplies", type: TransactionType.EXPENSE, icon: "Droplets", color: "#14B8A6" },
  { name: "Utilities", type: TransactionType.EXPENSE, icon: "Zap", color: "#F5A623" },
  { name: "Entertainment", type: TransactionType.EXPENSE, icon: "Film", color: "#E05B8D" },
  { name: "Shopping", type: TransactionType.EXPENSE, icon: "ShoppingBag", color: "#4ECDC4" },
  { name: "Healthcare", type: TransactionType.EXPENSE, icon: "Heart", color: "#FF6B6B" },
  { name: "Fun", type: TransactionType.EXPENSE, icon: "Gift", color: "#45B7D1" },
  { name: "Personal Care", type: TransactionType.EXPENSE, icon: "Sparkles", color: "#C8702A" },
  { name: "Other Expense", type: TransactionType.EXPENSE, icon: "MoreHorizontal", color: "#8B7E6A" },

  // Income categories
  { name: "Salary", type: TransactionType.INCOME, icon: "Briefcase", color: "#2D8B5A" },
  { name: "Freelance", type: TransactionType.INCOME, icon: "Laptop", color: "#45B7D1" },
  { name: "Investments", type: TransactionType.INCOME, icon: "TrendingUp", color: "#8B6FC0" },
  { name: "Side Business", type: TransactionType.INCOME, icon: "Store", color: "#E07C4F" },
  { name: "Other Income", type: TransactionType.INCOME, icon: "MoreHorizontal", color: "#5B8DEF" },
];
