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
import { chunkMessage } from "@/lib/telegram/chunk";
import { MAX_IMAGE_BYTES, pickReceiptImage } from "@/lib/telegram/photo";
import { readPhotoTakenAt } from "@/lib/exif-date";
import { receiptDateLooksOff } from "@/lib/telegram/date-sanity";
import { resolveCommand, type BotCommand } from "@/lib/telegram/commands";
import { parseSearchIntent } from "@/lib/telegram/search-intent";
import { monthsSince } from "@/lib/telegram/month-window";
import { confirmPendingScan } from "@/lib/telegram/confirm-scan";
import {
  hasPendingScan,
  isConfirmation,
  isRejection,
  putPendingScan,
  takePendingScan,
} from "@/lib/telegram/pending-scan";
import { GEMINI_TIMEOUT_MS } from "@/lib/gemini-limits";
import {
  McpToolError,
  UnconfirmedWriteError,
  replyForError,
  shouldRetryWrite,
} from "@/lib/telegram/errors";
import { isPlainShorthand } from "@/lib/telegram/shorthand";
import { findOtherCategory, matchCategory } from "@/lib/telegram/category-match";
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

/**
 * Required, with no default on purpose.
 *
 * It used to fall back to this project's own production domain. That is the right host for its
 * owner and a trap for anyone else: a fork, or a staging deploy that forgets the variable, would
 * send a write-capable token to a domain it does not control and write to the wrong budget. A
 * credential should never have a hardcoded external destination, so this fails at startup
 * instead, the same way the empty allowlist refuses to serve.
 */
const MCP_URL = env("TELEGRAM_MCP_URL");
const MCP_TOKEN = env("TELEGRAM_MCP_TOKEN");
/** Only used for display; the server owns every amount and every date boundary. */
const SYMBOL = env("TELEGRAM_CURRENCY_SYMBOL") ?? "\u20B1";

/**
 * The user's timezone offset in minutes, `getTimezoneOffset()` convention so UTC+8 is -480.
 *
 * Required, with no fallback. It used to default to the host's own offset, which is right only
 * when the bot runs on the user's machine. It now runs inside the app container, where the host
 * is UTC, so the guess was wrong in the deployment this exists for, and wrong silently: at 01:00
 * on the 27th in Manila a UTC host reads the 26th, so "yesterday" resolves to the 25th and the
 * transaction lands two days out.
 *
 * It is used to resolve relative dates for Gemini, and to render the day in /recent. Every query
 * and every write is still resolved server-side against `users.timezone_offset`, so a wrong
 * value here cannot move a stored row; it can only mislabel one before it is written.
 *
 * That this duplicates `users.timezone_offset` at all is the real defect, and it can drift if the
 * account's timezone changes. Removing the duplication means the bot reading the offset from the
 * server, which no MCP tool exposes today. Tracked with the rest of the MCP timezone work in
 * issue #132.
 */
const TZ_CONFIGURED = Number.isFinite(Number(env("TELEGRAM_TZ_OFFSET")));
/** Zero only as a placeholder: `startTelegramBot` refuses to run when TZ_CONFIGURED is false,
 *  so nothing ever reads this value unconfigured. */
const TZ_OFFSET = TZ_CONFIGURED ? Number(env("TELEGRAM_TZ_OFFSET")) : 0;

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
  if (!MCP_URL) throw new Error("TELEGRAM_MCP_URL is not set");
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
/**
 * Download a file Telegram is holding for us.
 *
 * Two steps by design on Telegram's side: `getFile` exchanges a `file_id` for a short-lived path,
 * and the bytes come from a different host. Bounded by the same timeout as every other call, and
 * by `MAX_IMAGE_BYTES` mid-stream, so a file whose declared size lied cannot be buffered without
 * limit.
 */
