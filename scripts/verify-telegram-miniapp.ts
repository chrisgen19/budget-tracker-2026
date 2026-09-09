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

    // --- a replay survives the tile disappearing -----------------------------------------
    // The scenario the idempotency key exists for, with the one twist that used to break it: the
    // write commits, its response is lost, and the tile is deleted before the retry. Resolving the
    // tile first would 404 a batch that is already saved, the client would read that 4xx as proof
    // nothing was written and drop its pin, and the next submission would duplicate a real
    // transaction. Needs a real database, since it turns on what is actually stored.
    const doomed = await (
      await call("/api/tg/tiles", {
        method: "POST",
        body: JSON.stringify({
          label: "Verify doomed",
          description: "fare to office",
          amount: 55,
          type: "EXPENSE",
          categoryId: category.id,
        }),
      })
    ).json();

    const doomedKey = randomUUID();
    const firstWrite = await call("/api/tg/log", {
      method: "POST",
      body: JSON.stringify({
        tileId: doomed.tile.id,
        description: "x",
        amount: 55,
        clientBatchId: doomedKey,
      }),
    });
    const doomedRow = await firstWrite.json();
    check("a tap on the doomed tile writes", firstWrite.status === 201);

    await call(`/api/tg/tiles/${doomed.tile.id}`, { method: "DELETE" });

    const afterDelete = await call("/api/tg/log", {
      method: "POST",
      body: JSON.stringify({
        tileId: doomed.tile.id,
        description: "x",
        amount: 55,
        clientBatchId: doomedKey,
      }),
    });
    const replayedRow = await afterDelete.json();
    const total = await prisma.transaction.count({ where: { userId: user.id } });

    check("a replay naming a deleted tile is not a 404", afterDelete.status === 200, String(afterDelete.status));
    check("it returns the original row", replayedRow.id === doomedRow.id);
    check("and writes no second transaction", total === 2, `${total} rows`);

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

    // --- labels: schedules, pins, and which of the two wins -------------------------------
    //
    // The half no stubbed test can reach. `createTransactionBatch` is mocked everywhere in the
    // unit tests, so what they prove is which argument it was *called* with -- and the whole
    // question here is what that argument makes the real write do. `labelIds: undefined` lets
    // auto-apply schedules run and `labelIds: [...]` is an explicit opt-out from them, a
    // distinction that exists only inside the function being stubbed.
    const scheduled = await prisma.label.create({
      data: {
        userId: user.id,
        name: `Verify Scheduled ${Date.now()}`,
        color: "#445566",
        applicableTo: "BOTH",
        // Every day, all day, so the match does not depend on when this script is run.
        schedules: { create: [{ days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59" }] },
      },
      select: { id: true, name: true },
    });

    const pinned = await prisma.label.create({
      data: {
        userId: user.id,
        name: `Verify Pinned ${Date.now()}`,
        color: "#667788",
        applicableTo: "BOTH",
      },
      select: { id: true, name: true },
    });

    const unpinnedTap = await (
      await call("/api/tg/log", {
        method: "POST",
        body: JSON.stringify({
          tileId: tile.id,
          description: "x",
          amount: 12,
          clientBatchId: randomUUID(),
        }),
      })
    ).json();
    check(
      "a button with no pins lets the label schedule run",
      unpinnedTap.labels?.includes(scheduled.name) === true,
      JSON.stringify(unpinnedTap.labels)
    );

    const pinnedTile = await (
      await call("/api/tg/tiles", {
        method: "POST",
        body: JSON.stringify({
          label: `Verify pinned tile ${Date.now()}`,
          description: "pinned fare",
          amount: 44,
          type: "EXPENSE",
          categoryId: category.id,
          labelIds: [pinned.id],
        }),
      })
    ).json();
    check("a tile can be created carrying a pinned label", pinnedTile.tile?.labels?.length === 1);

    const pinnedTap = await (
      await call("/api/tg/log", {
        method: "POST",
        body: JSON.stringify({
          tileId: pinnedTile.tile.id,
          description: "x",
          amount: 44,
          clientBatchId: randomUUID(),
        }),
      })
    ).json();
    check(
      "a pinned label is written",
      pinnedTap.labels?.includes(pinned.name) === true,
      JSON.stringify(pinnedTap.labels)
    );
    check(
      "and the schedule does NOT also run",
      pinnedTap.labels?.includes(scheduled.name) === false,
      JSON.stringify(pinnedTap.labels)
    );

    // A label narrowed after it was pinned. `createTransactionBatch` would drop it silently, so
    // the tap filters it out first -- which leaves no pins at all, and schedules run again.
    await prisma.label.update({ where: { id: pinned.id }, data: { applicableTo: "INCOME" } });

    const staleGrid = await (await call("/api/tg/tiles")).json();
    const stalePin = staleGrid.tiles.find(
      (t: { id: string }) => t.id === pinnedTile.tile.id
    )?.labels?.[0];
    check("the grid reports a pin that no longer applies", stalePin?.applies === false);

    const narrowedTap = await (
      await call("/api/tg/log", {
        method: "POST",
        body: JSON.stringify({
          tileId: pinnedTile.tile.id,
          description: "x",
          amount: 44,
          clientBatchId: randomUUID(),
        }),
      })
    ).json();
    check(
      "a narrowed pin is not written",
      narrowedTap.labels?.includes(pinned.name) === false,
      JSON.stringify(narrowedTap.labels)
    );
    check(
      "and with no pins left the schedule runs again",
      narrowedTap.labels?.includes(scheduled.name) === true,
      JSON.stringify(narrowedTap.labels)
    );

    check(
      "a pin that cannot apply is refused at the edit",
      (
        await call(`/api/tg/tiles/${pinnedTile.tile.id}`, {
          method: "PATCH",
          body: JSON.stringify({ labelIds: [pinned.id] }),
        })
      ).status === 400
    );

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

    // The whole set, since a reorder naming fewer than every tile is refused -- and by now the
    // grid holds more than the two this check is about.
    const currentIds: string[] = (await (await call("/api/tg/tiles")).json()).tiles.map(
      (t: { id: string }) => t.id
    );
    const rest = currentIds.filter((id) => id !== second.tile.id && id !== tile.id);

    const reordered = await call("/api/tg/tiles/reorder", {
      method: "POST",
      body: JSON.stringify({ ids: [second.tile.id, tile.id, ...rest] }),
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
