/**
 * Drives the real stdio MCP server against the local database and checks the new period,
 * localDate and totals behaviour end to end. Unit tests stub Prisma; this does not.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const USER = process.env.BUDGET_USER_ID!;
const DB = process.env.DATABASE_URL!;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

const main = async () => {
  const transport = new StdioClientTransport({
    command: "pnpm",
    args: ["exec", "tsx", "mcp-server/src/index.ts"],
    env: { ...process.env, BUDGET_USER_ID: USER, DATABASE_URL: DB } as Record<string, string>,
  });
  const client = new Client({ name: "verify-periods", version: "1.0.0" });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    return res.structuredContent as any;
  };

  const tools = (await client.listTools()).tools.map((t) => t.name);
  console.log(`\ntools exposed: ${tools.length}`);

  // --- 1. today / timezoneOffset -------------------------------------------------
  console.log("\n[1] get_budget_overview reports the user's clock");
  const overview = await call("get_budget_overview");
  check("today is a YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(overview.today ?? ""), overview.today);
  check("timezoneOffset is the stored -480", overview.timezoneOffset === -480, String(overview.timezoneOffset));
  check("period echoes the current month", overview.period?.month === overview.month, JSON.stringify(overview.period));

  // --- 2. explicit range ---------------------------------------------------------
  console.log("\n[2] search_transactions over an explicit week");
  const week = await call("search_transactions", {
    from: "2026-08-24",
    to: "2026-08-29",
    type: "EXPENSE",
    limit: 100,
    sortBy: "date",
    sortDir: "desc",
  });
  check("period echoed as given", JSON.stringify(week.period) === JSON.stringify({ month: null, from: "2026-08-24", to: "2026-08-29" }), JSON.stringify(week.period));
  const days = [...new Set(week.transactions.map((t: any) => t.localDate))].sort();
  check("every localDate falls inside the window", days.every((d: any) => d >= "2026-08-24" && d <= "2026-08-29"), days.join(" "));
  check("the last day of the range is included", days.includes("2026-08-29"), "days: " + days.join(" "));

  // --- 3. totals vs rows ---------------------------------------------------------
  console.log("\n[3] totals are computed over every match");
  const summed = week.transactions.reduce((s: number, t: any) => s + t.amount, 0);
  check(
    "totals.expenses equals the sum of the returned rows",
    Math.abs(summed - week.totals.expenses) < 0.005,
    `rows=${summed.toFixed(2)} totals=${week.totals.expenses.toFixed(2)}`
  );
  check("totals.count equals pagination.total", week.totals.count === week.pagination.total, `${week.totals.count} vs ${week.pagination.total}`);
  const byCatSum = week.totals.byCategory.reduce((s: number, c: any) => s + c.amount, 0);
  check("byCategory sums to the same figure", Math.abs(byCatSum - week.totals.expenses) < 0.005, byCatSum.toFixed(2));

  // one page only: totals must still describe the whole match
  const page1 = await call("search_transactions", { from: "2026-08-24", to: "2026-08-29", type: "EXPENSE", limit: 3 });
  check(
    "a 3-row page still reports the full total",
    Math.abs(page1.totals.expenses - week.totals.expenses) < 0.005,
    `page=${page1.transactions.length} rows, total=${page1.totals.expenses.toFixed(2)}`
  );

  // --- 4. the UTC/local boundary --------------------------------------------------
  console.log("\n[4] localDate vs the raw UTC instant");
  const crossers = week.transactions.filter((t: any) => t.date.slice(0, 10) !== t.localDate);
  check("at least one row's UTC day differs from its local day", crossers.length > 0, `${crossers.length} rows`);
  for (const c of crossers.slice(0, 3)) {
    console.log(`        ${c.date} -> ${c.localDate}  ${JSON.stringify(c.description).slice(0, 40)}`);
  }

  // --- 5. refusals ----------------------------------------------------------------
  console.log("\n[5] bad windows are refused, not half-applied");
  const refuse = async (label: string, args: Record<string, unknown>, needle: string) => {
    const res: any = await client.callTool({ name: "search_transactions", arguments: args });
    const text = res.content?.[0]?.text ?? "";
    check(label, res.isError === true && text.includes(needle), text.slice(0, 80));
  };
  await refuse("month + from is refused", { month: "2026-08", from: "2026-08-24" }, "not both");
  await refuse("2026-02-31 is refused", { from: "2026-02-31" }, "not a real date");
  await refuse("backwards range is refused", { from: "2026-08-29", to: "2026-08-24" }, "is after");

  // --- 6. compact + receiptGroupId -------------------------------------------------
  console.log("\n[6] compact and receipt grouping");
  const compact = await call("search_transactions", { from: "2026-08-24", to: "2026-08-29", limit: 5, compact: true });
  const row = compact.transactions[0];
  check("categoryIcon absent under compact", !("categoryIcon" in row), Object.keys(row).join(","));
  check("categoryName still present", typeof row.categoryName === "string", row.categoryName);
  const groups = week.transactions.filter((t: any) => t.receiptGroupId);
  const distinct = new Set(groups.map((t: any) => t.receiptGroupId));
  check("receiptGroupId exposed on split-receipt rows", groups.length > 0, `${groups.length} rows across ${distinct.size} receipt(s)`);

  // --- 7. the other range-taking tools ---------------------------------------------
  console.log("\n[7] the range reaches the aggregate tools");
  const cats = await call("get_spending_by_category", { from: "2026-08-24", to: "2026-08-29" });
  const catTotal = cats.categories.reduce((s: number, c: any) => s + c.amount, 0);
  check("get_spending_by_category agrees with search totals", Math.abs(catTotal - week.totals.expenses) < 0.005, catTotal.toFixed(2));
  check("and echoes the period", cats.period?.from === "2026-08-24", JSON.stringify(cats.period));

  const labels = await call("get_label_breakdown", { from: "2026-08-24", to: "2026-08-29" });
  check("get_label_breakdown accepts a range", labels.period?.to === "2026-08-29", JSON.stringify(labels.period));
  check("label total matches", Math.abs(labels.total - week.totals.expenses) < 0.005, labels.total.toFixed(2));

  const top = await call("get_top_expenses", { from: "2026-08-24", to: "2026-08-29", limit: 3 });
  check("get_top_expenses rows carry localDate", top.expenses.every((e: any) => /^\d{4}-\d{2}-\d{2}$/.test(e.localDate)), top.expenses.map((e: any) => e.localDate).join(" "));

  await client.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
