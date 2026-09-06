/**
 * Verification harness for `update_transactions` over the real `/api/mcp` route.
 *
 * The unit tests in `src/lib/transaction-updates.test.ts` stub Prisma, so they prove the rules
 * and nothing about the storage. Everything below is a property only a real database can answer:
 *
 *   - `updated_via` and `updated_by_mcp_token_id` actually land on the row, and `created_via`
 *     survives untouched -- a `data` key spelled wrong writes nothing and throws nothing
 *   - the app's own PUT clears the token id again, so "last edited by" cannot go stale
 *   - `transaction_labels` rows are *replaced*, not appended, which a stub counting calls cannot
 *     distinguish from a delete that silently matched nothing
 *   - a refused batch leaves every row byte-identical, which needs a real transaction to roll back
 *   - a create-only token cannot see the tool at all
 *
 * It mints its own throwaway user, token and category, and deletes them afterwards, so it never
 * touches yours. Needs a dev server:
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-transaction-update.ts
 */
import { PrismaClient } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { encode } from "next-auth/jwt";
import { mintMcpToken } from "../src/lib/mcp/tokens";

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3111";
const EMAIL = "update-probe@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
};

/** A client bound to one token, so scope differences are exercised the way a real caller hits them. */
const connect = async (token: string) => {
  const client = new Client({ name: "update-probe", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE_URL}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
  );
  return client;
};

const callUpdate = async (client: Client, transactions: unknown[]) =>
  client.callTool({ name: "update_transactions", arguments: { transactions } });

