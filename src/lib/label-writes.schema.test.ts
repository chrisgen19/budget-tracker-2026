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
 * a 500 on a bulk label removal. These assertions turn that into a failing test instead.
 *
 * Both ends are checked, and checking only one is what makes this kind of test worthless. The
 * constants matching the schema says nothing about the query, since the query does not read them:
 * rename a column in the schema *and* update the constant, and a test that stopped there would go
 * green over SQL that is now wrong. So the query text is asserted against the same names -- the
 * chain has to run schema -> constants -> the SQL actually issued.
 *
 * Names are read from the schema text rather than the generated client, which exposes only the
 * camelCase field names and so cannot answer the question at all.
 */
const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

const schema = read("prisma", "schema.prisma");

/**
 * The `DELETE` statement itself, not the whole module -- otherwise the surrounding prose, which
 * names these columns freely, would satisfy every assertion below on its own.
 */
const deleteStatement = (() => {
  const source = read("src", "lib", "label-writes.ts");
  const match = source.match(/DELETE FROM[\s\S]*?RETURNING[^\n]*/);
  if (!match) throw new Error("no DELETE ... RETURNING found in src/lib/label-writes.ts");
  return match[0];
})();

const modelBody = (name: string): string => {
  const match = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`model ${name} not found in prisma/schema.prisma`);
  return match[1];
};

describe("transaction_labels physical names", () => {
  it("matches the table name the raw delete targets", () => {
    expect(modelBody("TransactionLabel")).toContain(`@@map("${TRANSACTION_LABELS_TABLE}")`);
    expect(deleteStatement).toContain(`DELETE FROM ${TRANSACTION_LABELS_TABLE} `);
  });

  it("matches the columns the raw delete filters on", () => {
    const body = modelBody("TransactionLabel");
    for (const column of Object.values(TRANSACTION_LABELS_COLUMNS)) {
      expect(body).toContain(`@map("${column}")`);
      expect(deleteStatement).toContain(`tl.${column}`);
    }
  });

  /**
   * Anchored to the end of the statement rather than merely contained in it, because the caller
   * reads `row.transaction_id` off the result: an alias (`RETURNING tl.transaction_id AS x`) keeps
   * every `toContain` assertion green while making that property `undefined` at runtime, so every
   * removal would silently report no edited rows -- the original bug, reintroduced by its own test.
   */
  it("returns the transaction id unaliased, which is the key the caller reads", () => {
    expect(deleteStatement).toMatch(
      new RegExp(`RETURNING\\s+tl\\.${TRANSACTION_LABELS_COLUMNS.transactionId}\\s*$`),
    );
  });

  /**
   * The delete joins `transactions` to scope by owner, so those two names are load-bearing here as
   * well -- a `Transaction` remapped to another table would make the join silently wrong, and
   * losing the join entirely would let a caller delete another account's links.
   */
  it("matches the transactions table and owner column the delete joins through", () => {
    const body = modelBody("Transaction");
    expect(body).toContain('@@map("transactions")');
    expect(body).toContain('@map("user_id")');
    expect(deleteStatement).toContain("USING transactions t");
    expect(deleteStatement).toContain("t.user_id =");
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
