import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { userToday, utcDayKey } from "@/lib/bill-dates";
import { composePrompt, isPromptDue } from "@/lib/telegram/daily-prompt";
import { encodePromptCallback } from "@/lib/telegram/callback-data";
import { sendMessage } from "@/lib/telegram/send";
import { env } from "@/lib/telegram/env";
import { telegramPromptOwnerId } from "@/lib/telegram/prompt-owner";

/** The categories the prompt asks about, by their seeded names. */
const FARE_CATEGORY = "Transportation";
const LUNCH_CATEGORY = "Food & Dining";

/**
 * The chats this bot may message, from the same allowlist that gates incoming messages.
 *
 * Numeric ids only. In a private chat the chat id is the user's own id, and a username cannot
 * address a chat, so a username-only allowlist gets no prompt - the same limitation the command
 * menu already has, and for the same reason.
 */
const allowedChatIds = (): number[] =>
  (env("TELEGRAM_ALLOWED_IDS") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => /^[1-9]\d*$/.test(v))
    .map(Number)
    .filter(Number.isSafeInteger);

/**
 * Sends the evening prompt to anyone who has it switched on and has not had it today.
 *
 * Driven by a Coolify Scheduled Task every 15 minutes. The schedule itself lives in
 * `users.telegram_daily_prompt_time`, resolved against `users.timezone_offset`, so this endpoint
 * is called far more often than it does anything and the cron entry never has to change.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The bot serves exactly one budget - the one its MCP token was minted for - so the prompt is
  // scoped to that account and cannot be switched on by anybody else. Without this, a second user
  // enabling it would have their day read and this chat messaged about it.
  const ownerId = await telegramPromptOwnerId(prisma);
  if (!ownerId) {
    return NextResponse.json({ usersProcessed: 0, promptsSent: 0, errors: 0, owner: null });
  }

  const users = await prisma.user.findMany({
    where: { id: ownerId, telegramDailyPrompt: true },
    select: { id: true, timezoneOffset: true, telegramDailyPromptTime: true },
  });

  const chatIds = allowedChatIds();
  if (users.length === 0 || chatIds.length === 0) {
    return NextResponse.json({ usersProcessed: users.length, promptsSent: 0, errors: 0 });
  }

  // One recipient, deliberately. The allowlist answers "who may talk to the bot", never "whose
  // budget is this", so a second id is somebody else - and sending there would tell them whether
  // the owner has logged their fare and lunch today. Refusing is the same rule the owner-scoping
  // above already applies: with nothing mapping a Telegram account to an app user, a guess is not
  // available, so silence is. It also keeps delivery a single all-or-nothing act, which is what
  // lets one claimed day in `telegram_prompt_logs` mean what it says.
  if (chatIds.length > 1) {
    console.error(
      "[telegram-prompts] refusing to send: TELEGRAM_ALLOWED_IDS holds %d chat ids and nothing " +
        "says which belongs to the prompt's owner.",
      chatIds.length
    );
    return NextResponse.json(
      { error: "Ambiguous recipient: more than one numeric id in TELEGRAM_ALLOWED_IDS" },
      { status: 409 }
    );
  }

  const chatId = chatIds[0];

  const now = new Date();
  let promptsSent = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const tzOffset = user.timezoneOffset ?? 0;
      if (!isPromptDue({ now, timezoneOffset: tzOffset, promptTime: user.telegramDailyPromptTime })) {
        continue;
      }

      // The user's calendar day, encoded at UTC midnight. Date-only, like a bill due date.
      const promptedOn = userToday(tzOffset, now);

      // The same day as a real span of instants, for reading what was logged in it. This is the
      // one formula used app-wide: `Date.UTC(y, m, d) + tzOffset * 60000`.
      const dayStart = new Date(promptedOn.getTime() + tzOffset * 60_000);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      const logged = await prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: dayStart, lt: dayEnd },
          category: { name: { in: [FARE_CATEGORY, LUNCH_CATEGORY] } },
        },
        select: { category: { select: { name: true } } },
      });

      const names = new Set(logged.map((t) => t.category.name));
      const text = composePrompt({
        hasFare: names.has(FARE_CATEGORY),
        hasLunch: names.has(LUNCH_CATEGORY),
      });

      // Nothing missing, so nothing to ask. The log row is still written, so a later tick the
      // same day does not reconsider it once something has been deleted.
      if (!text) {
        await prisma.telegramPromptLog.createMany({
          data: [{ userId: user.id, promptedOn }],
          skipDuplicates: true,
        });
        continue;
      }

      // Written *before* sending, and removed again if the send throws, so a failure retries on
      // the next tick while a success can never be repeated. `BillEmailLog` does the same.
      const claimed = await prisma.telegramPromptLog.createMany({
        data: [{ userId: user.id, promptedOn }],
        skipDuplicates: true,
      });

      // Already sent today, by an earlier tick or a concurrent one. The unique index decided it,
      // not a read, so two overlapping runs cannot both pass here.
      if (claimed.count === 0) continue;

      try {
        const keyboard = {
          inline_keyboard: [
            [
              {
                text: "Nothing today",
                callback_data: encodePromptCallback({ day: utcDayKey(promptedOn) }),
              },
            ],
          ],
        };

        // `sendMessage` reports failure by returning null rather than throwing - it swallows a
        // Markdown parse error and retries in plain text, and only gives up silently. Ignoring
        // the return value meant a failed send still counted, still kept the claimed day, and so
        // was never retried: the prompt would vanish for that day with nothing in the logs.
        const sent = await sendMessage(chatId, text, "Markdown", keyboard);
        if (sent === null) {
          throw new Error("Telegram would not accept the prompt message");
        }
        promptsSent += 1;
      } catch (sendError) {
        await prisma.telegramPromptLog.deleteMany({
          where: { userId: user.id, promptedOn },
        });
        throw sendError;
      }
    } catch (error) {
      errors += 1;
      console.error(`[telegram-prompts] Failed for user ${user.id}:`, error);
    }
  }

  return NextResponse.json({ usersProcessed: users.length, promptsSent, errors });
}
