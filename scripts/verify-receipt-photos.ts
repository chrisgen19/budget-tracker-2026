/**
 * End-to-end proof of receipt photos against a real dev bucket, a real database and the real
 * routes, plus a real-Postgres proof of the cleanup lock.
 *
 * What a stubbed test cannot show, and this does:
 *
 * - **Metadata really is stripped.** Uploads a JPEG carrying GPS EXIF, reads it back through
 *   `GET /api/receipt-photos/[id]`, and asserts the served bytes carry no EXIF at all. The unit
 *   test proves `normaliseReceiptPhoto` omits `withMetadata`; only this proves what reaches R2.
 * - **The lifecycle leaves nothing behind.** Upload, replay the same key, create a transaction on
 *   the photo, replace it, remove it, delete a transaction that had one, and then list the bucket
 *   under the user's prefix and assert it is empty. Each cleanup path deletes the row first and the
 *   object after; a regression in any of them leaves an object only a listing can see.
 * - **The cleanup lock holds under a real concurrent writer.** One connection inserts a
 *   transaction on photo P and does **not** commit; another runs `deleteUnreferencedPhotos` on P.
 *   The second must wait, then see the new link and delete nothing. Without the `FOR UPDATE` taken
 *   as its own statement, the guarded `DELETE` waits on the foreign key's `FOR KEY SHARE`, then
 *   goes ahead on its stale `NOT EXISTS` and the `SET NULL` wipes the link that just committed.
 *   The wait is detected through `pg_blocking_pids` on the writer's **own** backend, never a
 *   cluster-wide `pg_locks` scan, which answers true for any waiter anywhere (see
 *   `verify-category-lock.ts`). It needs no R2: the survive case never reaches storage, so it runs
 *   on its own with `LOCK_ONLY=1`.
 *
 * Creates and deletes its own throwaway user. Refuses to run without all four `R2_*` variables
 * (there is nothing to verify without a bucket), against a non-local `DATABASE_URL`, or with a
 * session cookie over cleartext to anything but this machine.
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-receipt-photos.ts
 *   LOCK_ONLY=1 pnpm exec tsx --env-file=.env scripts/verify-receipt-photos.ts
 *
 * Point `R2_BUCKET` at a dev bucket: the final listing reads the throwaway user's prefix only, but
 * a production bucket has no business receiving test uploads.
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import sharp from "sharp";
import {
  createPhotoStorage,
  PhotoNotFoundError,
  receiptPhotosEnabled,
  type PhotoStorage,
} from "../src/lib/receipt-photo-storage";
import { deleteUnreferencedPhotos } from "../src/lib/receipt-photos";
import { isLocalDatabase } from "./db-host";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3111";
const LOCK_ONLY = process.env.LOCK_ONLY === "1";
const EMAIL = "receipt-photo-probe@scratch.invalid";

const prisma = new PrismaClient();
/** A second client, so the lock check really is two connections. */
const other = new PrismaClient();
/** Observes lock waits only, so polling never competes for either side's pool. */
const observer = new PrismaClient();

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Same guard as the other `BASE_URL` scripts: a NextAuth session is the whole account. */
const requireSafeBaseUrl = (raw: string): void => {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return;
  throw new Error(`BASE_URL must use https outside this machine; got ${url.protocol}//${url.hostname}`);
};

/** Every refusal, before any fixture is written. Returns the reason, or null to proceed. */
const preflight = (): string | null => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) return "DATABASE_URL is not set.";
  if (!isLocalDatabase(databaseUrl)) {
    return "DATABASE_URL is not on this machine. This script writes a throwaway user; run it locally.";
  }
  if (LOCK_ONLY) return null;
  if (!receiptPhotosEnabled()) {
    const missing = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].filter(
      (name) => !process.env[name]?.trim(),
    );
    return (
      `receipt photos are not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
      "missing or blank.\n  Set all four to a DEV bucket's credentials in .env (and restart the dev " +
      "server so it reads them),\n  or run only the database lock check with LOCK_ONLY=1."
    );
  }
  if (!process.env.NEXTAUTH_SECRET) return "NEXTAUTH_SECRET is required to mint a session.";
  requireSafeBaseUrl(BASE_URL);
  return null;
};

const TX = { maxWait: 10_000, timeout: 20_000 };

/** Whether any backend is waiting on a lock held by `pid`, and only `pid`. */
const blocksSomebody = async (pid: number | null): Promise<boolean> => {
  if (pid === null) return false;
  const [{ count }] = await observer.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
  `;
  return Number(count) > 0;
};

/**
 * Waits until `pid` is blocking someone, or `settled` says the other side finished without, and
 * says which. A timeout is reported rather than swallowed: returning quietly let the writer
 * commit before the cleaner had even started, after which the cleaner reads the committed link,
 * deletes nothing, and every later assertion passes with or without the lock under test.
 */
