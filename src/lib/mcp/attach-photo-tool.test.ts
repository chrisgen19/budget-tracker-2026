import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// sharp is real elsewhere; here the image step is stubbed so the test drives only the tool's rules.
vi.mock("@/lib/receipt-photo-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-photo-image")>()),
  normaliseReceiptPhoto: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    width: 10,
    height: 20,
  })),
}));

const storage = vi.hoisted(() => ({
  enabled: true,
  put: vi.fn(async (..._args: unknown[]) => {}),
  delete: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("@/lib/receipt-photo-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-photo-storage")>()),
  receiptPhotosEnabled: () => storage.enabled,
  createPhotoStorage: () => ({
    put: storage.put,
    get: vi.fn(),
    delete: storage.delete,
    list: vi.fn(async () => []),
  }),
}));

import { createBudgetMcpServer } from "./server";
import { BATCH_TX_OPTIONS } from "../transaction-writes";
import type { PrismaClient } from "../budget-query-types";
import type { McpScope } from "./scopes";

const sqlOf = (strings: unknown): string =>
  Array.isArray(strings) ? (strings as string[]).join("?") : String(strings);

/**
 * A stateful Prisma stub: enough of transactions and receipt photos for the attach path to run
 * end to end. Rows belong to `user_1` unless `owner` says otherwise.
 */
