import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { TokenType } from "@prisma/client";

const TOKEN_EXPIRY_HOURS: Record<TokenType, number> = {
  EMAIL_VERIFICATION: 24,
  PASSWORD_RESET: 1,
};

export const generateToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

export const createVerificationToken = async (
  userId: string,
  type: TokenType
) => {
  // Delete any existing tokens of this type for the user
  await prisma.verificationToken.deleteMany({
    where: { userId, type },
  });

  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS[type]);

  return prisma.verificationToken.create({
    data: {
      userId,
      token,
      type,
      expiresAt,
    },
  });
};

export const validateToken = async (token: string, type: TokenType) => {
  const record = await prisma.verificationToken.findUnique({
    where: { token },
  });

  if (!record || record.type !== type) {
    return null;
  }

  if (record.expiresAt < new Date()) {
    // Token expired — clean it up
    await prisma.verificationToken.delete({ where: { id: record.id } });
    return null;
  }

  return record;
};

export const deleteToken = async (id: string) => {
  await prisma.verificationToken.delete({ where: { id } });
};

/**
 * Check if a recent token exists for rate limiting.
 * Returns true if a token was created within the last `minutes` minutes.
 */
export const hasRecentToken = async (
  userId: string,
  type: TokenType,
  minutes: number
) => {
  const cutoff = new Date();
  cutoff.setMinutes(cutoff.getMinutes() - minutes);

  const existing = await prisma.verificationToken.findFirst({
    where: {
      userId,
      type,
      createdAt: { gt: cutoff },
    },
  });

  return !!existing;
};