const waitForWaiter = async (
  pid: number,
  settled: () => boolean,
  timeoutMs = 3_000,
): Promise<"blocked" | "settled" | "timeout"> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (settled()) return "settled";
    if (await blocksSomebody(pid)) return "blocked";
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return "timeout";
};

/** A storage double for the lock check. The survive case must never reach it. */
const recordingStorage = (): PhotoStorage & { deleted: string[] } => {
  const deleted: string[] = [];
  return {
    deleted,
    put: async () => {},
    get: async () => new Response(null, { status: 404 }),
    delete: async (key) => void deleted.push(key),
    list: async () => [],
  };
};

const makePhotoRow = (userId: string, tag: string) => {
  const id = crypto.randomUUID();
  return prisma.receiptPhoto.create({
    data: {
      id,
      userId,
      objectKey: `receipts/${userId}/${id}.jpg`,
      contentType: "image/jpeg",
      byteSize: 1,
      width: 1,
      height: 1,
      photoKey: `lock-${tag}`,
    },
  });
};

async function lockCheck(userId: string, categoryId: string) {
  // Control first: with no concurrent writer the same call deletes the photo. Without this the
  // survive assertion below could pass simply because the function never deletes anything.
  const lonely = await makePhotoRow(userId, "control");
  const controlStorage = recordingStorage();
  const controlDeleted = await deleteUnreferencedPhotos(
    { prisma, storage: controlStorage },
    userId,
    [lonely.id],
  );
  check("control: an unreferenced photo is deleted", controlDeleted.includes(lonely.id));
  check("control: its object is deleted after the row", controlStorage.deleted.includes(lonely.objectKey));

  const photo = await makePhotoRow(userId, "race");
  const storage = recordingStorage();
  let writerPid: number | null = null;
  let cleanerSettled = false;
  let cleanerResult: string[] | null = null;
  let txId: string | null = null;

  const writer = prisma.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    writerPid = Number(pid);
    // Takes FOR KEY SHARE on the photo through the foreign key, held until this commits.
    const created = await tx.transaction.create({
      data: {
        amount: 10,
        description: "Photo lock probe",
        type: "EXPENSE",
        date: new Date(),
        categoryId,
        userId,
        receiptPhotoId: photo.id,
      },
    });
    txId = created.id;
    const cleaner = deleteUnreferencedPhotos({ prisma: other, storage }, userId, [photo.id])
      .then((ids) => {
        cleanerResult = ids;
      })
      .finally(() => {
        cleanerSettled = true;
      });
    const waited = await waitForWaiter(writerPid, () => cleanerSettled);
    check("the cleanup waited on the uncommitted writer", waited === "blocked", waited);
    if (waited === "timeout") {
      // Never commit without having seen the wait: the rest of this case would then pass on
      // ordering alone and prove nothing. Rolling back ends it here, failed.
      throw new Error("the cleaner never reached the writer's lock within the deadline");
    }
    // Wrapped, not returned bare: Prisma awaits a returned promise before committing, and the
    // cleaner is waiting on exactly that commit.
    return { cleaner };
  }, TX);

  const { cleaner } = await writer;
  await cleaner;

  const row = await prisma.receiptPhoto.findUnique({ where: { id: photo.id } });
  const link = txId
    ? await prisma.transaction.findUnique({ where: { id: txId }, select: { receiptPhotoId: true } })
    : null;
  check("the photo row survived the cleanup", row !== null);
  check("the committed link survived", link?.receiptPhotoId === photo.id, `got ${link?.receiptPhotoId}`);
  check("the cleanup reported nothing deleted", JSON.stringify(cleanerResult) === "[]");
  check("the cleanup never touched storage", storage.deleted.length === 0);
}

/** A JPEG carrying GPS EXIF, and a marker string so its presence is checkable byte for byte. */
const gpsJpeg = async (colour: string) => {
  const bytes = await sharp({ create: { width: 120, height: 90, channels: 3, background: colour } })
    .jpeg()
    .withExif({
      IFD0: { Make: "ProbeCam" },
      IFD3: { GPSLatitudeRef: "N", GPSMapDatum: "WGS-84" },
    })
    .toBuffer();
  const meta = await sharp(bytes).metadata();
  if (!meta.exif?.includes("WGS-84")) throw new Error("fixture lost its GPS EXIF before upload");
  return bytes;
};

