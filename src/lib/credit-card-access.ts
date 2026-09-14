import type { FeatureAccess, UserRole } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";

/** Until an admin switches it on, only admins have credit cards. */
export const DEFAULT_CREDIT_CARDS_ACCESS: FeatureAccess = "ADMIN";

/** Whether a role may use credit cards under the switch. Admins always may. */
export const canUseCreditCards = (role: UserRole, access: FeatureAccess): boolean =>
  role === "ADMIN" || access === "EVERYONE";

/** The switch as stored on /admin/settings, or the default when no admin has ever set it. */
export const readCreditCardsAccess = async (prisma: PrismaClient): Promise<FeatureAccess> => {
  const settings = await prisma.siteSettings.findUnique({
    where: { id: 1 },
    select: { creditCardsAccess: true },
  });
  return settings?.creditCardsAccess ?? DEFAULT_CREDIT_CARDS_ACCESS;
};

/**
 * Whether this user may use credit cards right now.
 *
 * The role is read from the database rather than the session: sessions are JWTs, so a role changed
 * on /admin would otherwise keep its old access until the token expired. A missing user may not.
 */
export const userCanUseCreditCards = async (prisma: PrismaClient, userId: string): Promise<boolean> => {
  const [user, access] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    readCreditCardsAccess(prisma),
  ]);
  return user ? canUseCreditCards(user.role, access) : false;
};
