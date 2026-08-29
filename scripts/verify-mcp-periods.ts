/**
 * Drives the real stdio MCP server against a real database and checks the period, localDate and
 * totals behaviour end to end.
 *
 * Separate from the vitest suite for the reason the other `verify-*` scripts are: those stub
 * Prisma, so none of them would notice a `groupBy` returning the wrong shape, a date bound that
 * means something else once Postgres sees it, or an aggregate that disagrees with the rows.
 *
 *   BUDGET_USER_ID=<id> DATABASE_URL=<url> pnpm exec tsx scripts/verify-mcp-periods.ts
 *
 * The window defaults to 2026-08-24..29 and can be overridden with FROM/TO. The checks need a
 * user whose data actually exercises them, so the preflight below states exactly what is missing
 * rather than letting a thin fixture surface as a wall of failures that look like regressions.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const USER = process.env.BUDGET_USER_ID;
const DB = process.env.DATABASE_URL;
const FROM = process.env.FROM ?? "2026-08-24";
const TO = process.env.TO ?? "2026-08-29";

interface Period {
  month: string | null;
  from: string | null;
  to: string | null;
}
interface Row {
  amount: number;
  description: string;
  date: string;
  localDate: string;
  categoryName: string;
  categoryIcon?: string;
  receiptGroupId: string | null;
}
interface Totals {
  count: number;
  income: number;
  expenses: number;
  net: number;
  byCategory: Array<{ categoryName: string; amount: number; count: number }>;
}
interface SearchResult {
  transactions: Row[];
  period: Period | null;
  totals: Totals;
  pagination: { total: number };
}
interface Overview {
  month: string | null;
  period: Period;
  today: string;
  timezoneOffset: number;
}
interface CategoryResult {
  categories: Array<{ name: string; amount: number }>;
  period: Period;
}
interface LabelResult {
  period: Period;
  total: number;
}
interface TopResult {
  expenses: Array<{ localDate: string }>;
}

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Missing fixture data is a different outcome from a regression, and says so. */
const unusable = (reason: string): never => {
  console.error(`\nCannot run: ${reason}`);
  console.error(
    `\nThis script needs a user with expense rows spanning ${FROM}..${TO}, at least one of them ` +
      `recorded late enough in the local evening to fall on a different UTC day, and at least ` +
      `one receipt split across categories. Point FROM/TO at a window that has them, or use a ` +
      `database seeded from real usage.`
  );
  process.exit(2);
};

