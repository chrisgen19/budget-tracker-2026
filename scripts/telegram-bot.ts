import https from "https";
import dns from "dns";
import path from "path";

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  // Ignore if already in process.env
}
import { PrismaClient } from "@prisma/client";
import { GoogleGenAI } from "@google/genai";
import {
  getBudgetOverview,
  getSpendingByCategory,
  getUpcomingBills,
} from "../src/lib/budget-queries";
import { createTransactionBatch } from "../src/lib/transaction-writes";
import { formatLocalDate } from "../src/lib/validations";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not set in environment or .env");
  process.exit(1);
}

const prisma = new PrismaClient();

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

async function handleSummary(chatId: number, user: any) {
  const month = getCurrentMonthKey(user.timezoneOffset);
  // `timezoneOffset`, not `tzOffset`: the param is optional and silently defaults to UTC, so a
  // misspelling does not fail, it just resolves month boundaries in the wrong zone.
  const summary = await getBudgetOverview(prisma, user.id, {
    month,
    timezoneOffset: user.timezoneOffset,
  });
  const spending = await getSpendingByCategory(prisma, user.id, {
    month,
    timezoneOffset: user.timezoneOffset,
  });

  const savingsRate =
    summary.totalIncome > 0 ? Math.round((summary.net / summary.totalIncome) * 100) : 0;

  const currency = user.currency || "PHP";
  const symbol = currency === "PHP" ? "₱" : `${currency} `;

  let msg = `📊 *Budget Summary for ${month}*\n\n`;
  msg += `💰 *Total Income:* ${symbol}${summary.totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  msg += `💸 *Total Expenses:* ${symbol}${summary.totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  msg += `🪙 *Net Balance:* ${symbol}${summary.net.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  msg += `📈 *Savings Rate:* ${savingsRate}%\n\n`;

  if (spending.length > 0) {
    msg += `📁 *Top Spending Categories:*\n`;
    const top = spending.slice(0, 5);
    for (const cat of top) {
      msg += `• ${cat.name}: ${symbol}${cat.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${cat.percentage}%)\n`;
    }
  } else {
    msg += `No expense records yet this month.\n`;
  }

  await sendMessage(chatId, msg);
}

async function handleRecent(chatId: number, user: any) {
  const currency = user.currency || "PHP";
  const symbol = currency === "PHP" ? "₱" : `${currency} `;

  const txs = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
    take: 5,
    include: {
      category: true,
      labels: { include: { label: true } },
    },
  });

  if (txs.length === 0) {
    await sendMessage(chatId, "No transactions found.");
    return;
  }

  let msg = `🕒 *Recent Transactions:*\n\n`;
  for (const t of txs) {
    const icon = t.type === "INCOME" ? "➕" : "➖";
    const dateStr = formatLocalDate(t.date, user.timezoneOffset);
    const labels = t.labels.map((l) => l.label.name).join(", ");
    msg += `${icon} *${symbol}${t.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}* - ${t.description || t.category.name}\n`;
    msg += `   📁 ${t.category.name} | 📅 ${dateStr}${labels ? ` | 🏷️ ${labels}` : ""}\n\n`;
  }

  await sendMessage(chatId, msg);
}

async function handleBills(chatId: number, user: any) {
  const currency = user.currency || "PHP";
  const symbol = currency === "PHP" ? "₱" : `${currency} `;

  const result = await getUpcomingBills(prisma, user.id, { days: 30 });
  if (result.bills.length === 0) {
    await sendMessage(chatId, "🎉 No upcoming bills due in the next 30 days!");
    return;
  }

  let msg = `📅 *Upcoming Bills (Next 30 Days):*\n\n`;
  for (const b of result.bills) {
    const due = new Date(b.dueDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    msg += `• *${b.description || b.categoryName}*: ${symbol}${b.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
    msg += `   Due: ${due}${b.isOverdue ? " (overdue)" : ""}\n\n`;
  }

  await sendMessage(chatId, msg);
}

async function handleCategories(chatId: number, user: any) {
  const categories = await prisma.category.findMany({
    where: {
      OR: [{ userId: user.id }, { userId: null }],
    },
    orderBy: { name: "asc" },
  });

  const expense = categories.filter((c) => c.type === "EXPENSE");
  const income = categories.filter((c) => c.type === "INCOME");

  let msg = `📁 *Available Categories:*\n\n`;
  msg += `*Expense Categories:*\n`;
  msg += expense.map((c) => `• ${c.name}`).join("\n");
  msg += `\n\n*Income Categories:*\n`;
  msg += income.map((c) => `• ${c.name}`).join("\n");

  await sendMessage(chatId, msg);
}

async function processNaturalLanguageWithGemini(
  text: string,
  user: any,
  categories: any[]
): Promise<any> {
  if (!gemini) return null;

  const now = new Date();
  const localIso = new Date(now.getTime() - user.timezoneOffset * 60_000).toISOString();
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

async function handleMessage(message: any, user: any, updateId: number) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (!text) return;

  const currency = user.currency || "PHP";
  const symbol = currency === "PHP" ? "₱" : `${currency} `;

  // Commands
  if (text.startsWith("/start") || text.startsWith("/help")) {
    const msg =
      `👋 *Welcome to Budget Tracker Bot!*\n\n` +
      `👤 *Account:* ${user.name} (${user.email})\n` +
      `💼 *Currency:* ${user.currency}\n\n` +
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
    await handleSummary(chatId, user);
    return;
  }

  if (text === "/recent") {
    await handleRecent(chatId, user);
    return;
  }

  if (text === "/bills") {
    await handleBills(chatId, user);
    return;
  }

  if (text === "/categories") {
    await handleCategories(chatId, user);
    return;
  }

  // Fast Regex Shorthand Matching: e.g. "100 breakfast" or "+5000 salary" or "250.50 lunch"
  const quickExpenseMatch = /^(\d+(?:\.\d+)?)\s+(.+)$/i.exec(text);
  const quickIncomeMatch = /^\+(\d+(?:\.\d+)?)\s+(.+)$/i.exec(text);

  const categories = await prisma.category.findMany({
    where: { OR: [{ userId: user.id }, { userId: null }] },
  });

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
        matchedCat = matchingCats.find((c) => c.isDefault) || matchingCats[0];
      }

      const now = new Date();
      // Derived from the Telegram update id, not the clock. The poller advances its offset
      // *before* handling a message and keeps it only in memory, so a crash mid-write makes
      // Telegram redeliver that update on restart. A random key would write the transaction
      // twice; a stable one replays and returns the original row.
      const clientBatchId = `telegram-${updateId}`;

      const result = await createTransactionBatch({
        prisma,
        userId: user.id,
        createdVia: "TELEGRAM",
        // The same kill switch that governs MCP writes. A user who turns writes off in
        // Profile > MCP Access reasonably expects every remote path to stop, and this is one.
        assertStillPermitted: async (tx) => {
          const current = await tx.user.findUnique({
            where: { id: user.id },
            select: { mcpWritesEnabledUntil: true },
          });
          const until = current?.mcpWritesEnabledUntil;
          return until !== null && until !== undefined && until > new Date();
        },
        clientBatchId,
        items: [
          {
            amount,
            description: description.charAt(0).toUpperCase() + description.slice(1),
            type: isIncome ? "INCOME" : "EXPENSE",
            categoryId: matchedCat.id,
            date: now.toISOString(),
          },
        ],
      });

      if (result.ok && result.transactions.length > 0) {
        const tx = result.transactions[0];
        const labels = tx.labels.map((l) => l.label.name).join(", ");
        let reply = `✅ *Transaction Logged!*\n\n`;
        reply += `📝 *Description:* ${tx.description}\n`;
        reply += `💰 *Amount:* ${symbol}${tx.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
        reply += `📁 *Category:* ${tx.category.name}\n`;
        reply += `📅 *Date:* ${formatLocalDate(tx.date, user.timezoneOffset)}\n`;
        if (labels) reply += `🏷️ *Labels:* ${labels}\n`;
        await sendMessage(chatId, reply);
        return;
      }
    }
  }

  // Fallback to Gemini AI natural language processing
  if (gemini) {
    const aiResult = await processNaturalLanguageWithGemini(text, user, categories);
    if (aiResult?.action === "CREATE_TRANSACTION" && aiResult.transaction) {
      const txData = aiResult.transaction;
      // Derived from the Telegram update id, not the clock. The poller advances its offset
      // *before* handling a message and keeps it only in memory, so a crash mid-write makes
      // Telegram redeliver that update on restart. A random key would write the transaction
      // twice; a stable one replays and returns the original row.
      const clientBatchId = `telegram-${updateId}`;
      const result = await createTransactionBatch({
        prisma,
        userId: user.id,
        createdVia: "TELEGRAM",
        // The same kill switch that governs MCP writes. A user who turns writes off in
        // Profile > MCP Access reasonably expects every remote path to stop, and this is one.
        assertStillPermitted: async (tx) => {
          const current = await tx.user.findUnique({
            where: { id: user.id },
            select: { mcpWritesEnabledUntil: true },
          });
          const until = current?.mcpWritesEnabledUntil;
          return until !== null && until !== undefined && until > new Date();
        },
        clientBatchId,
        items: [
          {
            amount: txData.amount,
            description: txData.description,
            type: txData.type,
            categoryId: txData.categoryId,
            date: txData.date || new Date().toISOString(),
          },
        ],
      });

      if (result.ok && result.transactions.length > 0) {
        const tx = result.transactions[0];
        const labels = tx.labels.map((l) => l.label.name).join(", ");
        let reply = `✅ *Transaction Logged!*\n\n`;
        reply += `📝 *Description:* ${tx.description}\n`;
        reply += `💰 *Amount:* ${symbol}${tx.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
        reply += `📁 *Category:* ${tx.category.name}\n`;
        reply += `📅 *Date:* ${formatLocalDate(tx.date, user.timezoneOffset)}\n`;
        if (labels) reply += `🏷️ *Labels:* ${labels}\n`;
        await sendMessage(chatId, reply);
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

  // Fetch primary user
  const userId = process.env.BUDGET_USER_ID;
  let user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

  if (!user) {
    console.error("No user found in database!");
    process.exit(1);
  }

  console.log(`Connected to user: ${user.name} (${user.email})`);

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
        await handleMessage(update.message, user, update.update_id);
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
