import { Prisma, type CreditAccount, type TransactionSource } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import { CHARGE_ROW_INCLUDE, type CreditChargeRow } from "@/lib/credit-account-queries";
import { categoriesAreUsableForWrite } from "@/lib/transaction-writes";
import type {
  CreditAccountInput,
  CreditAccountPatch,
  CreditChargeInput,
  CreditChargePatch,
} from "@/lib/validations";

export type CreditWriteFailureReason =
  /** The card or charge is not this user's, or does not exist. Not distinguished on purpose. */
  | "NOT_FOUND"
  /** Another active card already has this name, compared without case. */
  | "DUPLICATE_NAME"
  /** New charges cannot be added to an archived card. */
  | "ACCOUNT_ARCHIVED"
  /** A category is not this user's or a default, or is not an expense category. */
  | "CATEGORIES_NOT_USABLE";

/** The one place a reason becomes a status code and a message, so every route answers alike. */
export const CREDIT_WRITE_FAILURES: Record<
  CreditWriteFailureReason,
  { status: number; message: string }
> = {
  NOT_FOUND: { status: 404, message: "Credit card not found" },
  DUPLICATE_NAME: { status: 409, message: "You already have an active card with that name" },
  ACCOUNT_ARCHIVED: {
    status: 409,
    message: "That card is archived. Reactivate it before adding charges",
  },
  CATEGORIES_NOT_USABLE: {
    status: 400,
    message: "One or more categories do not exist, are not yours, or are not expense categories",
  },
};

type Failure = { ok: false; reason: CreditWriteFailureReason };

const fail = (reason: CreditWriteFailureReason): Failure => ({ ok: false, reason });

/** Bounds for a statement-sized write: up to `MAX_CREDIT_CHARGES` sequential inserts. */
const CHARGE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

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
  /** Minutes, `getTimezoneOffset()` convention. Resolves `openingBalanceDate` to the user's day. */
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
 * A card with any charge or payment is archived instead, so a past payment never ends up claiming
 * to pay nothing. The count and the delete are not atomic, but they do not need to be: the foreign
 * keys are `Restrict`, so a charge or payment landing in between makes the delete fail with P2003,
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

  const [charges, payments] = await Promise.all([
    prisma.creditCharge.count({ where: { accountId } }),
    prisma.transaction.count({ where: { creditAccountId: accountId } }),
  ]);

  if (charges + payments === 0) {
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

/** Every charge is filed under an expense category, whatever its kind: a refund of a purchase
 *  belongs where the purchase was. */
const asExpenses = (items: readonly { categoryId: string }[]) =>
  items.map((item) => ({ categoryId: item.categoryId, type: "EXPENSE" as const }));

const toChargeData = (item: CreditChargeInput, timezoneOffset: number) => ({
  kind: item.kind,
  amount: item.amount,
  description: item.description,
  date: localDayStart(item.date, timezoneOffset),
  categoryId: item.categoryId,
  originalAmount: item.originalAmount ?? null,
  originalCurrency: item.originalCurrency ?? null,
});

/**
 * Add statement lines to a card, all or nothing.
 *
 * All or nothing because a statement is checked against its printed total: half of one saved looks
 * like a wrong total rather than a failed save. The category check is the locking variant and runs
 * before any insert, for the reason `categoriesAreUsableForWrite` documents.
 */
export const createCreditCharges = async ({
  prisma,
  userId,
  accountId,
  items,
  timezoneOffset,
  createdVia = "APP",
}: AccountWriteParams & {
  accountId: string;
  items: readonly CreditChargeInput[];
  createdVia?: TransactionSource;
}): Promise<{ ok: true; charges: CreditChargeRow[] } | Failure> =>
  prisma.$transaction(async (tx) => {
    const account = await tx.creditAccount.findFirst({
      where: { id: accountId, userId },
      select: { isActive: true },
    });
    if (!account) return fail("NOT_FOUND");
    if (!account.isActive) return fail("ACCOUNT_ARCHIVED");
    if (!(await categoriesAreUsableForWrite(tx, userId, asExpenses(items)))) {
      return fail("CATEGORIES_NOT_USABLE");
    }

    const charges: CreditChargeRow[] = [];
    for (const item of items) {
      charges.push(
        await tx.creditCharge.create({
          data: { ...toChargeData(item, timezoneOffset), accountId, userId, createdVia },
          include: CHARGE_ROW_INCLUDE,
        })
      );
    }
    return { ok: true as const, charges };
  }, CHARGE_TX_OPTIONS);

/**
 * Correct one charge. Allowed on an archived card, since fixing its history is not adding to it.
 * The category is judged only when it moves, the same rule the transaction edit paths follow.
 */
export const updateCreditCharge = async ({
  prisma,
  userId,
  accountId,
  chargeId,
  patch,
  timezoneOffset,
}: AccountWriteParams & {
  accountId: string;
  chargeId: string;
  patch: CreditChargePatch;
}): Promise<{ ok: true; charge: CreditChargeRow } | Failure> =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.creditCharge.findFirst({
      where: { id: chargeId, accountId, userId },
      select: { categoryId: true },
    });
    if (!existing) return fail("NOT_FOUND");

    const { date, categoryId, ...fields } = patch;
    const moves = categoryId !== undefined && categoryId !== existing.categoryId;
    if (moves && !(await categoriesAreUsableForWrite(tx, userId, asExpenses([{ categoryId }])))) {
      return fail("CATEGORIES_NOT_USABLE");
    }

    const charge = await tx.creditCharge.update({
      where: { id: chargeId },
      data: {
        ...fields,
        ...(categoryId !== undefined && { categoryId }),
        ...(date !== undefined && { date: localDayStart(date, timezoneOffset) }),
      },
      include: CHARGE_ROW_INCLUDE,
    });
    return { ok: true as const, charge };
  });

export const deleteCreditCharge = async ({
  prisma,
  userId,
  accountId,
  chargeId,
}: {
  prisma: PrismaClient;
  userId: string;
  accountId: string;
  chargeId: string;
}): Promise<{ ok: true } | Failure> => {
  const { count } = await prisma.creditCharge.deleteMany({
    where: { id: chargeId, accountId, userId },
  });
  return count > 0 ? { ok: true } : fail("NOT_FOUND");
};
