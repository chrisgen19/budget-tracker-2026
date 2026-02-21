-- AlterTable
ALTER TABLE "users" ADD COLUMN     "quick_expense_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "quick_income_categories" TEXT[] DEFAULT ARRAY[]::TEXT[];
