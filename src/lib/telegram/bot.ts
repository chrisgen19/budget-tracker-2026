// `node:` prefixed so the Next server bundle resolves them as built-ins rather than looking for
// browser polyfills, which is what the bare specifiers made it do.
import https from "node:https";
import dns from "node:dns";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { updateBatchId } from "@/lib/telegram/batch-id";
import { localTimestamp } from "@/lib/telegram/local-time";
import { describeWindow, type ReportedPeriod } from "@/lib/telegram/period-label";
import {
  callbackIsAllowed,
  messageIsAllowed,
  type Allowlist,
  type TelegramCallbackQuery,
  type TelegramMessage,
} from "@/lib/telegram/allowlist";
import { encodeScanCallback, parseScanCallback } from "@/lib/telegram/callback-data";
import { appBaseUrl, openInAppKeyboard } from "@/lib/telegram/app-link";
import { chunkMessage } from "@/lib/telegram/chunk";
import { MAX_IMAGE_BYTES, pickReceiptImage } from "@/lib/telegram/photo";
import { readPhotoTakenAt } from "@/lib/exif-date";
import { receiptDateLooksOff } from "@/lib/telegram/date-sanity";
import { menuRegistrations, resolveCommand, type BotCommand } from "@/lib/telegram/commands";
import { EXAMPLES_MESSAGE } from "@/lib/telegram/examples";
import { findByName, parseSearchIntent } from "@/lib/telegram/search-intent";
import { parseReportIntent } from "@/lib/telegram/report-intent";
import { RECEIPT_ITEM_SHOW, renderReceiptItems } from "@/lib/telegram/receipt-reply";
import { renderLabelBreakdown } from "@/lib/telegram/label-reply";
import { monthsSince, previousMonthOf } from "@/lib/telegram/month-window";
import { confirmPendingScan, scanToTransaction } from "@/lib/telegram/confirm-scan";
import {
  hasPendingScan,
  isConfirmation,
  isRejection,
  peekPendingScan,
  putPendingScan,
  revisePendingScan,
  takePendingScan,
  type PendingScan,
} from "@/lib/telegram/pending-scan";
import { correctedDescription, isScanCorrection } from "@/lib/telegram/scan-correction";
import {
  mentionsLabel,
  readLabelDirective,
  renderLabelNotice,
  type BotLabel,
} from "@/lib/telegram/caption-labels";
import {
  McpToolError,
  UnconfirmedWriteError,
  replyForError,
  shouldRetryWrite,
} from "@/lib/telegram/errors";
import { isPlainShorthand } from "@/lib/telegram/shorthand";
import {
  newShutdownState,
  requestShutdown,
  shouldStop,
} from "@/lib/telegram/shutdown";
import { GEMINI_ENABLED, classifyMessage } from "@/lib/telegram/classify";
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
/**
 * Where the app lives, for the "Edit in app" link on a logged transaction.
 *
 * Null disables the button rather than sending a broken one: Telegram rejects the entire message
 * when a keyboard carries an invalid URL, so a missing base URL must cost the button, never the
 * confirmation itself.
 */
const APP_URL = appBaseUrl(process.env);

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

/**
 * Raised when a request is deliberately aborted, so the caller can tell it apart from a failure.
 *
 * Only the idle long poll is ever aborted, and only on shutdown, where it means "stop waiting"
 * rather than "something went wrong" — a distinction the poll loop's error branch needs, since it
 * otherwise logs and sleeps 3 seconds before retrying.
 */
class RequestAborted extends Error {}

async function telegramApi(
  method: string,
  body: Record<string, any> = {},
  /** Receives a function that cancels this request. Used to interrupt the idle long poll. */
  onAbortable?: (abort: () => void) => void
): Promise<any> {
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
    onAbortable?.(() => req.destroy(new RequestAborted(`${method} aborted`)));
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
  parseMode: "Markdown" | "HTML" = "Markdown",
  replyMarkup?: Record<string, unknown>
): Promise<number | null> {
  // Telegram rejects an over-long message outright, and the plain-text fallback is the same
  // length, so every attempt failed and the user was answered with silence.
  const parts = chunkMessage(text);
  if (parts.length > 1) {
    let lastId: number | null = null;
    let allSent = true;
    for (const [i, part] of parts.entries()) {
      // Buttons belong on the last chunk, where the question they answer ends up.
      const markup = i === parts.length - 1 ? replyMarkup : undefined;
      const id = await sendOne(chatId, part, parseMode, markup);
      if (id === null) allSent = false;
      else lastId = id;
    }
    return allSent ? lastId : null;
  }

  return sendOne(chatId, text, parseMode, replyMarkup);
}

async function sendOne(
  chatId: number | string,
  text: string,
  parseMode: "Markdown" | "HTML",
  replyMarkup?: Record<string, unknown>
): Promise<number | null> {
  const markup = replyMarkup ? { reply_markup: replyMarkup } : {};
  try {
    const sent = await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      ...markup,
    });
    return typeof sent?.message_id === "number" ? sent.message_id : null;
  } catch {
    // Unescaped special characters in the text; plain text is the only thing that can work.
  }

  // The keyboard is dropped from here on. Telegram rejects the whole message when a button
  // carries a URL it will not accept, and that failure repeats identically on every retry — so a
  // committed transaction would go unconfirmed, and a user who assumes it failed resends it,
  // which writes a second row under a new update id. The link is worth less than the receipt.
  for (const delay of [0, 2_000]) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const sent = await telegramApi("sendMessage", { chat_id: chatId, text });
      return typeof sent?.message_id === "number" ? sent.message_id : null;
    } catch (err) {
      console.error("[telegram] failed to send a message:", err instanceof Error ? err.message : err);
    }
  }

  return null;
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
async function confirmCreated(
  chatId: number,
  result: CreatedBatch,
  /**
   * Appended to the confirmation, for a label the write could not honour.
   *
   * `formatCreated` already lists the labels that *were* applied, from the server's own reply,
   * so this carries only what went nowhere. Without it a directive the bot could not resolve was
   * dropped in silence on a message that plainly asked for it — the same bug as the caption,
   * one path over.
   */
  notice = ""
): Promise<void> {
  // The bot cannot edit or delete: `create_transactions` is its only write, and that is
  // deliberate, so a mistyped amount is fixed in the app rather than by giving a chat token
  // destructive powers. One row per batch today, and the link is only meaningful for one.
  const keyboard =
    result.transactions.length === 1
      ? openInAppKeyboard(APP_URL, result.transactions[0].id)
      : undefined;

  if (await sendMessage(chatId, formatCreated(result) + notice, "Markdown", keyboard)) return;

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
      localDate: string;
      categoryName: string;
      labels: { name: string }[];
    }[];
  }>("search_transactions", {
    limit: 5,
    sortBy: "date",
    sortDir: "desc",
    // No icons or colours are rendered here, and they are about a fifth of the payload.
    compact: true,
  });

  if (result.transactions.length === 0) {
    await sendMessage(chatId, "No transactions found.");
    return;
  }

  let msg = `\ud83d\udd52 *Recent Transactions:*\n\n`;
  for (const t of result.transactions) {
    const icon = t.type === "INCOME" ? "\u2795" : "\u2796";
    const labels = t.labels.map((l) => l.name).join(", ");
    msg += `${icon} *${SYMBOL}${t.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}* - ${t.description || t.categoryName}\n`;
    msg += `   \ud83d\udcc1 ${t.categoryName} | \ud83d\udcc5 ${t.localDate}${labels ? ` | \ud83c\udff7\ufe0f ${labels}` : ""}\n\n`;
  }

  await sendMessage(chatId, msg);
}

