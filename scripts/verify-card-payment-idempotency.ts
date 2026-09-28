/**
 * Verification harness for the idempotency of POST /api/credit-accounts/[id]/payments.
 *
 * A payment can commit and still have its response lost. That is indistinguishable from one that
 * never ran, and the Pay form stays open inviting another Record, which without a key lowers the
 * card's balance twice. `clientRequestId` makes the retry a replay.
 *
 * A script rather than a unit test because the guarantee under a race is the **unique index** on
 * `(user_id, client_request_id)`: a stubbed Prisma can assert the P2002 branch is written, not that
 * the database ever raises it. Check 2 forces that path deterministically. A transaction inserts a
 * payment under the key and stays open, so the route's lookup cannot see it, and the request then
 * blocks on the index until the holder commits and is refused with a unique violation. It is released
 * only once the request is provably waiting on the holder's own transaction id, not on any lock
 * anywhere, which is the filter `verify-category-lock.ts` explains the need for.
 *
 * Creates and deletes its own ADMIN user (so the credit cards switch cannot turn the run into a
 * no-op). Needs a dev server:
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://127.0.0.1:3111 pnpm exec tsx --env-file=.env scripts/verify-card-payment-idempotency.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const prisma = new PrismaClient();
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";

/** The guard every verify script that mints a session carries: no cleartext off this machine. */
const requireSafeBaseUrl = (raw: string): void => {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return;
  throw new Error(`BASE_URL must use https outside this machine; got ${url.protocol}//${url.hostname}`);
};

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

let userId: string | null = null;

async function main() {
  requireSafeBaseUrl(BASE);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to mint a session");

  const user = await prisma.user.create({
    data: { email: `cpi-${Date.now()}@test.local`, name: "Card Payment Probe", password: "x", role: "ADMIN", timezoneOffset: -480 },
  });
  userId = user.id;
  const card = await prisma.creditAccount.create({
    data: { userId: user.id, name: "Probe card", openingBalance: 10_000, openingBalanceDate: new Date("2026-01-01T00:00:00Z") },
  });
  const token = await encode({
    token: { id: user.id, role: user.role, name: user.name, email: user.email, sub: user.id },
    secret,
  });

  const payment = { kind: "PAYMENT", amount: 1_000, description: "Probe", date: "2026-09-14" };
  const post = (body: Record<string, unknown>) =>
    fetch(`${BASE}/api/credit-accounts/${card.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `next-auth.session-token=${token}` },
      body: JSON.stringify(body),
    });
  const rows = () => prisma.creditPayment.count({ where: { userId: user.id } });
  const balance = async () => {
    const res = await fetch(`${BASE}/api/credit-accounts/${card.id}`, {
      headers: { cookie: `next-auth.session-token=${token}` },
    });
    return ((await res.json()) as { account: { balance: number } }).account.balance;
  };
  const reset = () => prisma.creditPayment.deleteMany({ where: { userId: user.id } });

  // 0. Guard against a misconfigured run reporting false passes.
  const probe = await post({ ...payment, clientRequestId: randomUUID() });
  check("route is reachable and authenticated", probe.status === 201, `status ${probe.status}`);
  await reset();

  // 1. Sequential retry under one key: the shape of "committed, response lost".
  const key = randomUUID();
  const first = await post({ ...payment, clientRequestId: key });
  const second = await post({ ...payment, clientRequestId: key });
  const [a, b] = (await Promise.all([first.json(), second.json()])) as { id: string }[];
  check("first attempt creates", first.status === 201, `status ${first.status}`);
  check("retry replays instead of creating", second.status === 200, `status ${second.status}`);
  check("replay answers with the original payment", a.id === b.id);
  check("one row after the retry", (await rows()) === 1);
  check("balance lowered once", (await balance()) === 9_000, `balance ${await balance()}`);

  // 2. The race the lookup cannot see: an uncommitted insert under the key.
  const raceKey = randomUUID();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let published!: (value: { id: string; xid: string }) => void;
  const holding = new Promise<{ id: string; xid: string }>((resolve) => (published = resolve));

  const holder = prisma.$transaction(
    async (tx) => {
      const row = await tx.creditPayment.create({
        data: { ...payment, kind: "PAYMENT", date: new Date("2026-09-13T16:00:00Z"), accountId: card.id, userId: user.id, clientRequestId: raceKey },
      });
      const [{ xid }] = await tx.$queryRaw<{ xid: string }[]>`SELECT pg_current_xact_id()::text AS xid`;
      published({ id: row.id, xid });
      await held;
    },
    { maxWait: 10_000, timeout: 60_000 }
  );
  const holderRow = await holding;

  let settled = false;
  const racing = post({ ...payment, clientRequestId: raceKey }).then((res) => {
    settled = true;
    return res;
  });

  /** Is some backend waiting on the holder's own transaction? That is the request, on the index. */
  const blockedOnHolder = async () => {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_locks
      WHERE locktype = 'transactionid' AND NOT granted AND transactionid::text = ${holderRow.xid}`;
    return Number(row.n) > 0;
  };
  const deadline = Date.now() + 15_000;
  let blocked = false;
  while (!settled && !(blocked = await blockedOnHolder()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  check("the racing request reached the unique index", blocked, settled ? "it answered first" : "");

  release();
  await holder;
  const raced = await racing;
  const racedBody = (await raced.json()) as { id?: string };
  check("a request losing the race is answered as a replay", raced.status === 200, `status ${raced.status}`);
  check("with the payment that won it", racedBody.id === holderRow.id);
  check("still one row under that key", (await prisma.creditPayment.count({ where: { clientRequestId: raceKey } })) === 1);
  await reset();

  // 3. Without a key nothing is deduped: two identical payments on one day are a real thing.
  await post(payment);
  await post(payment);
  check("keyless payments both record", (await rows()) === 2);
  await reset();

  // 4. A replay is answered before anything else is judged, the card's state included.
  const archivedKey = randomUUID();
  await post({ ...payment, clientRequestId: archivedKey });
  await prisma.creditAccount.update({ where: { id: card.id }, data: { isActive: false } });
  const afterArchive = await post({ ...payment, clientRequestId: archivedKey });
  check("replay survives the card being archived since", afterArchive.status === 200, `status ${afterArchive.status}`);
  const freshOnArchived = await post({ ...payment, clientRequestId: randomUUID() });
  check("a new payment on the archived card is still refused", freshOnArchived.status === 409, `status ${freshOnArchived.status}`);
  check("one row after both", (await rows()) === 1);
  await prisma.creditAccount.update({ where: { id: card.id }, data: { isActive: true } });
  await reset();

  // 5. A malformed key is refused rather than stored or silently ignored.
  const malformed = await post({ ...payment, clientRequestId: "not-a-uuid" });
  check("malformed key is refused", malformed.status === 400, `status ${malformed.status}`);
  check("and created nothing", (await rows()) === 0);
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    if (userId) {
      // Payments first: their foreign key to the card is RESTRICT.
      await prisma.creditPayment.deleteMany({ where: { userId } });
      await prisma.creditAccount.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  });
