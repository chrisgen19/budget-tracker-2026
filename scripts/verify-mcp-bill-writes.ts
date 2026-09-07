/**
 * Verification harness for the bill and label write tools over the real `/api/mcp` route.
 *
 * The unit tests in `src/lib/bill-writes.test.ts` stub Prisma, so they prove the rules and nothing
 * about the storage. Everything below is a property only a real database can answer:
 *
 *   - `pay_bill` writes a transaction carrying `bill_id`, so `findUnlinkedBillPayments` does not
 *     later report it as an integrity problem -- the exact failure that made a bill paid over MCP
 *     worse than one not logged at all
 *   - `next_due_date` actually moves on the row, and a second call against the same occurrence is
 *     refused rather than paying the month twice. A stub counting calls cannot tell a guard that
 *     fired from a guard that matched nothing
 *   - a `SKIPPED` occurrence can be corrected by `pay_existing` and cannot be by `pay`, which is
 *     the whole of #216 and depends on `settledStatusesFor` reaching a real query
 *   - a schedule that runs past its `end_date` deactivates the bill instead of looping, and an
 *     `end_date` pulled back over `update_bill` does the same rather than leaving an active bill
 *     mailing reminders for ever
 *   - `pay_existing` refuses a row of the wrong type or far from the due date, and *reports*
 *     rather than refuses a miscategorised one -- the case the candidates list deliberately hides
 *   - a date off the recurrence is refused before anything is written, and a retried snooze
 *     resolves to the deferral already in place instead of stacking a second one
 *   - a `bills:read` token cannot see any of the write tools, and a `transactions:write` token
 *     cannot either: settling an occurrence is its own authority
 *
 * It mints its own throwaway user, token, category and bills, and deletes them afterwards, so it
 * never touches yours. Needs a dev server:
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-mcp-bill-writes.ts
 */
import { PrismaClient } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mintMcpToken } from "../src/lib/mcp/tokens";

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3111";
const EMAIL = "bill-probe@scratch.invalid";

/**
 * Refuse to send a write-capable token over cleartext to anything but this machine.
 *
 * The token this script mints can settle bills, and `BASE_URL` is an environment variable, so
 * pointing it at a staging host over plain `http:` is one paste away.
 */
const requireSafeBaseUrl = (raw: string): void => {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return;
  throw new Error(
    `BASE_URL must use https outside this machine; got ${url.protocol}//${url.hostname}`
  );
};

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
};

const connect = async (token: string) => {
  const client = new Client({ name: "bill-probe", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE_URL}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
  );
  return client;
};

