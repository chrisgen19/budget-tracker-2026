/**
 * Drives the real `/api/tg/*` routes over HTTP against a real database.
 *
 * Unit tests stub Prisma, so they prove the rules and nothing about the storage or the gate. This
 * checks the half they cannot: that a signed `initData` actually authenticates over a real
 * request, that a tap writes a row carrying `created_via = TELEGRAM` with `mcp_token_id` NULL,
 * that a replayed `clientBatchId` returns the original and writes nothing, and that the label
 * schedules a stubbed `createTransactionBatch` can never exercise really do run.
 *
 * It creates and deletes its own throwaway user, so it never touches yours. The Telegram id it
 * links is a fixed test value well outside the range Telegram issues.
 *
 * Needs a dev server:
 *   pnpm dev -p 3111
 *   BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-telegram-miniapp.ts
 */
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3111";
const TELEGRAM_ID = "999000999";
const EMAIL = `tg-miniapp-verify-${Date.now()}@example.test`;
const STRANGER_EMAIL = `tg-miniapp-stranger-${Date.now()}@example.test`;

/**
 * Refuse to send signed init data over cleartext to anything but this machine.
 *
 * Same helper `verify-transaction-update.ts`, `verify-mcp-bill-writes.ts` and
 * `verify-label-removal-stamps.ts` all carry, and for the same reason: `BASE_URL` is an
 * environment variable, so pointing it at a staging host over plain `http:` is one paste away.
 * What travels here is a valid `initData` credential, and anything that captures one can replay it
 * against that host for the whole freshness window.
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

const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/**
 * Sign init data the way Telegram does.
 *
 * Written from the published algorithm rather than by calling `verifyInitData`, so a run proves
 * the server agrees with the spec rather than with itself.
 */
const signInitData = (botToken: string, fields: Record<string, string>): string => {
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
};

