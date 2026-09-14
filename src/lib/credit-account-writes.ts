import { Prisma, type CreditAccount, type CreditPayment, type TransactionSource } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import type {
  CreditAccountInput,
  CreditAccountPatch,
  CreditPaymentInput,
  CreditPaymentPatch,
} from "@/lib/validations";

export type CreditWriteFailureReason =
  /** The card or payment is not this user's, or does not exist. Not distinguished on purpose. */
  | "NOT_FOUND"
  /** Another active card already has this name, compared without case. */
  | "DUPLICATE_NAME"
  /** New payments cannot be recorded against an archived card. */
  | "ACCOUNT_ARCHIVED";

/** The one place a reason becomes a status code and a message, so every route answers alike. */
export const CREDIT_WRITE_FAILURES: Record<
  CreditWriteFailureReason,
  { status: number; message: string }
> = {
  NOT_FOUND: { status: 404, message: "Credit card not found" },
  DUPLICATE_NAME: { status: 409, message: "You already have an active card with that name" },
  ACCOUNT_ARCHIVED: {
    status: 409,
    message: "That card is archived. Reactivate it before recording a payment",
  },
};

type Failure = { ok: false; reason: CreditWriteFailureReason };

const fail = (reason: CreditWriteFailureReason): Failure => ({ ok: false, reason });

/** The start of a calendar day in the user's timezone, the instant a date-only value is stored as. */
export const localDayStart = (dateKey: string, timezoneOffset: number): Date => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + timezoneOffset * 60_000);
};

/** The user's own today, as `YYYY-MM-DD`. */
export const localTodayKey = (timezoneOffset: number, now: Date = new Date()): string =>
  new Date(now.getTime() - timezoneOffset * 60_000).toISOString().slice(0, 10);

/**
 * Whether another active card already uses this name.
 *
 * Case-insensitive, and only among active cards: an archived "BPI" should not stop a replacement
 * card being called "BPI". There is no unique index behind it, the same trade `createLabel` makes;
 * two concurrent creates can both pass, which leaves two visible, renamable cards.
 */
