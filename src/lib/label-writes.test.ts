import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createLabel } from "./label-writes";
import type { PrismaClient } from "./budget-query-types";

interface StubOptions {
  /** Labels already on the account. `findFirst` matches these without case, as Prisma's
   *  `mode: "insensitive"` does against a real database. */
  existing?: string[];
  /** Thrown by `label.create`, for the concurrent-create path. */
  createError?: unknown;
  /** Categories the account can use. Defaults cover both types. */
  categories?: { id: string; name: string; type: string }[];
}

const makePrisma = ({
  existing = [],
  createError,
  categories = [
    { id: "cat_transport", name: "Transportation", type: "EXPENSE" },
    { id: "cat_salary", name: "Salary", type: "INCOME" },
  ],
}: StubOptions = {}) => {
  const created: Record<string, unknown>[] = [];

  const client = {
    category: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        categories.filter((c) => where.id.in.includes(c.id))
      ),
    },
    label: {
      findFirst: vi.fn(async ({ where }: { where: { name: { equals: string } } }) => {
        const hit = existing.find((n) => n.toLowerCase() === where.name.equals.toLowerCase());
        return hit ? { id: "lab_existing" } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (createError) throw createError;
        created.push(data);
        return {
          id: "lab_new",
          ...data,
          schedules: ((data.schedules as { create?: unknown[] } | undefined)?.create ?? []).map(
            (s, i) => ({ id: `sch_${i}`, ...(s as object) })
          ),
          categories: (
            (data.categories as { create?: { categoryId: string }[] } | undefined)?.create ?? []
          ).map((c) => ({ categoryId: c.categoryId })),
          _count: { transactions: 0 },
        };
      }),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)
    ),
  };

  return { client: client as unknown as PrismaClient, created };
};

const create = (client: PrismaClient, overrides: Record<string, unknown> = {}) =>
  createLabel({
    prisma: client,
    userId: "user_1",
    name: "Japan 2026",
    color: "#A8763E",
    applicableTo: "BOTH",
    ...overrides,
  } as Parameters<typeof createLabel>[0]);

describe("createLabel", () => {
  it("creates the label", async () => {
    const { client, created } = makePrisma();

    const result = await create(client);

    expect(result.ok).toBe(true);
    expect(created[0]).toMatchObject({ name: "Japan 2026", color: "#A8763E", userId: "user_1" });
  });

  /**
   * Names collide without case, and they have to.
   *
   * The label resolver matches case-insensitively and reports two candidates as ambiguous, so
   * letting "work" exist beside "Work" would make the bot refuse every mention of either -- a
   * label nobody could use, created by a tool that reported success.
   */
  it("refuses a name that differs only by case", async () => {
    const { client, created } = makePrisma({ existing: ["Work"] });

    const result = await create(client, { name: "work" });

    expect(result).toEqual({ ok: false, reason: "DUPLICATE_NAME" });
    expect(created).toHaveLength(0);
  });

  /** A concurrent create that won the race produced exactly the row this one wanted, so the caller
   *  is told the same thing the pre-check would have told it. */
  it("reads a unique-constraint violation as a duplicate, not a crash", async () => {
    const { client } = makePrisma({
      createError: new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "0",
      }),
    });

    expect(await create(client)).toEqual({ ok: false, reason: "DUPLICATE_NAME" });
  });

  it("rethrows anything that is not a duplicate", async () => {
    const { client } = makePrisma({ createError: new Error("connection lost") });

    await expect(create(client)).rejects.toThrow("connection lost");
  });

  it("writes the schedules it was given", async () => {
    const { client, created } = makePrisma();

    const result = await create(client, {
      schedules: [{ days: [1, 2, 3, 4, 5], startTime: "05:00", endTime: "17:00" }],
    });

    expect(result.ok).toBe(true);
    expect(created[0].schedules).toEqual({
      create: [{ days: [1, 2, 3, 4, 5], startTime: "05:00", endTime: "17:00" }],
    });
  });

  /** The lease is re-read at the moment of the write, so switching writes off stops work already
   *  in flight rather than only refusing the next request. */
  it("refuses when the write lease lapses mid-flight, writing nothing", async () => {
    const { client, created } = makePrisma();

    const result = await create(client, { assertStillPermitted: async () => false });

    expect(result).toEqual({ ok: false, reason: "NO_LONGER_PERMITTED" });
    expect(created).toHaveLength(0);
  });
});

describe("createLabel category restriction", () => {
  it("links the categories it was given", async () => {
    const { client, created } = makePrisma();

    const result = await create(client, {
      applicableTo: "EXPENSE",
      categoryIds: ["cat_transport"],
    });

    expect(result.ok).toBe(true);
    expect(created[0].categories).toEqual({ create: [{ categoryId: "cat_transport" }] });
  });

  // Empty means every category, so it must write no rows rather than an empty relation payload
  // -- and must certainly not be mistaken for "restricted to nothing".
  it("writes no links when no categories were named", async () => {
    const { client, created } = makePrisma();

    await create(client, { categoryIds: [] });

    expect(created[0].categories).toBeUndefined();
  });

  it("refuses a category the user cannot use", async () => {
    const { client, created } = makePrisma();

    const result = await create(client, { categoryIds: ["cat_someone_else"] });

    expect(result).toMatchObject({ ok: false, reason: "INVALID_CATEGORIES" });
    expect(created).toHaveLength(0);
  });

  // The half that is easy to leave out and quietly destructive: an expense-only label limited to
  // an income category matches nothing, and a label that stops appearing looks like a deleted one.
  it("refuses a category whose type the label's applicableTo excludes", async () => {
    const { client, created } = makePrisma();

    const result = await create(client, {
      applicableTo: "EXPENSE",
      categoryIds: ["cat_salary"],
    });

    expect(result).toMatchObject({ ok: false, reason: "INVALID_CATEGORIES" });
    // Names the offending category, since "invalid input" sends the user nowhere.
    expect((result as { message: string }).message).toContain("Salary");
    expect(created).toHaveLength(0);
  });

  it("allows either type when the label applies to BOTH", async () => {
    const { client } = makePrisma();

    const result = await create(client, {
      applicableTo: "BOTH",
      categoryIds: ["cat_transport", "cat_salary"],
    });

    expect(result.ok).toBe(true);
  });
});
