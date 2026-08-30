import { z } from "zod";
import { transactionFilterSchema } from "@/lib/transaction-filter-query";

/** A personal ledger can be large, but one interactive operation must stay bounded. */
export const MAX_BULK_TRANSACTIONS = 2_000;

export const boundedTransactionIdsSchema = z
  .array(z.string().min(1).max(100))
  .min(1)
  .max(MAX_BULK_TRANSACTIONS)
  .transform((ids) => [...new Set(ids)]);

export const selectionSnapshotSchema = z.object({
  filters: transactionFilterSchema.omit({ timezoneOffset: true }),
  timezoneOffset: z.number().int().min(-840).max(840),
});

export const exportTransactionsSchema = z.object({
  ids: boundedTransactionIdsSchema,
  timezoneOffset: z.number().int().min(-840).max(840),
});

export const bulkTransactionMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("category"),
    ids: boundedTransactionIdsSchema,
    categoryId: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("labels"),
    ids: boundedTransactionIdsSchema,
    operation: z.enum(["add", "remove"]),
    labelIds: z.array(z.string().min(1).max(100)).min(1).max(100).transform((ids) => [...new Set(ids)]),
  }),
]);

export interface TransactionSelectionItem {
  id: string;
  description: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
}