const nameTaken = async (
  prisma: PrismaClient,
  userId: string,
  name: string,
  exceptId?: string
): Promise<boolean> => {
  const clash = await prisma.creditAccount.findFirst({
    where: {
      userId,
      isActive: true,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  return clash !== null;
};

interface AccountWriteParams {
  prisma: PrismaClient;
  userId: string;
  /** Minutes, `getTimezoneOffset()` convention. Resolves calendar days to the user's own. */
  timezoneOffset: number;
}

export const createCreditAccount = async ({
  prisma,
  userId,
  input,
  timezoneOffset,
}: AccountWriteParams & { input: CreditAccountInput }): Promise<
  { ok: true; account: CreditAccount } | Failure
> => {
  if (await nameTaken(prisma, userId, input.name)) return fail("DUPLICATE_NAME");

  const account = await prisma.creditAccount.create({
    data: {
      userId,
      name: input.name,
      color: input.color,
      creditLimit: input.creditLimit ?? null,
      statementDay: input.statementDay ?? null,
      dueDay: input.dueDay ?? null,
      openingBalance: input.openingBalance,
      openingBalanceDate: localDayStart(
        input.openingBalanceDate ?? localTodayKey(timezoneOffset),
        timezoneOffset
      ),
    },
  });
  return { ok: true, account };
};

/** A patch: omitted fields are left alone, and `null` clears the optional ones. */
export const updateCreditAccount = async ({
  prisma,
  userId,
  accountId,
  patch,
  timezoneOffset,
}: AccountWriteParams & { accountId: string; patch: CreditAccountPatch }): Promise<
  { ok: true; account: CreditAccount } | Failure
> => {
  const existing = await prisma.creditAccount.findFirst({ where: { id: accountId, userId } });
  if (!existing) return fail("NOT_FOUND");

  // Judged only when the result is active and something that could collide moves: the name, or an
  // archived card coming back beside one that took its name in the meantime.
  const name = patch.name ?? existing.name;
  const active = patch.isActive ?? existing.isActive;
  const couldCollide =
    name.toLowerCase() !== existing.name.toLowerCase() || (active && !existing.isActive);
  if (active && couldCollide && (await nameTaken(prisma, userId, name, accountId))) {
    return fail("DUPLICATE_NAME");
  }

  const { openingBalanceDate, ...fields } = patch;
  const account = await prisma.creditAccount.update({
    where: { id: accountId },
    data: {
      ...fields,
      ...(openingBalanceDate !== undefined && {
        openingBalanceDate: localDayStart(openingBalanceDate, timezoneOffset),
      }),
    },
  });
  return { ok: true, account };
};

/**
 * Delete a card, or archive it when it has history.
 *
 * A card with any purchase or payment is archived instead, so its history never loses the card it
 * belongs to. The count and the delete are not atomic, but they do not need to be: the foreign keys
 * are `Restrict`, so a purchase or payment landing in between makes the delete fail with P2003,
 * and that is read as "has history" and archived like any other.
 */
export const deleteCreditAccount = async ({
  prisma,
  userId,
  accountId,
}: {
  prisma: PrismaClient;
  userId: string;
  accountId: string;
}): Promise<{ ok: true; outcome: "deleted" | "archived" } | Failure> => {
  const account = await prisma.creditAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) return fail("NOT_FOUND");

  const [purchases, payments] = await Promise.all([
    prisma.transaction.count({ where: { creditAccountId: accountId } }),
    prisma.creditPayment.count({ where: { accountId } }),
  ]);

  if (purchases + payments === 0) {
    try {
      await prisma.creditAccount.delete({ where: { id: accountId } });
      return { ok: true, outcome: "deleted" };
    } catch (error) {
      const gainedHistory =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
      if (!gainedHistory) throw error;
    }
  }

  await prisma.creditAccount.update({ where: { id: accountId }, data: { isActive: false } });
  return { ok: true, outcome: "archived" };
};

/**
 * Record a payment to a card, or a refund it issued. Never an expense: the purchases were counted
 * when they were made, so this only lowers what the card owes. Refused on an archived card.
 */
export const createCreditPayment = async ({
  prisma,
  userId,
  accountId,
  input,
  timezoneOffset,
  createdVia = "APP",
}: AccountWriteParams & {
  accountId: string;
  input: CreditPaymentInput;
  createdVia?: TransactionSource;
}): Promise<{ ok: true; payment: CreditPayment } | Failure> => {
  const account = await prisma.creditAccount.findFirst({
    where: { id: accountId, userId },
    select: { isActive: true },
  });
  if (!account) return fail("NOT_FOUND");
  if (!account.isActive) return fail("ACCOUNT_ARCHIVED");

  const payment = await prisma.creditPayment.create({
    data: {
      kind: input.kind,
      amount: input.amount,
      description: input.description,
      date: localDayStart(input.date, timezoneOffset),
      accountId,
      userId,
      createdVia,
    },
  });
  return { ok: true, payment };
};

/** Correct one payment. Allowed on an archived card, since fixing its history is not adding to it. */
export const updateCreditPayment = async ({
  prisma,
  userId,
  accountId,
  paymentId,
  patch,
  timezoneOffset,
}: AccountWriteParams & {
  accountId: string;
  paymentId: string;
  patch: CreditPaymentPatch;
}): Promise<{ ok: true; payment: CreditPayment } | Failure> => {
  const { date, ...fields } = patch;
  const { count } = await prisma.creditPayment.updateMany({
    where: { id: paymentId, accountId, userId },
    data: { ...fields, ...(date !== undefined && { date: localDayStart(date, timezoneOffset) }) },
  });
  if (count === 0) return fail("NOT_FOUND");

  const payment = await prisma.creditPayment.findUniqueOrThrow({ where: { id: paymentId } });
  return { ok: true, payment };
};

export const deleteCreditPayment = async ({
  prisma,
  userId,
  accountId,
  paymentId,
}: {
  prisma: PrismaClient;
  userId: string;
  accountId: string;
  paymentId: string;
}): Promise<{ ok: true } | Failure> => {
  const { count } = await prisma.creditPayment.deleteMany({
    where: { id: paymentId, accountId, userId },
  });
  return count > 0 ? { ok: true } : fail("NOT_FOUND");
};
