// `node:` prefixed so the Next server bundle resolves them as built-ins rather than looking for
// browser polyfills, which is what the bare specifiers made it do.
import https from "node:https";
import dns from "node:dns";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GoogleGenAI } from "@google/genai";
import { updateBatchId } from "@/lib/telegram/batch-id";
import { localDay, localTimestamp } from "@/lib/telegram/local-time";
import { messageIsAllowed, type Allowlist, type TelegramMessage } from "@/lib/telegram/allowlist";
import { McpToolError, UnconfirmedWriteError, replyForError } from "@/lib/telegram/errors";
import { isPlainShorthand } from "@/lib/telegram/shorthand";
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
/**
 * An environment variable, with blank treated as unset.
 *
 * `??` only catches `undefined`, and a Coolify field or a `.env.example` line left as `""` is an
 * empty string. That made `TELEGRAM_CURRENCY_SYMBOL=""` render every amount with no symbol, and
 * `TELEGRAM_TZ_OFFSET=""` silently mean UTC, since `Number("")` is a perfectly finite 0.
 */
const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const MCP_URL = env("TELEGRAM_MCP_URL") ?? "https://budget.cgdev.site/api/mcp";
const MCP_TOKEN = env("TELEGRAM_MCP_TOKEN");
/** Only used for display; the server owns every amount and every date boundary. */
const SYMBOL = env("TELEGRAM_CURRENCY_SYMBOL") ?? "\u20B1";

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
const TZ_OFFSET = Number.isFinite(Number(env("TELEGRAM_TZ_OFFSET")))
  ? Number(env("TELEGRAM_TZ_OFFSET"))
  : new Date().getTimezoneOffset();

const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");

/** The numeric half of the bot token, which identifies the bot and is not the secret half. */
const BOT_ID = (BOT_TOKEN ?? "").split(":")[0];

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
 * A tool that reports `isError` is surfaced as a thrown `McpToolError` carrying the server's own
 * message. Any failure drops the client so the next call reconnects rather than reusing a
 * transport that may be finished.
 */
async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    const client = await mcpClient();
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const text = (result.content as { type: string; text?: string }[] | undefined)?.[0]?.text;
      throw new McpToolError(text ?? `${name} failed`);
    }
    return result.structuredContent as T;
  } catch (err) {
    mcp = null;
    throw err;
  }
}

/**
 * An address to use for api.telegram.org instead of asking the resolver.
 *
 * Only for a network whose DNS sinkholes Telegram, which is why the bot was written with an
 * address baked in. Hardcoding it is a liability rather than a safety net: Telegram rotates
 * these, and a rotation would then break every request even where DNS works perfectly. Unset by
 * default, so the resolver is used, and the deployed container needs nothing.
 */
const TELEGRAM_API_IP = env("TELEGRAM_API_IP");