async function routeChecks(userId: string, categoryId: string, storage: PhotoStorage) {
  const { role } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
  const token = await encode({
    token: { id: userId, sub: userId, email: EMAIL, name: "Photo Probe", role },
    secret: process.env.NEXTAUTH_SECRET!,
  });
  const cookie = `next-auth.session-token=${token}`;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${BASE_URL}${path}`, { ...init, headers: { ...init.headers, cookie } });
  const upload = async (bytes: Buffer, photoKey: string) => {
    const form = new FormData();
    form.set("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "receipt.jpg");
    form.set("photoKey", photoKey);
    const res = await call("/api/receipt-photos", { method: "POST", body: form });
    const body = (await res.json()) as { photo?: { id: string }; error?: string };
    return { status: res.status, id: body.photo?.id ?? "", error: body.error ?? "" };
  };
  /**
   * An upload a later step depends on. A failed one is reported as itself and ends the run:
   * carrying on with an empty id made a storage hiccup read as a broken replace (the edit then
   * sent `receiptPhotoId: ""`, which validation refuses), which is a wrong diagnosis.
   */
  const uploadFor = async (step: string, bytes: Buffer) => {
    const result = await upload(bytes, crypto.randomUUID());
    const ok = result.status === 201 && result.id !== "";
    check(`upload for ${step} answers 201`, ok, `got ${result.status} ${result.error}`.trim());
    if (!ok) {
      throw new Error(
        `upload for ${step} failed (${result.status}); the dev server's log has R2's reason. ` +
          "The checks after it would only repeat that failure, so the run stops here.",
      );
    }
    return result;
  };
  const json = (body: unknown) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const gone = async (photoId: string) => {
    const row = await prisma.receiptPhoto.findUnique({ where: { id: photoId } });
    let object = true;
    try {
      await storage.get(`receipts/${userId}/${photoId}.jpg`);
    } catch (error) {
      object = !(error instanceof PhotoNotFoundError);
    }
    return row === null && !object;
  };

  const key1 = crypto.randomUUID();
  const first = await upload(await gpsJpeg("#c96"), key1);
  check("upload answers 201", first.status === 201, `got ${first.status} ${first.error}`.trim());
  if (first.status !== 201) {
    throw new Error(`the first upload failed (${first.status}); every check after it needs that photo.`);
  }
  const replay = await upload(await gpsJpeg("#c96"), key1);
  check("replaying the photoKey answers 200 with the same photo", replay.status === 200 && replay.id === first.id);

  const served = await call(`/api/receipt-photos/${first.id}`);
  check("served with Cache-Control private, no-store", served.headers.get("cache-control") === "private, no-store");
  const servedBytes = Buffer.from(await served.arrayBuffer());
  const servedMeta = await sharp(servedBytes).metadata();
  check("served photo is a JPEG", servedMeta.format === "jpeg");
  check("served photo carries no EXIF, so no GPS", servedMeta.exif === undefined);
  check("no GPS marker anywhere in the served bytes", !servedBytes.includes("WGS-84"));

  const base = { amount: 42, description: "Photo probe", type: "EXPENSE", date: new Date().toISOString(), categoryId };
  const created = await call("/api/transactions", { method: "POST", ...json({ ...base, receiptPhotoId: first.id }) });
  const txId = ((await created.json()) as { id?: string }).id ?? "";
  const linked = await prisma.transaction.findUnique({ where: { id: txId }, select: { receiptPhotoId: true } });
  check("a transaction created with the photo is linked to it", linked?.receiptPhotoId === first.id);

  const second = await uploadFor("the replace", await gpsJpeg("#69c"));
  await call(`/api/transactions/${txId}`, { method: "PUT", ...json({ ...base, receiptPhotoId: second.id }) });
  const replaced = await prisma.transaction.findUnique({ where: { id: txId }, select: { receiptPhotoId: true } });
  check("replace links the new photo", replaced?.receiptPhotoId === second.id);
  check("replace deletes the old photo's row and object", await gone(first.id));

  await call(`/api/transactions/${txId}`, { method: "PUT", ...json({ ...base, receiptPhotoId: null }) });
  check("remove deletes the now unreferenced photo", await gone(second.id));

  const third = await uploadFor("the delete", await gpsJpeg("#9c6"));
  const doomed = await call("/api/transactions", { method: "POST", ...json({ ...base, receiptPhotoId: third.id }) });
  const doomedId = ((await doomed.json()) as { id?: string }).id ?? "";
  await call(`/api/transactions/${doomedId}`, { method: "DELETE" });
  check("deleting the transaction deletes its photo", await gone(third.id));

  const left = await storage.list(`receipts/${userId}/`);
  check("the bucket holds nothing for this user", left.length === 0, left.map((o) => o.key).join(", "));
}

async function main() {
  const refusal = preflight();
  if (refusal) {
    console.error(`[verify-receipt-photos] refusing to run: ${refusal}`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Photo Probe", password: "x" } });
  const category = await prisma.category.create({
    data: { name: "Photo Probe", type: "EXPENSE", icon: "Receipt", color: "#111", userId: user.id },
  });
  const storage = LOCK_ONLY ? null : createPhotoStorage();
  console.log(`[verify-receipt-photos] throwaway user ${user.id}${LOCK_ONLY ? " (lock check only)" : ` against ${BASE_URL}`}\n`);

  try {
    await lockCheck(user.id, category.id);
    if (storage) await routeChecks(user.id, category.id, storage);
  } finally {
    if (storage) {
      for (const object of await storage.list(`receipts/${user.id}/`)) await storage.delete(object.key);
    }
    await prisma.user.delete({ where: { id: user.id } });
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([prisma.$disconnect(), other.$disconnect(), observer.$disconnect()]);
  });
