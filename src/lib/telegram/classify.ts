import { localTimestamp } from "@/lib/telegram/local-time";
import { GEMINI_MAX_ATTEMPTS } from "@/lib/gemini-limits";

/**
 * Ask Gemini what a free-text message meant.
 *
 * Extracted from `bot.ts` so it can be tested. The model id and the retry policy are the two
 * things most likely to drift away from the rest of the app, and while this lived as a private
 * function inside a 1,800-line module there was no way to write a test that fails when either
 * regresses. #163 is what that cost.
 *
 * Gemini only ever *classifies* here. It is handed category and label names and the current
 * time, never transactions, totals or balances, and the caller re-resolves whatever it names
 * against the real lists. That boundary is the reason a hallucinated label cannot reach a query,
 * and it lives in `search-intent.ts` and `report-intent.ts` rather than here.
 */

/**
 * Whether a classifier call is possible at all.
 *
 * Read from the environment rather than from a constructed client, because constructing one is
 * the thing that throws. The bot branches on this in three places to decide whether to fall back
 * to an explicit "Other" category, whether to attempt classification, and which of two failure
 * messages to send, so it has to be answerable without importing the client.
 */
export const GEMINI_ENABLED = !!process.env.GEMINI_API_KEY;

export async function classifyMessage(
  text: string,
  categories: { id: string; name: string; type: string }[],
  labels: { id: string; name: string }[],
  tzOffset: number
): Promise<any> {
  if (!GEMINI_ENABLED) return null;

  // Imported here rather than at module scope. `@/lib/gemini` builds its `GoogleGenAI` client
  // on load and throws without GEMINI_API_KEY, so a static import would take the whole bot
  // down at boot on a deployment that has no key, where today it degrades to shorthand-only
  // logging. Same reason `receipt-scan.ts` is imported inside the MCP tool handler.
  const { GEMINI_MODEL, classifyConfig, generateContentWithRetry, minimalThinkingFor } =
    await import("@/lib/gemini");

  const localIso = localTimestamp(tzOffset);
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
  - "month": YYYY-MM, for a WHOLE month ("this month", "last month", "in August"). Use the
    current timestamp above to resolve which.
  - "from" and "to": YYYY-MM-DD, for any period NARROWER than a month, resolved against the
    current timestamp above: "last week", "yesterday", "since Monday", "the 24th to the 29th",
    "the last 3 days". Both ends are inclusive, so "yesterday" sets from and to to the same day.
    Set only one end when the user gave only one AND its date is explicit or resolvable from
    the current timestamp ("since Monday", "since the 20th"). If the anchor is something you
    cannot date from what you have been given ("since payday", "since I got back"), set no
    period at all rather than inventing a boundary: a made-up start silently hides real
    transactions, and a wider answer that says which window it used does not.
  Never set "month" together with "from"/"to" -- pick whichever matches what they asked for.
  Omit all three only when they set no time limit at all ("how much have I spent at jollibee").
  At least one of label, category or search must be set.
- Comparing one month against the one before ("am I spending more than last month", "how does
  this month compare") -> "SHOW_TRENDS", with "month" set to the later month in YYYY-MM.
- Asking across several months ("show me the last 6 months", "how have I done this year")
  -> "SHOW_MONTHLY", with "months" set to how many they asked for, 1 to 24. Default 6.
- Asking which purchases were largest ("what were my biggest expenses", "top spending")
  -> "SHOW_TOP_EXPENSES", with "month" when they named one.
- Asking how spending divides across labels ("where did my work budget go", "breakdown by
  label", "which budget am I using most") -> "SHOW_LABEL_BREAKDOWN", with "month" when named.
  Use this for a breakdown ACROSS labels; use SEARCH_TRANSACTIONS when they ask about ONE label.
- Asking what individual items were on a receipt ("what did I buy at south supermarket",
  "what was on that grocery receipt") -> "SHOW_RECEIPT_ITEMS", with "search" set to the shop or
  item and "month" when named.
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
- labels: array of label names from the list above, EXACTLY as written there, ONLY when the user
  explicitly asks to label or tag it ("label it pickleball", "tag as work", "#groceries"). Leave
  it null otherwise. A label name merely appearing in the description is NOT a request to apply
  it: "pickleball court fee" gets no label. Never invent a name that is not in the list.

Return ONLY a JSON object in this format:
{
  "action": "CREATE_TRANSACTION" | "SHOW_SUMMARY" | "SHOW_RECENT" | "SHOW_BILLS" | "CHECK_BILL" | "SEARCH_TRANSACTIONS" | "SHOW_TRENDS" | "SHOW_MONTHLY" | "SHOW_TOP_EXPENSES" | "SHOW_LABEL_BREAKDOWN" | "SHOW_RECEIPT_ITEMS" | "UNSUPPORTED",
  "months": number | null,
  "search": string | null,
  "type": "EXPENSE" | "INCOME" | null,
  "label": string | null,
  "category": string | null,
  "month": string | null,
  "from": string | null,
  "to": string | null,
  "transaction": {
    "amount": number,
    "description": string,
    "type": "EXPENSE" | "INCOME",
    "categoryId": string,
    "date": string,
    "labels": string[] | null
  } | null,
  "replyText": string | null
}`;

  try {
    const response = await generateContentWithRetry(
      {
        // Read, never pinned. A literal here was correct on the day it was written and silently
        // wrong the moment GEMINI_MODEL moved, which is exactly what #163 was: the classifier ran
        // two generations behind every other caller in the same process, and it degraded as
        // misrouted intent rather than as an error, so nothing surfaced it.
        model: GEMINI_MODEL,
        contents: prompt,
        // Minimal thinking, unlike the receipt scanner. This call chooses one of eleven action
        // labels from a prompt that already lists them; the reasoning budget buys nothing and is
        // paid on the hot path of every free-text message. Measured as "not fast but tolerable"
        // at the model default before this changed.
        config: classifyConfig(),
      },
      GEMINI_MAX_ATTEMPTS,
      // Carries the *intent* across the fallback. Without it the fallback path rebuilds thinking
      // from GEMINI_THINKING_LEVEL and quietly restores `medium` mid-retry.
      minimalThinkingFor
    );

    const parsed = JSON.parse(response.text || "{}");
    return parsed;
  } catch (err) {
    console.error("[telegram] Gemini parse error:", err);
    return null;
  }
}