/** A calendar day at UTC midnight, which is how every bill date is stored. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { text?: string }[];
  };

const removeFixtures = () => prisma.user.deleteMany({ where: { email: EMAIL } });

async function main() {
  requireSafeBaseUrl(BASE_URL);
  await removeFixtures();

  const user = await prisma.user.create({
    data: {
      name: "Bill Probe",
      email: EMAIL,
      password: "x",
      // The lease is a kill switch over every write, bills included. Opened here for the run.
      mcpWritesEnabledUntil: new Date(Date.now() + 60 * 60 * 1000),
      timezoneOffset: -480,
    },
  });

  const category = await prisma.category.create({
    data: { name: "Probe Utilities", type: "EXPENSE", icon: "tag", color: "#000", userId: user.id },
  });
  const otherCategory = await prisma.category.create({
    data: { name: "Probe Groceries", type: "EXPENSE", icon: "tag", color: "#000", userId: user.id },
  });
  const incomeCategory = await prisma.category.create({
    data: { name: "Probe Salary", type: "INCOME", icon: "tag", color: "#000", userId: user.id },
  });

  const billToken = await mintMcpToken({
    userId: user.id,
    name: "probe-bills",
    scopes: ["bills:read", "bills:write", "transactions:read", "labels:read", "labels:write"],
    expiresInDays: 1,
  });
  const txToken = await mintMcpToken({
    userId: user.id,
    name: "probe-tx",
    scopes: ["transactions:read", "transactions:write"],
    expiresInDays: 1,
  });
  const readToken = await mintMcpToken({
    userId: user.id,
    name: "probe-read",
    scopes: ["bills:read", "labels:read"],
    expiresInDays: 1,
  });

  const makeBill = (over: Record<string, unknown> = {}) =>
    prisma.scheduledTransaction.create({
      data: {
        description: "Probe Meralco",
        amount: 5500,
        type: "EXPENSE",
        frequency: "MONTHLY",
        reminderDaysBefore: 3,
        startDate: day("2026-01-05"),
        nextDueDate: day("2026-09-05"),
        categoryId: category.id,
        userId: user.id,
        ...over,
      },
    });

  const client = await connect(billToken.token);

  // --- Scope gating ---

  const billTools = (await client.listTools()).tools.map((t) => t.name).sort();
  check("bills:write offers pay_bill", billTools.includes("pay_bill"), true);
  check("bills:write offers create_bill", billTools.includes("create_bill"), true);
  check("bills:write offers update_bill", billTools.includes("update_bill"), true);
  check("labels:write offers create_label", billTools.includes("create_label"), true);

  const txClient = await connect(txToken.token);
  const txTools = (await txClient.listTools()).tools.map((t) => t.name);
  // Settling an occurrence advances a schedule cursor and writes a terminal log nothing can
  // remove. A token minted to log fares must not inherit that.
  check("transactions:write cannot see pay_bill", txTools.includes("pay_bill"), false);
  check("transactions:write cannot see update_bill", txTools.includes("update_bill"), false);
  await txClient.close();

  const reader = await connect(readToken.token);
  const readTools = (await reader.listTools()).tools.map((t) => t.name);
  check("bills:read cannot see pay_bill", readTools.includes("pay_bill"), false);
  check("labels:read cannot see create_label", readTools.includes("create_label"), false);
  await reader.close();

  // --- Paying links the transaction to the bill and advances the schedule ---

  const paid = await makeBill();
  const payResult = await call(client, "pay_bill", {
    billId: paid.id,
    action: "pay",
    dueDate: "2026-09-05",
  });
  check("the payment succeeds", payResult.isError ?? false, false);
  check("it reports the next occurrence", payResult.structuredContent?.nextDueDate, "2026-10-05");

  const payment = await prisma.transaction.findFirstOrThrow({ where: { billId: paid.id } });
  // The whole point: create_transactions cannot set this, which is why a bill paid through it
  // stayed unlinked, kept its reminder, and was later reported as an integrity problem.
  check("the transaction carries bill_id", payment.billId, paid.id);
  check("it carries MCP provenance", payment.createdVia, "MCP");
  check("and names the credential", payment.mcpTokenId, billToken.record.id);
  check("the amount is the bill's own", payment.amount, 5500);

  const afterPay = await prisma.scheduledTransaction.findUniqueOrThrow({ where: { id: paid.id } });
  check(
    "next_due_date moved on the row",
    afterPay.nextDueDate.toISOString(),
    "2026-10-05T00:00:00.000Z"
  );

  // --- A second call against the same occurrence is refused, not paid twice ---

  const again = await call(client, "pay_bill", {
    billId: paid.id,
    action: "pay",
    dueDate: "2026-09-05",
  });
  check("a repeat is refused", again.isError, true);
  const paymentCount = await prisma.transaction.count({ where: { billId: paid.id } });
  check("and wrote no second payment", paymentCount, 1);

  // --- A variable bill demands the figure actually paid ---

  const variable = await makeBill({ description: "Probe Water", isVariable: true, amount: 900 });
  const noAmount = await call(client, "pay_bill", {
    billId: variable.id,
    action: "pay",
    dueDate: "2026-09-05",
  });
  check("a variable bill refuses a bare pay", noAmount.isError, true);
  check(
    "and wrote nothing",
    await prisma.transaction.count({ where: { billId: variable.id } }),
    0
  );

  await call(client, "pay_bill", {
    billId: variable.id,
    action: "pay",
    dueDate: "2026-09-05",
    amount: 1430,
  });
  const variablePayment = await prisma.transaction.findFirstOrThrow({
    where: { billId: variable.id },
  });
  // The stored 900 is a forecast fallback. Writing it would feed a guess back into every future
  // estimate, since the estimator reads the ledger as history.
  check("the caller's figure is what lands", variablePayment.amount, 1430);

  // --- A wrongly skipped month can be corrected, and only by pay_existing ---

  const skipped = await makeBill({ description: "Probe PLDT" });
  await call(client, "pay_bill", { billId: skipped.id, action: "skip", dueDate: "2026-09-05" });

  const rePay = await call(client, "pay_bill", {
    billId: skipped.id,
    action: "pay",
    dueDate: "2026-09-05",
  });
  // `pay` writes a *new* transaction, so running it against a skipped month is how a duplicate
  // payment gets written. SKIPPED stays terminal for it.
  check("`pay` will not supersede a skip", rePay.isError, true);

  // Same type, same category, a day before the due date -- inside every guard `pay_existing` now
  // applies. The refusals below use rows that break one guard each.
  const loose = await prisma.transaction.create({
    data: {
      amount: 1899,
      description: "PLDT paid at the store",
      type: "EXPENSE",
      date: new Date("2026-09-04T10:00:00.000Z"),
      categoryId: category.id,
      userId: user.id,
    },
  });
  const corrected = await call(client, "pay_bill", {
    billId: skipped.id,
    action: "pay_existing",
    dueDate: "2026-09-05",
    transactionId: loose.id,
  });
  // Skip is what people press when they have already paid and want the reminder gone (#216).
  check("`pay_existing` supersedes it", corrected.isError ?? false, false);

  const relinked = await prisma.transaction.findUniqueOrThrow({ where: { id: loose.id } });
  check("the existing payment is now linked", relinked.billId, skipped.id);

  const logs = await prisma.scheduledTransactionLog.findMany({
    where: { scheduledTransactionId: skipped.id, dueDate: day("2026-09-05") },
    select: { status: true },
  });
  // The superseded skip is removed rather than left beside the payment: the walk dedupes either
  // way, but the bill's history would otherwise list the month twice, once as each.
  check("only one terminal log remains", logs.length, 1);
  check("and it is the payment", logs[0]?.status, "PAID");

  // --- pay_existing will not link a row that cannot be this payment ---

  const guarded = await makeBill({ description: "Probe Guarded" });
  const income = await prisma.transaction.create({
    data: {
      amount: 40000,
      description: "Salary",
      type: "INCOME",
      date: new Date("2026-09-04T10:00:00.000Z"),
      categoryId: incomeCategory.id,
      userId: user.id,
    },
  });
  const wrongType = await call(client, "pay_bill", {
    billId: guarded.id,
    action: "pay_existing",
    dueDate: "2026-09-05",
    transactionId: income.id,
  });
  // Ownership alone was the whole check once, which let an income row settle an expense bill.
  check("an income row cannot settle an expense bill", wrongType.isError, true);

  const stale = await prisma.transaction.create({
    data: {
      amount: 1899,
      description: "Paid ages ago",
      type: "EXPENSE",
      date: new Date("2026-07-04T10:00:00.000Z"),
      categoryId: category.id,
      userId: user.id,
    },
  });
  const outsideWindow = await call(client, "pay_bill", {
    billId: guarded.id,
    action: "pay_existing",
    dueDate: "2026-09-05",
    transactionId: stale.id,
  });
  check("a payment two months out is refused", outsideWindow.isError, true);
  check(
    "and neither refusal claimed the row",
    (await prisma.transaction.findUniqueOrThrow({ where: { id: stale.id } })).billId,
    null,
  );

  // A miscategorised payment is linked and *reported*, never refused: the candidates list hides
  // those, so naming the id is the only way to attach one, and it is exactly the mess this action
  // exists to clean up.
  const misfiled = await prisma.transaction.create({
    data: {
      amount: 1899,
      description: "PLDT at the mall",
      type: "EXPENSE",
      date: new Date("2026-09-04T10:00:00.000Z"),
      categoryId: otherCategory.id,
      userId: user.id,
    },
  });
  const linkedAnyway = await call(client, "pay_bill", {
    billId: guarded.id,
    action: "pay_existing",
    dueDate: "2026-09-05",
    transactionId: misfiled.id,
  });
  check("a miscategorised payment still links", linkedAnyway.isError ?? false, false);
  check(
    "and the mismatch is reported",
    ((linkedAnyway.structuredContent?.warnings as string[]) ?? []).length,
    1,
  );

  // --- The date has to name a real occurrence ---

  const phantom = await makeBill({ description: "Probe Phantom" });
  const notDue = await call(client, "pay_bill", {
    billId: phantom.id,
    action: "pay",
    dueDate: "2026-09-08",
  });
  // Monthly on the 5th. A real but wrong date used to write a payment and a PAID log against a
  // month that does not exist, while the cursor stayed put and the reminder kept firing.
  check("a date off the recurrence is refused", notDue.isError, true);
  check(
    "and nothing was written",
    await prisma.transaction.count({ where: { billId: phantom.id } }),
    0,
  );

  // --- A snooze retried does not stack ---

  const resnooze = await makeBill({ description: "Probe Resnooze" });
  await call(client, "pay_bill", {
    billId: resnooze.id,
    action: "snooze",
    dueDate: "2026-09-05",
    snoozeDays: 3,
  });
  const retried = await call(client, "pay_bill", {
    billId: resnooze.id,
    action: "snooze",
    dueDate: "2026-09-05",
    snoozeDays: 3,
  });
  // `pay_bill` claims idempotentHint. Snooze had no guard, so a retry after a lost response wrote
  // a second SNOOZED row and pushed the deferral further out.
  check("a retried snooze reports a replay", retried.structuredContent?.replayed, true);
  check(
    "and wrote no second log",
    await prisma.scheduledTransactionLog.count({
      where: { scheduledTransactionId: resnooze.id, status: "SNOOZED" },
    }),
    1,
  );

  // --- A schedule that runs out switches the bill off ---

  const ending = await makeBill({
    description: "Probe Ending",
    endDate: day("2026-09-30"),
  });
  const last = await call(client, "pay_bill", {
    billId: ending.id,
    action: "pay",
    dueDate: "2026-09-05",
  });
  check("the last occurrence deactivates the bill", last.structuredContent?.deactivated, true);
  const afterLast = await prisma.scheduledTransaction.findUniqueOrThrow({
    where: { id: ending.id },
  });
  check("the row is switched off", afterLast.isActive, false);

  // --- Snoozing defers without settling ---

  const snoozed = await makeBill({ description: "Probe Snooze" });
  await call(client, "pay_bill", {
    billId: snoozed.id,
    action: "snooze",
    dueDate: "2026-09-05",
    snoozeDays: 2,
  });
  const afterSnooze = await prisma.scheduledTransaction.findUniqueOrThrow({
    where: { id: snoozed.id },
  });
  // A snooze defers the reminder. Advancing the cursor would settle an occurrence nobody paid.
  check(
    "a snooze leaves the due date alone",
    afterSnooze.nextDueDate.toISOString(),
    "2026-09-05T00:00:00.000Z"
  );

  // --- Creating and patching a bill ---

  const created = await call(client, "create_bill", {
    description: "Probe Netflix",
    amount: 549,
    type: "EXPENSE",
    categoryId: category.id,
    frequency: "MONTHLY",
    startDate: "2026-10-01",
  });
  check("the bill is created", created.isError ?? false, false);
  const newBillId = (created.structuredContent?.bill as { id?: string } | undefined)?.id;
  const newBill = await prisma.scheduledTransaction.findUniqueOrThrow({
    where: { id: String(newBillId) },
  });
  check(
    "its first occurrence is its start date",
    newBill.nextDueDate.toISOString(),
    "2026-10-01T00:00:00.000Z"
  );

  const patched = await call(client, "update_bill", { billId: newBill.id, amount: 649 });
  check("the patch succeeds", patched.isError ?? false, false);
  check("it names only what moved", patched.structuredContent?.changed, ["amount"]);
  const afterPatch = await prisma.scheduledTransaction.findUniqueOrThrow({
    where: { id: newBill.id },
  });
  check("the amount was written", afterPatch.amount, 649);
  // Everything omitted keeps its stored value. A full-replace contract would have lost these.
  check("the description survived", afterPatch.description, "Probe Netflix");
  check("the frequency survived", afterPatch.frequency, "MONTHLY");
  check(
    "and the due date did not move",
    afterPatch.nextDueDate.toISOString(),
    "2026-10-01T00:00:00.000Z"
  );

  // An end date pulled back before the cursor leaves nothing due, which has to switch the bill off
  // -- nothing downstream filters on `endDate`, so an active bill past its end mails reminders for
  // ever.
  const ended = await call(client, "update_bill", {
    billId: newBill.id,
    endDate: "2026-09-30",
  });
  check("an end date before the cursor ends the bill", ended.isError ?? false, false);
  check(
    "the row is switched off",
    (await prisma.scheduledTransaction.findUniqueOrThrow({ where: { id: newBill.id } })).isActive,
    false,
  );

  // A finite bill has to be able to become open-ended again, or setting an end date once is a
  // one-way door for any caller that cannot reach the app.
  const reopened = await call(client, "update_bill", {
    billId: newBill.id,
    endDate: null,
    isActive: true,
  });
  check("the end date can be cleared", reopened.isError ?? false, false);
  const afterReopen = await prisma.scheduledTransaction.findUniqueOrThrow({
    where: { id: newBill.id },
  });
  check("endDate is null again", afterReopen.endDate, null);
  check("and the bill is running", afterReopen.isActive, true);

  const flipped = await call(client, "update_bill", { billId: newBill.id, type: "INCOME" });
  // The effective-row check: `categoryId` is absent, so nothing about it looks wrong on its own,
  // and the bill would end up an income bill filed under a utilities category.
  check("a bare type flip is refused", flipped.isError, true);
  check(
    "and the row is untouched",
    (await prisma.scheduledTransaction.findUniqueOrThrow({ where: { id: newBill.id } })).type,
    "EXPENSE"
  );

  // --- Creating a label ---

  const label = await call(client, "create_label", { name: "Probe Trip", color: "#A8763E" });
  check("the label is created", label.isError ?? false, false);
  const duplicate = await call(client, "create_label", { name: "probe trip", color: "#111111" });
  // Names collide without case, and they must: the label resolver matches case-insensitively and
  // reports two candidates as ambiguous, so a near-twin makes both unusable.
  check("a case-only duplicate is refused", duplicate.isError, true);
  check("and created nothing", await prisma.label.count({ where: { userId: user.id } }), 1);

  await client.close();

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await removeFixtures().catch(() => {});
    await prisma.$disconnect();
  });