async function main() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session");

  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: {
      name: "Update Probe",
      email: EMAIL,
      password: "x",
      // The lease is a kill switch over every write, editing included. Opened here for the run.
      mcpWritesEnabledUntil: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const expenseCat = await prisma.category.create({
    data: { name: "Probe Expense", type: "EXPENSE", icon: "tag", color: "#000", userId: user.id },
  });
  const otherExpenseCat = await prisma.category.create({
    data: { name: "Probe Other", type: "EXPENSE", icon: "tag", color: "#000", userId: user.id },
  });
  const incomeCat = await prisma.category.create({
    data: { name: "Probe Income", type: "INCOME", icon: "tag", color: "#000", userId: user.id },
  });

  const keepLabel = await prisma.label.create({
    data: { name: "Probe Keep", color: "#111", applicableTo: "BOTH", userId: user.id },
  });
  const swapLabel = await prisma.label.create({
    data: { name: "Probe Swap", color: "#222", applicableTo: "BOTH", userId: user.id },
  });

  const editToken = await mintMcpToken({
    userId: user.id,
    name: "probe-edit",
    scopes: ["transactions:read", "transactions:edit"],
    expiresInDays: 1,
  });
  const createToken = await mintMcpToken({
    userId: user.id,
    name: "probe-create",
    scopes: ["transactions:write"],
    expiresInDays: 1,
  });

  /** A row seeded as the app would have written it, so `created_via` starts at APP. */
  const seed = async (over: Record<string, unknown> = {}) =>
    prisma.transaction.create({
      data: {
        amount: 250,
        description: "Grab to office",
        type: "EXPENSE",
        date: new Date("2026-08-25T09:00:00.000Z"),
        categoryId: expenseCat.id,
        userId: user.id,
        createdVia: "APP",
        labels: { create: [{ labelId: keepLabel.id }] },
        ...over,
      },
    });

  const client = await connect(editToken.token);

  // --- The tool is gated by its own scope ---

  const editTools = (await client.listTools()).tools.map((t) => t.name);
  check("an edit token is offered update_transactions", editTools.includes("update_transactions"), true);
  check("an edit token is not offered create_transactions", editTools.includes("create_transactions"), false);

  const creator = await connect(createToken.token);
  const createTools = (await creator.listTools()).tools.map((t) => t.name);
  // The property the whole scope split exists for: the Telegram bot's token is exactly this one.
  check("a create-only token cannot see update_transactions", createTools.includes("update_transactions"), false);
  await creator.close();

  // --- The audit columns actually land ---

  const tx = await seed();
  await callUpdate(client, [{ id: tx.id, amount: 320, categoryId: otherExpenseCat.id }]);

  const afterEdit = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
  check("the amount was written", afterEdit.amount, 320);
  check("the category was written", afterEdit.categoryId, otherExpenseCat.id);
  check("updated_via records the surface", afterEdit.updatedVia, "MCP");
  check(
    "updated_by_mcp_token_id records the credential",
    afterEdit.updatedByMcpTokenId,
    editToken.record.id
  );
  // Creation provenance is not a thing an edit may rewrite. A row typed into the app and later
  // corrected over MCP is both, and one column cannot say that.
  check("created_via is untouched by an edit", afterEdit.createdVia, "APP");
  check("mcp_token_id is untouched by an edit", afterEdit.mcpTokenId, null);

  // --- The app's PUT clears the token id again ---

  const sessionToken = await encode({
    token: { id: user.id, role: user.role, sub: user.id, email: EMAIL, name: "Update Probe" },
    secret,
  });
  const putRes = await fetch(`${BASE_URL}/api/transactions/${tx.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: `next-auth.session-token=${sessionToken}` },
    body: JSON.stringify({
      amount: 330,
      description: "Grab to office",
      type: "EXPENSE",
      date: "2026-08-25T09:00:00.000Z",
      categoryId: otherExpenseCat.id,
    }),
  });
  check("the app's PUT still succeeds through the shared service", putRes.status, 200);

  const afterApp = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
  check("updated_via flips back to APP", afterApp.updatedVia, "APP");
  // Left alone, this would go on naming a token as the last editor of a row the user edited by
  // hand -- worse than no audit trail, because it is a confident wrong one.
  check("the token id is cleared, not left stale", afterApp.updatedByMcpTokenId, null);

  // --- Labels are replaced, not appended ---

  await callUpdate(client, [{ id: tx.id, labelIds: [swapLabel.id] }]);
  const labelsAfter = await prisma.transactionLabel.findMany({
    where: { transactionId: tx.id },
    select: { labelId: true },
  });
  check("exactly one label row remains", labelsAfter.length, 1);
  check("it is the new label", labelsAfter[0]?.labelId, swapLabel.id);

  await callUpdate(client, [{ id: tx.id, amount: 340 }]);
  const labelsPreserved = await prisma.transactionLabel.findMany({ where: { transactionId: tx.id } });
  // Omitting labelIds must not churn them: every amount correction would otherwise rewrite the
  // row's labels for no reason, and a schedule-applied label would look user-chosen afterwards.
  check("omitting labelIds leaves them alone", labelsPreserved.length, 1);

  await callUpdate(client, [{ id: tx.id, labelIds: [] }]);
  const labelsCleared = await prisma.transactionLabel.findMany({ where: { transactionId: tx.id } });
  check("an explicit empty array clears them", labelsCleared.length, 0);

  // --- A refused batch rolls back completely ---

  const a = await seed({ description: "Batch A" });
  const b = await seed({ description: "Batch B" });
  const refused = await callUpdate(client, [
    { id: a.id, amount: 999 },
    // Valid on its own, but the category is an income one and this row is an expense, so the
    // effective-row check rejects the whole call.
    { id: b.id, categoryId: incomeCat.id },
  ]);
  check("a mixed batch is refused", refused.isError, true);

  const rolledBack = await prisma.transaction.findMany({
    where: { id: { in: [a.id, b.id] } },
    select: { amount: true, updatedVia: true },
    orderBy: { description: "asc" },
  });
  check("the valid row in a refused batch did not move", rolledBack[0]?.amount, 250);
  check("nor was it stamped", rolledBack[0]?.updatedVia, null);
  check("the rejected row did not move either", rolledBack[1]?.amount, 250);

  // --- A bare type flip is refused rather than half-applied ---

  const flip = await seed({ description: "Flip" });
  const flipResult = await callUpdate(client, [{ id: flip.id, type: "INCOME" }]);
  check("a type flip with no category is refused", flipResult.isError, true);
  const afterFlip = await prisma.transaction.findUniqueOrThrow({ where: { id: flip.id } });
  // The failure that matters: an expense turned income while keeping an expense category is
  // internally inconsistent and distorts every breakdown that groups by category.
  check("the type did not change", afterFlip.type, "EXPENSE");

  const flipOk = await callUpdate(client, [
    { id: flip.id, type: "INCOME", categoryId: incomeCat.id },
  ]);
  check("a type flip with a matching category succeeds", flipOk.isError, undefined);

  // --- A bare date must not overwrite the stored time (found in review) ---

  const dated = await seed({ description: "Dated", date: new Date("2026-08-25T09:00:00.000Z") });
  await callUpdate(client, [{ id: dated.id, amount: 400, date: "2026-08-25" }]);
  const afterSameDay = await prisma.transaction.findUniqueOrThrow({ where: { id: dated.id } });
  // The probe user is UTC+8, so 09:00Z is a 17:00 purchase. Resolving the bare date with the
  // current clock -- correct when creating a row, destructive when editing one -- would move it to
  // whenever this script happened to run, and report a date change with an identical before and
  // after, since both render as the same local day.
  check(
    "restating the same day leaves the time alone",
    afterSameDay.date.toISOString(),
    "2026-08-25T09:00:00.000Z"
  );

  await callUpdate(client, [{ id: dated.id, date: "2026-08-26" }]);
  const afterReDate = await prisma.transaction.findUniqueOrThrow({ where: { id: dated.id } });
  check(
    "re-dating carries the stored time to the new day",
    afterReDate.date.toISOString(),
    "2026-08-26T09:00:00.000Z"
  );

  // --- A pre-existing type/category mismatch stays editable (found in review) ---

  // Milliseconds specifically: bill payments are stamped with a bare `new Date()`, and a
  // preserved time rebuilt as an HH:mm:ss string loses them, shifting the instant and reporting a
  // date change with an identical before and after.
  const precise = await seed({
    description: "Precise",
    date: new Date("2026-08-25T09:00:00.678Z"),
  });
  await callUpdate(client, [{ id: precise.id, amount: 999, date: "2026-08-25" }]);
  const afterPrecise = await prisma.transaction.findUniqueOrThrow({ where: { id: precise.id } });
  check(
    "sub-second precision survives a bare date",
    afterPrecise.date.toISOString(),
    "2026-08-25T09:00:00.678Z"
  );

  const mismatched = await seed({ description: "Mismatched" });
  // Exactly what `PUT /api/categories/[id]` allows: flip a custom category's type while its
  // transactions keep pointing at it. Judging the stored pair on every edit locked these rows out
  // of being edited at all, while preventing nothing -- the row is already in that state.
  await prisma.category.update({ where: { id: expenseCat.id }, data: { type: "INCOME" } });
  // Sent the way the app's form sends it -- every field, `categoryId` included -- because
  // `transactionSchema` requires it. A carve-out keyed on whether the patch *mentioned* the field
  // would not fire here, which is the whole point: it has to compare against the stored row.
  const typoFix = await callUpdate(client, [
    {
      id: mismatched.id,
      description: "Typo fixed",
      type: "EXPENSE",
      categoryId: expenseCat.id,
    },
  ]);
  check("an untouched mismatched row can still be edited", typoFix.isError, undefined);
  const afterTypo = await prisma.transaction.findUniqueOrThrow({ where: { id: mismatched.id } });
  check("and the edit landed", afterTypo.description, "Typo fixed");
  await prisma.category.update({ where: { id: expenseCat.id }, data: { type: "EXPENSE" } });

  // --- An explicitly named label that does not fit is reported, not dropped in silence ---

  const incomeOnly = await prisma.label.create({
    data: { name: "Probe Income Only", color: "#444", applicableTo: "INCOME", userId: user.id },
  });
  const labelled = await seed({ description: "Labelled" });
  const dropped = await callUpdate(client, [{ id: labelled.id, labelIds: [incomeOnly.id] }]);
  const warnings = (dropped.structuredContent as { transactions: { warnings: string[] }[] })
    .transactions[0].warnings;
  check("a type-excluded label is named back", warnings.some((w) => w.includes("Probe Income Only")), true);
  const noLabels = await prisma.transactionLabel.count({ where: { transactionId: labelled.id } });
  check("and really was not applied", noLabels, 0);

  // --- A label a changed type removes is explained, not just deleted ---

  const bothLabel = await prisma.label.create({
    data: { name: "Probe Expense Only", color: "#555", applicableTo: "EXPENSE", userId: user.id },
  });
  const flipped = await prisma.transaction.create({
    data: {
      amount: 250, description: "Flipped", type: "EXPENSE",
      date: new Date("2026-08-25T09:00:00.000Z"), categoryId: expenseCat.id, userId: user.id,
      createdVia: "APP", labels: { create: [{ labelId: bothLabel.id }] },
    },
  });
  const flipWarn = await callUpdate(client, [
    { id: flipped.id, type: "INCOME", categoryId: incomeCat.id },
  ]);
  const flipWarnings = (flipWarn.structuredContent as { transactions: { warnings: string[] }[] })
    .transactions[0].warnings;
  // Nobody listed this label in the call: it was already on the row and the new type excludes it.
  // `changed` shows it leaving but never why, and an unexplained disappearance reads as a bug.
  check(
    "a label removed by a type change is named",
    flipWarnings.some((w) => w.includes("Probe Expense Only")),
    true
  );

  // --- An edit that moves nothing leaves the trail alone ---

  const untouched = await seed({ description: "Untouched" });
  await callUpdate(client, [{ id: untouched.id, amount: 990 }]);
  const stamped = await prisma.transaction.findUniqueOrThrow({ where: { id: untouched.id } });
  check("the first edit stamped it", stamped.updatedVia, "MCP");

  // The app's form posts every field on every save, so pressing Update with no edits names them
  // all and moves none. Stamping on the request rather than on the change would rewrite this to
  // APP and null the token id for something that never happened.
  const noopRes = await fetch(`${BASE_URL}/api/transactions/${untouched.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: `next-auth.session-token=${sessionToken}` },
    body: JSON.stringify({
      amount: 990,
      description: "Untouched",
      type: "EXPENSE",
      date: stamped.date.toISOString(),
      categoryId: stamped.categoryId,
    }),
  });
  check("a no-op save still succeeds", noopRes.status, 200);
  const afterNoop = await prisma.transaction.findUniqueOrThrow({ where: { id: untouched.id } });
  check("a no-op save does not rewrite the trail", afterNoop.updatedVia, "MCP");
  check("nor clears the token id", afterNoop.updatedByMcpTokenId, editToken.record.id);

  // --- A bulk edit in the app clears a stale MCP trail too ---

  const bulk = await seed({ description: "Bulk" });
  await callUpdate(client, [{ id: bulk.id, amount: 777 }]);
  const bulkAfterMcp = await prisma.transaction.findUniqueOrThrow({ where: { id: bulk.id } });
  check("the MCP edit stamped it", bulkAfterMcp.updatedVia, "MCP");

  const patchRes = await fetch(`${BASE_URL}/api/transactions/batch`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: `next-auth.session-token=${sessionToken}` },
    body: JSON.stringify({
      action: "category",
      categoryId: otherExpenseCat.id,
      ids: [bulk.id],
    }),
  });
  check("the bulk recategorise succeeded", patchRes.status, 200);
  const bulkAfterApp = await prisma.transaction.findUniqueOrThrow({ where: { id: bulk.id } });
  // A bulk change is an edit. Without a stamp here the row would go on naming the MCP token as
  // its last editor -- the stale, confidently-wrong trail PUT clears the token id to avoid.
  check("a bulk recategorise stamps APP", bulkAfterApp.updatedVia, "APP");
  check("and clears the token id", bulkAfterApp.updatedByMcpTokenId, null);

  // --- Another user's row is invisible ---

  const stranger = await prisma.user.create({
    data: { name: "Stranger", email: "update-stranger@scratch.invalid", password: "x" },
  });
  const strangerTx = await prisma.transaction.create({
    data: {
      amount: 500,
      description: "Not yours",
      type: "EXPENSE",
      date: new Date(),
      categoryId: expenseCat.id,
      userId: stranger.id,
    },
  });
  const trespass = await callUpdate(client, [{ id: strangerTx.id, amount: 1 }]);
  check("another user's transaction is refused", trespass.isError, true);
  const strangerAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: strangerTx.id } });
  check("and is untouched", strangerAfter.amount, 500);

  // --- The lease is a kill switch over editing too ---

  await prisma.user.update({
    where: { id: user.id },
    data: { mcpWritesEnabledUntil: new Date(Date.now() - 1000) },
  });
  const leaseOff = await callUpdate(client, [{ id: flip.id, amount: 1 }]);
  check("a lapsed lease refuses an edit", leaseOff.isError, true);
  const afterLease = await prisma.transaction.findUniqueOrThrow({ where: { id: flip.id } });
  check("and nothing was written", afterLease.amount, 250);

  await client.close();

  // The stranger goes first, and separately. Their transaction points at a category owned by the
  // probe user, and `transactions.category_id` is ON DELETE RESTRICT: deleting the probe user
  // cascades that category away, and the FK is checked immediately, so a combined delete that
  // happened to process the probe user first would raise a violation *after* every check passed
  // and turn a green run into exit 1 with the probe user left behind.
  await prisma.user.delete({ where: { id: stranger.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
