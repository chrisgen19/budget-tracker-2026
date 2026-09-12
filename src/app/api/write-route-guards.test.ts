// @vitest-environment node
/**
 * Pins that every API route which writes a transaction or bill row consults the shared rules.
 *
 * Six findings across #297, #298 and #299 were one defect wearing different clothes: a rule is
 * added to a shared writer, and a sibling route that deliberately keeps its own implementation
 * never learns it. Nothing caught any of them, because each copy type-checks and passes its own
 * tests perfectly well -- the rule is simply absent, which is invisible from inside the file.
 *
 * Two were a security gap rather than a cosmetic one: `POST /api/transactions` and
 * `PUT /api/bills/[id]` wrote whatever `categoryId` arrived, so a caller could file their own row
 * under another account's category, and both responses include `category` and handed its name
 * back (CWE-639).
 *
 * The routes are separate on purpose and this does not argue otherwise -- `.claude/rules/
 * transactions.md` records why `updateTransactions` is not wired into `PUT /api/transactions/[id]`.
 * What was missing is anything keeping the copies in step once they diverged. That is this.
 *
 * Two checks, and they are worth very different amounts. Measured against the pre-fix code at
 * `977daf1` rather than argued:
 *
 * - The **category-ownership** check below catches both security bugs. Neither route referenced
 *   `categoriesAreUsable` at all, and both fail it when the old files are restored. That is the
 *   one that earns its place.
 * - The **reachability** check catches neither, and would not have caught any of the six. Every
 *   one of those files already mentioned *some* guard -- `matchScheduledLabel` in the transaction
 *   create, `updateBill` in the bill edit -- so a test asking "does this file mention a rule?"
 *   passed happily over code missing the rule that mattered. It is kept for the different case it
 *   does cover: a brand-new write route added with no guard of any kind, where the first question
 *   is whether the author knew these rules exist. It is not evidence that an existing route is
 *   correct, and nothing here should be read as saying it is.
 *
 * Both are reachability tests over source text, not proofs that a rule is applied correctly.
 * Correctness stays the job of the unit tests and the verify scripts beside them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const API_DIR = join(ROOT, "src", "app", "api");

/** Every `route.ts` under `src/app/api`, as a repo-relative path. */
const routeFiles = (() => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") found.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  walk(API_DIR);
  return found.sort();
})();

/**
 * Writes that put a row into the ledger, or attach a label to one.
 *
 * `update` is included because a bill or transaction edit rewrites `categoryId`, which is the
 * field the ownership rule is about. Deletes are deliberately absent: removing a label or a row
 * can never create the mismatch these guards exist to prevent, which is why
 * `DELETE /api/transactions/[id]/labels/[labelId]` needs none and correctly has none.
 */
const WRITE_CALL =
  /\b(?:tx|prisma|db)\.(?:transaction|scheduledTransaction|transactionLabel|billLabel)\.(?:create|update|createMany|createManyAndReturn|upsert)\b/;

/**
 * Anything that makes the rules reachable from a route.
 *
 * Either the route delegates wholesale to a shared writer, or it restates the rule by calling the
 * predicate the writer itself uses. `matchScheduledLabel` counts because the schedule matcher
 * takes a `categoryId` and refuses to auto-apply a label into a category its restriction excludes
 * -- that is how the retroactive-apply route is guarded, and it has no other need for the check.
 */
const GUARDS = [
  // The shared writers, which own the rules.
  "createTransactionBatch",
  "updateTransactions",
  "createBill",
  "updateBill",
  "settleBill",
  // The predicates a route restates them with.
  "categoriesAreUsable",
  "categoriesAreUsableForWrite",
  "labelAllowsCategory",
  "labelRowAllowsCategory",
  "matchScheduledLabel",
];

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Routes that write a row, so the rule applies to them. */
const writingRoutes = routeFiles.filter((file) => WRITE_CALL.test(read(file)));

describe("write routes reach the shared rules", () => {
  /**
   * A guard against the test quietly measuring nothing. If the write pattern stops matching --
   * a Prisma rename, a helper extracted, a client aliased to something else -- every assertion
   * below passes over an empty list and reports a clean run, which is the failure mode this
   * whole file exists to object to.
   */
  it("finds the routes that write rows", () => {
    expect(routeFiles.length).toBeGreaterThan(20);
    expect(writingRoutes.length).toBeGreaterThanOrEqual(5);
    // The two that carried real bugs, named so a rename cannot silently drop them from the set.
    expect(writingRoutes).toContain("src/app/api/transactions/route.ts");
    expect(writingRoutes).toContain("src/app/api/bills/[id]/route.ts");
  });

  /**
   * The removal route is deliberately *outside* the set, and that is worth asserting rather than
   * leaving to the reader of a regex. `DELETE /api/transactions/[id]/labels/[labelId]` unlinks a
   * label and then stamps the audit columns with `updateMany`, which writes no `categoryId` and
   * attaches nothing -- so it needs no guard and correctly has none. Were it swept in, the honest
   * fix would be to add a meaningless guard to it, which is how a structural test starts training
   * people to satisfy it rather than to think.
   */
  it("leaves the label-removal route out, since removing can create no mismatch", () => {
    const removal = "src/app/api/transactions/[id]/labels/[labelId]/route.ts";
    expect(routeFiles).toContain(removal);
    expect(writingRoutes).not.toContain(removal);
  });

  it.each(writingRoutes)("%s consults a shared rule", (file) => {
    const source = read(file);
    const referenced = GUARDS.filter((guard) => source.includes(guard));

    expect(
      referenced,
      `${file} writes a transaction or bill row without referencing any of the shared category ` +
        `and label rules. Either call the shared writer for this entity, or call the same ` +
        `predicate it does (${GUARDS.slice(5).join(", ")}). See issue #301.`
    ).not.toHaveLength(0);
  });
});

/**
 * The category-ownership rule specifically, which is the one that was a security gap.
 *
 * Narrower than the check above and worth stating separately: a route that writes a `categoryId`
 * it was handed must verify the caller may use that category. Both routes listed here shipped
 * without it, and both echoed the foreign category's name back in their response.
 */
describe("routes that write a caller-supplied categoryId verify it", () => {
  const CATEGORY_GUARDS = ["categoriesAreUsable", "categoriesAreUsableForWrite"];

  /**
   * Named rather than derived. Deriving "writes a caller-supplied categoryId" from the text is
   * what a reviewer does by eye and gets wrong; a list is checked when a route is added, which is
   * the moment that matters. The `toContain` assertions above cover the same two files from the
   * other direction, so neither list can be emptied without the other objecting.
   */
  const ROUTES = [
    "src/app/api/transactions/route.ts",
    "src/app/api/transactions/[id]/route.ts",
    "src/app/api/bills/[id]/route.ts",
  ];

  it.each(ROUTES)("%s checks category ownership", (file) => {
    const source = read(file);
    expect(
      CATEGORY_GUARDS.some((guard) => source.includes(guard)),
      `${file} writes a caller-supplied categoryId without calling categoriesAreUsable or ` +
        `categoriesAreUsableForWrite, so it would accept another account's category (CWE-639).`
    ).toBe(true);
  });
});