async function main() {
  requireSafeBaseUrl(BASE_URL);

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is required to sign init data");

  const allowed = (process.env.TELEGRAM_ALLOWED_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!allowed.includes(TELEGRAM_ID)) {
    throw new Error(
      `Add ${TELEGRAM_ID} to TELEGRAM_ALLOWED_IDS in .env and restart the dev server. ` +
        "The allowlist is read by the server process, not by this script."
    );
  }

  const initData = signInitData(botToken, {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAF_verify",
    user: JSON.stringify({ id: Number(TELEGRAM_ID), first_name: "Verify" }),
  });

  const call = (path: string, init: RequestInit = {}, auth = `tma ${initData}`) =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
        ...(init.headers as Record<string, string>),
      },
    });

  const category = await prisma.category.findFirstOrThrow({
    where: { isDefault: true, type: "EXPENSE", name: "Transportation" },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      name: "Mini App Verify",
      password: "x",
      telegramUserId: TELEGRAM_ID,
      timezoneOffset: -480,
    },
    select: { id: true },
  });

  // A second throwaway, purely to own the tile the ownership checks try to reach.
  //
  // This used to pick an arbitrary existing account with `findFirstOrThrow`, which broke the
  // promise three lines of docstring make: it wrote a tile into a real user's grid, left it there
  // if anything threw before the cleanup, and failed outright on a database holding no other user.
  const stranger = await prisma.user.create({
    data: { email: STRANGER_EMAIL, name: "Mini App Stranger", password: "x" },
    select: { id: true },
  });

  try {
    console.log(`[verify-telegram-miniapp] ${BASE_URL}, throwaway user ${user.id}\n`);

    // --- the gate ------------------------------------------------------------------------
    check("no initData is refused", (await call("/api/tg/bootstrap", {}, "")).status === 401);
    check(
      "a tampered signature is refused",
      (await call("/api/tg/bootstrap", {}, `tma ${initData.replace(/hash=./, "hash=0")}`)).status ===
        401
    );
    check("a Bearer credential is refused", (await call("/api/tg/bootstrap", {}, `Bearer ${initData}`)).status === 401);
    check("a real signature authenticates", (await call("/api/tg/bootstrap")).status === 200);

    // --- tiles ---------------------------------------------------------------------------
    const created = await call("/api/tg/tiles", {
      method: "POST",
      body: JSON.stringify({
        label: "Verify fare",
        description: "fare to office",
        amount: 38,
        type: "EXPENSE",
        categoryId: category.id,
      }),
    });
    const tile = (await created.json()).tile;
    check("a tile is created", created.status === 201 && !!tile?.id);
    check("its resolved category is reported", tile?.resolvedCategoryName === "Transportation");
    check("and it is not reported as falling back", tile?.fallsBack === false);

    const duplicate = await call("/api/tg/tiles", {
      method: "POST",
      body: JSON.stringify({
        label: "Verify fare",
        description: "x",
        amount: 1,
        type: "EXPENSE",
        categoryId: null,
      }),
    });
    check("a duplicate label is refused with 409", duplicate.status === 409);

    // --- the write -----------------------------------------------------------------------
    const batchId = randomUUID();
    const logged = await call("/api/tg/log", {
      method: "POST",
      body: JSON.stringify({
        tileId: tile.id,
        description: "ignored",
        amount: 9999,
        clientBatchId: batchId,
      }),
    });
    const first = await logged.json();
    check("a tap writes a row", logged.status === 201 && !!first.id);
    check("the tile's fixed amount wins over the client's", first.amount === 38, `got ${first.amount}`);
    check("the tile's description wins too", first.description === "fare to office");

    const row = await prisma.transaction.findUniqueOrThrow({
      where: { id: first.id },
      select: { createdVia: true, mcpTokenId: true, clientBatchId: true, userId: true },
    });
    check("created_via is TELEGRAM", row.createdVia === "TELEGRAM", row.createdVia);
    check("mcp_token_id is null", row.mcpTokenId === null);
    check("the batch key is stored", row.clientBatchId === batchId);
    check("the row belongs to the linked user", row.userId === user.id);

    // --- idempotency ---------------------------------------------------------------------
    const replay = await call("/api/tg/log", {
      method: "POST",
      body: JSON.stringify({
        tileId: tile.id,
        description: "ignored",
        amount: 38,
        clientBatchId: batchId,
      }),
    });
    const replayed = await replay.json();
    const count = await prisma.transaction.count({ where: { userId: user.id } });
    check("a replay returns 200, not 201", replay.status === 200, String(replay.status));
    check("it returns the original row", replayed.id === first.id);
    check("and writes nothing", count === 1, `${count} rows`);

    // --- ownership -----------------------------------------------------------------------
    const foreign = await prisma.telegramQuickTile.create({
      data: {
        userId: stranger.id,
        label: `Foreign ${Date.now()}`,
        description: "x",
        type: "EXPENSE",
        sortOrder: 10,
      },
      select: { id: true },
    });
    check(
      "another user's tile 404s on PATCH",
      (
        await call(`/api/tg/tiles/${foreign.id}`, {
          method: "PATCH",
          body: JSON.stringify({ label: "mine now" }),
        })
      ).status === 404
    );
    check(
      "another user's tile 404s on DELETE",
      (await call(`/api/tg/tiles/${foreign.id}`, { method: "DELETE" })).status === 404
    );
    const stillThere = await prisma.telegramQuickTile.findUnique({ where: { id: foreign.id } });
    check("and it is untouched", stillThere?.label.startsWith("Foreign") === true);

    // --- editing --------------------------------------------------------------------------
    // The write is conditional on the type/categoryId pair it validated, so the ordinary success
    // path runs through `updateMany` plus a re-read. A stub can assert the shape of that call; only
    // a real database shows the row actually moved and the response reflects it.
    const edited = await call(`/api/tg/tiles/${tile.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: "Verify fare renamed", amount: null }),
    });
    const editedTile = (await edited.json()).tile;
    check("an edit applies", edited.status === 200 && editedTile?.label === "Verify fare renamed");
    check("and clearing the amount makes the tile ask", editedTile?.amount === null);

    const stored = await prisma.telegramQuickTile.findUniqueOrThrow({
      where: { id: tile.id },
      select: { label: true, amount: true },
    });
    check("the row really moved", stored.label === "Verify fare renamed" && stored.amount === null);

    // --- reorder -------------------------------------------------------------------------
    const second = await (
      await call("/api/tg/tiles", {
        method: "POST",
        body: JSON.stringify({
          label: "Verify lunch",
          description: "lunch at work",
          amount: null,
          type: "EXPENSE",
          categoryId: null,
        }),
      })
    ).json();

    const reordered = await call("/api/tg/tiles/reorder", {
      method: "POST",
      body: JSON.stringify({ ids: [second.tile.id, tile.id] }),
    });
    const order = (await reordered.json()).tiles.map((t: { id: string }) => t.id);
    check("a reorder rewrites the grid order", order[0] === second.tile.id && order[1] === tile.id);

    // P2002 has to survive the move from `update` to `updateMany`, or a duplicate label would
    // surface as an unhandled 500 rather than the named 409. Checked here, after a second tile
    // exists to collide with.
    const clash = await call(`/api/tg/tiles/${tile.id}`, {
      method: "PATCH",
      body: JSON.stringify({ label: "Verify lunch" }),
    });
    check("a duplicate label is still a 409 on edit", clash.status === 409, String(clash.status));

    check(
      "a partial reorder is refused",
      (
        await call("/api/tg/tiles/reorder", {
          method: "POST",
          body: JSON.stringify({ ids: [tile.id] }),
        })
      ).status === 400
    );

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    // Cascades through tiles and transactions, so both throwaway accounts leave nothing behind --
    // including the foreign tile, whose owner is deleted here rather than by a line the failure
    // path might never reach.
    await prisma.user.deleteMany({ where: { id: { in: [user.id, stranger.id] } } });
  }
}

main()
  .catch((err) => {
    console.error("[verify-telegram-miniapp]", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
