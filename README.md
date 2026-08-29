# Budget Tracker

A personal budget tracking app built with Next.js, TypeScript, and PostgreSQL. Track income and expenses, manage categories, and visualize your spending with an interactive dashboard.

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)
![TanStack Query](https://img.shields.io/badge/TanStack_Query-5-FF4154?logo=reactquery)

## Features

- **Landing Page** — Redesigned marketing homepage with 3D dashboard mockup preview, AI receipt scanning showcase with phone mockup, 8-feature grid, and scroll-triggered animations
- **Authentication** — Register and login with email/password (NextAuth.js with JWT sessions); email verification via Resend; password reset flow with secure token links; role-based access control (ADMIN, FREE, PAID)
- **Dashboard** — Summary cards (balance, expenses, income), monthly trend bar chart, spending by category donut chart, balance trend area chart, recent transactions
- **Running Balance** — Cumulative all-time balance that carries over across months, not just monthly snapshots
- **Balance Trend** — 30-day area chart showing daily running balance with percentage change indicator
- **Transactions** — Full CRUD with search, type filtering (income/expense), month navigation, infinite scroll (with pagination toggle), hero amount input with dynamic type coloring, date quick-picks (Today/Yesterday/Custom), slide-in category picker, advanced filters (category, amount range, sort), and auto-scroll with highlight animation on newly created or updated transactions
- **Quick Category Tiles** — Personalized top-4 quick-access categories per type (expense/income) with customizable order; shown in the transaction form and editable from the Categories page
- **Categories** — 15 pre-seeded defaults (10 expense, 5 income) + create/edit/delete custom categories with color swatches, icon grid, and live preview
- **User Roles** — Three-tier role system (ADMIN, FREE, PAID); new users default to FREE; admin can manually promote users to PAID via an admin panel; receipt scanning gated to PAID/ADMIN users
- **Admin Panel** — Admin-only user management page (`/admin`) with user list, role badges, transaction counts, and one-click FREE/PAID role toggle; scan settings page with per-role configuration for receipt scanning, upload limits, and monthly scan limits; protected by middleware and API-level guards
- **Receipt Scanning** — Snap a photo or upload multiple receipts and AI (Google Gemini) extracts the amount, date, category, and merchant to pre-fill transactions; batch scanning with live review modal and parallel processing; smart category matching with merchant-aware rules; non-receipt image detection; images compressed client-side before upload; HEIC/HEIF support; desktop scan dropdown on Add Transaction buttons; available to PAID/ADMIN users
- **Receipt Itemization** — One-tap "Itemize" button splits a scanned receipt into multiple transactions grouped by spending category (e.g., Food & Dining, Personal Care, Household); each itemized transaction stores its individual line items and displays them in a collapsible "Receipt Breakdown" section inside the edit modal showing every product name and price from the receipt
- **Monthly Scan Limits** — Configurable per-role monthly scan caps (0 = unlimited); usage badge on mobile scan button; remaining scans info in scan sheet; desktop sidebar warnings when running low or exhausted; ADMIN always unlimited
- **TanStack Query Caching** — Client-side data caching for transactions, dashboard stats, categories, and quick-access preferences; instant re-renders on modal re-open (no loading shimmer after first fetch); in-place cache updates on create/edit/delete mutations
- **Profile Settings** — Edit name, email, and preferred currency; change password with current-password verification; role badge displayed in header; feature toggles gated by role; sidebar updates instantly via shared context
- **Dynamic Currency** — Currency selected in profile settings reflects across all pages — dashboard, transactions, charts, and forms
- **Privacy Mode** — One-tap toggle to hide all financial amounts across the app, persisted per-user in the database
- **Responsive** — Sidebar navigation on desktop, bottom navigation on mobile; labeled floating action buttons on mobile; modal bottom sheets with drag-to-dismiss on mobile, centered cards on desktop; keyboard-aware modals on iOS Safari
- **Dynamic Favicon** — Auto-generated favicon matching the app logo
- **Transaction Labels** — User-created color-coded labels with optional type restriction (expense/income/both); label picker in transaction form; label pills on transaction lists (dashboard + transactions page); quick-remove from list view
- **Label Schedules (Auto-Tagging)** — Time-of-day + day-of-week schedules per label for automatic tagging (e.g. "Work" on weekdays 9am–5pm); client-side reactive matching via `useScheduledLabel` hook; server-side auto-labeling on create/batch/bill-pay; retroactive apply to existing transactions; auto-labeling only on new transactions (edits preserve user's label choices)
- **Scheduled Bills & Reminders** — Recurring bill management with configurable frequency (weekly, biweekly, monthly, quarterly, yearly); mobile toast reminders for upcoming and overdue bills; one-tap pay that auto-creates the expense transaction; snooze (1d/3d/1w) and skip actions; pay-all for batch payments; bill history with links to past payments
- **Progressive Web App** — Installable PWA with offline support via Serwist service worker; install prompt banner (Android + iOS Safari guide); standalone mode with safe-area handling; smart caching for API responses and static assets
- **Timezone-Aware Dates** — All date queries respect the user's local timezone offset for accurate day boundaries and month grouping
- **MCP Server** - [Model Context Protocol](https://modelcontextprotocol.io/) access to your budget data in natural language, over stdio (local) or HTTP with a scoped bearer token (remote); 12 read-only tools (spending by category, top expenses, monthly summary, spending trends, search transactions, budget overview, upcoming bills, category list, label breakdown, label list, bill history, receipt items) plus one write tool (`create_transactions`), gated behind a separate scope, a time-limited write lease, and a provenance column; shared query library reusable for future in-app AI chat
- **Telegram Bot** - Log spending by messaging a personal Telegram bot (`100 breakfast`, `spent 350 for groceries yesterday`) and ask for summaries, recent transactions, or upcoming bills; runs inside the app on boot; talks to the app as an MCP client, so it inherits the token scope, write lease, rate limit, and audit trail rather than touching the database; Gemini only classifies each message, so every figure it reports comes from real data
- **Analytics** — Dedicated reporting page with income vs expenses bar chart, cash flow area chart (net + cumulative), category breakdown donut chart, label breakdown horizontal bars, summary cards, and flexible time range controls (weekly/monthly/yearly/custom)
- **Design** — Warm paper-ledger aesthetic with Young Serif + Outfit fonts, Plus Jakarta Sans for currency amounts, amber accents, and Framer Motion animations

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL + Prisma ORM |
| Auth | NextAuth.js v4 (Credentials) |
| Forms | React Hook Form + Zod |
| Data Caching | TanStack Query |
| Charts | Recharts |
| OCR / AI | Google Gemini |
| Email | Resend |
| PWA | Serwist (Service Worker) |
| MCP Server | Model Context Protocol SDK |
| Chat Bot | Telegram Bot API (long polling, MCP client) |
| Icons | Lucide React |
| Animation | Framer Motion |

## Prerequisites

- **Node.js** 20+
- **pnpm** (package manager)
- **PostgreSQL** running locally or remotely

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/chrisgen19/budget-tracker-2026.git
cd budget-tracker-2026
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

Copy the example env file and update with your database credentials:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgres://myuser:mypassword@localhost:5432/budgettracker-nextjs"
NEXTAUTH_SECRET="change-this-to-a-random-secret-in-production"
NEXTAUTH_URL="http://localhost:3111"

# Google Gemini (optional — enables receipt scanning)
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-3.6-flash"

# Gemini tuning (all optional — these are the defaults used when unset)
GEMINI_FALLBACK_MODEL="gemini-3.5-flash"   # "" disables fallback
GEMINI_THINKING_LEVEL="medium"             # used by Gemini 3+ models
GEMINI_THINKING_BUDGET="-1"                # used by Gemini 2.x models
GEMINI_TIMEOUT_MS="60000"                  # per-attempt timeout; 0 disables

# Telegram bot (optional: see the Telegram Bot section below)
# Blank counts as unset for every TELEGRAM_ variable.
TELEGRAM_BOT_ENABLED="false"               # "true" starts the bot on server boot
TELEGRAM_BOT_TOKEN=""                      # from @BotFather
TELEGRAM_ALLOWED_IDS=""                    # numeric ids; empty means serve nobody
TELEGRAM_MCP_URL="http://localhost:3111/api/mcp"   # required, no default
TELEGRAM_MCP_TOKEN=""                      # a scoped token from Profile > MCP Access
TELEGRAM_TZ_OFFSET="-480"                  # required, no default; UTC+8 is -480
```

> **Note:** Generate a secure `NEXTAUTH_SECRET` for production with `openssl rand -base64 32`
>
> **Receipt Scanning:** The `GEMINI_API_KEY` is only required if you enable the receipt scanning feature. Get one from [Google AI Studio](https://aistudio.google.com/apikey).

#### Gemini tuning options

All four are optional — when unset, the defaults shown above apply. The right thinking knob is picked automatically from the model generation. Defaults favor **extraction quality** (thinking enabled); switch to **speed mode** (`minimal` / `0`) for ~3x faster scans at the cost of reasoning on tricky receipts.

| Variable | Possible values | Notes |
|---|---|---|
| `GEMINI_MODEL` | any Gemini model id | Used by **every** AI call. Default `gemini-3.6-flash`. Import it from `src/lib/gemini.ts` rather than writing a literal at a call site |
| `GEMINI_FALLBACK_MODEL` | any Gemini model id, or `""` | Tried once when `GEMINI_MODEL` stays overloaded (503/504) after retries. Default `gemini-3.5-flash`, a generation behind the primary on purpose. `""` disables fallback |
| `GEMINI_THINKING_LEVEL` | `minimal` \| `low` \| `medium` \| `high` | **Gemini 3+ models only** (e.g. `gemini-3.5-flash`). `medium` (default) = model's native reasoning; `minimal` = speed mode |
| `GEMINI_THINKING_BUDGET` | `-1` \| `0` \| `128`–`24576` | **Gemini 2.x models only** (e.g. `gemini-2.5-flash`). `-1` (default) = dynamic thinking, `0` = speed mode, number = fixed token budget. Valid range varies per model |
| `GEMINI_TIMEOUT_MS` | milliseconds, or `0` | Aborts hung attempts so retry/fallback kicks in sooner; timed-out attempts are retried like 503s. `0` disables. Default `60000` suits thinking-enabled scans; `30000` suits speed mode |

### 4. Create the database and run migrations

```bash
createdb budgettracker-nextjs   # or create via psql/pgAdmin
pnpm db:migrate
```

### 5. Seed default categories

```bash
pnpm db:seed
```

### 6. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3111](http://localhost:3111), register an account, and start tracking.

## Available Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start development server (Turbopack) |
| `pnpm build` | Create production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | Run TypeScript type checker |
| `pnpm test` | Run the test suite once (CI mode) |
| `pnpm test:watch` | Run the test suite in watch mode |
| `pnpm test:e2e` | Install Chromium and run the authenticated Playwright suite |
| `pnpm telegram:bot` | Run the Telegram bot locally (never while it is enabled in production) |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed default categories + set admin role |
| `pnpm db:studio` | Open Prisma Studio (database GUI) |

## MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets you ask about your
budget in natural language ("what's my biggest spending category?", "how much did I spend on food
this month?") from Claude Code or Claude Desktop.

The 14 tools are defined once, in `src/lib/mcp/server.ts`, and served over two transports:

```
Local:   Claude Desktop ──(stdio)──▶ mcp-server/src/index.ts ─┐
                                                              ├─▶ budget-queries ─▶ Prisma ─▶ PostgreSQL
Remote:  Claude Code / Desktop ──(HTTPS + bearer)──▶ /api/mcp ─┘
```

Pick by which database you want to read:

| | Reads | Auth | Setup |
|---|---|---|---|
| **[Local (stdio)](#option-a-local-stdio)** | whatever `DATABASE_URL` points at, usually your dev database | none, it is your own machine | config file per client |
| **[Remote (HTTP)](#option-b-remote-http)** | the deployed app's database, i.e. **production** | scoped bearer token, revocable | mint a token, one command |

Twelve of the fourteen tools are read-only. `scan_receipt` writes nothing either, but each call
spends one of your monthly receipt scans, so it is scoped separately and is never granted by
default. The remaining exception is `create_transactions`, which is
available only to a token minted with the `transactions:write` scope **and** only while a
time-limited write lease is open (Profile > MCP Access). Nothing in the server can change or
delete an existing transaction. See [MCP writes](#mcp-writes) for how the controls fit together.

### Option A: Local (stdio)

The stdio server is a standalone TypeScript script that runs via `tsx`. It is **not** hosted:
Claude Desktop starts and stops it automatically.

It has its own `package.json`, lockfile, and `.npmrc`, but it is standalone only in its
dependency tree: it imports the tool definitions and shared query layer from `src/lib/`, and links
`@prisma/client`, `@modelcontextprotocol/sdk` and `zod` to the app's copies rather than resolving
second ones. So the app's dependencies must be installed first.

#### Setup

##### 1. Install app dependencies first

```bash
pnpm install
```

This generates the Prisma client (via `postinstall`) that the MCP server links to. Skipping
it leaves `@prisma/client` unresolved in step 2.

##### 2. Install MCP server dependencies

```bash
cd mcp-server && pnpm install && cd ..
```

No separate `prisma generate` is needed here. The package links to the client generated in
step 1, which keeps the two from drifting to different schema versions.

To verify the server compiles against the current query layer:

```bash
cd mcp-server && pnpm type-check && cd ..
```

CI runs this on every PR.

##### 3. Find your user ID

```bash
pnpm db:studio
```

Open the `User` table in Prisma Studio and copy your user's `id` value.

##### 4. Configure Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following (replace the placeholder values):

```json
{
  "mcpServers": {
    "budgettracker": {
      "command": "/absolute/path/to/budgettracker/mcp-server/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/budgettracker/mcp-server/src/index.ts"],
      "env": {
        "DATABASE_URL": "postgres://myuser:mypassword@localhost:5432/budgettracker-nextjs",
        "BUDGET_USER_ID": "your-user-id-here"
      }
    }
  }
}
```

`tsx` is a declared devDependency of the MCP package, so pointing at the local binary runs
a pinned version. `npx tsx` also works, but resolves the version at launch and prints npm
warnings about this package's `.npmrc` settings.

##### 5. Restart Claude Desktop

Claude Desktop will automatically start the MCP server when you open a conversation. No manual startup needed.

### Option B: Remote (HTTP)

The same tools served from the deployed app at `/api/mcp`, so a client on any machine can reach
them and the answers come from **production** data rather than your local database.

#### 1. Deploy

Nothing to configure. `pnpm build` runs `prisma migrate deploy`, so the deploy creates the
`mcp_tokens` table on its own, and the endpoint reads the same `DATABASE_URL` the app already
uses. No new environment variables.

Your endpoint is `https://<your-domain>/api/mcp`.

> The URL must be public HTTPS if you connect through Claude's own connector infrastructure,
> because those requests come from Anthropic's servers, not your machine, so `localhost` will not
> work. The `mcp-remote` bridge below runs locally and has no such restriction.

#### 2. Mint a token

In the deployed app, go to **Profile → MCP Access**:

1. Name it after where it will live, e.g. "Claude Code (laptop)".
2. Tick only the scopes you need. Read scopes start ticked; `transactions:write` never does, so
   write authority is always a deliberate choice. The descriptions say what each one actually
   returns:
   `receipts:read` and `bills:read` both include the parent transaction's description and
   amount, so neither is as narrow as its name suggests.
3. Pick an expiry. 90 days is the default; "Never" exists but should be a deliberate choice.

Copy the token immediately. Only its SHA-256 is stored, so it cannot be shown again: a lost
token is re-minted, not recovered. Revoke from the same screen at any time; it takes effect on
the next request.

#### 3a. Claude Code

```bash
claude mcp add --transport http budget https://<your-domain>/api/mcp \
  --header "Authorization: Bearer btmcp_your_token_here" \
  -s user
```

`-s user` makes it available in every project; the default `local` scopes it to the current
directory. Check it with `claude mcp list`.

#### 3b. Claude Desktop

Desktop's `claude_desktop_config.json` handles **local stdio servers only**, so a remote endpoint
needs one of these instead.

Use **`x-api-key`**, not `Authorization`, for both options below. The endpoint accepts either,
but every client that implements OAuth treats `Authorization` as its own: Claude Desktop's
connector dialog refuses the name outright ("OAuth already sets the Authorization header"), and
`mcp-remote` responds to a 401 on it by abandoning the static credential and attempting dynamic
client registration, which fails against an app that is not an OAuth server. Authenticating on
the first request avoids emitting the 401 that starts either cascade.

**Custom connector.** Settings → Connectors → Add custom connector, leave the OAuth Client ID and
Secret **blank** (this app is not an OAuth authorization server, and its discovery endpoints
return 404), then add a request header named `x-api-key` with the raw token as its value, no
scheme prefix. Request-header authentication is in beta and rolled out on request; if the field
does not appear, use the bridge.

**`mcp-remote` bridge.** A local stdio proxy that forwards to the HTTP endpoint
([npm](https://www.npmjs.com/package/mcp-remote)), which works without the beta:

```json
{
  "mcpServers": {
    "budget": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://<your-domain>/api/mcp",
        "--transport", "http-only",
        "--header", "x-api-key:btmcp_your_token_here"
      ]
    }
  }
}
```

Three details that are each enough to break it on their own:

- **No space anywhere in the `--header` argument.** `mcp-remote` splits on whitespace and warns
  `ignoring invalid header argument`, then proceeds unauthenticated. `x-api-key:<token>` has no
  space; `Authorization: Bearer <token>` does, which is the other reason to prefer the former.
- **`--transport http-only`.** Without it the default `http-first` strategy falls back to the SSE
  transport, whose `GET` this endpoint answers with 405 by design.
- **Node must be on the PATH of whatever launches Claude Desktop.** On Windows that is Windows
  Node, not a WSL install.

You can register the local and remote servers side by side under different names: local for
development, remote for real data.

#### Creating transactions

`create_transactions` is the only tool that writes. The server refuses it unless **both** of these
are true:

1. The token carries the `transactions:write` scope. Read-only tokens cannot see the tool at all.
   A token with a write scope cannot be set to "Never" expire and is capped at 90 days.
2. Writes are switched on under **Profile > MCP Access > Write access**. This is a lease, not a
   toggle: pick 1 hour, 8 hours, or 30 days, and it closes itself. Every token is refused while it
   is off, so it works as a kill switch when you are away from your machine.

Separately, the tool omits `readOnlyHint`, so clients that support tool approval prompt you before
each call rather than auto-approving it. That is a client-side courtesy, not something the server
can enforce, so do not rely on it as a third gate.

Rows it creates are stamped with `created_via = MCP` and the token that wrote them, set
server-side. Filter them on `/transactions` with the **Added by → Claude** control, or ask the
model directly, since `search_transactions` takes the same filter.

Nothing here can edit or delete an existing transaction.

#### Operational notes

- **Rate limit:** 300 requests per 15 minutes per token, which a conversation will not approach.
  It is the only ceiling on how hard a token can be pulled, so it applies to revoked and expired
  tokens too.
- **`GET /api/mcp` returns 405 by design.** Clients talk over POST only, so nothing holds a
  long-lived connection open through the reverse proxy.
- **Treat the token as a password.** It grants read access to everything in its scopes and sits in
  plaintext in `~/.claude.json` or `claude_desktop_config.json`; passing it on the command line
  also puts it in your shell history. Scope it narrowly and give it an expiry.

### Available MCP Tools

| Tool | Description |
|---|---|
| `get_spending_by_category` | Spending grouped by category for a given month, with percentages |
| `get_top_expenses` | Largest individual expense transactions, optionally filtered by month |
| `get_monthly_summary` | Income, expenses, and net per month for the last N months |
| `get_spending_trends` | Compare spending between two months — shows which categories increased or decreased |
| `search_transactions` | Search and filter transactions by description, category, label, amount range, type, and month |
| `get_budget_overview` | High-level monthly summary: income, expenses, net, running balance, transaction count |
| `get_upcoming_bills` | Scheduled transactions (bills) due within N days, including overdue |
| `get_category_list` | All categories (default + custom) — useful for finding category IDs |
| `get_label_breakdown` | Spending or income grouped by label for a month, including an "unlabeled" bucket |
| `get_label_list` | Labels with transaction counts, applicable type, and auto-apply schedules |
| `get_bill_history` | Past bill occurrences (paid/skipped/snoozed) plus per-bill lateness patterns |
| `get_receipt_items` | Individual line items from scanned receipts, filterable by month, name, or receipt |
| `scan_receipt` | **Spends a scan.** Reads a receipt image and returns a draft; saves nothing |
| `create_transactions` | **Write.** Creates one or more transactions in a single idempotent batch |

### MCP writes

`create_transactions` is the only tool that writes, and it sits behind three independent controls.
None of them substitutes for another:

| Control | What it is | Why |
|---|---|---|
| `transactions:write` scope | Chosen when the token is minted and fixed for its life. Such a token cannot pick "Never" expires and is capped at 90 days | Least privilege. A read token can never be talked into writing |
| Write lease | `users.mcp_writes_enabled_until`, a timestamp rather than a boolean, set from Profile > MCP Access | Forgetting to switch writes off cannot leave them open for days |
| Provenance | `transactions.created_via` + `mcp_token_id`, both set server-side | An audit trail. A compromised token cannot forge or omit it |

Provenance follows the **credential**, not the endpoint. A token is minted as either an AI
assistant or a Telegram bot, and every row it writes is stamped accordingly, because every remote
write arrives through `/api/mcp` and deriving the source from the endpoint would make the bot's
rows claim Claude wrote them. `APP` is not mintable, so no token can make a row look hand-typed.
The transactions page can filter by any of these.

Writes are idempotent. Each call carries a `clientBatchId` UUID, and replaying one returns the
original rows instead of writing a second copy, so a lost response can be retried safely.

### Testing with MCP Inspector

To verify tools work correctly before using in Claude Desktop:

```bash
BUDGET_USER_ID=your-user-id DATABASE_URL="your-database-url" npx @modelcontextprotocol/inspector mcp-server/node_modules/.bin/tsx mcp-server/src/index.ts
```

This opens a web UI at `http://localhost:6274` where you can call each tool and inspect the results.

The Inspector drives the **stdio** server. To exercise the remote endpoint instead, including
bearer auth, scope narrowing, the write path and `scan_receipt`, see
[Verification scripts](#verification-scripts) under Testing.

## Telegram Bot

A personal Telegram bot that logs spending from a chat message and answers questions about it.

```
You ──▶ Telegram ──(long poll)──▶ bot ──(HTTPS + scoped token)──▶ /api/mcp ──▶ PostgreSQL
```

It is an **MCP client, not a database client**. It holds no database credentials: it calls
`/api/mcp` with a scoped token like any other client, so it inherits the scope, the write lease,
the rate limit, and the audit trail rather than going around them.

**Gemini only classifies a message.** It is never given transactions, totals, or balances, and
every figure the bot sends comes from an MCP read tool via the same handlers the slash commands
use. A model holding nothing but category names could only refuse or invent an answer, so free-text
questions are routed to a real query instead of being answered by the model.

### What you can send

| Message | Result |
|---|---|
| `100 breakfast` | Logs a 100 expense, category matched from the text |
| `+5000 freelance payout` | Logs income (leading `+`) |
| `spent 350 for groceries yesterday` | Goes to Gemini, which resolves the date |
| `/summary` | This month's balance and top spending |
| `/recent` | The last 5 transactions |
| `/bills` | Bills due in the next 30 days |
| `/categories` | Your category list |
| `/help` | The above, in chat |
| *did I pay meralco this month* | Searches what you logged and shows the matching rows |
| *how much on transportation in work budget* | Filters by category and label together |
| *how much did I spend in shopee* | Matches the label when the name is one, not just the description |
| *am I spending more than last month* | This month against last, with the categories that moved |
| *show me the last 6 months* | Income, spending and net per month |
| *what were my biggest expenses* | The ten largest, optionally for one month |
| *where did my work budget go* | Spending split across labels |
| *what did I buy at south supermarket* | Individual line items from itemized receipts |
| *did I pay the water bill* | Checks that recurring bill's history: paid, skipped or snoozed |
| *(send a photo)* | Reads the receipt with AI, shows what it found, and waits for `yes` before saving |

Typing `/` in the chat shows every command with a description, and `/examples` prints a list of
working messages to copy from. The menu is registered per allowlisted chat rather than publicly,
so it is not advertised to strangers the bot deliberately answers with nothing; that needs
`TELEGRAM_ALLOWED_IDS`, since a username cannot address a chat. Neither requires
remembering anything.

The slash is optional. `summary`, `balance`, `recent`, `bills`, `categories` and `help` work on
their own, as do the obvious phrasings around them (`give summary`, `my bills please`). Those are
matched locally, so they answer instantly and keep working when Gemini is unavailable. Anything
more conversational still goes to Gemini, which picks the intent; the figures always come from a
real query either way.

Anything with a date or time in it (`yesterday`, `at noon`, `18:00`, `sep 14`) skips the fast path
and goes to Gemini, because the fast path stamps the current time and has no way to express a date.

### Receipts

Send the bot a photo of a receipt and it reads the amount, date, category and merchant, then
shows you what it found and waits for `yes` before saving anything. Reply `no` to discard.

The confirmation is not politeness. The web app shows a review modal for the same reason: OCR on a
phone photo is exactly where a wrong amount comes from, and a bot that saved silently would put it
in the budget with nobody having seen it.

Sending the receipt **as a file** rather than a photo is worth doing for two reasons. Telegram
recompresses anything sent as a photo, which costs accuracy on small print, and that recompression
also strips the image's metadata. Sent as a file, the photo's own capture time survives, and that
is what the bot falls back to when the date on the receipt cannot be read: a receipt photographed
on Monday and sent on Thursday then lands on Monday rather than on Thursday. Without it the
fallback is today, as before. Both work; images must be 4 MB or smaller.

Each scan spends one of your monthly receipt scans, the same allowance the web app uses, because
the bot scans through the MCP endpoint rather than calling Gemini itself. A scan that fails is
refunded.

### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Mint an MCP token in **Profile > MCP Access** with **all seven** scopes the handlers need:
   `budget:read`, `transactions:read`, `labels:read`, `bills:read`, `receipts:read`, `receipts:scan`, `transactions:write`. Set **Used by** to
   **Telegram bot** so its rows are stamped `TELEGRAM` rather than appearing as Claude's. A
   write-only token fails on every message, since each one reads the category list first.
3. Set the environment variables (see below), then start the app. The bot starts with it.
4. Message the bot. If your id is not on the allowlist it stays silent, and the log prints the id
   so you can copy it in.

| Variable | Required | Notes |
|---|---|---|
| `TELEGRAM_BOT_ENABLED` | yes | `"true"` starts the bot on server boot. Off everywhere else |
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather |
| `TELEGRAM_ALLOWED_IDS` | one of these two | Numeric ids, comma separated. Preferred |
| `TELEGRAM_ALLOWED_USERNAMES` | one of these two | Weaker: a released `@handle` can be claimed by someone else |
| `TELEGRAM_MCP_URL` | yes, **no default** | `http://localhost:3111/api/mcp` for `pnpm dev`, `http://localhost:3000/api/mcp` inside the deployed container, or the public URL if the bot runs elsewhere |
| `TELEGRAM_MCP_TOKEN` | yes | The token from step 2 |
| `TELEGRAM_TZ_OFFSET` | yes, **no default** | Minutes, `getTimezoneOffset()` convention, so UTC+8 is `-480`. Must match the account's timezone |
| `TELEGRAM_CURRENCY_SYMBOL` | no | Display only. Defaults to the peso sign |
| `TELEGRAM_API_IP` | no | Only for a network whose DNS sinkholes Telegram. Leave unset otherwise: Telegram rotates these |

Blank counts as unset for all of them. The two marked **no default** fail at startup with a named
cause rather than guessing, because both silently wrong values are dangerous: an inherited URL
would send a write-capable token to a host you do not control, and the host's own timezone is UTC
in a container, which resolves "yesterday" to the wrong day.

### Two rules worth knowing

**Only one poller may exist per bot token.** Telegram answers a second concurrent `getUpdates`
with 409 Conflict, so never run `pnpm telegram:bot` while the bot is enabled in production. That
is what the `TELEGRAM_BOT_ENABLED` flag is for.

**With no allowlist the bot serves nobody, and says so at startup.** Bot usernames are searchable
and the `t.me` link is public, so anyone who found it could otherwise read your balances and write
transactions. Denied messages get no reply at all, since replying would confirm the bot is live and
whose it is. Every message is also required to be in a *private* chat: replies go to the chat the
message came from, so running `/summary` in a group would have shown your balances to everyone in
it.

Two entry points share one definition: `src/instrumentation.ts` starts the bot on server boot in
production, and `scripts/telegram-bot.ts` (`pnpm telegram:bot`) runs it locally.

## Testing

```bash
pnpm test          # the whole suite once
pnpm test:watch    # re-run on change
pnpm lint
pnpm type-check
cd mcp-server && pnpm type-check   # excluded from the root config, so run it separately
```

Vitest with React Testing Library, jsdom environment. Tests are colocated as
`src/**/*.test.ts(x)`, so nothing imports them and they stay out of the Next.js bundle.

### Responsive E2E tests

The Playwright suite signs in as a real account and checks the Transactions page across supported
viewport widths. Supply an account with at least one transaction and enough transactions for the
page to scroll:

```bash
E2E_EMAIL="user@example.com" E2E_PASSWORD="password" pnpm test:e2e
```

Without `E2E_BASE_URL`, Playwright starts `pnpm dev` and tests
`http://127.0.0.1:3111`. Set it to exercise an already-running or deployed app instead:

```bash
E2E_BASE_URL="https://example.com" E2E_EMAIL="user@example.com" E2E_PASSWORD="password" pnpm test:e2e
```

Both `E2E_EMAIL` and `E2E_PASSWORD` are required for the tests to execute. If either is missing,
Playwright reports the entire suite as skipped and exits successfully; that result does not provide
responsive-layout coverage. This authenticated suite is currently manual-only: GitHub CI does not
run it because the workflow does not provision a seeded account or credentials.

### Verification scripts

Five things cannot be tested in jsdom, because getting them wrong looks identical to getting
them right until a real database or a real HTTP request is involved: advisory locks, row locks,
transaction isolation, timestamp marshalling, and anything a spec-compliant client validates on
the way back. Each has a script under `scripts/`, run directly with `pnpm exec tsx`.

They are worth running when you touch the area they cover. Each creates and deletes its own
throwaway user, so none of them touch your own data.

| Script | Covers | Needs |
|---|---|---|
| `verify-scan-quota.ts` | Scan credit reservation, refund, and the rolling rate limit under concurrency | a database |
| `verify-mcp-token-auth.ts` | Token expiry, revocation, and the rate limiter's row lock | a **non-UTC** database |
| `verify-mcp-endpoint.ts` | Bearer auth, the stateless transport, and scope narrowing over real HTTP | a dev server |
| `verify-batch-idempotency.ts` | A committed batch whose response was lost replays instead of duplicating | a dev server |
| `verify-receipt-scan.ts` | `scan_receipt` over HTTP, a real Gemini call, and the scan-credit accounting | a dev server + `GEMINI_API_KEY` |
| `verify-token-delete.ts` | Deleting an MCP token removes the credential and leaves the transactions it wrote untouched | a database |

```bash
# database only
pnpm exec tsx scripts/verify-scan-quota.ts
pnpm exec tsx scripts/verify-mcp-token-auth.ts
pnpm exec tsx scripts/verify-token-delete.ts

# dev server in one terminal
pnpm dev -p 3111

# then, in another
BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-mcp-endpoint.ts
BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-batch-idempotency.ts
BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-receipt-scan.ts
```

`verify-mcp-token-auth.ts` refuses to pass against a UTC database and says so: the timestamp
behaviour it checks cannot be observed under UTC, so a green run there would prove nothing.

### Testing receipt scanning

`verify-receipt-scan.ts` covers the whole scan path without a receipt to hand: it generates a
plain single-colour image, which Gemini correctly refuses, and that exercises the refusal *and*
confirms the scan credit is refunded. Nothing needs to be committed for it. To also cover a
successful scan, point it at a real photo:

```bash
RECEIPT=/path/to/receipt.jpg BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-receipt-scan.ts
```

It checks that a refused call reserves nothing, a non-receipt is refunded but keeps its `FAILED`
row so it still counts toward the rate limit, a usable scan spends exactly one credit, and
scanning writes no transaction.

### Testing the Telegram bot

The bot's own logic (photo selection, the pending-scan lifecycle, the confirm step, message
parsing) is covered by unit tests. Everything past that needs real Telegram.

```bash
pnpm dev -p 3111        # one terminal
pnpm telegram:bot       # another
```

`.env` needs `TELEGRAM_BOT_TOKEN`, an allowlist entry, `TELEGRAM_MCP_URL=http://localhost:3111/api/mcp`,
`TELEGRAM_MCP_TOKEN`, and `TELEGRAM_TZ_OFFSET`. The startup log names anything missing.

> **Only one poller may exist per bot token.** Telegram answers a second concurrent `getUpdates`
> with 409 Conflict, so never run `pnpm telegram:bot` while `TELEGRAM_BOT_ENABLED=true` in a
> deployed environment. Either turn it off there first, or use a second bot from @BotFather for
> local work.

Sending a photo spends a real scan credit and calls Gemini, so it costs something every time. The
verification script above is the cheaper way to test the scan itself; use the bot to test the
parts only it has, which are the photo download and the yes/no confirmation.

## Git Hooks

This project uses **husky** + **lint-staged** to enforce code quality before code reaches the repository:

| Hook | What runs | Purpose |
|---|---|---|
| Pre-commit | `lint-staged` (ESLint on staged `.ts`/`.tsx` files) | Catch lint issues immediately |
| Pre-push | `pnpm type-check` (full codebase) | Block push on type errors |

Hooks are installed automatically via the `prepare` script when you run `pnpm install`.

## Project Structure

```
src/
├── app/
│   ├── page.tsx             # Root — landing page (guest) or redirect (auth)
│   ├── (auth)/              # Login & Register pages
│   │   ├── login/
│   │   └── register/
│   ├── (app)/               # Protected pages (requires auth)
│   │   ├── dashboard/       # Dashboard with charts & summaries
│   │   ├── analytics/       # Analytics & reporting page
│   │   ├── transactions/    # Transaction list with CRUD
│   │   ├── categories/      # Category management
│   │   ├── bills/           # Scheduled bills & reminders
│   │   ├── profile/         # Profile settings (name, email, currency, password)
│   │   └── admin/           # Admin panel (user management, scan settings)
│   └── api/                 # REST API routes
│       ├── auth/            # NextAuth handler
│       ├── register/        # User registration
│       ├── admin/           # Admin: users, roles, scan settings
│       ├── transactions/    # Transaction CRUD
│       ├── categories/      # Category CRUD
│       ├── analytics/       # Analytics API (time range + breakdown)
│       ├── dashboard/       # Dashboard stats + balance trend
│       ├── bills/           # Scheduled bill CRUD + upcoming bills
│       ├── preferences/     # User preferences (privacy, quick categories, features)
│       ├── profile/         # Profile & password update
│       ├── email/           # Email verification + password reset (Resend)
│       └── receipts/        # Receipt OCR + itemized breakdown via Gemini AI
├── components/
│   ├── ui/                  # Shared UI (Modal, ConfirmModal, MobileFab, EmptyState, IconMap)
│   ├── analytics/           # Analytics charts (IncomeExpenses, CashFlow, CategoryBreakdown, LabelBreakdown)
│   ├── dashboard/           # Chart components (Trend, Spending, BalanceTrend)
│   ├── transactions/        # Transaction form + receipt breakdown viewer
│   ├── categories/          # Category form + quick category picker
│   ├── bills/               # Bill form + bill reminder provider
│   ├── pwa/                 # Install prompt banner + banner context
│   ├── landing-page.tsx     # Marketing homepage for guests
│   ├── scan-receipt-sheet.tsx # Receipt capture modal (camera/upload)
│   ├── multi-scan-review.tsx # Batch scan review modal
│   ├── privacy-provider.tsx # Hide-amounts context (persisted in DB)
│   └── user-provider.tsx    # Reactive user info context (name, email, currency, role)
├── hooks/                   # TanStack Query hooks (use-transactions, use-categories)
├── lib/                     # Prisma client, auth, Gemini client, query client, utils, validations
│   ├── budget-queries.ts    # Shared read-only query functions (used by the app + MCP)
│   ├── budget-query-types.ts # TypeScript types for query params and return values
│   ├── transaction-writes.ts # The single create path, shared by the batch route + MCP
│   ├── mcp/                 # Tool definitions, scopes, bearer-token auth, write errors
│   └── telegram/            # Telegram bot (MCP client), allowlist, shorthand parsing
├── instrumentation.ts       # Server boot hook: starts the Telegram bot
└── types/                   # TypeScript type definitions

mcp-server/                  # stdio entry point for a locally spawned MCP client
├── package.json             # Standalone dependencies (@modelcontextprotocol/sdk)
├── tsconfig.json            # Standalone TypeScript config
└── src/
    └── index.ts             # Thin wrapper; tools live in src/lib/mcp/server.ts

prisma/
├── schema.prisma            # Database schema
├── seed.ts                  # Default category seeder
└── migrations/              # Migration history
```

## Database Schema

```
User ──< Transaction >── Category
 │           │              │
 │           └──< TransactionLabel >── Label ──< LabelSchedule
 │                                      │
 ├────────< Label (per-user)            │
 ├────────< Category (custom, per-user)
 ├────────< Bill >── Category
 ├────────< ScanLog
 ├────────< McpToken
 └────────< VerificationToken

AppSettings (per role: FREE, PAID)
```

- **User** — id, name, email, emailVerified, password, role (ADMIN/FREE/PAID), currency, timezoneOffset, hide_amounts, quickExpenseCategories, quickIncomeCategories, receiptScanEnabled, transactionLayout, mcpWritesEnabledUntil (the write lease)
- **Category** — id, name, type (INCOME/EXPENSE), icon, color, isDefault, userId (null for defaults)
- **Transaction** — id, amount, description, type, date, categoryId, userId, billId, receiptGroupId (links itemized siblings), receiptBreakdown (JSON: individual line items), clientBatchId (idempotency key), createdVia (APP/MCP/TELEGRAM) + mcpTokenId (provenance)
- **Bill** — id, amount, description, frequency, nextDueDate, isActive, categoryId, userId (recurring scheduled transactions)
- **Label** — id, name, color, applicableTo (EXPENSE/INCOME/BOTH), userId, createdAt
- **LabelSchedule** — id, labelId, days (int[]), startTime, endTime (HH:mm strings)
- **TransactionLabel** — id, transactionId, labelId (join table)
- **AppSettings** — id, role (unique), receiptScanEnabled, maxUploadFiles, monthlyScanLimit
- **ScanLog** — id, userId, createdAt (tracks scan usage for monthly limits)
- **VerificationToken** — id, token, type (EMAIL_VERIFY/PASSWORD_RESET), userId, expiresAt
- **McpToken** - id, name, prefix, tokenHash (SHA-256; the plaintext is never stored), scopes, source (MCP/TELEGRAM, stamped onto rows the token writes), expiresAt, revokedAt, lastUsedAt, rate-limit window

## Analytics Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Income & Expenses Report, Category Breakdown, Label Breakdown, Cash Flow, Time Range Controls | Done |
| 2 | Period Comparison — compare two time ranges side by side | Planned |
| 3 | Records & Statistics — biggest expense, avg daily spend, most used category, streaks | Planned |
| 4 | Financial Health Score — savings rate, expense ratio, trend indicators | Planned |

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full development history and feature log.

## License

MIT
