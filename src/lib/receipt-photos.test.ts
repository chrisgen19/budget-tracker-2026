import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receipt-photo-image", () => ({
  normaliseReceiptPhoto: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), width: 10, height: 20 })),
}));

import { Prisma } from "@prisma/client";
import { deleteUnreferencedPhotos, getReceiptPhotoInfo, storeReceiptPhoto } from "@/lib/receipt-photos";

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

  it("deletes the object and rethrows when the insert fails", async () => {
    const storage = makeStorage();
    const boom = new Error("db down");
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

describe("deleteUnreferencedPhotos", () => {
  const photos = [
    { id: "p1", objectKey: "k/p1", _count: { transactions: 1 } },
    { id: "p2", objectKey: "k/p2", _count: { transactions: 0 } },
  ];

  it("deletes only unreferenced photos, row before object, guarded by owner and no links", async () => {
    const order: string[] = [];
    const storage = makeStorage();
    storage.delete.mockImplementation(async () => void order.push("object"));
    const prisma = {
      receiptPhoto: {
        findMany: vi.fn(async () => photos),
        deleteMany: vi.fn(async () => {
          order.push("row");
          return { count: 1 };
        }),
      },
    };
    const deleted = await deleteUnreferencedPhotos({ prisma: prisma as never, storage }, "u1", ["p1", "p2"]);
    expect(deleted).toEqual(["p2"]);
    expect(prisma.receiptPhoto.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.receiptPhoto.deleteMany).toHaveBeenCalledWith({
      where: { id: "p2", userId: "u1", transactions: { none: {} } },
    });
    expect(storage.delete).toHaveBeenCalledWith("k/p2");
    expect(order).toEqual(["row", "object"]);
  });

  it("keeps the object and omits the id when the photo was relinked concurrently", async () => {
    const storage = makeStorage();
    const prisma = {
      receiptPhoto: {
        findMany: vi.fn(async () => photos),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
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
