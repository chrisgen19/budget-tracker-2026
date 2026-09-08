import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRANSACTION_LABELS_COLUMNS,
  TRANSACTION_LABELS_TABLE,
} from "@/lib/label-writes";

/**
 * `removeTransactionLabels` issues `DELETE ... RETURNING` as raw SQL, because Prisma 6.19.2 has no
 * `deleteManyAndReturn` and `deleteMany` reports a count with no row identity (#251). Raw SQL
 * bypasses Prisma's field mapping, so the physical names are restated in application code -- the
 * one real cost of the approach, and the cost the issue named.
 *
 * A rename in `schema.prisma` would leave `pnpm type-check` perfectly green and fail at runtime as
 * a 500 on a bulk label removal. These assertions turn that into a failing test instead. They are
 * read from the schema text rather than from the generated client, which exposes only the
 * camelCase field names and so cannot answer the question at all.
 */
const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

const modelBody = (name: string): string => {
  const match = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`model ${name} not found in prisma/schema.prisma`);
  return match[1];
};

describe("transaction_labels physical names", () => {
  it("matches the table name the raw delete targets", () => {
    expect(modelBody("TransactionLabel")).toContain(`@@map("${TRANSACTION_LABELS_TABLE}")`);
  });

  it("matches the columns the raw delete filters and returns", () => {
    const body = modelBody("TransactionLabel");
    expect(body).toContain(`@map("${TRANSACTION_LABELS_COLUMNS.transactionId}")`);
    expect(body).toContain(`@map("${TRANSACTION_LABELS_COLUMNS.labelId}")`);
  });

  /**
   * The delete joins `transactions` to scope by owner, so those two names are load-bearing here
   * as well -- a `Transaction` remapped to another table would make the join silently wrong.
   */
  it("matches the transactions table and owner column the delete joins through", () => {
    const body = modelBody("Transaction");
    expect(body).toContain('@@map("transactions")');
    expect(body).toContain('@map("user_id")');
  });

  /**
   * Matching on `(transaction_id, label_id)` rather than on a link-row id is only sound while at
   * most one row can exist per pair. Without this constraint the delete could remove more than the
   * caller planned.
   */
  it("keeps the pair unique, which is what lets the delete match on it", () => {
    expect(modelBody("TransactionLabel")).toContain("@@unique([transactionId, labelId])");
  });
});
