import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receipt-photo-image", () => ({
  normaliseReceiptPhoto: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), width: 10, height: 20 })),
}));

const storageMocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  create: vi.fn(),
}));

vi.mock("@/lib/receipt-photo-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-photo-storage")>()),
  receiptPhotosEnabled: storageMocks.enabled,
  createPhotoStorage: storageMocks.create,
}));

import { Prisma } from "@prisma/client";
import {
  applyPhotoChange,
  cleanUpReceiptPhotos,
  deleteUnreferencedPhotos,
  getReceiptPhotoInfo,
  photosAreOwned,
  ReceiptPhotoNotOwnedError,
  storeReceiptPhoto,
} from "@/lib/receipt-photos";

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  width: 10,
  height: 20,
  byteSize: 3,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const makeStorage = () => ({
  put: vi.fn(async (..._args: unknown[]) => {}),
  get: vi.fn(),
  delete: vi.fn(async (..._args: unknown[]) => {}),
  list: vi.fn(async () => []),
});

describe("storeReceiptPhoto", () => {
  it("normalises, puts then creates the row", async () => {
    const order: string[] = [];
    const storage = makeStorage();
    storage.put.mockImplementation(async () => void order.push("put"));
    const prisma = {
      receiptPhoto: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { id: string } }) => {
          order.push("create");
          return row({ id: data.id });
        }),
      },
    };
    const result = await storeReceiptPhoto(
      { prisma: prisma as never, storage },
      { userId: "u1", photoKey: "k1", bytes: new Uint8Array([9]) },
    );
    expect(result.replayed).toBe(false);
    const id = result.photo.id;
    expect(storage.put).toHaveBeenCalledWith(`receipts/u1/${id}.jpg`, expect.any(Uint8Array), "image/jpeg");
    expect(prisma.receiptPhoto.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id,
        userId: "u1",
        photoKey: "k1",
        objectKey: `receipts/u1/${id}.jpg`,
        contentType: "image/jpeg",
        byteSize: 3,
        width: 10,
        height: 20,
      }),
    });
    expect(order).toEqual(["put", "create"]);
  });

  it("replays an existing photoKey without calling put", async () => {
    const storage = makeStorage();
    const prisma = { receiptPhoto: { findUnique: vi.fn(async () => row()), create: vi.fn() } };
    const result = await storeReceiptPhoto(
      { prisma: prisma as never, storage },
      { userId: "u1", photoKey: "k1", bytes: new Uint8Array([9]) },
    );
    expect(result.replayed).toBe(true);
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.receiptPhoto.findUnique).toHaveBeenCalledWith({
      where: { userId_photoKey: { userId: "u1", photoKey: "k1" } },
    });
  });

  it("deletes the object and rethrows when Postgres refuses the insert", async () => {
    const storage = makeStorage();
    const boom = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" });
    const prisma = {
      receiptPhoto: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw boom;
        }),
      },
    };
    await expect(
      storeReceiptPhoto(
        { prisma: prisma as never, storage },
        { userId: "u1", photoKey: "k1", bytes: new Uint8Array([9]) },
      ),
    ).rejects.toBe(boom);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete.mock.calls[0][0]).toMatch(/^receipts\/u1\/.+\.jpg$/);
  });

  // A connection lost after the commit reports an error for a row that exists. Deleting the
  // object then would leave that row, and every replay of its key, pointing at nothing.
  it("keeps the object when the insert outcome is unknown, and rethrows", async () => {
    const storage = makeStorage();
    const lost = new Error("Connection terminated unexpectedly");
    const prisma = {
      receiptPhoto: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw lost;
        }),
      },
    };
    await expect(
      storeReceiptPhoto(
        { prisma: prisma as never, storage },
        { userId: "u1", photoKey: "k1", bytes: new Uint8Array([9]) },
      ),
    ).rejects.toBe(lost);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("on a P2002 race deletes its object and returns the winner as a replay", async () => {
    const storage = makeStorage();
    const err = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row({ id: "winner" }));
    const prisma = {
      receiptPhoto: {
        findUnique,
        create: vi.fn(async () => {
          throw err;
        }),
      },
    };
    const result = await storeReceiptPhoto(
      { prisma: prisma as never, storage },
      { userId: "u1", photoKey: "k1", bytes: new Uint8Array([9]) },
    );
    expect(result).toEqual({ photo: expect.objectContaining({ id: "winner" }), replayed: true });
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});

