# REVIEW.md

## Severity and evidence

- **Important** means an introduced correctness, security, privacy, data-integrity, deployment, or user-visible regression with a concrete failure or risk path
- **Nit** means a maintainability or convention issue that does not change behavior; report at most three nits per review
- Every finding must identify the triggering input or execution path and explain the resulting observable failure or risk
- Do not report formatting, lint, or type errors already enforced deterministically by CI unless they reveal a deeper behavioral defect
- Do not lower confidence merely because a bug needs a particular realistic input or state; do reject findings that remain speculative after checking the relevant context

## Always flag

### Security (blocking)
- Every non-public API route must authenticate and authorize before it reads or mutates protected data
- Use the mechanism required by the route family: NextAuth session helpers, `requireAdmin()`, Telegram signed `initData`, `CRON_SECRET`, or MCP bearer-token authentication
- Public authentication routes must validate their input and must not disclose whether sensitive account data exists
- Admin routes MUST use `requireAdmin()`, not UI-only role checks
- All user-owned reads and mutations MUST enforce ownership, including indirect foreign-key references
- Validate untrusted input before using it. Reuse shared Zod schemas where they exist; reusable request schemas belong in `src/lib/validations.ts`
- Never use `$queryRaw` with string interpolation — Prisma parameterized queries only
- Passwords must never appear in logs, API responses, or error messages
- No secrets, API keys, or `.env` values in the diff
- File uploads must enforce MIME type (`image/*`) and 4MB size limit
- Receipt scan endpoints must check `ScanLog` monthly limits and respect role caps (FREE < PAID < ADMIN)
- Treat changes to `.github/workflows/**`, `AGENTS.md`, `REVIEW.md`, and `.claude/**` as security-sensitive configuration, not as trivial documentation changes

### Data integrity (blocking)
- Date-range queries MUST accept and apply `timezoneOffset` — without it, transactions appear on the wrong day for non-UTC users
- Delete operations must check for dependent records (e.g., can't delete a category that has transactions)
- Batch operations must use Prisma transactions when atomicity matters
- Foreign key references (e.g., `categoryId`) must be validated as belonging to the current user

### State management (blocking)
- All server data must use TanStack Query — no `useEffect` + `fetch` patterns
- Mutations must invalidate the correct query keys after success (check `src/hooks/use-*.ts` for existing key conventions)
- Never cache user-specific data in the service worker. `src/app/sw.ts` applies `NetworkOnly` to every `/api/*` route and to every path `isProtectedPagePath` matches; the page list itself is `PROTECTED_PAGE_PATHS` in `src/lib/protected-paths.ts`

## Always check

### API routes
- Authenticate before protected-data access, enforce request-size ceilings before materializing large bodies, validate before database writes, and use the route family's documented auth mechanism
- Error responses use `{ error: string }` shape with correct HTTP status (400/401/403/404/500)
- Handler body wrapped in try/catch with a generic 500 fallback

### Components & UI
- New/changed UI must handle all three states: loading, error, and empty
- Components should stay under ~150 lines, functions under ~50 — extract hooks or sub-components if larger
- Use Tailwind utility classes — no inline styles, no `@apply` unless truly necessary
- Mobile layout must work at 375px+; touch targets must be at least 44x44px
- MobileFab must account for install banner height via `InstallBannerContext`
- Modals must use the existing `Modal` component (has `visualViewport` keyboard handling for iOS Safari)

### Database
- New columns need sensible defaults to avoid breaking existing rows
- Add indexes for columns used in WHERE/ORDER BY clauses
- Always review migration SQL for data loss, destructive operations, unsafe locking, deploy order, and disagreement with `schema.prisma`
- Generate migrations with `pnpm db:migrate` by default. Manual SQL is allowed when Prisma cannot express the required behavior, such as a partial index; require an explanation and focused verification
- `pnpm build` must never migrate a database. Production migration remains exclusive to `pnpm build:deploy`
- Shared read-only queries belong in `src/lib/budget-queries.ts` (dependency-injected for MCP reuse)
- When shared query signatures, schemas, scopes, or response types change, review affected MCP consumers and run the MCP server type-check required by `AGENTS.md`

### TypeScript
- `const` by default, `let` when needed, never `var`
- `unknown` over `any` — flag any use of `any` without justification
- `function` keyword for React components, arrow functions for utilities
- No `console.log` in committed code

## Skip

- Changes only to `CHANGELOG.md` or `README.md`, unless the prose contradicts behavior or security/deployment instructions
- Lock file updates (`pnpm-lock.yaml`) when accompanied by a valid dependency change
- Formatting-only diffs with no logic changes

## Project-specific pitfalls

- **Timezone bugs**: Most common source of subtle issues — any query filtering by date/month without `timezoneOffset` will produce wrong results
- **Stale query cache**: Adding a new mutation without invalidating related queries causes the UI to show stale data
- **Role gate bypass**: Feature gated in the UI but the API route doesn't enforce the same restriction
- **PWA cache poisoning**: Adding a new protected route without adding it to `PROTECTED_PAGE_PATHS` in `src/lib/protected-paths.ts`. The list is a denylist that fails open, so an omission caches the page rather than erroring
- **Missing ownership check**: API route that reads/writes data without verifying `userId` — allows users to access other users' data