const main = async () => {
  if (!USER || !DB) unusable("BUDGET_USER_ID and DATABASE_URL must both be set.");

  const transport = new StdioClientTransport({
    command: "pnpm",
    args: ["exec", "tsx", "mcp-server/src/index.ts"],
    env: { ...process.env, BUDGET_USER_ID: USER, DATABASE_URL: DB } as Record<string, string>,
  });
  const client = new Client({ name: "verify-periods", version: "1.0.0" });
  await client.connect(transport);

  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = await client.callTool({ name, arguments: args });
    return res.structuredContent as T;
  };

  const window = { from: FROM, to: TO, type: "EXPENSE", limit: 100 } as const;

  // --- preflight ------------------------------------------------------------------
  const overview = await call<Overview>("get_budget_overview");
  const week = await call<SearchResult>("search_transactions", {
    ...window,
    sortBy: "date",
    sortDir: "desc",
  });

  if (week.totals.count === 0) unusable(`no expense rows between ${FROM} and ${TO}.`);
  const crossers = week.transactions.filter((t) => t.date.slice(0, 10) !== t.localDate);
  if (crossers.length === 0) {
    unusable(
      `no row in ${FROM}..${TO} has a UTC day different from its local day, so the localDate ` +
        `check would pass without proving anything (offset is ${overview.timezoneOffset}).`
    );
  }
  const grouped = week.transactions.filter((t) => t.receiptGroupId);
  if (grouped.length === 0) unusable(`no scanned receipt was split across categories in the window.`);

  console.log(`\ntools exposed: ${(await client.listTools()).tools.length}`);
  console.log(`window ${FROM}..${TO}: ${week.totals.count} expense rows, offset ${overview.timezoneOffset}`);

  // --- 1. today / timezoneOffset ---------------------------------------------------
  console.log("\n[1] get_budget_overview reports the user's clock");
  check("today is a YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(overview.today), overview.today);
  check("timezoneOffset is a number of minutes", Number.isInteger(overview.timezoneOffset), String(overview.timezoneOffset));
  check("period echoes the current month", overview.period.month === overview.month, JSON.stringify(overview.period));

  // --- 2. explicit range ------------------------------------------------------------
  console.log("\n[2] search_transactions over an explicit window");
  check("period echoed as given", JSON.stringify(week.period) === JSON.stringify({ month: null, from: FROM, to: TO }), JSON.stringify(week.period));
  const days = [...new Set(week.transactions.map((t) => t.localDate))].sort();
  check("every localDate falls inside the window", days.every((d) => d >= FROM && d <= TO), days.join(" "));
  check("the last day of the range is included", days.includes(TO), "days: " + days.join(" "));

  // --- 3. totals vs rows --------------------------------------------------------------
  console.log("\n[3] totals are computed over every match");
  const summed = week.transactions.reduce((s, t) => s + t.amount, 0);
  check("totals.expenses equals the sum of the returned rows", Math.abs(summed - week.totals.expenses) < 0.005, `rows=${summed.toFixed(2)} totals=${week.totals.expenses.toFixed(2)}`);
  check("totals.count equals pagination.total", week.totals.count === week.pagination.total, `${week.totals.count} vs ${week.pagination.total}`);
  const byCatSum = week.totals.byCategory.reduce((s, c) => s + c.amount, 0);
  check("byCategory sums to the same figure", Math.abs(byCatSum - week.totals.expenses) < 0.005, byCatSum.toFixed(2));

  const page1 = await call<SearchResult>("search_transactions", { from: FROM, to: TO, type: "EXPENSE", limit: 3 });
  check("a 3-row page still reports the full total", Math.abs(page1.totals.expenses - week.totals.expenses) < 0.005, `page=${page1.transactions.length} rows, total=${page1.totals.expenses.toFixed(2)}`);

  // --- 4. the UTC/local boundary -------------------------------------------------------
  console.log("\n[4] localDate vs the raw UTC instant");
  check("at least one row's UTC day differs from its local day", crossers.length > 0, `${crossers.length} rows`);
  for (const c of crossers.slice(0, 3)) {
    console.log(`        ${c.date} -> ${c.localDate}  ${JSON.stringify(c.description).slice(0, 40)}`);
  }

  // --- 5. open and refused windows -----------------------------------------------------
  console.log("\n[5] open ends are honoured, bad windows refused");
  const since = await call<SearchResult>("search_transactions", { from: FROM, type: "EXPENSE", limit: 1 });
  check("an open end is a real query, not an error", since.totals.count >= week.totals.count, `since ${FROM}: ${since.totals.count} >= window ${week.totals.count}`);
  check("and is echoed as open", since.period?.to === null, JSON.stringify(since.period));

  const refuse = async (label: string, args: Record<string, unknown>, needle: string) => {
    const res = await client.callTool({ name: "search_transactions", arguments: args });
    const text = (res.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
    check(label, res.isError === true && text.includes(needle), text.slice(0, 70));
  };
  await refuse("month + from is refused", { month: FROM.slice(0, 7), from: FROM }, "not both");
  await refuse("2026-02-31 is refused", { from: "2026-02-31" }, "not a real date");
  await refuse("backwards range is refused", { from: TO, to: FROM }, "is after");

  // --- 6. compact + receiptGroupId -------------------------------------------------------
  console.log("\n[6] compact and receipt grouping");
  const compact = await call<SearchResult>("search_transactions", { from: FROM, to: TO, limit: 5, compact: true });
  const row = compact.transactions[0];
  check("categoryIcon absent under compact", !("categoryIcon" in row), Object.keys(row).join(","));
  check("categoryName still present", typeof row.categoryName === "string", row.categoryName);
  check("receiptGroupId exposed on split-receipt rows", grouped.length > 0, `${grouped.length} rows across ${new Set(grouped.map((t) => t.receiptGroupId)).size} receipt(s)`);

  // --- 7. the other range-taking tools -----------------------------------------------------
  console.log("\n[7] the range reaches the aggregate tools");
  const cats = await call<CategoryResult>("get_spending_by_category", { from: FROM, to: TO });
  const catTotal = cats.categories.reduce((s, c) => s + c.amount, 0);
  check("get_spending_by_category agrees with search totals", Math.abs(catTotal - week.totals.expenses) < 0.005, catTotal.toFixed(2));
  check("and echoes the period", cats.period.from === FROM, JSON.stringify(cats.period));

  const labels = await call<LabelResult>("get_label_breakdown", { from: FROM, to: TO });
  check("get_label_breakdown accepts a range", labels.period.to === TO, JSON.stringify(labels.period));
  check("label total matches", Math.abs(labels.total - week.totals.expenses) < 0.005, labels.total.toFixed(2));

  const top = await call<TopResult>("get_top_expenses", { from: FROM, to: TO, limit: 3 });
  check("get_top_expenses rows carry localDate", top.expenses.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.localDate)), top.expenses.map((e) => e.localDate).join(" "));

  await client.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