const makePrisma = (rows: { id: string; owner?: string; photo?: string | null }[]) => {
  const transactions = new Map(
    rows.map((r) => [r.id, { userId: r.owner ?? "user_1", receiptPhotoId: r.photo ?? null }]),
  );
  const photos = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (r.photo && !photos.has(r.photo)) {
      photos.set(r.photo, {
        id: r.photo,
        userId: "user_1",
        photoKey: `old-${r.photo}`,
        objectKey: `receipts/user_1/${r.photo}.jpg`,
        width: 1,
        height: 1,
        byteSize: 1,
        createdAt: new Date(),
      });
    }
  }
  const refs = (photoId: string) =>
    [...transactions.values()].filter((t) => t.receiptPhotoId === photoId).length;
  const updates: Record<string, unknown>[] = [];

  const client = {
    user: {
      findUnique: vi.fn(async () => ({ mcpWritesEnabledUntil: new Date(Date.now() + 60_000) })),
    },
    transaction: {
      findMany: vi.fn(
        async ({ where }: { where: { id?: { in: string[] }; userId: string; receiptPhotoId?: string } }) => {
          const all = [...transactions.entries()].filter(([, t]) => t.userId === where.userId);
          const picked = where.id
            ? all.filter(([id]) => where.id!.in.includes(id))
            : all.filter(([, t]) => t.receiptPhotoId === where.receiptPhotoId);
          return picked.map(([id, t]) => ({ id, receiptPhotoId: t.receiptPhotoId })).sort((a, b) => a.id.localeCompare(b.id));
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string; id?: string; OR?: ({ receiptPhotoId: string } | { id: string })[] };
          data: { receiptPhotoId: string | null };
        }) => {
          updates.push(data);
          let count = 0;
          for (const [id, t] of transactions) {
            if (t.userId !== where.userId) continue;
            const hit = where.OR
              ? where.OR.some((c) => ("id" in c ? c.id === id : c.receiptPhotoId === t.receiptPhotoId))
              : where.id === id;
            if (hit) {
              t.receiptPhotoId = data.receiptPhotoId;
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    receiptPhoto: {
      findUnique: vi.fn(
        async ({ where }: { where: { userId_photoKey: { userId: string; photoKey: string } } }) =>
          [...photos.values()].find(
            (p) =>
              p.userId === where.userId_photoKey.userId &&
              p.photoKey === where.userId_photoKey.photoKey,
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, createdAt: new Date() };
        photos.set(data.id as string, row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => photos.has(id))
          .map((id) => ({
            id,
            objectKey: photos.get(id)!.objectKey,
            _count: { transactions: refs(id) },
          })),
      ),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (refs(where.id) > 0 || !photos.has(where.id)) return { count: 0 };
        photos.delete(where.id);
        return { count: 1 };
      }),
    },
    $queryRaw: vi.fn(async (strings: unknown, ...values: unknown[]) => {
      const sql = sqlOf(strings);
      if (sql.includes("FROM receipt_photos") && sql.includes("ANY")) {
        const [ids] = values as [string[]];
        return ids.filter((id) => photos.has(id)).map((id) => ({ id }));
      }
      if (sql.includes("FROM receipt_photos")) {
        const [id] = values as [string];
        return photos.has(id) ? [{ id }] : [];
      }
      if (sql.includes("receipt_photo_id AS")) {
        const [userId, ids] = values as [string, string[]];
        return ids
          .filter((id) => transactions.get(id)?.userId === userId)
          .sort()
          .map((id) => ({ id, receiptPhotoId: transactions.get(id)!.receiptPhotoId }));
      }
      return [];
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };
  return { client: client as unknown as PrismaClient, transactions, photos, updates };
};

const IMAGE = Buffer.from("not really a jpeg").toString("base64");

const call = async (
  prisma: PrismaClient,
  args: Record<string, unknown>,
  options: { scopes?: McpScope[]; writesEnabledUntil?: Date | null } = {},
) => {
  const server = createBudgetMcpServer({
    prisma,
    userId: "user_1",
    timezoneOffset: -480,
    scopes: options.scopes ?? ["transactions:write"],
    writesEnabledUntil:
      options.writesEnabledUntil === undefined
        ? new Date(Date.now() + 60_000)
        : options.writesEnabledUntil,
    tokenId: "tok_bot",
    createdVia: "TELEGRAM",
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const res = await client.callTool({ name: "attach_receipt_photo", arguments: args });
  await client.close();
  return res as {
    isError?: boolean;
    content: { text?: string }[];
    structuredContent?: { photoId: string; attachedTo: string[]; replayed: boolean };
  };
};

const listNames = async (scopes: McpScope[]) => {
  const server = createBudgetMcpServer({
    prisma: {} as PrismaClient,
    userId: "user_1",
    timezoneOffset: -480,
    scopes,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
};

beforeEach(() => {
  storage.enabled = true;
  storage.put.mockClear();
  storage.delete.mockClear();
});

describe("attach_receipt_photo", () => {
  it("is absent from a token without transactions:write", async () => {
    const names = (
      await listNames(["budget:read", "transactions:read", "receipts:read", "receipts:scan"])
    ).map((t) => t.name);
    expect(names).not.toContain("attach_receipt_photo");
  });

  it("is listed with transactions:write, destructive and idempotent, not read-only", async () => {
    const tool = (await listNames(["transactions:write"])).find(
      (t) => t.name === "attach_receipt_photo",
    );
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBeUndefined();
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(tool?.annotations?.idempotentHint).toBe(true);
  });

  it("refuses a transaction the user does not own, names it, and stores nothing", async () => {
    const { client, photos } = makePrisma([
      { id: "tx_mine" },
      { id: "tx_theirs", owner: "user_2" },
    ]);
    const res = await call(client, {
      transactionIds: ["tx_mine", "tx_theirs", "tx_missing"],
      imageBase64: IMAGE,
      photoKey: "key-1",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("tx_theirs");
    expect(res.content[0].text).toContain("tx_missing");
    expect(res.content[0].text).not.toContain("tx_mine");
    expect(storage.put).not.toHaveBeenCalled();
    expect(photos.size).toBe(0);
  });

  it("stores one photo and links every listed transaction", async () => {
    const { client, transactions } = makePrisma([{ id: "tx_1" }, { id: "tx_2" }]);
    const res = await call(client, {
      transactionIds: ["tx_1", "tx_2"],
      imageBase64: IMAGE,
      photoKey: "key-1",
    });
    expect(res.isError).toBeFalsy();
    const out = res.structuredContent!;
    expect(out.replayed).toBe(false);
    expect(out.attachedTo).toEqual(["tx_1", "tx_2"]);
    expect(transactions.get("tx_1")?.receiptPhotoId).toBe(out.photoId);
    expect(transactions.get("tx_2")?.receiptPhotoId).toBe(out.photoId);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  // Up to 50 rows, each a few awaited statements: Prisma's 5s default could roll the links back
  // after the photo was stored. The same bounds `updateTransactions` runs under.
  it("links inside a transaction with the batch timeout, not Prisma's 5s default", async () => {
    const { client } = makePrisma([{ id: "tx_1" }]);
    await call(client, { transactionIds: ["tx_1"], imageBase64: IMAGE, photoKey: "key-1" });
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), BATCH_TX_OPTIONS);
  });

  it("stamps the link with the token's provenance, not APP", async () => {
    const { client, updates } = makePrisma([{ id: "tx_1" }]);
    await call(client, { transactionIds: ["tx_1"], imageBase64: IMAGE, photoKey: "key-1" });
    expect(updates[0]).toMatchObject({ updatedVia: "TELEGRAM", updatedByMcpTokenId: "tok_bot" });
  });

  it("replays the same photoKey: replayed true, one put, the same photo", async () => {
    const { client } = makePrisma([{ id: "tx_1" }]);
    const args = { transactionIds: ["tx_1"], imageBase64: IMAGE, photoKey: "key-1" };
    const first = await call(client, args);
    const second = await call(client, args);
    expect(second.structuredContent?.replayed).toBe(true);
    expect(second.structuredContent?.photoId).toBe(first.structuredContent?.photoId);
    expect(second.structuredContent?.attachedTo).toEqual(["tx_1"]);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it("accepts a non-UUID photoKey up to 100 characters and refuses a longer one", async () => {
    const { client } = makePrisma([{ id: "tx_1" }]);
    const ok = await call(client, {
      transactionIds: ["tx_1"],
      imageBase64: IMAGE,
      photoKey: "k".repeat(100),
    });
    expect(ok.isError).toBeFalsy();
    const tooLong = await call(client, {
      transactionIds: ["tx_1"],
      imageBase64: IMAGE,
      photoKey: "k".repeat(101),
    });
    expect(tooLong.isError).toBe(true);
  });

  it("replaces an existing photo and deletes the one that lost its last row", async () => {
    const { client, photos, transactions } = makePrisma([{ id: "tx_1", photo: "old_photo" }]);
    const res = await call(client, {
      transactionIds: ["tx_1"],
      imageBase64: IMAGE,
      photoKey: "key-2",
    });
    expect(res.isError).toBeFalsy();
    expect(transactions.get("tx_1")?.receiptPhotoId).toBe(res.structuredContent?.photoId);
    expect(photos.has("old_photo")).toBe(false);
    expect(storage.delete).toHaveBeenCalledWith("receipts/user_1/old_photo.jpg");
  });

  it("keeps a replaced photo another row still uses, by moving that row too", async () => {
    // The repoint rule applyPhotoChange already applies in the app: the rows of one split receipt
    // share one photo, so replacing it for one replaces it for all of them.
    const { client, transactions } = makePrisma([
      { id: "tx_1", photo: "old_photo" },
      { id: "tx_2", photo: "old_photo" },
    ]);
    const res = await call(client, {
      transactionIds: ["tx_1"],
      imageBase64: IMAGE,
      photoKey: "key-2",
    });
    expect(res.structuredContent?.attachedTo).toEqual(["tx_1", "tx_2"]);
    expect(transactions.get("tx_2")?.receiptPhotoId).toBe(res.structuredContent?.photoId);
  });

  it("refuses when photos are not configured, before touching anything", async () => {
    storage.enabled = false;
    const res = await call({} as PrismaClient, {
      transactionIds: ["tx_1"],
      imageBase64: IMAGE,
      photoKey: "key-1",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Receipt photos are not configured on this server.");
  });

  it("refuses when the write lease is off, before touching anything", async () => {
    const res = await call(
      {} as PrismaClient,
      { transactionIds: ["tx_1"], imageBase64: IMAGE, photoKey: "key-1" },
      { writesEnabledUntil: null },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Writes are currently switched off");
  });

  it("refuses an image that is not base64", async () => {
    const { client } = makePrisma([{ id: "tx_1" }]);
    const res = await call(client, {
      transactionIds: ["tx_1"],
      imageBase64: "not base64!!",
      photoKey: "key-1",
    });
    expect(res.isError).toBe(true);
    expect(storage.put).not.toHaveBeenCalled();
  });
});
