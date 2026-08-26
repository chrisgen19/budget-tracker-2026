import https from "https";
import dns from "dns";
import path from "path";

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  // Ignore if already in process.env
}
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GoogleGenAI } from "@google/genai";
/**
 * The bot talks to the deployed app over MCP rather than to a database.
 *
 * Reaching for Prisma directly meant it went around every control the endpoint enforces: the
 * token scope, the write lease, the rate limit and the audit trail. It also tied the bot to
 * whatever `DATABASE_URL` happened to point at, which was the local development copy, so nothing
 * it wrote ever reached the real budget.
 *
 * As an MCP client it needs no database credentials at all, and the token decides whose budget it
 * touches and what it may do there.
 */
const MCP_URL = process.env.TELEGRAM_MCP_URL ?? "https://budget.cgdev.site/api/mcp";
const MCP_TOKEN = process.env.TELEGRAM_MCP_TOKEN;
/** Only used for display; the server owns every amount and every date boundary. */
const SYMBOL = process.env.TELEGRAM_CURRENCY_SYMBOL ?? "\u20B1";

/**
 * The user's timezone offset in minutes, `getTimezoneOffset()` convention so UTC+8 is -480.
 *
 * Needed only so Gemini can resolve "yesterday" and "last night" into a date. Every query and
 * every write is resolved server-side against `users.timezone_offset`, so this affects nothing
 * else and a wrong value cannot put a transaction in the wrong month.
 *
 * Defaults to the host's own offset, which is right whenever the bot runs near the user. Set
 * TELEGRAM_TZ_OFFSET when it does not, such as on a UTC server.
 */
const TZ_OFFSET = Number.isFinite(Number(process.env.TELEGRAM_TZ_OFFSET))
  ? Number(process.env.TELEGRAM_TZ_OFFSET)
  : new Date().getTimezoneOffset();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not set in environment or .env");
  process.exit(1);
}

/**
 * One client for the process, reconnected on failure.
 *
 * A client per call would be tidier but costs an extra initialize round trip each time, and the
 * endpoint's rate limit is 300 requests per 15 minutes per token. Holding one keeps a chatty
 * session well inside that.
 */
let mcp: Client | null = null;

async function mcpClient(): Promise<Client> {
  if (mcp) return mcp;
  if (!MCP_TOKEN) throw new Error("TELEGRAM_MCP_TOKEN is not set");
  const client = new Client({ name: "telegram-bot", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { "x-api-key": MCP_TOKEN } },
    })
  );
  mcp = client;
  return client;
}

/**
 * Call one MCP tool.
 *
 * A tool that reports `isError` is surfaced as a thrown error carrying the server's own message,
 * which is written for a model but reads well enough for a chat reply: "writes are switched off",
 * "that category is not yours". Any failure drops the client so the next call reconnects rather
 * than reusing a transport that may be finished.
 */
async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    const client = await mcpClient();
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const text = (result.content as { type: string; text?: string }[] | undefined)?.[0]?.text;
      throw new Error(text ?? `${name} failed`);
    }
    return result.structuredContent as T;
  } catch (err) {
    mcp = null;
    throw err;
  }
}

// Custom HTTPS Agent to resolve api.telegram.org directly to IP if DNS is sinkholed by firewall
const agent = new https.Agent({
  lookup: (hostname, options: any, callback: any) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (hostname === "api.telegram.org") {
      if (options && options.all) {
        return callback(null, [{ address: "149.154.166.110", family: 4 }]);
      }
      return callback(null, "149.154.166.110", 4);
    }
    return dns.lookup(hostname, options, callback);
  },
  // Verification stays ON. Disabling it would let anything positioned between here and Telegram
  // read the bot token and every message. The DNS override above already handles a sinkholed
  // resolver; a certificate that does not verify is a different problem and should be fixed by
  // pointing NODE_EXTRA_CA_CERTS at the intercepting root, not by trusting everything.
  rejectUnauthorized: true,
  servername: "api.telegram.org",
});