/**
 * A client for `deleteUnreferencedPhotos`: the reference read on the client, then per photo a
 * transaction holding the row lock and the conditional delete. `order` records what ran, with
 * the transaction's edges, so the lock can be shown to precede the delete inside it.
 */
const makeCleanupPrisma = (
  photos: { id: string; objectKey: string; _count: { transactions: number } }[],
  { deleteCount = 1, lockedIds }: { deleteCount?: number; lockedIds?: string[] } = {},
) => {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const [id] = values as [string];
      order.push(`lock:${id}`);
      void sql;
      return (lockedIds ?? photos.map((p) => p.id)).includes(id) ? [{ id }] : [];
    }),
    receiptPhoto: {
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        order.push(`row:${where.id}`);
        return { count: deleteCount };
      }),
    },
  };
  const prisma = {
    receiptPhoto: { findMany: vi.fn(async () => photos) },
    $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => {
      order.push("tx:open");
      const result = await run(tx);
      order.push("tx:commit");
      return result;
    }),
  };
  return { prisma, tx, order };
};

describe("deleteUnreferencedPhotos", () => {
  const photos = [
    { id: "p1", objectKey: "k/p1", _count: { transactions: 1 } },
    { id: "p2", objectKey: "k/p2", _count: { transactions: 0 } },
  ];

  it("deletes only unreferenced photos, row before object, guarded by owner and no links", async () => {
    const storage = makeStorage();
    const { prisma, tx, order } = makeCleanupPrisma(photos);
    storage.delete.mockImplementation(async () => void order.push("object"));
    const deleted = await deleteUnreferencedPhotos({ prisma: prisma as never, storage }, "u1", ["p1", "p2"]);
    expect(deleted).toEqual(["p2"]);
    expect(tx.receiptPhoto.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.receiptPhoto.deleteMany).toHaveBeenCalledWith({
      where: { id: "p2", userId: "u1", transactions: { none: {} } },
    });
    expect(storage.delete).toHaveBeenCalledWith("k/p2");
    expect(order).toEqual(["tx:open", "lock:p2", "row:p2", "tx:commit", "object"]);
  });

  /**
   * The lock is a separate statement before the delete, inside one transaction per photo. A single
   * conditional DELETE that waits on a writer's FOR KEY SHARE resumes without re-checking its
   * NOT EXISTS, and the SET NULL then wipes the link that writer just committed.
   */
  it("takes FOR UPDATE on the photo row, scoped to the owner, before each delete", async () => {
    const storage = makeStorage();
    const both = photos.map((p) => ({ ...p, _count: { transactions: 0 } }));
    const { prisma, tx, order } = makeCleanupPrisma(both);
    await deleteUnreferencedPhotos({ prisma: prisma as never, storage }, "u1", ["p1", "p2"]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(order.filter((o) => o !== "object")).toEqual([
      "tx:open", "lock:p1", "row:p1", "tx:commit",
      "tx:open", "lock:p2", "row:p2", "tx:commit",
    ]);
    const sql = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain("FROM receipt_photos");
    expect(sql).toContain("user_id");
    expect(sql).toMatch(/FOR UPDATE\s*$/);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["p1", "u1"]);
  });

  it("skips the delete and the object when the photo row is already gone", async () => {
    const storage = makeStorage();
    const { prisma, tx } = makeCleanupPrisma(photos, { lockedIds: [] });
    const deleted = await deleteUnreferencedPhotos({ prisma: prisma as never, storage }, "u1", ["p2"]);
    expect(deleted).toEqual([]);
    expect(tx.receiptPhoto.deleteMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("keeps the object and omits the id when the photo was relinked concurrently", async () => {
    const storage = makeStorage();
    const { prisma } = makeCleanupPrisma(photos, { deleteCount: 0 });
    const deleted = await deleteUnreferencedPhotos({ prisma: prisma as never, storage }, "u1", ["p1", "p2"]);
    expect(deleted).toEqual([]);
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe("getReceiptPhotoInfo", () => {
  it("returns null for another user's photo", async () => {
    const prisma = { receiptPhoto: { findFirst: vi.fn(async () => null) }, user: { findUnique: vi.fn() } };
    expect(await getReceiptPhotoInfo(prisma as never, "u1", "p1")).toBeNull();
    expect(prisma.receiptPhoto.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", userId: "u1" } }),
    );
  });

  it("sums linked amounts and formats local dates", async () => {
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ timezoneOffset: -480 })) },
      receiptPhoto: {
        findFirst: vi.fn(async () => ({
          ...row(),
          transactions: [
            { id: "t1", description: "a", amount: 10.5, type: "EXPENSE", date: new Date("2026-01-01T17:00:00Z"), category: { name: "Food" } },
            { id: "t2", description: "b", amount: 4.5, type: "EXPENSE", date: new Date("2026-01-02T01:00:00Z"), category: { name: "Food" } },
          ],
        })),
      },
    };
    const info = await getReceiptPhotoInfo(prisma as never, "u1", "p1");
    expect(info?.total).toBe(15);
    expect(info?.transactions[0]).toEqual({
      id: "t1",
      description: "a",
      amount: 10.5,
      type: "EXPENSE",
      categoryName: "Food",
      localDate: "2026-01-02",
    });
    expect(info?.photo.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

/** A write-transaction stub that records the order of what it was asked to do. */
const makeTx = (ownedPhotoIds: string[] = ["pB"]) => {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      if (sql.join("?").includes("receipt_photos")) {
        order.push("owned");
        const [ids] = values as [string[]];
        return ids.filter((id) => ownedPhotoIds.includes(id)).map((id) => ({ id }));
      }
      order.push("lock");
      return [];
    }),
    transaction: {
      updateMany: vi.fn(async (..._args: unknown[]) => {
        order.push("write");
        return { count: 1 };
      }),
    },
  };
  return { tx, order };
};

const lockSql = (tx: ReturnType<typeof makeTx>["tx"]) =>
  (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");

describe("photosAreOwned", () => {
  it("is true for the caller's own photos, deduped, scoped to the user", async () => {
    const { tx } = makeTx(["pA", "pB"]);
    expect(await photosAreOwned(tx as never, "u1", ["pB", "pA", "pB"])).toBe(true);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([["pA", "pB"], "u1"]);
  });

  /** Shared, so writers onto one photo do not serialise, and conflicting with the cleanup's
   *  FOR UPDATE, so a photo deleted first reads as gone rather than failing the insert. */
  it("takes FOR KEY SHARE on the photo rows, scoped by user_id", async () => {
    const { tx } = makeTx(["pA"]);
    await photosAreOwned(tx as never, "u1", ["pA"]);
    const sql = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain("FROM receipt_photos");
    expect(sql).toContain("user_id");
    expect(sql).toMatch(/ORDER BY id\s+FOR KEY SHARE\s*$/);
  });

  it("is false when any id is not the caller's or does not exist", async () => {
    const { tx } = makeTx(["pA"]);
    expect(await photosAreOwned(tx as never, "u1", ["pA", "someone-elses"])).toBe(false);
  });

  it("asks nothing when there is nothing to check", async () => {
    const { tx } = makeTx();
    expect(await photosAreOwned(tx as never, "u1", [])).toBe(true);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("applyPhotoChange", () => {
  const stamp = { updatedVia: "APP", updatedByMcpTokenId: null };

  it("replace: locks the affected rows first, then repoints every row on the old photo", async () => {
    const { tx, order } = makeTx(["pB"]);
    const result = await applyPhotoChange(tx as never, "u1", "t1", "pB", "pA");

    expect(order).toEqual(["lock", "owned", "write"]);
    const sql = lockSql(tx);
    expect(sql).toContain("FROM transactions");
    expect(sql).toContain("receipt_photo_id");
    expect(sql).toMatch(/ORDER BY id\s+FOR UPDATE\s*$/);
    expect(sql).not.toContain("NO KEY");
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["u1", "pA", "t1"]);
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", OR: [{ receiptPhotoId: "pA" }, { id: "t1" }] },
      data: { receiptPhotoId: "pB", ...stamp },
    });
    expect(result).toEqual({ orphaned: ["pA"] });
  });

  it("remove: unlinks only this row and reports the old photo as possibly orphaned", async () => {
    const { tx, order } = makeTx();
    const result = await applyPhotoChange(tx as never, "u1", "t1", null, "pA");

    expect(order).toEqual(["write"]);
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", userId: "u1" },
      data: { receiptPhotoId: null, ...stamp },
    });
    expect(result).toEqual({ orphaned: ["pA"] });
  });

  it("link: attaches a photo to a row that had none, orphaning nothing", async () => {
    const { tx, order } = makeTx(["pB"]);
    const result = await applyPhotoChange(tx as never, "u1", "t1", "pB", null);

    expect(order).toEqual(["owned", "write"]);
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", userId: "u1" },
      data: { receiptPhotoId: "pB", ...stamp },
    });
    expect(result).toEqual({ orphaned: [] });
  });

  it("writes nothing when the link does not move", async () => {
    const { tx, order } = makeTx();
    expect(await applyPhotoChange(tx as never, "u1", "t1", "pA", "pA")).toEqual({ orphaned: [] });
    expect(await applyPhotoChange(tx as never, "u1", "t1", null, null)).toEqual({ orphaned: [] });
    expect(order).toEqual([]);
  });

  it("throws before writing when the new photo is not the caller's", async () => {
    const { tx } = makeTx([]);
    await expect(applyPhotoChange(tx as never, "u1", "t1", "foreign", "pA")).rejects.toBeInstanceOf(
      ReceiptPhotoNotOwnedError,
    );
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });
});

describe("cleanUpReceiptPhotos", () => {
  const prismaWith = (count: number) =>
    makeCleanupPrisma([{ id: "pA", objectKey: "k/pA", _count: { transactions: count } }]).prisma;

  it("deletes an unreferenced photo from storage", async () => {
    const storage = makeStorage();
    storageMocks.enabled.mockReturnValue(true);
    storageMocks.create.mockReturnValue(storage);
    await cleanUpReceiptPhotos(prismaWith(0) as never, "u1", ["pA"]);
    expect(storage.delete).toHaveBeenCalledWith("k/pA");
  });

  it("does nothing at all when there are no ids", async () => {
    const prisma = prismaWith(0);
    storageMocks.create.mockClear();
    await cleanUpReceiptPhotos(prisma as never, "u1", []);
    expect(prisma.receiptPhoto.findMany).not.toHaveBeenCalled();
    expect(storageMocks.create).not.toHaveBeenCalled();
  });

  it("skips cleanup when photos are disabled, leaving orphans for the prune script", async () => {
    const prisma = prismaWith(0);
    storageMocks.enabled.mockReturnValue(false);
    storageMocks.create.mockClear();
    await cleanUpReceiptPhotos(prisma as never, "u1", ["pA"]);
    expect(storageMocks.create).not.toHaveBeenCalled();
    expect(prisma.receiptPhoto.findMany).not.toHaveBeenCalled();
    storageMocks.enabled.mockReturnValue(true);
  });

  it("never throws: a storage failure is warned about and swallowed", async () => {
    const storage = makeStorage();
    storage.delete.mockRejectedValue(new Error("R2 down"));
    storageMocks.create.mockReturnValue(storage);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(cleanUpReceiptPhotos(prismaWith(0) as never, "u1", ["pA"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
