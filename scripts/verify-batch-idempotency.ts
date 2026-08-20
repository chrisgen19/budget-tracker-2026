/**
 * Verification harness for the idempotency of POST /api/transactions/batch.
 *
 * A batch can commit and still have its response lost (a dropped mobile connection, a proxy
 * timeout). That is indistinguishable from a batch that never ran, and the multi-scan review
 * modal invites the user to retry — which without a key posts every receipt a second time
 * and corrupts their totals. `clientBatchId` makes the retry a replay.
 *
 * This drives the real HTTP route rather than a copy of its logic, because the guarantee
 * depends on Postgres advisory locks and transaction isolation that jsdom cannot provide.
 * It mints a NextAuth JWT for a throwaway user, which it deletes afterwards.
 *
 * Needs a dev server running. Point BASE_URL at it:
 *
 *   pnpm dev
 *   BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-batch-idempotency.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3111";
const EMAIL = "batch-probe@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
  );
};

async function main() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session");

  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { name: "Batch Probe", email: EMAIL, password: "x" },
  });
  const category = await prisma.category.create({
    data: { name: "Probe", type: "EXPENSE", icon: "tag", color: "#000", userId: user.id },
  });

  const token = await encode({
    token: { id: user.id, role: user.role, sub: user.id, email: EMAIL, name: "Batch Probe" },
    secret,
  });

  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      amount: 10 + i,
      description: `Probe ${i}`,
      type: "EXPENSE" as const,
      date: new Date().toISOString(),
      categoryId: category.id,
      labelIds: [] as string[],
    }));

  const post = (transactions: ReturnType<typeof rows>, clientBatchId?: string) =>
    fetch(`${BASE_URL}/api/transactions/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `next-auth.session-token=${token}`,
      },
      body: JSON.stringify({ transactions, clientBatchId }),
    });

  const countRows = () => prisma.transaction.count({ where: { userId: user.id } });
  const reset = () => prisma.transaction.deleteMany({ where: { userId: user.id } });

  // Guard against a misconfigured run reporting false passes.
  const probe = await post(rows(1), randomUUID());
  check("route is reachable and authenticated", probe.status, 201);
  await reset();

  // 1. Sequential retry with the same key — the shape of "committed, response lost".
  const key = randomUUID();
  const first = await post(rows(3), key);
  const second = await post(rows(3), key);
  check("first submit creates", first.status, 201);
  check("retry replays instead of creating", second.status, 200);
  check("rows after retry", await countRows(), 3);
  const replayed = (await second.json()) as { transactions: unknown[] };
  check("replay returns the original rows", replayed.transactions.length, 3);
  await reset();

  // 2. Concurrent double submit — a double click, or a client retrying under the covers.
  const raceKey = randomUUID();
  const responses = await Promise.all([
    post(rows(2), raceKey),
    post(rows(2), raceKey),
    post(rows(2), raceKey),
  ]);
  check("concurrent submits all succeed", responses.every((r) => r.ok), true);
  check("exactly one concurrent submit created", responses.filter((r) => r.status === 201).length, 1);
  check("rows after concurrent burst", await countRows(), 2);
  await reset();

  // 3. A different key is a different intent and must still create.
  await post(rows(2), randomUUID());
  await post(rows(2), randomUUID());
  check("distinct keys create separately", await countRows(), 4);
  await reset();

  // 4. Without a key the route behaves exactly as it did before.
  await post(rows(2));
  await post(rows(2));
  check("keyless submits are unchanged (not deduped)", await countRows(), 4);
  await reset();

  // 5. A replay must not be judged on inputs it will never use. If a label from the
  //    original batch is deleted before the retry lands, validating it first returns 400 —
  //    and a 400 tells the client nothing was written, which would let a corrected
  //    resubmit duplicate an already-committed batch.
  const label = await prisma.label.create({
    data: { name: "Probe label", color: "#000", userId: user.id },
  });
  const labelledKey = randomUUID();
  const labelledRows = rows(2).map((r) => ({ ...r, labelIds: [label.id] }));

  const withLabel = await post(labelledRows, labelledKey);
  check("labelled batch creates", withLabel.status, 201);

  await prisma.transactionLabel.deleteMany({ where: { labelId: label.id } });
  await prisma.label.delete({ where: { id: label.id } });

  const replayAfterLabelGone = await post(labelledRows, labelledKey);
  check("replay survives a label deleted since", replayAfterLabelGone.status, 200);
  check("rows after that replay", await countRows(), 2);
  await reset();

  // A first attempt with a bad label is still rejected — nothing exists to replay.
  const badLabelFirst = await post(
    rows(1).map((r) => ({ ...r, labelIds: [randomUUID()] })),
    randomUUID(),
  );
  check("unknown label on a first attempt is rejected", badLabelFirst.status, 400);
  check("rejected first attempt created nothing", await countRows(), 0);

  // 6. A malformed key is rejected rather than silently treated as keyless.
  const bad = await post(rows(1), "not-a-uuid");
  check("malformed key is rejected", bad.status, 400);
  check("malformed key created nothing", await countRows(), 0);
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  });