async function telegramApi(method: string, body: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = https.request(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) {
              resolve(parsed.result);
            } else {
              reject(new Error(parsed.description || "Telegram API error"));
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      }
    );

    req.on("error", (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

async function sendMessage(chatId: number | string, text: string, parseMode: "Markdown" | "HTML" = "Markdown") {
  try {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    });
  } catch {
    // If Markdown parsing fails due to unescaped special characters, fall back to plain text
    try {
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text,
      });
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  }
}

// Gemini setup
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

function getCurrentMonthKey(tzOffset: number): string {
  const now = new Date();
  const local = new Date(now.getTime() - tzOffset * 60_000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** What `create_transactions` returns; see `renderCreated` in the MCP server. */
interface CreatedBatch {
  created: number;
  replayed: boolean;
  transactions: {
    id: string;
    amount: number;
    description: string;
    type: string;
    /** The user's own calendar day, already resolved server-side. */
    date: string;
    categoryName: string;
    /** Label names, including any the user's auto-apply schedules added. */
    labels: string[];
  }[];
}

const formatCreated = (result: CreatedBatch): string => {
  const tx = result.transactions[0];
  const labels = tx.labels.join(", ");
  // A replay wrote nothing: the same update was redelivered after a crash, so saying "logged"
  // would imply a second row that does not exist.
  let reply = result.replayed
    ? `\u2705 *Already logged* (no duplicate created)\n\n`
    : `\u2705 *Transaction Logged!*\n\n`;
  reply += `\ud83d\udcdd *Description:* ${tx.description}\n`;
  reply += `\ud83d\udcb0 *Amount:* ${SYMBOL}${tx.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  reply += `\ud83d\udcc1 *Category:* ${tx.categoryName}\n`;
  reply += `\ud83d\udcc5 *Date:* ${tx.date}\n`;
  if (labels) reply += `\ud83c\udff7\ufe0f *Labels:* ${labels}\n`;
  return reply;
};

async function handleSummary(chatId: number) {
  // No month is passed: the server resolves the current month in the user's own timezone, which
  // is the whole reason those queries take an offset.
  const summary = await callTool<{
    month: string;
    totalIncome: number;
    totalExpenses: number;
    net: number;
  }>("get_budget_overview");
  const spending = await callTool<{
    categories: { name: string; amount: number; percentage: number }[];
  }>("get_spending_by_category");

  const savingsRate =
    summary.totalIncome > 0 ? Math.round((summary.net / summary.totalIncome) * 100) : 0;

  let msg = `\ud83d\udcca *Budget Summary for ${summary.month}*\n\n`;
  msg += `\ud83d\udcb0 *Total Income:* ${SYMBOL}${summary.totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  msg += `\ud83d\udcb8 *Total Expenses:* ${SYMBOL}${summary.totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  msg += `\ud83e\ude99 *Net Balance:* ${SYMBOL}${summary.net.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  msg += `\ud83d\udcc8 *Savings Rate:* ${savingsRate}%\n\n`;

  if (spending.categories.length > 0) {
    msg += `\ud83d\udcc1 *Top Spending Categories:*\n`;
    for (const cat of spending.categories.slice(0, 5)) {
      msg += `\u2022 ${cat.name}: ${SYMBOL}${cat.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${cat.percentage}%)\n`;
    }
  } else {
    msg += `No expense records yet this month.\n`;
  }

  await sendMessage(chatId, msg);
}

async function handleRecent(chatId: number) {
  const result = await callTool<{
    transactions: {
      amount: number;
      description: string;
      type: string;
      date: string;
      categoryName: string;
      labels: { name: string }[];
    }[];
  }>("search_transactions", { limit: 5, sortBy: "date", sortDir: "desc" });

  if (result.transactions.length === 0) {
    await sendMessage(chatId, "No transactions found.");
    return;
  }

  let msg = `\ud83d\udd52 *Recent Transactions:*\n\n`;
  for (const t of result.transactions) {
    const icon = t.type === "INCOME" ? "\u2795" : "\u2796";
    const labels = t.labels.map((l) => l.name).join(", ");
    msg += `${icon} *${SYMBOL}${t.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}* - ${t.description || t.categoryName}\n`;
    msg += `   \ud83d\udcc1 ${t.categoryName} | \ud83d\udcc5 ${t.date.slice(0, 10)}${labels ? ` | \ud83c\udff7\ufe0f ${labels}` : ""}\n\n`;
  }

  await sendMessage(chatId, msg);
}

async function handleBills(chatId: number) {
  const result = await callTool<{
    bills: {
      description: string;
      categoryName: string;
      amount: number;
      dueDate: string;
      isOverdue: boolean;
    }[];
  }>("get_upcoming_bills", { days: 30 });

  if (result.bills.length === 0) {
    await sendMessage(chatId, "\ud83c\udf89 No upcoming bills due in the next 30 days!");
    return;
  }

  let msg = `\ud83d\udcc5 *Upcoming Bills (Next 30 Days):*\n\n`;
  for (const b of result.bills) {
    const due = new Date(b.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    msg += `\u2022 *${b.description || b.categoryName}*: ${SYMBOL}${b.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
    msg += `   Due: ${due}${b.isOverdue ? " (overdue)" : ""}\n\n`;
  }

  await sendMessage(chatId, msg);
}

async function handleCategories(chatId: number) {
  const result = await callTool<{ categories: { name: string; type: string }[] }>(
    "get_category_list"
  );

  const named = (type: string) =>
    result.categories
      .filter((c) => c.type === type)
      .map((c) => `\u2022 ${c.name}`)
      .join("\n");

  let msg = `\ud83d\udcc1 *Available Categories:*\n\n`;
  msg += `*Expense Categories:*\n${named("EXPENSE")}`;
  msg += `\n\n*Income Categories:*\n${named("INCOME")}`;

  await sendMessage(chatId, msg);
}

async function processNaturalLanguageWithGemini(
  text: string,
  categories: { id: string; name: string; type: string }[]
): Promise<any> {
  if (!gemini) return null;

  const now = new Date();
  const localIso = new Date(now.getTime() - TZ_OFFSET * 60_000).toISOString();
  const categoryNames = categories.map((c) => ({ name: c.name, type: c.type, id: c.id }));

  const prompt = `You are an AI assistant for a personal budget tracker.
Current timestamp in user timezone: ${localIso}
User's categories: ${JSON.stringify(categoryNames)}

Analyze the user's message: "${text}"

Determine if the user wants to log an expense/income transaction or ask a question.
If logging a transaction:
- amount: positive number
- description: concise title (e.g. "Breakfast", "Jollibee lunch", "Salary")
- type: "EXPENSE" or "INCOME"
- categoryId: best matching category ID from the provided list
- date: ISO timestamp string (e.g. "2026-08-26T08:30:00") matching when it occurred, or current timestamp

Return ONLY a JSON object in this format:
{
  "action": "CREATE_TRANSACTION" | "ANSWER_QUERY",
  "transaction": {
    "amount": number,
    "description": string,
    "type": "EXPENSE" | "INCOME",
    "categoryId": string,
    "date": string
  } | null,
  "replyText": string | null
}`;

  try {
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return parsed;
  } catch (err) {
    console.error("Gemini parse error:", err);
    return null;
  }
}

async function handleMessage(message: any, updateId: number) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (!text) return;

  // Commands
  if (text.startsWith("/start") || text.startsWith("/help")) {
    const msg =
      `👋 *Welcome to Budget Tracker Bot!*\n\n` +
      `💼 *Currency:* ${SYMBOL}\n\n` +
      `⚡ *Quick Logging:*\n` +
      `Just type your expense or income naturally:\n` +
      `• \`100 breakfast\`\n` +
      `• \`250 jollibee lunch\`\n` +
      `• \`1500 internet bill\`\n` +
      `• \`+5000 freelance payout\`\n` +
      `• \`spent 350 for groceries yesterday\`\n\n` +
      `📌 *Commands:*\n` +
      `• /summary - This month's balance & top spending\n` +
      `• /recent - Last 5 transactions\n` +
      `• /bills - Upcoming scheduled bills\n` +
      `• /categories - List all categories\n` +
      `• /help - Show this guide`;
    await sendMessage(chatId, msg);
    return;
  }

  if (text === "/summary" || text === "/balance") {
    await handleSummary(chatId);
    return;
  }

  if (text === "/recent") {
    await handleRecent(chatId);
    return;
  }

  if (text === "/bills") {
    await handleBills(chatId);
    return;
  }

  if (text === "/categories") {
    await handleCategories(chatId);
    return;
  }

  // Fast Regex Shorthand Matching: e.g. "100 breakfast" or "+5000 salary" or "250.50 lunch"
  const quickExpenseMatch = /^(\d+(?:\.\d+)?)\s+(.+)$/i.exec(text);
  const quickIncomeMatch = /^\+(\d+(?:\.\d+)?)\s+(.+)$/i.exec(text);

  const { categories } = await callTool<{ categories: { id: string; name: string; type: string }[] }>(
    "get_category_list"
  );

  if (quickIncomeMatch || quickExpenseMatch) {
    const isIncome = !!quickIncomeMatch;
    const match = isIncome ? quickIncomeMatch! : quickExpenseMatch!;
    const amount = parseFloat(match[1]);
    const description = match[2].trim();

    if (amount > 0 && description) {
      // Find best category match
      const type = isIncome ? "INCOME" : "EXPENSE";
      const matchingCats = categories.filter((c) => c.type === type);
      const descLower = description.toLowerCase();

      let matchedCat = matchingCats.find((c) => descLower.includes(c.name.toLowerCase()));
      if (!matchedCat) {
        if (isIncome) {
          matchedCat = matchingCats.find((c) => c.name.toLowerCase().includes("income") || c.name.toLowerCase().includes("salary")) || matchingCats[0];
        } else {
          // Defaults for food, transport, bills
          if (/breakfast|lunch|dinner|coffee|food|snack|jollibee|mcdo|kfc|eat|restaurant/i.test(descLower)) {
            matchedCat = matchingCats.find((c) => c.name.toLowerCase().includes("food"));
          } else if (/grab|angkas|taxi|bus|jeep|gas|fare|fuel|transport/i.test(descLower)) {
            matchedCat = matchingCats.find((c) => c.name.toLowerCase().includes("transport"));
          } else if (/shopee|lazada|mall|clothes|shopping/i.test(descLower)) {
            matchedCat = matchingCats.find((c) => c.name.toLowerCase().includes("shopping"));
          } else if (/bill|meralco|water|electric|internet|wifi/i.test(descLower)) {
            matchedCat = matchingCats.find((c) => c.name.toLowerCase().includes("utilities"));
          }
        }
      }

      if (!matchedCat) {
        matchedCat = matchingCats[0];
      }

      const now = new Date();
      // Derived from the Telegram update id, not the clock. The poller advances its offset
      // *before* handling a message and keeps it only in memory, so a crash mid-write makes
      // Telegram redeliver that update on restart. A random key would write the transaction
      // twice; a stable one replays and returns the original row.
      const clientBatchId = `telegram-${updateId}`;

      const result = await callTool<CreatedBatch>("create_transactions", {
        clientBatchId,
        transactions: [
          {
            amount,
            description: description.charAt(0).toUpperCase() + description.slice(1),
            type: isIncome ? "INCOME" : "EXPENSE",
            categoryId: matchedCat.id,
            date: now.toISOString(),
          },
        ],
      });

      if (result.transactions.length > 0) {
        await sendMessage(chatId, formatCreated(result));
        return;
      }
    }
  }

  // Fallback to Gemini AI natural language processing
  if (gemini) {
    const aiResult = await processNaturalLanguageWithGemini(text, categories);
    if (aiResult?.action === "CREATE_TRANSACTION" && aiResult.transaction) {
      const txData = aiResult.transaction;
      // Derived from the Telegram update id, not the clock. The poller advances its offset
      // *before* handling a message and keeps it only in memory, so a crash mid-write makes
      // Telegram redeliver that update on restart. A random key would write the transaction
      // twice; a stable one replays and returns the original row.
      const clientBatchId = `telegram-${updateId}`;
      const result = await callTool<CreatedBatch>("create_transactions", {
        clientBatchId,
        transactions: [
          {
            amount: txData.amount,
            description: txData.description,
            type: txData.type,
            categoryId: txData.categoryId,
            date: txData.date || new Date().toISOString(),
          },
        ],
      });

      if (result.transactions.length > 0) {
        await sendMessage(chatId, formatCreated(result));
        return;
      }
    }

    if (aiResult?.replyText) {
      await sendMessage(chatId, aiResult.replyText);
      return;
    }
  }

  await sendMessage(
    chatId,
    `I couldn't understand that command. Try logging an expense like:\n\`100 breakfast\`\nor type /help for options.`
  );
}

/**
 * Who may talk to this bot.
 *
 * Telegram bot usernames are searchable and the t.me link is public, so without this every
 * stranger who finds the bot can read the owner's balances and write transactions into their
 * budget. The bot resolves one budget account at startup and acts as that account for whoever
 * messages it, so the sender check is the *only* thing standing between a passer-by and the
 * owner's finances.
 *
 * Numeric IDs are the real identifier: they are permanent and cannot be transferred. Usernames
 * are accepted for convenience but are weaker, because a released @handle can be claimed by
 * someone else, who would then inherit access. Prefer IDs and treat usernames as a stepping
 * stone.
 *
 * Empty means deny everyone. Failing closed matters more than failing usefully here.
 */
const ALLOWED_IDS = new Set(
  (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean)
);
const ALLOWED_USERNAMES = new Set(
  (process.env.TELEGRAM_ALLOWED_USERNAMES ?? "")
    .split(",")
    .map((v) => v.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)
);

const senderIsAllowed = (from: { id?: number; username?: string } | undefined): boolean => {
  if (!from) return false;
  if (from.id !== undefined && ALLOWED_IDS.has(String(from.id))) return true;
  return from.username !== undefined && ALLOWED_USERNAMES.has(from.username.toLowerCase());
};

async function startBot() {
  console.log("Starting Budget Telegram Bot...");

  if (!MCP_TOKEN) {
    console.error(
      "TELEGRAM_MCP_TOKEN is not set. Mint one in Profile > MCP Access with the\n" +
        "transactions:write scope, then set TELEGRAM_MCP_TOKEN in .env."
    );
    process.exit(1);
  }

  // Proves the token before serving anyone, so a bad credential fails here rather than as a
  // confusing reply to the first message.
  try {
    const client = await mcpClient();
    const { tools } = await client.listTools();
    const canWrite = tools.some((t) => t.name === "create_transactions");
    console.log(`Connected to ${MCP_URL}: ${tools.length} tools, write ${canWrite ? "enabled" : "NOT granted"}`);
    if (!canWrite) {
      console.warn("This token has no transactions:write scope, so logging will be refused.");
    }
  } catch (err: any) {
    console.error(`Could not reach the MCP endpoint at ${MCP_URL}: ${err.message}`);
    process.exit(1);
  }

  if (ALLOWED_IDS.size === 0 && ALLOWED_USERNAMES.size === 0) {
    console.error(
      "\nREFUSING TO SERVE: no allowlist configured.\n" +
        "Without one, anyone who finds this bot can read your balances and write transactions.\n" +
        "Set TELEGRAM_ALLOWED_IDS (preferred) or TELEGRAM_ALLOWED_USERNAMES in .env.\n" +
        "Message the bot once and its numeric id will be printed here.\n"
    );
  } else {
    console.log(
      `Allowlist: ${ALLOWED_IDS.size} id(s), ${ALLOWED_USERNAMES.size} username(s)` +
        (ALLOWED_USERNAMES.size > 0 ? " (usernames are weaker than ids; prefer ids)" : "")
    );
  }

  let offset = 0;

  while (true) {
    try {
      const updates = await telegramApi("getUpdates", {
        offset,
        timeout: 20,
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        if (!update.message) continue;

        const from = update.message.from;
        if (!senderIsAllowed(from)) {
          // The id is logged so it can be copied straight into TELEGRAM_ALLOWED_IDS. Nothing is
          // sent back: a reply would confirm to a stranger that the bot is live and whose it is.
          console.warn(
            `Denied message from id=${from?.id ?? "unknown"} username=@${from?.username ?? "none"}. ` +
              `Add the id to TELEGRAM_ALLOWED_IDS in .env to allow it.`
          );
          continue;
        }

        console.log(`Message from @${from?.username || from?.id}: ${update.message.text}`);
        await handleMessage(update.message, update.update_id);
      }
    } catch (err: any) {
      console.error("Polling error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

startBot().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
