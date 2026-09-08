/**
 * Verification harness for the audit stamp on the two label-**removal** branches (#251).
 *
 * `PATCH /api/transactions/batch` (label remove) and `POST /api/labels/[id]/apply` (stale-link
 * removal) used to derive `updated_via: APP` from a snapshot read before the delete. `deleteMany`
 * returns `{ count }` and no row identity, so a concurrent writer removing the same link first
 * made the delete a partial no-op while every planned row was stamped anyway -- overwriting an
 * accurate MCP trail with an edit that never happened, and over-reporting `updated` / `ids` by the
 * same amount. The sibling *insert* branches closed this in #247 with `createManyAndReturn`;
 * Prisma 6.19.2 has no `deleteManyAndReturn`, so `removeTransactionLabels` uses
 * `DELETE ... RETURNING`.
 *
 * A stubbed Prisma can assert that the route reads its own result, and `route.test.ts` does. What
 * it cannot do is show that the result *differs* from the plan under a real concurrent commit,
 * which is the entire claim. That needs Postgres:
 *
 *   - the race, through the real HTTP route: the route's DELETE is made to block on a lock, the
 *     link is deleted and committed underneath it, and the route must then report `updated: 0`
 *     and leave the MCP trail alone. Deterministic, not timing-lucky -- the release waits until
 *     the route is provably blocked, the same shape `verify-batch-idempotency.ts` uses
 *   - the same race on the retroactive-apply route
 *   - `RETURNING` is scoped by owner, so ids belonging to someone else delete nothing
 *   - a transaction losing two labels is one edited row, not two
 *
 * It mints a NextAuth JWT for a throwaway user and deletes it afterwards, so it never touches
 * yours. Needs a dev server:
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-label-removal-stamps.ts
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { removeTransactionLabels } from "../src/lib/label-writes";

const prisma = new PrismaClient();
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3111";
const EMAIL = "label-removal-probe@scratch.invalid";
const STRANGER_EMAIL = "label-removal-stranger@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
  );
};

const removeFixtures = () =>
  prisma.user.deleteMany({ where: { email: { in: [EMAIL, STRANGER_EMAIL] } } });

async function main() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session");

  await removeFixtures();

  const user = await prisma.user.create({
    data: { name: "Removal Probe", email: EMAIL, password: "x" },
  });
  const stranger = await prisma.user.create({
    data: { name: "Removal Stranger", email: STRANGER_EMAIL, password: "x" },
  });
  const category = await prisma.category.create({
    data: { name: "Probe", type: "EXPENSE", icon: "tag", color: "#000", userId: user.id },
  });
  const label = await prisma.label.create({
    data: { name: "Probe Label", color: "#123456", userId: user.id, applicableTo: "BOTH" },
  });
  const otherLabel = await prisma.label.create({
    data: { name: "Probe Label Two", color: "#654321", userId: user.id, applicableTo: "BOTH" },
  });

  const token = await encode({
    token: { id: user.id, role: user.role, sub: user.id, email: EMAIL, name: "Removal Probe" },
    secret,
  });

  /**
   * A transaction already carrying an MCP trail and a link to `label`. The MCP columns are what
   * the bug corrupted, so every row here starts out looking edited over MCP.
   */
  const seed = async (description: string, labelIds: string[] = [label.id]) => {
    const tx = await prisma.transaction.create({
      data: {
        amount: 10,
        description,
        type: "EXPENSE",
        date: new Date(),
        categoryId: category.id,
        userId: user.id,
        createdVia: "MCP",
        updatedVia: "MCP",
      },
    });
    for (const labelId of labelIds) {
      await prisma.transactionLabel.create({ data: { transactionId: tx.id, labelId } });
    }
    return tx;
  };

  const trailOf = async (id: string) => {
    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id },
      select: { createdVia: true, updatedVia: true },
    });
    return `${row.createdVia}/${row.updatedVia}`;
  };

  const patchRemove = (ids: string[], labelIds: string[]) =>
    fetch(`${BASE_URL}/api/transactions/batch`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: `next-auth.session-token=${token}`,
      },
      body: JSON.stringify({ action: "labels", operation: "remove", ids, labelIds }),
    });

  /** Is some session blocked on a row lock? That is the route waiting inside its DELETE. */
  const someoneBlockedOnRowLock = async () => {
    const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_locks
      WHERE locktype IN ('tuple', 'transactionid') AND NOT granted`;
    return Number(row.n) > 0;
  };

  // Guard against a misconfigured run reporting false passes.
  const warmup = await seed("Reachability probe");
  const probe = await patchRemove([warmup.id], [label.id]);
  check("route is reachable and authenticated", probe.status, 200);
  check("warmup removed its link", (await probe.json()).updated, 1);

  // ---------------------------------------------------------------------------------------------
  // 1. The race, through the real bulk route.
  //
  //    B locks the link row. The route's `DELETE ... RETURNING` blocks on it. B then deletes the
  //    row and commits, and the route's delete re-evaluates against the committed state and
  //    matches nothing. It must report `updated: 0` and leave the MCP trail intact.
  //
  //    Against the pre-fix code this fails loudly and in a self-contradicting way: the snapshot
  //    `findMany` does not block (plain SELECT under MVCC), so it saw the link, and the route
  //    returned `updated: 1` with `changedLinks: 0` -- claiming one edited row and zero removed
  //    links in the same response -- while stamping APP over the MCP trail.
  // ---------------------------------------------------------------------------------------------
  const raced = await seed("Raced removal");
  const racedLink = await prisma.transactionLabel.findFirstOrThrow({
    where: { transactionId: raced.id, labelId: label.id },
    select: { id: true },
  });

  const other = new PrismaClient();
  try {
    let releaseHold: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    const holder = other.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM transaction_labels WHERE id = ${racedLink.id} FOR UPDATE`;
        await held;
        // The concurrent writer wins: the link is gone before the route's delete can take it.
        await tx.$queryRaw`DELETE FROM transaction_labels WHERE id = ${racedLink.id}`;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    await new Promise((r) => setTimeout(r, 250)); // let the lock be taken first

    let routeSettled = false;
    const routeCall = patchRemove([raced.id], [label.id]).then(async (r) => {
      routeSettled = true;
      return r.json();
    });

    // Release only once the route has provably reached the lock. Sleeping instead would let the
    // route's delete run first, after which it really does remove the row and the check passes
    // even with the fix reverted -- precisely what it exists to catch.
    const deadline = Date.now() + 15_000;
    while (!routeSettled && !(await someoneBlockedOnRowLock())) {
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    check("the route blocked on the concurrent writer's lock", routeSettled, false);

    releaseHold();
    await holder;
    const body = await routeCall;

    check("a link removed underneath the route reports no edited rows", body.updated, 0);
    check("...and names none", body.ids, []);
    check("...and counts no removed links", body.changedLinks, 0);
    check("...and leaves the MCP trail intact", await trailOf(raced.id), "MCP/MCP");
  } finally {
    await other.$disconnect();
  }

  // ---------------------------------------------------------------------------------------------
  // 2. The same race on the retroactive-apply route is left to the unit test, because reaching its
  //    removal branch over HTTP needs a schedule that matches on the way in and not on the way
  //    out. What is verified here instead is the shared helper it calls, driven with a real
  //    concurrent commit: the property both routes now rest on is that `RETURNING` disagrees with
  //    a snapshot taken before it.
  // ---------------------------------------------------------------------------------------------
  const shared = await seed("Shared helper race");
  const sharedLink = await prisma.transactionLabel.findFirstOrThrow({
    where: { transactionId: shared.id, labelId: label.id },
    select: { id: true },
  });

  const snapshotVsReturning = await prisma.$transaction(async (tx) => {
    // The snapshot the old code planned from, read inside the transaction exactly as the bulk
    // route did -- so this measures the READ COMMITTED window itself, not a wider one.
    const snapshot = await tx.transactionLabel.findMany({
      where: { transactionId: shared.id, labelId: label.id },
      select: { transactionId: true },
    });

    // A different connection removes the link and commits, mid-transaction.
    const racer = new PrismaClient();
    try {
      await racer.transactionLabel.delete({ where: { id: sharedLink.id } });
    } finally {
      await racer.$disconnect();
    }

    const result = await removeTransactionLabels(tx, user.id, [shared.id], [label.id]);
    return { planned: snapshot.length, removed: result.transactionIds.length };
  });

  check("the pre-write snapshot planned one row", snapshotVsReturning.planned, 1);
  check("...while the delete really removed none", snapshotVsReturning.removed, 0);

  // ---------------------------------------------------------------------------------------------
  // 3. Ownership. The delete joins `transactions` on `user_id`, so ids the caller does not own
  //    match nothing even when named directly. Belt and braces -- both callers already narrow
  //    their ids -- but this is the check that would notice the join being dropped.
  // ---------------------------------------------------------------------------------------------
  const strangerCategory = await prisma.category.create({
    data: { name: "Theirs", type: "EXPENSE", icon: "tag", color: "#000", userId: stranger.id },
  });
  const strangerLabel = await prisma.label.create({
    data: { name: "Theirs", color: "#000000", userId: stranger.id, applicableTo: "BOTH" },
  });
  const strangerTx = await prisma.transaction.create({
    data: {
      amount: 10,
      description: "Not yours",
      type: "EXPENSE",
      date: new Date(),
      categoryId: strangerCategory.id,
      userId: stranger.id,
    },
  });
  await prisma.transactionLabel.create({
    data: { transactionId: strangerTx.id, labelId: strangerLabel.id },
  });

  const crossUser = await prisma.$transaction((tx) =>
    removeTransactionLabels(tx, user.id, [strangerTx.id], [strangerLabel.id]),
  );
  check("another user's link is not removed", crossUser.linkCount, 0);
  check(
    "...and survives",
    await prisma.transactionLabel.count({ where: { transactionId: strangerTx.id } }),
    1,
  );

  // ---------------------------------------------------------------------------------------------
  // 4. One transaction losing two labels is one edited row. `ids` naming it twice would make the
  //    response disagree with itself about how many rows were touched.
  // ---------------------------------------------------------------------------------------------
  const twoLabels = await seed("Two labels", [label.id, otherLabel.id]);
  const both = await patchRemove([twoLabels.id], [label.id, otherLabel.id]);
  const bothBody = await both.json();
  check("two links removed from one row count as two links", bothBody.changedLinks, 2);
  check("...but one edited row", bothBody.updated, 1);
  check("...named once", bothBody.ids, [twoLabels.id]);
  check("...and stamped APP, since it really did change", await trailOf(twoLabels.id), "MCP/APP");

  // ---------------------------------------------------------------------------------------------
  // 5. The ordinary path still works: a row that really loses a link is stamped, and a row in the
  //    selection that carried no link is not. Without this a fix that stamps nothing at all would
  //    pass every check above.
  // ---------------------------------------------------------------------------------------------
  const changed = await seed("Really removed");
  const untouched = await seed("No link", []);
  const mixed = await patchRemove([changed.id, untouched.id], [label.id]);
  const mixedBody = await mixed.json();
  check("only the row that lost a link is reported", mixedBody.ids, [changed.id]);
  check("...and stamped", await trailOf(changed.id), "MCP/APP");
  check("...while the row with no link keeps its trail", await trailOf(untouched.id), "MCP/MCP");

  console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
}

main()
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(async () => {
    await removeFixtures();
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