async function handleBills(chatId: number) {
  const result = await callTool<{
    bills: {
      description: string;
      categoryName: string;
      amount: number;
      /** Absent on an app older than the localDueDate change; used only as a fallback. */
      dueDate?: string;
      localDueDate?: string;
      isOverdue: boolean;
    }[];
  }>("get_upcoming_bills", { days: 30 });

  if (result.bills.length === 0) {
    await sendMessage(chatId, "\ud83c\udf89 No upcoming bills due in the next 30 days!");
    return;
  }

  let msg = `\ud83d\udcc5 *Upcoming Bills (Next 30 Days):*\n\n`;
  for (const b of result.bills) {
    // Formatted from the server's calendar day rather than re-derived from an instant. A due
    // date is date-only, so it is pinned to UTC midnight and read back in UTC: the one thing
    // that must not happen is a timezone shift, which would move it a day for a western reader.
    // The fallback covers a bot pointed at an app that predates `localDueDate` -- supported by
    // TELEGRAM_MCP_URL, and `callTool` casts rather than validates, so a missing field would
    // otherwise print "Invalid Date" for every bill.
    const day = b.localDueDate ?? b.dueDate?.slice(0, 10);
    const due = day
      ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : "date unavailable";
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

/** Receipt line items fetched per call. How many are listed back lives with the renderer. */
const RECEIPT_ITEM_PAGE = 200;
const SEARCH_SHOW_LIMIT = 10;

/**
 * Answer "did I pay X" and "how much did I spend on X" from real rows.
 *
 * Gemini extracts only the term and the period; every figure below comes from `search_transactions`.
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
    from: string | null;
    to: string | null;
    type: "EXPENSE" | "INCOME";
    subject: string;
  }
): Promise<void> {
  const { subject, month } = filters;
  const result = await callTool<{
    transactions: {
      amount: number;
      description: string;
      localDate: string;
      categoryName: string;
      type: string;
      labels: { name: string }[];
    }[];
    period: ReportedPeriod | null;
    totals: { count: number; income: number; expenses: number };
    pagination: { total: number };
  }>("search_transactions", {
    // Constrained to one side of the ledger, so the count, the listed rows and the total all
    // describe the same set.
    type: filters.type,
    ...(filters.search && { search: filters.search }),
    ...(filters.labelId && { labelIds: [filters.labelId] }),
    ...(filters.categoryId && { categoryId: filters.categoryId }),
    // A month and a day range are mutually exclusive, and `parseSearchIntent` has already made
    // sure at most one survived. "Last week" is now answerable as last week rather than as the
    // month it happens to fall in.
    ...(month && { month }),
    ...(filters.from && { from: filters.from }),
    ...(filters.to && { to: filters.to }),
    // Still fetched wider than shown, but no longer to make the total right: `totals` covers
    // every match. The extra rows are what the shared-label note below is counted from.
    limit: SEARCH_SUM_LIMIT,
    sortBy: "date",
    sortDir: "desc",
    compact: true,
  });

  // Taken from what the server says it queried, not from what was sent: a day dropped on the way
  // in would otherwise be described here as though it had been applied.
  const when = describeWindow(result.period);

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

  const matched = result.totals.count;
  // Aggregated by the database over every match, so it no longer depends on how many rows came
  // back. The reply used to have to say "total of the N most recent" whenever the match count
  // exceeded the fetch, which is a hedge on the one number the question was actually about.
  const total = filters.type === "INCOME" ? result.totals.income : result.totals.expenses;
  const money = (n: number) => `${SYMBOL}${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const shown = rows.slice(0, SEARCH_SHOW_LIMIT);

  let msg = `\ud83d\udd0d *${subject}*${when}: ${matched} match${matched === 1 ? "" : "es"}\n\n`;
  for (const r of shown) {
    msg += `\u2022 ${r.localDate}  *${money(r.amount)}*  ${r.description || r.categoryName}\n`;
  }
  if (shown.length < matched) msg += `\n_Showing the ${shown.length} most recent._`;

  if (total > 0) {
    msg += `\n\nTotal: *${money(total)}*`;

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
    /** ISO instant, used for ordering and matching. Render `localDueDate` instead. */
    dueDate: string;
    localDueDate: string;
    status: string;
    daysLate: number | null;
  };
  type Summary = { billId: string; description: string; categoryName: string };
  const history = (args: Record<string, unknown>) =>
    callTool<{ occurrences: Occurrence[]; summaries: Summary[] }>("get_bill_history", args);

  // `occurrences` is capped across every bill together, newest first, so a survey only reaches
  // back as far as the busiest bills allow: ten monthly bills exhaust a hundred rows in under a
  // year. `summaries` is not capped, and carries one row per bill in the window, so the bill is
  // identified from there and the occurrences are fetched per bill afterwards. Asking `limit: 1`
  // makes that explicit: the page is unused.
  const survey = await history({ months, limit: 1 });

  const needle = search.toLowerCase();
  // Matched on the bill's own name only. Including the category name pulled in every other bill
  // sharing it, and the reply then labelled the combined rows with one bill's description, so a
  // second bill's payments were presented as this one's.
  // Matched on the bill's own name only. Including the category name pulled in every other bill
  // sharing it, and the reply then labelled the combined rows with one bill's description, so a
  // second bill's payments were presented as this one's.
  const billIds = survey.summaries
    .filter((b) => b.description.toLowerCase().includes(needle))
    .map((b) => b.billId);

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
      // A bill question carries a month at most: `get_bill_history` is sized in whole months,
      // so there is no narrower window to hand on here.
      from: null,
      to: null,
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
    return `${mark} ${o.localDueDate}${name}  ${o.status.toLowerCase()}  *${money(amount)}*${late}\n`;
  };

  // One name can match several bills. Naming each row is the honest way to show that, rather
  // than titling the lot with whichever happened to sort first.
  const distinct = new Set(matches.map((o) => o.billId));
  const withName = distinct.size > 1;
  const title = withName ? search : matches[0].billDescription;

  // Matched on the server's calendar day. Identical to slicing `dueDate` today, but this is a
  // *match* rather than an ordering, and the raw instant is documented as being for the latter.
  const inMonth = month ? matches.filter((o) => o.localDueDate.slice(0, 7) === month) : matches;

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
        `Most recent record: ${latest.localDueDate}, ${latest.status.toLowerCase()}.`
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
      bills: {
        description: string;
        categoryName: string;
        /** Absent on an app older than the localDueDate change; used only as a fallback. */
        dueDate?: string;
        localDueDate?: string;
        isOverdue: boolean;
      }[];
    }>("get_upcoming_bills", { days: 45 });

    const match = bills.find((b) => (b.description || b.categoryName).toLowerCase().includes(needle));
    if (!match) return null;

    // This whole reply is extra context, so a missing day drops the date rather than the
    // sentence: "it is overdue" is still worth saying without one.
    const day = match.localDueDate ?? match.dueDate?.slice(0, 10);
    if (!day) return match.isOverdue ? "\u26a0\ufe0f It is overdue." : null;

    return match.isOverdue
      ? `\u26a0\ufe0f It is overdue, due ${day}.`
      : `It is still due on ${day}.`;
  } catch {
    // Extra context, not the answer. A failure here must not lose the reply.
    return null;
  }
}

