/**
 * The bot's only network path to Telegram.
 *
 * Extracted from `bot.ts` so something other than the poller can send a message. The daily prompt
 * is sent by a cron route, which has no business importing the poll loop, the MCP client or the
 * Gemini classifier just to reach `sendMessage`. A second copy of this in the route was the
 * alternative and was rejected: it carries the DNS override and the plain-text retry fallback,
 * both of which took real bugs to get right, and a duplicate drifts the moment either changes.
 */
// `node:` prefixed so the Next server bundle resolves them as built-ins rather than looking for
// browser polyfills, which is what the bare specifiers made it do.
import https from "node:https";
import dns from "node:dns";
import { chunkMessage } from "@/lib/telegram/chunk";
import { env } from "@/lib/telegram/env";

export const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");

/**
 * An address to use for api.telegram.org instead of asking the resolver.
 *
 * Only for a network whose DNS sinkholes Telegram, which is why the bot was written with an
 * address baked in. Hardcoding it is a liability rather than a safety net: Telegram rotates
 * these, and a rotation would then break every request even where DNS works perfectly. Unset by
 * default, so the resolver is used, and the deployed container needs nothing.
 */
const TELEGRAM_API_IP = env("TELEGRAM_API_IP");

export const agent = new https.Agent({
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
export const REQUEST_TIMEOUT_MS = 40_000;

/**
 * Raised when a request is deliberately aborted, so the caller can tell it apart from a failure.
 *
 * Only the idle long poll is ever aborted, and only on shutdown, where it means "stop waiting"
 * rather than "something went wrong" — a distinction the poll loop's error branch needs, since it
 * otherwise logs and sleeps 3 seconds before retrying.
 */
export class RequestAborted extends Error {}

export async function telegramApi(
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
export async function sendMessage(
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
