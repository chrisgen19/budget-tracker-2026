import { Prisma, type CreditAccount, type TransactionSource } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import { createBill } from "@/lib/bill-writes";
import { clampToMonth, userToday } from "@/lib/bill-dates";
import { CARD_PAYMENT_CATEGORY_NAME } from "@/lib/card-payment-category";
import {
  CHARGE_ROW_INCLUDE,
  getCreditAccountSummaries,
  type CreditChargeRow,
} from "@/lib/credit-account-queries";
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
  | "CATEGORIES_NOT_USABLE"
  /** A reminder needs to know which day payment is due. */
  | "NO_DUE_DAY"
  /** The card already has a reminder bill. */
  | "REMINDER_EXISTS"
  /** The default payment category has not been seeded on this database. */
  | "PAYMENT_CATEGORY_MISSING";

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
  NO_DUE_DAY: { status: 400, message: "Set a due day on this card before adding a reminder" },
  REMINDER_EXISTS: { status: 409, message: "This card already has a payment reminder" },
  PAYMENT_CATEGORY_MISSING: {
    status: 409,
    message: `The "${CARD_PAYMENT_CATEGORY_NAME}" category is missing. Run the database seed, then try again`,
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

/**
 * The next day a monthly due day falls on, counting today. Both dates are date-only values at UTC
 * midnight, the way every bill date is stored. Clamped to short months, so a card due on the 31st
 * comes due on the 30th in September.
 */
export const nextDueOn = (dueDay: number, today: Date): Date => {
  const thisMonth = clampToMonth(today.getUTCFullYear(), today.getUTCMonth(), dueDay);
  if (thisMonth >= today) return thisMonth;
  return clampToMonth(today.getUTCFullYear(), today.getUTCMonth() + 1, dueDay);
};

/**
 * Create the monthly bill that reminds you to pay a card, and link it to the card.
 *
 * A **variable** bill, because no two statements are the same: paying it then asks for the amount
 * actually paid rather than writing a stored figure, and its forecast learns from real payments. The
 * stored amount is only that fallback, so it starts at what the card owes today. It is filed under
 * the payment category, which is what lets `settleBill` link each payment back to this card.
 *
 * The schedule follows the start date's day of the month, so a due day clamped into a short month
 * (the 31st landing on the 30th) keeps recurring on the 30th. Moving the bill's start date on the
 * Bills page fixes that.
 */
export const createCardReminder = async ({
  prisma,
  userId,
  accountId,
  timezoneOffset,
}: AccountWriteParams & { accountId: string }): Promise<{ ok: true; billId: string } | Failure> => {
  const account = await prisma.creditAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return fail("NOT_FOUND");
  if (!account.isActive) return fail("ACCOUNT_ARCHIVED");
  if (account.billId) return fail("REMINDER_EXISTS");
  if (!account.dueDay) return fail("NO_DUE_DAY");

  const paymentCategory = await prisma.category.findFirst({
    where: { userId: null, isDefault: true, name: CARD_PAYMENT_CATEGORY_NAME, type: "EXPENSE" },
    select: { id: true },
  });
  if (!paymentCategory) return fail("PAYMENT_CATEGORY_MISSING");

  const summary = (await getCreditAccountSummaries(prisma, userId)).find((a) => a.id === accountId);
  const created = await createBill({
    prisma,
    userId,
    input: {
      amount: Math.max(Math.round(summary?.balance ?? 0), 1),
      description: `${account.name} payment`,
      type: "EXPENSE",
      categoryId: paymentCategory.id,
      frequency: "MONTHLY",
      customIntervalDays: null,
      reminderDaysBefore: 3,
      isVariable: true,
      startDate: nextDueOn(account.dueDay, userToday(timezoneOffset)),
      endDate: null,
      isActive: true,
    },
  });
  if (!created.ok) return fail("CATEGORIES_NOT_USABLE");

  // Conditional on the card still having no reminder, so a double click cannot leave two bills both
  // claiming it. The losing bill has no occurrences yet, so removing it loses nothing.
  const { count } = await prisma.creditAccount.updateMany({
    where: { id: accountId, userId, billId: null },
    data: { billId: created.bill.id },
  });
  if (count === 0) {
    await prisma.scheduledTransaction.delete({ where: { id: created.bill.id } });
    return fail("REMINDER_EXISTS");
  }
  return { ok: true, billId: created.bill.id };
};

/** Unlink a card's reminder. The bill itself stays, with its history; it is switched off on Bills. */
export const removeCardReminder = async ({
  prisma,
  userId,
  accountId,
}: {
  prisma: PrismaClient;
  userId: string;
  accountId: string;
}): Promise<{ ok: true } | Failure> => {
  const { count } = await prisma.creditAccount.updateMany({
    where: { id: accountId, userId },
    data: { billId: null },
  });
  return count > 0 ? { ok: true } : fail("NOT_FOUND");
};
