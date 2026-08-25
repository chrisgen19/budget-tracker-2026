/**
 * stdio entry point for the budget MCP server.
 *
 * The tools themselves live in `src/lib/mcp/server.ts` inside the app, so this transport and
 * the HTTP one at `/api/mcp` register the same 12 tools from one definition. A copy here would
 * drift the moment a tool changed on either side, and nothing would catch it.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrismaClient } from "@prisma/client";
import { createBudgetMcpServer } from "../../src/lib/mcp/server.js";

const userId = process.env.BUDGET_USER_ID;

if (!userId) {
  console.error("BUDGET_USER_ID environment variable is required");
  process.exit(1);
}

const prisma = new PrismaClient();

const main = async () => {
  // Resolve the user before serving anything. Without this a typo'd BUDGET_USER_ID
  // connects happily and every tool returns zeros and empty arrays, which reads as
  // "you have no transactions" rather than "you are misconfigured".
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  });

  if (!user) {
    console.error(
      `No user found for BUDGET_USER_ID="${userId}". Check the id against the User table ` +
        `(pnpm db:studio) and that DATABASE_URL points at the right database.`
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // Resolved before `connect()`, so no tool handler can observe a placeholder offset:
  // a handler only runs in response to a request, and requests cannot arrive until the
  // transport is connected.
  const server = createBudgetMcpServer({
    prisma,
    userId,
    timezoneOffset: user.timezoneOffset,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Claude Desktop stops the server by signalling it. Release the pool explicitly rather
  // than leaving it to process teardown.
  const shutdown = async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