/** Shared money formatter. Every reply below states figures the server computed, never a model's. */
const peso = (n: number) =>
  `${SYMBOL}${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** A signed change, phrased so the direction is unmistakable in a chat. */
const delta = (change: number, percent: number | null): string => {
  if (change === 0) return "no change";
  const dir = change > 0 ? "more" : "less";
  const pct = percent === null ? "" : ` (${Math.abs(percent).toFixed(0)}%)`;
  return `${peso(Math.abs(change))} ${dir}${pct}`;
};

/** "am I spending more than last month?" */
async function handleTrends(chatId: number, month: string | null): Promise<void> {
  const current = month ?? localTimestamp(TZ_OFFSET).slice(0, 7);
  const result = await callTool<{
    currentTotal: number;
    previousTotal: number;
    totalChange: number;
    totalChangePercent: number | null;
    byCategory: {
      name: string;
      current: number;
      previous: number;
      change: number;
      changePercent: number | null;
    }[];
  }>("get_spending_trends", { currentMonth: current, previousMonth: previousMonthOf(current) });

  let msg = `\ud83d\udcc8 *${current} vs ${previousMonthOf(current)}*\n\n`;
  msg += `Spent *${peso(result.currentTotal)}*, against ${peso(result.previousTotal)}.\n`;
  msg += `That is *${delta(result.totalChange, result.totalChangePercent)}*.\n`;

  // Only the categories that actually moved, largest swing first. Listing every category turns a
  // one-line answer into a wall nobody reads.
  const moved = result.byCategory
    .filter((c) => c.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 6);

  if (moved.length > 0) {
    msg += `\n*Biggest changes:*\n`;
    for (const c of moved) {
      msg += `${c.change > 0 ? "\ud83d\udd3a" : "\ud83d\udd3b"} ${c.name}: ${delta(c.change, c.changePercent)}\n`;
    }
  }

  await sendMessage(chatId, msg);
}

/** "show me the last 6 months" */
async function handleMonthly(chatId: number, months: number): Promise<void> {
  const result = await callTool<{
    months: { month: string; income: number; expenses: number; net: number }[];
  }>("get_monthly_summary", { months });

  if (result.months.length === 0) {
    await sendMessage(chatId, "No months with any activity yet.");
    return;
  }

  let msg = `\ud83d\udcc5 *Last ${result.months.length} month${result.months.length === 1 ? "" : "s"}*\n\n`;
  for (const m of result.months) {
    const sign = m.net >= 0 ? "\u2795" : "\u2796";
    msg += `*${m.month}*  in ${peso(m.income)} \u00b7 out ${peso(m.expenses)}\n`;
    msg += `   ${sign} net *${peso(Math.abs(m.net))}*\n`;
  }

  const net = result.months.reduce((sum, m) => sum + m.net, 0);
  msg += `\nOver the period: *${peso(Math.abs(net))}* ${net >= 0 ? "saved" : "overspent"}`;

  await sendMessage(chatId, msg);
}

/** "what were my biggest expenses?" */
async function handleTopExpenses(chatId: number, month: string | null): Promise<void> {
  const result = await callTool<{
    expenses: {
      amount: number;
      description: string;
      localDate: string;
      categoryName: string;
    }[];
  }>("get_top_expenses", { limit: 10, ...(month && { month }) });

  if (result.expenses.length === 0) {
    await sendMessage(chatId, `No expenses found${month ? ` in ${month}` : ""}.`);
    return;
  }

  let msg = `\ud83d\udcb8 *Biggest expenses${month ? ` in ${month}` : ""}*\n\n`;
  for (const [i, e] of result.expenses.entries()) {
    msg += `${i + 1}. *${peso(e.amount)}*  ${e.description || e.categoryName}\n`;
    msg += `    ${e.localDate} \u00b7 ${e.categoryName}\n`;
  }

  await sendMessage(chatId, msg);
}

/** "where did my work budget go?" */
async function handleLabelBreakdown(chatId: number, month: string | null): Promise<void> {
  const target = month ?? localTimestamp(TZ_OFFSET).slice(0, 7);
  const result = await callTool<{
    total: number;
    labels: { name: string; amount: number; percentage: number; transactionCount: number }[];
  }>("get_label_breakdown", { month: target, type: "EXPENSE" });

  await sendMessage(chatId, renderLabelBreakdown(target, result.labels, result.total, peso));
}

interface ReceiptItem {
  name: string;
  amount: number;
  transactionId: string;
  transactionDescription: string;
  categoryName: string;
  /** The user's own calendar day, resolved server-side. */
  localDate: string;
  receiptGroupId: string | null;
}

interface ReceiptItemsResult {
  itemCount: number;
  totalAmount: number;
  truncated: boolean;
  items: ReceiptItem[];
}

/**
 * "what did I buy at South Supermarket?", "did I buy okra?", "what was on that receipt?"
 *
 * Three questions with different scopes, and the tool answers only one of them directly: its
 * `search` matches the *item* name, never the merchant. Asking it for "south supermarket" returns
 * nothing at all while hundreds of that shop's items sit in the table.
 *
 * So the item name is tried first, being cheap and exact; a miss falls back to matching the
 * merchant over a fetched page; and a question with no subject at all is read as "the last
 * receipt" rather than as the whole history, because totalling every itemized receipt ever and
 * offering it as the answer to a singular question is a different answer to the one asked.
 */
async function handleReceiptItems(
  chatId: number,
  search: string | null,
  month: string | null
): Promise<void> {
  const fetchItems = (args: Record<string, unknown>) =>
    callTool<ReceiptItemsResult>("get_receipt_items", { limit: RECEIPT_ITEM_PAGE, ...args });

  const monthArgs = month ? { month } : {};
  const when = month ? ` in ${month}` : "";

  // --- "what was on that receipt": no subject, so the newest one is what was meant ---
  if (!search) {
    const page = await fetchItems(monthArgs);
    if (page.items.length === 0) {
      await sendMessage(chatId, `\ud83e\uddfe No itemized receipts${when} yet.`);
      return;
    }

    // Items come back newest first, so the first one identifies the most recent receipt. A
    // receipt group is the reliable handle; a receipt with no group is a single transaction, and
    // its own id serves the same purpose.
    const newest = page.items[0];
    const scoped = newest.receiptGroupId
      ? await fetchItems({ receiptGroupId: newest.receiptGroupId })
      : {
          ...page,
          items: page.items.filter((i) => i.transactionId === newest.transactionId),
        };
    const items = scoped.items;
    const total = newest.receiptGroupId
      ? scoped.totalAmount
      : items.reduce((sum, i) => sum + i.amount, 0);

    await sendMessage(
      chatId,
      renderReceiptItems({
        heading: `Last receipt: *${newest.transactionDescription || newest.categoryName}*`,
        subheading: newest.localDate,
        items,
        itemCount: newest.receiptGroupId ? scoped.itemCount : items.length,
        total,
        // A named group is fetched whole, so nothing here is a partial view.
        partial: false,
      }, peso)
    );
    return;
  }

  // --- item name, which the tool matches directly ---
  const direct = await fetchItems({ search, ...monthArgs });
  if (direct.items.length > 0) {
    await sendMessage(
      chatId,
      renderReceiptItems({
        heading: `Receipt items for *${search}*${when}`,
        items: direct.items,
        itemCount: direct.itemCount,
        // The query computes itemCount and totalAmount over every match and slices only the list,
        // so this total is complete even when the list is not. Calling it partial would make a
        // correct figure look untrustworthy.
        total: direct.totalAmount,
        partial: false,
      }, peso)
    );
    return;
  }

  // --- merchant, matched locally because the tool cannot ---
  const page = await fetchItems(monthArgs);
  const needle = search.toLowerCase();
  const matched = page.items.filter((i) =>
    i.transactionDescription.toLowerCase().includes(needle)
  );

  if (matched.length === 0) {
    // The page is capped, so an absence here is only an absence within what was fetched. Saying
    // "none" would assert something about lines that were never looked at.
    await sendMessage(
      chatId,
      page.truncated
        ? `\ud83e\uddfe Nothing for *${search}* in the ${page.items.length} most recent receipt lines${when}, ` +
            `and there are older ones I could not search. Try naming an item, or a month.`
        : `\ud83e\uddfe No receipt items for *${search}*${when}.\n\n` +
            `Only receipts scanned with the itemize option keep their line items, and I match ` +
            `either the item name or the shop.`
    );
    return;
  }

  await sendMessage(
    chatId,
    renderReceiptItems({
      heading: `Receipt items for *${search}*${when}`,
      subheading: "Matched on the shop rather than the item name",
      items: matched,
      itemCount: matched.length,
      total: matched.reduce((sum, i) => sum + i.amount, 0),
      // Recomputed from a page that may itself have been capped, so this total is only ever
      // "what I could see". Unlike the direct path above, that caveat is real here.
      partial: page.truncated,
    }, peso)
  );
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

/** The label list, and whether it was actually read. */
interface LabelLookup {
  labels: BotLabel[];
  /**
   * False when the lookup failed, which an empty list cannot say on its own.
   *
   * The difference is user-visible: "you don't have a label called pickleball, create it in the
   * app" is confidently wrong when the truth is that nothing could be read, and it points at the
   * wrong fix — the cause is a token minted without `labels:read`, not a missing label.
   */
  readable: boolean;
}

/**
 * The user's labels, or none, never an error.
 *
 * A failure here is absorbed rather than propagated. `get_label_list` needs `labels:read`, which
 * older tokens were minted without, and losing labels costs precision on one kind of question and
 * the ability to honour an explicit "label it X". Letting it throw would fail *every* message,
 * including plain logging, over a scope the setup notes did not always ask for.
 *
 * Shared by the receipt path and the free-text path. The receipt path needs it because a caption
 * can name a label, and it used to be fetched only inside the Gemini branch, which a photo never
 * reaches.
 */
async function loadLabels(): Promise<LabelLookup> {
  // Fetched unfiltered, with `applicableTo` on each row: filtering to one type here would make
  // an income-only label look *missing* to a receipt, and "create it in the app" is the wrong
  // advice for a label the user is looking at. The mismatch is reported as itself instead.
  return callTool<{ labels: BotLabel[] }>("get_label_list")
    .then((r) => ({ labels: r.labels, readable: true }))
    .catch(() => {
      console.warn(
        "[telegram] could not read labels, so labels are unavailable. " +
          "Mint a token with labels:read to enable them."
      );
      return { labels: [] as BotLabel[], readable: false };
    });
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
  categories: { id: string; name: string; type: string }[],
  labelLookup: LabelLookup
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
  const rawCaption = message.caption?.trim();

  // "label it in pickleball" used to reach Gemini inside the caption and go nowhere: nothing on
  // this path knew what a label was, so the request was dropped and the row saved unlabelled.
  // It is read out here and applied on save; what is left goes to the scanner as the hint it
  // always was, so the directive no longer competes with the description it sits beside.
  //
  // The *category* half of a caption ("category fun") is deliberately left in. Gemini sees the
  // whole category list and picks from it, which the bot has no better answer than.
  const directive = readLabelDirective(rawCaption ?? "", labelLookup.labels, "EXPENSE");
  const caption = directive.rest || undefined;

  let scan: ScannedReceipt;
  let photoTakenAt: string | null = null;
  try {
    const image = await downloadTelegramFile(pick.fileId);
    // Only survives when the image was sent as a file. Telegram re-encodes anything sent as a
    // photo, which strips the metadata, so this is null for most uploads and the scan falls back
    // to today exactly as it did before.
    photoTakenAt = readPhotoTakenAt(image);

    // The caption is the one piece of context the user volunteered, and it was being read off
    // the message and thrown away. It goes to the scanner as a hint rather than being pasted over
    // the description afterwards: "here you go" is an ordinary thing to send with a photo, and
    // overwriting a correctly-read merchant name with it would be worse than ignoring it.
    scan = await callTool<ScannedReceipt>("scan_receipt", {
      imageBase64: image.toString("base64"),
      mimeType: pick.mimeType,
      localDate: localTimestamp(TZ_OFFSET).slice(0, 10),
      ...(photoTakenAt && { photoTakenAt }),
      ...(caption && { caption }),
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
  // Said out loud, because the user cannot otherwise tell whether their caption was read or
  // ignored, and this is the moment they can still correct it. Same principle as the date repair:
  // an inference the user cannot see is one they cannot undo.
  if (caption) reply += `\n\u2139\ufe0f I used your caption as a hint.\n`;
  reply += renderLabelNotice(directive, labelLookup.readable);

  reply += `\nNothing is saved yet. Tap a button below, or send a short description to correct it.`;

  // Stored only once the review has actually reached the user, which is the entire point of the
  // confirmation step. Storing first meant an undelivered prompt left a draft nobody had seen,
  // and any bare "yes" in the next ten minutes would save an unreviewed transaction. Ordering it
  // this way also leaves a superseded draft intact for free: nothing is overwritten until the
  // replacement has been shown.
  // Buttons carry the *photo's* update id. They never expire from chat history, so an old
  // review stays tappable: without the id, scrolling up and tapping Save would confirm whichever
  // scan is pending now, showing one amount and saving another.
  const buttons = {
    inline_keyboard: [
      [
        { text: "\u2705 Save", callback_data: encodeScanCallback({ action: "save", updateId }) },
        { text: "\u274c Discard", callback_data: encodeScanCallback({ action: "discard", updateId }) },
      ],
    ],
  };

  const reviewMessageId = await sendMessage(chatId, reply, "Markdown", buttons);
  if (!reviewMessageId) {
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
    reviewMessageId,
    createdAt: Date.now(),
    labelIds: directive.ids,
    labelNames: directive.names,
  });
}

/**
 * Save a confirmed scan and tell the user what happened.
 *
 * Shared by the typed "yes" and the Save button so the two cannot drift. The scan has already
 * been taken from the pending map, so every failure path inside `confirmPendingScan` puts it back.
 */
async function saveConfirmedScan(chatId: number, scan: PendingScan): Promise<void> {
  // Whichever way it was answered. A typed "yes" used to leave the keyboard live on a review that
  // was already saved, so tapping it later said the receipt was gone.
  if (scan.reviewMessageId) await clearButtons(chatId, scan.reviewMessageId);

  const outcome = await confirmPendingScan(scan, {
    save: (key, s) => createTransactions(key, [scanToTransaction(s)]),
    // Restored with a fresh timestamp so a save that failed near the TTL does not leave the
    // user a scan they can no longer confirm.
    restore: (s, { frozen }) => putPendingScan(chatId, { ...s, createdAt: Date.now(), frozen }),
    batchKey: (s) => updateBatchId(BOT_ID, s.updateId),
  });

  if (outcome.status === "saved") {
    await confirmCreated(chatId, outcome.batch as CreatedBatch);
    return;
  }

  await sendMessage(chatId, "I could not save that receipt. Reply *yes* to try again.");
}

/** Acknowledge a press so the client stops spinning. Best effort: a failure here costs a spinner,
 *  never the action, so it must not abort what the press asked for. */
async function answerCallback(id: string, text?: string): Promise<void> {
  await telegramApi("answerCallbackQuery", {
    callback_query_id: id,
    ...(text && { text }),
  }).catch(() => {});
}

/** Take the buttons off a review that has been answered, so it cannot be tapped twice. */
async function clearButtons(chatId: number, messageId: number): Promise<void> {
  await telegramApi("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => {});
}

/**
 * Act on a Save or Discard press.
 *
 * The identity check is the whole reason `callback_data` carries an update id. Buttons persist in
 * chat history indefinitely, so a review from an hour ago is still tappable, and acting on the
 * currently pending scan would save something the user is not looking at.
 */
async function handleCallback(query: TelegramCallbackQuery): Promise<void> {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (chatId === undefined || messageId === undefined) return;

  const parsed = parseScanCallback(query.data);
  if (!parsed) {
    await answerCallback(query.id, "I don't recognise that button.");
    return;
  }

  const pending = peekPendingScan(chatId);
  if (!pending) {
    await answerCallback(query.id, "That receipt is no longer waiting.");
    await clearButtons(chatId, messageId);
    return;
  }
  if (pending.updateId !== parsed.updateId) {
    // An older review. Left tappable-looking rather than silently acting on the wrong scan.
    await answerCallback(query.id, "That's an older receipt. Use the most recent one.");
    await clearButtons(chatId, messageId);
    return;
  }

  const scan = takePendingScan(chatId);
  if (!scan) {
    await answerCallback(query.id, "That receipt is no longer waiting.");
    return;
  }

  if (parsed.action === "discard") {
    await clearButtons(chatId, messageId);
    await answerCallback(query.id, "Discarded.");
    await sendMessage(chatId, "Discarded. Nothing was saved.");
    return;
  }

  await answerCallback(query.id, "Saving...");
  await saveConfirmedScan(chatId, scan);
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
    // Labels are needed here now, because a caption can name one. Fetched unconditionally rather
    // than only when a caption exists: the call is cheap next to a scan, and branching on it
    // would make the failure mode depend on whether the user happened to type something.
    await handleReceiptPhoto(message, updateId, categories, await loadLabels());
    return;
  }

  if (!text) return;

  // Answering a scan that is waiting. Checked before everything else: while one is pending, a
  // bare "yes" means that and nothing else. Anything that is not a clear yes or no falls through
  // to normal handling, so typing another expense logs it rather than being refused.
  if (isConfirmation(text)) {
    const scan = takePendingScan(chatId);
    if (scan) {
      await saveConfirmedScan(chatId, scan);
      return;
    }
  }


  // A reply that is not yes or no, and is not already something this bot does, corrects the
  // description. It used to fall through and be classified as an unrelated message, so the most
  // natural way to fix a wrong description — just typing the right one — was silently dropped
  // while the scan sat waiting. Nothing is re-scanned: the correction is the user's own words, and
  // a second scan would spend another credit for a field they have already supplied.
  if (isScanCorrection(text)) {
    // A reply can correct either half of the draft. "label it pickleball" is not a description,
    // and pasting it over one was all this could do before. Labels are only looked up when a
    // scan is actually waiting, so an ordinary message never pays for the call.
    const lookup =
      hasPendingScan(chatId) && mentionsLabel(text) ? await loadLabels() : null;
    const directive = lookup ? readLabelDirective(text, lookup.labels, "EXPENSE") : null;
    // Any directive the parser understood is a label edit, including one naming a label that
    // cannot apply to an expense. Leaving `incompatible` out of this test sent "label it salary"
    // down the description branch, so the draft was renamed "Label it salary".
    const isLabelEdit =
      !!directive &&
      (directive.ids.length > 0 ||
        directive.unresolved.length > 0 ||
        directive.incompatible.length > 0);
    // `rest` is only a description when the directive was actually cut out of it. A bare unmarked
    // one is reported but deliberately left in place, so `rest` is then the whole untouched reply
    // and "label badminton" would become the description of the purchase. Asking the parser is
    // exact where testing `ids.length` was merely cautious: it also dropped the perfectly good
    // "court fee" from "court fee, label it badminton".
    const alsoDescribes = isLabelEdit && directive.removedDirective && !!directive.rest;

    const patch = isLabelEdit
      ? {
          ...(alsoDescribes && { description: correctedDescription(directive.rest) }),
          ...(directive.ids.length > 0 && {
            labelIds: directive.ids,
            labelNames: directive.names,
          }),
        }
      : { description: correctedDescription(text) };

    const result = revisePendingScan(chatId, patch);

    if (result.status === "frozen") {
      // The save never settled, so the row may already exist. A retry replays the same key and
      // would return the original, silently discarding this edit — so it is refused rather than
      // accepted and lost. Same rule the web app's review applies to a pinned row.
      await sendMessage(
        chatId,
        "I could not confirm whether that receipt saved, so it can't be edited now — answering *yes* has to replay exactly what was sent. Reply *yes* to settle it, or check the app and reply *no*."
      );
      return;
    }

    if (result.status === "revised") {
      const { scan: revised } = result;
      // Named for what actually changed. "Description updated" on a reply that only moved a
      // label reads like the wrong thing was edited.
      const heading = !isLabelEdit
        ? "Description updated"
        : alsoDescribes
          ? "Draft updated"
          : directive.ids.length > 0
            ? "Labels updated"
            : "Nothing changed";
      let msg = `\u270f\ufe0f *${heading}*\n\n`;
      msg += `\ud83d\udcdd *Description:* ${revised.description}\n`;
      msg += `\ud83d\udcb0 *Amount:* ${SYMBOL}${revised.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
      msg += `\ud83d\udcc1 *Category:* ${revised.categoryName}\n`;
      msg += `\ud83d\udcc5 *Date:* ${revised.date}\n`;
      msg += renderLabelNotice(
        {
          names: revised.labelNames,
          unresolved: directive?.unresolved ?? [],
          incompatible: directive?.incompatible ?? [],
        },
        lookup?.readable ?? true
      );
      msg += `\nStill not saved. Reply *yes* to save it, or *no* to discard.`;
      await sendMessage(chatId, msg);
      return;
    }
  }

  if (isRejection(text)) {
    const scan = takePendingScan(chatId);
    if (scan) {
      if (scan.reviewMessageId) await clearButtons(chatId, scan.reviewMessageId);
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
      `\ud83d\udcca *Reports:*\n` +
      `\u2022 \`am I spending more than last month\`\n` +
      `\u2022 \`show me the last 6 months\`\n` +
      `\u2022 \`what were my biggest expenses\`\n` +
      `\u2022 \`where did my work budget go\`\n` +
      `\u2022 \`what did I buy at south supermarket\`\n\n` +
      `\ud83d\udd0d *Ask about what you logged:*\n` +
      `\u2022 \`did I pay meralco this month\`\n` +
      `\u2022 \`how much on transportation in work budget\`\n` +
      `\u2022 \`did I pay the water bill\`\n\n` +
      `The slash is optional, and you can ask in your own words. Type / for the full menu, ` +
      `or /examples for a list you can copy from.`;
    await sendMessage(chatId, msg);
    return;
  }

  if (command === "EXAMPLES") {
    await sendMessage(chatId, EXAMPLES_MESSAGE);
    return;
  }

  if (command) {
    const handlers: Record<Exclude<BotCommand, "HELP" | "EXAMPLES">, (chatId: number) => Promise<void>> = {
      SUMMARY: handleSummary,
      RECENT: handleRecent,
      BILLS: handleBills,
      CATEGORIES: handleCategories,
      // The reporting commands take a month; the slash form asks about the default period, and
      // the plain-English form is where a month can be named.
      TRENDS: (id) => handleTrends(id, null),
      MONTHS: (id) => handleMonthly(id, 6),
      TOP: (id) => handleTopExpenses(id, null),
      LABELS: (id) => handleLabelBreakdown(id, null),
      ITEMS: (id) => handleReceiptItems(id, null, null),
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

  // Fetched at most once per message, and only by a path that needs it. The shorthand logger
  // exists to answer "100 breakfast" without extra round trips, so it asks only when the text
  // plausibly names a label; the Gemini path always needs them, for filters as well as writes.
  let labelsPromise: Promise<LabelLookup> | null = null;
  const labels = () => (labelsPromise ??= loadLabels());

  if (quickIncomeMatch || quickExpenseMatch) {
    const isIncome = !!quickIncomeMatch;
    const match = isIncome ? quickIncomeMatch! : quickExpenseMatch!;
    const amount = parseFloat(match[1]);
    const written = match[2].trim();

    // "150 pickleball fee, label it pickleball" used to log the directive as part of its own
    // description and apply nothing. Read out here, it costs no model call, so it keeps working
    // with no GEMINI_API_KEY — which is the whole reason this path exists.
    const type = isIncome ? "INCOME" : "EXPENSE";
    const lookup = mentionsLabel(written) ? await labels() : null;
    const directive = lookup ? readLabelDirective(written, lookup.labels, type) : null;
    // A message that is *only* a directive leaves nothing to describe the purchase. Falling
    // through is better than logging "label it pickleball" as the description: Gemini can write
    // one, and without Gemini the user gets the same "I did not understand" they always did.
    const description = directive ? directive.rest : written;

    if (amount > 0 && description) {
      // No confident match returns null rather than a guess. It used to fall back to the first
      // category of that type, and the list is ordered defaults-first then alphabetically, so
      // with the seeded data every unrecognised expense was filed under Education.
      let matchedCat = matchCategory(description, type, categories);

      // Gemini sees the whole list and can choose properly, so the fast path steps aside for it.
      // Only when there is no Gemini does an explicit "Other" bucket become the least-bad
      // answer: it is at least somewhere the user would recognise as unsorted.
      if (!matchedCat && !GEMINI_ENABLED) matchedCat = findOtherCategory(type, categories);

      if (matchedCat) {
        const clientBatchId = updateBatchId(BOT_ID, updateId);

        const result = await createTransactions(clientBatchId, [
          {
            amount,
            description: description.charAt(0).toUpperCase() + description.slice(1),
            type,
            categoryId: matchedCat.id,
            date: new Date().toISOString(),
            // Omitted when none was named, so the user's auto-apply schedules still run. This
            // path always stamps the current instant, so that time is real and they should.
            ...(directive && directive.ids.length > 0 && { labelIds: directive.ids }),
          },
        ]);

        if (result.transactions.length > 0) {
          await confirmCreated(
            chatId,
            result,
            renderLabelNotice(
              {
                names: [],
                unresolved: directive?.unresolved ?? [],
                incompatible: directive?.incompatible ?? [],
              },
              lookup?.readable ?? true
            )
          );
          return;
        }
      }
    }
  }

  // Fallback to Gemini AI natural language processing
  if (GEMINI_ENABLED) {
    const { labels: knownLabels, readable: labelsReadable } = await labels();

    const aiResult = await classifyMessage(text, categories, knownLabels, TZ_OFFSET);
    if (aiResult?.action === "CREATE_TRANSACTION" && aiResult.transaction) {
      const txData = aiResult.transaction;
      const clientBatchId = updateBatchId(BOT_ID, updateId);
      // Resolved against the real list rather than trusted, the same boundary `parseSearchIntent`
      // draws: the model is given names and can return one nobody has. A hallucinated label on a
      // *search* costs a wrong answer; on a write it lands on the row, and `getLabelBreakdown`
      // splits an amount across whatever labels it carries, so it quietly moves money.
      const namedLabels: string[] = Array.isArray(txData.labels) ? txData.labels : [];

      // And read the directive locally as well, merging the two. The model is asked to fill
      // `labels` and is not obliged to: "spent 350 yesterday, tag it work" can come back as a
      // perfectly good CREATE_TRANSACTION with `labels: null`, and the instruction would vanish
      // with nothing saying so. The parser is deterministic where the model is not, which is the
      // same argument `commands.ts` makes for resolving obvious phrasings before asking Gemini.
      // It also carries the reporting: when the list could not be read, `knownLabels` is empty
      // and every name the user asked for lands in `unresolved`.
      const asked = mentionsLabel(text)
        ? readLabelDirective(text, knownLabels, txData.type === "INCOME" ? "INCOME" : "EXPENSE")
        : null;

      const labelIds = [
        ...new Set([
          ...namedLabels
            .map((name) => findByName(knownLabels, name)?.id)
            .filter((id): id is string => !!id),
          ...(asked?.ids ?? []),
        ]),
      ];

      const result = await createTransactions(clientBatchId, [
        {
          amount: txData.amount,
          description: txData.description,
          type: txData.type,
          categoryId: txData.categoryId,
          date: txData.date || new Date().toISOString(),
          ...(labelIds.length > 0 && { labelIds }),
        },
      ]);

      if (result.transactions.length > 0) {
        // Only what the *user* asked for and did not get. A name the model invented is dropped
        // in silence on purpose: nobody asked for it, so there is nothing to report.
        await confirmCreated(
          chatId,
          result,
          renderLabelNotice(
            {
              names: [],
              unresolved: asked?.unresolved ?? [],
              incompatible: asked?.incompatible ?? [],
            },
            labelsReadable
          )
        );
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
    // The reporting intents take a month, or a count of months, and nothing else. Both are
    // validated the same way as every other model-supplied value: a month the query cannot use
    // would silently report on the wrong period, and "no spending" reads like an answer.
    const report = parseReportIntent(aiResult);
    if (report) {
      // A report the token cannot reach should say which one, not fail the whole message. The
      // startup probe already names a missing tool, but a token narrowed after the bot started
      // would otherwise surface as a bare error on an ordinary question.
      switch (report.kind) {
        case "TRENDS":
          await handleTrends(chatId, report.month);
          return;
        case "MONTHLY":
          await handleMonthly(chatId, report.months);
          return;
        case "TOP_EXPENSES":
          await handleTopExpenses(chatId, report.month);
          return;
        case "LABEL_BREAKDOWN":
          await handleLabelBreakdown(chatId, report.month);
          return;
        case "RECEIPT_ITEMS":
          await handleReceiptItems(chatId, report.search, report.month);
          return;
      }
    }

    const intent = parseSearchIntent(aiResult, { labels: knownLabels, categories });
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
    !quick && !GEMINI_ENABLED
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
  "get_spending_trends",
  "get_monthly_summary",
  "get_top_expenses",
  "get_label_breakdown",
  "get_receipt_items",
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
            "Mint one with budget:read, transactions:read, labels:read, bills:read, receipts:read, receipts:scan and transactions:write."
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

/**
 * Register the "/" menu, for the allowlisted chats only.
 *
 * Without this the autocomplete list is empty and every feature has to be remembered, or looked
 * up in /help, which is itself something to remember.
 *
 * Scoped per chat rather than published by default. The default scope is shown to *everyone* who
 * finds the bot, and this bot deliberately answers strangers with nothing at all: bot usernames
 * are searchable and the t.me link is public, so a reply would confirm the bot is live and whose
 * it is. A default menu would announce the same thing more loudly, listing "this month's balance"
 * and "your biggest expenses" to someone who is then met with silence when they tap any of it.
 *
 * The default scope is cleared as well, so an earlier build that published one does not leave it
 * behind.
 *
 * Only numeric ids can be scoped, since a chat scope needs a chat id and a username is not one.
 * A username-only allowlist therefore gets no menu, which is the safe direction: no menu costs
 * discoverability, a public one costs the silence the allowlist exists to preserve.
 */
async function registerCommandMenu(): Promise<void> {
  try {
    const calls = menuRegistrations(ALLOWED_IDS);

    if (calls.length === 1) {
      console.warn(
        "[telegram] no numeric ids in the allowlist, so the / menu cannot be scoped to a chat " +
          "and was not published. Set TELEGRAM_ALLOWED_IDS to enable it."
      );
    }

    // Each call is settled on its own. Sharing one try/catch meant a single bad chat id, a user
    // who has blocked the bot for instance, silently cost every later id its menu.
    for (const call of calls) {
      try {
        await telegramApi(call.method, call.params);
      } catch (err) {
        console.warn(
          `[telegram] ${call.method} failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    // Discoverability is worth having and worth nothing compared to the bot running, so a
    // failure here is reported and stepped over.
    console.warn(
      "[telegram] could not register the command menu:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Tell Telegram everything below `offset` is done, so no other container is handed it again.
 *
 * Advancing the local `offset` settles nothing: an update is confirmed only when a *later*
 * `getUpdates` carries a higher offset. Normally that happens on the next loop iteration, so the
 * exposed window is exactly "while a handler is running" — and a process killed inside one leaves
 * the batch unconfirmed for the next container to replay. Writes survive that (`create_transactions`
 * keys on the update id) but `scan_receipt` does not, so the receipt is charged twice (#165).
 *
 * Called immediately after each handled update rather than only at shutdown. Doing it at shutdown
 * covers SIGTERM and nothing else, and in this deployment it does not reliably cover even that:
 * the bot runs inside the Next server, whose own signal handler calls `process.exit(0)` as soon as
 * the HTTP server closes, so a shutdown-time confirmation is racing it. Confirming as we go needs
 * no cooperation from anything — it holds for SIGKILL, an OOM kill and a lost race alike.
 *
 * `timeout: 0` so it returns at once instead of parking for another long poll, and `limit: 1`
 * because nothing reads the response; only the offset it carries matters. Best effort: a failure
 * here is the redelivery that already happened before this existed, not a new failure mode.
 */
async function confirmProcessed(offset: number, context = "stopped"): Promise<void> {
  if (offset === 0) return;

  try {
    await telegramApi("getUpdates", { offset, timeout: 0, limit: 1 });
    if (context === "stopped") {
      console.warn(`[telegram] stopped cleanly; updates confirmed up to ${offset - 1}.`);
    }
  } catch (err) {
    console.error(
      `[telegram] ${context}, but could not confirm update ${offset - 1}, so it may be redelivered:`,
      err instanceof Error ? err.message : err
    );
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
        "budget:read, transactions:read, labels:read, bills:read, receipts:read, receipts:scan and transactions:write " +
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
  await registerCommandMenu();

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

  const shutdown = newShutdownState();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      const outcome = requestShutdown(shutdown);
      console.warn(
        `[telegram] ${signal} received; ` +
          (outcome === "aborted_idle_poll"
            ? "stopping after the current poll."
            : "finishing the update in flight first.")
      );
    });
  }

  while (true) {
    try {
      const updates = await telegramApi(
        "getUpdates",
        { offset, timeout: 20 },
        // Parked here is where the loop spends nearly all its time, and the poll outlasts
        // Docker's default 10s grace period. Interrupting it is what lets an idle bot exit
        // promptly instead of being SIGKILLed mid-wait.
        (abort) => {
          shutdown.abortIdlePoll = abort;
        }
      );
      shutdown.abortIdlePoll = undefined;

      for (const update of updates) {
        // Between updates, never inside one. A half-finished update is exactly the state that
        // leaves a batch unconfirmed and gets a receipt scanned twice on the replay.
        if (shouldStop(shutdown)) {
          await confirmProcessed(offset);
          return;
        }

        offset = update.update_id + 1;

        // A button press is a callback_query, not a message, and used to be dropped by the check
        // below. It carries its own allowlist: the shape differs, and a message with buttons can
        // be forwarded, so what matters is who tapped it rather than who was sent it.
        if (update.callback_query) {
          const presser = update.callback_query.from;
          if (!callbackIsAllowed(update.callback_query, ALLOWLIST)) {
            console.warn(
              `[telegram] denied a button press from id=${presser?.id ?? "unknown"} ` +
                `username=@${presser?.username ?? "none"}. Only private chats are answered.`
            );
            continue;
          }
          try {
            shutdown.handling = true;
            await handleCallback(update.callback_query);
          } catch (err) {
            console.error(
              "[telegram] failed to handle a button press:",
              err instanceof Error ? err.message : err
            );
            const chatId = update.callback_query.message?.chat?.id;
            if (chatId !== undefined) {
              await sendMessage(chatId, replyForError(err)).catch(() => {});
            }
          } finally {
            shutdown.handling = false;
          }
          // Settled now rather than on the next poll, so being killed between the two cannot
          // hand this update to another container.
          await confirmProcessed(offset, "handled a button press");
          continue;
        }

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
          shutdown.handling = true;
          await handleMessage(update.message, update.update_id);
        } catch (err) {
          console.error(
            "[telegram] failed to handle an update:",
            err instanceof Error ? err.message : err
          );
          await sendMessage(update.message.chat.id, replyForError(err)).catch(() => {});
        } finally {
          shutdown.handling = false;
        }
        // Settled immediately: a receipt scan is the expensive thing in here, and a replay after
        // one has already run spends a second credit.
        await confirmProcessed(offset, "handled an update");
      }
    } catch (err: any) {
      shutdown.abortIdlePoll = undefined;
      // A deliberate abort is not a failure: it means the shutdown handler interrupted the idle
      // poll, so the loop should exit rather than log and sleep three seconds before retrying.
      if (err instanceof RequestAborted) {
        await confirmProcessed(offset);
        return;
      }
      console.error("[telegram] polling error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // The batch is drained. Confirm it before a stop, so the replacement container is not handed
    // work this one already did.
    if (shouldStop(shutdown)) {
      await confirmProcessed(offset);
      return;
    }
  }
}