const agent = new https.Agent({
  lookup: (hostname, options: any, callback: any) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (hostname === "api.telegram.org" && TELEGRAM_API_IP) {
      if (options && options.all) {
        return callback(null, [{ address: TELEGRAM_API_IP, family: 4 }]);
      }
      return callback(null, TELEGRAM_API_IP, 4);
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

/**
 * Longer than the 20-second `getUpdates` long poll, so a normal quiet period is never mistaken
 * for a stall. Without any timeout a socket that hangs open leaves the promise unsettled forever:
 * the poll loop awaits it, no error is ever raised, and the bot stops answering with nothing in
 * the logs to say why.
 */
const REQUEST_TIMEOUT_MS = 40_000;

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

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      // `setTimeout` alone only fires the event; the socket has to be destroyed for the request
      // to end, and the resulting error is what rejects the promise.
      req.destroy(new Error(`Telegram ${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

/**
 * Send a chat message, and report whether it actually landed.
 *
 * Two different failures are handled differently. Markdown that Telegram cannot parse is a 400
 * that will fail identically forever, so it falls back to plain text once. A network failure is
 * transient, so plain text is retried after a short pause.
 *
 * The return value matters for a confirmation: a write that committed and then failed to be
 * confirmed leaves the user believing nothing happened, and their resend arrives under a new
 * Telegram update id, so it writes a second row instead of replaying the first.
 */
async function sendMessage(
  chatId: number | string,
  text: string,
  parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<boolean> {
  try {
    await telegramApi("sendMessage", { chat_id: chatId, text, parse_mode: parseMode });
    return true;
  } catch {
    // Unescaped special characters in the text; plain text is the only thing that can work.
  }

  for (const delay of [0, 2_000]) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      await telegramApi("sendMessage", { chat_id: chatId, text });
      return true;
    } catch (err) {
      console.error("[telegram] failed to send a message:", err instanceof Error ? err.message : err);
    }
  }

  return false;
}

// Gemini setup
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

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

/**
 * Create transactions, retrying a transport failure under the *same* idempotency key.
 *
 * This is the only thing that can settle a lost response. If the batch committed and the reply
 * never arrived, replaying the key returns the original rows; if it never ran, the replay writes
 * them once. Either way the ambiguity is gone.
 *
 * It has to happen here rather than by asking the user to send the message again, because the key
 * is derived from the Telegram update id. A redelivery of the same update replays, but a message
 * the user retypes is a *new* update with a new key, so it would write a second row. Telling them
 * to resend was therefore advice that caused the duplicate it claimed to prevent.
 *
 * A server refusal is not retried: it is deterministic, and repeating it only delays the reply.
 */
async function createTransactions(
  clientBatchId: string,
  transactions: Record<string, unknown>[]
): Promise<CreatedBatch> {
  const delays = [0, 1_500, 4_000];

  for (const [attempt, delay] of delays.entries()) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      return await callTool<CreatedBatch>("create_transactions", { clientBatchId, transactions });
    } catch (err) {
      if (err instanceof McpToolError) throw err;
      if (attempt === delays.length - 1) {
        console.error(
          `[telegram] could not settle batch ${clientBatchId} after ${delays.length} attempts:`,
          err instanceof Error ? err.message : err
        );
        throw new UnconfirmedWriteError(`batch ${clientBatchId} unresolved`);
      }
    }
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new UnconfirmedWriteError(`batch ${clientBatchId} unresolved`);
}

/**
 * Confirm a write, and make an undelivered confirmation recoverable.
 *
 * The rows are already committed by the time this runs. If the confirmation cannot be delivered
 * the user sees nothing, assumes it failed, and resends: that arrives under a new Telegram update
 * id, so it derives a new idempotency key and writes a second row rather than replaying the
 * first. Retrying the send is what closes most of that window; the log line covers the rest by
 * naming the rows that exist, so a duplicate can be found instead of guessed at.
 */
async function confirmCreated(chatId: number, result: CreatedBatch): Promise<void> {
  if (await sendMessage(chatId, formatCreated(result))) return;

  console.error(
    "[telegram] wrote transactions but could not confirm them to the user. " +
      "A resend will create duplicates rather than replay. Rows: " +
      result.transactions.map((t) => t.id).join(", ")
  );
}

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
    msg += `   \ud83d\udcc1 ${t.categoryName} | \ud83d\udcc5 ${localDay(t.date, TZ_OFFSET)}${labels ? ` | \ud83c\udff7\ufe0f ${labels}` : ""}\n\n`;
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
    // Formatted in UTC on purpose. `nextDueDate` is stored as UTC midnight, so reading it in the
    // container's own zone showed the previous day on any host west of Greenwich. Every other
    // date the bot prints is a server-resolved string passed through untouched; this was the one
    // that re-derived a day locally.
    const due = new Date(b.dueDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
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

  const localIso = localTimestamp(TZ_OFFSET);
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
- date: ISO timestamp string (e.g. "2026-08-26T08:30:00") matching when it occurred, or the current timestamp above. Write it in the user's local time with NO "Z" and no offset suffix: the server resolves it against their timezone, and a "Z" would be read as UTC and shift the transaction by hours

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
    console.error("[telegram] Gemini parse error:", err);
    return null;
  }
}

async function handleMessage(message: TelegramMessage, updateId: number) {
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

  // Fast Regex Shorthand Matching: e.g. "100 breakfast" or "+5000 salary" or "250.50 lunch".
  // Skipped entirely when the text says *when* something happened: this path stamps the current
  // instant and has no way to express a date, so "350 groceries yesterday" was filed under today.
  const quick = isPlainShorthand(text);
  const quickExpenseMatch = quick ? /^(\d+(?:\.\d+)?)\s+(.+)$/i.exec(text) : null;
  const quickIncomeMatch = quick ? /^\+(\d+(?:\.\d+)?)\s+(.+)$/i.exec(text) : null;

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

      // `matchingCats[0]` on an empty list is undefined, and the id is read a few lines down.
      // Reaching that meant a TypeError surfacing as the generic error reply, with nothing in
      // the log naming the cause.
      if (!matchedCat) {
        await sendMessage(
          chatId,
          `You have no ${type} categories yet, so there is nothing to file this under. Add one in the app first.`
        );
        return;
      }

      const now = new Date();
      const clientBatchId = updateBatchId(BOT_ID, updateId);

      const result = await createTransactions(clientBatchId, [
        {
          amount,
          description: description.charAt(0).toUpperCase() + description.slice(1),
          type: isIncome ? "INCOME" : "EXPENSE",
          categoryId: matchedCat.id,
          date: now.toISOString(),
        },
      ]);

      if (result.transactions.length > 0) {
        await confirmCreated(chatId, result);
        return;
      }
    }
  }

  // Fallback to Gemini AI natural language processing
  if (gemini) {
    const aiResult = await processNaturalLanguageWithGemini(text, categories);
    if (aiResult?.action === "CREATE_TRANSACTION" && aiResult.transaction) {
      const txData = aiResult.transaction;
      const clientBatchId = updateBatchId(BOT_ID, updateId);
      const result = await createTransactions(clientBatchId, [
        {
          amount: txData.amount,
          description: txData.description,
          type: txData.type,
          categoryId: txData.categoryId,
          date: txData.date || new Date().toISOString(),
        },
      ]);

      if (result.transactions.length > 0) {
        await confirmCreated(chatId, result);
        return;
      }
    }

    if (aiResult?.replyText) {
      await sendMessage(chatId, aiResult.replyText);
      return;
    }
  }

  // A message that named a date but could not be understood is worth explaining, rather than
  // repeating an example that has the same problem. Without Gemini there is nothing here that can
  // resolve "yesterday", and quietly filing it under today is the outcome this path exists to
  // avoid.
  await sendMessage(
    chatId,
    !quick && !gemini
      ? `I can't work out the date in that one. Log it without the date, like \`350 groceries\`, and edit the day in the app.`
      : `I couldn't understand that command. Try logging an expense like:\n\`100 breakfast\`\nor type /help for options.`
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

const ALLOWLIST: Allowlist = { ids: ALLOWED_IDS, usernames: ALLOWED_USERNAMES };

/**
 * Every tool a handler calls, so a token too narrow to serve them says so at boot.
 *
 * Listed rather than derived: nothing links a handler to its tool at compile time, so this is the
 * one place that records the dependency. A handler that starts calling something new belongs here
 * too, or its first failure will be a chat reply rather than a startup warning.
 */
const REQUIRED_TOOLS = [
  "get_category_list",
  "get_budget_overview",
  "get_spending_by_category",
  "search_transactions",
  "get_upcoming_bills",
  "create_transactions",
] as const;

/** Attempts the MCP handshake with backoff, and gives up quietly rather than ending the bot. */
async function probeMcp(): Promise<void> {
  const delays = [0, 2_000, 5_000, 15_000, 30_000];

  for (const [attempt, delay] of delays.entries()) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const client = await mcpClient();
      const { tools } = await client.listTools();
      const names = new Set(tools.map((t) => t.name));
      const missing = REQUIRED_TOOLS.filter((tool) => !names.has(tool));
      if (missing.length > 0) {
        // Out-of-scope tools are removed from the server rather than rejected on call, so a
        // narrow token is silent about what it cannot do until the first message fails. The
        // setup notes used to name only transactions:write, and a token minted to the letter
        // started clean and then failed on everything.
        console.warn(
          `[telegram] this token is missing ${missing.join(", ")}. ` +
            "Mint one with budget:read, transactions:read, bills:read and transactions:write."
        );
      }
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Dropped so the next attempt reconnects rather than reusing a client whose transport died.
      mcp = null;
      if (attempt === delays.length - 1) {
        console.error(
          `[telegram] could not reach the MCP endpoint at ${MCP_URL} after ${delays.length} attempts:`,
          message,
          "\nPolling anyway; each message will report the failure."
        );
        return;
      }
    }
  }
}

export async function startTelegramBot(): Promise<void> {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  if (!MCP_TOKEN) {
    throw new Error(
      "TELEGRAM_MCP_TOKEN is not set. Mint one in Profile > MCP Access with the " +
        "transactions:write scope, then set TELEGRAM_MCP_TOKEN."
    );
  }

  // Proves the token before serving anyone, so a bad credential surfaces here rather than as a
  // confusing reply to the first message.
  //
  // Retried rather than thrown. The bot boots inside the app it talks to: `MCP_URL` points back
  // at this same deployment, which is not yet serving requests while `instrumentation.ts` runs.
  // A single failed probe used to end `startTelegramBot`, and nothing restarts it, so an ordering
  // race at container boot left the bot down until the next deploy. Polling starts either way;
  // a token that is genuinely wrong then reports itself in the reply to the first message.
  await probeMcp();

  if (ALLOWED_IDS.size === 0 && ALLOWED_USERNAMES.size === 0) {
    // It keeps polling on purpose, and the wording has to say so: every sender is denied, but
    // the denial logs their numeric id, which is the documented way to find your own and put it
    // in TELEGRAM_ALLOWED_IDS. Stopping here would remove the only route out of this state.
    console.error(
      "\n[telegram] SERVING NOBODY: no allowlist configured, so every message will be denied.\n" +
        "Without one, anyone who finds this bot could read your balances and write transactions.\n" +
        "Set TELEGRAM_ALLOWED_IDS (preferred) or TELEGRAM_ALLOWED_USERNAMES in .env.\n" +
        "It keeps polling so you can message it once and read your numeric id from the log here.\n"
    );
  } else {
    // Only the shape of the allowlist, never who is on it.
    console.warn(
      `[telegram] allowlist: ${ALLOWED_IDS.size} id(s), ${ALLOWED_USERNAMES.size} username(s)` +
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
        if (!messageIsAllowed(update.message, ALLOWLIST)) {
          // The id is logged so it can be copied straight into TELEGRAM_ALLOWED_IDS. Nothing is
          // sent back: a reply would confirm to a stranger that the bot is live and whose it is,
          // and in a group it would announce the bot to everyone in it. The message text is
          // deliberately not logged, here or anywhere else.
          console.warn(
            `[telegram] denied message from id=${from?.id ?? "unknown"} username=@${from?.username ?? "none"} ` +
              `in a ${update.message.chat?.type ?? "unknown"} chat. ` +
              `Add the id to TELEGRAM_ALLOWED_IDS to allow it; only private chats are answered.`
          );
          continue;
        }

        // Caught per update, not per poll. The offset has already moved, so an escaping error
        // would drop that message silently and the sender would be left waiting on a reply that
        // never comes. Holding the offset back instead would make one permanently unprocessable
        // message redeliver forever and wedge every message behind it, so the update is
        // acknowledged and the failure is reported to the person who sent it.
        try {
          await handleMessage(update.message, update.update_id);
        } catch (err) {
          console.error(
            "[telegram] failed to handle an update:",
            err instanceof Error ? err.message : err
          );
          await sendMessage(update.message.chat.id, replyForError(err)).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error("[telegram] polling error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
