/**
 * Checks that deleting an MCP token removes the credential and nothing else.
 *
 * The part worth proving against a real database is what does *not* happen. `transactions.
 * mcp_token_id` is deliberately not a foreign key, so a delete must leave the rows that token
 * wrote exactly where they are. A schema change that made it one would cascade a user's
 * transactions away on a tidy-up, and no unit test would notice.
 *
 * Talks to Prisma directly rather than over HTTP, since the route is session-authenticated and
 * the guard being checked is the database behaviour underneath it.
 *
 *   pnpm exec tsx scripts/verify-token-delete.ts
 */
import { PrismaClient } from "@prisma/client";
import { mintMcpToken } from "../src/lib/mcp/tokens";

const prisma = new PrismaClient();
const EMAIL = "token-delete-probe@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
};

async function main() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { name: "Token delete probe", email: EMAIL, password: "x", timezoneOffset: -480 },
    select: { id: true },
  });

  try {
    const category = await prisma.category.findFirst({
      where: { type: "EXPENSE", isDefault: true },
      select: { id: true },
    });
    if (!category) throw new Error("no default expense category; run pnpm db:seed");

    const minted = await mintMcpToken({
      userId: user.id,
      name: "doomed",
      scopes: ["budget:read", "transactions:write"],
      expiresInDays: 30,
    });

    // A row this token wrote, with the provenance the audit trail depends on.
    const tx = await prisma.transaction.create({
      data: {
        userId: user.id,
        categoryId: category.id,
        amount: 100,
        description: "Written by the doomed token",
        type: "EXPENSE",
        date: new Date(),
        createdVia: "MCP",
        mcpTokenId: minted.record.id,
      },
      select: { id: true },
    });

    await prisma.mcpToken.update({
      where: { id: minted.record.id },
      data: { revokedAt: new Date() },
    });
    await prisma.mcpToken.deleteMany({ where: { id: minted.record.id, userId: user.id } });

    check(
      "the token row is gone",
      await prisma.mcpToken.count({ where: { id: minted.record.id } }),
      0
    );

    // The point of the whole exercise: tidying up credentials must not touch the ledger.
    const survivor = await prisma.transaction.findUnique({
      where: { id: tx.id },
      select: { id: true, createdVia: true, mcpTokenId: true, amount: true },
    });
    check("the transaction it wrote still exists", survivor !== null, true);
    check("its provenance is unchanged", survivor?.createdVia, "MCP");
    check(
      "it still records which token wrote it, even though the token is gone",
      survivor?.mcpTokenId,
      minted.record.id
    );
    check("its amount was not touched", Number(survivor?.amount), 100);
  } finally {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
