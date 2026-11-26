/**
 * Remove receipt photos nothing uses any more: rows no transaction references, and R2 objects
 * under `receipts/` that have no row at all.
 *
 * Every write path cleans up after itself, after its commit, so this is the backstop for the cases
 * that cannot: a cleanup whose `storage.delete` failed after the row was already deleted (the
 * object stays, with no row), a photo uploaded and then never saved onto a transaction (the form
 * uploads at submit; a submit that fails after the upload leaves a row nobody links), and photos
 * whose cleanup was skipped because R2 was not configured at the time.
 *
 * Only things older than `MIN_AGE_HOURS` (24) are touched, rows and objects alike. A photo is
 * uploaded before the transaction that will link it is saved, and an object is written before its
 * row, so anything younger may simply be mid-save.
 *
 * Rows go through `deleteUnreferencedPhotos`, the same function the routes use, so each one is
 * re-checked under its `FOR UPDATE` lock and its object deleted only after the row really went.
 *
 * Dry run by default; `--apply` deletes. Refuses a `DATABASE_URL` that is not on this machine
 * unless `--allow-remote` is passed: pruning production is a deliberate act, run by hand.
 *
 *   pnpm exec tsx --env-file=.env scripts/prune-orphan-receipt-photos.ts
 *   pnpm exec tsx --env-file=.env scripts/prune-orphan-receipt-photos.ts --apply
 *   DATABASE_URL=... R2_...=... pnpm exec tsx scripts/prune-orphan-receipt-photos.ts --allow-remote
 *
 * The object sweep needs all four `R2_*` variables; without them it is skipped and said so, and
 * `--apply` refuses, since deleting a row without its object would create the very orphan this
 * script exists to remove.
 */
import { PrismaClient } from "@prisma/client";
import { describeDatabaseUrl } from "../src/lib/database-identity";
import {
  createPhotoStorage,
  receiptPhotosEnabled,
  type PhotoStorage,
  type StoredObject,
} from "../src/lib/receipt-photo-storage";
import { deleteUnreferencedPhotos } from "../src/lib/receipt-photos";
import { isLocalDatabase } from "./db-host";

const MIN_AGE_HOURS = 24;
const PREFIX = "receipts/";
const KEY_CHUNK = 500;

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const ALLOW_REMOTE = args.has("--allow-remote");

const prisma = new PrismaClient();

/** Rows with no transaction, older than the cutoff, grouped by owner for the shared delete. */
const findOrphanRows = async (cutoff: Date) =>
  prisma.receiptPhoto.findMany({
    where: { createdAt: { lt: cutoff }, transactions: { none: {} } },
    select: { id: true, userId: true, objectKey: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

/** Objects under the prefix with no row, older than the cutoff. Looked up in chunks of keys. */
const findOrphanObjects = async (storage: PhotoStorage, cutoff: Date): Promise<StoredObject[]> => {
  const objects = (await storage.list(PREFIX)).filter((o) => o.lastModified < cutoff);
  const orphans: StoredObject[] = [];
  for (let i = 0; i < objects.length; i += KEY_CHUNK) {
    const chunk = objects.slice(i, i + KEY_CHUNK);
    const rows = await prisma.receiptPhoto.findMany({
      where: { objectKey: { in: chunk.map((o) => o.key) } },
      select: { objectKey: true },
    });
    const known = new Set(rows.map((r) => r.objectKey));
    orphans.push(...chunk.filter((o) => !known.has(o.key)));
  }
  return orphans;
};

const pruneRows = async (storage: PhotoStorage, rows: Awaited<ReturnType<typeof findOrphanRows>>) => {
  const byUser = new Map<string, string[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.id]);
  let deleted = 0;
  for (const [userId, ids] of byUser) {
    // Re-checked under the lock, so a photo linked since the scan is left alone and not counted.
    deleted += (await deleteUnreferencedPhotos({ prisma, storage }, userId, ids)).length;
  }
  return deleted;
};

const main = async () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  if (!isLocalDatabase(databaseUrl) && !ALLOW_REMOTE) {
    console.error(
      `[prune-orphan-receipt-photos] DATABASE_URL (${describeDatabaseUrl(databaseUrl)}) is not on ` +
        "this machine. Pruning a deployed database is done deliberately: re-run with --allow-remote.",
    );
    process.exitCode = 1;
    return;
  }

  const photosOn = receiptPhotosEnabled();
  if (APPLY && !photosOn) {
    console.error(
      "[prune-orphan-receipt-photos] --apply needs all four R2_* variables: deleting a row without " +
        "its object would leave exactly the orphan this script removes.",
    );
    process.exitCode = 1;
    return;
  }

  const cutoff = new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000);
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} on ${describeDatabaseUrl(databaseUrl)}`);
  console.log(`Only rows and objects older than ${cutoff.toISOString()} (${MIN_AGE_HOURS}h).\n`);

  const rows = await findOrphanRows(cutoff);
  console.log(`Unreferenced photo rows: ${rows.length}`);
  for (const row of rows) {
    console.log(`  ${row.id}  user ${row.userId}  ${row.createdAt.toISOString()}  ${row.objectKey}`);
  }

  const storage = photosOn ? createPhotoStorage() : null;
  let objects: StoredObject[] = [];
  if (storage) {
    objects = await findOrphanObjects(storage, cutoff);
    console.log(`\nObjects under ${PREFIX} with no row: ${objects.length}`);
    for (const o of objects) console.log(`  ${o.key}  ${o.lastModified.toISOString()}`);
  } else {
    console.log(`\nObjects under ${PREFIX} with no row: skipped (R2_* variables not set)`);
  }

  if (!APPLY) {
    console.log("\nNothing deleted. Re-run with --apply to delete the above.");
    return;
  }

  const deletedRows = storage ? await pruneRows(storage, rows) : 0;
  for (const o of objects) await storage!.delete(o.key);
  console.log(`\nDeleted ${deletedRows} row(s) with their objects, and ${objects.length} orphan object(s).`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
