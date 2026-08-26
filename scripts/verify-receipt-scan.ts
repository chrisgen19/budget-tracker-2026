/**
 * End-to-end check of `scan_receipt` over the real MCP endpoint.
 *
 * Covers what the unit tests cannot: the tool reached over HTTP with a scoped token, a real
 * Gemini call, and the scan-credit accounting that decides whether the user is charged. The
 * accounting is the point. Every other control has a unit test; "was the credit refunded when the
 * scan produced nothing usable" can only be answered against a real database and a real model.
 *
 * Creates and deletes its own throwaway user, so it never touches your own scan allowance.
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-receipt-scan.ts
 *
 * By default it runs only the checks that need no receipt, including a deliberate non-receipt
 * image. To also exercise a successful scan, point it at a photo of a real receipt:
 *
 *   RECEIPT=/path/to/receipt.jpg BASE_URL=... pnpm exec tsx scripts/verify-receipt-scan.ts
 *
 * Needs GEMINI_API_KEY in the environment the dev server is running with.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { mintMcpToken } from "../src/lib/mcp/tokens";
import { MAX_BASE64_LENGTH } from "../src/lib/receipt-limits";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ENDPOINT = new URL("/api/mcp", BASE_URL);
const RECEIPT = process.env.RECEIPT;
const prisma = new PrismaClient();
const EMAIL = "receipt-scan-probe@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

const report = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const connect = async (token: string) => {
  const client = new Client({ name: "receipt-scan-probe", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(ENDPOINT, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  return client;
};

const textOf = (res: unknown) =>
  ((res as { content?: { text?: string }[] }).content?.[0]?.text ?? "");

/** How the quota sees this user right now. */
const scanCounts = async (userId: string) => {
  const rows = await prisma.scanLog.groupBy({
    by: ["status"],
    where: { userId },
    _count: { _all: true },
  });
  const of = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { success: of("SUCCESS"), failed: of("FAILED"), pending: of("PENDING") };
};

async function main() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    // receiptScanEnabled is the user's own Profile toggle; ADMIN skips the per-role settings and
    // the monthly cap, which keeps this script independent of whatever AppSettings holds.
    data: {
      name: "Receipt scan probe",
      email: EMAIL,
      password: "x",
      timezoneOffset: -480,
      role: "ADMIN",
      receiptScanEnabled: true,
    },
    select: { id: true },
  });

  try {
    // --- Scope gating ---
    const readOnly = await mintMcpToken({
      userId: user.id,
      name: "read-only",
      scopes: ["budget:read", "transactions:read"],
      expiresInDays: 30,
    });
    const readClient = await connect(readOnly.token);
    const readNames = (await readClient.listTools()).tools.map((t) => t.name);
    await readClient.close();
    check("a token without receipts:scan cannot see the tool", readNames.includes("scan_receipt"), false);

    const scanToken = await mintMcpToken({
      userId: user.id,
      name: "scanner",
      scopes: ["budget:read", "receipts:scan"],
      expiresInDays: 30,
    });
    const client = await connect(scanToken.token);
    const tool = (await client.listTools()).tools.find((t) => t.name === "scan_receipt");
    report("a token with receipts:scan sees the tool", !!tool);
    check("the tool is not marked read-only, so clients prompt", tool?.annotations?.readOnlyHint, undefined);

    // --- Refusals that must not cost a credit ---
    const before = await scanCounts(user.id);

    const badBase64 = await client.callTool({
      name: "scan_receipt",
      arguments: { imageBase64: "!!!!not base64!!!!", mimeType: "image/jpeg" },
    });
    report("malformed base64 is refused", badBase64.isError === true, textOf(badBase64).slice(0, 60));

    const oversized = await client.callTool({
      name: "scan_receipt",
      arguments: { imageBase64: "A".repeat(MAX_BASE64_LENGTH + 4), mimeType: "image/jpeg" },
    });
    report("an oversized payload is refused by the schema", oversized.isError === true);

    const afterRefusals = await scanCounts(user.id);
    check(
      "no credit was reserved by any refusal",
      afterRefusals,
      before
    );

    // --- A real Gemini call on something that is not a receipt ---
    // bill.png in the repo root is a screenshot of the Bills page. It exercises the whole path,
    // including the refund, without needing a receipt to hand.
    const notReceipt = readFileSync("bill.png").toString("base64");
    const rejected = await client.callTool({
      name: "scan_receipt",
      arguments: { imageBase64: notReceipt, mimeType: "image/png" },
    });
    report(
      "a non-receipt image is rejected rather than invented",
      rejected.isError === true,
      textOf(rejected).slice(0, 70)
    );

    const afterReject = await scanCounts(user.id);
    check(
      "the credit was refunded, so a useless scan is not charged",
      { success: afterReject.success, pending: afterReject.pending },
      { success: before.success, pending: before.pending }
    );
    report(
      "the failed attempt is kept, so it still counts toward the rate limit",
      afterReject.failed === before.failed + 1,
      `FAILED rows ${before.failed} -> ${afterReject.failed}`
    );

    // --- A real receipt, only when one is supplied ---
    if (RECEIPT) {
      const bytes = readFileSync(RECEIPT);
      const mimeType = RECEIPT.endsWith(".png")
        ? "image/png"
        : RECEIPT.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";

      const scanned = await client.callTool({
        name: "scan_receipt",
        arguments: { imageBase64: bytes.toString("base64"), mimeType },
      });

      report("a real receipt scans", scanned.isError !== true, textOf(scanned).slice(0, 120));

      const out = scanned.structuredContent as Record<string, unknown> | undefined;
      if (out) {
        report("it returns a positive amount", typeof out.amount === "number" && (out.amount as number) > 0, String(out.amount));
        report("it returns a YYYY-MM-DD date", /^\d{4}-\d{2}-\d{2}$/.test(String(out.date)), String(out.date));

        // The category must be one the user can actually write to, or create_transactions would
        // reject it and the scan would be wasted.
        const owned = await prisma.category.findFirst({
          where: { id: String(out.categoryId), OR: [{ isDefault: true }, { userId: user.id }] },
          select: { id: true, name: true },
        });
        report("the category is one this user owns", !!owned, owned?.name ?? String(out.categoryId));
      }

      const afterScan = await scanCounts(user.id);
      report(
        "a usable scan spends exactly one credit",
        afterScan.success === afterReject.success + 1,
        `SUCCESS rows ${afterReject.success} -> ${afterScan.success}`
      );
      report("nothing was left reserved", afterScan.pending === 0, `PENDING ${afterScan.pending}`);

      // The tool must never write. Saving is create_transactions' job.
      const written = await prisma.transaction.count({ where: { userId: user.id } });
      check("scanning wrote no transaction", written, 0);
    } else {
      console.log("\nSKIP  real-receipt checks: set RECEIPT=/path/to/receipt.jpg to run them");
    }

    await client.close();
  } finally {
    // Cascades to the scan logs, tokens, and anything else this created.
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
