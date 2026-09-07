import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";

/**
 * The single create path for labels, shared by `POST /api/labels` and the MCP `create_label` tool.
 *
 * Small, but worth sharing for one property that is easy to lose: the name check is
 * case-insensitive and there is no unique index behind it, so a second copy that compared names
 * exactly would let "Work" and "work" both exist -- and the Telegram label resolver, which matches
 * case-insensitively and reports two candidates as ambiguous, would then refuse every mention of
 * either. `P2002` is still treated as a duplicate so a concurrent create loses cleanly if an index
 * is added later.
 */

export const LABEL_INCLUDE = {
  _count: { select: { transactions: true } },
  schedules: { orderBy: { createdAt: "asc" } },
} as const;

export type LabelWithRelations = Prisma.LabelGetPayload<{ include: typeof LABEL_INCLUDE }>;

export type LabelWriteFailureReason =
  /** A label with this name already exists on the account, ignoring case. */
  | "DUPLICATE_NAME"
  /** The write lease lapsed between the request arriving and the write. Nothing was written. */
  | "NO_LONGER_PERMITTED";

export type LabelWriteResult =
  | { ok: true; label: LabelWithRelations }
  | { ok: false; reason: LabelWriteFailureReason };

export interface LabelScheduleInput {
  /** 0 = Sunday. */
  days: number[];
  /** Zero-padded HH:mm. Compared as a string everywhere, so "8:00" sorts after "20:00". */
  startTime: string;
  endTime: string;
}

export interface CreateLabelParams {
  prisma: PrismaClient;
  userId: string;
  name: string;
  color: string;
  applicableTo: "EXPENSE" | "INCOME" | "BOTH";
  schedules?: LabelScheduleInput[];
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

export const createLabel = async ({
  prisma,
  userId,
  name,
  color,
  applicableTo,
  schedules,
  assertStillPermitted,
}: CreateLabelParams): Promise<LabelWriteResult> => {
  const existing = await prisma.label.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, userId },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "DUPLICATE_NAME" };

  try {
    const label = await prisma.$transaction(async (tx) => {
      if (assertStillPermitted && !(await assertStillPermitted(tx))) return null;

      return tx.label.create({
        data: {
          name,
          color,
          applicableTo,
          userId,
          ...(schedules && schedules.length > 0 && {
            schedules: {
              create: schedules.map((s) => ({
                days: s.days,
                startTime: s.startTime,
                endTime: s.endTime,
              })),
            },
          }),
        },
        include: LABEL_INCLUDE,
      });
    });

    if (label === null) return { ok: false, reason: "NO_LONGER_PERMITTED" };
    return { ok: true, label };
  } catch (error) {
    // A concurrent create that won the race produced exactly the row this one wanted, so the
    // caller is told the same thing the pre-check would have told it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "DUPLICATE_NAME" };
    }
    throw error;
  }
};