async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const file = await telegramApi("getFile", { file_id: fileId });
  const path = file?.file_path;
  if (!path) throw new Error("Telegram returned no file_path");

  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`,
      { agent },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Telegram file download returned ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_IMAGE_BYTES) {
            req.destroy(new Error("Image exceeds the size limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Telegram file download timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
  });
}

async function sendMessage(
  chatId: number | string,
  text: string,
  parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<boolean> {
  // Telegram rejects an over-long message outright, and the plain-text fallback is the same
  // length, so every attempt failed and the user was answered with silence.
  const parts = chunkMessage(text);
  if (parts.length > 1) {
    let allSent = true;
    for (const part of parts) {
      if (!(await sendOne(chatId, part, parseMode))) allSent = false;
    }
    return allSent;
  }

  return sendOne(chatId, text, parseMode);
}

async function sendOne(
  chatId: number | string,
  text: string,
  parseMode: "Markdown" | "HTML"
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
      if (!shouldRetryWrite(err)) throw err;
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

/** Rows fetched for the total, and rows actually listed. Fetching wider makes the total real
 *  without turning the reply into a wall of text. The fetch limit is the tool's own ceiling:
 *  asking for more is rejected outright, which returns nothing rather than more. */
const SEARCH_SUM_LIMIT = 100;

/** How far back bill history can be asked for. Beyond this the answer is "I cannot check",
 *  never "it was not paid". */
const MAX_HISTORY_MONTHS = 60;

/** The tool's own ceiling per call. Asking for more is rejected outright. */
const HISTORY_PAGE = 100;
const SEARCH_SHOW_LIMIT = 10;

/**
 * Answer "did I pay X" and "how much did I spend on X" from real rows.
 *
 * Gemini extracts only the term and the month; every figure below comes from `search_transactions`.
 * The distinction matters because this is the shape of question a model is most tempted to answer
 * from nothing, and a confident wrong number about your own money is worse than no answer.
 */
async function handleSearch(
  chatId: number,
  filters: {
    search: string | null;
    labelId: string | null;
    categoryId: string | null;
    month: string | null;
    type: "EXPENSE" | "INCOME";
    subject: string;
  }
): Promise<void> {
  const { subject, month } = filters;
  // Always stated. Filtering is by month only, so a question about "last week" is answered with
  // that whole month, and the header has to say so rather than letting a wider answer pass for
  // a narrower one.
  const when = month ? ` in ${month}` : "";
  const result = await callTool<{
    transactions: {
      amount: number;
      description: string;
      date: string;
      categoryName: string;
      type: string;
      labels: { name: string }[];
    }[];
    pagination: { total: number };
  }>("search_transactions", {
    // Constrained to one side of the ledger, so the count, the listed rows and the total all
    // describe the same set.
    type: filters.type,
    ...(filters.search && { search: filters.search }),
    ...(filters.labelId && { labelIds: [filters.labelId] }),
    ...(filters.categoryId && { categoryId: filters.categoryId }),
    ...(month && { month }),
    // Fetched wider than shown so the total is the answer to "how much did I spend on X",
    // rather than the total of the first ten rows dressed up as one.
    limit: SEARCH_SUM_LIMIT,
    sortBy: "date",
    sortDir: "desc",
  });

  const rows = result.transactions;

  if (rows.length === 0) {
    // Said plainly rather than dressed up: "no" is a real answer to "did I pay X", and the
    // wording has to make clear it means nothing was found rather than nothing was searched.
    await sendMessage(
      chatId,
      `\ud83d\udd0d Nothing found for *${subject}*${when}.\n\n` +
        `A plain search matches what you typed when logging it, so try the merchant name as it ` +
        `appears on the transaction, or the name of a label.`
    );
    return;
  }

  const matched = result.pagination.total;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const money = (n: number) => `${SYMBOL}${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const shown = rows.slice(0, SEARCH_SHOW_LIMIT);

  let msg = `\ud83d\udd0d *${subject}*${when}: ${matched} match${matched === 1 ? "" : "es"}\n\n`;
  for (const r of shown) {
    msg += `\u2022 ${localDay(r.date, TZ_OFFSET)}  *${money(r.amount)}*  ${r.description || r.categoryName}\n`;
  }
  if (shown.length < matched) msg += `\n_Showing the ${shown.length} most recent._`;

  if (total > 0) {
    // Says which it is. A total over a truncated set presented as "the total" is the same class
    // of wrong as everything else guarded against here: it reads like an answer.
    msg += rows.length < matched
      ? `\n\nTotal of the ${rows.length} most recent: *${money(total)}*`
      : `\n\nTotal: *${money(total)}*`;

    // The app's label breakdown divides a transaction's amount evenly among its labels, so a row
    // carrying two labels contributes half there and all of it here. Both are defensible for the
    // question each answers, but a user comparing the two numbers deserves to know why they
    // differ rather than discovering it as an apparent error. Summing full amounts is what keeps
    // this total equal to the rows listed above it.
    const shared = rows.filter((r) => (r.labels?.length ?? 0) > 1).length;
    if (filters.labelId && shared > 0) {
      msg +=
        `\n\n_${shared} of these also carry another label. This total counts each in full, ` +
        `so the app's label breakdown, which splits them, will show less._`;
    }
  }

  await sendMessage(chatId, msg);
}

