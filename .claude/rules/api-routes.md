---
paths:
  - "src/app/api/**"
---

# API Routes

## API Routes Reference
- `POST /api/register` — registration with bcrypt + sends verification email
- `GET/POST /api/transactions` — list (filters/pagination/timezone) + create
- `GET/PUT/DELETE /api/transactions/[id]` — load one transaction for editing, update, or delete (ownership check). `PUT` writes nothing at all when the save moves neither a scalar nor a label, so pressing Update with no edits cannot rewrite the audit trail or `updated_at`
- `GET /api/analytics` — analytics data (income/expenses, category/label breakdowns, cash flow) with granularity, date range, timezone, and type filter params
- `GET /api/assessment` — cached AI Assessment report for a period (`granularity`/`from`/`to`); returns `{ report | null, generatedAt, model }`, re-validated through `assessmentReportSchema` so a row cached before a section existed still renders
- `GET /api/assessment/facts` — the computed half of the assessment for a period: coverage, missed bills, bill accuracy, category movement, recurring spend, duplicates and anomalies. Live, never cached
- `POST /api/assessment/generate` — generate/refresh the AI report for a period (Gemini structured analysis + grounded web tips); caches it and enforces a per-day cap
- `GET /api/assessment/daily-tip` — today's lightweight AI save/earn tip (lazily generated + cached per local day)
- `GET /api/dashboard` — aggregated stats, category breakdown, monthly trends
- `GET/POST /api/categories` — list (defaults + custom) + create
- `PUT/DELETE /api/categories/[id]` — update/delete (custom only)
- `GET/POST /api/bills` — list + create bills
- `PUT/DELETE /api/bills/[id]` — update/deactivate bills
- `GET /api/bills/upcoming` — bills due within 30 days
- `POST /api/bills/[id]/pay` — pay bill: creates transaction + advances next due date
- `POST /api/bills/[id]/action` — `pay` / `pay_existing` / `skip` / `snooze` for one occurrence. A thin wrapper over `settleBill` in `src/lib/bill-writes.ts`, shared with the MCP `pay_bill` tool
- `GET/POST /api/labels` — list (with schedules) + create labels
- `PUT/DELETE /api/labels/[id]` — update/delete labels (ownership check)
- `POST /api/labels/[id]/apply` — retroactively apply schedule to existing transactions. Stamps `updated_via: APP` on the rows whose associations actually moved, and on no others -- both branches derive that from what their write really did (`createManyAndReturn`, `DELETE ... RETURNING`), never from the page read that planned it (#247, #251)
- `POST/PATCH/DELETE /api/transactions/batch` — create transactions (with auto-labeling), bulk-change categories/labels, or bulk-delete. `PATCH` reports `updated` as the rows that actually moved, not the rows selected, and stamps `updated_via: APP` on exactly those -- on the label-remove branch that means the rows the delete's own `RETURNING` named, never the ones a pre-write snapshot planned (#251). create accepts an optional `clientBatchId` UUID that makes it idempotent, returning 200 with the original rows on a replay instead of 201. All three verbs return **413** (`code: "BODY_TOO_LARGE"`) above a 5 MB body, refused before the body is parsed and before the replay lookup
- `POST /api/transactions/selection` — return a bounded, server-owned snapshot of transaction ids and display metadata matching the submitted filters
- `POST /api/transactions/export` — export a bounded set of owned transaction ids as CSV in the user's local timezone
- `POST /api/receipts/scan` — Gemini OCR for single receipt (thin wrapper over `scanReceipt` in `src/lib/receipt-scan.ts`, shared with MCP); reserves a scan credit before the AI call and refunds it if the scan fails (403 over quota, 429 rate limited, 413 body too large)
- `POST /api/receipts/breakdown` — Gemini itemization by category for multi-scan; same credit reservation and refund rules as `/scan`
- `GET/PATCH /api/preferences` — read/toggle user preferences (hide_amounts, etc.)
- `GET /api/profile` — user profile info
- `GET /api/email/verify` — validate email verification token
- `POST /api/email/forgot-password` — send password reset email
- `POST /api/email/reset-password` — validate token + update password
- `POST /api/resend-verification` — resend verification email
- `GET/POST /api/quick-tiles` — list + create quick-log buttons from the web app (NextAuth session). Same rows and same rules as `/api/tg/tiles`, both thin wrappers over `src/lib/quick-tile-writes.ts`
- `PATCH/DELETE /api/quick-tiles/[id]` — edit or remove one. 404 rather than 403 on somebody else's
- `POST /api/quick-tiles/reorder` — the **whole** id set, as the Mini App's route takes it
- `POST /api/quick-tiles/log` — one tap. `created_via: APP`, no `mcp_token_id`; accepts a `clientBatchId` and replays it ahead of every other 4xx branch
- `GET /api/quick-tiles/frequent` — the derived Frequent list, its own route because it reads up to 1,000 rows and the grid must not wait on it. `excludeKeys` is the tiles' raw descriptions, exactly as `/api/tg/bootstrap` passes them
- `GET /api/tg/bootstrap` — everything the Mini App grid needs in one round trip: the user's currency and offset, the configured tiles with their *resolved* categories, the derived Frequent tiles, the category list for the editor, and the tile cap. Authenticated by `Authorization: tma <initData>`, never a session
- `GET/POST /api/tg/tiles` — list + create quick-log tiles (409 over `MAX_QUICK_TILES`, 409 on a duplicate label, 400 on a category the user does not own or whose type disagrees)
- `PATCH/DELETE /api/tg/tiles/[id]` — edit or remove one tile. 404 rather than 403 on somebody else's, since a 403 confirms it exists
- `POST /api/tg/tiles/reorder` — rewrite the grid order. Takes the **whole** set of the user's ids, refusing anything more or fewer, so a half-applied reorder cannot leave a grid nobody arranged; 409 when a tile was deleted mid-drag
- `POST /api/tg/log` — one tap. Writes through `createTransactionBatch` with `created_via: TELEGRAM` and no `mcp_token_id`, omitting `labelIds` so schedules run; accepts a `clientBatchId` and replays it ahead of every other 4xx branch
- `GET /api/cron/bill-reminders` — sends email reminders for pending bills (secured with `CRON_SECRET`); triggered daily by a Coolify Scheduled Task on production
- `GET /api/cron/telegram-prompts` — sends the Telegram evening prompt to users with `telegram_daily_prompt` on (secured with `CRON_SECRET`). Claims the day in `telegram_prompt_logs` *before* sending and releases it if the send throws, so a crash retries and a success cannot repeat. Returns **409** when more than one user has the prompt enabled, since nothing maps a Telegram account to an app user and the wrong guess reads one person's day and messages another about it
- `POST|DELETE /api/mcp`: remote MCP endpoint over Streamable HTTP, authenticated by a static bearer token. Runs the transport stateless (a route handler has no process to pin a session to) and builds a per-request server narrowed to the token's scopes. `GET` deliberately returns **405**: serving the standalone SSE stream from a stateless route would pin an open request and a keep-alive timer per client on a transport nothing writes to, and the SDK client reads 405 as "no stream offered" and carries on over POST. `POST` refuses a body over `MAX_MCP_BODY_BYTES` with **413** in a JSON-RPC envelope (#245)
- `GET/POST /api/mcp/tokens`: list + mint MCP tokens (NextAuth session); the plaintext is returned once and never stored
- `DELETE /api/mcp/tokens/[id]`: revoke a token (marks `revoked_at`, keeps the row for after-the-fact audit). `?permanent=true` deletes the row instead, and is refused with 409 on a token that is not already revoked, so removing a working credential takes two deliberate steps. Deleting cascades nothing: `transactions.mcp_token_id` is not a foreign key, so the rows a token wrote keep their provenance and only the name behind the id is lost
- `GET /api/health` — container liveness probe for the Coolify/Docker healthcheck; unauthenticated and deliberately touches no database (a deep check would restart every app on the shared Postgres during one blip)