/**
 * Answer "did I pay the water bill" from the bill's own history.
 *
 * Better than a description search for a *recurring* bill: the log records paid, skipped and
 * snoozed per occurrence, so "no" can be distinguished from "skipped on purpose", and a bill the
 * user renamed still matches. Falls back to a plain search when nothing matches the name, since
 * not everything people call a bill is a scheduled one.
 */
async function handleBillCheck(chatId: number, search: string, month: string | null): Promise<void> {
  // Sized from the month asked about, not fixed. A fixed six-month window returned recent rows
  // for an older question, which skipped the fallback below and then reported that the older
  // occurrence never existed.
  const monthsBack = month ? monthsSince(month, TZ_OFFSET) : 0;
  const wanted = Math.max(6, monthsBack + 2);
  const months = Math.min(MAX_HISTORY_MONTHS, wanted);
  // Clamping is silent, so an older month would otherwise be reported as unpaid on the strength
  // of a window that never reached it. Saying "I cannot check that far back" is the only honest
  // answer available.
  const beyondWindow = wanted > MAX_HISTORY_MONTHS;

  type Occurrence = {
    billId: string;
    billDescription: string;
    categoryName: string;
    amount: number;
    paidAmount: number | null;
    dueDate: string;
    status: string;
    daysLate: number | null;
  };
  const history = (args: Record<string, unknown>) =>
    callTool<{ occurrences: Occurrence[] }>("get_bill_history", args);

  // The limit is applied to every bill's occurrences together, newest first, so a survey across
  // all bills only reaches back as far as the busiest ones allow: ten monthly bills exhaust a
  // hundred rows in under a year. This first call is therefore used to identify the bill, not to
  // answer the question.
  const survey = await history({ months, limit: HISTORY_PAGE });

  const needle = search.toLowerCase();
  // Matched on the bill's own name only. Including the category name pulled in every other bill
  // sharing it, and the reply then labelled the combined rows with one bill's description, so a
  // second bill's payments were presented as this one's.
  const named = (o: Occurrence) => o.billDescription.toLowerCase().includes(needle);
  const billIds = [...new Set(survey.occurrences.filter(named).map((o) => o.billId))];

  // Re-queried per bill, where the same limit covers that bill alone and reaches back years
  // rather than months. Without this a survey that truncated before the month asked about
  // reported "no payment recorded" for an occurrence that is sitting in the table.
  const matches = billIds.length
    ? (
        await Promise.all(
          billIds.map((billId) => history({ months, billId, limit: HISTORY_PAGE }))
        )
      )
        .flatMap((r) => r.occurrences)
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    : [];

  if (beyondWindow && month) {
    await sendMessage(
      chatId,
      `\ud83d\udcc5 I can only check bill history back about ${Math.floor(MAX_HISTORY_MONTHS / 12)} years, ` +
        `and ${month} is further back than that. Look it up in the app instead.`
    );
    return;
  }

  if (matches.length === 0) {
    // The survey is truncated when it comes back full, and it is sorted newest first, so a month
    // older than its oldest row was never looked at. Saying "no payment recorded" then asserts
    // something about rows that were never fetched.
    const oldest = survey.occurrences.at(-1)?.dueDate.slice(0, 7);
    if (month && survey.occurrences.length >= HISTORY_PAGE && oldest && month < oldest) {
      await sendMessage(
        chatId,
        `\ud83d\udcc5 I could not reach ${month} for *${search}*: there are too many bill records ` +
          `in between. Check it in the app.`
      );
      return;
    }

    // A bill whose first occurrence has not been paid, skipped or snoozed has no log rows at
    // all, so an empty history does not mean "not a bill". Asking upcoming bills first is what
    // separates "never scheduled" from "scheduled and still due", which is usually the answer
    // the question was after.
    const due = await upcomingFor(needle);
    if (due) {
      await sendMessage(chatId, `\ud83d\udcc5 No payment recorded for *${search}* yet.\n\n${due}`);
      return;
    }

    // Not a scheduled bill, or named differently. A description search still answers the
    // question they actually asked, so fall through rather than saying no.
    await handleSearch(chatId, {
      search,
      labelId: null,
      categoryId: null,
      month,
      type: "EXPENSE",
      subject: search,
    });
    return;
  }

  const money = (n: number) =>
    `${SYMBOL}${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const line = (o: (typeof matches)[number], withName: boolean) => {
    const mark = o.status === "PAID" ? "\u2705" : o.status === "SKIPPED" ? "\u23ed\ufe0f" : "\ud83d\udd52";
    const amount = o.paidAmount ?? o.amount;
    const late = o.daysLate && o.daysLate > 0 ? ` (${o.daysLate}d late)` : "";
    const name = withName ? ` ${o.billDescription}` : "";
    return `${mark} ${localDay(o.dueDate, TZ_OFFSET)}${name}  ${o.status.toLowerCase()}  *${money(amount)}*${late}\n`;
  };

  // One name can match several bills. Naming each row is the honest way to show that, rather
  // than titling the lot with whichever happened to sort first.
  const distinct = new Set(matches.map((o) => o.billId));
  const withName = distinct.size > 1;
  const title = withName ? search : matches[0].billDescription;

  const inMonth = month ? matches.filter((o) => o.dueDate.slice(0, 7) === month) : matches;

  if (inMonth.length === 0) {
    // `get_bill_history` is built from the payment log, so an occurrence that is merely *unpaid*
    // has no row at all. Saying "no occurrence" would therefore report a bill that is due and
    // outstanding as one that was never scheduled, which is the opposite of the truth.
    const due = await upcomingFor(needle);
    const latest = matches[0];
    await sendMessage(
      chatId,
      `\ud83d\udcc5 No payment recorded for *${title}* in ${month}.\n\n` +
        (due ? `${due}\n\n` : "") +
        `Most recent record: ${localDay(latest.dueDate, TZ_OFFSET)}, ${latest.status.toLowerCase()}.`
    );
    return;
  }

  let msg = `\ud83d\udcc5 *${title}*${month ? ` in ${month}` : ""}\n\n`;
  for (const o of inMonth.slice(0, 8)) msg += line(o, withName);

  await sendMessage(chatId, msg);
}

/** Whether a bill matching this name is currently due or overdue, phrased for a chat reply. */
async function upcomingFor(needle: string): Promise<string | null> {
  try {
    const { bills } = await callTool<{
      bills: { description: string; categoryName: string; dueDate: string; isOverdue: boolean }[];
    }>("get_upcoming_bills", { days: 45 });

    const match = bills.find((b) => (b.description || b.categoryName).toLowerCase().includes(needle));
    if (!match) return null;

    return match.isOverdue
      ? `\u26a0\ufe0f It is overdue, due ${localDay(match.dueDate, TZ_OFFSET)}.`
      : `It is still due on ${localDay(match.dueDate, TZ_OFFSET)}.`;
  } catch {
    // Extra context, not the answer. A failure here must not lose the reply.
    return null;
  }
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
  categories: { id: string; name: string; type: string }[],
  labels: { id: string; name: string }[]
): Promise<any> {
  if (!gemini) return null;

  const localIso = localTimestamp(TZ_OFFSET);
  const categoryNames = categories.map((c) => ({ name: c.name, type: c.type, id: c.id }));
  // Names only. Gemini picks one by name and the bot resolves it against the real list, so a
  // hallucinated id cannot reach the query.
  const labelNames = labels.map((l) => l.name);

  const prompt = `You are an AI assistant for a personal budget tracker.
Current timestamp in user timezone: ${localIso}
User's categories: ${JSON.stringify(categoryNames)}
User's labels: ${JSON.stringify(labelNames)}

Analyze the user's message: "${text}"

You have NO access to the user's transactions, totals, or balances. You can see only the
message, the current time, and the category and label names above. Never state or estimate any amount,
total, balance or count: you would be inventing it.

Decide what the user wants:
- Logging an expense or income -> "CREATE_TRANSACTION"
- Asking about this month's spending, balance, or where their money went -> "SHOW_SUMMARY"
- Asking what they recently logged -> "SHOW_RECENT"
- Asking about upcoming or due bills -> "SHOW_BILLS"
- Asking whether a specific RECURRING BILL was paid ("did I pay the water bill", "have I paid
  internet this month") -> "CHECK_BILL", with "search" set to the bill's name as they said it
- Asking what they spent on something, or whether they bought it
  ("did I pay meralco", "how much did I spend at jollibee", "how much on transportation in
  work budget this month", "did I buy coffee last week") -> "SEARCH_TRANSACTIONS". Fill in whichever of these apply:
  - "label": one of the label names above, EXACTLY as written there, when the user named one.
    Labels are how this user groups spending, so prefer a label over a text search whenever the
    thing they named appears in that list: "shopee" is a label, not a word in a description.
  - "category": one of the category names above, EXACTLY as written there, when they named one.
  - "search": free text for a merchant or item that is NOT a label or category name.
  - "type": "INCOME" only when the question is clearly about money coming in ("how much did I
    earn from X", "did I get paid by X"). Leave it out for anything about spending, paying or
    buying, which is nearly always what is meant.
  - "month": YYYY-MM. Set it whenever the user limited the question to ANY period, not only a
    whole month: for "last week", "yesterday" or a named date, use the month that period falls
    in. Filtering is only available by month, so a narrower period becomes its month and the
    reply says which month it covered. Omit it only when they set no time limit at all
    ("how much have I spent at jollibee"). Use the current timestamp above to resolve
    "this month" and "last month".
  At least one of label, category or search must be set.
- Anything else -> "UNSUPPORTED", with replyText saying briefly what you cannot do and
  pointing at /summary, /recent, /bills or /help. State no figures.

"search" is matched against the transaction description, so use the word the user would have typed
when logging it: "meralco", not "electricity". Never guess an amount or a date: you are only
extracting what to look for.

The SHOW_* actions are answered from the user's real data, not by you.

If logging a transaction:
- amount: positive number
- description: concise title (e.g. "Breakfast", "Jollibee lunch", "Salary")
- type: "EXPENSE" or "INCOME"
- categoryId: best matching category ID from the provided list
- date: ISO timestamp string (e.g. "2026-08-26T08:30:00") matching when it occurred, or the current timestamp above. Write it in the user's local time with NO "Z" and no offset suffix: the server resolves it against their timezone, and a "Z" would be read as UTC and shift the transaction by hours

Return ONLY a JSON object in this format:
{
  "action": "CREATE_TRANSACTION" | "SHOW_SUMMARY" | "SHOW_RECENT" | "SHOW_BILLS" | "CHECK_BILL" | "SEARCH_TRANSACTIONS" | "UNSUPPORTED",
  "search": string | null,
  "type": "EXPENSE" | "INCOME" | null,
  "label": string | null,
  "category": string | null,
  "month": string | null,
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
        // The poll loop awaits each update in turn, so a request with no deadline stops the bot
        // answering anyone until it settles, which a stalled call may never do. Same knob the
        // receipt scanner uses, so one setting bounds every Gemini call the app makes.
        ...(GEMINI_TIMEOUT_MS > 0 && { httpOptions: { timeout: GEMINI_TIMEOUT_MS } }),
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return parsed;
  } catch (err) {
    console.error("[telegram] Gemini parse error:", err);
    return null;
  }
}

/** What `scan_receipt` returns. Mirrors `scanReceiptOutput` in the MCP server. */
interface ScannedReceipt {
  amount: number;
  categoryId: string;
  date: string;
  description: string;
  dateWarning: boolean;
  usedPhotoFallback: boolean;
}

/**
 * Scan a receipt photo and ask the user to confirm before anything is written.
 *
 * The confirmation is not politeness. The web app shows a review modal for the same reason: OCR
 * on a phone photo of a crumpled receipt is exactly where a wrong amount comes from, and a bot
 * that saved silently would put it in the budget with nobody having seen it.
 */
async function handleReceiptPhoto(
  message: TelegramMessage,
  updateId: number,
  categories: { id: string; name: string; type: string }[]
): Promise<void> {
  const chatId = message.chat.id;
  const pick = pickReceiptImage(message);

  if (pick.kind === "unsupported") {
    await sendMessage(chatId, "I can only read JPEG, PNG, WebP or HEIC images.");
    return;
  }
  if (pick.kind === "too_large") {
    await sendMessage(
      chatId,
      `That image is ${(pick.bytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit. Send it as a photo rather than a file, or take a smaller one.`
    );
    return;
  }
  if (pick.kind === "none") return;

  await sendMessage(chatId, "Reading that receipt...");

  // Any earlier draft is left in place until this one succeeds. Clearing it up front threw away
  // something the user had already paid a scan for: if the download or the scan then failed,
  // recovering the first receipt meant scanning it again and spending a second credit. A
  // successful scan replaces it below, so a stale draft cannot linger either.
  const superseding = hasPendingScan(chatId);

  let scan: ScannedReceipt;
  let photoTakenAt: string | null = null;
  try {
    const image = await downloadTelegramFile(pick.fileId);
    // Only survives when the image was sent as a file. Telegram re-encodes anything sent as a
    // photo, which strips the metadata, so this is null for most uploads and the scan falls back
    // to today exactly as it did before.
    photoTakenAt = readPhotoTakenAt(image);

    scan = await callTool<ScannedReceipt>("scan_receipt", {
      imageBase64: image.toString("base64"),
      mimeType: pick.mimeType,
      localDate: localTimestamp(TZ_OFFSET).slice(0, 10),
      ...(photoTakenAt && { photoTakenAt }),
    });
  } catch (err) {
    // Reported here rather than rethrown, so the reply can say which receipt is still pending.
    // Answering "yes" now would save the earlier one, and the user has to know that.
    await sendMessage(
      chatId,
      replyForError(err) +
        (superseding ? "\n\nYour earlier receipt is still waiting. Reply *yes* to save that one." : "")
    );
    return;
  }

  const categoryName =
    categories.find((c) => c.id === scan.categoryId)?.name ?? "Uncategorised";

  let reply = `\ud83e\uddfe *Receipt read*\n\n`;
  reply += `\ud83d\udcdd *Description:* ${scan.description}\n`;
  reply += `\ud83d\udcb0 *Amount:* ${SYMBOL}${scan.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  reply += `\ud83d\udcc1 *Category:* ${categoryName}\n`;
  reply += `\ud83d\udcc5 *Date:* ${scan.date}\n`;
  if (scan.dateWarning) reply += `\n\u26a0\ufe0f The year on the receipt looks wrong. Check the date.\n`;
  if (scan.usedPhotoFallback) {
    reply += photoTakenAt
      ? `\n\u26a0\ufe0f I could not read a date on it, so I used when the photo was taken.\n`
      : `\n\u26a0\ufe0f I could not read a date on it, so I used today's.\n`;
  } else if (receiptDateLooksOff(scan.date, photoTakenAt)) {
    // The receipt's date wins, since that is when the purchase happened. But a wide gap usually
    // means one of the two was misread, and now is when the user can still check.
    reply += `\n\u26a0\ufe0f The photo was taken ${photoTakenAt!.slice(0, 10)}, which is a long way from the receipt date. Worth a check.\n`;
  }
  reply += `\nNothing is saved yet. Reply *yes* to save it, or *no* to discard.`;

  // Stored only once the review has actually reached the user, which is the entire point of the
  // confirmation step. Storing first meant an undelivered prompt left a draft nobody had seen,
  // and any bare "yes" in the next ten minutes would save an unreviewed transaction. Ordering it
  // this way also leaves a superseded draft intact for free: nothing is overwritten until the
  // replacement has been shown.
  if (!(await sendMessage(chatId, reply))) {
    console.error(
      "[telegram] scanned a receipt but could not deliver the review, so it was discarded."
    );
    return;
  }

  putPendingScan(chatId, {
    amount: scan.amount,
    description: scan.description,
    categoryId: scan.categoryId,
    categoryName,
    date: scan.date,
    // Keyed to the photo's update, not the confirming message, so a redelivered "yes" replays
    // the same batch instead of writing a second row.
    updateId,
    createdAt: Date.now(),
  });
}

async function handleMessage(message: TelegramMessage, updateId: number) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  // A photo carries no `text`, so this has to come before the empty-text return that used to
  // drop every non-text message on the floor.
  if (message.photo?.length || message.document) {
    const { categories } = await callTool<{
      categories: { id: string; name: string; type: string }[];
    }>("get_category_list");
    await handleReceiptPhoto(message, updateId, categories);
    return;
  }

  if (!text) return;

  // Answering a scan that is waiting. Checked before everything else: while one is pending, a
  // bare "yes" means that and nothing else. Anything that is not a clear yes or no falls through
  // to normal handling, so typing another expense logs it rather than being refused.
  if (isConfirmation(text)) {
    const scan = takePendingScan(chatId);
    if (scan) {
      const outcome = await confirmPendingScan(scan, {
        save: (key, s) =>
          createTransactions(key, [
            {
              amount: s.amount,
              description: s.description,
              type: "EXPENSE",
              categoryId: s.categoryId,
              date: s.date,
            },
          ]),
        // Restored with a fresh timestamp so a save that failed near the TTL does not leave the
        // user a scan they can no longer confirm.
        restore: (s) => putPendingScan(chatId, { ...s, createdAt: Date.now() }),
        batchKey: (s) => updateBatchId(BOT_ID, s.updateId),
      });

      if (outcome.status === "saved") {
        await confirmCreated(chatId, outcome.batch as CreatedBatch);
        return;
      }

      await sendMessage(chatId, "I could not save that receipt. Reply *yes* to try again.");
      return;
    }
  }

  if (isRejection(text)) {
    const scan = takePendingScan(chatId);
    if (scan) {
      await sendMessage(chatId, "Discarded. Nothing was saved.");
      return;
    }
  }

  // Commands, matched locally. Bare phrasings resolve here too, so "summary" is answered
  // instantly rather than costing a Gemini round trip to recognise a word. Anything that is not
  // an obvious command falls through, and Gemini still handles the conversational cases.
  const command = resolveCommand(text);

  if (command === "HELP") {
    const msg =
      `\ud83d\udc4b *Welcome to Budget Tracker Bot!*\n\n` +
      `\ud83d\udcbc *Currency:* ${SYMBOL}\n\n` +
      `\ud83e\uddfe *Receipts:* send a photo and I will read it, then ask you to confirm\n\n` +
      `\u26a1 *Quick Logging:*\n` +
      `Just type your expense or income naturally:\n` +
      `\u2022 \`100 breakfast\`\n` +
      `\u2022 \`250 jollibee lunch\`\n` +
      `\u2022 \`1500 internet bill\`\n` +
      `\u2022 \`+5000 freelance payout\`\n` +
      `\u2022 \`spent 350 for groceries yesterday\`\n\n` +
      `\ud83d\udccc *Commands:*\n` +
      `\u2022 /summary - This month's balance & top spending\n` +
      `\u2022 /recent - Last 5 transactions\n` +
      `\u2022 /bills - Upcoming scheduled bills\n` +
      `\u2022 /categories - List all categories\n` +
      `\u2022 /help - Show this guide\n\n` +
      `\ud83d\udd0d *Ask about what you logged:*\n` +
      `\u2022 \`did I pay meralco this month\`\n` +
      `\u2022 \`how much on transportation in work budget\`\n` +
      `\u2022 \`did I pay the water bill\`\n\n` +
      `The slash is optional: *summary*, *recent*, *bills* and *categories* work on their own, ` +
      `and you can ask in your own words too.`;
    await sendMessage(chatId, msg);
    return;
  }

  if (command) {
    const handlers: Record<Exclude<BotCommand, "HELP">, (chatId: number) => Promise<void>> = {
      SUMMARY: handleSummary,
      RECENT: handleRecent,
      BILLS: handleBills,
      CATEGORIES: handleCategories,
    };
    await handlers[command](chatId);
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
      const type = isIncome ? "INCOME" : "EXPENSE";
      // No confident match returns null rather than a guess. It used to fall back to the first
      // category of that type, and the list is ordered defaults-first then alphabetically, so
      // with the seeded data every unrecognised expense was filed under Education.
      let matchedCat = matchCategory(description, type, categories);

      // Gemini sees the whole list and can choose properly, so the fast path steps aside for it.
      // Only when there is no Gemini does an explicit "Other" bucket become the least-bad
      // answer: it is at least somewhere the user would recognise as unsorted.
      if (!matchedCat && !gemini) matchedCat = findOtherCategory(type, categories);

      if (matchedCat) {
        const clientBatchId = updateBatchId(BOT_ID, updateId);

        const result = await createTransactions(clientBatchId, [
          {
            amount,
            description: description.charAt(0).toUpperCase() + description.slice(1),
            type,
            categoryId: matchedCat.id,
            date: new Date().toISOString(),
          },
        ]);

        if (result.transactions.length > 0) {
          await confirmCreated(chatId, result);
          return;
        }
      }
    }
  }

  // Fallback to Gemini AI natural language processing
  if (gemini) {
    // Fetched here rather than above, since only this path needs them: the shorthand logger never
    // looks at labels. Names are given to the model, ids are resolved from this list afterwards.
    //
    // A failure here is absorbed rather than propagated. `get_label_list` needs `labels:read`,
    // which older tokens were minted without, and losing labels costs precision on one kind of
    // question. Letting it throw would have failed *every* message on this path, including
    // logging, for a scope the setup notes did not ask for.
    const labels = await callTool<{ labels: { id: string; name: string }[] }>("get_label_list")
      .then((r) => r.labels)
      .catch(() => {
        console.warn(
          "[telegram] could not read labels, so label filters are unavailable. " +
            "Mint a token with labels:read to enable them."
        );
        return [] as { id: string; name: string }[];
      });

    const aiResult = await processNaturalLanguageWithGemini(text, categories, labels);
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

    // Questions are answered from the user's real data by the same handlers the slash commands
    // use. Gemini only classifies the intent; it is told it has no access to transactions, and
    // it never sees any, so it cannot be the thing that states a figure. It used to return free
    // text for any question, which was sent to the user verbatim: with nothing but category
    // names to work from, an answer to "how much did I spend this week" could only be invented.
    const grounded: Record<string, ((chatId: number) => Promise<void>) | undefined> = {
      SHOW_SUMMARY: handleSummary,
      SHOW_RECENT: handleRecent,
      SHOW_BILLS: handleBills,
    };
    const handler = grounded[aiResult?.action ?? ""];
    if (handler) {
      await handler(chatId);
      return;
    }

    // Validated rather than trusted: see parseSearchIntent for why a bad month is dropped
    // instead of being passed through as a filter.
    const intent = parseSearchIntent(aiResult, { labels, categories });
    if (intent) {
      if (intent.kind === "BILL") await handleBillCheck(chatId, intent.search, intent.month);
      else await handleSearch(chatId, intent);
      return;
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
  "get_bill_history",
  "get_label_list",
  "create_transactions",
  "scan_receipt",
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
            "Mint one with budget:read, transactions:read, labels:read, bills:read, receipts:scan and transactions:write."
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

  if (!TZ_CONFIGURED) {
    throw new Error(
      "TELEGRAM_TZ_OFFSET is not set. It must match the account's timezone, in minutes and " +
        "getTimezoneOffset() convention, so UTC+8 is -480. There is no default: the host's own " +
        "offset is UTC in the app container, which would silently resolve \"yesterday\" to the " +
        "wrong day."
    );
  }

  if (!MCP_URL) {
    throw new Error(
      "TELEGRAM_MCP_URL is not set. Point it at this deployment's /api/mcp endpoint, for " +
        "example http://localhost:3000/api/mcp when the bot runs inside the app container."
    );
  }

  if (!MCP_TOKEN) {
    throw new Error(
      "TELEGRAM_MCP_TOKEN is not set. Mint one in Profile > MCP Access with the " +
        "budget:read, transactions:read, labels:read, bills:read, receipts:scan and transactions:write " +
        "scopes, then set TELEGRAM_MCP_TOKEN."
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
